import { describe, expect, it } from 'vitest';
import {
  classifyOrganization,
  foreignInterestFor,
  quicklookSectors,
  SECTORS,
  sectorInfo,
} from './donor-taxonomy.js';

describe('classifyOrganization', () => {
  it('classifies real conduit names seen in production', () => {
    expect(classifyOrganization('ACTBLUE')).toBe('platform');
    expect(classifyOrganization('WINRED - CONDUIT')).toBe('platform');
    expect(classifyOrganization('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC - CONDUIT')).toBe(
      'pro-israel'
    );
    expect(classifyOrganization('NORPAC')).toBe('pro-israel');
    expect(classifyOrganization('JSTREETPAC')).toBe('pro-israel');
    expect(classifyOrganization('SENATE CONSERVATIVES FUND')).toBe('party-machine');
    expect(classifyOrganization('CLUB FOR GROWTH')).toBe('party-machine');
    expect(classifyOrganization('EMILYS LIST')).toBe('party-machine');
    expect(classifyOrganization('NATIONAL ASSOCIATION OF BROADCASTERS PAC')).toBe('industry');
    expect(classifyOrganization('ONEIDA NATION TRIBE')).toBe('tribal');
  });

  it('unknown names fall back to other, never hidden', () => {
    expect(classifyOrganization('SOME RANDOM PAC')).toBe('other');
    expect(classifyOrganization('')).toBe('other');
    expect(classifyOrganization(null)).toBe('other');
  });

  it('every sector used by rules exists in SECTORS with label and icon', () => {
    for (const key of Object.keys(SECTORS)) {
      expect(sectorInfo(key).label).toBeTruthy();
      expect(sectorInfo(key).icon).toBeTruthy();
    }
  });
});

describe('foreignInterestFor', () => {
  it('names the country a network exists to advance', () => {
    expect(foreignInterestFor('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC').country).toBe(
      'Israel'
    );
    expect(foreignInterestFor('NORPAC').country).toBe('Israel');
    expect(foreignInterestFor('JSTREETPAC').country).toBe('Israel');
    expect(foreignInterestFor('ARMENIAN NATIONAL COMMITTEE OF AMERICA').country).toBe('Armenia');
    expect(foreignInterestFor('TURKISH COALITION USA PAC').country).toBe('Turkey');
    expect(foreignInterestFor('US-CUBA DEMOCRACY PAC').country).toBe('Cuba');
    expect(foreignInterestFor('HELLENIC AMERICAN PAC').country).toBe('Greece');
  });

  it('applies to every country alike, not one', () => {
    // If only one country were listed this would be a targeting tool.
    const countries = new Set(
      [
        'AIPAC',
        'ARMENIAN NATIONAL COMMITTEE',
        'TURKISH COALITION',
        'US-CUBA DEMOCRACY',
        'HELLENIC PAC',
        'US-INDIA PAC',
        'FORMOSA PAC',
      ]
        .map(n => foreignInterestFor(n))
        .filter(Boolean)
        .map(f => f.country)
    );
    expect(countries.size).toBeGreaterThanOrEqual(6);
  });

  it('returns null rather than guessing for ordinary organisations', () => {
    expect(foreignInterestFor('ACTBLUE')).toBeNull();
    expect(foreignInterestFor('CLUB FOR GROWTH')).toBeNull();
    expect(foreignInterestFor('NATIONAL ASSOCIATION OF BROADCASTERS PAC')).toBeNull();
    expect(foreignInterestFor('')).toBeNull();
    expect(foreignInterestFor(null)).toBeNull();
  });

  it('every listed country has a flag', () => {
    for (const name of ['AIPAC', 'ARMENIAN NATIONAL COMMITTEE', 'TURKISH COALITION']) {
      expect(foreignInterestFor(name).flag.length).toBeGreaterThan(0);
    }
  });
});

describe('quicklookSectors', () => {
  it('surfaces flag-worthy sectors and FARA, skips platforms', () => {
    const member = {
      topConduits: [
        { name: 'ACTBLUE', amount: 100 },
        { name: 'AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC - CONDUIT', amount: 500 },
      ],
      faraEmployerTotal: 1000,
    };
    const s = quicklookSectors(member);
    expect(s).toContain('pro-israel');
    expect(s).toContain('foreign-agent');
    expect(s).not.toContain('platform');
  });

  it('empty member yields empty quicklook', () => {
    expect(quicklookSectors({})).toEqual([]);
    expect(quicklookSectors(null)).toEqual([]);
  });
});
