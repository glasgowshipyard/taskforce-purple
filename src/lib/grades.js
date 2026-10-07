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
    meaning:
      'Funded by regular people, and lots of them. At least 90% of the money counts as people-funded.',
  },
  A: {
    name: 'Very clean',
    color: '#4E9A2F',
    light: '#7BCB55',
    rank: 7,
    range: '75–89%',
    meaning: 'Mostly funded by regular people: three-quarters or more of the money counts.',
  },
  B: {
    name: 'Above average',
    color: '#7D8710',
    light: '#C9D23A',
    rank: 6,
    range: '60–74%',
    meaning: 'More people-funded than most, with some PAC or big-donor money in the mix.',
  },
  C: {
    name: 'Below average',
    color: '#A67C00',
    light: '#E9B824',
    rank: 5,
    range: '45–59%',
    meaning:
      'About half the money counts as people-funded. The rest leans on PACs or a few donors.',
  },
  D: {
    name: 'PAC heavy',
    color: '#C2601A',
    light: '#F0954A',
    rank: 4,
    range: '30–44%',
    meaning:
      'Less than half the money counts as people-funded. PACs or a small circle of donors carry the rest.',
  },
  E: {
    name: 'Captured',
    color: '#C2412B',
    light: '#F06A50',
    rank: 3,
    range: '15–29%',
    meaning: 'Depends on PACs or a few big donors far more than on regular people.',
  },
  F: {
    name: 'Owned',
    color: '#7B1E3A',
    light: '#E2566B',
    rank: 2,
    range: 'under 15%',
    meaning: 'Almost none of the money counts as people-funded.',
  },
  'N/A': {
    name: 'No money yet',
    mark: '–',
    color: '#77738A',
    light: '#B9B5C6',
    rank: 1,
    meaning: 'No campaign money reported for this election yet, so there is nothing to grade.',
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
      "Our figures for this campaign don't add up against the FEC's own filing, so we won't publish a grade we can't stand behind. This is about our data, not about this member.",
  },
  // We couldn't yet confirm the FEC records are this member's (#41)
  UNVERIFIED: {
    name: 'Checking records',
    mark: '?',
    color: '#55525E',
    light: '#CFCBD8',
    rank: 0,
    meaning:
      "We're making sure the campaign money on file really belongs to this member. Until it's confirmed we show no grade and no figures. This is about our records, not about this member.",
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
