// The lookup against the real built files (public/geo, from the Census
// Bureau's): known places must land in their districts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { candidateStates, locate, normalizeZip, parseZipEntry, prepareState } from './geo.js';

const geo = name => JSON.parse(readFileSync(new URL(`../../public/geo/${name}`, import.meta.url)));
const index = geo('index.json');
const zips = geo('zip.json');

function at(lon, lat) {
  const states = candidateStates(index, lon, lat);
  const districts = states.flatMap(code => prepareState(geo(`cd/${code}.json`)));
  return locate(districts, lon, lat);
}

describe('ZIP codes', () => {
  it('accepts the ways people type them', () => {
    expect(normalizeZip('43215')).toBe('43215');
    expect(normalizeZip(' 43215-1234 ')).toBe('43215');
    expect(normalizeZip('432151234')).toBe('43215');
    expect(normalizeZip('4321')).toBeNull();
    expect(normalizeZip('abcde')).toBeNull();
  });

  it('a ZIP in one district', () => {
    expect(parseZipEntry(zips['10001'])).toEqual([
      { key: 'NY-12', state: 'NY', district: 12, share: 100 },
    ]);
  });

  it('a ZIP across a line lists each district, largest share first', () => {
    const parts = parseZipEntry(zips['90210']);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.state === 'CA')).toBe(true);
    expect(parts[0].share).toBeGreaterThanOrEqual(parts[1].share);
  });

  it('at-large states, DC and territories are district 0', () => {
    expect(zips['99501']).toBe('AK-0');
    expect(zips['20001']).toBe('DC-0');
    expect(zips['00901']).toBe('PR-0');
  });

  it('a ZIP that is not a Census ZIP area is simply missing', () => {
    expect(parseZipEntry(zips['20500'])).toEqual([]);
  });
});

describe('locations', () => {
  it('finds the district a point is in', () => {
    // Times Square
    expect(at(-73.9855, 40.758).key).toBe('NY-12');
    // Anchorage: one seat for the whole state
    expect(at(-149.9, 61.218).key).toBe('AK-0');
    // The US Capitol
    expect(at(-77.0091, 38.8899).key).toBe('DC-0');
  });

  it('flags a point right by a line instead of guessing', () => {
    // On the line between two Columbus, Ohio districts
    const r = at(-83.0045, 39.9535);
    expect(new Set([r.key, ...r.near])).toEqual(new Set(['OH-3', 'OH-15']));
  });

  it('a point at sea is in no district', () => {
    expect(at(-40, 30)).toBeNull();
  });
});
