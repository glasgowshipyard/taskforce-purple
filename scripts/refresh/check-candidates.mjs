#!/usr/bin/env node
/**
 * The record-by-record check for the race candidates (#55, ROADMAP Phase E):
 * challengers and open-seat candidates are graded from the FEC's bulk files
 * and shown as still being double-checked (grade first, confirm after). This
 * checks each of their committees against the FEC's own records, exactly as
 * the refresh job checks members' (lib/committee.mjs reconcileCommittee),
 * into the same tables: `committees` and the packed records in `gap_packs`.
 * The races job then reuses those checks when it grades (races.mjs), so a
 * candidate whose committees all reconcile shows as checked.
 *
 *   node scripts/refresh/check-candidates.mjs [--cycle 2026] [--dry-run]
 *     [--budget-minutes 320] [--batch 25] [--bulk-dir DIR]
 *
 * A pass can outlast one run: each run skips committees already checked this
 * cycle and stops cleanly at its time budget. Writes `stop_reason`,
 * `remaining` and `checked` to $GITHUB_OUTPUT so the workflow can start the
 * next run, or re-grade the races when nothing is left.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradingCycle } from '../../workers/tier-calculation.js';
import { ensureBulkFile, loadBulk } from './lib/bulk.mjs';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { TimeBudgetError, reconcileCommittee } from './lib/committee.mjs';
import { createFecClient } from './lib/fec.mjs';
import { loadStored, saveStored } from './lib/gap-store.mjs';

const RACES_KEY = 'races:list';
const SETTLED = new Set(['reconciled', 'reconciled-with-note', 'mismatch']);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const now = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const output = text => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, text);

function fecKey() {
  if (process.env.FEC_API_KEY) {
    return process.env.FEC_API_KEY;
  }
  const local = new URL('../../API_KEYS.md', import.meta.url).pathname;
  return existsSync(local) ? readFileSync(local, 'utf8').match(/`([A-Za-z0-9]{40})`/)?.[1] : null;
}

async function main() {
  const started = Date.now();
  const cycle = Number(arg('--cycle', gradingCycle()));
  const dryRun = process.argv.includes('--dry-run');
  const budgetMs = Number(arg('--budget-minutes', 320)) * 60000;
  const batchSize = Number(arg('--batch', 25));
  const bulkDir = arg('--bulk-dir', join(tmpdir(), 'tfp-bulk'));
  mkdirSync(bulkDir, { recursive: true });
  const softDeadline = started + budgetMs;
  const hardDeadline = softDeadline + 15 * 60000;

  const cf = createCloudflare();
  const fec = createFecClient(fecKey());
  const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);

  // The candidates on the ballot who aren't sitting members (members are
  // checked by the refresh job), from the published races
  const races = JSON.parse((await cf.kvGet(RACES_KEY)) || 'null');
  if (!races?.races?.length) {
    log('no races published yet: nothing to check');
    output('stop_reason=done\nremaining=0\nchecked=0\n');
    return;
  }
  const candidateIds = [
    ...new Set(
      races.races.flatMap(r => r.candidates.filter(c => !c.bioguideId).map(c => c.candidateId))
    ),
  ];
  // Each candidate's committees, by primary key
  const committees = new Set();
  for (const id of candidateIds) {
    const [row] = await d1(
      'SELECT pool FROM race_candidates WHERE candidate_id = ? AND cycle = ?',
      [id, cycle]
    );
    for (const c of JSON.parse(row?.pool || 'null')?.donorCommitteeIds || []) {
      committees.add(c);
    }
  }
  // Those not yet checked this cycle (a member's committee checked by the
  // refresh job counts too)
  const todo = [];
  for (const id of committees) {
    const [prior] = await d1('SELECT status FROM committees WHERE committee_id = ? AND cycle = ?', [
      id,
      cycle,
    ]);
    if (!prior || !SETTLED.has(prior.status)) {
      todo.push(id);
    }
  }
  log(
    `${candidateIds.length} candidates, ${committees.size} committees, ${todo.length} still to check${dryRun ? ' (dry run)' : ''}`
  );

  const file = ensureBulkFile(cycle, bulkDir, log);
  const statuses = {};
  let checked = 0;
  let stopReason = 'done';
  outer: for (let b = 0; b < todo.length; b += batchSize) {
    const batch = todo.slice(b, b + batchSize);
    const bulk = await loadBulk(file.path, batch);
    for (const id of batch) {
      if (Date.now() > softDeadline) {
        stopReason = 'time';
        break outer;
      }
      try {
        const stored = await loadStored(d1, id, cycle);
        const r = await reconcileCommittee({
          fec,
          bulk,
          committeeId: id,
          cycle,
          log,
          deadline: hardDeadline,
          stored: stored.gap,
        });
        statuses[r.status] = (statuses[r.status] || 0) + 1;
        checked++;
        log(
          `  ${id} ${r.name}: ${r.status} (bulk ${r.bulkCount}, FEC ${r.fecIndividualCount}, filled ${r.gapFilled}, delta $${r.money.delta}; ${fec.calls} FEC calls so far)`
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
              'races-check',
            ]
          );
          await saveStored(d1, id, cycle, { gap: r.gapRows, earmarked: r.earmarkedRows });
        }
      } catch (error) {
        if (error instanceof TimeBudgetError) {
          log(`  ${error.message}`);
          stopReason = 'time';
          break outer;
        }
        // A committee that can't be checked now stays unchecked: its
        // candidate keeps the "being double-checked" note, and the next run
        // tries again
        statuses.failed = (statuses.failed || 0) + 1;
        log(`  ${id}: check failed: ${error.message}`);
      }
    }
  }
  const remaining = todo.length - checked;
  if (!dryRun) {
    await d1(
      `INSERT INTO d1_write_budget (day, rows_written, rows_read) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written,
         rows_read = rows_read + excluded.rows_read`,
      [now().slice(0, 10), cf.stats.d1RowsWritten + 1, cf.stats.d1RowsRead]
    );
  }
  log(
    `checked ${checked} committee(s) ${JSON.stringify(statuses)}; ${remaining} left; ${fec.calls} FEC calls, ${cf.stats.d1RowsWritten} D1 rows written, in ${Math.round((Date.now() - started) / 60000)} min`
  );
  output(`stop_reason=${stopReason}\nremaining=${remaining}\nchecked=${checked}\n`);
}

main().catch(error => {
  console.error(`candidate check failed: ${error.message}`);
  process.exit(1);
});
