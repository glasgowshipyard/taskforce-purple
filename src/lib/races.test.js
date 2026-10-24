import { describe, expect, it } from 'vitest';
import { gap, isOpen, nationalFigures, racesInView, shadeOf, stateFigures } from './races.js';

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
    expect(stateFigures(races).TX).toEqual({ races: 1, graded: 1, mostlyPeople: 1 });
    expect(gap(races[2])).toBeNull();
  });

  it('shades each state by its share of mostly people-funded candidates', () => {
    const s = stateFigures(races);
    expect(s.AK).toEqual({ races: 2, graded: 4, mostlyPeople: 3 });
    expect(shadeOf(s.AK)).toBe(3);
    expect(shadeOf(undefined)).toBeNull();
  });

  it('orders the biggest gaps first, and filters by view and state', () => {
    expect(racesInView(races, 'gaps').map(r => r.key)).toEqual(['H-AK-00', 'S-AK-']);
    expect(racesInView(races, 'senate').map(r => r.key)).toEqual(['S-AK-']);
    expect(racesInView(races, 'open').map(r => r.key)).toEqual(['H-AK-00', 'H-TX-23']);
    expect(racesInView(races, 'all', 'TX').map(r => r.key)).toEqual(['H-TX-23']);
    expect(isOpen(races[0])).toBe(false);
  });
});
