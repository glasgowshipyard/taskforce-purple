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
  it('an F says where the money came from and what stopped counting', () => {
    const e = explainGrade(jacobs);
    expect(e.raw).toBe(36);
    expect(e.score).toBe(12);
    const [people, allowance, bar, result] = e.steps;
    expect(people.title).toBe('36% came from people');
    expect(people.tone).toBe('bad');
    expect(people.text).toMatch(/other sources \(51%\), such as the candidate's own money/);
    expect(allowance.title).toBe('24 points stop counting');
    expect(allowance.text).toMatch(/fewer than 50 people/);
    expect(allowance.text).toMatch(/only make up 10%/);
    expect(bar.title).toBe('The bar is 3 points higher');
    expect(result.title).toBe('12% counts, so an F');
    expect(result.text).toMatch(/Anything under 18% is an F/);
  });

  it('an S says why it is good', () => {
    const e = explainGrade(aoc);
    const [people, allowance, result] = e.steps;
    expect(e.steps).toHaveLength(3);
    expect(people.tone).toBe('good');
    expect(allowance.title).toBe('All of it counts');
    expect(allowance.text).toMatch(/broad base/);
    expect(result.title).toBe('98% counts, so an S');
    expect(result.text).toMatch(/90% or more is an S/);
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
