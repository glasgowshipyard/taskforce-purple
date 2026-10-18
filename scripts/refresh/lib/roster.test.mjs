import { describe, expect, it } from 'vitest';
import { crosswalkFile, newRecord, rosterChanges, rosterFrom, rosterRefusal } from './roster.mjs';

const leg = (id, type, state, district, party, first, last, fec = []) => ({
  id: { bioguide: id, fec },
  name: { first, last },
  terms: [{ type, state, district, party }],
});

describe('the roster update (#53)', () => {
  const roster = rosterFrom([
    leg('A1', 'sen', 'VT', undefined, 'Independent', 'Bernard', 'Sanders', ['S4VT00033']),
    leg('B2', 'rep', 'TN', 7, 'Republican', 'Matt', 'Van Epps', ['H6TN07999']),
    leg('C3', 'rep', 'AK', 0, 'Democrat', 'New', 'Member', ['H6AK00001']),
  ]);

  it('reads seats and parties as the site writes them', () => {
    expect(roster.get('A1')).toMatchObject({
      name: 'Sanders, Bernard',
      party: 'Independent',
      state: 'Vermont',
      district: null,
      chamber: 'Senate',
    });
    expect(roster.get('C3')).toMatchObject({ party: 'Democratic', state: 'Alaska', district: 0 });
  });

  it('finds arrivals, departures and changed seats; text districts are numbers', () => {
    const list = [
      {
        bioguideId: 'A1',
        name: 'Sanders, Bernard',
        party: 'Independent',
        state: 'Vermont',
        district: null,
        chamber: 'Senate',
      },
      {
        bioguideId: 'B2',
        name: 'Van Epps, Matt',
        party: 'Republican',
        state: 'Tennessee',
        district: '8',
        chamber: 'House',
      },
      {
        bioguideId: 'Z9',
        name: 'Gone, Old',
        party: 'Democratic',
        state: 'Ohio',
        district: 3,
        chamber: 'House',
      },
    ];
    const c = rosterChanges(roster, list);
    expect(c.added.map(r => r.bioguideId)).toEqual(['C3']);
    expect(c.removed.map(m => m.bioguideId)).toEqual(['Z9']);
    expect(c.changed).toEqual([
      { id: 'B2', name: 'Van Epps, Matt', fields: { district: ['8', 7] } },
    ]);
    // "11" and 11 are the same district
    const same = rosterChanges(roster, [{ ...list[1], district: '7' }]);
    expect(same.changed).toEqual([]);
  });

  it('refuses a roster that looks broken, or a huge change without --allow-big', () => {
    expect(rosterRefusal(roster, { added: [], removed: [] })).toMatch(/only 3 legislators/);
    const big = { size: 539 };
    const many = { added: Array(130).fill({}), removed: [] };
    expect(rosterRefusal(big, many)).toMatch(/--allow-big/);
    expect(rosterRefusal(big, many, { allowBig: true })).toBeNull();
  });

  it('gives a new member an ungraded record and writes the crosswalk', () => {
    const r = newRecord(roster.get('C3'), '2027-01-03T12:00:00Z');
    expect(r).toMatchObject({
      bioguideId: 'C3',
      tier: 'N/A',
      chamber: 'House',
      addedFromRoster: '2027-01-03',
    });
    const file = crosswalkFile(roster, { generated: 'now' });
    expect(file).toMatch(/3 legislators, 3 with at least one FEC candidate ID/);
    expect(file).toMatch(/"C3": \[\s*"H6AK00001"\s*\]/);
  });
});
