import { describe, expect, it } from 'vitest';
import {
  calculateEnhancedTier,
  calculateItemizationPenalty,
  calculateTier,
  calculateTransparencyPenalty,
  cycleForYear,
  DEFAULT_OPTIONS,
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

  it('is capped so a bad ratio cannot nuke a score to negative territory', () => {
    // 95% itemized vs 10% anchor: legacy penalty would be 85^2/20 = 361
    const penalty = calculateItemizationPenalty(95, 10);
    expect(penalty).toBe(DEFAULT_OPTIONS.penaltyCap);
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
      pacContributions: [
        { amount: 100000, committee_type: 'O' }, // 2x -> 200k weighted
        { amount: 50000, committee_type: 'P', designation: 'P' }, // discounted, ignored
      ],
    };
    expect(calculateTransparencyPenalty(member)).toBe(20);

    const captured = {
      totalRaised: 1000000,
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

  it('refuses to score impossible money (itemized > totalRaised) - the Cramer case', () => {
    // Real production corruption 2026-07-18: fresh 2026-cycle totals with a
    // stale 2024-cycle itemized figure produced IFP 170-747% and S tiers
    const cramer = {
      totalRaised: 1139407,
      grassrootsDonations: 514887,
      largeDonorDonations: 1882643, // larger than totalRaised - impossible
      grassrootsPercent: 45,
      pacContributions: [{ amount: 10000, committee_type: 'Q', designation: 'D' }],
    };
    const concentration = { nakamotoCoefficient: 49, uniqueDonors: 403, totalAmount: 1800000 };
    const result = calculateEnhancedTier(cramer, concentration);
    expect(result.detail.reason).toBe('inconsistent-financials');
    expect(result.tier).toBe('C'); // grassroots-only fallback: 45% -> C
    expect(result.individualFundingPercent).toBeLessThanOrEqual(100);
  });

  it('the sanity guard does not trip on legitimate members', () => {
    const { detail } = calculateEnhancedTier(bernie, bernieConcentration);
    expect(detail.reason).toBeUndefined();
  });

  it('handles missing grassrootsDonations without NaN', () => {
    const member = {
      totalRaised: 1000000,
      largeDonorDonations: 400000,
      grassrootsPercent: 0,
      pacContributions: [{ amount: 5000, committee_type: 'Q', designation: 'U' }],
    };
    const result = calculateEnhancedTier(member, null);
    expect(Number.isFinite(result.individualFundingPercent)).toBe(true);
    expect(result.tier).toMatch(/^[SABCDEF]$/);
  });
});
