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

import { STATE_ABBREVIATIONS } from './shared-constants.js';
import { cycleForYear } from './tier-calculation.js';
import { classifyScheduleARow, normalizeConduitName, topConduits } from './schedule-a-classify.js';

const PAGES_PER_RUN = 5; // 5 pages × 2.5s = 12.5s + overhead, fits in 30s wall-clock limit

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/analyze') {
      return analyzeMembers(env);
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

    try {
      const result = await analyzeMembers(env);
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

async function getStatus(env) {
  // Get queue status
  const queueData = await env.MEMBER_DATA.get('itemized_processing_queue');
  const queue = queueData ? JSON.parse(queueData) : [];

  // Count total members (537) and completed
  const totalMembers = 537;
  const remainingInQueue = queue.length;
  const completedCount = totalMembers - remainingInQueue;
  const percentComplete = ((completedCount / totalMembers) * 100).toFixed(1);

  // Estimate completion time (20 min per member)
  const estimatedHours = (remainingInQueue * 20) / 60;
  const estimatedDays = (estimatedHours / 24).toFixed(1);

  // Get next member to process
  const nextMember = queue[0] || null;

  // Find recently completed members (scan for itemized_analysis_v2:* keys)
  // For simplicity, just show Bernie and Pelosi as examples
  const recentlyCompleted = [
    { bioguideId: 'S000033', name: 'Sanders, Bernard' },
    { bioguideId: 'P000197', name: 'Pelosi, Nancy' },
  ];

  const status = {
    queueStatus: {
      totalMembers,
      completedCount,
      remainingInQueue,
      percentComplete: parseFloat(percentComplete),
      nextMember,
    },
    estimatedCompletion: {
      hoursRemaining: Math.round(estimatedHours),
      daysRemaining: parseFloat(estimatedDays),
      completionDate: new Date(Date.now() + estimatedHours * 60 * 60 * 1000).toISOString(),
    },
    recentlyCompleted,
    lastUpdated: new Date().toISOString(),
  };

  return new Response(JSON.stringify(status, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function analyzeMembers(env) {
  const startTime = Date.now();
  const results = {};
  const executionLog = [];

  const log = msg => {
    console.log(msg);
    executionLog.push(`${new Date().toISOString()} - ${msg}`);
  };

  log('🚀 Starting free-tier itemized analysis chunk');
  log(`⏰ Start time: ${new Date().toISOString()}`);
  log(`📦 Pages per run: ${PAGES_PER_RUN} (50 subrequest limit)`);

  // Get processing queue from KV
  const queueKey = 'itemized_processing_queue';
  const queueData = await env.MEMBER_DATA.get(queueKey);

  if (!queueData) {
    log('✅ No processing queue found - all members complete or queue not initialized');
    return new Response(
      JSON.stringify(
        {
          allComplete: true,
          message: 'No processing queue found',
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

  const queue = JSON.parse(queueData);
  log(`📋 Processing queue: ${queue.length} members remaining`);

  if (queue.length === 0) {
    log('✅ Queue is empty - all members processed');
    await env.MEMBER_DATA.delete(queueKey);
    return new Response(
      JSON.stringify(
        {
          allComplete: true,
          message: 'All members processed successfully',
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

  // Process only the first member from queue (stay within resource limits)
  const members = [queue[0]];

  let totalPagesProcessed = 0;

  for (const member of members) {
    log(`\n📊 Processing ${member.name} (${member.bioguideId})`);
    const memberStartTime = Date.now();

    try {
      const result = await fetchAndAggregateChunk(member.bioguideId, env, log);
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
    if (totalPagesProcessed >= PAGES_PER_RUN) {
      log(`\n⚠️ Reached page limit (${totalPagesProcessed} pages processed), stopping this run`);
      break;
    }
  }

  const totalTime = Date.now() - startTime;
  log(`\n🏁 Chunk complete: ${totalTime}ms (${Math.round(totalTime / 1000)}s)`);
  log(`📄 Pages processed this run: ${totalPagesProcessed}`);

  // Update queue - remove completed member, defer failed member, or keep in-progress member
  const member = members[0];
  const analysisKey = `itemized_analysis_v2:${member.bioguideId}`;
  const analysisData = await env.MEMBER_DATA.get(analysisKey);

  if (analysisData) {
    // Member is complete, remove from queue
    queue.shift();
    await env.MEMBER_DATA.put(queueKey, JSON.stringify(queue));
    log(`✅ ${member.name} complete and removed from queue. ${queue.length} members remaining.`);
  } else if (results[member.bioguideId]?.success === false) {
    // Member failed (e.g. no FEC committee found yet) - defer to end so queue can advance
    queue.shift();
    queue.push(member);
    await env.MEMBER_DATA.put(queueKey, JSON.stringify(queue));
    log(`⏭️ ${member.name} deferred to end of queue: ${results[member.bioguideId]?.error}`);
  } else {
    // Still in progress (multi-run member), keep at front
    await env.MEMBER_DATA.put(queueKey, JSON.stringify(queue));
    log(`⏸️ ${member.name} still in progress, keeping in queue`);
  }

  // Check overall status
  const allComplete = queue.length === 0;

  return new Response(
    JSON.stringify(
      {
        allComplete,
        results,
        queueStatus: {
          remainingMembers: queue.length,
          currentMember: member.name,
          currentMemberComplete: !!analysisData,
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

async function fetchAndAggregateChunk(bioguideId, env, log) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';
  const progressKey = `itemized_progress_v2:${bioguideId}`;
  const analysisKey = `itemized_analysis_v2:${bioguideId}`;

  // Check if already complete
  const existingAnalysis = await env.MEMBER_DATA.get(analysisKey);
  if (existingAnalysis) {
    const analysis = JSON.parse(existingAnalysis);
    log(`  ✅ Already complete`);
    return {
      complete: true,
      totalTransactions: analysis.totalTransactions,
      uniqueDonors: analysis.uniqueDonors,
      pagesProcessedThisRun: 0,
    };
  }

  // Check for existing progress
  const existingProgressData = await env.MEMBER_DATA.get(progressKey);
  let progress;

  if (existingProgressData) {
    progress = JSON.parse(existingProgressData);

    // Initialize fields that may not exist in old progress data
    if (!progress.donorTotals) {
      progress.donorTotals = {};
    }
    if (!progress.allAmounts) {
      progress.allAmounts = [];
    }
    if (progress.totalAmount === undefined || progress.totalAmount === null) {
      progress.totalAmount = 0;
    }
    if (!progress.runsCompleted) {
      progress.runsCompleted = 0;
    }
    if (!progress.conduitTotals) {
      progress.conduitTotals = {};
    }
    if (progress.earmarkedTotal === undefined) {
      progress.earmarkedTotal = 0;
      progress.earmarkedCount = 0;
    }

    log(`  📂 Resuming: ${progress.totalTransactions || 0} transactions aggregated so far`);
    log(`  👥 Current unique donors: ${Object.keys(progress.donorTotals).length}`);
  } else {
    // Starting fresh - need to get committee ID
    // Fetch member info dynamically from members:all dataset
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) {
      throw new Error('Members dataset not found in KV');
    }

    const members = JSON.parse(membersData);
    const memberRecord = members.find(m => m.bioguideId === bioguideId);

    if (!memberRecord) {
      throw new Error(`Member not found in dataset: ${bioguideId}`);
    }

    // Extract member info for FEC API search
    const lastName = memberRecord.name.split(',')[0].trim(); // "Heinrich, Martin" → "Heinrich"
    const office = memberRecord.chamber === 'Senate' ? 'S' : 'H';
    const stateAbbr = STATE_ABBREVIATIONS[memberRecord.state] || memberRecord.state;

    const info = {
      name: lastName,
      office: office,
      state: stateAbbr,
    };

    log(`  🔍 Searching FEC for ${info.name} (${info.office}-${info.state})...`);
    const committeeId = await searchCommitteeId(info.name, info.office, info.state, apiKey);

    if (!committeeId) {
      throw new Error(`No committee found for ${info.name}`);
    }

    log(`  💼 Committee ID: ${committeeId}`);

    const currentYear = new Date().getFullYear();
    const cycle = cycleForYear(currentYear);
    log(`  📅 Election cycle: ${cycle}`);

    progress = {
      bioguideId,
      committeeId,
      cycle,
      totalTransactions: 0,
      totalAmount: 0,
      rawRowCount: 0, // every fetched row incl. memos - compared to FEC's pagination count
      runsCompleted: 0,
      lastIndex: null,
      lastContributionReceiptDate: null,
      donorTotals: {}, // Map: "FIRST|LAST|STATE|ZIP" → total amount
      allAmounts: [], // Array of all amounts for median calculation
      conduitTotals: {}, // Map: normalized conduit name → { amount, count }
      earmarkedTotal: 0, // individual money that arrived pre-bundled via a conduit
      earmarkedCount: 0,
      startedAt: new Date().toISOString(),
    };
  }

  const committeeId = progress.committeeId;
  const cycle = progress.cycle;

  // Fetch transactions using cursor-based pagination
  const perPage = 100;
  const maxPagesToFetch = PAGES_PER_RUN;

  log(`  📥 Fetching Schedule A transactions (up to ${maxPagesToFetch} API calls)...`);

  const fetchStartTime = Date.now();
  let pagesProcessed = 0;
  let reachedEnd = false;

  while (pagesProcessed < maxPagesToFetch) {
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
      log(`  ✅ No more transactions (API returned empty results)`);
      reachedEnd = true;
      break;
    }

    // Store FEC's total count for validation (first page only)
    if (pagesProcessed === 0 && data.pagination?.count && !progress.fecTotalCount) {
      progress.fecTotalCount = data.pagination.count;
      log(`  📊 FEC reports ${progress.fecTotalCount} total transactions`);
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
      const zip = (tx.contributor_zip || '').trim();
      const compositeKey = `${firstName}|${lastName}|${state}|${zip}`;

      // Aggregate by donor (running total per unique donor)
      progress.donorTotals[compositeKey] =
        (progress.donorTotals[compositeKey] || 0) + tx.contribution_receipt_amount;

      // Track all amounts for median calculation
      progress.allAmounts.push(tx.contribution_receipt_amount);

      // Running totals
      progress.totalTransactions++;
      progress.totalAmount += tx.contribution_receipt_amount;

      // Prepare D1 insert for raw transaction
      d1Inserts.push({
        bioguide_id: bioguideId,
        committee_id: committeeId,
        cycle: cycle,
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
          const statements = batch.map(tx =>
            env.DONOR_DB.prepare(
              `INSERT INTO itemized_transactions
               (bioguide_id, committee_id, cycle, contributor_first_name, contributor_last_name,
                contributor_state, contributor_zip, contributor_employer, contributor_occupation,
                amount, contribution_receipt_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              tx.bioguide_id,
              tx.committee_id,
              tx.cycle,
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
  const isComplete = reachedEnd;

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
    await reconcileWithFEC(committeeId, cycle, analysis, apiKey, log);

    // Write donor aggregates to D1 (for analytical queries)
    if (env.DONOR_DB) {
      try {
        log(`  💾 Writing ${Object.keys(progress.donorTotals).length} donor aggregates to D1...`);
        const donorAggregates = Object.entries(progress.donorTotals).map(([key, amount]) => {
          const [firstName, lastName, state, zip] = key.split('|');
          return { key, firstName, lastName, state, zip, amount };
        });

        // D1 has a low per-statement bound-parameter limit: one row per
        // statement, batched via the D1 batch API (same pattern as the
        // transaction insert above). The old 100-row multi-VALUES insert
        // (800 params) failed for any member with >12 donors and silently
        // took the metadata write down with it.
        const BATCH_SIZE = 100; // statements per batch call (8 params each)
        for (let i = 0; i < donorAggregates.length; i += BATCH_SIZE) {
          const batch = donorAggregates.slice(i, i + BATCH_SIZE);
          const statements = batch.map(d =>
            env.DONOR_DB.prepare(
              `INSERT OR REPLACE INTO donor_aggregates
               (bioguide_id, cycle, donor_key, first_name, last_name, state, zip, total_amount, transaction_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
            ).bind(bioguideId, cycle, d.key, d.firstName, d.lastName, d.state, d.zip, d.amount)
          );
          await env.DONOR_DB.batch(statements);
        }

        log(`  ✅ D1 donor aggregates written`);
      } catch (error) {
        log(`  ⚠️ D1 aggregate write failed: ${error.message}`);
      }

      // Collection metadata gets its own try/catch: an aggregates failure
      // must never block the completion record
      try {
        await env.DONOR_DB.prepare(
          `INSERT OR REPLACE INTO collection_metadata
           (bioguide_id, committee_id, cycle, status, total_transactions, unique_donors, total_amount,
            fec_reported_total, fec_transaction_count, reconciliation_diff_percent, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            bioguideId,
            committeeId,
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

async function reconcileWithFEC(committeeId, cycle, analysis, apiKey, log) {
  log(`  🔍 Fetching FEC financial totals for reconciliation...`);

  try {
    const fecTotalsUrl = `https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${apiKey}&cycle=${cycle}`;
    const fecTotalsResponse = await fetch(fecTotalsUrl, {
      headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' },
    });

    if (fecTotalsResponse.ok) {
      const fecTotalsData = await fecTotalsResponse.json();
      const fecTotal = fecTotalsData.results?.[0];

      if (fecTotal) {
        const fecItemizedTotal = fecTotal.individual_itemized_contributions || 0;
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

async function searchCommitteeId(name, office, state, apiKey) {
  const searchUrl = `https://api.open.fec.gov/v1/candidates/search/?api_key=${apiKey}&name=${encodeURIComponent(name)}&office=${office}&state=${state}`;

  const response = await fetch(searchUrl, {
    headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' },
  });

  if (!response.ok) {
    throw new Error(`FEC candidate search failed: ${response.status}`);
  }

  const data = await response.json();
  const candidates = data.results || [];

  if (candidates.length === 0) {
    throw new Error('No candidates found in search');
  }

  const candidate = candidates[0];
  const committees = candidate.principal_committees || [];

  if (committees.length === 0) {
    throw new Error('No principal committee found');
  }

  const currentYear = new Date().getFullYear();
  const cycle = cycleForYear(currentYear);

  const recentCommittee =
    committees.find(c => c.cycles && c.cycles.includes(cycle)) || committees[0];

  return recentCommittee.committee_id;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
