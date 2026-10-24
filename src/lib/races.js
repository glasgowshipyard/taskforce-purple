// The Races page (owner, 2026-10-23): every race for Congress at once, from
// the published races:list. Pure, so the counts and orders are tested
// (races.test.js). "From people" is People, the grade's own share, as on
// every other page.
import { isLetter } from './grades.js';
import { fold } from './search.js';

/** People's share of a candidate's money (null when not graded) */
export const peopleShare = c =>
  isLetter(c.tier) && Number.isFinite(c.peoplePowerInfluence?.people)
    ? c.peoplePowerInfluence.people
    : null;

const graded = cands => cands.filter(c => peopleShare(c) !== null);

/** More than half the money from people */
export const mostlyPeople = c => peopleShare(c) > 50;

/** The headline figures: races, candidates, how many get most from people */
export function nationalFigures(races) {
  const all = races.flatMap(r => r.candidates);
  const withGrade = graded(all);
  return {
    races: races.length,
    candidates: all.length,
    graded: withGrade.length,
    mostlyPeople: withGrade.filter(mostlyPeople).length,
  };
}

/** Each state's graded candidates and how many get most from people */
export function stateFigures(races) {
  const out = {};
  for (const r of races) {
    const s = (out[r.state] ||= { races: 0, graded: 0, mostlyPeople: 0 });
    s.races += 1;
    const g = graded(r.candidates);
    s.graded += g.length;
    s.mostlyPeople += g.filter(mostlyPeople).length;
  }
  return out;
}

/** The map's five shades, from the share of graded candidates mostly funded by people */
export const SHADES = [
  { upTo: 20, label: 'Under 20%' },
  { upTo: 40, label: '20% to 39%' },
  { upTo: 60, label: '40% to 59%' },
  { upTo: 80, label: '60% to 79%' },
  { upTo: Infinity, label: '80% or more' },
];

export function shadeOf(s) {
  if (!s?.graded) {
    return null;
  }
  const pct = (s.mostlyPeople / s.graded) * 100;
  return SHADES.findIndex(x => pct < x.upTo);
}

/** No one in the race holds the seat now */
export const isOpen = race => !race.candidates.some(c => c.ici === 'I');

// No view ranks races by their figures (owner, 2026-10-23: a "biggest gaps"
// list put whatever was most extreme first, a data problem or a $2,000
// campaign beside a $5 million one, at the top of the page)
export const VIEWS = [
  { id: 'all', label: 'Every race' },
  { id: 'senate', label: 'Senate' },
  { id: 'open', label: 'Open seats' },
];

/** The races a view shows, in its order (state: a postal code, or null) */
export function racesInView(races, view, state = null) {
  let list = state ? races.filter(r => r.state === state) : races;
  if (view === 'senate') {
    list = list.filter(r => r.office === 'S');
  } else if (view === 'open') {
    list = list.filter(isOpen);
  }
  return list;
}

/**
 * The races a search finds: every word in it must start a word of a
 * candidate's name, or name the state ("dan sullivan", "texas", "ny")
 */
export function searchRaces(races, query, stateName) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) {
    return races;
  }
  return races.filter(r => {
    const place = fold(`${stateName(r.state)} ${r.state}`).split(' ');
    return r.candidates.some(c => {
      const name = [...fold(c.name).split(' '), ...place];
      return words.every(w => name.some(n => n.startsWith(w)));
    });
  });
}
