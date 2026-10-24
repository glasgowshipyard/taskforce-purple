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

/**
 * Each state's graded candidates, how many get most from people, and its
 * typical candidate's share from people: the middle one when they're ranked
 * (the mean of the two middle ones for an even count), whole percent
 */
export function stateFigures(races) {
  const out = {};
  for (const r of races) {
    const s = (out[r.state] ||= { races: 0, graded: 0, mostlyPeople: 0, shares: [] });
    s.races += 1;
    const g = graded(r.candidates);
    s.graded += g.length;
    s.mostlyPeople += g.filter(mostlyPeople).length;
    s.shares.push(...g.map(peopleShare));
  }
  for (const s of Object.values(out)) {
    const v = [...s.shares].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    s.typical = v.length ? Math.round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2) : null;
    delete s.shares;
  }
  return out;
}

// The grade bands (FINAL3.bands in workers/tier-calculation.js): the map
// colours a state as its typical candidate's share would be graded (owner,
// 2026-10-23: "coloured like the gradient")
const BANDS = [
  ['S', 90],
  ['A', 75],
  ['B', 60],
  ['C', 45],
  ['D', 30],
  ['E', 15],
  ['F', -Infinity],
];

/** The grade letter a share from people falls in */
export const bandOf = pct => (pct === null ? null : BANDS.find(([, min]) => pct >= min)[0]);

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
