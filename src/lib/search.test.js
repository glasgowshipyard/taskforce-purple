import { describe, expect, it } from 'vitest';
import { fold, searchMembers } from './search.js';

const m = (name, state, party = 'Democratic') => ({ name, state, party, chamber: 'Senate' });
const members = [
  m('Sanders, Bernard', 'Vermont', 'Independent'),
  m('Heinrich, Martin', 'New Mexico'),
  m('Luján, Ben Ray', 'New Mexico'),
  m('Ocasio-Cortez, Alexandria', 'New York'),
  m('Schumer, Charles E.', 'New York'),
  m('Simmons, Ann', 'Ohio', 'Republican'),
];
const names = q => searchMembers(members, q).members.map(x => x.name.split(',')[0]);

describe('searching members the way people type (outside review, 2026-10-17)', () => {
  it('finds common short forms of first names', () => {
    expect(names('Bernie Sanders')).toEqual(['Sanders']);
    expect(names('chuck schumer')).toEqual(['Schumer']);
  });

  it('finds a state by its postal code, and only that state', () => {
    expect(names('NM')).toEqual(['Heinrich', 'Luján']);
    expect(names('New Mexico')).toEqual(['Heinrich', 'Luján']);
  });

  it('ignores accents, hyphens and case; finds initials', () => {
    expect(names('lujan')).toEqual(['Luján']);
    expect(names('cortez')).toEqual(['Ocasio-Cortez']);
    expect(names('AOC')).toEqual(['Ocasio-Cortez']);
  });

  it('matches the start of words, not the middle', () => {
    expect(names('sand')).toEqual(['Sanders']);
    expect(names('ers')).toEqual([]);
  });

  it('shows the closest matches, said so, when no one matches every word', () => {
    const r = searchMembers(members, 'Bernard Smith');
    expect(r.partial).toBe(true);
    expect(r.members.map(x => x.name)).toEqual(['Sanders, Bernard']);
  });

  it('folds text for comparing', () => {
    expect(fold('  Ocasio-Cortez, Alexandría ')).toBe('ocasio cortez alexandria');
  });
});
