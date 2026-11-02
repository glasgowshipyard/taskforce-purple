// The big-donor test since 2026-11-01 (owner: "ballroom + elites"): anyone
// who gave more than $3,500 in all is a wealthy donor and all their money is
// Power; and when fewer than 100 people gave half the big money, it counts
// only in proportion (a room's worth)
import { describe, expect, it } from 'vitest';
import {
  FINAL3,
  final3BigCounted,
  final3PacShares,
  final3RoomLimit,
  gradeFinal3,
} from './tier-calculation.js';

const person = ({ small = 0, big = 0, pac = 0, donor }) => ({
  reconciliation: { ok: true },
  pf: {
    totalRaised: small + big + pac,
    invariantsHold: true,
    grassrootsDonations: small,
    largeDonorDonations: big,
    pacMoney: pac,
    partyMoney: 0,
    committees: [],
  },
  shapeDirected: donor,
  gifts: [],
});

describe('the big-donor test', () => {
  it('the line is one maximum donation, and a room is 100 people', () => {
    expect(FINAL3.eliteOver).toBe(3500);
    expect(final3RoomLimit(40)).toBeCloseTo(0.4, 10);
    expect(final3RoomLimit(100)).toBe(1);
    expect(final3RoomLimit(5000)).toBe(1);
  });

  it("wealthy donors' money is Power however many of them gave", () => {
    // A Senate campaign, 2026: $4.2M small, $19.2M big from 14,300 donors,
    // 1,488 of them giving half; most of those gave the maximum for both
    // the primary and the general. Under FINAL-3's share test this was an S
    const g = gradeFinal3(
      person({
        small: 4232583.5,
        big: 19172032.67,
        pac: 1347390.54,
        donor: {
          donors: 14300,
          nakamoto: 1488,
          total: 19113198,
          eliteDonors: 2100,
          elite: 11467919,
        },
      }),
      {},
      new Map()
    );
    expect(g.roomLimit).toBe(1);
    expect(g.eliteShare).toBeCloseTo(0.6, 4);
    expect(g.counted).toBeCloseTo(19172032.67 * 0.4, 0);
    // (4.23M + 7.67M) of 24.75M
    expect(g.score).toBe(48);
    expect(g.tier).toBe('C');
  });

  it('a room’s worth of donors giving half: only in proportion, even under $3,500 each', () => {
    // 30 people gave half the big money, none over $3,500
    const g = gradeFinal3(
      person({
        small: 50000,
        big: 100000,
        donor: { donors: 120, nakamoto: 30, total: 100000, eliteDonors: 0, elite: 0 },
      }),
      {},
      new Map()
    );
    expect(g.counted).toBeCloseTo(0.3 * 150000, 6);
    expect(g.score).toBe(63);
  });

  it('many donors, none over $3,500: all of the big money is people', () => {
    const g = gradeFinal3(
      person({
        small: 40000,
        big: 60000,
        donor: { donors: 900, nakamoto: 250, total: 60000, eliteDonors: 0, elite: 0 },
      }),
      {},
      new Map()
    );
    expect(g.counted).toBe(60000);
    expect(g.tier).toBe('S');
  });

  it('the smaller of the two applies', () => {
    expect(final3BigCounted(100000, 150000, 0.5, 40)).toBeCloseTo(50000, 6);
    expect(final3BigCounted(100000, 150000, 0.1, 40)).toBeCloseTo(60000, 6);
  });

  it('no grade when the donor records cover under half the big money', () => {
    const g = gradeFinal3(
      person({
        small: 50000,
        big: 100000,
        donor: { donors: 20, nakamoto: 8, total: 40000, eliteDonors: 0, elite: 0 },
      }),
      {},
      new Map()
    );
    expect(g).toMatchObject({ tier: 'DISPUTED', reason: 'records-incomplete', withheld: true });
  });

  it('a campaign with no big money needs no donor records', () => {
    const g = gradeFinal3(person({ small: 5000, donor: null }), {}, new Map());
    expect(g.tier).toBe('S');
  });

  it("a PAC's own donors get the same test", () => {
    const pac = (elite, nakamoto, donors) => ({
      profile: {
        receipts: 100000,
        individuals: 100000,
        itemized: 80000,
        donors,
        nakamoto,
        elite,
      },
      fec: { receipts: 100000, itemized: 80000, unitemized: 20000 },
      upstream: [],
    });
    const shares = final3PacShares({
      C00000001: pac(0, 300, 1000), // many donors, none wealthy
      C00000002: pac(40000, 300, 1000), // half of it from wealthy donors
      C00000003: pac(0, 20, 60), // a room's worth: 20 people gave half
    });
    expect(shares.get('C00000001')).toBeCloseTo(1, 6);
    expect(shares.get('C00000002')).toBeCloseTo(0.6, 6);
    expect(shares.get('C00000003')).toBeCloseTo(0.4, 6);
  });
});
