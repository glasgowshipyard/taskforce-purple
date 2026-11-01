#!/usr/bin/env node
/**
 * Build the files the site uses to find someone's representatives, from the
 * Census Bureau's own files for the current (119th) Congress:
 *
 *   public/geo/zip.json        ZIP code -> district(s), with each district's
 *                              share of the ZIP's land where it crosses a line
 *   public/geo/index.json      each state's bounding box
 *   public/geo/cd/{ST}.json    each state's district outlines, for "use my
 *                              location" (looked up in the browser: the
 *                              location never leaves the visitor's device)
 *
 * Inputs (download into an empty folder, unzip the shapefile into cd/):
 *   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_500k.zip
 *   https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt
 *
 *   node scripts/geo/build-geo.mjs <that folder>
 *
 * Re-run only when district lines change (a new Congress, or a court-ordered
 * map). No dependencies: the shapefile is read directly.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUANT } from '../../src/lib/geo.js';
import { districtKey, encodeRing, readDbf, readShp, simplify } from './shapefile.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/geo/build-geo.mjs <census folder>');
  process.exit(1);
}
const out = new URL('../../public/geo/', import.meta.url).pathname;
// Outlines are simplified to within about 15 metres of the Census line;
// lookups near a line are flagged in the browser anyway (see src/lib/geo.js)
const TOLERANCE = 0.00015;
// Alaska is one district, and nearly all of its outline is coastline: a
// coarser outline costs nothing there and saves most of the file
const TOLERANCE_BY_STATE = { AK: 0.003 };
// A ZIP's slice of a district smaller than this share of its land is a
// boundary artefact, not somewhere people live
const SLIVER = 0.02;

const cdDir = join(dir, 'cd');
const base = readdirSync(cdDir)
  .find(f => f.endsWith('.shp'))
  .replace(/\.shp$/, '');
const rows = readDbf(join(cdDir, `${base}.dbf`));
const shapes = readShp(join(cdDir, `${base}.shp`));
if (rows.length !== shapes.length) {
  throw new Error(`${rows.length} attribute rows but ${shapes.length} shapes`);
}
const cdField = Object.keys(rows[0]).find(k => /^CD\d+FP$/.test(k));

const byState = new Map();
let pointsIn = 0;
let pointsOut = 0;
rows.forEach((row, i) => {
  const key = districtKey(row.STATEFP, row[cdField]);
  if (!key) {
    return;
  }
  const code = key.split('-')[0];
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  const rings = [];
  for (const ring of shapes[i]) {
    pointsIn += ring.length;
    const s = simplify(ring, TOLERANCE_BY_STATE[code] ?? TOLERANCE);
    if (s.length < 4) {
      continue;
    }
    pointsOut += s.length;
    for (const [x, y] of s) {
      minx = Math.min(minx, x);
      miny = Math.min(miny, y);
      maxx = Math.max(maxx, x);
      maxy = Math.max(maxy, y);
    }
    rings.push(encodeRing(s));
  }
  if (!byState.has(code)) {
    byState.set(code, []);
  }
  byState.get(code).push({
    d: key,
    b: [minx, miny, maxx, maxy].map(v => Math.round(v * QUANT)),
    r: rings,
  });
});

mkdirSync(join(out, 'cd'), { recursive: true });
const index = {};
let bytes = 0;
for (const [code, districts] of [...byState].sort()) {
  districts.sort((a, b) => Number(a.d.split('-')[1]) - Number(b.d.split('-')[1]));
  const box = districts.reduce(
    (m, d) => [
      Math.min(m[0], d.b[0]),
      Math.min(m[1], d.b[1]),
      Math.max(m[2], d.b[2]),
      Math.max(m[3], d.b[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
  index[code] = box;
  const json = JSON.stringify({ state: code, districts });
  bytes += json.length;
  writeFileSync(join(out, 'cd', `${code}.json`), json);
}
writeFileSync(
  join(out, 'index.json'),
  JSON.stringify({ source: base, quant: QUANT, states: index })
);
console.log(
  `outlines: ${byState.size} states, ${pointsIn} points simplified to ${pointsOut}, ${(bytes / 1e6).toFixed(1)} MB`
);

// --- ZIP codes (Census ZCTAs) and the districts they fall in ---
const rel = readFileSync(
  join(
    dir,
    readdirSync(dir).find(f => /^tab20_cd\d+_zcta520_natl\.txt$/.test(f))
  ),
  'utf8'
)
  .replace(/^\uFEFF/, '')
  .trim()
  .split('\n');
const head = rel[0].split('|');
const col = name => head.findIndex(h => h.startsWith(name));
const iCd = col('GEOID_CD');
const iZip = col('GEOID_ZCTA5');
const iLand = col('AREALAND_PART');
const iWater = col('AREAWATER_PART');
const parts = new Map();
for (const line of rel.slice(1)) {
  const f = line.split('|');
  const zip = f[iZip];
  const key = zip && districtKey(f[iCd].slice(0, 2), f[iCd].slice(2));
  if (!key) {
    continue;
  }
  if (!parts.has(zip)) {
    parts.set(zip, []);
  }
  parts.get(zip).push({ key, land: Number(f[iLand]) || 0, water: Number(f[iWater]) || 0 });
}
const zips = {};
let split = 0;
for (const [zip, ps] of [...parts].sort()) {
  const land = ps.reduce((s, p) => s + p.land, 0);
  const area = p => (land > 0 ? p.land : p.water);
  const total = ps.reduce((s, p) => s + area(p), 0) || 1;
  const kept = ps
    .map(p => ({ key: p.key, share: area(p) / total }))
    .filter(p => p.share >= SLIVER)
    .sort((a, b) => b.share - a.share);
  if (kept.length === 1) {
    zips[zip] = kept[0].key;
  } else if (kept.length > 1) {
    split++;
    zips[zip] = kept.map(p => `${p.key}:${Math.round(p.share * 100)}`).join('|');
  }
}
writeFileSync(join(out, 'zip.json'), JSON.stringify(zips));
console.log(`ZIP codes: ${Object.keys(zips).length}, ${split} cross a district line`);
