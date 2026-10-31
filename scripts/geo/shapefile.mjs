// Reading the Census Bureau's district shapefiles, shared by build-geo.mjs
// (the current districts) and build-geo-2026.mjs (the 2026 ones). No
// dependencies: the shapefile is read directly.
import { readFileSync } from 'node:fs';
import { stateByFips } from '../../src/lib/states.js';
import { QUANT } from '../../src/lib/geo.js';

// A Census district code as the members list numbers it: at-large seats and
// non-voting delegates are district 0
export function districtKey(stateFips, cd) {
  const st = stateByFips[stateFips];
  if (!st || cd === 'ZZ') {
    return null;
  }
  const n = cd === '98' ? 0 : Number(cd);
  return `${st.code}-${n}`;
}

// --- dBASE table: the attributes of each shape ---
export function readDbf(path) {
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
export function readShp(path) {
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
export function simplify(ring, tol) {
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
export function encodeRing(ring) {
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
