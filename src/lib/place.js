// Where the visitor lives, as a state and (when known) a House district, and
// who represents it. Only the district is remembered on this device, never
// the ZIP code or the location it came from.
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
