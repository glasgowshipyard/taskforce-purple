// Campaigns that can't be graded fairly (owner, 2026-10-23): half or more
// the candidate's own money. Small campaigns keep their grades
import { describe, expect, it } from 'vitest';
import { gradeFinal3 } from './tier-calculation.js';

const person = ({ raised, own = 0, small = 0, big = 0, pac = 0 }) => ({
  reconciliation: { ok: true },
  pf: {
    totalRaised: raised,
    invariantsHold: true,
    ownMoney: { contributions: 0, loans: own, repaid: 0 },
    grassrootsDonations: small,
    largeDonorDonations: big,
    pacMoney: pac,
    partyMoney: 0,
    committees: [],
  },
  shapeDirected: { donors: 0, nakamoto: null, total: 0 },
  gifts: [],
});

describe('campaigns not graded', () => {
  it('a campaign that is mostly the candidate’s own money is Self-funded', () => {
    // New York 21, 2026: a $14.4M loan, $7,000 from PACs
    const g = gradeFinal3(person({ raised: 14464951, own: 14400000, pac: 7000 }), {}, new Map());
    expect(g).toMatchObject({ tier: 'SELF-FUNDED', withheld: true });
    expect(
      gradeFinal3(person({ raised: 100000, own: 50000, small: 50000 }), {}, new Map()).tier
    ).toBe('SELF-FUNDED');
  });

  it('under half its own money, a campaign is graded as usual', () => {
    const g = gradeFinal3(person({ raised: 100000, own: 49000, small: 51000 }), {}, new Map());
    expect(g.tier).toBe('S');
  });

  it('a small campaign keeps its grade', () => {
    expect(gradeFinal3(person({ raised: 4999, small: 4999 }), {}, new Map()).tier).toBe('S');
  });
});
