#!/usr/bin/env node
/**
 * Freeze the reference members' real grading inputs (REBUILD_SPEC Stage 3)
 * into workers/fixtures/reference-members.json, for the tests in
 * workers/reference-cases.test.js. Only the fields the grade reads: no donor
 * names. Re-run it on purpose, after a scoring change has been simulated
 * and agreed, never to make a failing test pass.
 *
 *   node scripts/verify/make-reference-fixtures.mjs
 */
import { writeFileSync } from 'node:fs';
import { RESULTS_DB, createCloudflare } from '../refresh/lib/cloudflare.mjs';

const MEMBERS = {
  S000033: 'Sanders: a movement donor base, S',
  O000172: 'AOC: itemized money counts as support (ballroom principle), S',
  P000197: 'Pelosi: graded on all her committees, never her campaign alone',
  A000383: 'Armstrong: no confirmed FEC identity, so no letter grade',
};
const RECORD_FIELDS = [
  'bioguideId',
  'name',
  'fecIdentityVerified',
  'financialsVerified',
  'financialsVerifiedCycle',
  'dataCycle',
  'totalRaised',
  'grassrootsDonations',
  'largeDonorDonations',
  'grassrootsPercent',
  'pacMoney',
  'partyMoney',
  'tier',
];

const cf = createCloudflare();
const out = { frozenAt: new Date().toISOString(), members: {} };
for (const [id, why] of Object.entries(MEMBERS)) {
  const record = JSON.parse(await cf.kvGet(`member:${id}`));
  const [row] = await cf.d1(
    RESULTS_DB,
    'SELECT grade, analysis FROM results WHERE bioguide_id = ? AND cycle = 2026',
    [id]
  );
  const grade = row?.grade ? JSON.parse(row.grade) : null;
  const analysis = row?.analysis ? JSON.parse(row.analysis) : null;
  out.members[id] = {
    why,
    record: {
      ...Object.fromEntries(RECORD_FIELDS.map(f => [f, record[f] ?? null])),
      // What the transparency penalty reads: each PAC's type and amount
      pacContributions: (record.pacContributions || []).map(p => ({
        committee_type: p.committee_type ?? null,
        designation: p.designation ?? null,
        amount: p.amount ?? p.contribution_receipt_amount ?? null,
      })),
    },
    personFunding: grade?.personFigures ? { ...grade.personFigures, invariantsHold: true } : null,
    analysis: analysis
      ? {
          uniqueDonors: analysis.uniqueDonors,
          totalAmount: analysis.totalAmount,
          nakamotoCoefficient: analysis.nakamotoCoefficient,
          top10Concentration: analysis.top10Concentration,
        }
      : null,
    expected: grade
      ? {
          tier: grade.tier,
          gradeBasis: grade.gradeBasis,
          trustAnchorBasis: grade.detail?.trustAnchorBasis ?? null,
        }
      : { tier: 'UNVERIFIED' },
  };
  console.log(`${id}: ${why} -> ${out.members[id].expected.tier}`);
}
const path = new URL('../../workers/fixtures/reference-members.json', import.meta.url);
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`written ${path.pathname}`);
