import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flagSrc } from './flags.js';

describe('country flags', () => {
  it('finds the picture from the two-letter code', () => {
    expect(flagSrc('Israel')).toBe('/flags/il.png');
    expect(flagSrc('United Kingdom')).toBe('/flags/gb.png');
    expect(flagSrc('Atlantis')).toBe('');
  });

  it('has a picture for every country the refresh job can name', () => {
    const source = readFileSync('scripts/refresh/lib/country-focus.mjs', 'utf8');
    const names = [
      ...source
        .slice(source.indexOf('const COUNTRIES'), source.indexOf('];'))
        .matchAll(/'([^']+)'/g),
    ].map(m => m[1]);
    expect(names.length).toBeGreaterThan(90);
    expect(names.filter(n => !flagSrc(n) || !existsSync(`public${flagSrc(n)}`))).toEqual([]);
  });
});
