import { describe, expect, it } from 'vitest';
import { detectForeignInterest } from './foreign-interest.js';

describe('detectForeignInterest', () => {
  it('reads the country out of the committee’s own filed name', () => {
    expect(detectForeignInterest('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC').country).toBe(
      'Israel'
    );
    expect(detectForeignInterest('ARMENIAN NATIONAL COMMITTEE OF AMERICA').country).toBe('Armenia');
    expect(detectForeignInterest('TURKISH COALITION USA PAC').country).toBe('Turkey');
    expect(detectForeignInterest('HELLENIC AMERICAN LEADERSHIP PAC').country).toBe('Greece');
    expect(detectForeignInterest('US-CUBA DEMOCRACY PAC').country).toBe('Cuba');
    expect(detectForeignInterest('IRANIAN AMERICAN POLITICAL ACTION COMMITTEE').country).toBe(
      'Iran'
    );
  });

  it('states its basis so the label is never our opinion', () => {
    const r = detectForeignInterest('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC');
    expect(r.basis).toContain('FEC-filed name');
    expect(detectForeignInterest('NORPAC').basis).toBeTruthy();
  });

  // The error this module exists to prevent. Found in live data: substring
  // matching labelled a tribal nation as a foreign interest.
  it('never labels a tribal nation as a foreign interest', () => {
    const tribal = [
      'AGUA CALIENTE BAND OF CAHUILLA INDIANS',
      'BARONA BAND OF MISSION INDIANS',
      'ONEIDA INDIAN NATION',
      'CHEROKEE NATION',
      'EASTERN BAND OF CHEROKEE INDIANS',
      'FEDERATED INDIANS OF GRATON RANCHERIA',
      'JAMESTOWN SKLALLAM TRIBE',
      'MUSCOGEE CREEK NATION',
      'SUQUAMISH INDIAN TRIBE',
      'FOREST COUNTY POTAWATOMI COMMUNITY',
    ];
    for (const name of tribal) {
      expect(detectForeignInterest(name), `${name} must not be given a country`).toBeNull();
    }
  });

  it('does not match a demonym inside a longer word', () => {
    // \bINDIA\b must not fire on "INDIAN"
    expect(detectForeignInterest('SOME INDIAN GAMING ASSOCIATION')).toBeNull();
  });

  it('leaves ordinary organisations unlabelled rather than guessing', () => {
    expect(detectForeignInterest('ACTBLUE')).toBeNull();
    expect(detectForeignInterest('WINRED - CONDUIT')).toBeNull();
    expect(detectForeignInterest('CLUB FOR GROWTH PAC')).toBeNull();
    expect(detectForeignInterest('HOUSE FREEDOM FUND')).toBeNull();
    expect(detectForeignInterest('')).toBeNull();
    expect(detectForeignInterest(null)).toBeNull();
  });

  it('applies to many countries, not one', () => {
    const countries = new Set(
      [
        'AIPAC',
        'ARMENIAN ASSEMBLY',
        'TURKISH AMERICAN PAC',
        'US-CUBA DEMOCRACY PAC',
        'HELLENIC PAC',
        'US-INDIA POLITICAL ACTION COMMITTEE',
        'TAIWAN CAUCUS PAC',
        'UKRAINIAN AMERICAN PAC',
        'KOREAN AMERICAN PAC',
      ]
        .map(detectForeignInterest)
        .filter(Boolean)
        .map(r => r.country)
    );
    expect(countries.size).toBeGreaterThanOrEqual(8);
  });

  it('every country it can return has a flag', () => {
    for (const name of ['AIPAC', 'TURKISH PAC', 'KOREAN AMERICAN PAC', 'SAUDI FOUNDATION']) {
      const r = detectForeignInterest(name);
      if (r) {
        expect(r.flag, `flag missing for ${r.country}`).toBeTruthy();
      }
    }
  });
});
