/**
 * ITEMIZED DONOR CONCENTRATION ANALYSIS
 *
 * Stream-and-Aggregate Architecture for Cloudflare Free Tier
 *
 * Key Difference from Prototype:
 * - NO raw transaction storage (saves 15.5 GB → 535 MB)
 * - Stores aggregates during collection: donorTotals map + amounts array
 * - Final storage: 2 KB per member (vs 29 MB in prototype)
 *
 * Storage during collection: 535 members × 1 MB = 535 MB ✅
 * Storage after cleanup: 535 members × 2 KB = 1 MB ✅
 *
 * See DONOR_CONCENTRATION_ANALYSIS.md for the design doc and
 * GRASSROOTS_CALCULATION_GUIDE.md for how the output feeds tier calculation.
 */

import { cycleForYear } from './tier-calculation.js';
import { FEC_CROSSWALK } from './fec-crosswalk.js';
import { fetchPersonFunding, withRequestBudget, committeeSignature } from './person-funding.js';
import { classifyScheduleARow, normalizeConduitName, topConduits } from './schedule-a-classify.js';
import {
  readBudget,
  chargeBudget,
  canAfford,
  estimateRowWrites,
  DAILY_ROW_WRITE_BUDGET,
} from './d1-write-budget.js';

// HTTP-triggered runs must fit the 30s wall-clock limit; cron-triggered
// runs get 15 minutes, so they can take much larger bites (ROADMAP A1)
const PAGES_PER_RUN_HTTP = 5;
const PAGES_PER_RUN_CRON = 20;

// Analyses older than this are re-collected by the refresh policy.
// The queue rebuild and the completion checks share this constant.
export const ANALYSIS_STALENESS_DAYS = 30;

// An analysis is "fresh" if collected within the staleness window.
// Missing/undated analyses are stale by definition.
export function isAnalysisFresh(analysis, nowMs = Date.now()) {
  const completedAt = analysis?.collectionCompletedAt || analysis?.lastUpdated;
  if (!completedAt) {
    return false;
  }
  return nowMs - new Date(completedAt).getTime() < ANALYSIS_STALENESS_DAYS * 24 * 60 * 60 * 1000;
}

// An analysis is "current" if it is fresh AND was collected from the
// committee now on the member's record. A fresh analysis of the wrong
// committee is someone else's donors (issue #41) and must be re-collected.
//
// Since #32 it must also be PERSON-LEVEL: collected over every committee the
// member runs (campaign, own joint funds, leadership PAC), not just the
// campaign. Campaign-only analyses keep serving the grade on the campaign
// basis until their person-level replacement completes.
export function isAnalysisCurrent(analysis, memberCommitteeId, nowMs = Date.now()) {
  return (
    Boolean(memberCommitteeId) &&
    analysis?.committeeId === memberCommitteeId &&
    analysis?.personLevel === true &&
    isAnalysisFresh(analysis, nowMs)
  );
}

// Committees whose donors form the member's pool: the person-level list, and
// always the campaign committee on the member's record.
export function donorPool(personFunding, memberCommitteeId) {
  const ids = new Set(personFunding?.donorCommitteeIds || []);
  ids.add(memberCommitteeId);
  return [...ids].sort();
}

// Committee discovery reuses the analysis staleness window: refreshed on the
// same 30-day cycle as the donor collection itself.
function isPersonFundingFresh(pf, nowMs = Date.now()) {
  return (
    Boolean(pf?.fetchedAt) &&
    nowMs - new Date(pf.fetchedAt).getTime() < ANALYSIS_STALENESS_DAYS * 24 * 60 * 60 * 1000
  );
}

// Find every committee the member runs (#32). One run's work: Cloudflare's
// free plan allows 50 outbound requests per invocation, so discovery gets 40
// and does nothing else. Failure is not fatal - the member is collected on
// their campaign committee alone and discovery is retried next cycle.
async function discoverCommittees(memberRecord, cycle, apiKey, log) {
  const ids = FEC_CROSSWALK[memberRecord.bioguideId] || [];
  const fec = withRequestBudget(async (path, params = {}) => {
    const qs = new URLSearchParams({ api_key: apiKey });
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const res = await fetch(`https://api.open.fec.gov/v1${path}?${qs}`, {
      headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' },
    });
    if (!res.ok) {
      throw new Error(`FEC ${res.status} on ${path}`);
    }
    // FEC allows 60 requests per minute per key; 40 calls at >=1s spacing
    // cannot trip it even if another run shares the minute
    await sleep(1000);
    return res.json();
  }, 40);
  try {
    const pf = await fetchPersonFunding(fec, ids, cycle);
    if (!pf.invariantsHold) {
      throw new Error('attribution invariants failed');
    }
    log(
      `  🧭 Committees found (${fec.used()} FEC calls): ${pf.committees
        .map(c => `${c.role}:${c.committeeId}`)
        .join(', ')} | donor pool ${pf.donorCommitteeIds.join(',')}`
    );
    return { ...pf, fetchedAt: new Date().toISOString(), cycle };
  } catch (error) {
    // A rate limit is temporary: fail the run so the queue retries soon,
    // rather than settling for campaign-only for a whole refresh cycle
    if (/\b429\b/.test(error.message)) {
      throw error;
    }
    log(`  ⚠️ Committee discovery failed (${error.message}); collecting campaign committee only`);
    return {
      fetchedAt: new Date().toISOString(),
      cycle,
      failed: true,
      error: error.message,
      donorCommitteeIds: [],
      committees: [],
    };
  }
}

function newProgress({ bioguideId, memberCommitteeId, cycle, personFunding, replacesCommitteeId }) {
  const committeeIds = donorPool(personFunding, memberCommitteeId);
  return {
    bioguideId,
    committeeId: memberCommitteeId, // the campaign on the member's record
    committeeIds, // every committee whose donors are collected (#32)
    committeeSignature: committeeSignature(committeeIds),
    committeeIndex: 0,
    personFunding,
    cycle,
    totalTransactions: 0,
    totalAmount: 0,
    rawRowCount: 0, // every fetched row incl. memos - compared to FEC's pagination count
    fecTotalCount: 0,
    countedCommittees: [],
    runsCompleted: 0,
    lastIndex: null,
    lastContributionReceiptDate: null,
    donorTotals: {}, // "FIRST|LAST|STATE|ZIP" -> total across ALL the member's committees
    allAmounts: [],
    conduitTotals: {},
    earmarkedTotal: 0,
    earmarkedCount: 0,
    startedAt: new Date().toISOString(),
    // Set when this collection replaces an analysis of a different
    // campaign committee (identity correction, #41)
    replacesCommitteeId,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/analyze') {
      return analyzeMembers(env, PAGES_PER_RUN_HTTP);
    }

    if (url.pathname === '/status') {
      return getStatus(env);
    }

    return new Response(
      'Itemized Donor Concentration Analysis\n\nEndpoints:\n  /analyze - Trigger processing\n  /status - View progress',
      {
        headers: { 'Content-Type': 'text/plain' },
      }
    );
  },

  async scheduled(event, env, _ctx) {
    // Cron trigger - process next chunk automatically
    console.log('🕐 Cron trigger fired:', new Date().toISOString());

    // The :10 run each hour finds committees for one member (#32) so every
    // card's money trail is published within ~3 weeks rather than waiting
    // for that member to reach the head of the collection queue. The :30
    // and :50 runs collect donors as before. (Cron is offset from the data
    // pipeline's - see wrangler-itemized-analysis.toml.)
    if (new Date(event.scheduledTime || Date.now()).getUTCMinutes() < 20) {
      try {
        await runDiscoverySweep(env);
      } catch (error) {
        console.error('❌ Discovery sweep failed:', error.message);
      }
      return;
    }

    try {
      const result = await analyzeMembers(env, PAGES_PER_RUN_CRON);
      const data = await result.json();

      console.log('✅ Cron processing complete');
      console.log(`   Queue remaining: ${data.queueStatus?.remainingMembers || 'N/A'}`);
      console.log(`   Current member: ${data.queueStatus?.currentMember || 'N/A'}`);
      console.log(`   All complete: ${data.allComplete}`);
    } catch (error) {
      console.error('❌ Cron processing failed:', error.message);
    }
  },
};

// Discover one member's committees and attach them to their existing
// analysis, so the money trail is disclosed before the person-level donor
// collection reaches them. Walks members:all in bioguide order from a saved
// cursor; members with no analysis yet are skipped (their collection does
// discovery itself). Costs per run: <=40 FEC calls, <=30 KV reads, 2 KV writes.
async function runDiscoverySweep(env) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';
  const log = msg => console.log(msg);
  const membersData = await env.MEMBER_DATA.get('members:all');
  if (!membersData) {
    return;
  }
  const eligible = JSON.parse(membersData)
    .filter(m => m.fecIdentityVerified === true && m.committeeInfo?.id)
    .sort((a, b) => a.bioguideId.localeCompare(b.bioguideId));
  if (eligible.length === 0) {
    return;
  }
  const cursor = parseInt((await env.MEMBER_DATA.get('discovery_sweep_cursor')) || '0', 10) || 0;
  for (let step = 0; step < 30; step++) {
    const idx = (cursor + step) % eligible.length;
    const member = eligible[idx];
    const key = `itemized_analysis_v2:${member.bioguideId}`;
    const raw = await env.MEMBER_DATA.get(key);
    if (!raw) {
      continue;
    }
    const analysis = JSON.parse(raw);
    if (analysis.committeeId !== member.committeeInfo.id) {
      continue;
    }
    if (analysis.personFunding && isPersonFundingFresh(analysis.personFunding)) {
      continue;
    }
    log(`🧭 Discovery sweep: ${member.name} (${member.bioguideId})`);
    const cycle = cycleForYear(new Date().getFullYear());
    const pf = await discoverCommittees(member, cycle, apiKey, log);
    if (!pf.failed) {
      analysis.personFunding = pf;
      await env.MEMBER_DATA.put(key, JSON.stringify(analysis));
    }
    await env.MEMBER_DATA.put('discovery_sweep_cursor', String((idx + 1) % eligible.length));
    return;
  }
  // Nothing needed in this window - move the cursor on
  await env.MEMBER_DATA.put('discovery_sweep_cursor', String((cursor + 30) % eligible.length));
}

async function getStatus(env) {
  // Real counts, not hardcoded guesses: member total from members:all,
  // analysis count from a prefixed key list (1 list op)
  const [queueData, membersData, keyList] = await Promise.all([
    env.MEMBER_DATA.get('itemized_processing_queue'),
    env.MEMBER_DATA.get('members:all'),
    env.MEMBER_DATA.list({ prefix: 'itemized_analysis_v2:' }),
  ]);

  const queue = queueData ? JSON.parse(queueData) : [];
  const totalMembers = membersData ? JSON.parse(membersData).length : null;
  const analysesStored = keyList?.keys?.length ?? null;

  const status = {
    mode: `refresh (analyses re-collected after ${ANALYSIS_STALENESS_DAYS} days)`,
    queueStatus: {
      totalMembers,
      analysesStored,
      remainingInQueue: queue.length,
      nextMember: queue[0] || null,
    },
    lastUpdated: new Date().toISOString(),
  };

  return new Response(JSON.stringify(status, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Refresh policy (ROADMAP A1): when the queue is empty, rebuild it from
// members whose analysis is missing or older than ANALYSIS_STALENESS_DAYS,
// oldest first. Members need a committeeInfo.id (discovered by the data
// pipeline's Phase 1) to be collectable. Costs ~1 KV read per member, once
// per full pass (~2 weeks) - a rebuild run only rebuilds, processing
// starts on the next run.
async function rebuildQueue(env, log) {
  const membersData = await env.MEMBER_DATA.get('members:all');
  if (!membersData) {
    log('⚠️ No members:all dataset - cannot rebuild queue');
    return [];
  }

  const members = JSON.parse(membersData);
  // Collectable = a verified FEC identity with a committee on record
  // (issue #41). Unverified members wait for the pipeline to resolve them.
  const collectable = members.filter(m => m.committeeInfo?.id && m.fecIdentityVerified === true);
  log(`🔁 Rebuilding queue: checking ${collectable.length} collectable members for staleness...`);

  const now = Date.now();
  const candidates = [];
  for (const member of collectable) {
    let completedAtMs = 0; // missing analysis sorts oldest
    try {
      const data = await env.MEMBER_DATA.get(`itemized_analysis_v2:${member.bioguideId}`);
      if (data) {
        const analysis = JSON.parse(data);
        if (isAnalysisCurrent(analysis, member.committeeInfo.id, now)) {
          continue;
        }
        const completedAt = analysis.collectionCompletedAt || analysis.lastUpdated;
        completedAtMs = completedAt ? new Date(completedAt).getTime() : 0;
      }
    } catch {
      // unreadable analysis -> treat as missing (stale)
    }
    candidates.push({ bioguideId: member.bioguideId, name: member.name, completedAtMs });
  }

  candidates.sort((a, b) => a.completedAtMs - b.completedAtMs);
  const queue = candidates.map(c => ({ bioguideId: c.bioguideId, name: c.name }));

  if (queue.length > 0) {
    await env.MEMBER_DATA.put('itemized_processing_queue', JSON.stringify(queue));
    log(`🔁 Queue rebuilt with ${queue.length} members (oldest analysis first)`);
  } else {
    log(`✅ All analyses fresh (< ${ANALYSIS_STALENESS_DAYS} days) - nothing to refresh`);
  }

  return queue;
}

async function analyzeMembers(env, pagesPerRun = PAGES_PER_RUN_HTTP) {
  const startTime = Date.now();
  const results = {};
  const executionLog = [];

  const log = msg => {
    console.log(msg);
    executionLog.push(`${new Date().toISOString()} - ${msg}`);
  };

  log('🚀 Starting free-tier itemized analysis chunk');
  log(`⏰ Start time: ${new Date().toISOString()}`);
  log(`📦 Pages per run: ${pagesPerRun}`);

  // D1's 100k row-writes/day is hard-enforced: past it, writes error until
  // 00:00 UTC. Stand down rather than spend FEC calls producing data we
  // cannot store - the member stays at the queue head and resumes tomorrow.
  const budget = await readBudget(env.DONOR_DB);
  const meter = { spent: 0 };
  log(
    `🧾 D1 write budget: ${budget.spent.toLocaleString()}/${DAILY_ROW_WRITE_BUDGET.toLocaleString()} used today (${budget.remaining.toLocaleString()} left)`
  );
  if (budget.remaining <= 0) {
    log(
      budget.degraded
        ? '🛑 Standing down: the write ledger could not be read, so remaining budget is unprovable'
        : `🛑 Standing down: daily D1 write budget exhausted, resumes 00:00 UTC`
    );
    return new Response(
      JSON.stringify(
        {
          allComplete: false,
          budgetExhausted: true,
          budget,
          message: 'D1 daily write budget exhausted; no work attempted this run',
          executionLog,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get processing queue from KV
  const queueKey = 'itemized_processing_queue';
  const queueData = await env.MEMBER_DATA.get(queueKey);
  let queue = queueData ? JSON.parse(queueData) : [];

  if (queue.length === 0) {
    // Refresh policy: rebuild from stale/missing analyses. Processing of
    // the rebuilt queue starts on the NEXT run (keeps this invocation's
    // KV-op count bounded). Throttled: the rebuild scan costs ~1 KV read
    // per member, so when everything is fresh, only re-check every 6h
    // instead of every cron tick.
    const REBUILD_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const lastCheck = await env.MEMBER_DATA.get('itemized_refresh_last_check');
    if (lastCheck && Date.now() - new Date(lastCheck).getTime() < REBUILD_CHECK_INTERVAL_MS) {
      log(
        `😴 Queue empty; next staleness scan after ${new Date(new Date(lastCheck).getTime() + REBUILD_CHECK_INTERVAL_MS).toISOString()}`
      );
      return new Response(
        JSON.stringify(
          {
            allComplete: true,
            message: 'Queue empty; staleness scan throttled',
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    await env.MEMBER_DATA.put('itemized_refresh_last_check', new Date().toISOString());
    queue = await rebuildQueue(env, log);
    return new Response(
      JSON.stringify(
        {
          allComplete: queue.length === 0,
          message:
            queue.length === 0
              ? `All analyses fresh (< ${ANALYSIS_STALENESS_DAYS} days)`
              : `Queue rebuilt with ${queue.length} members; processing starts next run`,
          queueStatus: { remainingMembers: queue.length },
          executionLog,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  log(`📋 Processing queue: ${queue.length} members remaining`);

  // Process only the first member from queue (stay within resource limits)
  const members = [queue[0]];

  let totalPagesProcessed = 0;

  for (const member of members) {
    log(`\n📊 Processing ${member.name} (${member.bioguideId})`);
    const memberStartTime = Date.now();

    try {
      const result = await fetchAndAggregateChunk(
        member.bioguideId,
        env,
        log,
        pagesPerRun,
        budget,
        meter
      );
      const processingTime = Date.now() - memberStartTime;

      results[member.bioguideId] = {
        name: member.name,
        success: true,
        ...result,
        processingTimeMs: processingTime,
        processingTimeSeconds: Math.round(processingTime / 1000),
      };

      totalPagesProcessed += result.pagesProcessedThisRun || 0;

      if (result.complete) {
        log(
          `✅ ${member.name} COMPLETE: ${result.totalTransactions} transactions, ${result.uniqueDonors || 'N/A'} unique donors`
        );
      } else {
        log(
          `⏸️ ${member.name} in progress: ${result.totalTransactions} transactions aggregated, ${result.runsCompleted} runs completed`
        );
      }
    } catch (error) {
      const processingTime = Date.now() - memberStartTime;
      console.error(`❌ ${member.name} failed:`, error);
      log(`❌ ${member.name} failed after ${processingTime}ms: ${error.message}`);

      results[member.bioguideId] = {
        name: member.name,
        success: false,
        error: error.message,
        processingTimeMs: processingTime,
      };
    }

    // Check if we're at subrequest limit
    if (totalPagesProcessed >= pagesPerRun) {
      log(`\n⚠️ Reached page limit (${totalPagesProcessed} pages processed), stopping this run`);
      break;
    }
  }

  const totalTime = Date.now() - startTime;
  log(`\n🏁 Chunk complete: ${totalTime}ms (${Math.round(totalTime / 1000)}s)`);
  log(`📄 Pages processed this run: ${totalPagesProcessed}`);

  // Update queue - remove completed member, defer failed member, or keep
  // in-progress member. "Complete" means the analysis is FRESH: under the
  // refresh policy a stale analysis exists during re-collection (it keeps
  // serving tiers until atomically replaced at completion), so bare key
  // existence is not completion.
  const member = members[0];
  const analysisKey = `itemized_analysis_v2:${member.bioguideId}`;
  const analysisData = await env.MEMBER_DATA.get(analysisKey);
  let parsedAnalysis = null;
  try {
    parsedAnalysis = analysisData ? JSON.parse(analysisData) : null;
  } catch {
    parsedAnalysis = null;
  }
  // Complete = an analysis that is fresh AND from the member's current
  // committee. A fresh analysis of the wrong committee must not end the
  // member's turn in the queue after one chunk (issue #41).
  const memberComplete =
    results[member.bioguideId]?.complete === true &&
    isAnalysisCurrent(parsedAnalysis, results[member.bioguideId]?.committeeId);

  if (memberComplete) {
    queue.shift();
    await env.MEMBER_DATA.put(queueKey, JSON.stringify(queue));
    log(`✅ ${member.name} complete and removed from queue. ${queue.length} members remaining.`);
  } else if (results[member.bioguideId]?.success === false) {
    // Failed (e.g. no FEC committee found yet). Defer with a retry budget;
    // permanent failures must not cycle forever or the queue never drains
    // and the refresh rebuild never triggers.
    queue.shift();
    const failCount = (member.failCount || 0) + 1;
    if (failCount < 3) {
      queue.push({ ...member, failCount });
      log(
        `⏭️ ${member.name} deferred (attempt ${failCount}/3): ${results[member.bioguideId]?.error}`
      );
    } else {
      log(
        `🚫 ${member.name} dropped after ${failCount} failures; next queue rebuild retries if collectable`
      );
    }
    await env.MEMBER_DATA.put(queueKey, JSON.stringify(queue));
  } else {
    // Still in progress (multi-run member), keep at front
    await env.MEMBER_DATA.put(queueKey, JSON.stringify(queue));
    log(`⏸️ ${member.name} still in progress, keeping in queue`);
  }

  // Bill this run to today's ledger. Once per run, not once per write: the
  // ledger update is itself a D1 write.
  await chargeBudget(env.DONOR_DB, meter.spent);
  log(
    `🧾 D1 rows written this run: ~${meter.spent.toLocaleString()} (day total ~${(budget.spent + meter.spent).toLocaleString()}/${DAILY_ROW_WRITE_BUDGET.toLocaleString()})`
  );

  // Check overall status
  const allComplete = queue.length === 0;

  return new Response(
    JSON.stringify(
      {
        allComplete,
        d1Budget: {
          rowsWrittenThisRun: meter.spent,
          dayTotal: budget.spent + meter.spent,
          dailyBudget: DAILY_ROW_WRITE_BUDGET,
        },
        results,
        queueStatus: {
          remainingMembers: queue.length,
          currentMember: member.name,
          currentMemberComplete: memberComplete,
        },
        summary: {
          totalProcessingTimeMs: totalTime,
          totalProcessingTimeSeconds: Math.round(totalTime / 1000),
          pagesProcessedThisRun: totalPagesProcessed,
          allMembersComplete: allComplete,
        },
        executionLog,
        timestamp: new Date().toISOString(),
        nextAction: allComplete
          ? '✅ All members complete!'
          : `▶️ Next: ${queue[0]?.name || 'Unknown'}`,
      },
      null,
      2
    ),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// eslint-disable-next-line no-unused-vars
async function checkAllComplete(env, members) {
  for (const member of members) {
    const analysisKey = `itemized_analysis_v2:${member.bioguideId}`;
    const analysisData = await env.MEMBER_DATA.get(analysisKey);

    if (!analysisData) {
      return false;
    }
  }
  return true;
}

async function fetchAndAggregateChunk(
  bioguideId,
  env,
  log,
  pagesPerRun = PAGES_PER_RUN_HTTP,
  budget = { remaining: Infinity, degraded: false },
  meter = { spent: 0 }
) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';
  const progressKey = `itemized_progress_v2:${bioguideId}`;
  const analysisKey = `itemized_analysis_v2:${bioguideId}`;

  // The committee comes only from the data pipeline, which resolves it from
  // the FEC crosswalk and stamps the member's identity as verified (issue
  // #41). This worker used to name-search FEC itself when no committee was on
  // record - the same defect that tied 35 members to other people - so it no
  // longer does. No verified committee yet = nothing to collect; the queue
  // defers the member and a later rebuild picks them up.
  const membersData = await env.MEMBER_DATA.get('members:all');
  if (!membersData) {
    throw new Error('Members dataset not found in KV');
  }
  const memberRecord = JSON.parse(membersData).find(m => m.bioguideId === bioguideId);
  if (!memberRecord) {
    throw new Error(`Member not found in dataset: ${bioguideId}`);
  }
  if (memberRecord.fecIdentityVerified !== true) {
    throw new Error(`FEC identity not verified yet for ${memberRecord.name}`);
  }
  const memberCommitteeId = memberRecord.committeeInfo?.id || null;
  if (!memberCommitteeId) {
    throw new Error(`No committee on record for ${memberRecord.name} yet`);
  }

  // Current analysis -> nothing to do. A stale or campaign-only analysis
  // keeps serving tiers until its replacement atomically takes over at
  // completion; one for a DIFFERENT campaign committee is not served at all.
  const existingAnalysisData = await env.MEMBER_DATA.get(analysisKey);
  const existingAnalysis = existingAnalysisData ? JSON.parse(existingAnalysisData) : null;
  if (isAnalysisCurrent(existingAnalysis, memberCommitteeId)) {
    log(`  ✅ Already complete (fresh, person-level)`);
    return {
      complete: true,
      committeeId: memberCommitteeId,
      totalTransactions: existingAnalysis.totalTransactions,
      uniqueDonors: existingAnalysis.uniqueDonors,
      pagesProcessedThisRun: 0,
    };
  }
  const replacesCommitteeId =
    existingAnalysis && existingAnalysis.committeeId !== memberCommitteeId
      ? existingAnalysis.committeeId || null
      : null;

  const existingProgressData = await env.MEMBER_DATA.get(progressKey);
  let progress = existingProgressData ? JSON.parse(existingProgressData) : null;

  // Step 1 - which committees? A collection in progress carries its own
  // list; otherwise (or when that list is stale) this run discovers it and
  // stops. Campaign-only collections from before #32 carry no list and are
  // restarted person-level.
  if (!progress?.personFunding || !isPersonFundingFresh(progress.personFunding)) {
    if (progress) {
      log(
        `  🔀 Restarting ${progress.totalTransactions || 0}-transaction collection person-level (#32)`
      );
    }
    const cycle = cycleForYear(new Date().getFullYear());
    const personFunding = await discoverCommittees(memberRecord, cycle, apiKey, log);
    progress = newProgress({
      bioguideId,
      memberCommitteeId,
      cycle,
      personFunding,
      replacesCommitteeId,
    });
    await env.MEMBER_DATA.put(progressKey, JSON.stringify(progress));
    // Publish the disclosure straight away on the member's existing analysis;
    // the grade basis only changes when the person-level collection completes
    if (
      existingAnalysis &&
      existingAnalysis.committeeId === memberCommitteeId &&
      !personFunding.failed
    ) {
      existingAnalysis.personFunding = personFunding;
      await env.MEMBER_DATA.put(analysisKey, JSON.stringify(existingAnalysis));
    }
    return {
      complete: false,
      discovery: true,
      committeeId: memberCommitteeId,
      totalTransactions: 0,
      pagesProcessedThisRun: 0,
      runsCompleted: 0,
    };
  }

  // Step 2 - the collection in progress must be for exactly this pool. A
  // corrected campaign committee (#41) changes the pool and restarts it.
  const pool = donorPool(progress.personFunding, memberCommitteeId);
  if (progress.committeeSignature !== committeeSignature(pool)) {
    log(
      `  🔀 Committee pool changed (${progress.committeeSignature} -> ${committeeSignature(pool)}); restarting`
    );
    progress = newProgress({
      bioguideId,
      memberCommitteeId,
      cycle: progress.cycle,
      personFunding: progress.personFunding,
      replacesCommitteeId,
    });
  }
  log(
    `  📂 Collecting ${progress.committeeIds.length} committee(s) [${progress.committeeIndex + 1}/${progress.committeeIds.length}]: ${progress.totalTransactions || 0} transactions, ${Object.keys(progress.donorTotals).length} donors so far`
  );

  let committeeId = progress.committeeIds[progress.committeeIndex];
  const cycle = progress.cycle;

  // Fetch transactions using cursor-based pagination
  const perPage = 100;
  const maxPagesToFetch = pagesPerRun;

  log(`  📥 Fetching Schedule A transactions (up to ${maxPagesToFetch} API calls)...`);

  const fetchStartTime = Date.now();
  let pagesProcessed = 0;
  let reachedEnd = false;

  let budgetStopped = false;

  while (pagesProcessed < maxPagesToFetch) {
    // Stop before spending an FEC call we cannot store the result of. A page
    // is at most `perPage` transactions, and completion still has to write
    // this member's aggregates, so reserve for both rather than paging up to
    // the line and then failing on the write that matters.
    const pageCost = estimateRowWrites({ transactions: perPage });
    // Completion writes one collection_metadata row. It used to reserve
    // room for a D1 row per donor as well, which for any member with more
    // donors than a day's budget could cover (7,169 donors needed 14,338 of
    // the 14,565 rows left) paused the member at the queue head every run
    // and stalled the whole queue behind them (found 2026-09-26).
    const completionReserve = estimateRowWrites({ metadataReplaces: 1 });
    if (!canAfford(budget, meter.spent, pageCost + completionReserve)) {
      log(
        `  🧾 Pausing after ${pagesProcessed} pages: next page would exceed the daily D1 write budget`
      );
      budgetStopped = true;
      break;
    }

    const pageStartTime = Date.now();

    // Build URL with cursor-based pagination
    // NOTE: no contributor_type=individual filter - it drops the PAC-entity
    // memo rows that name earmark conduits (issue #33). classifyScheduleARow
    // separates individuals / committees / conduit lumps instead.
    let url =
      `https://api.open.fec.gov/v1/schedules/schedule_a/?` +
      `api_key=${apiKey}` +
      `&committee_id=${committeeId}` +
      `&per_page=${perPage}` +
      `&two_year_transaction_period=${cycle}`;

    if (progress.lastIndex) {
      url += `&last_index=${progress.lastIndex}`;
    }
    if (progress.lastContributionReceiptDate) {
      url += `&last_contribution_receipt_date=${progress.lastContributionReceiptDate}`;
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' },
    });

    if (!response.ok) {
      throw new Error(`FEC API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const transactions = data.results || [];

    if (transactions.length === 0) {
      if (progress.committeeIndex < progress.committeeIds.length - 1) {
        // This committee is done; move to the member's next one
        progress.committeeIndex++;
        committeeId = progress.committeeIds[progress.committeeIndex];
        progress.lastIndex = null;
        progress.lastContributionReceiptDate = null;
        log(`  ➡️ Next committee: ${committeeId}`);
        continue;
      }
      log(`  ✅ No more transactions (all ${progress.committeeIds.length} committees done)`);
      reachedEnd = true;
      break;
    }

    // FEC's row count per committee, summed, for validation at completion
    if (data.pagination?.count && !progress.countedCommittees.includes(committeeId)) {
      progress.fecTotalCount += data.pagination.count;
      progress.countedCommittees.push(committeeId);
      log(`  📊 FEC reports ${data.pagination.count} rows for ${committeeId}`);
    }

    // **KEY CHANGE: Update aggregates in-memory AND write to D1**
    const d1Inserts = [];
    for (const tx of transactions) {
      progress.rawRowCount = (progress.rawRowCount || 0) + 1;

      const rowClass = classifyScheduleARow(tx);

      if (rowClass === 'invalid' || rowClass === 'memo' || rowClass === 'committee') {
        // memos double-count; committee money is Phase 2's job
        continue;
      }

      if (rowClass === 'conduit-memo') {
        // Network attribution (issue #33): the memo lump names the conduit
        // (AIPAC PAC, ActBlue, ...) that bundled individual money. Track it,
        // but keep it out of the money totals.
        const conduitName = normalizeConduitName(tx.contributor_name);
        const existing = progress.conduitTotals[conduitName] || { amount: 0, count: 0 };
        existing.amount += tx.contribution_receipt_amount;
        existing.count += 1;
        progress.conduitTotals[conduitName] = existing;
        continue;
      }

      if (rowClass === 'individual-earmarked') {
        // Countable individual money that arrived pre-bundled via a conduit
        progress.earmarkedTotal = (progress.earmarkedTotal || 0) + tx.contribution_receipt_amount;
        progress.earmarkedCount = (progress.earmarkedCount || 0) + 1;
        // falls through to normal individual aggregation below
      }

      // Composite deduplication key
      const firstName = (tx.contributor_first_name || '').toUpperCase().trim();
      const lastName = (tx.contributor_last_name || '').toUpperCase().trim();
      const state = (tx.contributor_state || '').toUpperCase().trim();
      // 5-digit zip: filings mix "20001" and "20001-1234" for the same
      // person, which split one donor into two and understated
      // concentration - more so once donors are pooled across committees (#32)
      const zip = (tx.contributor_zip || '').trim().slice(0, 5);
      const compositeKey = `${firstName}|${lastName}|${state}|${zip}`;

      // Aggregate by donor (running total per unique donor)
      progress.donorTotals[compositeKey] =
        (progress.donorTotals[compositeKey] || 0) + tx.contribution_receipt_amount;

      // Track all amounts for median calculation
      progress.allAmounts.push(tx.contribution_receipt_amount);

      // Running totals
      progress.totalTransactions++;
      progress.totalAmount += tx.contribution_receipt_amount;

      // Prepare D1 insert for raw transaction. sub_id is FEC's unique
      // transaction identifier (ROADMAP A2) - enables dedup and future
      // incremental top-ups instead of full re-collections.
      d1Inserts.push({
        bioguide_id: bioguideId,
        committee_id: committeeId,
        cycle: cycle,
        sub_id: tx.sub_id === null || tx.sub_id === undefined ? null : String(tx.sub_id),
        contributor_first_name: tx.contributor_first_name || null,
        contributor_last_name: tx.contributor_last_name || null,
        contributor_state: tx.contributor_state || null,
        contributor_zip: tx.contributor_zip || null,
        contributor_employer: tx.contributor_employer || null,
        contributor_occupation: tx.contributor_occupation || null,
        amount: tx.contribution_receipt_amount,
        contribution_receipt_date: tx.contribution_receipt_date || null,
      });
    }

    // Batch write transactions to D1 (respecting SQLite 999 parameter limit)
    if (d1Inserts.length > 0 && env.DONOR_DB) {
      try {
        // D1 appears to have a lower limit than SQLite's 999 - use 10 rows per batch (11 × 10 = 110)
        const BATCH_SIZE = 10;
        const batches = [];
        for (let i = 0; i < d1Inserts.length; i += BATCH_SIZE) {
          batches.push(d1Inserts.slice(i, i + BATCH_SIZE));
        }

        // Use D1 batch API with individual statements instead of multi-row VALUES
        for (const batch of batches) {
          // INSERT OR IGNORE + unique sub_id index = idempotent even if a
          // run repeats a page (cursor overlap, retries)
          const statements = batch.map(tx =>
            env.DONOR_DB.prepare(
              `INSERT OR IGNORE INTO itemized_transactions
               (bioguide_id, committee_id, cycle, sub_id, contributor_first_name, contributor_last_name,
                contributor_state, contributor_zip, contributor_employer, contributor_occupation,
                amount, contribution_receipt_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              tx.bioguide_id,
              tx.committee_id,
              tx.cycle,
              tx.sub_id,
              tx.contributor_first_name,
              tx.contributor_last_name,
              tx.contributor_state,
              tx.contributor_zip,
              tx.contributor_employer,
              tx.contributor_occupation,
              tx.amount,
              tx.contribution_receipt_date
            )
          );

          await env.DONOR_DB.batch(statements);
          meter.spent += estimateRowWrites({ transactions: batch.length });
        }

        log(`  💾 Wrote ${d1Inserts.length} transactions to D1 (${batches.length} batches)`);
      } catch (error) {
        log(`  ⚠️ D1 write failed: ${error.message}`);
      }
    }

    // Update pagination cursor
    if (data.pagination?.last_indexes) {
      progress.lastIndex = data.pagination.last_indexes.last_index;
      progress.lastContributionReceiptDate =
        data.pagination.last_indexes.last_contribution_receipt_date;
    }

    const pageTime = Date.now() - pageStartTime;
    log(`  📄 Page ${pagesProcessed + 1}: ${transactions.length} transactions in ${pageTime}ms`);

    pagesProcessed++;

    // Rate limit safety: small delay between requests
    await sleep(100);
  }

  const totalFetchTime = Date.now() - fetchStartTime;
  log(`  ⏱️ Fetched ${pagesProcessed} API calls in ${Math.round(totalFetchTime / 1000)}s`);

  // Update progress
  progress.runsCompleted++;
  progress.lastUpdated = new Date().toISOString();

  // Check if complete
  // A run halted by the write budget is paused, not finished: `reachedEnd`
  // can only be true if we actually paged to the end of the FEC results.
  const isComplete = reachedEnd && !budgetStopped;

  if (isComplete) {
    log(`  🎉 Collection complete! Calculating final metrics...`);

    // Validate row count. FEC's pagination.count includes memo/committee
    // rows, so compare against rawRowCount (every row seen), not the
    // countable-individual total.
    const collectedRows = progress.rawRowCount ?? progress.totalTransactions;
    if (progress.fecTotalCount && collectedRows !== progress.fecTotalCount) {
      log(`  ⚠️ WARNING: Row count mismatch!`);
      log(`     FEC reported: ${progress.fecTotalCount} rows`);
      log(`     We collected: ${collectedRows} rows`);
      log(`     Missing: ${progress.fecTotalCount - collectedRows} rows`);
    } else if (progress.fecTotalCount) {
      log(`  ✅ Row count validated: ${collectedRows} matches FEC total`);
    }

    // Calculate final metrics from aggregates
    const analysis = calculateMetricsFromAggregates(progress, log);

    // Reconcile with FEC totals
    await reconcileWithFEC(progress.committeeIds, cycle, analysis, apiKey, log);

    // FARA cross-reference (issue #34): donations from employees of firms
    // registered as foreign agents. fara_employer_matches maps exact
    // contributor_employer strings to DOJ FARA registrants (loaded from
    // efile.fara.gov; refresh documented in DATABASE_REFERENCE).
    if (env.DONOR_DB) {
      try {
        const fara = await env.DONOR_DB.prepare(
          `SELECT m.fara_firm, m.registration_number, ROUND(SUM(t.amount), 2) AS total, COUNT(*) AS donations
           FROM itemized_transactions t
           JOIN fara_employer_matches m ON t.contributor_employer = m.employer
           WHERE t.bioguide_id = ? AND t.cycle = ?
           GROUP BY m.registration_number
           ORDER BY total DESC LIMIT 8`
        )
          .bind(bioguideId, cycle)
          .all();

        const firms = fara.results || [];
        analysis.faraFirms = firms.map(f => ({
          name: f.fara_firm,
          registrationNumber: f.registration_number,
          amount: f.total,
          donations: f.donations,
        }));
        analysis.faraEmployerTotal =
          Math.round(firms.reduce((s, f) => s + (f.total || 0), 0) * 100) / 100;
        if (analysis.faraEmployerTotal > 0) {
          log(
            `  🌐 FARA: $${Math.round(analysis.faraEmployerTotal).toLocaleString()} from employees of ${firms.length} registered foreign-agent firms`
          );
        }
      } catch (error) {
        log(`  ⚠️ FARA cross-reference failed (continuing): ${error.message}`);
      }
    }

    // Clear superseded rows now that the replacement data is collected and
    // in memory - never before (2026-09-05). Two scoped deletes:
    //
    //   1. Legacy transactions with no sub_id. Those cannot be deduplicated
    //      by INSERT OR IGNORE, so leaving them alongside a fresh collection
    //      would double-count the member (the January 2026 inflation). For
    //      the 442 members already holding sub_ids this matches nothing and
    //      costs nothing, and it extinguishes itself once the remaining 17
    //      have refreshed.
    //   2. This member's donor aggregates, which are fully rewritten below.
    if (env.DONOR_DB) {
      try {
        // INDEXED BY is not optional: without it SQLite picks idx_sub_id and
        // scans every NULL entry in the table (382,016 of them) for each
        // member, which would re-blow the read cap. Forcing idx_bioguide
        // reads only this member's rows. Verified with EXPLAIN QUERY PLAN.
        //
        // The same scan also removes this member's rows from any OTHER
        // committee. Those are another person's transactions, left behind when
        // a member's FEC identity was corrected (issue #41); the FARA join
        // selects by bioguide_id, so leaving them would keep matching the
        // wrong person's donors to this member. One statement, one scan.
        const placeholders = progress.committeeIds.map(() => '?').join(', ');
        const delSuperseded = await env.DONOR_DB.prepare(
          `DELETE FROM itemized_transactions INDEXED BY idx_bioguide WHERE bioguide_id = ? AND cycle = ? AND (sub_id IS NULL OR committee_id NOT IN (${placeholders}))`
        )
          .bind(bioguideId, cycle, ...progress.committeeIds)
          .run();
        const removed = delSuperseded.meta?.changes ?? 0;
        meter.spent += estimateRowWrites({ transactionDeletes: removed });
        if (removed > 0) {
          log(`  🗑️ Cleared ${removed} superseded transactions (legacy or other committee)`);
        }
      } catch (error) {
        log(`  ⚠️ D1 cleanup failed (continuing): ${error.message}`);
      }
    }

    // donor_aggregates is no longer written (2026-09-26). Nothing in the
    // system ever read it - the per-donor totals the grade uses live in the
    // KV analysis - so it cost roughly a third of the D1 write budget for
    // nothing, and reserving budget for it stalled the queue (see the
    // completion reserve above). If it is ever wanted, it can be rebuilt from
    // itemized_transactions with a GROUP BY, as done in July 2026.
    if (env.DONOR_DB) {
      // Collection metadata gets its own try/catch so a D1 failure here is
      // logged without failing the completion
      try {
        await env.DONOR_DB.prepare(
          `INSERT OR REPLACE INTO collection_metadata
           (bioguide_id, committee_id, cycle, status, total_transactions, unique_donors, total_amount,
            fec_reported_total, fec_transaction_count, reconciliation_diff_percent, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            bioguideId,
            progress.committeeId,
            cycle,
            'complete',
            analysis.totalTransactions,
            analysis.uniqueDonors,
            analysis.totalAmount,
            analysis.fecReconciliation?.fecReportedTotal || null,
            progress.fecTotalCount || null,
            analysis.fecReconciliation?.percentDifference || null,
            progress.startedAt,
            new Date().toISOString()
          )
          .run();
        meter.spent += estimateRowWrites({ metadataReplaces: 1 });

        log(`  ✅ D1 collection metadata written`);
      } catch (error) {
        log(`  ⚠️ D1 metadata write failed: ${error.message}`);
      }
    }

    // Store final analysis in KV (2 KB, fast lookups)
    await env.MEMBER_DATA.put(analysisKey, JSON.stringify(analysis));

    // **KEY CHANGE: Delete progress to save storage (cleanup temp data)**
    await env.MEMBER_DATA.delete(progressKey);
    log(
      `  🗑️ Cleaned up progress data (saved ${Math.round(JSON.stringify(progress).length / 1024)} KB)`
    );

    return {
      complete: true,
      committeeId: progress.committeeId,
      totalTransactions: analysis.totalTransactions,
      uniqueDonors: analysis.uniqueDonors,
      totalAmount: analysis.totalAmount,
      avgDonation: analysis.avgDonation,
      medianDonation: analysis.medianDonation,
      top10Concentration: analysis.top10Concentration,
      pagesProcessedThisRun: pagesProcessed,
      runsCompleted: progress.runsCompleted,
    };
  } else {
    // Save updated aggregates (NOT raw transactions)
    await env.MEMBER_DATA.put(progressKey, JSON.stringify(progress));
    log(
      `  💾 Saved progress: ${Object.keys(progress.donorTotals).length} unique donors, ${progress.allAmounts.length} amounts`
    );

    return {
      complete: false,
      totalTransactions: progress.totalTransactions,
      uniqueDonors: Object.keys(progress.donorTotals).length,
      totalAmount: progress.totalAmount,
      pagesProcessedThisRun: pagesProcessed,
      runsCompleted: progress.runsCompleted,
    };
  }
}

function calculateMetricsFromAggregates(progress, log) {
  const donorTotals = progress.donorTotals;
  const allAmounts = progress.allAmounts;

  log(
    `  📊 Analyzing ${Object.keys(donorTotals).length} unique donors, ${allAmounts.length} transactions...`
  );

  // Sort donor totals for top-N calculation
  const sortedDonors = Object.entries(donorTotals)
    .map(([key, amount]) => {
      const [firstName, lastName, state, zip] = key.split('|');
      return { key, amount, firstName, lastName, state, zip };
    })
    .sort((a, b) => b.amount - a.amount);

  const top10 = sortedDonors.slice(0, 10);
  const top10Total = top10.reduce((sum, d) => sum + d.amount, 0);

  // Calculate median from all amounts
  allAmounts.sort((a, b) => a - b);
  const mid = Math.floor(allAmounts.length / 2);
  const median =
    allAmounts.length % 2 === 0 ? (allAmounts[mid - 1] + allAmounts[mid]) / 2 : allAmounts[mid];

  // Calculate total from donor aggregates (not transaction total)
  const totalDonorAmount = sortedDonors.reduce((sum, d) => sum + d.amount, 0);

  // OLIGARCHIC CAPTURE METRICS
  // Replace Gini/HHI with metrics that measure leverage and coordination risk

  // 1. Whale Weight (Top 1% Concentration Ratio)
  // Measures: Raw power of elite donor class
  // Interpretation: % of funding controlled by richest 1% of donors
  const top1PercentCount = Math.max(1, Math.ceil(sortedDonors.length * 0.01));
  const top1PercentDonors = sortedDonors.slice(0, top1PercentCount);
  const whaleWeight = top1PercentDonors.reduce((sum, d) => sum + d.amount, 0) / totalDonorAmount;

  // 2. Nakamoto Coefficient (50% Coordination Threshold)
  // Measures: Number of donors needed to coordinate to threaten 50% of funding
  // Interpretation: Lower = easier to organize coercion (small group can coordinate vs impossible)
  let nakamotoRunningTotal = 0;
  let nakamotoCoefficient = 0;
  const halfTotal = totalDonorAmount * 0.5;
  for (const donor of sortedDonors) {
    nakamotoRunningTotal += donor.amount;
    nakamotoCoefficient++;
    if (nakamotoRunningTotal >= halfTotal) {
      break;
    }
  }

  const analysis = {
    bioguideId: progress.bioguideId,
    committeeId: progress.committeeId,
    // #32: the committees whose donors are pooled here, and the discovery
    // result they came from (disclosure + person-level grade basis)
    committeeIds: progress.committeeIds || [progress.committeeId],
    committeeSignature: progress.committeeSignature || progress.committeeId,
    personLevel: Boolean(progress.personFunding),
    personFunding: progress.personFunding || null,
    cycle: progress.cycle,
    uniqueDonors: sortedDonors.length,
    totalTransactions: progress.totalTransactions,
    totalAmount: progress.totalAmount,
    avgDonation: progress.totalAmount / allAmounts.length,
    medianDonation: median,
    minDonation: allAmounts[0] || 0,
    maxDonation: allAmounts[allAmounts.length - 1] || 0,
    top10Concentration: top10Total / progress.totalAmount,
    whaleWeight: whaleWeight,
    nakamotoCoefficient: nakamotoCoefficient,
    // Network attribution (issue #33): conduit lumps from memo rows and the
    // portion of individual money that arrived pre-bundled
    conduits: topConduits(progress.conduitTotals || {}, 10),
    earmarkedTotal: Math.round((progress.earmarkedTotal || 0) * 100) / 100,
    earmarkedCount: progress.earmarkedCount || 0,
    topDonors: top10.map(d => ({
      name: `${d.firstName} ${d.lastName}`.trim(),
      state: d.state,
      zip: d.zip,
      amount: d.amount,
    })),
    collectionCompletedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  log(`  ✅ Analysis complete:`);
  log(`     Unique donors: ${analysis.uniqueDonors}`);
  log(`     Avg donation: $${analysis.avgDonation.toFixed(2)}`);
  log(`     Median donation: $${analysis.medianDonation}`);
  log(`     Top-10 concentration: ${(analysis.top10Concentration * 100).toFixed(2)}%`);
  log(`     Whale Weight (top 1%): ${(analysis.whaleWeight * 100).toFixed(2)}%`);
  log(
    `     Nakamoto Coefficient: ${analysis.nakamotoCoefficient} donors (${analysis.nakamotoCoefficient < 100 ? 'HIGH CAPTURE RISK' : analysis.nakamotoCoefficient < 1000 ? 'moderate risk' : 'low risk'})`
  );

  return analysis;
}

// Our collected itemized total vs the FEC's, summed over every committee in
// the member's donor pool.
async function reconcileWithFEC(committeeIds, cycle, analysis, apiKey, log) {
  log(`  🔍 Fetching FEC financial totals for reconciliation...`);

  try {
    let fecItemizedSum = 0;
    let found = 0;
    for (const committeeId of committeeIds) {
      const res = await fetch(
        `https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${apiKey}&cycle=${cycle}`,
        { headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' } }
      );
      if (res.ok) {
        const t = (await res.json()).results?.[0];
        if (t) {
          fecItemizedSum += t.individual_itemized_contributions || 0;
          found++;
        }
      }
    }

    if (found > 0) {
      {
        const fecItemizedTotal = fecItemizedSum;
        const ourCalculatedTotal = analysis.totalAmount;
        const difference = Math.abs(fecItemizedTotal - ourCalculatedTotal);
        const percentDiff = fecItemizedTotal > 0 ? (difference / fecItemizedTotal) * 100 : 0;

        log(`  📊 FEC Reconciliation:`);
        log(
          `     FEC reported itemized total: $${fecItemizedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        log(
          `     Our calculated total:        $${ourCalculatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        );
        log(
          `     Difference:                  $${difference.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${percentDiff.toFixed(2)}%)`
        );

        if (percentDiff > 1) {
          log(
            `  ⚠️ WARNING: Totals differ by more than 1%! May indicate joint fundraising or data quality issue.`
          );
        } else {
          log(`  ✅ Totals match within 1% tolerance`);
        }

        // Store reconciliation info
        analysis.fecReconciliation = {
          fecReportedTotal: fecItemizedTotal,
          ourCalculatedTotal,
          difference,
          percentDifference: percentDiff,
        };
      }
    }
  } catch (error) {
    log(`  ⚠️ Could not fetch FEC totals for reconciliation: ${error.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
