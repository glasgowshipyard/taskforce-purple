// Everything the site says about a grade: its name, colour, and what it
// means in plain English. Grades come from workers/tier-calculation.js; this
// file only presents them. The names are the owner's and Craig's
// (2026-10-13). "People", "Power" and "Influence" are the three parts of
// the money (peoplePowerInfluence in tier-calculation.js): many people, a
// few wealthy donors, and PACs (companies' PACs among them), politicians and
// parties. Companies can't give to federal campaigns themselves: their money
// comes through their PACs (an outside review's catch, 2026-10-17).

export const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

// What a grade is and isn't, beside every grade a visitor can land on: the
// member page, the share card and link previews (two outside reviews,
// 2026-10-17: a letter grade can read as a verdict on the person)
export const GRADE_SCOPE =
  'The grade is only about where the money comes from, not how they vote, their character or the law.';
export const GRADE_SCOPE_SHORT = 'Grades show where the money comes from, not votes or character.';

// The three parts of the money given, as the graph names them
export const PARTS = [
  { key: 'people', label: 'People', about: 'Money from many different people' },
  { key: 'power', label: 'Power', about: 'Big money from a few wealthy donors' },
  {
    key: 'influence',
    label: 'Influence',
    about: "Money from PACs (including companies' PACs), politicians and parties",
  },
];

// `color` is for paper backgrounds, `light` for dark ones; both pass the
// large-text contrast check against their background. `rank` sorts best
// first. Word tiers withhold a grade: they must never look like a bad one.
export const GRADES = {
  S: {
    name: 'Grassroots',
    color: '#0C8E6B',
    light: '#34D3A6',
    rank: 8,
    range: '90% or more',
    meaning: '90% or more of the money came from people.',
  },
  A: {
    name: 'Supported',
    color: '#4E9A2F',
    light: '#7BCB55',
    rank: 7,
    range: '75% to 89%',
    meaning: '75% to 89% of the money came from people.',
  },
  B: {
    name: 'Backed',
    color: '#7D8710',
    light: '#C9D23A',
    rank: 6,
    range: '60% to 74%',
    meaning: '60% to 74% of the money came from people.',
  },
  C: {
    name: 'Mixed',
    color: '#A67C00',
    light: '#E9B824',
    rank: 5,
    range: '45% to 59%',
    meaning: '45% to 59% of the money came from people.',
  },
  D: {
    name: 'Influenced',
    color: '#C2601A',
    light: '#F0954A',
    rank: 4,
    range: '30% to 44%',
    meaning:
      '30% to 44% of the money came from people. The rest came from a few wealthy donors, or from PACs and politicians.',
  },
  E: {
    name: 'Heavily influenced',
    color: '#C2412B',
    light: '#F06A50',
    rank: 3,
    range: '15% to 29%',
    meaning:
      '15% to 29% of the money came from people. The rest came from a few wealthy donors, or from PACs and politicians.',
  },
  F: {
    name: 'Beholden',
    color: '#7B1E3A',
    light: '#E2566B',
    rank: 2,
    range: 'under 15%',
    meaning: 'Less than 15% of the money came from people.',
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
  // Campaigns that can't be graded fairly (owner, 2026-10-23), shown as what
  // they are: never a letter, and never a bad one
  'SELF-FUNDED': {
    name: 'Self-funded',
    mark: '$',
    color: '#77738A',
    light: '#B9B5C6',
    rank: 1,
    meaning:
      "Half or more of this campaign's money is the candidate's own, so it can't be graded fairly on where the rest came from. The figures show the whole campaign.",
  },
  'TOO-SMALL': {
    name: 'Too small to grade',
    mark: '–',
    color: '#77738A',
    light: '#B9B5C6',
    rank: 1,
    meaning:
      'Less than $5,000 came from anyone other than the candidate, which is too little to grade fairly.',
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
      "This site's totals for this campaign don't match the FEC's own, so no grade is shown until that's fixed. It's a problem with this site's data, not something found about this member.",
  },
  // We couldn't yet confirm the FEC records are this member's (#41)
  UNVERIFIED: {
    name: 'Checking records',
    mark: '?',
    color: '#55525E',
    light: '#CFCBD8',
    rank: 0,
    meaning:
      "The campaign records found for this member haven't been confirmed as theirs yet, so no grade or figures are shown. It's a problem with this site's records, not something found about this member.",
  },
};

// Every graph's colours, left (people) to right (corporate): the grades' own,
// S to E (owner, 2026-10-17). The page, the share card and link previews
export const GRAPH_GRADIENT = ['S', 'B', 'C', 'D', 'E'].map(l => GRADES[l].color);

const UNKNOWN = { ...GRADES['N/A'], name: 'Not graded' };

// Why a grade is withheld, when the general words don't fit
// (workers/member-store.js publishedMember: one rule, owner 2026-10-09)
const WITHHELD = {
  'no-campaign-committee': {
    name: 'No campaign records',
    meaning:
      "The FEC has no campaign committee on file for this member for this election, so there are no campaign records to check and grade. It's a gap in the records, not something found about this member.",
  },
  'not-graded': {
    name: 'Checking records',
    meaning:
      "This member's campaign records for this election couldn't be confirmed yet, so no grade or figures are shown. It's a problem with this site's records, not something found about this member.",
  },
};

/**
 * Display details for any tier, with its badge mark. Never throws.
 * `withheldReason` (a withheld grade's, from the API) picks its own words.
 */
export function gradeInfo(tier, withheldReason = null) {
  const g = GRADES[tier] || UNKNOWN;
  const why = RINGFENCED.includes(tier) ? WITHHELD[withheldReason] : null;
  return { tier, mark: g.mark || tier || '–', ...g, ...why };
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
