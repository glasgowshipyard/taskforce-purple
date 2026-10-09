import { describe, expect, it } from 'vitest';
import { gradeMember } from '../../../workers/grading.js';
import { tracePacs } from '../../../workers/tier-calculation.js';
import { PRODUCTION_VARIANT, VARIANTS, gradeVariants, untraced } from './pac-sim.mjs';
import { asPacContributions } from './pacs.mjs';

// A member with $600k from three PACs: a union PAC funded by many small
// donors, a PAC whose money came from another committee we can trace, and
// another politician's PAC
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
    amount: 200000,
  },
  {
    id: 'C4',
    name: 'A POLITICIAN PAC',
    kind: 'politician',
    committeeType: 'Q',
    designation: 'D',
    amount: 100000,
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
  const traced = tracePacs(profiles, upstream);

  it('reports how much PAC money stays untraced', () => {
    const u = untraced(gifts, traced);
    expect(u[1]).toBeCloseTo((300000 * 0.04 + 200000 * 0.5 + 100000) / 600000, 5);
    expect(u[2]).toBeCloseTo((300000 * 0.04 + 100000) / 600000, 5);
  });

  it('grades the member under every variant', () => {
    const v = gradeVariants({ member, asStored, gifts, traced, gradeMember });
    expect(Object.keys(v)).toEqual(Object.keys(VARIANTS));
    // More credit, higher score
    expect(v.L150_c25.score).toBeLessThan(v.L150_c50.score);
    expect(v.L150_c50.score).toBeLessThan(v.L150_c100.score);
    expect(v.L150_c50.score).toBeGreaterThan(v.L150_c50_depth1.score);
    expect(v.L150_none.credit).toBe(0);
    // A lighter weight on politicians' PACs lowers the bar
    expect(v.L150_c50.pacBar).toBe(15);
    expect(v.L125_c50.pacBar).toBe(12);
    expect(v.L100_c50.pacBar).toBe(0);
  });

  it('the production variant is the grade production gives', () => {
    const v = gradeVariants({ member, asStored, gifts, traced, gradeMember });
    const g = gradeMember(
      {
        ...member,
        fecIdentityVerified: true,
        pacContributions: asPacContributions(gifts),
        pacListComplete: true,
        pacPeopleCredit: (300000 * 0.96 + 200000) * 0.5,
      },
      asStored
    );
    expect(v[PRODUCTION_VARIANT].score).toBe(g.individualFundingPercent);
    expect(v[PRODUCTION_VARIANT].tier).toBe(g.tier);
  });
});
