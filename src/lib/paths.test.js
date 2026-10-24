import { describe, expect, it } from 'vitest';
import { candidatePath, idFromSlug, memberPath, raceKeyFrom, racePath } from './paths.js';

describe('addresses a person can read out (2026-10-24)', () => {
  it('names a race by year, office and place', () => {
    expect(racePath('H-CA-50', 2026)).toBe('/race/2026/house/california-50');
    expect(racePath('H-AK-00', 2026)).toBe('/race/2026/house/alaska');
    expect(racePath('S-AK', 2026)).toBe('/race/2026/senate/alaska');
    expect(racePath('S-AK-', 2026)).toBe('/race/2026/senate/alaska');
    expect(racePath('S-FL-special', 2026)).toBe('/race/2026/senate/florida-special');
    expect(racePath('H-DC-00', 2026)).toBe('/race/2026/house/district-of-columbia');
    expect(racePath('H-TX-23-special', 2026)).toBe('/race/2026/house/texas-23-special');
  });

  it('reads a race back from its address', () => {
    expect(raceKeyFrom('house', 'california-50')).toBe('H-CA-50');
    expect(raceKeyFrom('house', 'alaska')).toBe('H-AK-00');
    expect(raceKeyFrom('senate', 'alaska')).toBe('S-AK');
    expect(raceKeyFrom('senate', 'florida-special')).toBe('S-FL-special');
    expect(raceKeyFrom('house', 'new-york-7')).toBe('H-NY-07');
    expect(raceKeyFrom('house', 'district-of-columbia')).toBe('H-DC-00');
    expect(raceKeyFrom('house', 'atlantis-1')).toBeNull();
    expect(raceKeyFrom('mayor', 'alaska')).toBeNull();
  });

  it('puts a name in front of the ID, and finds the ID whatever the name', () => {
    expect(memberPath('P000608', 'Peters, Scott H.')).toBe('/member/scott-h-peters-P000608');
    expect(candidatePath('H6CA50324', 'Steve Cohen')).toBe('/candidate/steve-cohen-H6CA50324');
    expect(memberPath('P000608')).toBe('/member/P000608');
    expect(idFromSlug('scott-h-peters-P000608')).toBe('P000608');
    expect(idFromSlug('steve-cohen-h6ca50324')).toBe('H6CA50324');
    expect(idFromSlug('P000608')).toBe('P000608');
    expect(idFromSlug('dan-j-sullivan-S6AK00326')).toBe('S6AK00326');
  });
});
