// The simulation's grid must give the live grade under the live rules (R0):
// checked here against the production code on made-up members, and in the
// report against every real member.
import { describe, expect, it } from 'vitest';
import { gradeMember } from '../../../workers/grading.js';
import { pacPeopleCredit, tracePacs } from '../../../workers/tier-calculation.js';
import { asPacContributions } from '../../refresh/lib/pacs.mjs';
import {
  LIVE,
  allowance,
  band,
  gradeOne,
  pacShares,
  personLevel,
  sponsorGroup,
  spearman,
} from './grid.mjs';

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

describe('second round: sponsor groups, joint funds, donor minimum, transfer check', () => {
  it('sorts PACs by who they answer to', () => {
    expect(sponsorGroup({ type: 'Q', designation: 'B', orgType: 'L' })).toBe('people');
    expect(sponsorGroup({ type: 'Q', designation: 'B', orgType: 'M' })).toBe('people');
    expect(sponsorGroup({ type: 'Q', designation: 'B', orgType: 'C' })).toBe('money');
    expect(sponsorGroup({ type: 'Q', designation: 'U', orgType: 'T' })).toBe('money');
    expect(sponsorGroup({ type: 'Q', designation: 'D', orgType: 'L' })).toBe('politician');
    expect(sponsorGroup({ type: 'H', designation: 'P' })).toBe('politician');
    expect(sponsorGroup({ type: 'N', designation: 'J' })).toBe('politician');
    expect(sponsorGroup({ type: 'Q', designation: 'B', orgType: 'W' })).toBe('unclear');
    expect(sponsorGroup({ type: 'Q', designation: 'B', connectedOrg: 'A COLLEGE' })).toBe(
      'unclear'
    );
    expect(sponsorGroup({ type: 'Q', designation: 'U', connectedOrg: 'NONE' })).toBe('nosponsor');
    expect(sponsorGroup({ type: 'W', designation: 'U' })).toBe('nosponsor');
  });

  it("E-S: union PAC money at full credit, company and politicians' PAC money at 0", () => {
    const m = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const E = {
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
    };
    const groups = {
      credit: { people: 1, nosponsor: 1, money: 0, politician: 0 },
      unclearAs: 'people',
      upstreamZero: true,
    };
    const ES = { ...E, groups };
    const sh = pacShares(pacs, ES);
    const r = gradeOne(m, pacs, sh, ES);
    // Only the union PAC (C00000001, $300,000) counts, in full, scaled by the credit cap
    const f = Math.min(1, 580000 / 600000);
    expect(r.creditDollars).toBeCloseTo(300000 * sh.get('C00000001')[2] * f, 0);
    // The company PAC's upstream committee is unsorted (no sponsor): it still counts
    expect(sh.get('C00000002')[2]).toBeGreaterThan(sh.get('C00000002')[1]);
  });

  it("item 9: the transfer check allows for money from the member's own committees", () => {
    const m = {
      pf: {
        totalRaised: 16000000,
        invariantsHold: false,
        committees: [
          { id: 'C1', role: 'campaign', raised: 4000000 },
          { id: 'C2', role: 'campaign', raised: 31500000 },
        ],
      },
      reconciliation: { ok: true },
      internalIn: { C2: 19500000 },
    };
    expect(personLevel(m)).toBe(false);
    expect(personLevel(m, { fixedInvariant: true })).toBe(true);
    expect(personLevel({ ...m, internalIn: {} }, { fixedInvariant: true })).toBe(false);
  });

  it('item 7: few donors get at most n% instead of the 40% fallback; poor records keep it', () => {
    const few = { uniqueDonors: 8, nakamotoCoefficient: 2, totalAmount: 290000 };
    const base = member(few);
    const m = { ...base, shape: { ...base.shape, donors: 8, nakamoto: 2, total: 290000 } };
    const E = { ...LIVE, F11: true, allowance: 'min' };
    expect(gradeOne(m, pacs, pacShares(pacs, E), E).allowance).toBe(0.4);
    expect(
      gradeOne(m, pacs, pacShares(pacs, E), { ...E, noMinDonors: true }).allowance
    ).toBeCloseTo(0.02, 10);
    const poor = { ...m, shape: { ...m.shape, total: 100000 } };
    expect(gradeOne(poor, pacs, pacShares(pacs, E), { ...E, noMinDonors: true }).allowance).toBe(
      0.4
    );
  });

  it('item 6: the donor test on joint-fund gifts scaled to what reached the member', () => {
    const base = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const m = { ...base, shapeJfc: { ...base.shape, donors: 900, nakamoto: 200, total: 280000 } };
    const E = { ...LIVE, F11: true, allowance: 'min' };
    expect(gradeOne(m, pacs, pacShares(pacs, E), E).n).toBe(60);
    expect(gradeOne(m, pacs, pacShares(pacs, E), { ...E, jfcProRata: true }).n).toBe(200);
  });
});

describe('final candidate: whole own funds and TFP groups', () => {
  it("counts the member's own fund in full and its PAC gifts by group", () => {
    const base = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const m = {
      ...base,
      whole: {
        totalRaised: 1600000,
        grassrootsDonations: 300000,
        largeDonorDonations: 500000,
        pacMoney: 700000,
        partyMoney: 0,
        invariantsHold: true,
        ownFunds: ['J1'],
      },
      giftsToFunds: [['C00000001', 100000]],
    };
    const tfpPacs = Object.fromEntries(
      Object.entries(pacs).map(([id, p]) => [
        id,
        {
          ...p,
          sponsor: {
            group: id === 'C00000001' ? 'people' : id === 'C00000004' ? 'politician' : 'business',
          },
        },
      ])
    );
    const cfg = {
      ...LIVE,
      F9: true,
      F11: true,
      bar: false,
      denominator: 'given',
      allowance: 'min',
      noMinDonors: true,
      wholeFunds: true,
      groups: {
        credit: { people: 1, nosponsor: 1, business: 0, politician: 0 },
        source: 'tfp',
        upstreamZero: true,
      },
    };
    const sh = pacShares(tfpPacs, cfg);
    const r = gradeOne(m, tfpPacs, sh, cfg);
    expect(r.denominator).toBe(300000 + 500000 + 700000);
    // Only the union PAC counts: $300k to the campaign plus $100k to the fund, in full
    expect(r.creditDollars).toBeCloseTo(400000 * sh.get('C00000001')[2], 0);
  });
});

describe("FINAL-2: the people test, directed gifts, other politicians' funds", () => {
  const cfg = {
    ...LIVE,
    F9: true,
    F11: true,
    bar: false,
    denominator: 'given',
    allowance: 'min',
    noMinDonors: true,
    directedAsGifts: true,
    nonOwnAsPolitician: true,
    groups: {
      credit: { people: 1 },
      source: 'tfp',
      upstreamZero: true,
      upstreamByCredit: true,
      peopleTest: true,
    },
  };
  const tfp = elected =>
    Object.fromEntries(
      Object.entries(pacs).map(([id, p]) => [
        id,
        {
          ...p,
          sponsor: { group: id === 'C00000001' || id === 'C00000003' ? 'people' : 'nosponsor' },
          peopleTest: { elected },
        },
      ])
    );

  it('a PEOPLE PAC counts only if its members elect its leaders', () => {
    const base = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const m = { ...base, shapeDirected: { ...base.shape, directedOut: {} } };
    const yes = tfp(true);
    const r = gradeOne(m, yes, pacShares(yes, cfg), cfg);
    expect(r.creditDollars).toBeGreaterThan(0);
    const no = tfp(false);
    expect(gradeOne(m, no, pacShares(no, cfg), cfg).creditDollars).toBe(0);
  });

  it('gifts a committee directed leave big-donor money and count as its gift, uncapped', () => {
    const base = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const m = {
      ...base,
      shapeDirected: { ...base.shape, total: 240000, directedOut: { C00000003: 50000 } },
    };
    const p2 = tfp(true);
    const sh = pacShares(p2, cfg);
    const r = gradeOne(m, p2, sh, cfg);
    expect(r.e).toBe(50000);
    // Big-donor money less the directed gifts and the other fund's share
    expect(r.b).toBeCloseTo(300000 - 50000, 0);
    expect(r.earmarkDollars).toBeCloseTo(50000 * sh.get('C00000003')[2], 0);
    expect(r.denominator).toBe(200000 + 300000 + 600000);
  });

  it("other politicians' fund transfers come out of each bucket by the fund's mix", () => {
    const base = member({ uniqueDonors: 640, nakamotoCoefficient: 60, totalAmount: 290000 });
    const m = {
      ...base,
      shapeDirected: { ...base.shape, directedOut: {} },
      pf: {
        ...pf,
        committees: [
          pf.committees[0],
          {
            id: 'C10000002',
            role: 'joint',
            ownFund: false,
            raised: 500000,
            toMember: 100000,
            mix: { s: 0.2, b: 0.5, p: 0.3, y: 0 },
          },
        ],
      },
    };
    const p2 = tfp(true);
    const r = gradeOne(m, p2, pacShares(p2, cfg), cfg);
    expect(r.s).toBeCloseTo(200000 - 20000, 0);
    expect(r.b).toBeCloseTo(300000 - 50000, 0);
    expect(r.p).toBeCloseTo(600000 - 30000, 0);
    expect(r.j).toBeCloseTo(100000, 0);
    expect(r.denominator).toBe(200000 + 300000 + 600000);
  });
});
