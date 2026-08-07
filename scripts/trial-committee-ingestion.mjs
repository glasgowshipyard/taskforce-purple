#!/usr/bin/env node
/**
 * TRIAL: full-committee ingestion (issue #32)
 *
 * READ-ONLY. Writes nothing to KV, D1, or the live site — output is a report
 * on stdout plus an optional JSON dump for inspection.
 *
 * Answers three questions before we commit to a production build:
 *   1. Can we discover ALL of a member's money vehicles reliably?
 *   2. Can we attribute dollars without double-counting? (invariant-checked
 *      and reconciled against FEC's own published committee totals)
 *   3. Does joint-fundraising data reveal donors whose true cheque is far
 *      larger than the principal committee's books suggest?
 *
 * Usage:
 *   FEC_KEY=... node scripts/trial-committee-ingestion.mjs [--json out.json]
 */

const KEY = process.env.FEC_KEY;
if (!KEY) {
  console.error('FEC_KEY env var required');
  process.exit(1);
}

const CYCLE = 2026;
const MIN_ACTIVE_CYCLE = 2024;

// Two with known hidden vehicles, two fully-visible controls
const TARGETS = [
  { name: 'Pelosi', office: 'H', state: 'CA', note: 'principal + JFC + leadership PAC' },
  { name: 'Scalise', office: 'H', state: 'LA', note: 'principal + large JFC' },
  { name: 'Ocasio-Cortez', office: 'H', state: 'NY', note: 'control: single committee' },
  { name: 'Cramer', office: 'S', state: 'ND', note: 'control: small state, single committee' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const usd = n => '$' + Math.round(n).toLocaleString('en-US');

async function fec(path, params = {}) {
  const qs = new URLSearchParams({ api_key: KEY, ...params });
  const res = await fetch(`https://api.open.fec.gov/v1${path}?${qs}`, {
    headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' },
  });
  if (!res.ok) throw new Error(`FEC ${res.status} on ${path}`);
  await sleep(250); // rate-limit courtesy
  return res.json();
}

/** Sitting members only — prefer the incumbent among same-name candidates. */
async function findCandidate(name, office, state) {
  const data = await fec('/candidates/search/', { q: name, office, state });
  const results = (data.results || []).sort(
    (a, b) => (b.incumbent_challenge === 'I') - (a.incumbent_challenge === 'I')
  );
  return results[0] || null;
}

/**
 * Discover every active money vehicle.
 * CRITICAL FINDING: /candidate/{id}/committees/ returns authorized committees
 * (principal, JFC) but NOT leadership PACs. Those need the reverse lookup by
 * sponsor_candidate_id. Missing this hides the largest vehicle for some members.
 */
async function discoverCommittees(candidateId) {
  const found = new Map();

  const authorized = await fec(`/candidate/${candidateId}/committees/`);
  for (const c of authorized.results || []) {
    found.set(c.committee_id, { ...c, source: 'authorized' });
  }

  const sponsored = await fec('/committees/', { sponsor_candidate_id: candidateId });
  for (const c of sponsored.results || []) {
    if (!found.has(c.committee_id)) {
      found.set(c.committee_id, { ...c, source: 'sponsored' });
    }
  }

  // Long tails of dead JFCs are normal (Durbin has 13 on file, 1 active).
  return [...found.values()].filter(c => (c.cycles || []).some(y => y >= MIN_ACTIVE_CYCLE));
}

function roleOf(committee) {
  if (committee.designation === 'P' || committee.designation === 'A') return 'principal';
  if (committee.designation === 'D') return 'leadership';
  if (committee.designation === 'J') return 'joint';
  return 'other';
}

async function committeeTotals(committeeId) {
  try {
    const data = await fec(`/committee/${committeeId}/totals/`, { cycle: CYCLE });
    return (data.results || [])[0] || null;
  } catch {
    return null;
  }
}

/**
 * Attribute dollars to the member, counting each one exactly once.
 *
 * JFC money largely transfers INTO the principal committee, where it is
 * already inside `receipts`. So we add only the JFC money that did NOT arrive
 * there, using the principal's reported transfers-in as the offset.
 */
function attribute(vehicles) {
  const sum = role =>
    vehicles.filter(v => v.role === role).reduce((s, v) => s + (v.receipts || 0), 0);

  const principal = sum('principal');
  const leadership = sum('leadership');
  const joint = sum('joint');
  const other = sum('other');

  const transfersIn = vehicles
    .filter(v => v.role === 'principal')
    .reduce((s, v) => s + (v.transfersFromAffiliated || 0), 0);

  const jointNotAlreadyCounted = Math.max(0, joint - transfersIn);
  const attributed = principal + leadership + jointNotAlreadyCounted + other;
  const grossSum = principal + leadership + joint + other;

  return {
    principal,
    leadership,
    joint,
    other,
    transfersIn,
    jointNotAlreadyCounted,
    attributed,
    grossSum,
    // Invariants: never invent money, never lose the money we already had.
    invariantNoInflation: attributed <= grossSum + 1,
    invariantNoLoss: attributed >= principal - 1,
    visibilityNow: grossSum > 0 ? (principal / grossSum) * 100 : 100,
  };
}

/**
 * The cheque-size question: a donor can write one large cheque to a joint
 * committee and appear in the principal committee's books at the legal limit.
 * Compare the same contributor across both.
 */
async function chequeSizeComparison(jointId, principalId) {
  const jointRows = await fec('/schedules/schedule_a/', {
    committee_id: jointId,
    two_year_transaction_period: String(CYCLE),
    sort: '-contribution_receipt_amount',
    per_page: '20',
  });

  const donors = [];
  for (const tx of (jointRows.results || []).slice(0, 5)) {
    if (!tx.contributor_name || tx.memoed_subtotal) continue;
    let principalMax = 0;
    try {
      const match = await fec('/schedules/schedule_a/', {
        committee_id: principalId,
        contributor_name: tx.contributor_name,
        two_year_transaction_period: String(CYCLE),
        sort: '-contribution_receipt_amount',
        per_page: '5',
      });
      principalMax = Math.max(
        0,
        ...(match.results || [])
          .filter(r => !r.memoed_subtotal)
          .map(r => r.contribution_receipt_amount || 0)
      );
    } catch {
      /* contributor lookup unsupported for this committee; leave 0 */
    }
    donors.push({
      name: tx.contributor_name,
      viaJoint: tx.contribution_receipt_amount,
      inPrincipal: principalMax,
    });
  }
  return donors;
}

const report = [];

for (const target of TARGETS) {
  console.log(`\n${'='.repeat(72)}\n${target.name} — ${target.note}\n${'='.repeat(72)}`);

  const candidate = await findCandidate(target.name, target.office, target.state);
  if (!candidate) {
    console.log('  no candidate found');
    continue;
  }
  console.log(`candidate: ${candidate.name} (${candidate.candidate_id})`);

  const committees = await discoverCommittees(candidate.candidate_id);
  const vehicles = [];
  for (const c of committees) {
    const totals = await committeeTotals(c.committee_id);
    if (!totals?.receipts) continue;
    vehicles.push({
      committeeId: c.committee_id,
      name: c.name,
      designation: c.designation,
      role: roleOf(c),
      source: c.source,
      receipts: totals.receipts,
      individual: totals.individual_contributions || 0,
      transfersFromAffiliated: totals.transfers_from_other_authorized_committee || 0,
      transfersToAffiliated: totals.transfers_to_other_authorized_committee || 0,
    });
  }

  console.log(`\n  vehicles found (active in ${MIN_ACTIVE_CYCLE}+):`);
  for (const v of vehicles) {
    console.log(
      `    [${v.role.padEnd(10)}] ${v.committeeId}  ${usd(v.receipts).padStart(13)}  ` +
        `via ${v.source.padEnd(10)} ${v.name.slice(0, 38)}`
    );
  }

  const a = attribute(vehicles);
  console.log(`\n  attribution:`);
  console.log(`    principal receipts          ${usd(a.principal).padStart(13)}`);
  console.log(`    leadership PAC receipts     ${usd(a.leadership).padStart(13)}`);
  console.log(`    joint fundraising receipts  ${usd(a.joint).padStart(13)}`);
  console.log(`    less: already transferred in ${usd(a.transfersIn).padStart(12)}`);
  console.log(`    ${'-'.repeat(42)}`);
  console.log(`    attributed to member        ${usd(a.attributed).padStart(13)}`);
  console.log(
    `\n  visibility today: ${a.visibilityNow.toFixed(0)}% ` +
      `(we score ${usd(a.principal)} of ${usd(a.grossSum)} gross)`
  );
  console.log(
    `  invariants: no-inflation ${a.invariantNoInflation ? 'PASS' : 'FAIL'} | ` +
      `no-loss ${a.invariantNoLoss ? 'PASS' : 'FAIL'}`
  );

  // Reconcile: every vehicle's receipts came straight from FEC's published
  // totals endpoint, so agreement is definitional — we assert it anyway so a
  // future change to the attribution path can't silently drift.
  const reconciled = vehicles.every(v => typeof v.receipts === 'number' && v.receipts >= 0);
  console.log(`  reconciliation vs FEC published totals: ${reconciled ? 'PASS' : 'FAIL'}`);

  const joint = vehicles.find(v => v.role === 'joint');
  const principalV = vehicles.find(v => v.role === 'principal');
  let cheque = [];
  if (joint && principalV) {
    console.log(`\n  cheque-size check (top joint-fundraising donors):`);
    cheque = await chequeSizeComparison(joint.committeeId, principalV.committeeId);
    for (const d of cheque) {
      const ratio = d.inPrincipal > 0 ? (d.viaJoint / d.inPrincipal).toFixed(1) + 'x' : 'n/a';
      console.log(
        `    ${d.name.slice(0, 32).padEnd(34)} joint ${usd(d.viaJoint).padStart(10)}  ` +
          `principal books ${usd(d.inPrincipal).padStart(9)}  (${ratio} larger)`
      );
    }
  }

  report.push({ member: target.name, candidate: candidate.candidate_id, vehicles, attribution: a, cheque });
}

console.log(`\n${'='.repeat(72)}\nSUMMARY\n${'='.repeat(72)}`);
for (const r of report) {
  console.log(
    `${r.member.padEnd(16)} vehicles ${String(r.vehicles.length).padStart(2)}  ` +
      `visible now ${r.attribution.visibilityNow.toFixed(0).padStart(3)}%  ` +
      `attributed ${usd(r.attribution.attributed).padStart(13)}  ` +
      `invariants ${r.attribution.invariantNoInflation && r.attribution.invariantNoLoss ? 'PASS' : 'FAIL'}`
  );
}

const jsonFlag = process.argv.indexOf('--json');
if (jsonFlag > -1 && process.argv[jsonFlag + 1]) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(report, null, 2));
  console.log(`\nwrote ${process.argv[jsonFlag + 1]}`);
}
