#!/usr/bin/env node
/**
 * The refresh job (REBUILD_SPEC.md §5). Stage 2: computes and records
 * results; publishes nothing (Stage 3 does).
 *
 *   node scripts/refresh/run.mjs [--members ID,ID] [--cycle 2026] [--dry-run]
 *     [--bulk-dir DIR] [--trigger manual|calendar|event] [--new-round REASON]
 *     [--budget-minutes 300] [--batch 25] [--grade-only] [--discovery zips|api]
 *     [--report FILE]
 *
 * PAC money (#57, version A, owner 2026-10-09): the grade reads every PAC
 * gift to the member's campaign and leadership PAC from the bulk files, and
 * counts half of each PAC's people-funded money as people money, traced one
 * level deeper (tier-calculation.js PAC_TRACING). With --discovery api there
 * is no bulk PAC list, and the grade falls back to the record's stored one.
 * --report FILE  writes every member's grade (published now; this run's) and
 *                the PAC settings still being chosen (lib/pac-sim.mjs) as
 *                JSON, with a summary: the simulation the settled decisions
 *                require before any grading change is published.
 *
 * Two modes (owner, 2026-10-04: grade first, confirm after):
 *   --grade-only  grades every member from the FEC's bulk files, with no
 *                 record-by-record check: minutes, and almost no FEC calls.
 *                 Committees already checked count as checked; the rest are
 *                 marked unchecked and the grade is provisional.
 *   (default)     the check: reconciles every committee's records with the
 *                 FEC's, fills what the bulk file lacks, and confirms or
 *                 shifts the grade. Hours for a whole pass at our key's 120
 *                 FEC calls a minute (days at the standard 1,000 an hour).
 *
 * Discovery (each member's committees and money) comes from the FEC's bulk
 * files by default (lib/discovery.mjs); --discovery api uses the per-member
 * API calls of workers/person-funding.js instead.
 *
 * Rounds: one round is one full pass over Congress. The FEC allows 1,000
 * calls an hour, so a first pass takes several runs: each run continues the
 * open round, skips members already done in it, works in batches, and stops
 * cleanly when its time budget is spent. A committee shared by several
 * members (a joint fund) is reconciled once per round; later runs reload its
 * gap records from D1 instead of fetching them again.
 *
 * Credentials: FEC_API_KEY and CLOUDFLARE_API_TOKEN from the environment (the
 * GitHub Actions secrets). Run locally, the FEC key falls back to API_KEYS.md
 * and Cloudflare to the wrangler login. Nothing secret is ever printed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { crosswalkIdsFor } from '../../workers/fec-identity.js';
import { gradeMember } from '../../workers/grading.js';
import { LIST_KEY, memberKey } from '../../workers/member-store.js';
import { fetchPersonFunding } from '../../workers/person-funding.js';
import {
  classifyScheduleARow,
  countsAsItemizedIndividual,
} from '../../workers/schedule-a-classify.js';
import {
  cycleForYear,
  pacPeopleCredit,
  tracePacs,
} from '../../workers/tier-calculation.js';
import { analyzePool, loadFara } from './lib/analysis.mjs';
import { ensureFara } from './lib/fara.mjs';
import { PRODUCTION_VARIANT, VARIANTS, gradeVariants, untraced } from './lib/pac-sim.mjs';
import {
  asPacContributions,
  pacGifts,
  pacProfiles,
  pacSummary,
  upstreamGifts,
} from './lib/pacs.mjs';
import { discoverPeople, loadDiscoveryFiles } from './lib/discovery.mjs';
import { apiRowToBulkShape, ensureBulkFile, insertApiRows, loadBulk } from './lib/bulk.mjs';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { TimeBudgetError, reconcileCommittee } from './lib/committee.mjs';
import { createFecClient } from './lib/fec.mjs';
import { loadStored, saveStored } from './lib/gap-store.mjs';
import { publishGrades } from './lib/publish.mjs';

// D1's free limits are per day for the whole account, shared with the
// owner's other projects: 100k rows written and 5M rows read. The job stops
// well short of both. (2026-10-05: an unindexed lookup read 18.8M rows and
// D1 refused every read on the account for the rest of the day.)
const D1_DAILY_CAP = 85000;
const D1_READ_CAP = 3000000;
const chargeLedger = (d1, day, written, read) =>
  d1(
    `INSERT INTO d1_write_budget (day, rows_written, rows_read) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written,
       rows_read = rows_read + excluded.rows_read`,
    [day, written, read]
  );
const SETTLED = new Set(['reconciled', 'reconciled-with-note', 'mismatch']);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const now = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const countsApi = r => countsAsItemizedIndividual(classifyScheduleARow(r));

function fecKey() {
  if (process.env.FEC_API_KEY) {
    return process.env.FEC_API_KEY;
  }
  const local = new URL('../../API_KEYS.md', import.meta.url).pathname;
  return existsSync(local) ? readFileSync(local, 'utf8').match(/`([A-Za-z0-9]{40})`/)?.[1] : null;
}

// Grades best first, for "up" and "down" in the report; withheld grades last
const gradeRank = t => ({ S: 8, A: 7, B: 6, C: 5, D: 4, E: 3, F: 2, 'N/A': 1 })[t] ?? 0;

// Set once the run is recorded: on a crash, marks it failed and charges the
// D1 rows already written, so health sees the failure and the ledger is right
let recordCrash = null;

async function main() {
  const started = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  const gradeOnly = process.argv.includes('--grade-only');
  const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
  const only = arg('--members', '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const bulkDir = arg('--bulk-dir', join(tmpdir(), 'tfp-bulk'));
  const budgetMs = Number(arg('--budget-minutes', 300)) * 60000;
  const batchSize = Number(arg('--batch', 25));
  const reportPath = arg('--report', null);
  const report = [];
  mkdirSync(bulkDir, { recursive: true });

  const cf = createCloudflare();
  const fec = createFecClient(fecKey());
  const runId = `${now()}-${Math.random().toString(36).slice(2, 6)}`;
  const today = now().slice(0, 10);
  const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);

  // D1 budget: stop before the job's cap
  const [ledger] = await d1('SELECT rows_written, rows_read FROM d1_write_budget WHERE day = ?', [
    today,
  ]);
  if ((ledger?.rows_written || 0) > D1_DAILY_CAP - 20000) {
    throw new Error(`D1 budget: ${ledger.rows_written} rows written today; not starting`);
  }
  if ((ledger?.rows_read || 0) > D1_READ_CAP - 500000) {
    throw new Error(`D1 budget: ${ledger.rows_read} rows read today; not starting`);
  }

  // The round this run belongs to (a grade-only run belongs to none)
  let roundId = dryRun ? 'dry-run' : gradeOnly ? 'grade-only' : null;
  if (!dryRun) {
    const reason = arg('--new-round', null);
    const [open] = await d1(
      'SELECT round_id FROM rounds WHERE cycle = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1',
      [cycle]
    );
    if (gradeOnly) {
      // no round
    } else if (open && !reason) {
      roundId = open.round_id;
    } else {
      roundId = `round-${now()}`;
      await d1('INSERT INTO rounds (round_id, cycle, started_at, reason) VALUES (?,?,?,?)', [
        roundId,
        cycle,
        now(),
        reason || 'first run',
      ]);
    }
    await d1(
      'INSERT INTO runs (run_id, started_at, trigger, status, round_id) VALUES (?, ?, ?, ?, ?)',
      [runId, now(), gradeOnly ? 'grade-only' : arg('--trigger', 'manual'), 'running', roundId]
    );
    recordCrash = async message => {
      await d1('UPDATE runs SET finished_at = ?, status = ?, summary = ? WHERE run_id = ?', [
        now(),
        'failed',
        JSON.stringify({ error: message, fecCalls: fec.calls }),
        runId,
      ]);
      await chargeLedger(d1, today, cf.stats.d1RowsWritten + 2, cf.stats.d1RowsRead);
    };
  }

  // Members still to do in this round
  const list = JSON.parse((await cf.kvGet(LIST_KEY)) || '{"members":[]}').members;
  let targets = only.length ? list.filter(m => only.includes(m.bioguideId)) : list;
  if (!dryRun && !gradeOnly && !only.length) {
    const done = new Set(
      (
        await d1(
          "SELECT bioguide_id FROM member_progress WHERE cycle = ? AND round_id = ? AND status = 'done'",
          [cycle, roundId]
        )
      ).map(r => r.bioguide_id)
    );
    targets = targets.filter(m => !done.has(m.bioguideId));
  }
  log(
    `run ${runId} (${roundId}): ${targets.length} member(s) to do, cycle ${cycle}${dryRun ? ' (dry run)' : ''}`
  );

  const file = ensureBulkFile(cycle, bulkDir, log);
  const fara = await d1(
    'SELECT employer, fara_firm, registration_number FROM fara_employer_matches'
  );
  // The DOJ's register: who at each firm is personally registered, and the
  // firms' foreign clients (#60). Without it, only employers are matched
  let faraFiles = null;
  try {
    faraFiles = ensureFara(bulkDir, log);
  } catch (error) {
    log(`FARA register unavailable (${error.message}): matching employers only`);
  }
  // Each member's committees and money, for every target at once
  let discovered = null;
  let db = null;
  const conduitNames = new Map();
  // Every PAC gift to each member, and each giving PAC's own donors (#57)
  const giftsFor = new Map();
  let profiles = new Map();
  let traced = new Map();
  const pacTypes = {}; // report: PAC dollars and traced people dollars by kind and organisation type
  if (arg('--discovery', 'zips') === 'zips') {
    db = await loadDiscoveryFiles(cycle, bulkDir, log);
    discovered = await discoverPeople({
      fec,
      db,
      people: targets
        .map(m => ({ id: m.bioguideId, ids: crosswalkIdsFor(m.bioguideId, FEC_CROSSWALK) }))
        .filter(p => p.ids.length),
      cycle,
      log,
    });
    for (const c of await db.read('SELECT id, name FROM cm')) {
      conduitNames.set(c.id, c.name);
    }
    log(`discovery done: ${discovered.size} member(s), ${fec.calls} FEC calls`);
    // Gifts to the member's campaigns and leadership PAC: the committees
    // whose money is theirs in full (a joint fund's PAC money reaches them
    // split by the fund's mix, in personFunding)
    for (const [id, pf] of discovered) {
      const vehicles = (pf.committees || [])
        .filter(c => c.role === 'campaign' || c.role === 'leadership')
        .map(c => c.committeeId);
      giftsFor.set(id, await pacGifts(db, vehicles));
    }
    // Every giving PAC's own donors, and the donors of the committees that
    // fund them (one level deeper): how much of each PAC's money came from
    // people (#57)
    const givers = [...giftsFor.values()].flatMap(g => g.map(x => x.id));
    const upstream = await upstreamGifts(db, givers);
    const upIds = [...upstream.values()].flatMap(u => u.map(x => x.id));
    profiles = await pacProfiles(db, file.path, [...givers, ...upIds]);
    traced = tracePacs(profiles, upstream);
    log(
      `PACs: ${new Set(givers).size} giving PACs traced, ${new Set(upIds).size} committees funding them`
    );
  }
  const conduitName = async id => {
    if (!conduitNames.has(id)) {
      const c = (await fec(`/committee/${id}/`, {})).results?.[0];
      conduitNames.set(id, c?.name || id);
    }
    return conduitNames.get(id);
  };
  const summary = { complete: 0, provisional: 0, pending: 0, failed: 0, skipped: 0 };
  let processed = 0;
  let stopReason = 'done'; // done | time | d1
  // Soft deadline: start no new member or committee after it. Hard deadline:
  // a committee mid-search stops (the job's own limit is 350 minutes)
  const softDeadline = started + budgetMs;
  const hardDeadline = softDeadline + 15 * 60000;
  let cutShort = false;

  for (let b = 0; b < targets.length; b += batchSize) {
    if (Date.now() - started > budgetMs) {
      log(
        `time budget reached: ${targets.length - b} member(s) left for the next run of ${roundId}`
      );
      stopReason = 'time';
      break;
    }
    // D1 budget, again before each batch: today's ledger plus what this run
    // has written so far, with room for one more batch
    const writtenToday = (ledger?.rows_written || 0) + cf.stats.d1RowsWritten;
    const readToday = (ledger?.rows_read || 0) + cf.stats.d1RowsRead;
    if (readToday > D1_READ_CAP - 200000) {
      log(
        `D1 budget: ${readToday} rows read today; stopping, ${targets.length - b} member(s) left for the next run of ${roundId}`
      );
      stopReason = 'd1';
      break;
    }
    if (writtenToday > D1_DAILY_CAP - 5000) {
      log(
        `D1 budget: ${writtenToday} rows written today; stopping, ${targets.length - b} member(s) left for the next run of ${roundId}`
      );
      stopReason = 'd1';
      break;
    }
    const batch = targets.slice(b, b + batchSize);

    // 1. Each member's committees (discovery, #32)
    const people = [];
    for (const m of batch) {
      if (Date.now() > softDeadline) {
        cutShort = true;
        break;
      }
      const ids = crosswalkIdsFor(m.bioguideId, FEC_CROSSWALK);
      if (!ids.length) {
        people.push({ id: m.bioguideId, name: m.name, skip: 'no FEC identity (N/A)' });
        continue;
      }
      try {
        const pf = discovered
          ? discovered.get(m.bioguideId)
          : await fetchPersonFunding(fec, ids, cycle);
        people.push({ id: m.bioguideId, name: m.name, pf, pool: pf.donorCommitteeIds });
        log(`  ${m.name}: pool ${pf.donorCommitteeIds.join(', ') || '(none)'}`);
      } catch (error) {
        people.push({ id: m.bioguideId, name: m.name, error: `discovery: ${error.message}` });
        log(`  ${m.name}: discovery failed: ${error.message}`);
      }
    }

    if (cutShort) {
      log(`time budget reached during discovery: this batch is left for the next run`);
      stopReason = 'time';
      break;
    }

    // 2. The bulk file, loaded for this batch's committees
    const ids = [...new Set(people.flatMap(p => p.pool || []))];
    const bulk = await loadBulk(file.path, ids.length ? ids : ['C00000000']);
    await loadFara(bulk, fara, faraFiles, cycle);

    // 3. Reconcile each committee once per round
    const committees = new Map();
    for (const id of ids) {
      try {
        // Already checked this round (a grade-only run takes any check of
        // this cycle)
        const [prior] = dryRun
          ? []
          : gradeOnly
            ? await d1('SELECT * FROM committees WHERE committee_id = ? AND cycle = ?', [id, cycle])
            : await d1(
                'SELECT * FROM committees WHERE committee_id = ? AND cycle = ? AND round_id = ?',
                [id, cycle, roundId]
              );
        // Records fetched in earlier runs because the bulk file lacks them
        const stored = await loadStored(d1, id, cycle);
        if (prior && SETTLED.has(prior.status)) {
          await insertApiRows(
            bulk.conn,
            [...stored.gap, ...stored.earmarked].map(r => apiRowToBulkShape(r, countsApi(r)))
          );
          committees.set(id, {
            committeeId: id,
            status: prior.status,
            note: prior.note,
            reused: true,
          });
          log(`  ${id}: already reconciled (${prior.status}); reused`);
          continue;
        }
        if (gradeOnly) {
          committees.set(id, { committeeId: id, status: 'unchecked' });
          continue;
        }
        if (Date.now() > softDeadline) {
          cutShort = true;
          break;
        }
        const r = await reconcileCommittee({
          fec,
          bulk,
          committeeId: id,
          cycle,
          log,
          deadline: hardDeadline,
          stored: stored.gap,
        });
        committees.set(id, r);
        log(
          `  ${id} ${r.name}: ${r.status} (bulk ${r.bulkCount}, FEC ${r.fecIndividualCount}${r.fecCountExact ? '' : '~'}, filled ${r.gapFilled}, earmarked ${r.earmarkedExtra}, delta $${r.money.delta}; ${r.rangesCounted} ranges, ${r.fetchedSlices} fetched, ${fec.calls} FEC calls so far)`
        );
        if (!dryRun) {
          await d1(
            `INSERT INTO committees (committee_id, cycle, name, fec_itemized_total, fec_individual_count, fec_count_exact,
               bulk_count, gap_filled, earmarked_extra, our_itemized_total, status, note, checked_at, round_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(committee_id, cycle) DO UPDATE SET name=excluded.name, fec_itemized_total=excluded.fec_itemized_total,
               fec_individual_count=excluded.fec_individual_count, fec_count_exact=excluded.fec_count_exact,
               bulk_count=excluded.bulk_count, gap_filled=excluded.gap_filled, earmarked_extra=excluded.earmarked_extra,
               our_itemized_total=excluded.our_itemized_total, status=excluded.status, note=excluded.note,
               checked_at=excluded.checked_at, round_id=excluded.round_id`,
            [
              id,
              cycle,
              r.name,
              r.fecItemizedTotal,
              r.fecIndividualCount,
              r.fecCountExact ? 1 : 0,
              r.bulkCount,
              r.gapFilled,
              r.earmarkedExtra,
              r.ourItemizedTotal,
              r.status,
              r.note,
              now(),
              roundId,
            ]
          );
          // Full records, Brotli-packed per committee: a few rows, whatever
          // the number of records (lib/gap-store.mjs)
          await saveStored(d1, id, cycle, { gap: r.gapRows, earmarked: r.earmarkedRows });
        }
      } catch (error) {
        if (error instanceof TimeBudgetError) {
          log(`  ${error.message}`);
          cutShort = true;
          break;
        }
        committees.set(id, { committeeId: id, status: 'failed', note: error.message });
        log(`  ${id}: reconciliation failed: ${error.message}`);
      }
    }

    // 4. Analyse and grade each member (Stage 2: recorded, not published)
    for (const p of people) {
      // Out of time before all this member's committees were checked: leave
      // them for the next run (committees already checked are reused there)
      if (cutShort && !p.skip && !p.error && p.pool.some(id => !committees.has(id))) {
        continue;
      }
      processed++;
      const progress = async (status, error = null) => {
        if (dryRun || gradeOnly) {
          return;
        }
        await d1(
          `INSERT INTO member_progress (bioguide_id, cycle, status, last_error, attempts, updated_at, round_id)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(bioguide_id, cycle) DO UPDATE SET status=excluded.status, last_error=excluded.last_error,
             attempts=CASE WHEN excluded.status = 'failed' THEN member_progress.attempts + 1 ELSE 0 END,
             updated_at=excluded.updated_at, round_id=excluded.round_id`,
          [p.id, cycle, status, error, status === 'failed' ? 1 : 0, now(), roundId]
        );
      };
      if (p.skip) {
        summary.skipped++;
        await progress('done');
        continue;
      }
      const failedCommittees = (p.pool || []).filter(id => committees.get(id)?.status === 'failed');
      if (p.error || failedCommittees.length) {
        summary.failed++;
        await progress(
          'failed',
          p.error || `reconciliation failed: ${failedCommittees.join(', ')}`
        );
        continue;
      }
      // No campaign, leadership PAC or joint fund registered for the cycle
      // (e.g. a member whose only committee is registered as an ordinary
      // PAC): nothing to grade on all committees. Recorded as pending with
      // the reason, not a failure; the site keeps the current grade.
      if (!p.pool.length) {
        summary.pending++;
        log(`  ${p.name}: pending: no campaign committee registered for ${cycle}`);
        await progress('done');
        if (!dryRun) {
          await d1(
            `INSERT INTO results (bioguide_id, cycle, computed_at, bulk_file_date, pool, analysis, reconciliation, grade, status)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT(bioguide_id, cycle) DO UPDATE SET computed_at=excluded.computed_at, pool=excluded.pool,
               analysis=excluded.analysis, reconciliation=excluded.reconciliation, grade=excluded.grade, status=excluded.status
             WHERE results.status <> 'pending' OR results.reconciliation IS NOT excluded.reconciliation`,
            [
              p.id,
              cycle,
              now(),
              file.lastModified,
              JSON.stringify({ committees: p.pf.committees, donorCommitteeIds: [] }),
              null,
              JSON.stringify({
                ok: false,
                pending: false,
                reason:
                  'no campaign committee, leadership PAC or joint fund registered for the cycle',
              }),
              null,
              'pending',
            ]
          );
        }
        continue;
      }
      try {
        const recon = p.pool.map(id => {
          const r = { ...committees.get(id) };
          delete r.gapRows;
          delete r.earmarkedRows;
          return { committeeId: id, ...r };
        });
        const ok = recon.every(
          r => r.status === 'reconciled' || r.status === 'reconciled-with-note'
        );
        // Graded from the bulk files, check still to come: provisional
        const pending =
          !ok &&
          recon.every(r => ['reconciled', 'reconciled-with-note', 'unchecked'].includes(r.status));
        const notes = recon
          .filter(r => r.note && r.status === 'reconciled-with-note')
          .map(r => `${r.committeeId}: ${r.note}`);
        const analysis = await analyzePool(bulk, p.pool, { conduitName });
        const gifts = giftsFor.get(p.id);
        if (gifts) {
          analysis.pacs = pacSummary(gifts, profiles, traced);
        }
        const member = JSON.parse((await cf.kvGet(memberKey(p.id))) || 'null');
        const asStored = {
          ...analysis,
          personLevel: true,
          personFunding: p.pf,
          reconciliation: { ok, pending },
        };
        // Every member graded here was looked up in the FEC crosswalk (members
        // without an identity are skipped above), so the figures are theirs.
        // A record's older flag (stamped once, 2026-09-26) doesn't override it.
        // Every PAC gift, and the PAC money traced back to people (#57)
        const grade = member
          ? gradeMember(
              {
                ...member,
                fecIdentityVerified: true,
                ...(gifts
                  ? {
                      pacContributions: asPacContributions(gifts),
                      pacListComplete: true,
                      pacPeopleCredit: pacPeopleCredit(gifts, traced),
                    }
                  : {}),
              },
              asStored
            )
          : null;
        if (reportPath) {
          const before = targets.find(t => t.bioguideId === p.id) || {};
          const brief = g =>
            g && {
              tier: g.tier,
              score: g.individualFundingPercent,
              pacBar: g.detail?.transparencyPenalty ?? null,
              path: g.detail?.path ?? null,
            };
          const own = p.pf.ownMoney;
          report.push({
            id: p.id,
            name: p.name,
            party: before.party,
            chamber: before.chamber,
            state: before.state,
            before: { tier: before.tier, score: before.individualFundingPercent ?? null },
            grade: brief(grade),
            totalRaised: p.pf.totalRaised,
            ownMoney: own,
            ownShare:
              own && p.pf.totalRaised ? (own.contributions + own.loans) / p.pf.totalRaised : 0,
            pacTotal: gifts ? gifts.reduce((t, x) => t + x.amount, 0) : null,
            pacByKind: gifts ? analysis.pacs.byKind : null,
            variants:
              gifts && member
                ? gradeVariants({ member, asStored, gifts, traced, gradeMember })
                : null,
            untraced: gifts ? untraced(gifts, traced) : null,
            faraEmployerTotal: analysis.faraEmployerTotal,
            faraAgentTotal: analysis.faraAgentTotal,
          });
        }
        const status = !grade ? 'pending' : ok ? 'complete' : pending ? 'provisional' : 'pending';
        summary[status]++;
        log(
          `  ${p.name}: ${status}${grade ? ` -> ${grade.tier} (${grade.gradeBasis}), donors ${analysis.uniqueDonors}, Nakamoto ${analysis.nakamotoCoefficient}` : ''}${
            ok || pending
              ? ''
              : ` [not reconciled: ${recon
                  .filter(r => !['reconciled', 'reconciled-with-note'].includes(r.status))
                  .map(r => r.committeeId)
                  .join(', ')}]`
          }`
        );
        if (!dryRun) {
          const result = {
            pool: {
              committees: p.pf.committees,
              donorCommitteeIds: p.pool,
              totals: { totalRaised: p.pf.totalRaised, raisedInName: p.pf.raisedInName },
            },
            analysis,
            reconciliation: { ok, pending, notes, committees: recon },
            grade: grade && {
              tier: grade.tier,
              individualFundingPercent: grade.individualFundingPercent,
              gradeBasis: grade.gradeBasis,
              evidenceChecked: grade.evidenceChecked,
              personFigures: grade.personFigures,
              detail: grade.detail,
            },
          };
          const [prev] = await d1(
            'SELECT analysis, grade, reconciliation FROM results WHERE bioguide_id = ? AND cycle = ?',
            [p.id, cycle]
          );
          const changed =
            !prev ||
            prev.analysis !== JSON.stringify(result.analysis) ||
            prev.grade !== JSON.stringify(result.grade) ||
            prev.reconciliation !== JSON.stringify(result.reconciliation);
          if (changed) {
            await d1(
              `INSERT INTO results (bioguide_id, cycle, computed_at, bulk_file_date, pool, analysis, reconciliation, grade, status)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(bioguide_id, cycle) DO UPDATE SET computed_at=excluded.computed_at, bulk_file_date=excluded.bulk_file_date,
                 pool=excluded.pool, analysis=excluded.analysis, reconciliation=excluded.reconciliation, grade=excluded.grade, status=excluded.status`,
              [
                p.id,
                cycle,
                now(),
                file.lastModified,
                JSON.stringify(result.pool),
                JSON.stringify(result.analysis),
                JSON.stringify(result.reconciliation),
                JSON.stringify(result.grade),
                status,
              ]
            );
            await d1(
              'INSERT INTO snapshots (bioguide_id, cycle, created_at, result) VALUES (?,?,?,?)',
              [p.id, cycle, now(), JSON.stringify(result)]
            );
          }
        }
        await progress('done');
      } catch (error) {
        summary.failed++;
        log(`  ${p.name}: failed: ${error.message}`);
        await progress('failed', error.message);
      }
    }
    // Publish this batch to the site (Stage 3): one list write, only if it
    // differs. Per batch, so the list and the member pages (which read D1
    // directly) never disagree for long
    if (!dryRun) {
      const pub = await publishGrades({ cf, d1, cycle, log });
      summary.gradeChanges = (summary.gradeChanges || 0) + pub.gradeChanges.length;
    }
    if (cutShort) {
      log(`time budget reached mid-batch: the rest is left for the next run of ${roundId}`);
      stopReason = 'time';
      break;
    }
  }

  if (reportPath) {
    for (const gifts of giftsFor.values()) {
      for (const g of gifts) {
        const k = `${g.kind}/${g.orgType || '-'}`;
        const t = (pacTypes[k] ||= { dollars: 0, people1: 0, people2: 0, untraced1: 0 });
        t.dollars += g.amount;
        t.people1 += g.amount * (traced.get(g.id)?.[1]?.share || 0);
        t.people2 += g.amount * (traced.get(g.id)?.[2]?.share || 0);
        t.untraced1 += g.amount * (1 - (traced.get(g.id)?.[1]?.traceable || 0));
      }
    }
    writeFileSync(`${reportPath}.pacs.json`, JSON.stringify(pacTypes, null, 1));
    writeFileSync(reportPath, JSON.stringify(report, null, 1));
    const moved = pick => report.filter(r => pick(r) && pick(r).tier !== r.before.tier);
    const byParty = list =>
      Object.entries(
        list.reduce((m, r) => {
          const dir =
            gradeRank(r.after.tier) > gradeRank(r.before.tier)
              ? 'up'
              : gradeRank(r.after.tier) < gradeRank(r.before.tier)
                ? 'down'
                : 'other';
          const k = `${r.party || '?'} ${dir}`;
          m[k] = (m[k] || 0) + 1;
          return m;
        }, {})
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
    const tally = list =>
      Object.entries(
        list.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {})
      )
        .sort((a, b) => gradeRank(b[0]) - gradeRank(a[0]))
        .map(([k, v]) => `${k}${v}`)
        .join(' ');
    const off = report.filter(
      r => r.variants && r.grade && r.variants[PRODUCTION_VARIANT].score !== r.grade.score
    );
    log(
      `report: production grade matches ${PRODUCTION_VARIANT} for all but ${off.length} member(s)${off.length ? `: ${off.map(r => r.name).join('; ')}` : ''}`
    );
    for (const key of Object.keys(VARIANTS)) {
      const pick = r => r.variants?.[key];
      const list = moved(pick).map(r => ({ ...r, after: pick(r) }));
      log(
        `report: ${key}: ${tally(report.filter(pick).map(r => pick(r).tier))}; ${list.length} change from now (${byParty(list)})`
      );
    }
    const list = moved(r => r.grade).map(r => ({ ...r, after: r.grade }));
    log(`report: this run's grades: ${list.length} change (${byParty(list)})`);
    for (const r of list.slice(0, 60)) {
      log(`  ${r.before.tier} -> ${r.after.tier}  ${r.name} (${r.party}, ${r.state})`);
    }
    log(`report written to ${reportPath}`);
  }

  const remaining = targets.length - processed;
  const stats = {
    ...summary,
    remaining,
    fecCalls: fec.calls,
    kvReads: cf.stats.kvReads,
    kvWrites: cf.stats.kvWrites,
    d1RowsWritten: cf.stats.d1RowsWritten,
    d1RowsRead: cf.stats.d1RowsRead,
    minutes: Math.round((Date.now() - started) / 60000),
  };
  log('summary', JSON.stringify(stats));
  // For the workflow: whether to start the next run of this round
  if (process.env.GITHUB_OUTPUT) {
    const progressed = summary.complete + summary.provisional + summary.pending + summary.skipped;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `stop_reason=${stopReason}\nremaining=${remaining}\nprogressed=${progressed}\n`
    );
  }
  if (!dryRun) {
    if (!gradeOnly && !only.length && remaining === 0) {
      await d1('UPDATE rounds SET finished_at = ? WHERE round_id = ?', [now(), roundId]);
      log(`${roundId} finished`);
    }
    await d1(
      'UPDATE runs SET finished_at = ?, status = ?, bulk_file_date = ?, summary = ? WHERE run_id = ?',
      [
        now(),
        summary.failed ? 'done-with-failures' : 'done',
        file.lastModified,
        JSON.stringify(stats),
        runId,
      ]
    );
    // Charge D1's own rows_written and rows_read figures to the ledger
    await chargeLedger(d1, today, cf.stats.d1RowsWritten + 1, cf.stats.d1RowsRead);
  }
  if (summary.failed) {
    process.exitCode = 1;
  }
}

main().catch(async error => {
  console.error(`refresh job failed: ${error.message}`);
  try {
    await recordCrash?.(error.message);
  } catch (e) {
    console.error(`could not record the failure in D1: ${e.message}`);
  }
  process.exit(1);
});
