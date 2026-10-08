// The explanations use real members' working as served by /api/member-detail
// on 2026-10-07.
import { describe, expect, it } from 'vitest';
import { concentrationVerdict, explainGrade, gradeBands } from './explain.js';
import { moneyLines } from './people.js';

const figures = (small, big, pac, total, party = 0) => ({
  totalRaised: total,
  grassrootsDonations: small,
  largeDonorDonations: big,
  pacMoney: pac,
  partyMoney: party,
});

// Half her money is her own (candidate contributions); 34 people gave half
// of her large-donor money
const jacobs = {
  tier: 'F',
  name: 'Sara Jacobs',
  lines: moneyLines(figures(153583, 528678, 245165, 1867293)),
  conc: { n: 34, of: 339 },
  grade: {
    score: 12,
    detail: {
      path: 'enhanced',
      itemizedPercent: 77.5,
      rawIndividualFundingPercent: 37,
      trustAnchor: 10,
      trustAnchorBasis: 'dinner-party',
      nakamotoPercent: 10.03,
      itemizationPenalty: 24.7,
      transparencyPenalty: 3,
    },
  },
};

const aoc = {
  tier: 'S',
  name: 'Alexandria Ocasio-Cortez',
  lines: moneyLines(figures(21838986, 10523069, 28050, 32921787)),
  conc: { n: 4609, of: 31236 },
  grade: {
    score: 98,
    detail: {
      path: 'enhanced',
      itemizedPercent: 32.5,
      rawIndividualFundingPercent: 98,
      trustAnchor: 50,
      trustAnchorBasis: 'movement',
      nakamotoPercent: 14.76,
      itemizationPenalty: 0,
      transparencyPenalty: 0,
    },
  },
};

describe('explainGrade', () => {
  it('an F says where the money came from, what stopped counting, and the line it missed', () => {
    const e = explainGrade(jacobs);
    expect(e.raw).toBe(36);
    expect(e.score).toBe(12);
    const [where, big, result] = e.steps;
    expect(e.steps).toHaveLength(3);
    expect(where.title).toBe('Where each $100 came from');
    expect(where.tone).toBe('bad');
    expect(where.text).toBe(
      "$8 from small donations, $28 from big donations, $13 from PACs and $51 from other places, such as the candidate's own money or loans. Only money donated by people counts toward the grade, so we start with $36."
    );
    expect(big.title).toBe('Some big donations don’t count');
    expect(big.text).toBe(
      'Half of the big-donation money came from just 34 people. When that few people give that much, they could have a lot of sway. So big donations can only make up a tenth of what people gave. Of the $28 in big donations, we count $4. That leaves $12.'
    );
    expect(result.title).toBe('$12 out of $100 is an F');
    expect(result.text).toMatch(/Sara Jacobs would need \$18 to get an E\./);
    expect(result.text).toMatch(/That's \$3 more than usual, because/);
  });

  it('an S says why it is good', () => {
    const e = explainGrade(aoc);
    const [where, big, result] = e.steps;
    expect(e.steps).toHaveLength(3);
    expect(where.tone).toBe('good');
    expect(big.title).toBe('All the big donations count');
    expect(big.text).toMatch(/from 4,609 different people\. That's a broad group/);
    expect(result.title).toBe('$98 out of $100 is an S');
    expect(result.text).toMatch(/An S needs \$90, so this is an S\./);
  });

  it('a middle grade names its line and the next one up', () => {
    const e = explainGrade({
      ...aoc,
      tier: 'D',
      name: 'A member',
      grade: { score: 38, detail: { ...aoc.grade.detail, transparencyPenalty: 6 } },
    });
    expect(e.steps.at(-1).text).toMatch(/A D needs \$36 and a C needs \$51\./);
  });

  it('explains nothing without the working, or for a withheld grade', () => {
    expect(explainGrade({ ...jacobs, grade: null })).toBeNull();
    expect(explainGrade({ ...jacobs, tier: 'UNVERIFIED' })).toBeNull();
  });
});

describe('grade bands', () => {
  it('cover 0 to 100 and move up with the PAC bar', () => {
    const plain = gradeBands(0);
    expect(plain.find(b => b.letter === 'F')).toEqual({ letter: 'F', from: 0, to: 15 });
    expect(plain.find(b => b.letter === 'S')).toEqual({ letter: 'S', from: 90, to: 100 });
    const shifted = gradeBands(6);
    expect(shifted.find(b => b.letter === 'D')).toEqual({ letter: 'D', from: 36, to: 51 });
    // At 10 points or more, an S is out of reach
    expect(gradeBands(10).some(b => b.letter === 'S')).toBe(false);
  });
});

describe('concentration verdict', () => {
  it('says whether the donor spread helps or hurts', () => {
    expect(concentrationVerdict('dinner-party').tone).toBe('bad');
    expect(concentrationVerdict('movement').tone).toBe('good');
    expect(concentrationVerdict('default')).toBeNull();
  });
});
