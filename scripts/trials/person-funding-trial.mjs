#!/usr/bin/env node
// READ-ONLY trial of person-level funding (#32/#41) using the same
// fetchPersonFunding the pipeline uses. Prints the working so every figure
// can be checked against fec.gov.
//   FEC_KEY=... [OUT=result.json] node scripts/trials/person-funding-trial.mjs P000197 ...
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { fetchPersonFunding } from '../../workers/person-funding.js';

const KEY = process.env.FEC_KEY;
const CYCLE = 2026;
const usd = n => '$' + Math.round(n).toLocaleString('en-US');
let calls = 0;
async function fec(path, params = {}) {
  const qs = new URLSearchParams({
    api_key: KEY,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  calls++;
  const res = await fetch(`https://api.open.fec.gov/v1${path}?${qs}`);
  if (!res.ok) throw new Error(`FEC ${res.status} ${path}`);
  await new Promise(r => setTimeout(r, 1100)); // FEC: 60 requests per minute per key
  return res.json();
}

const results = {};
for (const bioguide of process.argv.slice(2)) {
  const before = calls;
  const r = await fetchPersonFunding(fec, FEC_CROSSWALK[bioguide] || [], CYCLE);
  results[bioguide] = r;
  console.log(`\n${bioguide}  (${calls - before} FEC calls)`);
  for (const c of r.committees) {
    const big =
      c.bigCheques != null && c.raised > 0
        ? ` $2,000+ ${Math.round((c.bigCheques / c.raised) * 100)}%`
        : '';
    const jfc =
      c.role === 'joint'
        ? `  to member ${usd(c.toMember)}, passed elsewhere ${usd(c.passedElsewhere)}${c.ownFund ? ' [own fund]' : ' [shared]'}${c.registered ? ' [registered]' : ''}`
        : '';
    console.log(
      `   ${c.role.padEnd(10)} ${c.committeeId} raised ${usd(c.raised).padStart(12)}${big}${jfc}  ${c.name.slice(0, 36)}`
    );
  }
  console.log(
    `   RECEIVED ${usd(r.totalRaised)} (internal moves netted ${usd(r.internalTransfers)})  |  RAISED IN NAME ${usd(r.raisedInName)}  | invariants ${r.invariantsHold ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `   small ${r.grassrootsPercent}%  itemized ${usd(r.largeDonorDonations)}  PAC ${usd(r.pacMoney)}  | donor pool: ${r.donorCommitteeIds.join(',')}`
  );
}
console.log(`\nFEC calls: ${calls}`);
if (process.env.OUT)
  (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
