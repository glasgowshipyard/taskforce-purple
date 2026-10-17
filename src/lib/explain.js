// Why a member got their grade, in words anyone can follow, from the grade's
// own working (workers/grading.js gradeMemberFinal3, served by
// /api/member-detail as `grade`). Nothing is recalculated here: the page
// only puts numbers the grading already produced into plain sentences.
//
// The money given is told in three parts (owner and Craig, 2026-10-13):
// People, Power and Influence (peoplePowerInfluence in
// workers/tier-calculation.js), as shares of the money given. People
// is the grade's score, so the page has one figure for "from people".
import { GRADES, LETTERS, withArticle } from './grades.js';
import { peoplePowerInfluence } from '../../workers/tier-calculation.js';

const BANDS = { S: 90, A: 75, B: 60, C: 45, D: 30, E: 15, F: 0 };

export const isFinal3 = grade => grade?.detail?.method === 'final-3';

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
 * to that part's share, so every figure on the page agrees. Null without a
 * FINAL-3 grade.
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

/** "Half the big money came from only 5% of big donors." */
export function bigDonorLine(fewest, donors) {
  if (!(fewest > 0) || !(donors > 0)) {
    return null;
  }
  const share = (fewest / donors) * 100;
  if (share < 1) {
    return 'Half the big money came from under 1% of big donors.';
  }
  return `Half the big money came from ${share <= 10 ? 'only ' : ''}${Math.round(share)}% of big donors.`;
}

// What the next grade up needs, or that this is the top one
function nextLine(tier) {
  const i = LETTERS.indexOf(tier);
  if (tier === 'S') {
    return 'An S needs 90%.';
  }
  const up = LETTERS[i - 1];
  const needs = l => `${withArticle(l).replace(/^a/, 'A')} needs ${BANDS[l]}%`;
  return tier === 'F'
    ? `${needs('E')}.`
    : `${needs(tier)} and ${withArticle(up)} needs ${BANDS[up]}%.`;
}

// "Here $7 is People money and $3 is Influence."
function split(people, other, otherName) {
  if (people > 0 && other > 0) {
    return `Here ${people}% of the money is People and ${other}% is ${otherName}.`;
  }
  return people > 0 ? 'Here all of it is People money.' : `Here all of it is ${otherName}.`;
}

/**
 * The steps from the money given to the grade, each a kind of money and
 * where it went: { intro, steps: [{ title, text, tone }], ppi }, or null
 * when there's no working to explain.
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
      title: `Small donations: ${people.small}%`,
      tone: 'good',
      text: 'Donations under $200. All of it is People money.',
    });
  }

  const big = people.big + power.big;
  if (d.big > 0) {
    const who =
      d.reliable && d.fewestHoldingHalf
        ? `${bigDonorLine(d.fewestHoldingHalf, d.donors)} The fewer the donors who give half of it, the less of it is People money. `
        : "We don't have enough of the donor records yet to tell how many people gave it, so we use a middle rule. ";
    steps.push({
      title: `Big donations: ${big}%`,
      tone: power.big > 0 ? 'bad' : 'good',
      text: `Donations over $200. ${who}${split(people.big, power.big, 'Power')}`,
    });
  }

  const pac = people.pac + influence.pac;
  if (pac > 0) {
    steps.push({
      title: `PACs: ${pac}%`,
      tone: people.pac > 0 ? 'neutral' : 'bad',
      text: `PAC money is People money only when the group behind the PAC is run by its members, who elect most of its board, as in a union. Even then, only the part of the PAC's own money that came from many people. ${split(people.pac, influence.pac, 'Influence')}`,
    });
  }

  const directed = people.directed + influence.directed;
  if (directed > 0) {
    steps.push({
      title: `Gifts passed on by a committee: ${directed}%`,
      tone: people.directed > 0 ? 'neutral' : 'bad',
      text: `Some donors gave through a committee that chose to pass their gifts to ${name}. Those gifts are the committee's, so they follow the same rule as PACs. ${split(people.directed, influence.directed, 'Influence')}`,
    });
  }

  const politicians = influence.party + influence.funds;
  if (politicians > 0) {
    steps.push({
      title: `Parties and other politicians: ${politicians}%`,
      tone: 'bad',
      text: "Money from party committees and from other politicians' joint fundraising committees. All of it is Influence.",
    });
  }

  steps.push({
    title: `${ppi.people}% of the money came from people`,
    tone: GRADES[tier].rank >= 6 ? 'good' : GRADES[tier].rank <= 4 ? 'bad' : 'neutral',
    text: `People ${ppi.people}%, Power ${ppi.power}%, Influence ${ppi.influence}%. That's ${withArticle(tier)}: ${GRADES[tier].name}. ${nextLine(tier)}`,
  });

  return {
    intro: `Every share here is of all the money given to ${name}. Their own money, loans and transfers are left out.`,
    steps,
    ppi,
  };
}
