#!/usr/bin/env node
/**
 * The refresh job (REBUILD_SPEC.md §5). Stage 2: computes and records
 * results; publishes nothing (Stage 3 does).
 *
 *   node scripts/refresh/run.mjs [--members ID,ID] [--cycle 2026] [--dry-run]
 *     [--bulk-dir DIR] [--trigger manual|calendar|event] [--new-round REASON]
 *     [--budget-minutes 300] [--batch 25]
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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
import { cycleForYear } from '../../workers/tier-calculation.js';
import { analyzePool, loadFara } from './lib/analysis.mjs';
import { apiRowToBulkShape, ensureBulkFile, insertApiRows, loadBulk } from './lib/bulk.mjs';
import { createCloudflare } from './lib/cloudflare.mjs';
import { TimeBudgetError, reconcileCommittee } from './lib/committee.mjs';
import { createFecClient } from './lib/fec.mjs';

export const RESULTS_DB = 'f4ad9245-769d-4bb2-b772-c552907e1692'; // tfp-results
const D1_DAILY_CAP = 85000; // the account's D1 limit is 100k/day, shared with other projects
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

// Set once the run is recorded: on a crash, marks it failed and charges the
// D1 rows already written, so health sees the failure and the ledger is right
let recordCrash = null;

async function main() {
  const started = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
  const only = arg('--members', '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const bulkDir = arg('--bulk-dir', join(tmpdir(), 'tfp-bulk'));
  const budgetMs = Number(arg('--budget-minutes', 300)) * 60000;
  const batchSize = Number(arg('--batch', 25));
  mkdirSync(bulkDir, { recursive: true });

  const cf = createCloudflare();
  const fec = createFecClient(fecKey());
  const runId = `${now()}-${Math.random().toString(36).slice(2, 6)}`;
  const today = now().slice(0, 10);
  const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);

  // D1 budget: stop before the job's cap
  const [ledger] = await d1('SELECT rows_written FROM d1_write_budget WHERE day = ?', [today]);
  if ((ledger?.rows_written || 0) > D1_DAILY_CAP - 20000) {
    throw new Error(`D1 budget: ${ledger.rows_written} rows written today; not starting`);
  }

  // The round this run belongs to
  let roundId = 'dry-run';
  if (!dryRun) {
    const reason = arg('--new-round', null);
    const [open] = await d1(
      'SELECT round_id FROM rounds WHERE cycle = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1',
      [cycle]
    );
    if (open && !reason) {
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
      [runId, now(), arg('--trigger', 'manual'), 'running', roundId]
    );
    recordCrash = async message => {
      await d1('UPDATE runs SET finished_at = ?, status = ?, summary = ? WHERE run_id = ?', [
        now(),
        'failed',
        JSON.stringify({ error: message, fecCalls: fec.calls }),
        runId,
      ]);
      await d1(
        `INSERT INTO d1_write_budget (day, rows_written) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written`,
        [today, cf.stats.d1RowsWritten + 2]
      );
    };
  }

  // Members still to do in this round
  const list = JSON.parse((await cf.kvGet(LIST_KEY)) || '{"members":[]}').members;
  let targets = only.length ? list.filter(m => only.includes(m.bioguideId)) : list;
  if (!dryRun && !only.length) {
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
  const conduitNames = new Map();
  const conduitName = async id => {
    if (!conduitNames.has(id)) {
      const c = (await fec(`/committee/${id}/`, {})).results?.[0];
      conduitNames.set(id, c?.name || id);
    }
    return conduitNames.get(id);
  };
  const summary = { complete: 0, pending: 0, failed: 0, skipped: 0 };
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
        const pf = await fetchPersonFunding(fec, ids, cycle);
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
    await loadFara(bulk, fara);

    // 3. Reconcile each committee once per round
    const committees = new Map();
    for (const id of ids) {
      try {
        const [prior] = dryRun
          ? []
          : await d1(
              'SELECT * FROM committees WHERE committee_id = ? AND cycle = ? AND round_id = ?',
              [id, cycle, roundId]
            );
        if (prior && SETTLED.has(prior.status)) {
          const saved = await d1(
            'SELECT record FROM gap_records WHERE committee_id = ? AND cycle = ?',
            [id, cycle]
          );
          const rows = saved.map(s => JSON.parse(s.record));
          await insertApiRows(
            bulk.conn,
            rows.map(r => apiRowToBulkShape(r, countsApi(r)))
          );
          committees.set(id, {
            committeeId: id,
            status: prior.status,
            note: prior.note,
            reused: true,
          });
          log(`  ${id}: already reconciled this round (${prior.status}); reused`);
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
          const fetched = [
            ...r.gapRows.map(x => ['gap', x]),
            ...r.earmarkedRows.map(x => ['earmarked', x]),
          ];
          for (let i = 0; i < fetched.length; i += 15) {
            const rows = fetched.slice(i, i + 15);
            await d1(
              `INSERT INTO gap_records (sub_id, committee_id, cycle, kind, record, fetched_at) VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}
               ON CONFLICT(sub_id) DO NOTHING`,
              rows.flatMap(([kind, x]) => [
                String(x.sub_id),
                id,
                cycle,
                kind,
                JSON.stringify(x),
                now(),
              ])
            );
          }
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
        if (dryRun) {
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
        const notes = recon
          .filter(r => r.note && r.status === 'reconciled-with-note')
          .map(r => `${r.committeeId}: ${r.note}`);
        const analysis = await analyzePool(bulk, p.pool, { conduitName });
        const member = JSON.parse((await cf.kvGet(memberKey(p.id))) || 'null');
        const asStored = {
          ...analysis,
          personLevel: true,
          personFunding: p.pf,
          reconciliation: { ok },
        };
        const grade = member ? gradeMember(member, asStored) : null;
        const status = ok && grade ? 'complete' : 'pending';
        summary[status]++;
        log(
          `  ${p.name}: ${status}${grade ? ` -> ${grade.tier} (${grade.gradeBasis}), donors ${analysis.uniqueDonors}, Nakamoto ${analysis.nakamotoCoefficient}` : ''}${
            ok
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
            reconciliation: { ok, notes, committees: recon },
            grade: grade && {
              tier: grade.tier,
              individualFundingPercent: grade.individualFundingPercent,
              gradeBasis: grade.gradeBasis,
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
    if (cutShort) {
      log(`time budget reached mid-batch: the rest is left for the next run of ${roundId}`);
      stopReason = 'time';
      break;
    }
  }

  const remaining = targets.length - processed;
  const stats = {
    ...summary,
    remaining,
    fecCalls: fec.calls,
    kvReads: cf.stats.kvReads,
    kvWrites: cf.stats.kvWrites,
    d1RowsWritten: cf.stats.d1RowsWritten,
    minutes: Math.round((Date.now() - started) / 60000),
  };
  log('summary', JSON.stringify(stats));
  // For the workflow: whether to start the next run of this round
  if (process.env.GITHUB_OUTPUT) {
    const progressed = summary.complete + summary.pending + summary.skipped;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `stop_reason=${stopReason}\nremaining=${remaining}\nprogressed=${progressed}\n`
    );
  }
  if (!dryRun) {
    if (!only.length && remaining === 0) {
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
    // Charge D1's own rows_written figures to the ledger (CLAUDE.md rule)
    await d1(
      `INSERT INTO d1_write_budget (day, rows_written) VALUES (?, ?)
       ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written`,
      [today, cf.stats.d1RowsWritten + 1]
    );
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
