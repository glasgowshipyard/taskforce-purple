// Why a member got their grade, in words anyone can follow, from the grade's
// own working (workers/grading.js gradeMemberFinal3, served by
// /api/member-detail as `grade`). Nothing is recalculated here: the page
// only puts numbers the grading already produced into plain sentences.
//
// The money given is told in three parts (owner and Craig, 2026-10-13):
// People, Power and Influence (peoplePowerInfluence in
// workers/tier-calculation.js), as shares of the money given. People
// is the grade's score, so the page has one figure for "from people".
import { GRADES, LETTERS } from './grades.js';
import { final3AllowanceLimits, peoplePowerInfluence } from '../../workers/tier-calculation.js';

export const isFinal3 = grade => grade?.detail?.method === 'final-3';

// Why some money isn't in the grade, said once on /how rather than on every
// member's page; each member's receipt still lists the amounts (owner,
// 2026-10-17). GRASSROOTS_CALCULATION_GUIDE.md Step 0
export const LEFT_OUT =
  "A member's own money, loans, transfers and refunds. Their own money means they depend on no one, so it neither helps nor hurts the grade. Loans are borrowed and refunds are money coming back, not gifts. Transfers only move money between their own committees, where it's already counted. Each member's receipt still lists them.";

// Whole numbers in proportion to `values` that add up to exactly `target`
// (largest remainder)
function roundTo(values, target) {
  const sum = values.reduce((t, v) => t + v, 0);
  if (!(sum > 0) || !(target > 0)) {
    return values.map(() => 0);
  }
  const raw = values.map(v => (v / sum) * target);
  const out = raw.map(Math.floor);
  let left = target - out.reduce((t, v) => t + v, 0);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) {
      break;
    }
    out[i]++;
    left--;
  }
  return out;
}

/**
 * The money given, per $100, in its three parts and the pieces of each:
 * { ppi, people: { small, big, pac, directed }, power: { big },
 *   influence: { pac, directed, party, funds } }. Each part's pieces add up
 * to that part's share, so every figure on the page agrees. A piece can then
 * be a point off its own dollars over the subtotal (35.4% shown as 36%):
 * the owner chose the list adding up to the grade (2026-10-17). Null without
 * a FINAL-3 grade.
 */
export function moneyPieces(detail) {
  const ppi = peoplePowerInfluence(detail);
  if (!ppi) {
    return null;
  }
  const d = detail;
  const v = x => Math.max(0, Number(x) || 0);
  const pieces = {
    people: {
      small: v(d.small),
      big: Math.min(v(d.big), v(d.bigCounted)),
      pac: v(d.pacCounted),
      directed: v(d.directedCounted),
    },
    power: { big: Math.max(0, v(d.big) - v(d.bigCounted)) },
    influence: {
      pac: Math.max(0, v(d.pac) - v(d.pacCounted)),
      directed: Math.max(0, v(d.directed) - v(d.directedCounted)),
      party: v(d.party),
      funds: v(d.otherPoliticiansFunds),
    },
  };
  const out = { ppi };
  for (const [part, amounts] of Object.entries(pieces)) {
    const keys = Object.keys(amounts);
    const rounded = roundTo(
      keys.map(k => amounts[k]),
      ppi[part]
    );
    out[part] = Object.fromEntries(keys.map((k, i) => [k, rounded[i]]));
  }
  return out;
}

/** The one sentence under the graph: "85% of the money came from people." */
export const peopleSentence = people =>
  Number.isFinite(people) ? `${Math.round(people)}% of the money came from people.` : null;

/**
 * Where a score stands in Congress: "Top 11% for grassroots funding",
 * "Pretty mid for grassroots funding", "Bottom 9% for grassroots funding".
 * `scores`: every graded member's. The top and bottom thirds get a number.
 */
export function placementLine(score, scores) {
  if (!Number.isFinite(score) || scores.length < 50) {
    return null;
  }
  const n = scores.length;
  const top = Math.max(1, Math.ceil(((scores.filter(s => s > score).length + 1) / n) * 100));
  const bottom = Math.max(1, Math.ceil(((scores.filter(s => s < score).length + 1) / n) * 100));
  if (top <= 33) {
    return `Top ${top}% for grassroots funding`;
  }
  if (bottom <= 33) {
    return `Bottom ${bottom}% for grassroots funding`;
  }
  return 'Pretty mid for grassroots funding';
}

/**
 * "Half the big money came from just 52 of 343 big donors." (owner,
 * 2026-10-17: the count and the total, no pronouns). `just` when that
 * concentration cost the member some People money.
 */
export function bigDonorLine(fewest, donors, { just = false } = {}) {
  if (!(fewest > 0) || !(donors > 0)) {
    return null;
  }
  const n = v => Math.round(v).toLocaleString('en-US');
  return `Half the big money came from ${just ? 'just ' : ''}${n(fewest)} of ${n(donors)} big donors.`;
}

// The kinds of money, in the order the graph's strips run (people to
// corporate). Each step and each strip carries its key, so pointing at one
// lights the other (MoneyGraph)
export const SOURCES = {
  small: 'Small donations',
  big: 'Big donations',
  pac: 'PACs',
  directed: 'Gifts passed on by a committee',
  politicians: 'Parties and other politicians',
};

/**
 * The graph's strips: each kind of money's share inside each part, people to
 * corporate. [{ key, part: 'people'|'power'|'influence', v }], v in whole
 * percentages adding up to the part's share. Null without a FINAL-3 grade.
 */
export function moneyStrips(detail) {
  const parts = moneyPieces(detail);
  if (!parts) {
    return null;
  }
  const { people, power, influence } = parts;
  return [
    { key: 'small', part: 'people', v: people.small },
    { key: 'big', part: 'people', v: people.big },
    { key: 'pac', part: 'people', v: people.pac },
    { key: 'directed', part: 'people', v: people.directed },
    { key: 'big', part: 'power', v: power.big },
    { key: 'pac', part: 'influence', v: influence.pac },
    { key: 'directed', part: 'influence', v: influence.directed },
    { key: 'politicians', part: 'influence', v: influence.party + influence.funds },
  ].filter(s => s.v > 0);
}

// Where a kind of money went, for the step's first line: [{ part, v }]
const splitOf = pairs => pairs.filter(([, v]) => v > 0).map(([part, v]) => ({ part, v }));

/**
 * Why the big money is split as it is: whichever of the allowance's two limits
 * applied (final3AllowanceLimits in tier-calculation.js).
 */
function bigMoneyReason(d, power) {
  if (!(d.reliable && d.fewestHoldingHalf && d.donors)) {
    return "We don't have enough of the donor records yet to tell how many people gave it, so we use a middle rule.";
  }
  const n = d.fewestHoldingHalf;
  const { shareLimit, countLimit } = final3AllowanceLimits(n, d.donors);
  if (!(power > 0)) {
    return `${bigDonorLine(n, d.donors)} That's a broad group, so all of it is People money.`;
  }
  if (countLimit < shareLimit) {
    return `${bigDonorLine(n, d.donors, { just: true })} When that few give half of it, part of it is Power.`;
  }
  return `${bigDonorLine(n, d.donors, { just: true })} The fewer the donors who give half of it, the more of it is Power.`;
}

/**
 * The steps from the money given to the grade, each a kind of money and
 * where it went: { headline, steps: [{ key, title, split, text, tone }], ppi },
 * or null when there's no working to explain. `split` is where that money
 * went ([{ part, v }]), shown first, so the steps visibly add up to the graph.
 * The headline is the grade's own line; the graph shows the three parts, so
 * nothing restates them (owner, 2026-10-17).
 */
export function explainGrade({ tier, grade, name }) {
  if (!isFinal3(grade) || !GRADES[tier] || !LETTERS.includes(tier)) {
    return null;
  }
  const d = grade.detail;
  const parts = moneyPieces(d);
  if (!parts || !(d.given > 0)) {
    return null;
  }
  const { ppi, people, power, influence } = parts;
  const steps = [];

  if (people.small > 0) {
    steps.push({
      key: 'small',
      title: `${SOURCES.small}: ${people.small}%`,
      split: splitOf([['people', people.small]]),
      tone: 'good',
      text: 'Donations under $200. All of it is People money.',
    });
  }

  const big = people.big + power.big;
  if (big > 0) {
    steps.push({
      key: 'big',
      title: `${SOURCES.big}: ${big}%`,
      split: splitOf([
        ['people', people.big],
        ['power', power.big],
      ]),
      tone: power.big > 0 ? 'bad' : 'good',
      text: `Donations over $200. ${bigMoneyReason(d, power.big)}`,
    });
  }

  const pac = people.pac + influence.pac;
  if (pac > 0) {
    steps.push({
      key: 'pac',
      title: `${SOURCES.pac}: ${pac}%`,
      split: splitOf([
        ['people', people.pac],
        ['influence', influence.pac],
      ]),
      tone: people.pac > 0 ? 'neutral' : 'bad',
      text: "PAC money is People money only when the group behind the PAC is run by its members, who elect most of its board, as in a union. Even then, only the part of the PAC's own money that came from many people. The rest is Influence.",
    });
  }

  const directed = people.directed + influence.directed;
  if (directed > 0) {
    steps.push({
      key: 'directed',
      title: `${SOURCES.directed}: ${directed}%`,
      split: splitOf([
        ['people', people.directed],
        ['influence', influence.directed],
      ]),
      tone: people.directed > 0 ? 'neutral' : 'bad',
      text: `Some donors gave through a committee that chose to pass their gifts to ${name}. Those gifts are the committee's, so they follow the same rule as PACs.`,
    });
  }

  const politicians = influence.party + influence.funds;
  if (politicians > 0) {
    steps.push({
      key: 'politicians',
      title: `${SOURCES.politicians}: ${politicians}%`,
      split: splitOf([['influence', politicians]]),
      tone: 'bad',
      text: "Money from party committees and from other politicians' joint fundraising committees. All of it is Influence.",
    });
  }

  return {
    headline: `${ppi.people}% of the money came from people`,
    steps,
    ppi,
  };
}
