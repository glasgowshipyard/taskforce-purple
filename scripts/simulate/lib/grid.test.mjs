// The simulation's grid must give the live grade under the live rules (R0):
// checked here against the production code on made-up members, and in the
// report against every real member.
import { describe, expect, it } from 'vitest';
import { gradeMember } from '../../../workers/grading.js';
import { pacPeopleCredit, tracePacs } from '../../../workers/tier-calculation.js';
import { asPacContributions } from '../../refresh/lib/pacs.mjs';
import { LIVE, allowance, band, gradeOne, pacShares, spearman } from './grid.mjs';

const pacs = {
  C00000001: {
    type: 'Q',
    designation: 'B',
    orgType: 'L',
    profile: { receipts: 50000, individuals: 48000, itemized: 10000, donors: 400, nakamoto: 120 },
    extras: { capped: { 500: 6000, 1000: 8000, 2000: 9500 } },
    upstream: [],
    fec: { receipts: 50000, individuals: 48000, itemized: 12000, unitemized: 36000 },
  },
  C00000002: {
    type: 'Q',
    designation: 'U',
    orgType: 'C',
    profile: { receipts: 100000, individuals: 50000, itemized: 50000, donors: 30, nakamoto: 4 },
    extras: { capped: { 500: 15000, 1000: 25000, 2000: 40000 } },
    upstream: [{ id: 'C00000003', amount: 50000 }],
    fec: null,
  },
  C00000003: {
    type: 'Q',
    designation: 'U',
    profile: { receipts: 10000, individuals: 10000, itemized: 0, donors: 0, nakamoto: null },
    upstream: [],
  },
  C00000004: {
    type: 'Q',
    designation: 'D',
    profile: { receipts: 20000, individuals: 2000, itemized: 2000, donors: 5, nakamoto: 2 },
    upstream: [],
  },
};
const gifts = [
  ['C00000001', 300000],
  ['C00000002', 200000],
  ['C00000004', 100000],
];
const pf = {
  totalRaised: 1200000,
  grassrootsDonations: 200000,
  largeDonorDonations: 300000,
  pacMoney: 600000,
  partyMoney: 0,
  ownMoney: { contributions: 100000, loans: 0, repaid: 0 },
  invariantsHold: true,
  failed: false,
  committees: [
    { id: 'C10000001', role: 'campaign', raised: 1100000, pac: 580000 },
    { id: 'C10000002', role: 'joint', raised: 500000, toMember: 100000 },
  ],
};
const member = analysis => ({
  id: 'X000001',
  pf,
  reconciliation: { ok: true, pending: false },
  analysis,
  shape: {
    donors: 640,
    nakamoto: 60,
    total: 290000,
    topLive: 140000,
    topPositive: 141000,
    capped: { 500: 150000, 1000: 200000, 2000: 250000 },
  },
  gifts,
  record: { fecIdentityVerified: true },
});

// The production grade for the same member
function production(m) {
  const profiles = new Map(Object.entries(pacs).map(([id, p]) => [id, p.profile]));
  const upstream = new Map(Object.entries(pacs).map(([id, p]) => [id, p.upstream]));
  const traced = tracePacs(profiles, upstream);
  const g = gifts.map(([id, amount]) => ({
    id,
    amount,
    name: id,
    committeeType: pacs[id].type,
    designation: pacs[id].designation,
  }));
  return gradeMember(
    {
      fecIdentityVerified: true,
      pacContributions: asPacContributions(g),
      pacListComplete: true,
      pacPeopleCredit: pacPeopleCredit(g, traced),
    },
    {
      ...m.analysis,
      personLevel: true,
      personFunding: pf,
      reconciliation: m.reconciliation,
    }
  );
}

describe('simulation grid', () => {
  it('R0 gives the production grade, score and PAC bar', () => {
    for (const analysis of [
      { uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 }, // standard
      { uniqueDonors: 300, nakamotoCoefficient: 30, totalAmount: 290000 }, // dinner party
      { uniqueDonors: 2000, nakamotoCoefficient: 400, totalAmount: 290000 }, // movement
      { uniqueDonors: 2000, nakamotoCoefficient: 400, totalAmount: 100000 }, // records under half
    ]) {
      const m = member(analysis);
      const live = production(m);
      const r = gradeOne(m, pacs, pacShares(pacs, LIVE), LIVE);
      expect(r.tier).toBe(live.tier);
      expect(r.score).toBe(live.individualFundingPercent);
      expect(r.bar).toBe(live.detail.transparencyPenalty);
    }
  });

  it('withholds a grade from mixed sources under F2', () => {
    const m = {
      ...member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 }),
      pf: { ...pf, invariantsHold: false },
      grade: { tier: 'C', score: 50 },
    };
    expect(gradeOne(m, pacs, pacShares(pacs, LIVE), LIVE).tier).toBe('C');
    expect(gradeOne(m, pacs, pacShares(pacs, LIVE), { ...LIVE, F2: true }).tier).toBe('WITHHELD');
    expect(
      gradeOne(m, pacs, pacShares(pacs, LIVE), { ...LIVE, F2: true }, { ignoreInvariant: true })
        .tier
    ).toMatch(/^[SABCDEF]$/);
  });

  it('the allowances', () => {
    expect(allowance('table', 34, 339, true)).toBe(0.1);
    expect(allowance('table100', 60, 500, true)).toBe(1);
    expect(allowance('smooth', 34, 339, true)).toBe(1); // 10.03%
    expect(allowance('smooth', 25, 1000, true)).toBeCloseTo(0.1, 10); // 2.5%
    expect(allowance('smooth', 625, 10000, true)).toBeCloseTo(0.1 + 0.9 * 0.5, 10); // 6.25%
    expect(allowance('count', 34, 339, true)).toBe(0.34);
    expect(allowance('min', 34, 339, true)).toBe(0.34);
    expect(allowance('count', 34, 339, false)).toBe(0.4);
  });

  it('the new denominator, no bar, and the credit cap', () => {
    const m = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const cfg = { ...LIVE, bar: false, denominator: 'given', F9: true };
    const r = gradeOne(m, pacs, pacShares(pacs, cfg), cfg);
    expect(r.denominator).toBe(200000 + 300000 + 600000);
    expect(r.bar).toBe(0);
    // Gifts 600,000 against 580,000 received by the campaign: scaled down
    const uncapped = gradeOne(m, pacs, pacShares(pacs, cfg), { ...cfg, F9: false });
    expect(r.creditDollars).toBeCloseTo((uncapped.creditDollars * 580000) / 600000, 0);
  });

  it('variant D counts each donor up to the cap', () => {
    const m = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const cfg = { ...LIVE, allowance: 'cap', cap: 1000 };
    const r = gradeOne(m, pacs, pacShares(pacs, cfg), cfg);
    expect(r.counted).toBeCloseTo((300000 * 200000) / 290000, 6);
  });

  it('bands and rank correlation', () => {
    expect(band(29.6, 0)).toBe('E');
    expect(band(Math.round(29.6), 0)).toBe('D');
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });
});
