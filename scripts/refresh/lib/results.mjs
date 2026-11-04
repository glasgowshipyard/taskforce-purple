/**
 * Who won each race (owner, 2026-11-04: "If they've been called they get
 * marked"). Wikipedia's results tables tick a called race's winner
 * (wikiSeats in lib/ballot.mjs: `won: true`). The winner is matched inside
 * their own race, to the candidates the race already lists, never searched
 * for: the same name, or the one candidate whose name fits (nameFit).
 *
 * Where Wikipedia hasn't ticked a called race yet, a news organization's
 * call read by hand from its own results page (scripts/refresh/data/
 * calls.json) marks it, matched the same way.
 *
 * A race's result is { winner: the name as the source gives it, and either
 * revid: the Wikipedia version it was read from, or by, source: who called
 * it and the page }, and the winner's entry has `won: true`. A result is
 * kept when a later version drops the tick (pages are edited all day), and
 * replaced only when a source names someone else.
 */
import { nameFit, seatKey, seatOf } from './ballot.mjs';

const candidateKey = c => c.candidateId || `${c.name}`;

/** The one candidate in a race the winner's name belongs to, or null */
export function winnerIn(race, name) {
  const exact = race.candidates.filter(c => c.name === name);
  if (exact.length === 1) {
    return exact[0];
  }
  const fits = race.candidates.map(c => ({ c, fit: nameFit(name, c.name) }));
  const full = fits.filter(x => x.fit === 'full');
  if (full.length === 1) {
    return full[0].c;
  }
  const family = fits.filter(x => x.fit === 'family');
  return full.length === 0 && family.length === 1 ? family[0].c : null;
}

/**
 * Mark the called races. `pages`: [{ office, revid, seats }] (seats from
 * wikiSeats); `calls`: { raceKey: { winner, by, source } } (calls.json),
 * which win over Wikipedia's ticks. Returns the races with results, and
 * what changed:
 * `marked` (new results), `replaced` (a different winner than before),
 * `unmatched` (a tick no candidate in the race fits) and `unknown` (a
 * ticked seat with no race)
 */
export function applyResults(races, pages, stateByName, cycle, calls = {}) {
  const byKey = new Map(races.map(r => [r.key, r]));
  const found = new Map();
  const unmatched = [];
  const unknown = [];
  for (const { office, revid, seats } of pages) {
    for (const s of seats) {
      const won = s.candidates.filter(c => c.won);
      if (won.length !== 1) {
        continue;
      }
      const seat = seatOf(office, s.label, stateByName, cycle);
      const race = seat && byKey.get(seatKey(seat));
      if (!race) {
        unknown.push({ label: s.label, name: won[0].name });
        continue;
      }
      const c = winnerIn(race, won[0].name);
      if (!c) {
        unmatched.push({ key: race.key, name: won[0].name });
        continue;
      }
      found.set(race.key, { result: { winner: won[0].name, revid }, id: candidateKey(c) });
    }
  }
  for (const [key, call] of Object.entries(calls)) {
    const race = byKey.get(key);
    const c = race && winnerIn(race, call.winner);
    if (!race) {
      unknown.push({ label: key, name: call.winner });
    } else if (!c) {
      unmatched.push({ key, name: call.winner });
    } else {
      found.set(key, {
        result: { winner: call.winner, by: call.by, source: call.source },
        id: candidateKey(c),
      });
    }
  }
  const marked = [];
  const replaced = [];
  const out = races.map(r => {
    const f = found.get(r.key);
    const before = r.result;
    const winnerBefore = r.candidates.find(c => c.won);
    if (!f || (before && winnerBefore && candidateKey(winnerBefore) === f.id)) {
      return r;
    }
    (before ? replaced : marked).push({
      key: r.key,
      winner: f.result.winner,
      before: before?.winner,
    });
    return {
      ...r,
      result: f.result,
      candidates: r.candidates.map(c => {
        const rest = { ...c };
        delete rest.won;
        return candidateKey(c) === f.id ? { ...rest, won: true } : rest;
      }),
    };
  });
  return { races: out, marked, replaced, unmatched, unknown };
}

/**
 * A rebuilt races list keeps the results already published (the races job,
 * if it's ever run again, mustn't wipe them): each race's result, and the
 * winner's mark when the winner is still in the race
 */
export function keepResults(races, current) {
  const before = new Map((current?.races || []).map(r => [r.key, r]));
  return races.map(r => {
    const b = before.get(r.key);
    const winner = b?.candidates.find(c => c.won);
    if (!b?.result || !winner) {
      return r;
    }
    const id = candidateKey(winner);
    if (!r.candidates.some(c => candidateKey(c) === id)) {
      return r;
    }
    return {
      ...r,
      result: b.result,
      candidates: r.candidates.map(c => (candidateKey(c) === id ? { ...c, won: true } : c)),
    };
  });
}
