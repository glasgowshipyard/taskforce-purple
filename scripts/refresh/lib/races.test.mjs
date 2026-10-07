import { describe, expect, it } from 'vitest';
import { buildRaces, displayName, parseWeball, raceLabel } from './races.mjs';

const row = (id, name, ici, party, receipts, state, district) => {
  const f = Array(30).fill('');
  Object.assign(f, { 0: id, 1: name, 2: ici, 4: party, 5: receipts, 18: state, 19: district });
  return f.join('|');
};

describe('races helpers', () => {
  it('reads House and Senate candidates from the FEC summary file', () => {
    const m = parseWeball(
      [
        row('H6ZZ01001', 'DOE, JANE', 'C', 'DEM', '250000.5', 'ZZ', '1'),
        row('S6ZZ00001', 'ROE, RICHARD', 'I', 'REP', '900000', 'ZZ', '00'),
        row('P60000001', 'PRES, IDENT', 'C', 'IND', '5', 'US', '00'),
      ].join('\n')
    );
    expect([...m.keys()]).toEqual(['H6ZZ01001', 'S6ZZ00001']);
    expect(m.get('H6ZZ01001')).toMatchObject({ office: 'H', district: '01', receipts: 250000.5 });
    expect(m.get('S6ZZ00001')).toMatchObject({ office: 'S', district: '', ici: 'I' });
  });

  it('names read normally', () => {
    expect(displayName('DOE, JANE Q')).toBe('Doe, Jane Q');
    expect(displayName("O'NEIL-SMITH, MARY  ANN")).toBe("O'Neil-Smith, Mary Ann");
    expect(displayName('MCDONALD, PAT')).toBe('McDonald, Pat');
  });

  it('labels races plainly', () => {
    expect(raceLabel('S', '')).toBe('Senate');
    expect(raceLabel('H', '00')).toBe('House (at-large)');
    expect(raceLabel('H', '07')).toBe('House district 7');
  });

  it('groups by race: state, Senate first, districts in order, money first', () => {
    const races = buildRaces([
      { office: 'H', state: 'ZZ', district: '02', candidateId: 'a', totalRaised: 5 },
      { office: 'S', state: 'ZZ', district: '', candidateId: 'b', totalRaised: 1 },
      { office: 'H', state: 'ZZ', district: '01', candidateId: 'c', totalRaised: 1 },
      { office: 'H', state: 'ZZ', district: '01', candidateId: 'd', totalRaised: 9 },
      { office: 'H', state: 'AA', district: '01', candidateId: 'e', totalRaised: 1 },
    ]);
    expect(races.map(r => r.key)).toEqual(['H-AA-01', 'S-ZZ-', 'H-ZZ-01', 'H-ZZ-02']);
    expect(races[2].candidates.map(c => c.candidateId)).toEqual(['d', 'c']);
  });
});
