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
import { stateByFips } from '../../src/lib/states.js';
import { QUANT } from '../../src/lib/geo.js';

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

// A Census district code as the members list numbers it: at-large seats and
// non-voting delegates are district 0
function districtKey(stateFips, cd) {
  const st = stateByFips[stateFips];
  if (!st || cd === 'ZZ') {
    return null;
  }
  const n = cd === '98' ? 0 : Number(cd);
  return `${st.code}-${n}`;
}

// --- dBASE table: the attributes of each shape ---
function readDbf(path) {
  const b = readFileSync(path);
  const count = b.readUInt32LE(4);
  const headerLen = b.readUInt16LE(8);
  const recordLen = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    fields.push({
      name: b.toString('latin1', o, o + 11).replace(/\0.*$/, ''),
      len: b[o + 16],
    });
  }
  const rows = [];
  for (let i = 0; i < count; i++) {
    let o = headerLen + i * recordLen + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = b.toString('latin1', o, o + f.len).trim();
      o += f.len;
    }
    rows.push(row);
  }
  return rows;
}

// --- Shapefile polygons: each shape is a list of rings of [x, y] ---
function readShp(path) {
  const b = readFileSync(path);
  const shapes = [];
  let o = 100;
  while (o < b.length) {
    const contentLen = b.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = b.readInt32LE(c);
    const rings = [];
    if (type === 5) {
      const numParts = b.readInt32LE(c + 36);
      const numPoints = b.readInt32LE(c + 40);
      const parts = [];
      for (let p = 0; p < numParts; p++) {
        parts.push(b.readInt32LE(c + 44 + p * 4));
      }
      const pts = c + 44 + numParts * 4;
      for (let p = 0; p < numParts; p++) {
        const end = p + 1 < numParts ? parts[p + 1] : numPoints;
        const ring = [];
        for (let k = parts[p]; k < end; k++) {
          ring.push([b.readDoubleLE(pts + k * 16), b.readDoubleLE(pts + k * 16 + 8)]);
        }
        rings.push(ring);
      }
    }
    shapes.push(rings);
    o = c + contentLen;
  }
  return shapes;
}

// Douglas-Peucker, iterative so long coastlines don't overflow the stack
function simplify(ring, tol) {
  if (ring.length < 5) {
    return ring;
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, z] = stack.pop();
    const [ax, ay] = ring[a];
    const [zx, zy] = ring[z];
    const dx = zx - ax;
    const dy = zy - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < z; i++) {
      const [px, py] = ring[i];
      let d;
      if (len2 === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, z]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

// A ring as whole numbers of 1/QUANT degree, each point stored as the step
// from the one before: [x0, y0, dx1, dy1, ...]
function encodeRing(ring) {
  const flat = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of ring) {
    const qx = Math.round(x * QUANT);
    const qy = Math.round(y * QUANT);
    if (flat.length && qx === px && qy === py) {
      continue;
    }
    flat.push(qx - px, qy - py);
    px = qx;
    py = qy;
  }
  return flat;
}

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
  .replace(/^﻿/, '')
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
