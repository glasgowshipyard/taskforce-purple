#!/usr/bin/env node
/**
 * POOLED-DONOR GRADE TRIAL (#32) - READ-ONLY. Writes nothing to KV, D1 or
 * the live site; only local files under scripts/trials/output/<bioguide>/.
 *
 * For one member it:
 *   1. finds every committee they run (same code the itemized worker uses),
 *   2. collects the itemized donors of every committee in their donor pool
 *      into one total per person (5-digit zip, as the worker does),
 *   3. checks what it collected against the FEC's own counts and totals,
 *   4. grades them three ways - live model, Step 4 fix on the campaign
 *      only, and Step 4 fix on all committees with pooled donors - and
 *   5. writes summary.md (plain English) and result.json.
 *
 * Pace: one request every 2 s, and it waits out the minutes when the live
 * workers run (:00/:01, :10/:11 ... :50/:51 UTC), because the FEC key allows
 * 60 requests per minute and is shared with them. Rate-limit and server
 * errors are retried with backoff.
 *
 * Progress is saved after every page (state.json), so if it is stopped or
 * the laptop sleeps, running the same command again resumes where it left
 * off. `--fresh` starts over.
 *
 *   npm run trial:pool -- P000197              # run (key read from API_KEYS.md)
 *   npm run trial:pool -- P000197 --estimate   # counts + time estimate, ~3-5 minutes
 *
 * Watch it:  tail -f scripts/trials/output/P000197/log.txt
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { fetchPersonFunding } from '../../workers/person-funding.js';
import { calculateEnhancedTier, CAPPED_QUADRATIC_OPTIONS } from '../../workers/tier-calculation.js';

// FEC key from the environment, else from the gitignored local API_KEYS.md
const KEY =
  process.env.FEC_KEY ||
  (() => {
    try {
      const text = readFileSync(new URL('../../API_KEYS.md', import.meta.url), 'utf8');
      const line = text.split('\n').find(l => /fec/i.test(l) && /[A-Za-z0-9]{32,48}/.test(l));
      return line?.match(/[A-Za-z0-9]{32,48}/)?.[0];
    } catch {
      return undefined;
    }
  })();
const [bioguide, ...flags] = process.argv.slice(2);
const ESTIMATE = flags.includes('--estimate');
const FRESH = flags.includes('--fresh');
const CYCLE = 2026;
const SPACING_MS = 2000;
const API = 'https://taskforce-purple-api.dev-a4b.workers.dev/api/members';

if (!KEY || !/^[A-Z]\d{6}$/.test(bioguide || '')) {
  console.error(
    'usage: npm run trial:pool -- <bioguideId> [--estimate] [--fresh]   (FEC key from env FEC_KEY or API_KEYS.md)'
  );
  process.exit(1);
}

const dir = new URL(`./output/${bioguide}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const LOG = new URL('log.txt', dir);
const STATE = new URL('state.json', dir);
const log = msg => {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
};
const usd = n => '$' + Math.round(n || 0).toLocaleString('en-US');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- polite FEC client -----------------------------------------------------
let requests = 0;
async function avoidWorkerMinutes() {
  // Live workers fire at :00, :10, :20 ... - stay clear of each of those minutes
  // and the one after
  for (;;) {
    const m = new Date().getUTCMinutes() % 10;
    if (m >= 2) {
      return;
    }
    await sleep(15000);
  }
}
async function fec(path, params = {}) {
  for (let attempt = 0; ; attempt++) {
    await avoidWorkerMinutes();
    const qs = new URLSearchParams({ api_key: KEY });
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    requests++;
    const res = await fetch(`https://api.open.fec.gov/v1${path}?${qs}`, {
      headers: { 'User-Agent': 'TaskForcePurple/1.0 trial (pool-donors)' },
    });
    await sleep(SPACING_MS);
    if (res.ok) {
      return res.json();
    }
    // 429 = our shared per-minute allowance: wait longer, try more.
    // 5xx = FEC's own server timing out: a few short retries, then give up
    // on this request (the run saves its place and can simply be re-run).
    const maxTries = res.status === 429 ? 8 : 3;
    if (attempt + 1 >= maxTries || (res.status < 500 && res.status !== 429)) {
      throw new Error(`FEC ${res.status} on ${path} (gave up after ${attempt + 1} tries)`);
    }
    const wait = res.status === 429 ? 60000 : 20000;
    log(`   FEC ${res.status} - waiting ${wait / 1000}s before retry ${attempt + 1}`);
    await sleep(wait);
  }
}

// ---- state (resumable) -----------------------------------------------------
let state = !FRESH && existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
const save = () => writeFileSync(STATE, JSON.stringify(state));

log(`=== ${bioguide}: ${state ? 'resuming' : 'starting'}${ESTIMATE ? ' (estimate only)' : ''} ===`);

if (!state) {
  log('Step 1/4: finding every committee (same code as the itemized worker)');
  const pf = await fetchPersonFunding(fec, FEC_CROSSWALK[bioguide] || [], CYCLE);
  if (!pf.invariantsHold) {
    throw new Error('attribution invariants failed - not trusting these figures');
  }
  for (const c of pf.committees) {
    log(
      `   ${c.role.padEnd(10)} ${c.committeeId} raised ${usd(c.raised)}  ${c.name}${c.role === 'joint' ? (c.ownFund ? '  [own fund]' : '  [shared]') : ''}`
    );
  }
  log(`   donor pool: ${pf.donorCommitteeIds.join(', ')}`);
  state = {
    bioguide,
    personFunding: pf,
    queue: pf.donorCommitteeIds.map(id => ({
      committeeId: id,
      cursor: null,
      done: false,
      fecCount: null,
      rows: 0,
    })),
    donors: {},
    individualRows: 0,
  };
  save();
}

// ---- estimate ---------------------------------------------------------------
log("Step 2/4: the FEC's own record count for each committee in the pool");
let totalRows = 0;
for (const q of state.queue) {
  // The FEC's own record count for the same query the collection makes
  // (100 per page). A 1-record query timed out on the FEC's side for small
  // committees, so it is not used. The count is only proof of completeness
  // when the FEC marks it exact - for big queries it may be an estimate.
  if (typeof q.fecCount !== 'number' || q.countExact !== true) {
    try {
      const d = await fec('/schedules/schedule_a/', {
        committee_id: q.committeeId,
        two_year_transaction_period: CYCLE,
        per_page: 100,
      });
      q.fecCount = d.pagination?.count ?? 0;
      q.countExact = d.pagination?.is_count_exact === true;
    } catch (error) {
      q.fecCount = 'unknown';
      q.countExact = false;
      log(`   ${q.committeeId}: FEC count request failed (${error.message})`);
    }
    save();
  }
  if (typeof q.fecCount === 'number') {
    totalRows += q.fecCount;
  }
  log(
    `   ${q.committeeId}: ${q.fecCount.toLocaleString()} records ${q.countExact ? '(exact)' : typeof q.fecCount === 'number' ? '(FEC estimate - cannot prove completeness)' : '(count unavailable)'}`
  );
}
const pagesLeft = state.queue.reduce(
  (s, q) =>
    s + (q.done || typeof q.fecCount !== 'number' ? 0 : Math.ceil((q.fecCount - q.rows) / 100)),
  0
);
// ~2 s spacing + ~1 s FEC response, plus the worker-minute pauses (2 in 10)
const minutes = Math.ceil(((pagesLeft * 3) / 60) * 1.25);
log(
  `   ${totalRows.toLocaleString()} records in total; ~${pagesLeft} requests left, roughly ${minutes} minutes`
);
if (ESTIMATE) {
  log('Estimate only - stopping here. Run without --estimate to collect.');
  process.exit(0);
}

// ---- collect ------------------------------------------------------------------
log('Step 3/4: collecting donors from every committee in the pool');
for (const q of state.queue) {
  while (!q.done) {
    const d = await fec('/schedules/schedule_a/', {
      committee_id: q.committeeId,
      two_year_transaction_period: CYCLE,
      per_page: 100,
      ...(q.cursor || {}),
    });
    const page = d.results || [];
    for (const t of page) {
      q.rows++;
      // Same rule as the itemized worker: individuals only, memo rows skipped
      if (t.memo_code === 'X' || t.entity_type !== 'IND') {
        continue;
      }
      state.individualRows++;
      const key = [t.contributor_first_name, t.contributor_last_name, t.contributor_state]
        .map(x => (x || '').toUpperCase().trim())
        .concat((t.contributor_zip || '').trim().slice(0, 5))
        .join('|');
      const e = state.donors[key] || {
        name: `${t.contributor_first_name || ''} ${t.contributor_last_name || ''}`.trim(),
        state: t.contributor_state || '',
        amount: 0,
        committees: [],
        sample: t.sub_id,
      };
      e.amount += t.contribution_receipt_amount || 0;
      if (!e.committees.includes(q.committeeId)) {
        e.committees.push(q.committeeId);
      }
      state.donors[key] = e;
    }
    const li = d.pagination?.last_indexes;
    if (!li || page.length === 0) {
      q.done = true;
    } else {
      q.cursor = { ...li };
    }
    save();
    log(
      `   ${q.committeeId}: ${q.rows.toLocaleString()} / ${q.fecCount.toLocaleString()} records, ${Object.keys(state.donors).length.toLocaleString()} donors so far, ${requests} requests this run`
    );
  }
}

// ---- check + grade ------------------------------------------------------------
log('Step 4/4: checking against the FEC and grading');
const checks = [];
for (const q of state.queue) {
  const t = (await fec(`/committee/${q.committeeId}/totals/`, { cycle: CYCLE })).results?.[0] || {};
  checks.push({
    committeeId: q.committeeId,
    recordsCollected: q.rows,
    fecRecordCount: q.fecCount,
    countExact: q.countExact === true,
    fecItemizedIndividuals: t.individual_itemized_contributions || 0,
  });
}
const donors = Object.values(state.donors).sort((a, b) => b.amount - a.amount);
const pooledTotal = donors.reduce((s, d) => s + d.amount, 0);
let run = 0;
let nakamoto = 0;
for (const d of donors) {
  run += d.amount;
  nakamoto++;
  if (run >= pooledTotal / 2) {
    break;
  }
}
const fecItemizedSum = checks.reduce((s, c) => s + c.fecItemizedIndividuals, 0);
// Complete = every committee's collected records equal the FEC's count AND
// the FEC marks that count exact (an estimate proves nothing)
const recordsMatch = checks.every(c => c.countExact && c.recordsCollected === c.fecRecordCount);
const itemizedDiff =
  fecItemizedSum > 0 ? Math.abs(pooledTotal - fecItemizedSum) / fecItemizedSum : 1;
const trustworthy = recordsMatch && itemizedDiff <= 0.05;

const members = (await (await fetch(API)).json()).members;
const member = members.find(m => m.bioguideId === bioguide);
const pf = state.personFunding;
const campaignConc =
  member?.nakamotoCoefficient != null
    ? {
        nakamotoCoefficient: member.nakamotoCoefficient,
        uniqueDonors: member.uniqueDonors,
        totalAmount: member.largeDonorDonations,
      }
    : null;
const personMember = {
  ...member,
  totalRaised: pf.totalRaised,
  grassrootsDonations: pf.grassrootsDonations,
  largeDonorDonations: pf.largeDonorDonations,
  pacMoney: pf.pacMoney,
  partyMoney: pf.partyMoney,
  grassrootsPercent: pf.grassrootsPercent,
};
const grades = {
  liveModelCampaignOnly: calculateEnhancedTier(member, campaignConc, CAPPED_QUADRATIC_OPTIONS),
  step4CampaignOnly: calculateEnhancedTier(member, campaignConc),
  step4AllCommitteesPooled: calculateEnhancedTier(personMember, {
    nakamotoCoefficient: nakamoto,
    uniqueDonors: donors.length,
    totalAmount: pooledTotal,
  }),
};

const fecLink = d =>
  d.sample
    ? `https://www.fec.gov/data/receipts/?two_year_transaction_period=${CYCLE}&contributor_name=${encodeURIComponent(d.name)}&${d.committees.map(c => `committee_id=${c}`).join('&')}`
    : '';
const md = `# Pooled-donor grade trial: ${member?.name || bioguide}

Generated ${new Date().toISOString()} by \`scripts/trials/pool-donors.mjs\`. Read-only; nothing live was changed.

## Can these figures be trusted?

**${trustworthy ? 'Yes' : 'NO - do not rely on the grade below'}.**
${checks.map(c => `- ${c.committeeId}: collected ${c.recordsCollected.toLocaleString()} records, FEC reports ${c.fecRecordCount.toLocaleString()} ${!c.countExact ? '(FEC count is an estimate - NOT VERIFIED)' : c.recordsCollected === c.fecRecordCount ? '(exact match)' : '(MISMATCH)'}`).join('\n')}
- Itemized money from individuals: we collected ${usd(pooledTotal)}; the FEC's totals for these committees say ${usd(fecItemizedSum)} (${(itemizedDiff * 100).toFixed(1)}% apart; must be within 5%)

## Grade

| Model | Tier | Score |
|---|---|---|
| Live today (July model, campaign committee only) | ${grades.liveModelCampaignOnly.tier} | ${grades.liveModelCampaignOnly.individualFundingPercent} |
| Step 4 fix, campaign committee only | ${grades.step4CampaignOnly.tier} | ${grades.step4CampaignOnly.individualFundingPercent} |
| **Step 4 fix, all committees, donors pooled** | **${grades.step4AllCommitteesPooled.tier}** | **${grades.step4AllCommitteesPooled.individualFundingPercent}** |

Pooled donors: ${donors.length.toLocaleString()} people across ${state.queue.length} committees gave ${usd(pooledTotal)} in itemized donations. **${nakamoto} of them supplied half of it.**

## Largest donors across all their committees

Each person's gifts added together. Links open the FEC's own records.

${donors
  .slice(0, 15)
  .map(
    (d, i) =>
      `${i + 1}. ${usd(d.amount)} - ${d.name} (${d.state}) - ${d.committees.join(', ')} - [FEC records](${fecLink(d)})`
  )
  .join('\n')}

## Committees

${pf.committees.map(c => `- ${c.name} (${c.committeeId}), ${c.role}: raised ${usd(c.raised)}${c.role === 'joint' ? `, sent to member ${usd(c.toMember)}, passed on ${usd(c.passedElsewhere)}, ${c.ownFund ? 'own fund' : 'shared'}` : ''}`).join('\n')}

${requests} FEC requests this run.
`;
writeFileSync(new URL('summary.md', dir), md);
writeFileSync(
  new URL('result.json', dir),
  JSON.stringify(
    {
      checks,
      trustworthy,
      grades,
      nakamoto,
      uniqueDonors: donors.length,
      pooledTotal,
      topDonors: donors.slice(0, 50),
      personFunding: pf,
    },
    null,
    2
  )
);
log(
  `DONE. ${trustworthy ? 'Figures check out.' : 'Figures DO NOT check out - see summary.'} Result: scripts/trials/output/${bioguide}/summary.md`
);
