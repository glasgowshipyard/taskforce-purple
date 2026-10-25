// Outside spending: what groups other than a candidate's own committees
// reported spending to help or hurt them (the FEC's independent-expenditure
// filings, worked out at build time: scripts/site/outside.mjs). Never part
// of the grade. Everything the site says about it is here.
import { usd } from './people.js';

/**
 * The least help that can earn the stamp: the amount the FEC makes a group
 * report within 48 hours. Below it a candidate who raised nothing would be
 * "boosted" by a single flyer.
 */
export const BOOST_FLOOR = 10000;

/**
 * People whose own figures are known to be wrong, so a comparison with them
 * would be too: no stamp until they're re-graded. Each with why and when
 */
export const BOOST_HELD = {
  // Empty since 2026-10-25: J000310, held that morning (graded on her
  // leadership PAC alone after her campaign became a PAC), re-graded on
  // $2,394,655 the same day
};

/**
 * BOOSTED (owner, 2026-10-25): outside groups spent more to help them than
 * their own campaign raised in all. Money spent against them never counts.
 */
export const isBoosted = (o, totalRaised, personId = null) =>
  Boolean(o) &&
  !(personId && BOOST_HELD[personId]) &&
  o.for >= BOOST_FLOOR &&
  o.for > (totalRaised || 0);

/** How many times over, when it's at least twice (else null) */
export function timesOver(o, totalRaised) {
  if (!(o?.for > totalRaised) || !(totalRaised > 0)) {
    return null;
  }
  const times = Math.floor(o.for / totalRaised);
  return times >= 2 ? times : null;
}

/**
 * The line beside the grade for a boosted candidate, after the word
 * "Boosted:" (owner, 2026-10-25: the word links to its meaning on /how)
 */
export function boostedDetail(o, totalRaised, personId = null) {
  if (!isBoosted(o, totalRaised, personId)) {
    return null;
  }
  if (!(totalRaised > 0)) {
    return `groups spent ${usd(o.for)} to help them. Their campaign has reported raising nothing.`;
  }
  const times = timesOver(o, totalRaised);
  return times
    ? `groups spent ${usd(o.for)} to help them, more than ${times} times what their campaign raised.`
    : `groups spent ${usd(o.for)} to help them, more than their campaign raised (${usd(totalRaised)}).`;
}

/** The same line as text: "Boosted: groups spent ..." */
export function boostedSentence(o, totalRaised, personId = null) {
  const detail = boostedDetail(o, totalRaised, personId);
  return detail && `Boosted: ${detail}`;
}

/** What the stamp means: /how#boosted and the pre-built pages */
export const BOOSTED_MEANING =
  'BOOSTED means super PACs and other groups spent more to help a candidate than their own campaign raised. Money spent to beat them doesn\u2019t count. It isn\u2019t part of the grade.';

/** The same, in one line: the Races page */
export const BOOSTED_SHORT =
  'BOOSTED means groups spent more to help a candidate than their campaign raised.';

/** When a group spent: the FEC's election codes, as words */
const STAGE = { P: 'primary', R: 'runoff', G: 'general' };
export function stageText(stages = []) {
  const words = ['P', 'R', 'G'].filter(s => stages.includes(s)).map(s => STAGE[s]);
  return words.length < 2 ? words[0] || '' : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The (i) under the figures: the filers left out */
export const LEFT_OUT_NOTE =
  'The FEC publishes every report as it’s filed and checks it afterwards, so its files include reports from filers who aren’t registered committees, some claiming billions of dollars. Only groups on the FEC’s register of committees are counted here.';

export const REGISTER_URL = 'https://www.fec.gov/data/committees/';
export const OUTSIDE_SOURCE_URL = 'https://www.fec.gov/data/independent-expenditures/';

/** The section's empty line */
export const NO_OUTSIDE =
  'No super PACs or other groups have reported spending to help or beat them.';
