import { describe, expect, it } from 'vitest';
import { countryFocus } from './country-focus.mjs';

describe('the country label', () => {
  it('reads a mission that exists for a country', () => {
    expect(
      countryFocus(
        'AIPAC IS AN AMERICAN GRASSROOTS ORGANIZATION THAT WORKS TO STRENGTHEN THE U.S.-ISRAEL PARTNERSHIP.'
      )?.country
    ).toBe('Israel');
    expect(
      countryFocus(
        'TO ORGANIZE PRO-ISRAEL, PRO-PEACE AMERICANS TO HELP SECURE THE STATE OF ISRAEL AS A HOMELAND.'
      )?.country
    ).toBe('Israel');
    expect(
      countryFocus('To strengthen relations between the United States and Armenia.')?.country
    ).toBe('Armenia');
    expect(countryFocus("To advance Taiwan's security and its ties to America.")?.country).toBe(
      'Taiwan'
    );
  });

  it('ignores a place named only as where an organization works', () => {
    expect(
      countryFocus(
        'THE LABOR ORGANIZATION FOR WORKERS THROUGHOUT THE UNITED STATES OF AMERICA AND CANADA.'
      )
    ).toBeNull();
    expect(countryFocus('NATIONAL ADVOCATE FOR ALL SEGMENTS OF THE TURKEY INDUSTRY.')).toBeNull();
    expect(
      countryFocus('TO SERVE THE CATTLE FEEDING INDUSTRY IN TEXAS, OKLAHOMA AND NEW MEXICO.')
    ).toBeNull();
    expect(
      countryFocus('TO FOSTER TIES BETWEEN THE AMERICAN JEWISH COMMUNITY AND DECISION MAKERS.')
    ).toBeNull();
    expect(countryFocus(null)).toBeNull();
  });
});
