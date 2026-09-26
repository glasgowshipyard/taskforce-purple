/**
 * TIER CALCULATION - pure functions, no KV/env dependencies
 *
 * Extracted from data-pipeline.js so the math is unit-testable and the
 * penalty curve can be tuned without touching pipeline plumbing.
 *
 * The model:
 *   individualFunding = grassroots (<$200) + itemized (>$200)
 *   itemizedShare     = itemized / individualFunding   ("of the people who
 *                       gave, how reliant are you on big checks?")
 *   trust anchor      = allowed itemizedShare before penalties, derived from
 *                       donor-concentration data (Nakamoto coefficient)
 *   penalty           = capped quadratic on the excess over the anchor
 *   tier              = individualFunding % of totalRaised, minus penalty,
 *                       measured against thresholds shifted by PAC penalties
 */

// The July 2026 model: capped quadratic with a floor. Superseded by the
// excess-money model below (#42); kept for simulation and comparison.
export const CAPPED_QUADRATIC_OPTIONS = {
  penaltyModel: 'capped-quadratic',
  quadraticDivisor: 20, // penalty = excess^2 / divisor (original curve)
  penaltyCap: 40, // max points a concentration penalty can remove
  floorAtZero: true, // individualFundingPercent never goes negative
  // Concentration data is only trusted when the itemized collection actually
  // covered the member's reported itemized total. Early-cycle snapshots with
  // a handful of transactions otherwise trigger the harshest anchor.
  minConcentrationCoverage: 0.5, // collected $ must be >= 50% of FEC itemized $
  minUniqueDonors: 10,
};

// Step 4 corrected (issue #42). The capped quadratic measures the excess in
// points of INDIVIDUAL money, squares it, and subtracts it from a share of
// TOTAL money - two different denominators. That mismatch is why raw
// penalties reached 200-390 points, which is why a 40-point cap and a floor
// at zero were bolted on in July 2026, which is why 145 members ended up on
// an identical 0.
//
// 'excess-money' keeps the settled design - itemized money counts as
// individual support, up to an anchor set by how concentrated the donor base
// is - and applies it in money: itemized money ABOVE the anchor stops
// counting as people-funding. Same units throughout, so no divisor, cap or
// floor is needed; a score can never fall below the small-donor share.
export const EXCESS_MONEY_OPTIONS = {
  penaltyModel: 'excess-money',
  floorAtZero: false, // cannot go negative by construction
  minConcentrationCoverage: 0.5,
  minUniqueDonors: 10,
};

// What production uses.
export const DEFAULT_OPTIONS = EXCESS_MONEY_OPTIONS;

// Pre-July-2026: uncapped quadratic, no floor (produced negative scores).
export const LEGACY_OPTIONS = {
  penaltyModel: 'capped-quadratic',
  quadraticDivisor: 20,
  penaltyCap: Infinity,
  floorAtZero: false,
  minConcentrationCoverage: 0,
  minUniqueDonors: 0,
};

// FEC two-year transaction periods are named by the even END year:
// 2025 and 2026 both belong to cycle 2026.
export function cycleForYear(year) {
  return year % 2 === 0 ? year : year + 1;
}

export function getPACTransparencyWeight(committee_type, designation) {
  let weight = 1.0;

  if (committee_type === 'O') {
    weight *= 2.0; // Super PACs are 2x more concerning
  } else if (committee_type === 'P') {
    weight *= 0.3; // Candidate committees are 70% less concerning
  }

  if (designation === 'D' || designation === 'B') {
    weight *= 1.5; // Leadership/Lobbyist PACs 50% more concerning
  } else if (designation === 'P' || designation === 'A') {
    weight *= 0.15; // Candidate/Authorized committees 85% less concerning
  }

  return weight;
}

export function getCommitteeCategory(committee_type, designation) {
  if (committee_type === 'O') {
    return 'Super PAC';
  }
  if (designation === 'D') {
    return 'Leadership PAC';
  }
  if (designation === 'B') {
    return 'Lobbyist PAC';
  }
  if (committee_type === 'P' || designation === 'P' || designation === 'A') {
    return 'Candidate Committee';
  }
  if (committee_type === 'Q') {
    return 'Qualified PAC';
  }
  if (committee_type === 'N') {
    return 'Nonqualified PAC';
  }
  if (designation === 'U') {
    return 'Unauthorized PAC';
  }
  return 'Other PAC';
}

// Fallback tier from raw grassroots percentage (no PAC/concentration data)
export function calculateTier(grassrootsPercent, totalRaised) {
  if (totalRaised === 0) {
    return 'N/A';
  }

  if (grassrootsPercent >= 90) {
    return 'S';
  }
  if (grassrootsPercent >= 75) {
    return 'A';
  }
  if (grassrootsPercent >= 60) {
    return 'B';
  }
  if (grassrootsPercent >= 45) {
    return 'C';
  }
  if (grassrootsPercent >= 30) {
    return 'D';
  }
  if (grassrootsPercent >= 15) {
    return 'E';
  }
  return 'F';
}

// A concentration snapshot is only usable when it plausibly represents the
// member's full itemized donor base for the cycle.
export function isConcentrationReliable(member, concentration, options = DEFAULT_OPTIONS) {
  if (
    !concentration ||
    concentration.nakamotoCoefficient === undefined ||
    concentration.uniqueDonors === undefined
  ) {
    return false;
  }

  if (concentration.uniqueDonors < options.minUniqueDonors) {
    return false;
  }

  const reportedItemized = member.largeDonorDonations || 0;
  if (reportedItemized > 0 && options.minConcentrationCoverage > 0) {
    const collected = concentration.totalAmount || 0;
    if (collected < reportedItemized * options.minConcentrationCoverage) {
      return false;
    }
  }

  return true;
}

// Sliding itemization limit based on how easily the donor base could
// coordinate. Returns the default anchor when concentration is unreliable.
export function getTrustAnchor(member, concentration, options = DEFAULT_OPTIONS) {
  const DEFAULT_ANCHOR = 40;

  if (!isConcentrationReliable(member, concentration, options)) {
    return { anchor: DEFAULT_ANCHOR, basis: 'default', nakamotoPercent: null };
  }

  const nakamoto = concentration.nakamotoCoefficient;
  const uniqueDonors = concentration.uniqueDonors;
  const nakamotoPercent = uniqueDonors > 0 ? (nakamoto / uniqueDonors) * 100 : 0;

  if (nakamoto < 50) {
    // Dinner party risk: < 50 people control half the money
    return { anchor: 10, basis: 'dinner-party', nakamotoPercent };
  }
  if (nakamotoPercent < 5) {
    // Elite capture: country club / single gala coordination
    return { anchor: 25, basis: 'elite-capture', nakamotoPercent };
  }
  if (nakamotoPercent < 10) {
    // Standard: factional, requires organization
    return { anchor: 40, basis: 'standard', nakamotoPercent };
  }
  // Movement: high entropy, impossible to coordinate
  return { anchor: 50, basis: 'movement', nakamotoPercent };
}

// Points removed from individualFundingPercent for itemized money beyond
// the trust anchor.
//   capped-quadratic: min(excess^2 / divisor, cap)      (July 2026)
//   excess-money:     the excess itemized money itself, as a share of total
//                     raised - excess% of the individual pool x the pool's
//                     share of total                    (#42)
export function calculateItemizationPenalty(
  itemizedPercent,
  anchor,
  options = DEFAULT_OPTIONS,
  rawIndividualFundingPercent = 0
) {
  const excess = Math.max(0, itemizedPercent - anchor);
  if (excess === 0) {
    return 0;
  }
  if (options.penaltyModel === 'excess-money') {
    return (excess / 100) * rawIndividualFundingPercent;
  }
  return Math.min((excess * excess) / options.quadraticDivisor, options.penaltyCap);
}

// Penalty points from concerning PAC funding; shifts tier thresholds upward
export function calculateTransparencyPenalty(member) {
  if (!member.totalRaised) {
    return 0;
  }

  let totalWeightedConcerningMoney = 0;

  if (member.pacContributions?.length) {
    for (const pac of member.pacContributions) {
      const weight =
        pac.committee_type || pac.designation
          ? getPACTransparencyWeight(pac.committee_type, pac.designation)
          : 1.0;

      if (weight > 1.0) {
        totalWeightedConcerningMoney += pac.amount * weight;
      }
    }
  }

  const concerningPercent = (totalWeightedConcerningMoney / member.totalRaised) * 100;
  return Math.min(Math.floor(concerningPercent), 30);
}

export function getAdjustedThresholds(penaltyPoints) {
  return {
    S: 90 + penaltyPoints,
    A: 75 + penaltyPoints,
    B: 60 + penaltyPoints,
    C: 45 + penaltyPoints,
    D: 30 + penaltyPoints,
    E: 15 + penaltyPoints,
  };
}

// Enhanced tier calculation. Pure: concentration data is passed in, not
// fetched. Returns { tier, individualFundingPercent, detail } where detail
// carries the intermediate values for display/debugging.
export function calculateEnhancedTier(member, concentration = null, options = DEFAULT_OPTIONS) {
  if (!member.totalRaised || member.totalRaised === 0) {
    return { tier: 'N/A', individualFundingPercent: 0, detail: null };
  }

  // Whose money is this? Figures are graded only when they came from one of
  // the member's recorded FEC candidate IDs (issue #41). On 2026-09-26, 35
  // members were showing another person's campaign finances - a sitting
  // senator's, a parent's, a namesake's from the 1980s - and 25 of them
  // carried a letter grade for it. Fails closed: a record that was never
  // stamped is not assumed to be right.
  if (member.fecIdentityVerified !== true) {
    return {
      tier: 'UNVERIFIED',
      disputed: true,
      disputeReason: 'fec-identity-not-verified',
      individualFundingPercent: null,
      detail: { path: 'unverified-identity' },
    };
  }

  const hasEnhancedPACData =
    member.pacContributions &&
    member.pacContributions.length > 0 &&
    member.pacContributions.some(pac => pac.committee_type || pac.designation);

  const hasUsableConcentration = isConcentrationReliable(member, concentration, options);

  if (!hasEnhancedPACData && !hasUsableConcentration) {
    // Not enough signal for the enhanced model
    const fallbackTier = calculateTier(member.grassrootsPercent, member.totalRaised);
    return {
      tier: fallbackTier,
      individualFundingPercent: Math.round(member.grassrootsPercent || 0),
      detail: { path: 'fallback' },
    };
  }

  const grassroots = member.grassrootsDonations || 0;
  const itemized = member.largeDonorDonations || 0;
  const individualFundingTotal = grassroots + itemized;

  // Individual donations exceeding total receipts has TWO causes, and they
  // need opposite treatment (2026-07-24):
  //
  //   a) Our own error - figures assembled from different cycles. Cramer hit
  //      170-747% this way and the penalty cap laundered it into S tiers.
  //   b) The FEC's own filing - `receipts` is net of refunds while
  //      `individual_itemized_contributions` is gross, so a committee that
  //      returned money legitimately reports itemized > receipts. Thanedar
  //      files exactly this for cycle 2026 (159%).
  //
  // Ratio cannot separate them (159% vs 170%). What separates them is
  // FIDELITY TO SOURCE: were these numbers written from a single FEC
  // response for the cycle we claim? That is a question about our own
  // accuracy rather than a guess about how campaign finance behaves.
  const exceedsReceipts = individualFundingTotal > member.totalRaised * 1.02;
  const sourceVerified =
    member.financialsVerified === true && member.financialsVerifiedCycle === member.dataCycle;

  if (exceedsReceipts && !sourceVerified) {
    // Ours to explain - do not publish a letter grade for it. Must be a
    // real string, not null: the frontend's tierOrder lookup would return
    // undefined and NaN comparators corrupt the whole sorted list.
    return {
      tier: 'DISPUTED',
      disputed: true,
      disputeReason: 'figures-not-reconciled-to-source',
      individualFundingPercent: null,
      detail: { path: 'disputed' },
    };
  }

  const itemizedPercent =
    individualFundingTotal > 0 ? (itemized / individualFundingTotal) * 100 : 0;

  const rawIndividualFundingPercent = (individualFundingTotal / member.totalRaised) * 100;
  let individualFundingPercent = rawIndividualFundingPercent;

  const { anchor, basis, nakamotoPercent } = getTrustAnchor(member, concentration, options);
  const itemizationPenalty = calculateItemizationPenalty(
    itemizedPercent,
    anchor,
    options,
    rawIndividualFundingPercent
  );
  individualFundingPercent -= itemizationPenalty;

  if (options.floorAtZero) {
    individualFundingPercent = Math.max(0, individualFundingPercent);
  }
  // A verified filing can exceed 100% (refunds - see above). Cap the score so
  // it stays readable, and keep the raw figure for the card's footnote.
  individualFundingPercent = Math.min(100, individualFundingPercent);

  const transparencyPenalty = calculateTransparencyPenalty(member);
  const thresholds = getAdjustedThresholds(transparencyPenalty);

  let tier;
  if (individualFundingPercent >= thresholds.S) {
    tier = 'S';
  } else if (individualFundingPercent >= thresholds.A) {
    tier = 'A';
  } else if (individualFundingPercent >= thresholds.B) {
    tier = 'B';
  } else if (individualFundingPercent >= thresholds.C) {
    tier = 'C';
  } else if (individualFundingPercent >= thresholds.D) {
    tier = 'D';
  } else if (individualFundingPercent >= thresholds.E) {
    tier = 'E';
  } else {
    tier = 'F';
  }

  return {
    tier,
    individualFundingPercent: Math.round(individualFundingPercent),
    disputed: false,
    // Reconciles to source but reads oddly - shown as a footnote, not a fault
    anomaly: exceedsReceipts ? 'itemized-exceeds-net-receipts' : null,
    detail: {
      path: 'enhanced',
      itemizedPercent: Math.round(itemizedPercent * 10) / 10,
      rawIndividualFundingPercent: Math.round(rawIndividualFundingPercent),
      trustAnchor: anchor,
      trustAnchorBasis: basis,
      nakamotoPercent,
      itemizationPenalty: Math.round(itemizationPenalty * 10) / 10,
      transparencyPenalty,
    },
  };
}
