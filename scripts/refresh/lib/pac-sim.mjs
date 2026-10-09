// The PAC weighting simulation (#57): each member graded under every option
// the owner is choosing between, with the real grading code. Report only:
// nothing here is published.
//
// Tracing PAC money back to people (tier-calculation.js pacPeopleShare):
// each PAC's money counts as people money as far as its own donors pass the
// members' test, times a credit (how much a PAC's leadership choosing for
// its donors is worth against the donors giving directly).

import { PAC_WEIGHTS, pacPeopleShare } from '../../../workers/tier-calculation.js';
import { asPacContributions } from './pacs.mjs';

const NO_EXTRA = { ...PAC_WEIGHTS, super: 1, leadership: 1, lobbyist: 1 };
const NO_B = { ...PAC_WEIGHTS, lobbyist: 1 };

// key: [weights, credit, depth]
export const VARIANTS = {
  fullListToday: [PAC_WEIGHTS, 0, 0], // the full list with today's weights
  dropB: [NO_B, 0, 0], // A, no tracing: only the extra weight on B dropped
  A25: [NO_B, 0.25, 1],
  A50: [NO_B, 0.5, 1],
  A100: [NO_B, 1, 1],
  A50depth2: [NO_B, 0.5, 2],
  B25: [NO_EXTRA, 0.25, 1],
  B50: [NO_EXTRA, 0.5, 1],
  B100: [NO_EXTRA, 1, 1],
  B50depth2: [NO_EXTRA, 0.5, 2],
};

/** Each PAC's people share at depth 1 and depth 2. Map id -> { 1: {...}, 2: {...} } */
export function pacShares(profiles, upstream) {
  const one = new Map([...profiles].map(([id, p]) => [id, pacPeopleShare(p)]));
  const out = new Map();
  for (const [id, p] of profiles) {
    const up = (upstream.get(id) || [])
      .filter(u => one.get(u.id)?.traceable > 0)
      .map(u => ({ amount: u.amount, share: one.get(u.id).share }));
    out.set(id, { 1: one.get(id), 2: pacPeopleShare({ ...p, upstream: up }) });
  }
  return out;
}

/** A member graded under every variant: { key: { tier, score, pacBar, credit } } */
export function gradeVariants({ member, asStored, gifts, shares, gradeMember }) {
  const out = {};
  for (const [key, [pacWeights, credit, depth]] of Object.entries(VARIANTS)) {
    const traced = depth
      ? gifts.reduce((t, g) => t + g.amount * (shares.get(g.id)?.[depth]?.share || 0), 0)
      : 0;
    const g = gradeMember(
      {
        ...member,
        fecIdentityVerified: true,
        pacContributions: asPacContributions(gifts),
        ...(credit ? { pacPeopleCredit: traced * credit } : {}),
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
export function untraced(gifts, shares) {
  const total = gifts.reduce((t, g) => t + g.amount, 0);
  if (!total) {
    return { 1: null, 2: null };
  }
  const left = depth =>
    gifts.reduce((t, g) => t + g.amount * (1 - (shares.get(g.id)?.[depth]?.traceable || 0)), 0) /
    total;
  return { 1: left(1), 2: left(2) };
}
