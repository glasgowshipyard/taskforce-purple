// The explanations use real members' FINAL-3 working as served by
// /api/member-detail on 2026-10-13.
import { describe, expect, it } from 'vitest';
import {
  bigDonorLine,
  explainGrade,
  moneyPieces,
  peopleSentence,
  placementLine,
} from './explain.js';

const schiff = {
  tier: 'A',
  name: 'Adam Schiff',
  grade: {
    score: 85,
    detail: {
      method: 'final-3',
      small: 4388582.51,
      big: 4411379.1,
      pac: 474700.98,
      party: 0,
      otherPoliticiansFunds: 189674,
      directed: 159750,
      given: 9624086.59,
      donors: 6512,
      fewestHoldingHalf: 339,
      allowance: 0.4247,
      reliable: true,
      bigCounted: 3737280.99,
      fromPeople: 8125863.5,
      pacCounted: 96931.29,
      directedCounted: 0,
      score: 85,
    },
  },
};

const jacobs = {
  tier: 'C',
  name: 'Sara Jacobs',
  grade: {
    score: 47,
    detail: {
      method: 'final-3',
      small: 153440.93,
      big: 349185.57,
      pac: 244749.94,
      party: 0,
      otherPoliticiansFunds: 159900,
      directed: 25550,
      given: 932826.44,
      donors: 323,
      fewestHoldingHalf: 32,
      allowance: 0.32,
      reliable: true,
      bigCounted: 160840.48,
      fromPeople: 314281.41,
      pacCounted: 123672.67,
      directedCounted: 0,
      score: 47,
    },
  },
};

const aoc = {
  tier: 'S',
  name: 'Alexandria Ocasio-Cortez',
  grade: {
    score: 99,
    detail: {
      method: 'final-3',
      small: 21691400.08,
      big: 10473654.31,
      pac: 28050,
      party: 0,
      otherPoliticiansFunds: 197000,
      directed: 0,
      given: 32390104.39,
      donors: 31235,
      fewestHoldingHalf: 4609,
      allowance: 1,
      reliable: true,
      bigCounted: 10473654.31,
      fromPeople: 32165054.39,
      pacCounted: 22383.38,
      directedCounted: 0,
      score: 99,
    },
  },
};

const sum = o => Object.values(o).reduce((t, v) => t + v, 0);

describe('moneyPieces', () => {
  it('every piece adds up to its part, and People is the score', () => {
    for (const m of [schiff, jacobs, aoc]) {
      const p = moneyPieces(m.grade.detail);
      expect(sum(p.people)).toBe(p.ppi.people);
      expect(sum(p.power)).toBe(p.ppi.power);
      expect(sum(p.influence)).toBe(p.ppi.influence);
      expect(p.ppi.people + p.ppi.power + p.ppi.influence).toBe(100);
      expect(p.ppi.people).toBe(m.grade.score);
    }
  });

  it('splits each kind of money between the parts', () => {
    const p = moneyPieces(schiff.grade.detail);
    expect(p.ppi).toEqual({ people: 85, power: 7, influence: 8 });
    expect(p.people).toEqual({ small: 45, big: 39, pac: 1, directed: 0 });
    expect(p.power).toEqual({ big: 7 });
    expect(p.influence).toEqual({ pac: 4, directed: 2, party: 0, funds: 2 });
  });

  it('is null without a FINAL-3 grade', () => {
    expect(moneyPieces(null)).toBeNull();
    expect(moneyPieces({ method: 'enhanced', given: 10, score: 5 })).toBeNull();
  });
});

describe('explainGrade', () => {
  it('goes through each kind of money and where it went', () => {
    const e = explainGrade(schiff);
    expect(e.intro).toBe(
      'Every share here is of all the money given to Adam Schiff. Their own money, loans and transfers are left out.'
    );
    expect(e.steps.map(s => s.title)).toEqual([
      'Small donations: 45%',
      'Big donations: 46%',
      'PACs: 5%',
      'Gifts passed on by a committee: 2%',
      'Parties and other politicians: 2%',
      '85% of the money came from people',
    ]);
    expect(e.steps[1].text).toMatch(/Half the big money came from only 5% of big donors\./);
    expect(e.steps[1].text).toMatch(/Here 39% of the money is People and 7% is Power\.$/);
    expect(e.steps[2].text).toMatch(/Here 1% of the money is People and 4% is Influence\.$/);
    expect(e.steps[3].text).toMatch(/Here all of it is Influence\.$/);
    expect(e.steps[5].text).toBe(
      "People 85%, Power 7%, Influence 8%. That's an A: Supported. An A needs 75% and an S needs 90%."
    );
  });

  it('a middle grade names its line and the next one up', () => {
    const e = explainGrade(jacobs);
    expect(e.ppi).toEqual({ people: 47, power: 20, influence: 33 });
    expect(e.steps.at(-1).text).toMatch(/That's a C: Mixed\. A C needs 45% and a B needs 60%\.$/);
  });

  it('the top grade says what it needs', () => {
    const e = explainGrade(aoc);
    expect(e.steps[1].text).toMatch(/Here all of it is People money\.$/);
    expect(e.steps.at(-1).text).toMatch(/That's an S: Grassroots\. An S needs 90%\.$/);
  });

  it('never uses the word "count"', () => {
    for (const m of [schiff, jacobs, aoc]) {
      const e = explainGrade(m);
      for (const s of e.steps) {
        expect(`${s.title} ${s.text}`).not.toMatch(/\bcount/i);
      }
    }
  });

  it('nothing to explain without a letter grade or its working', () => {
    expect(explainGrade({ ...schiff, grade: null })).toBeNull();
    expect(explainGrade({ ...schiff, tier: 'UNVERIFIED' })).toBeNull();
  });
});

describe('the lines at the top of a member page', () => {
  it('one sentence for the money from people', () => {
    expect(peopleSentence(85)).toBe('85% of the money came from people.');
    expect(peopleSentence(null)).toBeNull();
  });

  it('placement: top and bottom thirds get a number, the middle is mid', () => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    expect(placementLine(92, scores)).toBe('Top 8% for grassroots funding');
    expect(placementLine(99, scores)).toBe('Top 1% for grassroots funding');
    expect(placementLine(5, scores)).toBe('Bottom 6% for grassroots funding');
    expect(placementLine(50, scores)).toBe('Pretty mid for grassroots funding');
    expect(placementLine(50, scores.slice(0, 10))).toBeNull();
  });

  it('how few donors gave half the big money, as a share of them', () => {
    expect(bigDonorLine(339, 6512)).toBe('Half the big money came from only 5% of big donors.');
    expect(bigDonorLine(4609, 31235)).toBe('Half the big money came from 15% of big donors.');
    expect(bigDonorLine(1, 500)).toBe('Half the big money came from under 1% of big donors.');
    expect(bigDonorLine(0, 500)).toBeNull();
  });
});
