#!/usr/bin/env node
/**
 * Production's FINAL-3 grading (workers/tier-calculation.js gradeFinal3)
 * against the simulation's (lib/grid.mjs) on an export: every member must
 * get the same grade, score and unrounded score.
 *   node scripts/simulate/check-final3.mjs --inputs FILE.inputs.json --irs DIR
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  IRS_FILES,
  classifyPac,
  loadFacts,
  loadIrsIndex,
  loadPeopleEvidence,
  peopleTest,
} from '../refresh/lib/sponsors.mjs';
import { final3PacShares, gradeFinal3 } from '../../workers/tier-calculation.js';
import { LIVE, runGrid } from './lib/grid.mjs';

const arg = name => process.argv[process.argv.indexOf(name) + 1];
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const conn = await (await DuckDBInstance.create(':memory:')).connect();
const index = await loadIrsIndex(
  async sql => (await conn.runAndReadAll(sql)).getRowObjects(),
  IRS_FILES.map(f => join(arg('--irs'), `${f}.csv`))
);
const facts = loadFacts();
const { forms, stated, minority } = loadPeopleEvidence();
const pacs = {};
for (const [id, p] of Object.entries(inputs.pacs)) {
  const sponsor = classifyPac(id, p, index, facts, p.fecRecord);
  pacs[id] = { ...p, sponsor, peopleTest: peopleTest(id, sponsor, forms, stated, { minority }) };
}
const CFG = {
  ...LIVE,
  F1: true,
  F2: true,
  F8cov: true,
  F8split: true,
  F9: true,
  F11: true,
  bar: false,
  denominator: 'given',
  allowance: 'min',
  fixedInvariant: true,
  noMinDonors: true,
  wholeFunds: true,
  groups: {
    credit: { people: 1 },
    source: 'tfp',
    upstreamZero: true,
    upstreamByCredit: true,
    peopleTest: true,
  },
  nonOwnAsPolitician: true,
  directedAsGifts: true,
};
const sim = runGrid({ ...inputs, pacs }, CFG).results;
const shares = final3PacShares(pacs);
let bad = 0;
const tiers = {};
for (const m of inputs.members) {
  const a = sim.get(m.id);
  const b = gradeFinal3(m, pacs, shares);
  const simTier = a.tier === 'WITHHELD' ? 'N/A' : a.tier;
  tiers[b.tier] = (tiers[b.tier] || 0) + 1;
  if (
    simTier !== b.tier ||
    (a.score ?? null) !== (b.score ?? null) ||
    (a.x ?? null) !== (b.x ?? null)
  ) {
    bad++;
    if (bad <= 10) {
      console.log(
        `${m.name}: sim ${a.tier} ${a.score} ${a.x}; production ${b.tier} ${b.score} ${b.x}`
      );
    }
  }
}
console.log(`${inputs.members.length} members, ${bad} differ`, tiers);
process.exit(bad ? 1 : 0);
