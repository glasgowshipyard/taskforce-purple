// The explanations use real members' FINAL-3 working as served by
// /api/member-detail on 2026-10-13.
import { describe, expect, it } from 'vitest';
import {
  bigDonorLine,
  explainGrade,
  moneyPieces,
  moneyStrips,
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

describe('moneyStrips', () => {
  it("the graph's strips: each kind of money in each part, people to corporate", () => {
    expect(moneyStrips(schiff.grade.detail)).toEqual([
      { key: 'small', part: 'people', v: 45 },
      { key: 'big', part: 'people', v: 39 },
      { key: 'pac', part: 'people', v: 1 },
      { key: 'big', part: 'power', v: 7 },
      { key: 'pac', part: 'influence', v: 4 },
      { key: 'directed', part: 'influence', v: 2 },
      { key: 'politicians', part: 'influence', v: 2 },
    ]);
  });

  it('every strip adds up to its part, and every step to its strips', () => {
    for (const m of [schiff, jacobs, aoc]) {
      const strips = moneyStrips(m.grade.detail);
      const e = explainGrade(m);
      for (const part of ['people', 'power', 'influence']) {
        expect(strips.filter(s => s.part === part).reduce((t, s) => t + s.v, 0)).toBe(e.ppi[part]);
      }
      for (const step of e.steps) {
        const fromStrips = strips.filter(s => s.key === step.key).reduce((t, s) => t + s.v, 0);
        expect(step.split.reduce((t, s) => t + s.v, 0)).toBe(fromStrips);
      }
    }
  });
});

describe('explainGrade', () => {
  it('goes through each kind of money and where it went', () => {
    const e = explainGrade(schiff);
    expect(e.headline).toBe('85% of the money came from people');
    expect(e.steps.map(s => s.title)).toEqual([
      'Small donations: 45%',
      'Big donations: 46%',
      'PACs: 5%',
      'Gifts passed on by a committee: 2%',
      'Parties and other politicians: 2%',
    ]);
    expect(e.steps.map(s => s.key)).toEqual(['small', 'big', 'pac', 'directed', 'politicians']);
    // Where each kind of money went, first, so the steps add up to the graph
    expect(e.steps[1].split).toEqual([
      { part: 'people', v: 39 },
      { part: 'power', v: 7 },
    ]);
    expect(e.steps[2].split).toEqual([
      { part: 'people', v: 1 },
      { part: 'influence', v: 4 },
    ]);
    expect(e.steps[3].split).toEqual([{ part: 'influence', v: 2 }]);
    // 339 of 6,512: the share decides it, so the share is the reason given
    expect(e.steps[1].text).toBe(
      'Donations over $200. Half the big money came from just 339 of 6,512 big donors. The fewer the donors who give half of it, the more of it is Power.'
    );
  });

  it('a middle grade: few donors make part of the big money Power', () => {
    const e = explainGrade(jacobs);
    expect(e.ppi).toEqual({ people: 47, power: 20, influence: 33 });
    // 32 of 323 is a broad enough share, but only 32 people: the count decides it
    expect(e.steps.find(s => s.key === 'big').text).toBe(
      'Donations over $200. Half the big money came from just 32 of 323 big donors. When that few give half of it, part of it is Power.'
    );
    expect(e.headline).toBe('47% of the money came from people');
  });

  it('a broad group of big donors: all of it is People money', () => {
    const e = explainGrade(aoc);
    expect(e.steps[1].text).toMatch(/That's a broad group, so all of it is People money\.$/);
    // All of the big money went to People: one entry, no Power
    expect(e.steps[1].split.map(x => x.part)).toEqual(['people']);
  });

  it('never uses the word "count"', () => {
    for (const m of [schiff, jacobs, aoc]) {
      const e = explainGrade(m);
      for (const s of e.steps) {
        expect(`${s.title} ${s.text}`).not.toMatch(/\bcount/i);
      }
      expect(e.headline).not.toMatch(/\bcount/i);
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

  it('how few donors gave half the big money, out of how many', () => {
    expect(bigDonorLine(52, 343, { just: true })).toBe(
      'Half the big money came from just 52 of 343 big donors.'
    );
    expect(bigDonorLine(4609, 31235)).toBe(
      'Half the big money came from 4,609 of 31,235 big donors.'
    );
    expect(bigDonorLine(0, 500)).toBeNull();
  });
});
