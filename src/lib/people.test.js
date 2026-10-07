import { describe, expect, it } from 'vitest';
import {
  concentration,
  displayName,
  fractionWords,
  moneyLines,
  roleTitle,
  seatLabel,
  usdShort,
} from './people.js';
import { parsePlace, placeKey, racesFor, repsFor } from './place.js';

describe('displayName', () => {
  it('turns "Last, First" round and drops initials', () => {
    expect(displayName('Heinrich, Martin')).toBe('Martin Heinrich');
    expect(displayName('Plaskett, Stacey E.')).toBe('Stacey Plaskett');
  });

  it('uses the name people know: nicknames, compound first names, suffixes', () => {
    expect(displayName('García, Jesús G. "Chuy"')).toBe('Chuy García');
    expect(displayName('Scanlon, Mary Gay')).toBe('Mary Gay Scanlon');
    expect(displayName('King, Angus S., Jr.')).toBe('Angus King Jr.');
    expect(displayName('Weber, Randy K. Sr.')).toBe('Randy Weber Sr.');
  });

  it('leaves a name without a comma alone', () => {
    expect(displayName('Cher')).toBe('Cher');
    expect(displayName(undefined)).toBe('');
  });
});

describe('seats', () => {
  it('names each kind of seat', () => {
    expect(seatLabel({ chamber: 'Senate', state: 'Ohio' })).toBe('Senate · Ohio');
    expect(seatLabel({ chamber: 'House', state: 'Ohio', district: 4 })).toBe('House · Ohio 4');
    expect(seatLabel({ chamber: 'House', state: 'Alaska', district: 0 })).toBe(
      'House · Alaska at large'
    );
    expect(seatLabel({ chamber: 'House', state: 'Guam', district: 0 })).toBe('Delegate · Guam');
    expect(seatLabel({ chamber: 'House', state: 'Puerto Rico', district: 0 })).toBe(
      'Resident Commissioner · Puerto Rico'
    );
  });

  it('titles without guessing anything about the person', () => {
    expect(roleTitle({ chamber: 'Senate', state: 'Ohio' })).toBe('Senator');
    expect(roleTitle({ chamber: 'House', state: 'Ohio' })).toBe('Representative');
    expect(roleTitle({ chamber: 'House', state: 'District of Columbia' })).toBe('Delegate');
  });
});

describe('moneyLines', () => {
  const f = {
    totalRaised: 1000,
    grassrootsDonations: 333,
    largeDonorDonations: 333,
    pacMoney: 334,
    partyMoney: 0,
  };

  it('whole percentages that add up to 100', () => {
    const lines = moneyLines(f);
    expect(lines.map(l => l.key)).toEqual(['small', 'big', 'pac']);
    expect(lines.reduce((s, l) => s + l.pct, 0)).toBe(100);
  });

  it('shows party and other money only when there is some', () => {
    const lines = moneyLines({ ...f, pacMoney: 200, partyMoney: 34 });
    expect(lines.map(l => l.key)).toEqual(['small', 'big', 'pac', 'party', 'other']);
    expect(lines.find(l => l.key === 'other').amount).toBe(100);
  });
});

describe('concentration', () => {
  it('reads the published coefficient, with the donor count when known', () => {
    expect(concentration({ nakamotoCoefficient: 89, uniqueDonors: 823 })).toEqual({
      n: 89,
      of: 823,
    });
    expect(concentration({ nakamoto: 14 })).toEqual({ n: 14, of: null });
  });

  it('says nothing for under ten donors or no data', () => {
    expect(concentration({ nakamotoCoefficient: 2, uniqueDonors: 6 })).toBeNull();
    expect(concentration({ nakamotoCoefficient: null })).toBeNull();
    expect(concentration({ nakamotoCoefficient: 0 })).toBeNull();
  });
});

describe('words and money', () => {
  it('names simple fractions only when close', () => {
    expect(fractionWords(415 / 537)).toBe('Three in four');
    expect(fractionWords(0.6)).toBeNull();
  });

  it('shortens money', () => {
    expect(usdShort(9_600_000)).toBe('$9.6M');
    expect(usdShort(18_200_000)).toBe('$18M');
    expect(usdShort(610_000)).toBe('$610K');
    expect(usdShort(9_400)).toBe('$9,400');
  });
});

describe('place', () => {
  const members = [
    { bioguideId: 'H1', chamber: 'House', state: 'Ohio', district: 4 },
    { bioguideId: 'H2', chamber: 'House', state: 'Ohio', district: '3' },
    { bioguideId: 'S1', chamber: 'Senate', state: 'Ohio', district: null },
    { bioguideId: 'S2', chamber: 'Senate', state: 'Ohio', district: null },
    { bioguideId: 'S3', chamber: 'Senate', state: 'Texas', district: null },
  ];

  it('round-trips what is remembered', () => {
    expect(parsePlace('OH-4')).toEqual({ state: 'OH', district: 4 });
    expect(parsePlace('OH')).toEqual({ state: 'OH', district: null });
    expect(parsePlace('ZZ-1')).toBeNull();
    expect(parsePlace('43215')).toBeNull();
    expect(placeKey({ state: 'AK', district: 0 })).toBe('AK-0');
  });

  it('finds the House member and both senators', () => {
    const r = repsFor(members, { state: 'OH', district: 3 });
    expect(r.house.map(m => m.bioguideId)).toEqual(['H2']);
    expect(r.senators.map(m => m.bioguideId)).toEqual(['S1', 'S2']);
    expect(repsFor(members, { state: 'OH', district: null }).house).toHaveLength(2);
  });

  it('puts your House race first, then the Senate', () => {
    const races = [
      { key: 'S-OH-', state: 'OH', office: 'S', district: '' },
      { key: 'H-OH-04', state: 'OH', office: 'H', district: '04' },
      { key: 'H-OH-03', state: 'OH', office: 'H', district: '03' },
      { key: 'S-TX-', state: 'TX', office: 'S', district: '' },
    ];
    expect(racesFor(races, { state: 'OH', district: 4 }).map(r => r.key)).toEqual([
      'H-OH-04',
      'S-OH-',
    ]);
  });
});
