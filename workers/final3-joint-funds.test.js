// Other politicians' joint funds (FINAL-3): everything they passed on counts
// as theirs, so nothing toward people, and all of it is in the total
// (2026-11-01: money in no donor bucket used to be left out)
import { describe, expect, it } from 'vitest';
import { gradeFinal3 } from './tier-calculation.js';

describe("other politicians' joint funds", () => {
  it('everything they passed on is in the total, with a mix or without', () => {
    // $100,000 of the campaign's own small donations. One fund that raised
    // nothing this cycle passed on $50,000 (no mix: in no bucket); another
    // passed on $40,000, a quarter of it not donations (the buckets hold the
    // rest by its mix: $20,000 small, $10,000 big)
    const m = {
      reconciliation: { ok: true },
      pf: {
        totalRaised: 190000,
        invariantsHold: true,
        grassrootsDonations: 120000,
        largeDonorDonations: 10000,
        pacMoney: 0,
        partyMoney: 0,
        committees: [
          { committeeId: 'C00000001', role: 'campaign' },
          { committeeId: 'C00000002', role: 'joint', ownFund: false, toMemberCounted: 50000 },
          {
            committeeId: 'C00000003',
            role: 'joint',
            ownFund: false,
            toMemberCounted: 40000,
            mix: { s: 0.5, b: 0.25, p: 0, y: 0 },
          },
        ],
      },
      shapeDirected: { donors: 0, nakamoto: null, total: 0 },
      gifts: [],
    };
    const g = gradeFinal3(m, {}, new Map());
    expect(g.s).toBeCloseTo(100000, 2);
    expect(g.b).toBeCloseTo(0, 2);
    expect(g.j).toBeCloseTo(90000, 2);
    expect(g.denominator).toBeCloseTo(190000, 2);
    // $100,000 of $190,000 from people
    expect(g.score).toBe(53);
  });
});
