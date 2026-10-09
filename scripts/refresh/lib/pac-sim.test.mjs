import { describe, expect, it } from 'vitest';
import { gradeMember } from '../../../workers/grading.js';
import { VARIANTS, gradeVariants, pacShares, untraced } from './pac-sim.mjs';

// A member with $600k from two PACs: a union PAC funded by many small donors,
// and a PAC whose money came from another committee we can trace
const profiles = new Map([
  ['C1', { receipts: 50000, individuals: 48000, itemized: 10000, donors: 400, nakamoto: 120 }],
  ['C2', { receipts: 100000, individuals: 50000, itemized: 0, donors: 0, nakamoto: null }],
  ['C3', { receipts: 10000, individuals: 10000, itemized: 0, donors: 0, nakamoto: null }],
]);
const upstream = new Map([['C2', [{ id: 'C3', amount: 50000 }]]]);
const gifts = [
  {
    id: 'C1',
    name: 'UNION PAC',
    kind: 'lobbyist',
    committeeType: 'Q',
    designation: 'B',
    amount: 300000,
  },
  {
    id: 'C2',
    name: 'OTHER PAC',
    kind: 'group',
    committeeType: 'Q',
    designation: 'U',
    amount: 300000,
  },
];
const member = {
  totalRaised: 1000000,
  grassrootsDonations: 200000,
  largeDonorDonations: 200000,
  grassrootsPercent: 20,
  pacMoney: 600000,
};
const asStored = {
  personLevel: true,
  personFunding: { ...member, partyMoney: 0, invariantsHold: true },
  reconciliation: { ok: true },
};

describe('PAC simulation (#57)', () => {
  const shares = pacShares(profiles, upstream);

  it('traces one level further at depth 2', () => {
    expect(shares.get('C2')[1]).toEqual({ share: 0.5, traceable: 0.5 });
    expect(shares.get('C2')[2]).toEqual({ share: 1, traceable: 1 });
  });

  it('reports how much PAC money stays untraced', () => {
    const u = untraced(gifts, shares);
    expect(u[1]).toBeCloseTo((300000 * 0.04 + 300000 * 0.5) / 600000, 5);
    expect(u[2]).toBeCloseTo((300000 * 0.04) / 600000, 5);
  });

  it('grades the member under every variant; more credit, higher score', () => {
    const v = gradeVariants({ member, asStored, gifts, shares, gradeMember });
    expect(Object.keys(v)).toEqual(Object.keys(VARIANTS));
    expect(v.A25.score).toBeLessThan(v.A50.score);
    expect(v.A50.score).toBeLessThan(v.A100.score);
    expect(v.A50depth2.score).toBeGreaterThan(v.A50.score);
    expect(v.dropB.credit).toBe(0);
  });
});
