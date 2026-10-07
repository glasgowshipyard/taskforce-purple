// Everything the site says about a grade: its name, colour, and what it
// means in plain English. Grades come from workers/tier-calculation.js; this
// file only presents them.

export const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

// `color` is for paper backgrounds, `light` for dark ones; both pass the
// large-text contrast check against their background. `rank` sorts best
// first. Word tiers withhold a grade: they must never look like a bad one.
export const GRADES = {
  S: {
    name: 'People-funded',
    color: '#0C8E6B',
    light: '#34D3A6',
    rank: 8,
    range: '90% or more',
    meaning: 'At least 90% of the money counts as coming from ordinary people.',
  },
  A: {
    name: 'Very clean',
    color: '#4E9A2F',
    light: '#7BCB55',
    rank: 7,
    range: '75–89%',
    meaning: 'Between 75% and 89% of the money counts as coming from ordinary people.',
  },
  B: {
    name: 'Above average',
    color: '#7D8710',
    light: '#C9D23A',
    rank: 6,
    range: '60–74%',
    meaning: 'Between 60% and 74% of the money counts as coming from ordinary people.',
  },
  C: {
    name: 'Below average',
    color: '#A67C00',
    light: '#E9B824',
    rank: 5,
    range: '45–59%',
    meaning: 'Between 45% and 59% of the money counts as coming from ordinary people.',
  },
  D: {
    name: 'PAC heavy',
    color: '#C2601A',
    light: '#F0954A',
    rank: 4,
    range: '30–44%',
    meaning:
      'Between 30% and 44% of the money counts as coming from ordinary people. Most of it comes from PACs or a small number of large donors.',
  },
  E: {
    name: 'Captured',
    color: '#C2412B',
    light: '#F06A50',
    rank: 3,
    range: '15–29%',
    meaning:
      'Between 15% and 29% of the money counts as coming from ordinary people. Most of it comes from PACs or a small number of large donors.',
  },
  F: {
    name: 'Owned',
    color: '#7B1E3A',
    light: '#E2566B',
    rank: 2,
    range: 'under 15%',
    meaning: 'Less than 15% of the money counts as coming from ordinary people.',
  },
  'N/A': {
    name: 'No money yet',
    mark: '–',
    color: '#77738A',
    light: '#B9B5C6',
    rank: 1,
    meaning:
      "No campaign money has been reported for this election yet, so there's nothing to grade.",
  },
  // Our figures don't add up against the FEC's own filing: a problem with our
  // data, not a finding about the member
  DISPUTED: {
    name: 'Under review',
    mark: '?',
    color: '#5B21B6',
    light: '#C4B5FD',
    rank: 0,
    meaning:
      "Our totals for this campaign don't match the FEC's own, so we're not showing a grade until we've fixed that. It's a problem with our data, not something we found about this member.",
  },
  // We couldn't yet confirm the FEC records are this member's (#41)
  UNVERIFIED: {
    name: 'Checking records',
    mark: '?',
    color: '#55525E',
    light: '#CFCBD8',
    rank: 0,
    meaning:
      "We haven't yet confirmed that the campaign records we found belong to this member, so we're not showing a grade or any figures. It's a problem with our records, not something we found about this member.",
  },
};

const UNKNOWN = { ...GRADES['N/A'], name: 'Not graded' };

/** Display details for any tier, with its badge mark. Never throws. */
export function gradeInfo(tier) {
  const g = GRADES[tier] || UNKNOWN;
  return { tier, mark: g.mark || tier || '–', ...g };
}

/** "an S", "a B": for headings like "Why an E" */
export function withArticle(tier) {
  return `${['A', 'E', 'F', 'S'].includes(tier) ? 'an' : 'a'} ${tier}`;
}

// Tiers that withhold a grade, so no figures from the same record may show.
// UNVERIFIED also hides every analysis derived from the record (it may be
// another person's money, #41); DISPUTED keeps its concentration and bundler
// analyses, which come from the member's own itemized records (#40).
const RINGFENCED = ['DISPUTED', 'UNVERIFIED'];

export const isRingfenced = tier => RINGFENCED.includes(tier);
export const isIdentityUnverified = tier => tier === 'UNVERIFIED';
export const isLetter = tier => LETTERS.includes(tier);
