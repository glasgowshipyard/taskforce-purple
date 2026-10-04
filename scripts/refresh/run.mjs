#!/usr/bin/env node
/**
 * The refresh job (REBUILD_SPEC.md §5). Stage 2: computes and records
 * results; publishes nothing (Stage 3 does).
 *
 *   node scripts/refresh/run.mjs [--members ID,ID] [--cycle 2026] [--dry-run]
 *                                [--bulk-dir DIR] [--trigger manual|calendar|event]
 *
 * Credentials: FEC_API_KEY and CLOUDFLARE_API_TOKEN from the environment (the
 * GitHub Actions secrets). Run locally, the FEC key falls back to API_KEYS.md
 * and Cloudflare to the wrangler login. Nothing secret is ever printed.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { crosswalkIdsFor } from '../../workers/fec-identity.js';
import { gradeMember } from '../../workers/grading.js';
import { memberKey, LIST_KEY } from '../../workers/member-store.js';
import { fetchPersonFunding } from '../../workers/person-funding.js';
import { cycleForYear } from '../../workers/tier-calculation.js';
import { analyzePool, loadFara } from './lib/analysis.mjs';
import { ensureBulkFile, loadBulk } from './lib/bulk.mjs';
import { createCloudflare } from './lib/cloudflare.mjs';
import { reconcileCommittee } from './lib/committee.mjs';
import { createFecClient } from './lib/fec.mjs';

export const RESULTS_DB = 'f4ad9245-769d-4bb2-b772-c552907e1692'; // tfp-results
const D1_DAILY_CAP = 85000; // the account's D1 limit is 100k/day, shared with other projects

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const now = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function fecKey() {
  if (process.env.FEC_API_KEY) {
    return process.env.FEC_API_KEY;
  }
  const local = new URL('../../API_KEYS.md', import.meta.url).pathname;
  return existsSync(local) ? readFileSync(local, 'utf8').match(/`([A-Za-z0-9]{40})`/)?.[1] : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
  const only = arg('--members', '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const bulkDir = arg('--bulk-dir', join(tmpdir(), 'tfp-bulk'));
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
  if (!dryRun) {
    await d1('INSERT INTO runs (run_id, started_at, trigger, status) VALUES (?, ?, ?, ?)', [
      runId,
      now(),
      arg('--trigger', 'manual'),
      'running',
    ]);
  }

  // 1. Members: ids from the stored list, full records per member
  const list = JSON.parse((await cf.kvGet(LIST_KEY)) || '{"members":[]}').members;
  const targets = only.length ? list.filter(m => only.includes(m.bioguideId)) : list;
  log(`run ${runId}: ${targets.length} member(s), cycle ${cycle}${dryRun ? ' (dry run)' : ''}`);

  // 2. Each member's committees (discovery, #32)
  const people = [];
  for (const m of targets) {
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

  // 3. The bulk file, loaded once for every committee in any pool
  const allIds = [...new Set(people.flatMap(p => p.pool || []))];
  const file = ensureBulkFile(cycle, bulkDir, log);
  const bulk = await loadBulk(file.path, allIds);
  await loadFara(
    bulk,
    await d1('SELECT employer, fara_firm, registration_number FROM fara_employer_matches')
  );
  log(`bulk file of ${file.lastModified} loaded for ${allIds.length} committee(s)`);

  // 4. Reconcile each committee once
  const committees = new Map();
  for (const id of allIds) {
    try {
      const r = await reconcileCommittee({ fec, bulk, committeeId: id, cycle, log });
      committees.set(id, r);
      log(
        `  ${id} ${r.name}: ${r.status} (bulk ${r.bulkCount}, FEC ${r.fecIndividualCount}${r.fecCountExact ? '' : '~'}, filled ${r.gapFilled}, earmarked ${r.earmarkedExtra}, delta $${r.money.delta})`
      );
      if (!dryRun) {
        await d1(
          `INSERT INTO committees (committee_id, cycle, name, fec_itemized_total, fec_individual_count, fec_count_exact,
             bulk_count, gap_filled, earmarked_extra, our_itemized_total, status, note, checked_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(committee_id, cycle) DO UPDATE SET name=excluded.name, fec_itemized_total=excluded.fec_itemized_total,
             fec_individual_count=excluded.fec_individual_count, fec_count_exact=excluded.fec_count_exact,
             bulk_count=excluded.bulk_count, gap_filled=excluded.gap_filled, earmarked_extra=excluded.earmarked_extra,
             our_itemized_total=excluded.our_itemized_total, status=excluded.status, note=excluded.note,
             checked_at=excluded.checked_at`,
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
          ]
        );
        const fetched = [
          ...r.gapRows.map(x => ['gap', x]),
          ...r.earmarkedRows.map(x => ['earmarked', x]),
        ];
        for (let i = 0; i < fetched.length; i += 15) {
          const b = fetched.slice(i, i + 15);
          await d1(
            `INSERT INTO gap_records (sub_id, committee_id, cycle, kind, record, fetched_at) VALUES ${b.map(() => '(?,?,?,?,?,?)').join(',')}
             ON CONFLICT(sub_id) DO NOTHING`,
            b.flatMap(([kind, x]) => [String(x.sub_id), id, cycle, kind, JSON.stringify(x), now()])
          );
        }
      }
    } catch (error) {
      committees.set(id, { committeeId: id, status: 'failed', note: error.message });
      log(`  ${id}: reconciliation failed: ${error.message}`);
    }
  }

  // 5. Analyse and grade each member (Stage 2: recorded, not published)
  const conduitNames = new Map();
  const conduitName = async id => {
    if (!conduitNames.has(id)) {
      const c = (await fec(`/committee/${id}/`, {})).results?.[0];
      conduitNames.set(id, c?.name || id);
    }
    return conduitNames.get(id);
  };
  const summary = { complete: 0, pending: 0, failed: 0, skipped: 0 };
  for (const p of people) {
    if (p.skip || p.error) {
      summary[p.skip ? 'skipped' : 'failed']++;
      if (!dryRun && p.error) {
        await d1(
          `INSERT INTO member_progress (bioguide_id, cycle, status, last_error, attempts, updated_at) VALUES (?,?,?,?,1,?)
           ON CONFLICT(bioguide_id, cycle) DO UPDATE SET status=excluded.status, last_error=excluded.last_error,
             attempts=member_progress.attempts+1, updated_at=excluded.updated_at`,
          [p.id, cycle, 'failed', p.error, now()]
        );
      }
      continue;
    }
    const recon = p.pool.map(id => ({ committeeId: id, ...committees.get(id) }));
    const ok = recon.every(r => r.status === 'reconciled' || r.status === 'reconciled-with-note');
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
        reconciliation: {
          ok,
          notes,
          committees: recon.map(({ gapRows: _gap, earmarkedRows: _earmarked, ...r }) => r),
        },
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
      await d1(
        `INSERT INTO member_progress (bioguide_id, cycle, status, last_error, attempts, updated_at) VALUES (?,?,?,NULL,0,?)
         ON CONFLICT(bioguide_id, cycle) DO UPDATE SET status=excluded.status, last_error=NULL, attempts=0, updated_at=excluded.updated_at`,
        [p.id, cycle, 'done', now()]
      );
    }
  }

  const stats = {
    ...summary,
    fecCalls: fec.calls,
    kvReads: cf.stats.kvReads,
    kvWrites: cf.stats.kvWrites,
    d1RowsWritten: cf.stats.d1RowsWritten,
  };
  log('summary', JSON.stringify(stats));
  if (!dryRun) {
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

main().catch(error => {
  console.error(`refresh job failed: ${error.message}`);
  process.exit(1);
});
