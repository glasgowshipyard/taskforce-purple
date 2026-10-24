// The 2026 races (ROADMAP Phase E): helpers for reading the FEC's candidate
// summary file and grouping candidates into races. Pure.

// weball{yy}.txt columns (FEC "All candidates" summary file)
const COL = {
  id: 0,
  name: 1,
  ici: 2,
  party: 4,
  receipts: 5,
  individual: 17,
  state: 18,
  district: 19,
};

/** The FEC's candidate summary file -> Map candidate ID -> candidate. */
export function parseWeball(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const f = line.replace(/\r$/, '').split('|');
    const id = f[COL.id];
    if (!/^[HS]\d/.test(id || '')) {
      continue; // House and Senate only
    }
    const office = id[0];
    out.set(id, {
      candidateId: id,
      office,
      name: f[COL.name] || '',
      ici: f[COL.ici] || null,
      party: f[COL.party] || null,
      receipts: Number(f[COL.receipts]) || 0,
      state: f[COL.state] || '',
      district: office === 'H' ? (f[COL.district] || '00').padStart(2, '0') : '',
    });
  }
  return out;
}

/** "SMITH, JANE Q" -> "Smith, Jane Q" (the FEC files names in capitals). */
export function displayName(name) {
  return String(name)
    .toLowerCase()
    .replace(/(^|[\s,'(-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A race's key, the same in every cycle for the same seat: "S-AK",
 * "H-TX-23", and "-special" for a special election, which can share a cycle
 * with the seat's regular one (2026: Florida's and Ohio's Senate races).
 * The cycle is in the page's address, not the key (src/lib/router.js)
 */
export const raceKey = c =>
  `${c.office}-${c.state}${c.office === 'H' ? `-${c.district}` : ''}${c.special ? '-special' : ''}`;

export function raceLabel(office, district, special = false) {
  const seat =
    office === 'S'
      ? 'Senate'
      : district === '00'
        ? 'House (at-large)'
        : `House district ${Number(district)}`;
  return special ? `${seat}, special election` : seat;
}

/**
 * Group candidates into races: by state, Senate first, then House districts
 * in order; within a race, by money raised.
 */
export function buildRaces(candidates) {
  const byKey = new Map();
  for (const c of candidates) {
    const key = raceKey(c);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        office: c.office,
        state: c.state,
        district: c.office === 'H' ? c.district : '',
        special: Boolean(c.special),
        label: raceLabel(c.office, c.district, c.special),
        candidates: [],
      });
    }
    byKey.get(key).candidates.push(c);
  }
  const races = [...byKey.values()];
  for (const r of races) {
    r.candidates.sort((a, b) => (b.totalRaised || 0) - (a.totalRaised || 0));
  }
  return races.sort(
    (a, b) =>
      a.state.localeCompare(b.state) ||
      (a.office === b.office ? 0 : a.office === 'S' ? -1 : 1) ||
      a.district.localeCompare(b.district)
  );
}
