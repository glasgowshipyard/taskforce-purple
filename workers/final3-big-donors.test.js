// The big-donor test since 2026-11-02 (owner): people who gave $200 or less
// in all are small donors even when their gifts were itemized; anyone who
// gave $7,000 or more in all (two maximum donations) is a wealthy donor and
// all their money is Power; and how few people gave half the big money (the
// share of donors, and fewer than 100: a room's worth) still limits it
import { describe, expect, it } from 'vitest';
import {
  FINAL3,
  final3BigCounted,
  final3Limits,
  final3PacShares,
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
  it('small is $200 or less in all, wealthy is two maximum donations, a room is 100', () => {
    expect(FINAL3.smallUpTo).toBe(200);
    expect(FINAL3.eliteFrom).toBe(7000);
    expect(final3Limits(40, 400).roomLimit).toBeCloseTo(0.4, 10);
    expect(final3Limits(100, 1000).roomLimit).toBe(1);
    // Half from 1% of the big donors: the share limit's floor
    expect(final3Limits(436, 41841).shareLimit).toBeCloseTo(0.1, 10);
    expect(final3Limits(1488, 14300).shareLimit).toBe(1);
  });

  it("wealthy donors' money is Power however many of them gave", () => {
    // A Senate campaign, 2026: $4.2M small, $19.2M big from 14,300 donors,
    // 1,488 of them giving half. Under FINAL-3 alone this was an S
    const g = gradeFinal3(
      person({
        small: 4232583.5,
        big: 19172032.67,
        pac: 1347390.54,
        donor: {
          donors: 14300,
          nakamoto: 1488,
          total: 19113198,
          eliteDonors: 900,
          elite: 5733959.4,
          smallItemized: 0,
        },
      }),
      {},
      new Map()
    );
    expect(g.shareLimit).toBe(1);
    expect(g.roomLimit).toBe(1);
    expect(g.eliteShare).toBeCloseTo(0.3, 4);
    expect(g.counted).toBeCloseTo(19172032.67 * 0.7, -1);
    // (4.23M + 13.42M) of 24.75M
    expect(g.score).toBe(71);
    expect(g.tier).toBe('B');
  });

  it('small gifts reported by name are small donations, not big ones', () => {
    // $100,000 itemized, $60,000 of it from people who gave $200 or less
    const g = gradeFinal3(
      person({
        small: 20000,
        big: 100000,
        donor: { donors: 300, nakamoto: 20, total: 40000, elite: 0, smallItemized: 60000 },
      }),
      {},
      new Map()
    );
    expect(g.smallItemized).toBeCloseTo(60000, 6);
    expect(g.s).toBeCloseTo(80000, 6);
    expect(g.b).toBeCloseTo(40000, 6);
    // 20 of 300 people gave half the rest: the room limit, 20% of $120,000
    expect(g.counted).toBeCloseTo(24000, 6);
    expect(g.score).toBe(87);
  });

  it('a small share of the big donors giving half still limits it', () => {
    // 150 of 10,000 gave half (1.5%): the share limit's floor, 0.10
    const g = gradeFinal3(
      person({
        small: 50000,
        big: 100000,
        donor: { donors: 10000, nakamoto: 150, total: 100000, elite: 0, smallItemized: 0 },
      }),
      {},
      new Map()
    );
    expect(g.counted).toBeCloseTo(15000, 6);
    expect(g.score).toBe(43);
  });

  it('many donors, none wealthy and none dominant: all of the big money is people', () => {
    const g = gradeFinal3(
      person({
        small: 40000,
        big: 60000,
        donor: { donors: 900, nakamoto: 250, total: 60000, elite: 0, smallItemized: 0 },
      }),
      {},
      new Map()
    );
    expect(g.counted).toBe(60000);
    expect(g.tier).toBe('S');
  });

  it('the smallest limit applies', () => {
    // Half the money from wealthy donors; 40 people gave half (room 0.40)
    expect(final3BigCounted(100000, 150000, 0.5, 40, 400)).toBeCloseTo(50000, 6);
    expect(final3BigCounted(100000, 150000, 0.1, 40, 400)).toBeCloseTo(60000, 6);
  });

  it('no grade when the donor records cover under half the itemized money', () => {
    const g = gradeFinal3(
      person({
        small: 50000,
        big: 100000,
        donor: { donors: 20, nakamoto: 8, total: 30000, elite: 0, smallItemized: 10000 },
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
    const pac = ({ elite = 0, nakamoto, donors, small = 0 }) => ({
      profile: {
        receipts: 100000,
        individuals: 100000,
        itemized: 80000,
        smallItemized: small,
        donors,
        nakamoto,
        elite,
      },
      fec: { receipts: 100000, itemized: 80000, unitemized: 20000 },
      upstream: [],
    });
    const shares = final3PacShares({
      C00000001: pac({ nakamoto: 300, donors: 1000 }), // many donors, none wealthy
      C00000002: pac({ elite: 40000, nakamoto: 300, donors: 1000 }), // half from wealthy donors
      C00000003: pac({ nakamoto: 20, donors: 60 }), // 20 people gave half: a room's worth
      // Half its itemized money from people who gave $200 or less; 20 gave
      // half the rest
      C00000004: pac({ nakamoto: 20, donors: 60, small: 40000 }),
    });
    expect(shares.get('C00000001')).toBeCloseTo(1, 6);
    expect(shares.get('C00000002')).toBeCloseTo(0.6, 6);
    expect(shares.get('C00000003')).toBeCloseTo(0.4, 6);
    expect(shares.get('C00000004')).toBeCloseTo(0.8, 6);
  });
});
