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
export function explainGrade({ tier, lines, grade, conc, name, ownPct = 0 }) {
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
    by('other') && `$${by('other')} from other places, such as loans or transfers`,
  ].filter(Boolean);
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  steps.push({
    title: 'Where each $100 came from',
    tone: raw >= 75 ? 'good' : raw < 45 ? 'bad' : 'neutral',
    text:
      // Own money is set aside before anything else (#59)
      (ownPct > 0
        ? `${name} paid $${ownPct} of every $100 personally. We leave that out, so these amounts are per $100 from others: `
        : '') +
      (raw >= 100
        ? `${list}. All of it was donated by people, so we start with $${raw}.`
        : `${list}. Only money donated by people counts toward the grade, so we start with $${raw}.`),
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

/** Where a score stands in Congress, in words (#56). `scores`: every graded member's. */
export function rankLine(score, scores) {
  if (!Number.isFinite(score) || scores.length < 50) {
    return null;
  }
  // Never "than 100 in 100": the member is one of them
  const share = n => Math.min(99, Math.round((n / scores.length) * 100));
  const more = share(scores.filter(s => s < score).length);
  const less = share(scores.filter(s => s > score).length);
  return more >= less
    ? `More people-funded than ${more} in 100 members of Congress.`
    : `Less people-funded than ${less} in 100 members of Congress.`;
}

/**
 * The one thing that decided the grade, said in its own direction (#56): a
 * good grade leads with what's good, a poor one with what hurt it most. The
 * candidates for "what hurt" are measured the same way, in share of the
 * money: PAC money, money that didn't come from donors, and big donations
 * that stopped counting because few people gave them.
 * Returns { tone, eyebrow, big, text, showConc }.
 */
export function headlineFor({ tier, lines, grade, conc, name }) {
  const by = key => lines.find(l => l.key === key)?.pct ?? 0;
  const small = by('small');
  const big = by('big');
  const raw = small + big;
  const fewPeople = conc
    ? `${count(conc.n)} ${conc.n === 1 ? 'person' : 'people'} gave half the big‑donation money.`
    : null;

  if (['S', 'A', 'B'].includes(tier)) {
    return {
      tone: 'good',
      eyebrow: 'What helped the grade',
      big: `${raw}% of the money came from people.`,
      text:
        `${small}% came in small donations under $200 and ${big}% in big donations over $200.` +
        (conc
          ? ` Half of the big-donation money came from ${count(conc.n)} different people.`
          : ''),
      showConc: Boolean(conc),
    };
  }

  const d = grade?.detail;
  const lost =
    d?.path === 'enhanced' && Number.isFinite(grade.score) ? Math.max(0, raw - grade.score) : 0;
  const pac = by('pac');
  const other = by('other') + by('party');
  const worst = [
    ['conc', conc ? lost : 0],
    ['pac', pac],
    ['other', other],
  ].sort((a, b) => b[1] - a[1])[0][0];
  const eyebrow = tier === 'C' ? 'What held the grade back' : 'What hurt the grade most';

  if (worst === 'pac') {
    return {
      tone: 'bad',
      eyebrow,
      big: `${pac}% of the money came from PACs.`,
      text:
        "PAC money doesn't count as coming from people." +
        (d?.transparencyPenalty > 0
          ? " Some of it came from lobbyists' PACs, other politicians' PACs or super PACs, which count more heavily."
          : ''),
      showConc: false,
    };
  }
  if (worst === 'other') {
    return {
      tone: 'bad',
      eyebrow,
      big: `${other}% of the money didn't come from donors.`,
      text: `It came from other places, such as ${by('party') ? 'party committees, ' : ''}loans or transfers. Only money people donate counts toward the grade.`,
      showConc: false,
    };
  }
  return {
    tone: 'bad',
    eyebrow,
    big: fewPeople || `${raw}% of the money came from people.`,
    // Says the share from people first, so a member with most of their money
    // from people and a poor grade doesn't read as a contradiction
    text:
      `${raw}% of the money came from people, but few of them gave most of it.` +
      (conc?.of
        ? ` ${count(conc.of)} people each gave ${name} more than $200. Half of that money came from just ${conc.n === 1 ? 'one of them' : `${count(conc.n)} of them`}. The other ${count(conc.of - conc.n)} gave the other half.`
        : ''),
    showConc: Boolean(conc),
  };
}
