#!/usr/bin/env node
/**
 * Every PAC in a frozen run's inputs, sorted by who it answers to
 * (scripts/refresh/lib/sponsors.mjs): its FEC fields, IRS status, group and
 * reason, as JSON and CSV. For the simulation report and for checking.
 *
 *   node scripts/simulate/sponsors-list.mjs --inputs FILE.inputs.json --irs DIR --out DIR
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { IRS_FILES, classifyPac, fecGroup, loadFacts, loadIrsIndex } from '../refresh/lib/sponsors.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const irsDir = arg('--irs');
const outDir = arg('--out', 'sponsors');
mkdirSync(outDir, { recursive: true });
const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();
const read = async sql => (await conn.runAndReadAll(sql)).getRowObjects();
const index = await loadIrsIndex(read, IRS_FILES.map(f => join(irsDir, `${f}.csv`)));
const facts = loadFacts();
const given = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of [...(m.gifts || []), ...(m.giftsToFunds || [])]) {
    given.set(id, (given.get(id) || 0) + amt);
  }
}
const out = {};
for (const [id, p] of Object.entries(inputs.pacs)) {
  const c = classifyPac(id, p, index, facts);
  out[id] = { ...c, fecGroup: fecGroup(p), given: given.get(id) || 0 };
}
writeFileSync(join(outDir, 'sponsors.json'), JSON.stringify(out));
const cell = v => (v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : `"${String(v).replace(/"/g, '""')}"`);
const rows = [
  ['id', 'name', 'type', 'designation', 'org_type', 'connected_org', 'irs_status', 'irs_subsection', 'irs_ein', 'irs_matched_on', 'group', 'fec_field_group', 'settled_by', 'unsettled', 'reason', 'given_to_members'].join(','),
];
for (const [id, c] of Object.entries(out).sort((a, b) => b[1].given - a[1].given)) {
  const p = inputs.pacs[id];
  rows.push(
    [id, p.name, p.type, p.designation, p.orgType, p.connectedOrg, c.irs?.status, c.irs?.subsection || c.irs?.subsections, c.irs?.ein, c.irs?.matchedOn, c.group, c.fecGroup, c.settledBy, Boolean(c.unsettled), c.reason, c.given]
      .map(cell)
      .join(',')
  );
}
writeFileSync(join(outDir, 'pacs.csv'), rows.join('\n'));
console.log(`${Object.keys(out).length} committees sorted; IRS names indexed: ${index.size}`);
