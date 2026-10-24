import { describe, expect, it } from 'vitest';
import {
  bandOf,
  isOpen,
  nationalFigures,
  racesInView,
  searchRaces,
  stateFigures,
} from './races.js';

const cand = (tier, people, ici = 'C') => ({
  tier,
  ici,
  peoplePowerInfluence: people === null ? null : { people, power: 0, influence: 100 - people },
});

const races = [
  { key: 'S-AK-', office: 'S', state: 'AK', candidates: [cand('B', 62, 'I'), cand('C', 48)] },
  {
    key: 'H-AK-00',
    office: 'H',
    state: 'AK',
    candidates: [cand('S', 94), cand('C', 52), cand(null, null)],
  },
  {
    key: 'H-TX-23',
    office: 'H',
    state: 'TX',
    candidates: [cand('A', 80, 'O'), cand('DISPUTED', 70, 'O')],
  },
];

describe('the Races page (2026-10-23)', () => {
  it('counts candidates who get most of their money from people', () => {
    expect(nationalFigures(races)).toEqual({ races: 3, candidates: 7, graded: 5, mostlyPeople: 4 });
  });

  it('leaves withheld grades out of every count', () => {
    expect(stateFigures(races).TX).toEqual({ races: 1, graded: 1, mostlyPeople: 1, typical: 80 });
  });

  it("colours each state as its typical candidate's share would be graded", () => {
    const s = stateFigures(races);
    // 48, 52, 62 and 94: the middle two average 57, a C
    expect(s.AK).toEqual({ races: 2, graded: 4, mostlyPeople: 3, typical: 57 });
    expect(bandOf(s.AK.typical)).toBe('C');
    expect(bandOf(90)).toBe('S');
    expect(bandOf(14)).toBe('F');
    expect(bandOf(null)).toBeNull();
  });

  it('filters by view and state, never ranking by the figures', () => {
    expect(racesInView(races, 'all').map(r => r.key)).toEqual(['S-AK-', 'H-AK-00', 'H-TX-23']);
    expect(racesInView(races, 'senate').map(r => r.key)).toEqual(['S-AK-']);
    expect(racesInView(races, 'open').map(r => r.key)).toEqual(['H-AK-00', 'H-TX-23']);
    expect(racesInView(races, 'all', 'TX').map(r => r.key)).toEqual(['H-TX-23']);
    expect(isOpen(races[0])).toBe(false);
  });

  it("finds races by a candidate's name or the state", () => {
    const named = races.map((r, i) => ({
      ...r,
      candidates: r.candidates.map((c, j) => ({
        ...c,
        name: [
          'Dan Sullivan',
          'Mary Peltola',
          'Nick Begich',
          'Bill Hill',
          'Eric Hafner',
          'Ana Ruiz',
          'Bo Lee',
        ][i * 2 + j],
      })),
    }));
    const name = { AK: 'Alaska', TX: 'Texas' };
    const keys = q => searchRaces(named, q, s => name[s]).map(r => r.key);
    expect(keys('sullivan')).toEqual(['S-AK-']);
    expect(keys('dan sul')).toEqual(['S-AK-']);
    expect(keys('texas')).toEqual(['H-TX-23']);
    expect(keys('peltola alaska')).toEqual(['S-AK-']);
    expect(keys('nobody')).toEqual([]);
    expect(keys('  ')).toHaveLength(3);
  });
});
