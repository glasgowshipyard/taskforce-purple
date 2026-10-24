// The Races page (owner, 2026-10-23): every race for Congress at once, from
// the published races:list. Pure, so the counts and orders are tested
// (races.test.js). "From people" is People, the grade's own share, as on
// every other page.
import { isLetter } from './grades.js';

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

/**
 * How far apart a race's candidates are: the most people-funded graded
 * candidate's share minus the least's (null with fewer than two graded)
 */
export function gap(race) {
  const shares = graded(race.candidates).map(peopleShare);
  return shares.length < 2 ? null : Math.max(...shares) - Math.min(...shares);
}

/** No one in the race holds the seat now */
export const isOpen = race => !race.candidates.some(c => c.ici === 'I');

export const VIEWS = [
  { id: 'gaps', label: 'Biggest gaps' },
  { id: 'senate', label: 'Senate' },
  { id: 'open', label: 'Open seats' },
  { id: 'all', label: 'Every race' },
];

/** The races a view shows, in its order (state: a postal code, or null) */
export function racesInView(races, view, state = null) {
  let list = state ? races.filter(r => r.state === state) : races;
  if (view === 'senate') {
    list = list.filter(r => r.office === 'S');
  } else if (view === 'open') {
    list = list.filter(isOpen);
  } else if (view === 'gaps') {
    list = list
      .filter(r => gap(r) !== null)
      .sort((a, b) => gap(b) - gap(a) || a.key.localeCompare(b.key));
  }
  return list;
}
