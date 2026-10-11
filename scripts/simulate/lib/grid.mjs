// The simplification simulation's grading (owner's brief, 2026-10-11): one
// pure function that grades a member under any of the settings being tested,
// from the inputs the frozen run exports (lib/inputs.mjs, run.mjs --report).
// R0 (the live rules) must give exactly the live grade: the report checks it
// against the production code's own grade for every member.
//
// "Allowance": the share of what people gave that big donations may make up
// before the rest stops counting.

import { pacType } from '../../../src/lib/pacs.js';
import { PAC_WEIGHTS, getPACTransparencyWeight } from '../../../workers/tier-calculation.js';

export const BANDS = [
  ['S', 90],
  ['A', 75],
  ['B', 60],
  ['C', 45],
  ['D', 30],
  ['E', 15],
];
export const RANK = { S: 8, A: 7, B: 6, C: 5, D: 4, E: 3, F: 2, 'N/A': 1 };
const FALLBACK = 0.4; // the allowance when the donor data isn't reliable
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** The live rules (R0). Every run is this with some things changed. */
export const LIVE = {
  F1: false, // grade on the rounded score
  F2: false, // withhold grades that mix stored and new figures
  F8cov: false, // PACs: the record-coverage check
  F8split: false, // PACs: the FEC's own small/big split
  F9: false, // credited PAC gifts never above PAC money received
  F11: false, // members: only donors who net above $0
  bar: true, // the PAC bar (super PACs, other politicians' PACs)
  denominator: 'raised', // 'raised': T - own money; 'given': s + b + p + y
  allowance: 'table', // table | table100 | smooth | count | min | cap
  cap: null, // variant D: each donor counted up to $cap
  credit: 0.5,
  trace: 2, // 1: a PAC's own donors; 2: also the donors of committees that fund it
  untracedAsPeople: false, // party, other campaigns and joint-fund PAC money at 100%
  recordsOnly: false, // amendment 4: test concentration on the records we have
  // The coverage test without reports the FEC's totals include but our
  // records don't (snapshot flags): Map committee id -> missing big-donor $
  withoutMissing: null,
  // Second round (owner, 2026-10-11):
  // PAC money by who the PAC answers to (sponsorGroup): null, or
  // { credit: { people, nosponsor, money, politician }, unclearAs, upstreamZero }
  groups: null,
  jfcProRata: false, // item 6: joint-fund gifts counted only for what reached the member
  noMinDonors: false, // item 7: no "fewer than 10 donors" fallback
  fixedInvariant: false, // item 9: the transfer check net of own-committee transfers
};

/**
 * Who a PAC answers to, from FEC fields only (owner, 2026-10-11):
 *   politician  leadership PACs (designation D), joint funds (J), candidates'
 *               committees (type H/S/P or designation P/A)
 *   people      sponsor is a labor (ORG_TP L) or membership (M) organisation
 *   money       sponsor is a corporation (C) or trade association (T)
 *   unclear     cooperative (V), corporation without capital stock (W), or a
 *               connected organisation named with no type given
 *   nosponsor   no sponsor type and no connected organisation
 */
export function sponsorGroup(p) {
  const desig = p?.designation;
  if (
    desig === 'D' ||
    desig === 'J' ||
    desig === 'P' ||
    desig === 'A' ||
    ['H', 'S', 'P'].includes(p?.type)
  ) {
    return 'politician';
  }
  const org = p?.orgType;
  if (org === 'L' || org === 'M') {
    return 'people';
  }
  if (org === 'C' || org === 'T') {
    return 'money';
  }
  if (org === 'V' || org === 'W') {
    return 'unclear';
  }
  const conn = String(p?.connectedOrg || '')
    .trim()
    .toUpperCase();
  return conn && conn !== 'NONE' ? 'unclear' : 'nosponsor';
}
const resolveGroup = (p, cfg) => {
  const g = sponsorGroup(p);
  return g === 'unclear' ? cfg.groups.unclearAs : g;
};

/**
 * The allowance (0-1) from n (fewest donors holding half the big-donor
 * money) and N (number of big donors). Unreliable data: 0.40.
 */
export function allowance(kind, n0, N0, reliable) {
  if (!reliable) {
    return FALLBACK;
  }
  // No records: no donors (only reached with no big money to test)
  const n = Number(n0) || 0;
  const N = Number(N0) || 0;
  const share = N > 0 ? n / N : 0;
  // As tier-calculation.js getTrustAnchor computes it, to the last bit
  const percent = N > 0 ? (n / N) * 100 : 0;
  const table = top => (n < 50 ? 0.1 : percent < 5 ? 0.25 : percent < 10 ? 0.4 : top);
  const smooth = 0.1 + 0.9 * clamp((share - 0.025) / 0.075, 0, 1);
  const count = Math.min(1, n / 100);
  switch (kind) {
    case 'table':
      return table(0.5);
    case 'table100':
      return table(1);
    case 'smooth':
      return smooth;
    case 'count':
      return count;
    case 'min':
      return Math.min(smooth, count);
    default:
      throw new Error(`allowance: unknown kind ${kind}`);
  }
}

/** Big-donor money that counts: within the allowance, or each donor capped (D). */
function countedBig(b, I, a, cfg, cappedShare, reliable) {
  if (cfg.allowance === 'cap') {
    return reliable && cappedShare !== null ? b * cappedShare : Math.min(b, FALLBACK * I);
  }
  return Math.min(b, a * I);
}

/** One PAC's inputs as a run sees them. */
function pacView(p, cfg) {
  const prof = p?.profile;
  if (!prof?.receipts || prof.receipts <= 0) {
    return null;
  }
  let R = prof.receipts;
  let ind = Math.max(0, Math.min(prof.individuals || 0, R));
  let it = Math.max(0, Math.min(prof.itemized || 0, ind));
  if (cfg.F8split && p.fec && num(p.fec.receipts) > 0) {
    R = num(p.fec.receipts);
    ind = Math.max(0, Math.min(num(p.fec.unitemized) + num(p.fec.itemized), R));
    it = Math.max(0, Math.min(num(p.fec.itemized), ind));
  }
  const records = prof.itemized || 0; // the PAC's donors' money in our records
  const N = prof.donors ?? 0;
  const n = prof.nakamoto;
  const hasRecords = n !== null && n !== undefined && N > 0;
  // Item 7: no minimum number of donors; big money with no records at all
  // still can't be tested
  let reliable = cfg.noMinDonors ? hasRecords || it <= 0 : hasRecords && N >= 10;
  if (reliable && cfg.F8cov && p.fec && num(p.fec.itemized) > 0) {
    const fecItemized = num(p.fec.itemized) - num(cfg.withoutMissing?.get(p.id));
    reliable = fecItemized <= 0 || records >= 0.5 * fecItemized;
  }
  const cappedShare =
    cfg.allowance === 'cap' && records > 0 && p.extras?.capped
      ? Math.min(1, num(p.extras.capped[cfg.cap]) / records)
      : null;
  return { R, ind, it, n, N, reliable, cappedShare };
}

/**
 * Every PAC's share of money traced to people under a run's settings:
 * Map id -> { 1: share, 2: share, fallback }. `pacs`: the export's PACs.
 */
export function pacShares(pacs, cfg) {
  const one = new Map();
  const views = new Map();
  for (const [id, p] of Object.entries(pacs)) {
    const v = pacView({ ...p, id }, cfg);
    views.set(id, v);
    if (!v) {
      one.set(id, { share: 0, traceable: 0 });
      continue;
    }
    const a = allowance(cfg.allowance === 'cap' ? 'table' : cfg.allowance, v.n, v.N, v.reliable);
    let share;
    if (cfg.allowance === 'cap') {
      share = (v.ind - v.it + countedBig(v.it, v.ind, a, cfg, v.cappedShare, v.reliable)) / v.R;
    } else {
      // As tier-calculation.js pacPeopleShare: raw share less the excess
      const raw = (v.ind / v.R) * 100;
      const itemizedPercent = v.ind > 0 ? (v.it / v.ind) * 100 : 0;
      share = (raw - (Math.max(0, itemizedPercent - a * 100) / 100) * raw) / 100;
    }
    one.set(id, { share: clamp(share, 0, 1), traceable: Math.min(1, v.ind / v.R) });
  }
  const out = new Map();
  for (const [id, p] of Object.entries(pacs)) {
    const v = views.get(id);
    const s1 = one.get(id).share;
    let s2 = s1;
    if (v) {
      const up = (p.upstream || []).filter(u => u.amount > 0 && one.get(u.id)?.traceable > 0);
      const B = up.reduce((t, u) => t + u.amount, 0);
      const traced = Math.min(v.R - v.ind, B);
      // E-S: money a PAC got from a MONEY or ONE POLITICIAN committee counts 0
      const upShare = u =>
        cfg.groups?.upstreamZero && ['money', 'politician'].includes(resolveGroup(pacs[u.id], cfg))
          ? 0
          : one.get(u.id).share;
      if (traced > 0) {
        s2 = s1 + (up.reduce((t, u) => t + u.amount * upShare(u), 0) / v.R) * (traced / B);
      }
    }
    out.set(id, { 1: s1, 2: clamp(s2, 0, 1), fallback: Boolean(v && !v.reliable) });
  }
  return out;
}

const ownOf = pf => num(pf.ownMoney?.contributions) + num(pf.ownMoney?.loans);
const vehiclePac = pf =>
  (pf.committees || [])
    .filter(c => c.role === 'campaign' || c.role === 'leadership')
    .reduce((t, c) => t + num(c.pac), 0);

/**
 * Is the member graded on all their committees (gate G3 passed)? With
 * `cfg.fixedInvariant` (item 9) the check allows for money a committee got
 * from the member's other committees: total >= the largest committee's
 * receipts less those transfers.
 */
export function personLevel(m, cfg = {}) {
  const pf = m.pf;
  const rec = m.reconciliation || {};
  let invariant = pf?.invariantsHold;
  if (pf && !invariant && cfg.fixedInvariant && m.internalIn) {
    const vehicles = (pf.committees || []).filter(c => c.role !== 'joint');
    const gross = vehicles.reduce((t, c) => t + num(c.raised), 0);
    const largest = Math.max(0, ...vehicles.map(c => num(c.raised) - num(m.internalIn[c.id])));
    invariant = pf.totalRaised <= gross + 1 && pf.totalRaised >= largest - 1;
  }
  return Boolean(pf && !pf.failed && pf.totalRaised > 0 && invariant && (rec.ok || rec.pending));
}

/** A grade from a score and a bar. */
export function band(score, bar) {
  for (const [letter, from] of BANDS) {
    if (score >= from + bar) {
      return letter;
    }
  }
  return 'F';
}

/**
 * One member under one run's settings. `shares`: pacShares(pacs, cfg).
 * `opts.ignoreInvariant`: grade a member who fails G3 on their figures (the
 * F2 side table). Returns everything the report and the CSV show.
 */
export function gradeOne(m, pacs, shares, cfg, opts = {}) {
  const pf = m.pf;
  const out = { id: m.id };
  if (!personLevel(m, cfg) && !opts.ignoreInvariant) {
    // G3: the live grade read the stored campaign figures; F2 withholds it
    if (cfg.F2) {
      return { ...out, tier: 'WITHHELD', reason: 'mixed-source', withheld: true };
    }
    return {
      ...out,
      tier: m.grade?.tier,
      score: m.grade?.score,
      x: m.grade?.score,
      bar: m.grade?.detail?.transparencyPenalty ?? 0,
      reason: 'stored-figures',
      production: true,
    };
  }
  const s = num(pf.grassrootsDonations);
  const b = num(pf.largeDonorDonations);
  const p = num(pf.pacMoney);
  const y = num(pf.partyMoney);
  const own = ownOf(pf);
  const T = num(pf.totalRaised);
  const fromOthers = T - own;
  const given = s + b + p + y;
  Object.assign(out, { s, b, p, y, own, T });

  // G4: own money that doesn't fit inside the receipts
  if (own > 0 && fromOthers < given * 0.98 - 1) {
    return { ...out, tier: 'DISPUTED', reason: 'own-money-exceeds-receipts', withheld: true };
  }
  const D = cfg.denominator === 'given' ? given : fromOthers;
  out.denominator = D;
  if (!(D > 0)) {
    return { ...out, tier: 'N/A', reason: 'no-money', withheld: true };
  }
  const I = s + b;
  // G6: donations above the receipts, not verified at source (live rule)
  const sourceVerified =
    m.record?.financialsVerified === true &&
    m.record?.financialsVerifiedCycle === m.record?.dataCycle;
  if (I > D * 1.02 && !sourceVerified) {
    return {
      ...out,
      tier: 'DISPUTED',
      reason: 'figures-not-reconciled-to-source',
      withheld: true,
      g6: true,
    };
  }

  // Concentration: the live count, or only donors who net above $0 (F11);
  // item 6: joint-fund gifts counted only for what reached the member
  const sh = cfg.jfcProRata && m.shapeJfc ? m.shapeJfc : m.shape;
  const N = cfg.F11 ? (sh?.donors ?? 0) : num(m.analysis?.uniqueDonors);
  const n = cfg.F11 ? sh?.nakamoto : m.analysis?.nakamotoCoefficient;
  const collected = cfg.F11 ? num(sh?.total) : num(m.analysis?.totalAmount);
  const missing = cfg.withoutMissing
    ? (pf.committees || []).reduce((t, c) => t + num(cfg.withoutMissing.get(c.id)), 0)
    : 0;
  const covered = b - missing <= 0 || collected >= 0.5 * (b - missing);
  const hasRecords = n !== null && n !== undefined && N > 0;
  const reliable = cfg.noMinDonors
    ? (hasRecords || b <= 0) && (covered || cfg.recordsOnly)
    : hasRecords && N >= 10 && (covered || cfg.recordsOnly);
  const a = allowance(cfg.allowance === 'cap' ? 'table' : cfg.allowance, n, N, reliable);
  const cappedShare =
    cfg.allowance === 'cap' && sh?.total > 0
      ? Math.min(1, num(sh.capped?.[cfg.cap]) / sh.total)
      : null;
  const counted = countedBig(b, I, a, cfg, cappedShare, reliable);
  // Worked out as tier-calculation.js does (raw share, less the excess), so
  // R0 matches the live grade to the last bit; the same as 100·(s+counted)/D
  const raw = (I / D) * 100;
  let x;
  if (cfg.allowance === 'cap') {
    x = ((s + counted) / D) * 100;
  } else {
    const itemizedPercent = I > 0 ? (b / I) * 100 : 0;
    x = raw - (Math.max(0, itemizedPercent - a * 100) / 100) * raw;
  }
  x = Math.min(100, x);

  // PAC money traced back to people, counted at the credit
  const gifts = m.gifts || [];
  const giftTotal = gifts.reduce((t, [, amt]) => t + amt, 0);
  const f = cfg.F9 && giftTotal > 0 ? Math.min(1, vehiclePac(pf) / giftTotal) : 1;
  let people = gifts.reduce((t, [id, amt]) => t + amt * (shares.get(id)?.[cfg.trace] || 0), 0) * f;
  if (cfg.untracedAsPeople) {
    // Party money, other candidates' campaigns and joint-fund PAC money as if
    // every dollar came from people (the most tracing them could add)
    const campaigns = gifts
      .filter(([id]) => pacType(pacs[id]?.type, pacs[id]?.designation) === 'campaign')
      .reduce((t, [id, amt]) => t + amt * (1 - (shares.get(id)?.[cfg.trace] || 0)), 0);
    const jfcPac = Math.max(0, p - vehiclePac(pf));
    people += campaigns * f + y + jfcPac;
  }
  let C = Math.round(people * cfg.credit * 100) / 100;
  if (cfg.groups) {
    // E-S: each PAC's traced money at its group's credit
    C =
      Math.round(
        gifts.reduce(
          (t, [id, amt]) =>
            t +
            amt *
              (shares.get(id)?.[cfg.trace] || 0) *
              (cfg.groups.credit[resolveGroup(pacs[id], cfg)] ?? 0),
          0
        ) *
          f *
          100
      ) / 100;
  }
  const credit = C > 0 ? (C / D) * 100 : 0;
  x = Math.min(100, x + credit);

  // The PAC bar, on money from others (live)
  let bar = 0;
  if (cfg.bar) {
    const weighted = gifts.reduce((t, [id, amt]) => {
      const w = getPACTransparencyWeight(pacs[id]?.type, pacs[id]?.designation, PAC_WEIGHTS);
      return w > 1 ? t + amt * w : t;
    }, 0);
    bar = Math.min(30, Math.floor((weighted / fromOthers) * 100));
  }
  const score = Math.round(x);
  const tier = band(cfg.F1 ? score : x, bar);
  const topDonors = num(cfg.F11 ? sh?.topPositive : sh?.topLive);
  return {
    ...out,
    tier,
    x,
    score,
    bar,
    N,
    n: n ?? null,
    nN: N > 0 && n !== null && n !== undefined ? n / N : null,
    allowance: cfg.allowance === 'cap' ? (reliable ? null : FALLBACK) : a,
    cap: cfg.allowance === 'cap' ? cfg.cap : null,
    reliable,
    fallback: !reliable,
    covered,
    counted,
    fromPeople: s + counted,
    creditDollars: C,
    credit,
    topShare: D > 0 ? topDonors / D : null,
  };
}

/** Every member under one run. Returns { results: Map id -> result, shares }. */
export function runGrid(inputs, cfg) {
  const shares = pacShares(inputs.pacs, cfg);
  const results = new Map();
  for (const m of inputs.members) {
    results.set(m.id, gradeOne(m, inputs.pacs, shares, cfg));
  }
  return { results, shares };
}

/** Spearman rank correlation of two equal-length arrays (average ranks for ties). */
export function spearman(a, b) {
  const ranks = xs => {
    const order = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) {
        j++;
      }
      for (let k = i; k <= j; k++) {
        r[order[k][1]] = (i + j) / 2 + 1;
      }
      i = j + 1;
    }
    return r;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (ra.length + 1) / 2;
  let num_ = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num_ += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  return da && db ? num_ / Math.sqrt(da * db) : null;
}
