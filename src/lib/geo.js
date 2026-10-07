// Finding someone's congressional district, from a ZIP code or from where
// they're standing. Everything runs in the browser against static files built
// by scripts/geo/build-geo.mjs from the Census Bureau's own: a ZIP code or a
// location is never sent anywhere.

// Outline coordinates are whole numbers of 1/QUANT degree (about 11 metres)
export const QUANT = 10000;

// How far around a location we look for a district line: inside this, we say
// "you're near a line" and offer both, rather than guess
const NEAR_METRES = 250;

/** "OH-4" -> { state: 'OH', district: 4 } */
export function parseDistrict(key) {
  const [state, n] = key.split('-');
  return { key, state, district: Number(n) };
}

/**
 * One ZIP code's entry in zip.json: "OH-4", or for a ZIP that crosses a line,
 * "OH-4:81|OH-3:19" (each district's share of the ZIP's land, largest first).
 */
export function parseZipEntry(entry) {
  if (!entry) {
    return [];
  }
  return entry.split('|').map(part => {
    const [key, share] = part.split(':');
    return { ...parseDistrict(key), share: share ? Number(share) : 100 };
  });
}

export function normalizeZip(input) {
  const m = String(input || '')
    .trim()
    .match(/^(\d{5})(?:-?\d{4})?$/);
  return m ? m[1] : null;
}

function decodeRing(flat) {
  const xs = new Float64Array(flat.length / 2);
  const ys = new Float64Array(flat.length / 2);
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    xs[i / 2] = x / QUANT;
    ys[i / 2] = y / QUANT;
  }
  return { xs, ys };
}

/** Decode a state file's districts once, ready for lookups. */
export function prepareState(file) {
  return file.districts.map(d => ({
    key: d.d,
    box: d.b.map(v => v / QUANT),
    rings: d.r.map(decodeRing),
  }));
}

// Even-odd ray casting across every ring: islands count, holes don't
function inRings(rings, lon, lat) {
  let inside = false;
  for (const { xs, ys } of rings) {
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if (
        ys[i] > lat !== ys[j] > lat &&
        lon < ((xs[j] - xs[i]) * (lat - ys[i])) / (ys[j] - ys[i]) + xs[i]
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function districtAt(districts, lon, lat) {
  for (const d of districts) {
    const [x0, y0, x1, y1] = d.box;
    if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1 && inRings(d.rings, lon, lat)) {
      return d.key;
    }
  }
  return null;
}

/** States whose outline box contains the point (usually one, two near a border). */
export function candidateStates(index, lon, lat) {
  const q = index.quant || QUANT;
  return Object.entries(index.states)
    .filter(
      ([, [x0, y0, x1, y1]]) => lon >= x0 / q && lon <= x1 / q && lat >= y0 / q && lat <= y1 / q
    )
    .map(([code]) => code);
}

/**
 * The district at a location, and whether a district line runs close by.
 * `districts` is every prepared district of the candidate states. Returns
 * { key, near: [other keys within NEAR_METRES] } or null if the point is in
 * no district at all (at sea, or abroad).
 */
export function locate(districts, lon, lat) {
  const here = districtAt(districts, lon, lat);
  const dLat = NEAR_METRES / 111320;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const around = new Set();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const key = districtAt(districts, lon + dLon * Math.cos(a), lat + dLat * Math.sin(a));
    if (key && key !== here) {
      around.add(key);
    }
  }
  if (!here && around.size === 0) {
    return null;
  }
  // On a simplified line itself the point can fall between two outlines:
  // then the nearest districts are the answer, and it's a close call
  if (!here) {
    const [first, ...rest] = [...around];
    return { key: first, near: rest };
  }
  return { key: here, near: [...around] };
}
