import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flagFor } from './flags.js';

describe('country flags', () => {
  it('draws the flag from the two-letter code', () => {
    expect(flagFor('Israel')).toBe('🇮🇱');
    expect(flagFor('United Kingdom')).toBe('🇬🇧');
    expect(flagFor('Atlantis')).toBe('');
  });

  it('knows every country the refresh job can name', () => {
    const source = readFileSync('scripts/refresh/lib/country-focus.mjs', 'utf8');
    const names = [
      ...source
        .slice(source.indexOf('const COUNTRIES'), source.indexOf('];'))
        .matchAll(/'([^']+)'/g),
    ].map(m => m[1]);
    expect(names.length).toBeGreaterThan(90);
    expect(names.filter(n => !flagFor(n))).toEqual([]);
  });
});
