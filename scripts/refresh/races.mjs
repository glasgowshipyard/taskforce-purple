#!/usr/bin/env node
/**
 * The 2026 races (ROADMAP Phase E; owner's go 2026-10-07): grade every
 * candidate in November's general election, not only sitting members, and
 * publish the races to KV `races:list` for the site's Races view.
 *
 *   node scripts/refresh/races.mjs [--cycle 2026] [--dry-run] [--field 12g|test]
 *     [--states ME,PA] [--batch 100] [--bulk-dir DIR] [--out races.json]
 *
 * Who's on the ballot comes from the FEC alone: only general-election
 * candidates file the pre-general report (12G, due 22 October). `--field
 * test` takes House and Senate candidates who raised $500,000 or more
 * instead, for building before the 22nd; that includes primary losers, so
 * it is always a dry run.
 *
 * Sitting members keep the grade the refresh job gives them (members:list).
 * Everyone else is graded here exactly like a member: all their committees,
 * from the FEC's bulk files, shown as still being double-checked (grade
 * first, confirm after). Their identity is the FEC's candidate ID.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { gradeMember } from '../../workers/grading.js';
import { LIST_KEY, sameValue } from '../../workers/member-store.js';
import { cycleForYear } from '../../workers/tier-calculation.js';
import { analyzePool, loadFara } from './lib/analysis.mjs';
import { ensureBulkFile, loadBulk } from './lib/bulk.mjs';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { discoverPeople, ensureZip, loadDiscoveryFiles } from './lib/discovery.mjs';
import { createFecClient } from './lib/fec.mjs';
import { buildRaces, displayName, parseWeball } from './lib/races.mjs';

export const RACES_KEY = 'races:list';
const TEST_FLOOR = 500000;

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

// Committees that filed the pre-general report: the general-election field
async function preGeneralFilers(fec, cycle) {
  const ids = new Set();
  for (let page = 1; ; page++) {
    const d = await fec('/filings/', {
      report_type: '12G',
      cycle,
      form_type: 'F3',
      per_page: 100,
      page,
    });
    for (const f of d.results || []) {
      ids.add(f.committee_id);
    }
    if (page >= (d.pagination?.pages || 1)) {
      return ids;
    }
  }
}

async function main() {
  const started = Date.now();
  const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
  const field = arg('--field', '12g');
  const dryRun = process.argv.includes('--dry-run') || field === 'test';
  const states = arg('--states', '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const batchSize = Number(arg('--batch', 100));
  const bulkDir = arg('--bulk-dir', join(tmpdir(), 'tfp-bulk'));
  mkdirSync(bulkDir, { recursive: true });

  const cf = createCloudflare();
  const fec = createFecClient(fecKey());
  const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);

  // The FEC's files: donations, committees and links, candidate summaries
  const file = ensureBulkFile(cycle, bulkDir, log);
  const db = await loadDiscoveryFiles(cycle, bulkDir, log);
  const weball = parseWeball(
    readFileSync(
      ensureZip('weball', `weball${String(cycle).slice(2)}.txt`, cycle, bulkDir, log),
      'latin1'
    )
  );

  // 1. The field
  let fieldIds;
  if (field === 'test') {
    fieldIds = [...weball.values()].filter(c => c.receipts >= TEST_FLOOR).map(c => c.candidateId);
  } else {
    const filers = [...(await preGeneralFilers(fec, cycle))];
    const links = filers.length
      ? await db.read(
          `SELECT DISTINCT candidate_id FROM ccl WHERE cycle = ? AND committee_id IN (${filers.map(() => '?').join(',')})`,
          String(cycle),
          ...filers
        )
      : [];
    fieldIds = links.map(l => l.candidate_id).filter(id => weball.has(id));
    log(`pre-general reports: ${filers.length} committees, ${fieldIds.length} candidates`);
  }
  let field_ = fieldIds.map(id => weball.get(id));
  if (states.length) {
    field_ = field_.filter(c => states.includes(c.state));
  }

  // 2. Sitting members keep their published grade
  const memberOf = new Map();
  for (const [bioguideId, ids] of Object.entries(FEC_CROSSWALK)) {
    for (const id of ids) {
      memberOf.set(id, bioguideId);
    }
  }
  const list = JSON.parse((await cf.kvGet(LIST_KEY)) || '{"members":[]}').members;
  const listById = new Map(list.map(m => [m.bioguideId, m]));
  const members = field_.filter(c => memberOf.has(c.candidateId));
  const others = field_.filter(c => !memberOf.has(c.candidateId));
  log(
    `field (${field}${states.length ? `, ${states.join(',')}` : ''}): ${field_.length} candidates, ${members.length} sitting members, ${others.length} to grade`
  );

  // 3. Grade everyone else, like a member
  const discovered = await discoverPeople({
    fec,
    db,
    people: others.map(c => ({ id: c.candidateId, ids: [c.candidateId] })),
    cycle,
    log,
  });
  const names = new Map((await db.read('SELECT id, name FROM cm')).map(c => [c.id, c.name]));
  const fara = await d1(
    'SELECT employer, fara_firm, registration_number FROM fara_employer_matches'
  );
  const graded = new Map();
  for (let b = 0; b < others.length; b += batchSize) {
    const batch = others.slice(b, b + batchSize);
    const ids = [
      ...new Set(batch.flatMap(c => discovered.get(c.candidateId)?.donorCommitteeIds || [])),
    ];
    const bulk = await loadBulk(file.path, ids.length ? ids : ['C00000000']);
    await loadFara(bulk, fara);
    for (const c of batch) {
      const pf = discovered.get(c.candidateId);
      if (!pf?.donorCommitteeIds?.length) {
        graded.set(c.candidateId, {
          status: 'pending',
          pf: pf || null,
          analysis: null,
          grade: null,
        });
        continue;
      }
      const analysis = await analyzePool(bulk, pf.donorCommitteeIds, {
        conduitName: async id => names.get(id) || id,
      });
      const grade = gradeMember(
        {
          bioguideId: c.candidateId,
          name: c.name,
          party: c.party,
          state: c.state,
          totalRaised: pf.totalRaised,
          grassrootsDonations: pf.grassrootsDonations,
          largeDonorDonations: pf.largeDonorDonations,
          grassrootsPercent: pf.grassrootsPercent,
          pacMoney: pf.pacMoney,
          partyMoney: pf.partyMoney,
          // The identity is the FEC's own candidate ID: nothing inferred
          fecIdentityVerified: true,
          pacContributions: [],
        },
        {
          ...analysis,
          personLevel: true,
          personFunding: pf,
          reconciliation: { ok: false, pending: true },
        }
      );
      graded.set(c.candidateId, { status: 'provisional', pf, analysis, grade });
    }
    log(`graded ${Math.min(b + batchSize, others.length)} of ${others.length}`);
  }

  // 4. The races, everyone side by side
  const entry = c => {
    const bioguideId = memberOf.get(c.candidateId) || null;
    const base = {
      candidateId: c.candidateId,
      bioguideId,
      name: displayName(c.name),
      party: c.party,
      ici: c.ici,
      office: c.office,
      state: c.state,
      district: c.district,
    };
    if (bioguideId) {
      const m = listById.get(bioguideId) || {};
      const pf = m.gradeBasis === 'all-committees' && m.personFigures ? m.personFigures : m;
      return {
        ...base,
        name: m.name || base.name,
        tier: m.tier || null,
        evidenceChecked: m.evidenceChecked ?? null,
        totalRaised: pf.totalRaised ?? null,
        smallDonors: pf.grassrootsDonations ?? null,
        largeDonors: pf.largeDonorDonations ?? null,
        pac: pf.pacMoney ?? null,
        nakamoto: m.nakamotoCoefficient ?? null,
      };
    }
    const g = graded.get(c.candidateId) || {};
    return {
      ...base,
      tier: g.grade?.tier || null,
      evidenceChecked: g.grade ? g.grade.evidenceChecked : null,
      totalRaised: g.pf?.totalRaised ?? c.receipts,
      smallDonors: g.pf?.grassrootsDonations ?? null,
      largeDonors: g.pf?.largeDonorDonations ?? null,
      pac: g.pf?.pacMoney ?? null,
      uniqueDonors: g.analysis?.uniqueDonors ?? null,
      nakamoto: g.analysis?.nakamotoCoefficient ?? null,
    };
  };
  const races = buildRaces(field_.map(entry));
  const tiers = {};
  for (const g of graded.values()) {
    const t = g.grade?.tier || 'pending';
    tiers[t] = (tiers[t] || 0) + 1;
  }
  log(`${races.length} races; challengers' and open-seat grades: ${JSON.stringify(tiers)}`);
  for (const r of races.slice(0, 3)) {
    log(
      `  ${r.state} ${r.label}: ${r.candidates.map(c => `${c.name} (${c.party}${c.ici === 'I' ? ', incumbent' : ''}) ${c.tier || '-'}`).join(' | ')}`
    );
  }

  const out = arg('--out', null);
  if (out) {
    writeFileSync(out, JSON.stringify({ cycle, field, races }, null, 1));
    log(`races written to ${out}`);
  }
  if (dryRun) {
    log(`dry run${field === 'test' ? ' (test field)' : ''}: nothing written`);
  } else {
    // Each graded candidate, written only if something changed
    for (const c of others) {
      const g = graded.get(c.candidateId);
      await d1(
        `INSERT INTO race_candidates (candidate_id, cycle, office, state, district, name, party, ici, computed_at, pool, analysis, grade, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(candidate_id, cycle) DO UPDATE SET name=excluded.name, party=excluded.party, ici=excluded.ici,
           computed_at=excluded.computed_at, pool=excluded.pool, analysis=excluded.analysis, grade=excluded.grade,
           status=excluded.status
         WHERE race_candidates.pool IS NOT excluded.pool OR race_candidates.analysis IS NOT excluded.analysis
           OR race_candidates.grade IS NOT excluded.grade OR race_candidates.status IS NOT excluded.status`,
        [
          c.candidateId,
          cycle,
          c.office,
          c.state,
          c.district,
          c.name,
          c.party,
          c.ici,
          now(),
          g.pf
            ? JSON.stringify({
                committees: g.pf.committees,
                donorCommitteeIds: g.pf.donorCommitteeIds,
                totals: { totalRaised: g.pf.totalRaised, raisedInName: g.pf.raisedInName },
              })
            : null,
          g.analysis ? JSON.stringify(g.analysis) : null,
          g.grade
            ? JSON.stringify({
                tier: g.grade.tier,
                individualFundingPercent: g.grade.individualFundingPercent,
                gradeBasis: g.grade.gradeBasis,
                personFigures: g.grade.personFigures,
                evidenceChecked: g.grade.evidenceChecked,
                detail: g.grade.detail,
              })
            : null,
          g.status,
        ]
      );
    }
    // The races list: one KV write, only if it changed
    const body = { cycle, field, races };
    const current = JSON.parse((await cf.kvGet(RACES_KEY)) || 'null');
    if (current && sameValue({ ...current, updatedAt: undefined }, body)) {
      log('races list unchanged');
    } else {
      await cf.kvPut(RACES_KEY, JSON.stringify({ ...body, updatedAt: now() }));
      log(`published ${races.length} races`);
    }
    // Charge D1's own figures to the job's ledger
    await d1(
      `INSERT INTO d1_write_budget (day, rows_written, rows_read) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written,
         rows_read = rows_read + excluded.rows_read`,
      [now().slice(0, 10), cf.stats.d1RowsWritten + 1, cf.stats.d1RowsRead]
    );
  }
  log(
    `done in ${Math.round((Date.now() - started) / 60000)} min: ${fec.calls} FEC calls, ${cf.stats.d1RowsWritten} D1 rows written, ${cf.stats.kvWrites} KV writes`
  );
}

main().catch(error => {
  console.error(`races job failed: ${error.message}`);
  process.exit(1);
});
