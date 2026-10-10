// The explanations use real members' working as served by /api/member-detail
// on 2026-10-07.
import { describe, expect, it } from 'vitest';
import {
  concentrationVerdict,
  explainGrade,
  gradeBands,
  headlineFor,
  rankLine,
} from './explain.js';
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
      '$8 from small donations, $28 from big donations, $13 from PACs and $51 from other places, such as loans or transfers. Only money donated by people counts toward the grade, so we start with $36.'
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

describe('headlineFor: lead with what decided the grade (#56)', () => {
  it('an S leads with what helped', () => {
    const h = headlineFor(aoc);
    expect(h.tone).toBe('good');
    expect(h.eyebrow).toBe('What helped the grade');
    expect(h.big).toBe('98% of the money came from people.');
    expect(h.text).toMatch(/from 4,609 different people/);
  });

  it("an F leads with what hurt it most: for Sara Jacobs, money that didn't come from donors", () => {
    const h = headlineFor(jacobs);
    expect(h.tone).toBe('bad');
    expect(h.eyebrow).toBe('What hurt the grade most');
    expect(h.big).toBe("51% of the money didn't come from donors.");
    expect(h.text).toMatch(/loans or transfers/);
  });

  it('PAC money leads when it is the biggest cause', () => {
    const h = headlineFor({
      ...jacobs,
      lines: moneyLines(figures(100000, 300000, 600000, 1000000)),
      conc: null,
    });
    expect(h.big).toBe('60% of the money came from PACs.');
    expect(h.text).toMatch(/other politicians' PACs or super PACs/);
    expect(h.text).not.toMatch(/lobbyist/);
  });

  it('few big donors lead when they cost the most', () => {
    const h = headlineFor({
      ...jacobs,
      lines: moneyLines(figures(80000, 820000, 100000, 1000000)),
    });
    expect(h.big).toBe('34 people gave half the big\u2011donation money.');
    expect(h.showConc).toBe(true);
    expect(h.text).toMatch(/^90% of the money came from people, but few of them gave most of it\./);
  });
});

describe('rankLine', () => {
  const scores = Array.from({ length: 100 }, (_, i) => i);
  it('says where a member stands, in words', () => {
    expect(rankLine(92, scores)).toBe('More people-funded than 92 in 100 members of Congress.');
    expect(rankLine(5, scores)).toBe('Less people-funded than 94 in 100 members of Congress.');
    expect(rankLine(5, scores.slice(0, 10))).toBeNull();
    // The top member isn't "more than 100 in 100"
    expect(rankLine(1000, scores)).toBe('More people-funded than 99 in 100 members of Congress.');
  });
});

describe('own money is set aside first (#59)', () => {
  it('says so, then counts per $100 from others', () => {
    const e = explainGrade({ ...jacobs, ownPct: 50 });
    expect(e.steps[0].text).toMatch(
      /^Sara Jacobs paid \$50 of every \$100 personally\. We leave that out, so these amounts are per \$100 from others: /
    );
  });
});

describe('PAC money traced to people counts in part (#57, version A)', () => {
  // A member with $40 of every $100 from PACs, $14 of it traced to people
  // and counted at half: $7
  const member = {
    tier: 'D',
    name: 'A member',
    lines: moneyLines(figures(200000, 300000, 400000, 1000000)),
    conc: { n: 900, of: 4000 },
    grade: {
      score: 57,
      detail: {
        path: 'enhanced',
        itemizedPercent: 60,
        rawIndividualFundingPercent: 50,
        trustAnchor: 40,
        trustAnchorBasis: 'standard',
        itemizationPenalty: 0,
        transparencyPenalty: 15,
        pacCredit: 7.2,
      },
    },
  };

  it('starts with what people gave directly, then adds the PAC money that counts', () => {
    const e = explainGrade(member);
    expect(e.steps).toHaveLength(4);
    expect(e.steps[0].text).toMatch(
      /We start with the money people gave directly: \$50\. Some of the PAC money is added later\./
    );
    expect(e.steps[1].title).toBe('All the big donations count');
    const pacs = e.steps[2];
    expect(pacs.title).toBe('Some PAC money counts');
    expect(pacs.text).toMatch(/Of the \$40 from PACs, about \$14 traces back to ordinary people\./);
    expect(pacs.text).toMatch(/so we count half: \$7\. That makes \$57\./);
    expect(e.steps[3].title).toBe('$57 out of $100 is a D');
    expect(e.steps[3].text).toMatch(/super PACs or other politicians' PACs/);
  });

  it('big donations that stop counting are worked out before the PAC money', () => {
    const e = explainGrade({
      ...member,
      grade: { score: 40, detail: { ...member.grade.detail, itemizationPenalty: 17 } },
    });
    // 40 - 7 from PACs = 33 before them; 33 - 20 small = 13 of the 30 big
    expect(e.steps[1].text).toMatch(/we count \$13\. That leaves \$33\./);
  });

  it('the headline says only part of the PAC money counts', () => {
    const h = headlineFor({
      ...member,
      lines: moneyLines(figures(100000, 300000, 600000, 1000000)),
      conc: null,
    });
    expect(h.big).toBe('60% of the money came from PACs.');
    expect(h.text).toMatch(/^Only part of it counts: half of what traces back to ordinary people/);
  });
});
