// Why a member got their grade, in words anyone can follow, from the grade's
// own working (workers/tier-calculation.js detail, served by
// /api/member-detail as `grade`). Nothing is recalculated here: the page
// only puts numbers the grading already produced into plain sentences.
//
// Everything is said in dollars out of every $100 raised, because "36% of
// the money" and "points" lose people; "$36 out of every $100" doesn't.
import { GRADES, LETTERS } from './grades.js';

const BANDS = { S: 90, A: 75, B: 60, C: 45, D: 30, E: 15, F: 0 };
const article = tier => (['A', 'E', 'F', 'S'].includes(tier) ? 'an' : 'a');
const count = n => n.toLocaleString('en-US');

/** Grade bands on 0-100 after concerning PAC money raised them by `shift`. */
export function gradeBands(shift = 0) {
  return LETTERS.map(letter => {
    const from = letter === 'F' ? 0 : Math.min(100, BANDS[letter] + shift);
    const higher = LETTERS[LETTERS.indexOf(letter) - 1];
    const to = higher ? Math.min(100, BANDS[higher] + shift) : 100;
    return { letter, from, to };
  }).filter(b => b.to > b.from);
}

/** What the big-donor number on the dark card means, and whether it's good. */
export function concentrationVerdict(basis) {
  switch (basis) {
    case 'dinner-party':
      return {
        tone: 'bad',
        label: 'Very few people.',
        text: "When that few people give that much, they could have a lot of sway. Most of their big donations don't count toward the grade.",
      };
    case 'elite-capture':
      return {
        tone: 'bad',
        label: 'A small group.',
        text: "That's a small group compared with all the donors, so some of the big donations don't count toward the grade.",
      };
    case 'standard':
      return {
        tone: 'neutral',
        label: 'A normal spread.',
        text: "That's a normal spread of donors.",
      };
    case 'movement':
      return {
        tone: 'good',
        label: 'Lots of people.',
        text: "That's a broad group of donors, which is good for the grade.",
      };
    default:
      return null;
  }
}

// How much of the money people gave can come in big donations before the
// rest stops counting, in words
const SHARE_WORDS = { 10: 'a tenth', 25: 'a quarter', 40: '4 in every 10 dollars', 50: 'half' };

function whoGaveText(basis, conc) {
  const n = conc?.n ? count(conc.n) : null;
  const outOf = conc?.of ? `, out of ${count(conc.of)} big donors` : '';
  switch (basis) {
    case 'dinner-party':
      return `Half of the big-donation money came from just ${n} people. When that few people give that much, they could have a lot of sway.`;
    case 'elite-capture':
      return `Half of the big-donation money came from ${n} people${outOf}. That's a small group.`;
    case 'standard':
      return `Half of the big-donation money came from ${n} people${outOf}. That's a normal spread.`;
    case 'movement':
      return `Half of the big-donation money came from ${n} different people. That's a broad group.`;
    default:
      return "We can't tell yet how many people gave the big donations, so we use the middle rule.";
  }
}

/**
 * The steps from "money raised" to the grade.
 *   lines: the receipt's lines (moneyLines), whole dollars out of every $100
 *   grade: { score, detail } from /api/member-detail
 *   conc:  { n, of } from concentration()
 * Returns { steps: [{ title, text, tone }], raw, score, shift } or null when
 * there's no working to explain.
 */
export function explainGrade({ tier, lines, grade, conc, name }) {
  const d = grade?.detail;
  if (!d || !GRADES[tier] || !LETTERS.includes(tier) || !Number.isFinite(grade.score)) {
    return null;
  }
  const by = key => lines.find(l => l.key === key)?.pct ?? 0;
  const small = by('small');
  const big = by('big');
  const raw = small + big;
  const score = grade.score;
  const shift = d.transparencyPenalty || 0;
  const steps = [];

  // 1. Where each $100 came from
  const parts = [
    small && `$${small} from small donations`,
    big && `$${big} from big donations`,
    by('pac') && `$${by('pac')} from PACs`,
    by('party') && `$${by('party')} from party committees`,
    by('other') && `$${by('other')} from other places, such as the candidate's own money or loans`,
  ].filter(Boolean);
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  steps.push({
    title: 'Where each $100 came from',
    tone: raw >= 75 ? 'good' : raw < 45 ? 'bad' : 'neutral',
    text:
      raw >= 100
        ? `${list}. All of it was donated by people, so we start with $${raw}.`
        : `${list}. Only money donated by people counts toward the grade, so we start with $${raw}.`,
  });

  // 2. Big donations: do they all count?
  if (d.path === 'enhanced' && big > 0) {
    const counted = Math.max(0, Math.min(big, score - small));
    const lost = big - counted;
    const cap = SHARE_WORDS[d.trustAnchor] || `${d.trustAnchor} in every 100 dollars`;
    steps.push({
      title: lost > 0 ? 'Some big donations don’t count' : 'All the big donations count',
      tone: lost > 0 ? 'bad' : 'good',
      text:
        `${whoGaveText(d.trustAnchorBasis, conc)} ` +
        (lost > 0
          ? `So big donations can only make up ${cap} of what people gave. Of the $${big} in big donations, we count $${counted}. That leaves $${score}.`
          : `Big donations can make up ${cap} of what people gave, and here they're under that, so all $${big} counts.`),
    });
  }

  // 3. The grade, and the line for it
  const bands = gradeBands(shift);
  const band = bands.find(b => b.letter === tier);
  const next = bands[bands.indexOf(band) - 1];
  let line;
  if (tier === 'S') {
    line = `An S needs $${band.from}, so this is an S.`;
  } else if (tier === 'F') {
    line = `${name} would need $${next.from} to get an E.`;
  } else {
    line = `${tier === 'A' || tier === 'E' ? 'An' : 'A'} ${tier} needs $${band.from} and ${article(next.letter)} ${next.letter} needs $${next.from}.`;
  }
  const shiftNote =
    shift > 0
      ? ` ${tier === 'S' || tier === 'F' ? "That's" : 'Both are'} $${shift} more than usual, because some of the PAC money came from super PACs, lobbyists' PACs or other politicians' PACs, which we count as worse.`
      : '';
  steps.push({
    title: `$${score} out of $100 is ${article(tier)} ${tier}`,
    tone: GRADES[tier].rank >= 6 ? 'good' : GRADES[tier].rank <= 4 ? 'bad' : 'neutral',
    text:
      d.path === 'enhanced'
        ? `In the end, $${score} out of every $100 counts as coming from ordinary people. ${line}${shiftNote}`
        : `We don't have the full donor records for this grade yet, so it only counts small donations: $${score} out of every $100. ${line}${shiftNote}`,
  });

  return { steps, raw, score, shift };
}
