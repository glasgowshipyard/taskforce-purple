#!/usr/bin/env node
// READ-ONLY trial of person-level funding (#32/#41): discover each member's
// money vehicles from their crosswalk FEC IDs, combine totals, and print the
// working so every figure can be checked against fec.gov.
//   FEC_KEY=... node scripts/trials/person-funding-trial.mjs P000197 S000033 ...
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import {
  selectVehicles,
  classifyTransfers,
  combineVehicleTotals,
} from '../../workers/person-funding.js';

const KEY = process.env.FEC_KEY;
const CYCLE = 2026;
const usd = n => '$' + Math.round(n).toLocaleString('en-US');
let calls = 0;
async function fecRaw(path, params = {}) {
  const qs = new URLSearchParams({ api_key: KEY, per_page: '50', ...params });
  calls++;
  const res = await fetch(`https://api.open.fec.gov/v1${path}?${qs}`);
  if (!res.ok) throw new Error(`FEC ${res.status} ${path}`);
  await new Promise(r => setTimeout(r, 250));
  return res.json();
}
const fec = async (path, params) => (await fecRaw(path, params)).results || [];

// Transfers received on line 12 from committees, all pages (memo rows are
// individual allocations and are excluded by contributor_type=committee).
async function transferRows(v) {
  const line =
    v.totals?.committee_type === 'H' || v.totals?.committee_type === 'S' ? 'F3-12' : 'F3X-12';
  const rows = [];
  let last = {};
  for (;;) {
    const d = await fecRaw('/schedules/schedule_a/', {
      committee_id: v.committeeId,
      two_year_transaction_period: String(CYCLE),
      line_number: line,
      contributor_type: 'committee',
      per_page: '100',
      ...last,
    });
    rows.push(...(d.results || []));
    const li = d.pagination?.last_indexes;
    if (!li || !(d.results || []).length) break;
    last = {
      last_index: li.last_index,
      last_contribution_receipt_date: li.last_contribution_receipt_date,
    };
  }
  return rows;
}

const results = {};
for (const bioguide of process.argv.slice(2)) {
  const ids = FEC_CROSSWALK[bioguide] || [];
  const found = [];
  for (const id of ids) {
    found.push(...(await fec(`/candidate/${id}/committees/`)));
    found.push(...(await fec('/committees/', { sponsor_candidate_id: id })));
  }
  const vehicles = selectVehicles(found, CYCLE);
  for (const v of vehicles)
    v.totals = (await fec(`/committee/${v.committeeId}/totals/`, { cycle: CYCLE }))[0] || null;
  const rows = [];
  for (const v of vehicles)
    if (v.role !== 'joint' && v.totals) rows.push(...(await transferRows(v)));
  const transfers = classifyTransfers(vehicles, rows);
  for (const j of transfers.externalJfcs)
    j.totals = (await fec(`/committee/${j.committeeId}/totals/`, { cycle: CYCLE }))[0] || null;
  const r = combineVehicleTotals(vehicles, transfers);
  results[bioguide] = r;
  console.log(`\n${bioguide} [${ids.join(',')}]`);
  for (const v of r.vehicles)
    console.log(
      `   ${v.role.padEnd(10)} ${v.committeeId} ${usd(v.receipts).padStart(13)}  ${v.name.slice(0, 44)}`
    );
  for (const j of r.externalJfcs)
    console.log(
      `   via JFC   ${j.committeeId} ${usd(j.amount).padStart(13)}  ${j.name.slice(0, 44)} (transferred in)`
    );
  console.log(
    `   gross ${usd(r.vehicles.reduce((s, v) => s + v.receipts, 0))} - moved between own committees ${usd(r.internalTransfers)} = ${usd(r.totalRaised)}   invariants ${r.invariantsHold ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `   small ${usd(r.grassrootsDonations)} (${r.grassrootsPercent}%)  itemized ${usd(r.largeDonorDonations)}  PAC ${usd(r.pacMoney)}  party ${usd(r.partyMoney)}`
  );
}
console.log(`\nFEC calls: ${calls}`);
if (process.env.OUT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
}
