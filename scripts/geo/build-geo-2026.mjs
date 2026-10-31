#!/usr/bin/env node
/**
 * The district lookup for the 2026 races in the states whose lines changed
 * for this election (src/lib/redistricting.js), from the Census Bureau's
 * own files for the 120th Congress (owner, 2026-10-31: the ballot lookup
 * sent a San Diego ZIP code to the old district's race):
 *
 *   public/geo/2026/zip.json      ZIP code -> 2026 district(s), shares of land
 *   public/geo/2026/cd/{ST}.json  each state's 2026 district outlines
 *
 * The Census Bureau publishes the new districts (TIGER 2026, cd120) but no
 * ZIP code relationship file for them yet, so it's made the way the Bureau
 * makes its own: every census block lies wholly in one district and one ZIP
 * code area, so each block is placed in its district by its internal point,
 * and the blocks' land is added up by ZIP code.
 *
 * Inputs, into one folder (for each state's FIPS code ST):
 *   cd/tl_2026_ST_cd120.zip         TIGER2026/CD/
 *   blocks/tl_2026_ST_tabblock20.zip TIGER2026/TABBLOCK20/
 *   tab20_zcta520_tabblock20_natl.txt  rel2020/zcta520/
 * at https://www2.census.gov/geo/tiger/ and .../geo/docs/maps-data/data/
 *
 *   node scripts/geo/build-geo-2026.mjs <that folder>
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { QUANT } from '../../src/lib/geo.js';
import { REDRAWN_2026 } from '../../src/lib/redistricting.js';
import { stateByCode } from '../../src/lib/states.js';
import { districtKey, encodeRing, readDbf, readShp, simplify } from './shapefile.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/geo/build-geo-2026.mjs <census folder>');
  process.exit(1);
}
const out = new URL('../../public/geo/2026/', import.meta.url).pathname;
const TOLERANCE = 0.00015; // as build-geo.mjs
const SLIVER = 0.02; // as build-geo.mjs

// A zip archive's shapefile, unpacked to a scratch folder: { rows, shapes }
function unpack(zip) {
  const tmp = mkdtempSync(join(tmpdir(), 'geo2026-'));
  execFileSync('unzip', ['-q', '-o', zip, '-d', tmp]);
  const base = readdirSync(tmp)
    .find(f => f.endsWith('.shp'))
    .replace(/\.shp$/, '');
  return { tmp, base };
}

// Point in polygon, even-odd over all rings (so holes count). Each
// district's edges are kept in horizontal bands, so a point is tested only
// against the edges crossing its own band: millions of blocks against
// full-detail outlines otherwise take hours
const BANDS = 4096;
function bandIndex(rings, box) {
  const [, y0, , y1] = box;
  const h = (y1 - y0) / BANDS || 1;
  const bands = Array.from({ length: BANDS }, () => []);
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const lo = Math.max(0, Math.floor((Math.min(yi, yj) - y0) / h));
      const hi = Math.min(BANDS - 1, Math.floor((Math.max(yi, yj) - y0) / h));
      for (let b = lo; b <= hi; b++) {
        bands[b].push(xi, yi, xj, yj);
      }
    }
  }
  return { y0, h, bands };
}
function inside(index, x, y) {
  const b = Math.min(BANDS - 1, Math.max(0, Math.floor((y - index.y0) / index.h)));
  const e = index.bands[b];
  let hit = false;
  for (let k = 0; k < e.length; k += 4) {
    const xi = e[k];
    const yi = e[k + 1];
    const xj = e[k + 2];
    const yj = e[k + 3];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

const blockDistrict = new Map(); // block GEOID -> "CA-51"
const fipsOf = {};
mkdirSync(join(out, 'cd'), { recursive: true });
for (const code of Object.keys(REDRAWN_2026)) {
  const fips = stateByCode[code].fips;
  fipsOf[code] = fips;
  // 1. The 2026 districts: full outlines for placing blocks, simplified for the site
  const cd = unpack(join(dir, 'cd', `tl_2026_${fips}_cd120.zip`));
  const rows = readDbf(join(cd.tmp, `${cd.base}.dbf`));
  const shapes = readShp(join(cd.tmp, `${cd.base}.shp`));
  const cdField = Object.keys(rows[0]).find(k => /^CD\d+FP$/.test(k));
  const districts = [];
  rows.forEach((row, i) => {
    const key = districtKey(row.STATEFP, row[cdField]);
    if (!key) {
      return;
    }
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of shapes[i]) {
      for (const [x, y] of ring) {
        box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      }
    }
    districts.push({ key, rings: shapes[i], box, index: bandIndex(shapes[i], box) });
  });
  const expected = REDRAWN_2026[code].districts;
  if (districts.length !== expected) {
    throw new Error(`${code}: ${districts.length} districts in ${cd.base}, expected ${expected}`);
  }
  const file = districts
    .map(d => {
      const rings = d.rings.map(r => simplify(r, TOLERANCE)).filter(r => r.length >= 4);
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const r of rings) {
        for (const [x, y] of r) {
          b[0] = Math.min(b[0], x);
          b[1] = Math.min(b[1], y);
          b[2] = Math.max(b[2], x);
          b[3] = Math.max(b[3], y);
        }
      }
      return { d: d.key, b: b.map(v => Math.round(v * QUANT)), r: rings.map(encodeRing) };
    })
    .sort((a, b) => Number(a.d.split('-')[1]) - Number(b.d.split('-')[1]));
  writeFileSync(
    join(out, 'cd', `${code}.json`),
    JSON.stringify({ state: code, source: cd.base, districts: file })
  );

  // 2. Each block into its district, by its internal point
  const bl = unpack(join(dir, 'blocks', `tl_2026_${fips}_tabblock20.zip`));
  const blocks = readDbf(join(bl.tmp, `${bl.base}.dbf`));
  let unplaced = 0;
  for (const b of blocks) {
    const x = Number(b.INTPTLON20);
    const y = Number(b.INTPTLAT20);
    const d = districts.find(
      c => x >= c.box[0] && x <= c.box[2] && y >= c.box[1] && y <= c.box[3] && inside(c.index, x, y)
    );
    if (d) {
      blockDistrict.set(b.GEOID20, d.key);
    } else {
      unplaced++;
    }
  }
  console.log(
    `${code}: ${districts.length} districts, ${blocks.length} blocks, ${unplaced} not inside any (water)`
  );
}

// 3. ZIP codes: the blocks' land (water where a ZIP has no land), by district
const fipsSet = new Set(Object.values(fipsOf));
const rel = readdirSync(dir).find(f => /^tab20_zcta520_tabblock20_natl\.txt$/.test(f));
const lines = createInterface({ input: createReadStream(join(dir, rel)) });
let head = null;
const parts = new Map(); // zip -> Map(district -> { land, water })
for await (const raw of lines) {
  const line = raw.replace(/^\uFEFF/, '');
  if (!head) {
    head = line.split('|');
    continue;
  }
  const f = line.split('|');
  const block = f[head.indexOf('GEOID_TABBLOCK_20')];
  if (!fipsSet.has(block.slice(0, 2))) {
    continue;
  }
  const zip = f[head.indexOf('GEOID_ZCTA5_20')];
  const key = blockDistrict.get(block);
  if (!zip || !key) {
    continue;
  }
  const byDistrict = parts.get(zip) || new Map();
  const p = byDistrict.get(key) || { land: 0, water: 0 };
  p.land += Number(f[head.indexOf('AREALAND_PART')]) || 0;
  p.water += Number(f[head.indexOf('AREAWATER_PART')]) || 0;
  byDistrict.set(key, p);
  parts.set(zip, byDistrict);
}
const zips = {};
let split = 0;
for (const [zip, byDistrict] of [...parts].sort()) {
  const ps = [...byDistrict].map(([key, p]) => ({ key, ...p }));
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
console.log(`ZIP codes: ${Object.keys(zips).length}, ${split} cross a 2026 district line`);
