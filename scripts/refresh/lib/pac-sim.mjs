// The PAC simulation (#57): each member graded under the settings the owner
// is still choosing between, with the real grading code. Report only:
// nothing here is published.
//
// Production is version A (owner, 2026-10-09): the full PAC list, no extra
// weight on lobbyist PACs, half of each PAC's people-funded money counted,
// traced one level deeper (tier-calculation.js PAC_WEIGHTS, PAC_TRACING).
// Open: the weight on other politicians' PACs (1.0, 1.25 or 1.5), and the
// method page's sensitivity to the credit (25% and 100%).

import { PAC_TRACING, PAC_WEIGHTS, pacPeopleCredit } from '../../../workers/tier-calculation.js';
import { asPacContributions } from './pacs.mjs';

// key: [weights, credit, depth]. L150_c50 is production.
export const VARIANTS = {};
for (const leadership of [1.5, 1.25, 1]) {
  for (const credit of [0.25, 0.5, 1]) {
    VARIANTS[`L${leadership * 100}_c${credit * 100}`] = [
      { ...PAC_WEIGHTS, leadership },
      credit,
      PAC_TRACING.depth,
    ];
  }
}
VARIANTS.L150_c50_depth1 = [PAC_WEIGHTS, 0.5, 1]; // not one level deeper
VARIANTS.L150_none = [PAC_WEIGHTS, 0, 0]; // no PAC money counted as people's
export const PRODUCTION_VARIANT = 'L150_c50';

/** A member graded under every variant: { key: { tier, score, pacBar, credit } } */
export function gradeVariants({ member, asStored, gifts, traced, gradeMember }) {
  const out = {};
  for (const [key, [pacWeights, credit, depth]] of Object.entries(VARIANTS)) {
    const g = gradeMember(
      {
        ...member,
        fecIdentityVerified: true,
        pacContributions: asPacContributions(gifts),
        pacListComplete: true,
        pacPeopleCredit: pacPeopleCredit(gifts, traced, { credit, depth }),
      },
      asStored,
      { pacWeights }
    );
    out[key] = {
      tier: g.tier,
      score: g.individualFundingPercent,
      pacBar: g.detail?.transparencyPenalty ?? null,
      credit: g.detail?.pacCredit ?? 0,
    };
  }
  return out;
}

/** Share of a member's PAC money that can't be traced to people, depth 1 and 2. */
export function untraced(gifts, traced) {
  const total = gifts.reduce((t, g) => t + g.amount, 0);
  if (!total) {
    return { 1: null, 2: null };
  }
  const left = depth =>
    gifts.reduce((t, g) => t + g.amount * (1 - (traced.get(g.id)?.[depth]?.traceable || 0)), 0) /
    total;
  return { 1: left(1), 2: left(2) };
}
