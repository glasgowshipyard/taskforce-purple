import { describe, expect, it } from 'vitest';
import {
  calledRaces,
  contests,
  costliest,
  generalOutside,
  gradeMix,
  incumbentsWhoLost,
  moneyAndResult,
  outsideAndResult,
  seatsBeforeAndAfter,
  votingRaces,
  winsByGrade,
} from './results.js';

const c = (id, tier, people, extra = {}) => ({
  candidateId: id,
  name: id,
  tier,
  peoplePowerInfluence: people === null ? null : { people, power: 0, influence: 100 - people },
  totalRaised: 1000,
  ...extra,
});
const race = (key, office, state, candidates, extra = {}) => ({
  key,
  office,
  state,
  candidates,
  ...extra,
});

const RACES = [
  // An incumbent (E) beaten by a challenger (A) who raised less
  race(
    'H-PA-01',
    'H',
    'PA',
    [
      c('I1', 'E', 20, { ici: 'I', bioguideId: 'M1', totalRaised: 5000 }),
      c('W1', 'A', 80, { ici: 'C', won: true, totalRaised: 3000 }),
    ],
    { result: { winner: 'W1' } }
  ),
  // An open seat won by the bigger fundraiser with less from people
  race(
    'S-OH',
    'S',
    'OH',
    [
      c('W2', 'D', 35, { ici: 'O', won: true, totalRaised: 9000, ownMoney: 6000 }),
      c('L2', 'B', 65, { ici: 'O', totalRaised: 4000 }),
    ],
    { result: { winner: 'W2' } }
  ),
  // Not called yet
  race('H-NY-01', 'H', 'NY', [c('X', 'C', 50, { ici: 'I' }), c('Y', 'B', 60)]),
  // A delegate's seat: left out
  race('H-GU-00', 'H', 'GU', [c('G1', 'E', 22, { ici: 'I' }), c('G2', 'F', 5, { won: true })], {
    result: { winner: 'G2' },
  }),
];

describe('the results page (2026-11-04)', () => {
  it('counts voting seats only, and only the called ones', () => {
    expect(votingRaces(RACES).map(r => r.key)).toEqual(['H-PA-01', 'S-OH', 'H-NY-01']);
    expect(calledRaces(RACES).map(r => r.key)).toEqual(['H-PA-01', 'S-OH']);
    expect(contests(RACES)).toHaveLength(2);
  });

  it('finds the incumbents who lost', () => {
    const [x] = incumbentsWhoLost(RACES);
    expect(x.incumbent.candidateId).toBe('I1');
    expect(x.winner.candidateId).toBe('W1');
  });

  it('counts who won by grade and role', () => {
    const w = winsByGrade(RACES);
    expect(w.incumbent.E).toEqual({ won: 0, ran: 1 });
    expect(w.challenger.A).toEqual({ won: 1, ran: 1 });
    expect(w.open.D).toEqual({ won: 1, ran: 1 });
    expect(w.open.B).toEqual({ won: 0, ran: 1 });
  });

  it('compares each winner with the opponent who raised most', () => {
    const m = moneyAndResult(RACES);
    expect(m.all).toEqual({ races: 2, raisedMore: 1, morePeople: 1 });
    expect(m.incumbent).toEqual({ races: 1, raisedMore: 0, morePeople: 1 });
    expect(m.open).toEqual({ races: 1, raisedMore: 1, morePeople: 0 });
  });

  it('uses general-election outside money, and a special election its own', () => {
    const person = {
      byStage: {
        P: { for: 100, against: 0 },
        G: { for: 10, against: 5 },
        S: { for: 1, against: 2 },
      },
    };
    expect(generalOutside(person, { special: false })).toEqual({ for: 10, against: 5 });
    expect(generalOutside(person, { special: true })).toEqual({ for: 11, against: 7 });
    expect(generalOutside(null, {})).toEqual({ for: 0, against: 0 });
  });

  it('adds up outside money for and against winners and losers', () => {
    const outside = {
      people: {
        W1: { boosted: true, byStage: { G: { for: 300, against: 100 } } },
        // A member is looked up by bioguide ID
        M1: { byStage: { G: { for: 50, against: 400 } } },
        W2: { byStage: { G: { for: 1, against: 0 } } },
      },
    };
    const t = outsideAndResult(RACES, outside);
    expect(t.winners).toEqual({ for: 301, against: 100 });
    expect(t.losers).toEqual({ for: 50, against: 400 });
    expect(t.boosted).toEqual({ won: 1, ran: 1 });
    expect(t.selfFunded).toEqual({ won: 1, ran: 1 });
    const [top] = costliest(RACES, outside, 'H');
    expect(top.race.key).toBe('H-PA-01');
    expect(top.total).toBe(850);
    expect(top.candidates.map(x => x.c.candidateId)).toEqual(['I1', 'W1']);
  });

  it("takes a seat's member before from the race's incumbent, else the roster", () => {
    const members = [
      { bioguideId: 'M1', name: 'One, Member', tier: 'E' },
      { bioguideId: 'M2', name: 'Two, Member', tier: 'C' },
    ];
    const seats = seatsBeforeAndAfter(RACES, { 'S-OH': 'M2' }, members);
    expect(seats.map(s => [s.race.key, s.before?.tier, s.after.tier])).toEqual([
      ['H-PA-01', 'E', 'A'],
      ['S-OH', 'C', 'D'],
    ]);
    expect(gradeMix(['S', 'A', 'A', 'SELF-FUNDED', undefined])).toMatchObject({
      S: 1,
      A: 2,
      other: 2,
    });
  });
});
