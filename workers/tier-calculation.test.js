import { describe, expect, it } from 'vitest';
import {
  calculateEnhancedTier,
  calculateItemizationPenalty,
  calculateTier,
  calculateTransparencyPenalty,
  cycleForYear,
  CAPPED_QUADRATIC_OPTIONS,
  DEFAULT_OPTIONS,
  EXCESS_MONEY_OPTIONS,
  getAdjustedThresholds,
  getPACTransparencyWeight,
  getTrustAnchor,
  isConcentrationReliable,
  LEGACY_OPTIONS,
} from './tier-calculation.js';

// Reference members built from the documented Bernie/Pelosi examples
// (README.md "Real-world example", 2026 cycle)
const bernie = {
  bioguideId: 'S000033',
  totalRaised: 19012074,
  fecIdentityVerified: true,
  grassrootsDonations: 14700000,
  largeDonorDonations: 3695847,
  grassrootsPercent: 77,
  pacContributions: [{ amount: 50000, committee_type: 'Q', designation: 'U' }],
};
const bernieConcentration = {
  nakamotoCoefficient: 1534,
  uniqueDonors: 13102,
  totalAmount: 3600000, // near-full coverage of reported itemized
};

const pelosi = {
  bioguideId: 'P000197',
  totalRaised: 2132913,
  fecIdentityVerified: true,
  grassrootsDonations: 1300000,
  largeDonorDonations: 699871,
  grassrootsPercent: 60,
  pacContributions: [{ amount: 10000, committee_type: 'Q', designation: 'U' }],
};
const pelosiConcentration = {
  nakamotoCoefficient: 114, // 4.4% of donors
  uniqueDonors: 2597,
  totalAmount: 680000,
};

describe('cycleForYear', () => {
  it('maps odd years UP to the even end-year (FEC convention)', () => {
    expect(cycleForYear(2025)).toBe(2026);
    expect(cycleForYear(2026)).toBe(2026);
    expect(cycleForYear(2023)).toBe(2024);
  });
});

describe('calculateTier (fallback)', () => {
  it('returns N/A with no money raised', () => {
    expect(calculateTier(0, 0)).toBe('N/A');
  });
  it('tiers by grassroots percent', () => {
    expect(calculateTier(95, 1000)).toBe('S');
    expect(calculateTier(76, 1000)).toBe('A');
    expect(calculateTier(14, 1000)).toBe('F');
  });
});

describe('getPACTransparencyWeight', () => {
  it('doubles Super PACs and multiplies designations', () => {
    expect(getPACTransparencyWeight('O', undefined)).toBe(2.0);
    expect(getPACTransparencyWeight('O', 'B')).toBe(3.0);
    expect(getPACTransparencyWeight('P', 'A')).toBeCloseTo(0.045);
  });
});

describe('isConcentrationReliable', () => {
  it('rejects null / incomplete records', () => {
    expect(isConcentrationReliable(bernie, null)).toBe(false);
    expect(isConcentrationReliable(bernie, {})).toBe(false);
  });

  it('rejects zero-donor records (the Kean case)', () => {
    const kean = { largeDonorDonations: 500000 };
    const emptyAnalysis = { nakamotoCoefficient: 0, uniqueDonors: 0, totalAmount: 0 };
    expect(isConcentrationReliable(kean, emptyAnalysis)).toBe(false);
  });

  it('rejects snapshots that only cover a sliver of reported itemized money', () => {
    const member = { largeDonorDonations: 1000000 };
    const partial = { nakamotoCoefficient: 5, uniqueDonors: 18, totalAmount: 40000 };
    expect(isConcentrationReliable(member, partial)).toBe(false);
  });

  it('accepts well-covered records', () => {
    expect(isConcentrationReliable(bernie, bernieConcentration)).toBe(true);
    expect(isConcentrationReliable(pelosi, pelosiConcentration)).toBe(true);
  });
});

describe('getTrustAnchor', () => {
  it('gives Bernie the movement anchor (nakamoto% >= 10)', () => {
    const { anchor, basis } = getTrustAnchor(bernie, bernieConcentration);
    expect(anchor).toBe(50);
    expect(basis).toBe('movement');
  });

  it('gives Pelosi the elite-capture anchor (nakamoto% < 5)', () => {
    const { anchor, basis } = getTrustAnchor(pelosi, pelosiConcentration);
    expect(anchor).toBe(25);
    expect(basis).toBe('elite-capture');
  });

  it('falls back to the default anchor when data is unreliable', () => {
    const member = { largeDonorDonations: 1000000 };
    const junk = { nakamotoCoefficient: 3, uniqueDonors: 5, totalAmount: 9000 };
    const { anchor, basis } = getTrustAnchor(member, junk);
    expect(anchor).toBe(40);
    expect(basis).toBe('default');
  });
});

describe('calculateItemizationPenalty', () => {
  it('is zero at or below the anchor', () => {
    expect(calculateItemizationPenalty(20, 50)).toBe(0);
    expect(calculateItemizationPenalty(40, 40)).toBe(0);
  });

  it('July 2026 model: capped so a bad ratio cannot nuke a score to negative territory', () => {
    // 95% itemized vs 10% anchor: legacy penalty would be 85^2/20 = 361
    const penalty = calculateItemizationPenalty(95, 10, CAPPED_QUADRATIC_OPTIONS);
    expect(penalty).toBe(CAPPED_QUADRATIC_OPTIONS.penaltyCap);
  });

  it('default model: the penalty can never exceed the individual money it discounts', () => {
    // 95% itemized vs 10% anchor, individual money = 60% of total raised:
    // at most the 85% excess of that 60% can be removed = 51 points
    const penalty = calculateItemizationPenalty(95, 10, DEFAULT_OPTIONS, 60);
    expect(penalty).toBeCloseTo(51);
    expect(penalty).toBeLessThan(60);
  });

  it('legacy options reproduce the old unbounded curve', () => {
    const penalty = calculateItemizationPenalty(95, 10, LEGACY_OPTIONS);
    expect(penalty).toBeCloseTo((85 * 85) / 20);
  });
});

describe('calculateTransparencyPenalty', () => {
  it('is zero without PAC data', () => {
    expect(calculateTransparencyPenalty({ totalRaised: 100 })).toBe(0);
  });

  it('counts only above-baseline weighted money, capped at 30', () => {
    const member = {
      totalRaised: 1000000,
      fecIdentityVerified: true,
      pacContributions: [
        { amount: 100000, committee_type: 'O' }, // 2x -> 200k weighted
        { amount: 50000, committee_type: 'P', designation: 'P' }, // discounted, ignored
      ],
    };
    expect(calculateTransparencyPenalty(member)).toBe(20);

    const captured = {
      totalRaised: 1000000,
      fecIdentityVerified: true,
      pacContributions: [{ amount: 400000, committee_type: 'O', designation: 'B' }],
    };
    expect(calculateTransparencyPenalty(captured)).toBe(30); // 120% -> capped
  });
});

describe('getAdjustedThresholds', () => {
  it('shifts every threshold by the penalty', () => {
    expect(getAdjustedThresholds(0).S).toBe(90);
    expect(getAdjustedThresholds(10)).toEqual({ S: 100, A: 85, B: 70, C: 55, D: 40, E: 25 });
  });
});

describe('calculateEnhancedTier', () => {
  it('returns N/A with no financial data', () => {
    expect(calculateEnhancedTier({ totalRaised: 0 }).tier).toBe('N/A');
  });

  it('keeps Bernie at S tier (documented reference case)', () => {
    const { tier, individualFundingPercent } = calculateEnhancedTier(bernie, bernieConcentration);
    expect(tier).toBe('S');
    expect(individualFundingPercent).toBeGreaterThanOrEqual(90);
  });

  it('gives Pelosi A tier with a small penalty (documented reference case)', () => {
    const { tier, detail } = calculateEnhancedTier(pelosi, pelosiConcentration);
    expect(tier).toBe('A');
    expect(detail.trustAnchor).toBe(25);
    expect(detail.itemizationPenalty).toBeGreaterThan(0);
    expect(detail.itemizationPenalty).toBeLessThan(10);
  });

  it('never returns a negative individualFundingPercent', () => {
    // Modeled on the live worst case (Shreve: -167% under legacy math)
    const shreveish = {
      totalRaised: 5000000,
      fecIdentityVerified: true,
      grassrootsDonations: 20000,
      largeDonorDonations: 2000000,
      grassrootsPercent: 0,
      pacContributions: [{ amount: 500000, committee_type: 'O' }],
    };
    const badConcentration = { nakamotoCoefficient: 8, uniqueDonors: 47, totalAmount: 1900000 };
    const { individualFundingPercent } = calculateEnhancedTier(shreveish, badConcentration);
    expect(individualFundingPercent).toBeGreaterThanOrEqual(0);
  });

  it('legacy options reproduce the negative-score bug (regression documentation)', () => {
    const shreveish = {
      totalRaised: 5000000,
      fecIdentityVerified: true,
      grassrootsDonations: 20000,
      largeDonorDonations: 2000000,
      grassrootsPercent: 0,
      pacContributions: [{ amount: 500000, committee_type: 'O' }],
    };
    const badConcentration = { nakamotoCoefficient: 8, uniqueDonors: 47, totalAmount: 1900000 };
    const { individualFundingPercent } = calculateEnhancedTier(
      shreveish,
      badConcentration,
      LEGACY_OPTIONS
    );
    expect(individualFundingPercent).toBeLessThan(0);
  });

  it('does not let unreliable zero-donor concentration trigger the harshest anchor', () => {
    const member = {
      totalRaised: 2000000,
      fecIdentityVerified: true,
      grassrootsDonations: 100000,
      largeDonorDonations: 900000,
      grassrootsPercent: 5,
      pacContributions: [{ amount: 10000, committee_type: 'Q', designation: 'U' }],
    };
    const emptyAnalysis = { nakamotoCoefficient: 0, uniqueDonors: 0, totalAmount: 0 };
    const withJunk = calculateEnhancedTier(member, emptyAnalysis);
    const withNone = calculateEnhancedTier(member, null);
    expect(withJunk.detail.trustAnchor).toBe(40);
    expect(withJunk.tier).toBe(withNone.tier);
  });

  it('disputes unreconciled figures instead of guessing a tier - the Cramer case', () => {
    const cramer = {
      totalRaised: 1139407,
      fecIdentityVerified: true,
      grassrootsDonations: 514887,
      largeDonorDonations: 1882643, // assembled from two cycles
      grassrootsPercent: 45,
      dataCycle: 2026,
      // no financialsVerified marker - we cannot vouch for these numbers
      pacContributions: [{ amount: 10000, committee_type: 'Q', designation: 'D' }],
    };
    const result = calculateEnhancedTier(cramer, {
      nakamotoCoefficient: 49,
      uniqueDonors: 403,
      totalAmount: 1800000,
    });
    expect(result.disputed).toBe(true);
    expect(result.tier).toBe('DISPUTED');
    expect(result.individualFundingPercent).toBeNull();
    // Guards the frontend: a tier missing from tierOrder makes the sort
    // comparator return NaN and corrupts the whole list order
    expect(typeof result.tier).toBe('string');
  });

  it('scores a verified filing that exceeds net receipts, flagged - the Thanedar case', () => {
    // FEC reports itemized $600,204 against net receipts $390,276 for 2026.
    // Refunds make gross exceed net; the filing is real, so publish it.
    const thanedar = {
      totalRaised: 390276,
      fecIdentityVerified: true,
      grassrootsDonations: 18989,
      largeDonorDonations: 600204,
      grassrootsPercent: 5,
      dataCycle: 2026,
      financialsVerified: true,
      financialsVerifiedCycle: 2026,
      pacContributions: [{ amount: 5000, committee_type: 'Q', designation: 'U' }],
    };
    const result = calculateEnhancedTier(thanedar, null);
    expect(result.disputed).toBe(false);
    expect(result.anomaly).toBe('itemized-exceeds-net-receipts');
    expect(result.tier).toMatch(/^[SABCDEF]$/);
    expect(result.individualFundingPercent).toBeLessThanOrEqual(100);
    expect(result.detail.rawIndividualFundingPercent).toBeGreaterThan(100);
  });

  it('ordinary members carry no dispute or anomaly flags', () => {
    const result = calculateEnhancedTier(bernie, bernieConcentration);
    expect(result.disputed).toBe(false);
    expect(result.anomaly).toBeNull();
  });

  it('the sanity guard does not trip on legitimate members', () => {
    const { detail } = calculateEnhancedTier(bernie, bernieConcentration);
    expect(detail.reason).toBeUndefined();
  });

  it('handles missing grassrootsDonations without NaN', () => {
    const member = {
      totalRaised: 1000000,
      fecIdentityVerified: true,
      largeDonorDonations: 400000,
      grassrootsPercent: 0,
      pacContributions: [{ amount: 5000, committee_type: 'Q', designation: 'U' }],
    };
    const result = calculateEnhancedTier(member, null);
    expect(Number.isFinite(result.individualFundingPercent)).toBe(true);
    expect(result.tier).toMatch(/^[SABCDEF]$/);
  });
});

describe('FEC identity guard (issue #41)', () => {
  // A wrong-person record is internally consistent - small itemized, small
  // total, no contradiction - so nothing but identity can catch it.
  const wrongPerson = {
    bioguideId: 'R000614',
    totalRaised: 1550,
    grassrootsDonations: 0,
    largeDonorDonations: 0,
    grassrootsPercent: 0,
    fecIdentityVerified: false,
  };

  it('withholds the grade when the figures belong to an unverified identity', () => {
    const result = calculateEnhancedTier(wrongPerson, null);
    expect(result.tier).toBe('UNVERIFIED');
    expect(result.individualFundingPercent).toBeNull();
    expect(result.disputeReason).toBe('fec-identity-not-verified');
  });

  it('fails closed on a record that was never stamped', () => {
    const unstamped = { ...wrongPerson };
    delete unstamped.fecIdentityVerified;
    expect(calculateEnhancedTier(unstamped, null).tier).toBe('UNVERIFIED');
  });

  it('withholds even when the unverified figures would have earned a good grade', () => {
    const flattering = { ...bernie, fecIdentityVerified: false };
    expect(calculateEnhancedTier(flattering, bernieConcentration).tier).toBe('UNVERIFIED');
  });

  it('leaves members with no money at N/A rather than UNVERIFIED', () => {
    expect(calculateEnhancedTier({ totalRaised: 0 }).tier).toBe('N/A');
  });
});

describe('Step 4 corrected: excess-money penalty (issue #42)', () => {
  const opts = EXCESS_MONEY_OPTIONS;
  // A member whose individual money is mostly itemized - the shape that
  // the capped quadratic flattened to exactly 0 for 145 members
  const mostlyItemized = (extra = {}) => ({
    totalRaised: 1000000,
    fecIdentityVerified: true,
    grassrootsDonations: 40000, // 4% small donors
    largeDonorDonations: 280000, // 87.5% of individual money is itemized
    grassrootsPercent: 4,
    pacContributions: [{ amount: 1000, committee_type: 'Q', designation: 'U' }],
    ...extra,
  });

  it('does not flatten: the same member scores above zero where the old model gave 0', () => {
    expect(
      calculateEnhancedTier(mostlyItemized(), null, CAPPED_QUADRATIC_OPTIONS)
        .individualFundingPercent
    ).toBe(0);
    expect(
      calculateEnhancedTier(mostlyItemized(), null, opts).individualFundingPercent
    ).toBeGreaterThan(0);
  });

  it('never scores below the small-donor share, with no floor needed', () => {
    const dinnerParty = { nakamotoCoefficient: 5, uniqueDonors: 200, totalAmount: 280000 };
    const r = calculateEnhancedTier(mostlyItemized(), dinnerParty, opts);
    expect(r.individualFundingPercent).toBeGreaterThanOrEqual(4);
  });

  it('keeps the ballroom principle: a broad donor base keeps more credit than a dinner party', () => {
    const movement = { nakamotoCoefficient: 900, uniqueDonors: 6000, totalAmount: 280000 };
    const dinnerParty = { nakamotoCoefficient: 5, uniqueDonors: 200, totalAmount: 280000 };
    const broad = calculateEnhancedTier(mostlyItemized(), movement, opts);
    const narrow = calculateEnhancedTier(mostlyItemized(), dinnerParty, opts);
    expect(broad.detail.trustAnchorBasis).toBe('movement');
    expect(narrow.detail.trustAnchorBasis).toBe('dinner-party');
    expect(broad.individualFundingPercent).toBeGreaterThan(narrow.individualFundingPercent);
  });

  it('removes exactly the itemized money above the anchor', () => {
    // individual 32% of total; itemized share 87.5%; default anchor 40
    // excess 47.5 points of the individual pool = 0.475 x 32 = 15.2 points
    const r = calculateEnhancedTier(mostlyItemized(), null, opts);
    expect(r.detail.itemizationPenalty).toBeCloseTo(15.2, 1);
    expect(r.individualFundingPercent).toBe(17);
  });

  it('leaves members within their anchor untouched - the reference cases do not move', () => {
    expect(calculateEnhancedTier(bernie, bernieConcentration, opts).tier).toBe(
      calculateEnhancedTier(bernie, bernieConcentration, CAPPED_QUADRATIC_OPTIONS).tier
    );
    expect(calculateEnhancedTier(pelosi, pelosiConcentration, opts).tier).toBe(
      calculateEnhancedTier(pelosi, pelosiConcentration, CAPPED_QUADRATIC_OPTIONS).tier
    );
  });

  it('no longer lets a cap launder a verified >100% filing into a top grade', () => {
    // The 2026-09-26 live case: raw 159%, 97% itemized, dinner-party base
    const verifiedOver = {
      totalRaised: 390276,
      fecIdentityVerified: true,
      financialsVerified: true,
      dataCycle: 2026,
      financialsVerifiedCycle: 2026,
      grassrootsDonations: 18989,
      largeDonorDonations: 600204,
      grassrootsPercent: 5,
      pacContributions: [{ amount: 1000, committee_type: 'Q', designation: 'U' }],
    };
    const dinnerParty = { nakamotoCoefficient: 1, uniqueDonors: 377, totalAmount: 600204 };
    expect(calculateEnhancedTier(verifiedOver, dinnerParty, CAPPED_QUADRATIC_OPTIONS).tier).toBe(
      'S'
    );
    expect(['E', 'F']).toContain(calculateEnhancedTier(verifiedOver, dinnerParty, opts).tier);
  });
});
