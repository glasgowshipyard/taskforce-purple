// Why a member got their grade, in plain English, from the grade's own
// working (workers/tier-calculation.js detail, served by /api/member-detail
// as `grade`). Nothing is recalculated here: the page only explains numbers
// the grading already produced.
import { GRADES, LETTERS } from './grades.js';

const BANDS = { S: 90, A: 75, B: 60, C: 45, D: 30, E: 15, F: 0 };

/** Grade bands on 0-100 after PAC money raised the bar by `shift` points. */
export function gradeBands(shift = 0) {
  return LETTERS.map(letter => {
    const from = letter === 'F' ? 0 : Math.min(100, BANDS[letter] + shift);
    const higher = LETTERS[LETTERS.indexOf(letter) - 1];
    const to = higher ? Math.min(100, BANDS[higher] + shift) : 100;
    return { letter, from, to };
  }).filter(b => b.to > b.from);
}

function bandSentence(score, tier, shift) {
  const band = gradeBands(shift).find(b => b.letter === tier);
  if (!band) {
    return '';
  }
  const article = ['A', 'E', 'F', 'S'].includes(tier) ? 'an' : 'a';
  if (tier === 'F') {
    return `Anything under ${band.to}% is an F.`;
  }
  if (band.to >= 100) {
    return `${band.from}% or more is ${article} ${tier}.`;
  }
  return `Between ${band.from}% and ${band.to - 1}% is ${article} ${tier}.`;
}

const pct = n => `${Math.round(n)}%`;

/** How concentrated the large donors are, in a few words, and whether it's good. */
export function concentrationVerdict(basis) {
  switch (basis) {
    case 'dinner-party':
      return {
        tone: 'bad',
        label: 'Very concentrated',
        text: "That's fewer than 50 people. When so few give half the money, most large donations stop counting toward the grade.",
      };
    case 'elite-capture':
      return {
        tone: 'bad',
        label: 'Concentrated',
        text: "That's under 5% of their named donors, a narrow group, so part of the large-donor money stops counting.",
      };
    case 'standard':
      return {
        tone: 'neutral',
        label: 'Typical spread',
        text: "That's between 5% and 10% of their named donors, a typical spread.",
      };
    case 'movement':
      return {
        tone: 'good',
        label: 'Broad base',
        text: "That's a broad base of donors, so large donations count in their favor.",
      };
    default:
      return null;
  }
}

function allowanceText(basis, d, conc) {
  const n = conc?.n;
  const share = d.nakamotoPercent ? pct(d.nakamotoPercent) : null;
  const of = conc?.of ? ` of the ${conc.of.toLocaleString('en-US')} donors the FEC names` : '';
  const who = n
    ? `${n.toLocaleString('en-US')} ${n === 1 ? 'person' : 'people'} gave half the large-donor money`
    : '';
  switch (basis) {
    case 'dinner-party':
      return `${who}. That's fewer than 50 people, so large donations can only make up ${d.trustAnchor}% of the money from people before the rest stops counting.`;
    case 'elite-capture':
      return `${who}, ${share}${of}. That's a narrow group, so large donations can make up ${d.trustAnchor}% of the money from people before the rest stops counting.`;
    case 'standard':
      return `${who}, ${share}${of}. That's a typical spread, so large donations can make up ${d.trustAnchor}% of the money from people before the rest stops counting.`;
    case 'movement':
      return `${who}, ${share}${of}. That's a broad base, so large donations can make up ${d.trustAnchor}% of the money from people, the most we allow.`;
    default:
      return `We don't have enough donor records yet to measure how concentrated the large donors are, so we use the standard allowance: large donations can make up ${d.trustAnchor}% of the money from people.`;
  }
}

/**
 * The steps from "money raised" to the grade.
 *   lines: the receipt's lines (moneyLines), whole percentages of the total
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

  const others = [
    by('pac') && `PACs (${by('pac')}%)`,
    by('party') && `party committees (${by('party')}%)`,
    by('other') &&
      `other sources (${by('other')}%), such as the candidate's own money, loans or transfers`,
  ].filter(Boolean);
  steps.push({
    title: `${raw}% came from people`,
    tone: raw >= 75 ? 'good' : raw < 45 ? 'bad' : 'neutral',
    text:
      `${small}% from small donors and ${big}% from large donors.` +
      (others.length
        ? ` The other ${100 - raw}% came from ${others.join(' and ')}. That money doesn't count as people-funded.`
        : ''),
  });

  if (d.path === 'enhanced') {
    const lost = Math.max(0, raw - score);
    const over = d.itemizedPercent > d.trustAnchor;
    steps.push({
      title: over ? `${lost} points stop counting` : 'All of it counts',
      tone: over ? 'bad' : 'good',
      text:
        `${allowanceText(d.trustAnchorBasis, d, conc)} ` +
        (over
          ? `Large donations are ${pct(d.itemizedPercent)} of ${name}'s money from people, over the ${d.trustAnchor}% allowance. The amount over it doesn't count.`
          : `Large donations are ${pct(d.itemizedPercent)} of ${name}'s money from people, within the allowance, so it all counts.`),
    });
  }

  if (shift > 0) {
    steps.push({
      title: `The bar is ${shift} points higher`,
      tone: 'bad',
      text: `Some of the PAC money came from super PACs, leadership PACs or lobbyists' PACs, which counts against a grade more heavily. That raises the bar for every grade by ${shift} points: an S needs ${Math.min(100, 90 + shift)}% and anything under ${15 + shift}% is an F.`,
    });
  }

  steps.push({
    title: `${score}% counts, so ${tier === 'A' || tier === 'E' || tier === 'F' || tier === 'S' ? 'an' : 'a'} ${tier}`,
    tone: GRADES[tier].rank >= 6 ? 'good' : GRADES[tier].rank <= 4 ? 'bad' : 'neutral',
    text:
      d.path === 'enhanced'
        ? `${score}% of the money counts as people-funded. ${bandSentence(score, tier, shift)}`
        : `We don't have the detailed donor records for this grade yet, so it's based on the share from small donors alone: ${score}%. ${bandSentence(score, tier, shift)}`,
  });

  return { steps, raw, score, shift };
}
