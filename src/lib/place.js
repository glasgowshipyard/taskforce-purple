// Where the visitor lives, as a state and (when known) a House district, and
// who represents it. Only the district is remembered on this device, never
// the ZIP code or the location it came from.
import { redrawn } from './redistricting.js';
import { stateByCode } from './states.js';

const KEY = 'tfp:place';

/** "OH-4" or "OH" (state only) -> { state, district } */
export function parsePlace(text) {
  const m = /^([A-Z]{2})(?:-(\d{1,2}))?$/.exec(text || '');
  if (!m || !stateByCode[m[1]]) {
    return null;
  }
  return { state: m[1], district: m[2] === undefined ? null : Number(m[2]) };
}

export const placeKey = p => (p.district === null ? p.state : `${p.state}-${p.district}`);

export function savedPlace() {
  try {
    return parsePlace(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function savePlace(place) {
  try {
    if (place) {
      window.localStorage.setItem(KEY, placeKey(place));
    } else {
      window.localStorage.removeItem(KEY);
    }
  } catch {
    // Private browsing: nothing is remembered, and nothing breaks
  }
}

// The district for the 2026 races, kept apart: in a state whose lines
// changed for this election (lib/redistricting.js) it isn't the district
// the visitor is represented in now
const BALLOT_KEY = 'tfp:ballot';

/**
 * Where the visitor votes in 2026: the district they chose for the races,
 * else their current one unless their state's lines changed (then they
 * choose again). A choice for another state than their current place is
 * dropped: they've looked up somewhere new since.
 */
export function savedBallotPlace() {
  const now = savedPlace();
  let chosen = null;
  try {
    chosen = parsePlace(window.localStorage.getItem(BALLOT_KEY));
  } catch {
    chosen = null;
  }
  if (chosen && (!now || now.state === chosen.state)) {
    return chosen;
  }
  return now && !redrawn(now.state) ? now : null;
}

/** Remember the district for the races (and the current place, where the lines didn't change). */
export function saveBallotPlace(place) {
  try {
    if (place) {
      window.localStorage.setItem(BALLOT_KEY, placeKey(place));
    } else {
      window.localStorage.removeItem(BALLOT_KEY);
    }
  } catch {
    // Private browsing: nothing is remembered, and nothing breaks
  }
  if (place && !redrawn(place.state)) {
    savePlace(place);
  }
}

/**
 * The members for a place: its senators, and its House member (or, with no
 * district, every House member for the state).
 */
export function repsFor(members, place) {
  const name = stateByCode[place.state]?.name;
  const inState = members.filter(m => m.state === name);
  const house = inState.filter(m => m.chamber === 'House');
  return {
    senators: inState.filter(m => m.chamber === 'Senate'),
    house:
      place.district === null ? house : house.filter(m => Number(m.district) === place.district),
  };
}

/** Races on this place's ballot: Senate first, then its House seat. */
export function racesFor(races, place) {
  const mine = races.filter(r => r.state === place.state);
  const senate = mine.filter(r => r.office === 'S');
  const house = mine.filter(
    r => r.office === 'H' && (place.district === null || Number(r.district) === place.district)
  );
  return [...house, ...senate];
}
