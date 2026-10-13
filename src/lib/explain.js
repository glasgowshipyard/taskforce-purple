// Why a member got their grade, in words anyone can follow, from the grade's
// own working (workers/tier-calculation.js detail, served by
// /api/member-detail as `grade`). Nothing is recalculated here: the page
// only puts numbers the grading already produced into plain sentences.
//
// Everything is said in dollars out of every $100 raised, because "36% of
// the money" and "points" lose people; "$36 out of every $100" doesn't.
import { GRADES, LETTERS } from './grades.js';
import { CREDIT_WORDS } from './pacs.js';
import { PAC_TRACING } from '../../workers/tier-calculation.js';

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
export function concentrationVerdict(basis, grade = null) {
  if (isFinal3(grade)) {
    return final3Verdict(grade.detail);
  }
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
  if (isFinal3(grade)) {
    return GRADES[tier] && LETTERS.includes(tier) && Number.isFinite(grade.score)
      ? explainFinal3({ tier, grade, name, ownPct })
      : null;
  }
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
  const pac = by('pac');
  // PAC money traced back to people, counted in part (#57). Grades worked
  // out before the PAC money was traced carry no pacCredit
  const pacTraced = d.path === 'enhanced' && Number.isFinite(d.pacCredit);
  const credit = pacTraced ? Math.round(d.pacCredit) : 0;
  const beforePacs = score - credit;
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
        : pacTraced && pac > 0
          ? `${list}. We start with the money people gave directly: $${raw}. Some of the PAC money is added later.`
          : `${list}. Only money donated by people counts toward the grade, so we start with $${raw}.`),
  });

  // 2. Big donations: do they all count?
  if (d.path === 'enhanced' && big > 0) {
    const counted = Math.max(0, Math.min(big, beforePacs - small));
    const lost = big - counted;
    const cap = SHARE_WORDS[d.trustAnchor] || `${d.trustAnchor} in every 100 dollars`;
    steps.push({
      title: lost > 0 ? 'Some big donations don’t count' : 'All the big donations count',
      tone: lost > 0 ? 'bad' : 'good',
      text:
        `${whoGaveText(d.trustAnchorBasis, conc)} ` +
        (lost > 0
          ? `So big donations can only make up ${cap} of what people gave. Of the $${big} in big donations, we count $${counted}. That leaves $${beforePacs}.`
          : `Big donations can make up ${cap} of what people gave, and here they're under that, so all $${big} counts.`),
    });
  }

  // 3. PAC money: the part that traces back to people counts in part
  if (pacTraced && pac > 0) {
    const traced = Math.min(pac, Math.round(d.pacCredit / PAC_TRACING.credit));
    steps.push({
      title: credit > 0 ? 'Some PAC money counts' : 'The PAC money adds nothing',
      tone: credit > 0 ? 'neutral' : 'bad',
      text:
        `PACs pass on money that people gave them. We check who gave each PAC its money, the same way we check ${name}'s own donors. ` +
        (credit > 0
          ? `Of the $${pac} from PACs, about $${traced} traces back to ordinary people. A PAC's leaders choose who gets that money, not the people who gave it, so we count ${CREDIT_WORDS}: $${credit}. That makes $${score}.`
          : `Of the $${pac} from PACs, almost none traces back to a broad group of ordinary people, so it adds less than $1.`),
    });
  }

  // 4. The grade, and the line for it
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
      ? ` ${tier === 'S' || tier === 'F' ? "That's" : 'Both are'} $${shift} more than usual, because some of the PAC money came from super PACs or other politicians' PACs, which we count as worse.`
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
  if (isFinal3(grade) && grade.detail.given > 0) {
    return headlineFinal3({ tier, grade, name });
  }
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
  const pac = by('pac');
  // PAC money counted as people's (#57) is in the score, not lost to it
  const pacTraced = d?.path === 'enhanced' && Number.isFinite(d.pacCredit);
  const pacCounted = pacTraced ? Math.round(d.pacCredit) : 0;
  const lost =
    d?.path === 'enhanced' && Number.isFinite(grade.score)
      ? Math.max(0, raw - (grade.score - pacCounted))
      : 0;
  const other = by('other') + by('party');
  const worst = [
    ['conc', conc ? lost : 0],
    ['pac', pac - pacCounted],
    ['other', other],
  ].sort((a, b) => b[1] - a[1])[0][0];
  const eyebrow = tier === 'C' ? 'What held the grade back' : 'What hurt the grade most';

  if (worst === 'pac') {
    return {
      tone: 'bad',
      eyebrow,
      big: `${pac}% of the money came from PACs.`,
      text:
        (!pacTraced
          ? "PAC money doesn't count as coming from people."
          : pacCounted > 0
            ? `Only part of it counts: ${CREDIT_WORDS} of what traces back to ordinary people who gave to the PACs, $${pacCounted} of every $100.`
            : "Very little of it traces back to ordinary people who gave to the PACs, so it doesn't count toward the grade.") +
        (d?.transparencyPenalty > 0
          ? " Some of it came from other politicians' PACs or super PACs, which make the grade harder to reach."
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

// ---------------------------------------------------------------------
// FINAL-3 (the grading since 2026-10-13): the working is in dollars in
// grade.detail (workers/grading.js gradeMemberFinal3); everything here is
// said per $100 of the money given to the member.
// ---------------------------------------------------------------------

const isFinal3 = grade => grade?.detail?.method === 'final-3';

// Whole dollars out of 100 that add up to 100
function per100(values, total) {
  const raw = values.map(v => (total > 0 ? (Math.max(0, v || 0) / total) * 100 : 0));
  const floors = raw.map(Math.floor);
  let left =
    Math.min(100, Math.round(raw.reduce((t, v) => t + v, 0))) - floors.reduce((t, v) => t + v, 0);
  const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) {
      break;
    }
    floors[i]++;
    left--;
  }
  return floors;
}

const FINAL3_KINDS = {
  small: 'small donations',
  big: 'big donations',
  pac: 'PACs',
  party: 'party committees',
  funds: "other politicians' joint funds",
  directed: 'gifts steered to them by a committee',
};

/** Where each $100 given came from, as FINAL-3 sorts it: [{ key, pct, amount }]. */
export function final3Lines(detail) {
  const d = detail || {};
  const amounts = {
    small: d.small,
    big: d.big,
    pac: d.pac,
    party: d.party,
    funds: d.otherPoliticiansFunds,
    directed: d.directed,
  };
  const keys = Object.keys(amounts);
  const pcts = per100(
    keys.map(k => amounts[k]),
    d.given
  );
  return keys
    .map((key, i) => ({ key, amount: amounts[key] || 0, pct: pcts[i] }))
    .filter(l => l.key === 'small' || l.key === 'big' || l.pct >= 1);
}

/** How broad the big donors were, from the allowance. */
function final3Verdict(d) {
  if (!d?.reliable || !Number.isFinite(d.allowance)) {
    return null;
  }
  if (d.allowance >= 0.75) {
    return {
      tone: 'good',
      label: 'Lots of people.',
      text: "That's a broad group of donors, so most big donations count.",
    };
  }
  if (d.allowance >= 0.4) {
    return {
      tone: 'neutral',
      label: 'A normal spread.',
      text: "That's a normal spread of donors.",
    };
  }
  if (d.allowance >= 0.2) {
    return {
      tone: 'bad',
      label: 'A small group.',
      text: "That's a small group compared with all the donors, so some of the big donations don't count toward the grade.",
    };
  }
  return {
    tone: 'bad',
    label: 'Very few people.',
    text: "When that few people give that much, they could have a lot of sway. Most of their big donations don't count toward the grade.",
  };
}

function explainFinal3({ tier, grade, name, ownPct = 0 }) {
  const d = grade.detail;
  const G = d.given;
  if (!(G > 0)) {
    return null;
  }
  const lines = final3Lines(d);
  const by = key => lines.find(l => l.key === key)?.pct ?? 0;
  const dollars = x => Math.round(((x || 0) / G) * 100);
  const small = by('small');
  const big = by('big');
  const raw = small + big;
  const score = grade.score;
  const steps = [];

  const list = lines.filter(l => l.pct > 0).map(l => `$${l.pct} from ${FINAL3_KINDS[l.key]}`);
  const listText =
    list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  steps.push({
    title: 'Where each $100 came from',
    tone: raw >= 75 ? 'good' : raw < 45 ? 'bad' : 'neutral',
    text:
      (ownPct > 0
        ? `${name} paid some of the money personally. We leave that out, and loans and transfers too, so these amounts are per $100 given by others: `
        : 'Per $100 given (loans and transfers left out): ') +
      `${listText}. We start with the money people gave directly: $${raw}.` +
      (by('funds') > 0
        ? " Money passed on by other politicians' joint funds counts as theirs, so it counts nothing."
        : ''),
  });

  if (d.big > 0) {
    const counted = dollars(d.bigCounted);
    const lost = Math.max(0, big - counted);
    const share = Math.round((d.allowance || 0) * 100);
    const who =
      d.reliable && d.fewestHoldingHalf
        ? `Half of the big-donation money came from ${count(d.fewestHoldingHalf)} ${d.fewestHoldingHalf === 1 ? 'person' : 'people'}, out of ${count(d.donors)} big donors. `
        : "We don't have enough of the donor records to tell how many people gave the big donations, so we use a middle rule. ";
    steps.push({
      title: lost > 0 ? 'Some big donations don’t count' : 'All the big donations count',
      tone: lost > 0 ? 'bad' : 'good',
      text:
        who +
        (lost > 0
          ? `So big donations can only make up ${share} in every 100 dollars that people gave. Of the $${big} in big donations, we count $${counted}.`
          : `Big donations can make up ${share} in every 100 dollars that people gave, and here they're under that, so all $${big} counts.`),
    });
  }

  if (d.pac > 0) {
    const counted = dollars(d.pacCounted);
    steps.push({
      title: counted > 0 ? 'Some PAC money counts' : 'The PAC money counts nothing',
      tone: counted > 0 ? 'neutral' : 'bad',
      text:
        `A PAC counts only when the group behind it is run by its members (they elect its leaders, as in a union), and only the part of its money that traces back to many people. PACs of businesses, politicians and parties, and of groups run by a board, count nothing. ` +
        `Of the $${by('pac')} from PACs, $${counted} counts.`,
    });
  }

  if (d.directed > 0) {
    const counted = dollars(d.directedCounted);
    steps.push({
      title: counted > 0 ? 'Some steered gifts count' : 'Steered gifts count nothing',
      tone: counted > 0 ? 'neutral' : 'bad',
      text: `Some donors gave through a committee that chose to pass their gifts to ${name}. We count those as the committee's gift: they count only if that committee is run by its members. Of the $${by('directed')} given that way, $${counted} counts.`,
    });
  }

  const bands = gradeBands(0);
  const band = bands.find(b => b.letter === tier);
  const next = bands[bands.indexOf(band) - 1];
  const line =
    tier === 'S'
      ? `An S needs $${band.from}, so this is an S.`
      : tier === 'F'
        ? `${name} would need $${next.from} to get an E.`
        : `${tier === 'A' || tier === 'E' ? 'An' : 'A'} ${tier} needs $${band.from} and ${article(next.letter)} ${next.letter} needs $${next.from}.`;
  steps.push({
    title: `$${score} out of $100 is ${article(tier)} ${tier}`,
    tone: GRADES[tier].rank >= 6 ? 'good' : GRADES[tier].rank <= 4 ? 'bad' : 'neutral',
    text: `In the end, $${score} out of every $100 counts as coming from ordinary people. ${line}`,
  });
  return { steps, raw, score, shift: 0 };
}

function headlineFinal3({ tier, grade, name }) {
  const d = grade.detail;
  const lines = final3Lines(d);
  const by = key => lines.find(l => l.key === key)?.pct ?? 0;
  const G = d.given;
  const dollars = x => Math.round(((x || 0) / G) * 100);
  const small = by('small');
  const big = by('big');
  const raw = small + big;
  if (['S', 'A', 'B'].includes(tier)) {
    return {
      tone: 'good',
      eyebrow: 'What helped the grade',
      big: `${raw}% of the money came from people.`,
      text:
        `${small}% came in small donations under $200 and ${big}% in big donations over $200.` +
        (d.reliable && d.fewestHoldingHalf
          ? ` Half of the big-donation money came from ${count(d.fewestHoldingHalf)} different people.`
          : ''),
      showConc: Boolean(d.reliable && d.fewestHoldingHalf),
    };
  }
  const eyebrow = tier === 'C' ? 'What held the grade back' : 'What hurt the grade most';
  const lostBig = Math.max(0, big - dollars(d.bigCounted));
  const lostPac = Math.max(0, by('pac') - dollars(d.pacCounted));
  const lostDirected = Math.max(0, by('directed') - dollars(d.directedCounted));
  const other = by('funds') + by('party');
  const worst = [
    ['conc', lostBig],
    ['pac', lostPac],
    ['directed', lostDirected],
    ['other', other],
  ].sort((a, b) => b[1] - a[1])[0][0];
  if (worst === 'pac') {
    return {
      tone: 'bad',
      eyebrow,
      big: `${by('pac')}% of the money came from PACs.`,
      text: `Only PACs of groups run by their members count, and only the part that traces back to many people: $${dollars(d.pacCounted)} of every $100.`,
      showConc: false,
    };
  }
  if (worst === 'directed') {
    return {
      tone: 'bad',
      eyebrow,
      big: `${by('directed')}% of the money was steered to ${name} by committees.`,
      text: "We count those gifts as the committee's, and they count only when the committee is run by its members.",
      showConc: false,
    };
  }
  if (worst === 'other') {
    return {
      tone: 'bad',
      eyebrow,
      big: `${other}% of the money came from other politicians and parties.`,
      text: "Money from party committees and other politicians' joint funds doesn't count as coming from people.",
      showConc: false,
    };
  }
  return {
    tone: 'bad',
    eyebrow,
    big:
      d.reliable && d.fewestHoldingHalf
        ? `${count(d.fewestHoldingHalf)} ${d.fewestHoldingHalf === 1 ? 'person' : 'people'} gave half the big‑donation money.`
        : `${raw}% of the money came from people.`,
    text:
      `${raw}% of the money came from people, but few of them gave most of it.` +
      (d.reliable && d.donors
        ? ` ${count(d.donors)} people each gave ${name} more than $200. Half of that money came from just ${d.fewestHoldingHalf === 1 ? 'one of them' : `${count(d.fewestHoldingHalf)} of them`}.`
        : ''),
    showConc: Boolean(d.reliable && d.fewestHoldingHalf),
  };
}
