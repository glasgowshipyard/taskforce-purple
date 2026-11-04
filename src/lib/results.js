// The results page (owner's brief, 2026-11-04; ROADMAP 0b): who won, set
// beside where each candidate's money came from. Every figure is worked out
// here from the published races (races.json), outside spending
// (outside.json) and, for who held each seat, the seat list (seats.json),
// so it updates as races are called. Pure, so the counts are tested
// (results.test.js).
//   - Voting seats only: the delegates, who can't vote on laws, are left out
//   - Grades as they stood on election day (the races list)
//   - Outside spending in the general election only (and a special
//     election's own), from outside.json's byStage
//   - Grade-and-winning comparisons count real contests only: races with
//     two or more graded candidates
import { LETTERS, isLetter } from './grades.js';

// The seats whose holder can't vote on laws
export const DELEGATE_STATES = new Set(['AS', 'DC', 'GU', 'MP', 'PR', 'VI']);

export const votingRaces = races =>
  races.filter(r => !(r.office === 'H' && DELEGATE_STATES.has(r.state)));

export const winnerOf = race => race.candidates.find(c => c.won) || null;

/** The voting seats with a winner */
export const calledRaces = races => votingRaces(races).filter(r => r.result && winnerOf(r));

/** People's share of a candidate's money (null when not graded) */
const peopleOf = c =>
  isLetter(c.tier) && Number.isFinite(c.peoplePowerInfluence?.people)
    ? c.peoplePowerInfluence.people
    : null;

const gradedIn = race => race.candidates.filter(c => peopleOf(c) !== null);

/** A real contest: two or more graded candidates */
export const contests = races => calledRaces(races).filter(r => gradedIn(r).length >= 2);

export const hasIncumbent = race => race.candidates.some(c => c.ici === 'I');

/** The winner's main opponent: the other graded candidate who raised most */
export function opponentOf(race) {
  return (
    gradedIn(race)
      .filter(c => !c.won)
      .sort((a, b) => (b.totalRaised || 0) - (a.totalRaised || 0))[0] || null
  );
}

const ZERO = { for: 0, against: 0 };

/** What outside groups spent for and against someone in the general election */
export function generalOutside(person, race) {
  const s = person?.byStage || {};
  const g = s.G || ZERO;
  const special = race?.special ? s.S || ZERO : ZERO;
  return { for: g.for + special.for, against: g.against + special.against };
}

const outsideFor = (outside, c, race) =>
  generalOutside(outside?.people?.[c.bioguideId || c.candidateId], race);

const raceOutside = (outside, race) =>
  race.candidates.reduce((t, c) => {
    const o = outsideFor(outside, c, race);
    return t + o.for + o.against;
  }, 0);

/**
 * The called races outside groups spent most on in the general election:
 * [{ race, total, candidates: [{ c, for, against }] }], the candidates who
 * had at least 2% of it spent on them
 */
export function costliest(races, outside, office, n = 5) {
  return calledRaces(races)
    .filter(r => r.office === office)
    .map(race => ({ race, total: raceOutside(outside, race) }))
    .filter(x => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
    .map(x => ({
      ...x,
      candidates: x.race.candidates
        .map(c => ({ c, ...outsideFor(outside, c, x.race) }))
        .filter(y => y.for + y.against > 0 && y.for + y.against >= 0.02 * x.total)
        .sort((a, b) => b.for + b.against - (a.for + a.against)),
    }));
}

/** The called races an incumbent lost: [{ race, incumbent, winner }] */
export function incumbentsWhoLost(races) {
  return calledRaces(races)
    .map(race => ({
      race,
      incumbent: race.candidates.find(c => c.ici === 'I' && !c.won),
      winner: winnerOf(race),
    }))
    .filter(x => x.incumbent)
    .sort((a, b) => (a.race.office === b.race.office ? 0 : a.race.office === 'S' ? -1 : 1));
}

/**
 * Who won, by grade and role, in real contests: { incumbent, challenger,
 * open } each { S: { won, ran }, ... }. A challenger runs against an
 * incumbent; an open seat has none
 */
export function winsByGrade(races) {
  const out = {};
  for (const role of ['incumbent', 'challenger', 'open']) {
    out[role] = Object.fromEntries(LETTERS.map(l => [l, { won: 0, ran: 0 }]));
  }
  for (const race of contests(races)) {
    const withIncumbent = hasIncumbent(race);
    for (const c of gradedIn(race)) {
      const role = c.ici === 'I' ? 'incumbent' : withIncumbent ? 'challenger' : 'open';
      const cell = out[role][c.tier];
      cell.ran += 1;
      cell.won += c.won ? 1 : 0;
    }
  }
  return out;
}

/**
 * In real contests, how often the winner raised more than their main
 * opponent, and how often they had more of their money from people:
 * { all, incumbent, open } each { races, raisedMore, morePeople }
 */
export function moneyAndResult(races) {
  const tally = list => {
    const pairs = list
      .map(r => [winnerOf(r), opponentOf(r)])
      .filter(([w, o]) => o && peopleOf(w) !== null);
    return {
      races: pairs.length,
      raisedMore: pairs.filter(([w, o]) => (w.totalRaised || 0) > (o.totalRaised || 0)).length,
      morePeople: pairs.filter(([w, o]) => peopleOf(w) > peopleOf(o)).length,
    };
  };
  const all = contests(races);
  return {
    all: tally(all),
    incumbent: tally(all.filter(hasIncumbent)),
    open: tally(all.filter(r => !hasIncumbent(r))),
  };
}

/**
 * Outside money in the general election, for and against the winners and
 * the losers of the called races; and how BOOSTED candidates and
 * self-funders (half or more of their money their own) did
 */
export function outsideAndResult(races, outside) {
  const sums = { winners: { ...ZERO }, losers: { ...ZERO } };
  const boosted = { won: 0, ran: 0 };
  const selfFunded = { won: 0, ran: 0 };
  for (const race of calledRaces(races)) {
    for (const c of race.candidates) {
      const o = outsideFor(outside, c, race);
      const side = c.won ? sums.winners : sums.losers;
      side.for += o.for;
      side.against += o.against;
      if (outside?.people?.[c.bioguideId || c.candidateId]?.boosted) {
        boosted.ran += 1;
        boosted.won += c.won ? 1 : 0;
      }
      if (
        c.tier === 'SELF-FUNDED' ||
        (c.ownMoney > 0 && c.totalRaised > 0 && c.ownMoney / c.totalRaised >= 0.5)
      ) {
        selfFunded.ran += 1;
        selfFunded.won += c.won ? 1 : 0;
      }
    }
  }
  return { ...sums, boosted, selfFunded };
}

/**
 * Each called seat's grade before the election and after: [{ race,
 * before: { name, tier } | null (an empty seat), after }]. Before is the
 * member defending the seat (the race's incumbent; where districts were
 * redrawn, two can run in one, and the one the roster has there is taken),
 * else the member the roster has for the seat (`seats`, seats.json: an open
 * seat), with their grade from the members list; after is the winner's,
 * on election day
 */
export function seatsBeforeAndAfter(races, seats, members) {
  const byId = new Map((members || []).map(m => [m.bioguideId, m]));
  return calledRaces(races).map(race => {
    const defending = race.candidates.filter(c => c.ici === 'I' && c.bioguideId);
    const id =
      defending.find(c => c.bioguideId === seats?.[race.key])?.bioguideId ||
      defending[0]?.bioguideId ||
      seats?.[race.key];
    const m = byId.get(id);
    return { race, before: m ? { name: m.name, tier: m.tier } : null, after: winnerOf(race) };
  });
}

/** How many of a list of tiers fall in each grade, and how many aren't graded */
export function gradeMix(tiers) {
  const mix = Object.fromEntries(LETTERS.map(l => [l, 0]));
  let other = 0;
  for (const t of tiers) {
    if (isLetter(t)) {
      mix[t] += 1;
    } else {
      other += 1;
    }
  }
  return { ...mix, other };
}
