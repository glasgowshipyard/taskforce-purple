// Who holds each seat (the results page, 2026-11-04: each called seat's
// grade before the election), from the public roster the identity
// crosswalk is built from (unitedstates/congress-legislators). Read at
// site build time; written to /data/seats.json as { raceKey: bioguideId }.
// Senators: only those whose seat is the cycle's regular class ("S-TX"). A
// special election's seat is held by its appointed senator, who runs as the
// incumbent (src/lib/results.js uses the race's own incumbent first).

import { regularClass } from '../refresh/lib/ballot.mjs';
import { raceKey } from '../refresh/lib/races.mjs';

export { LEGISLATORS_URL } from '../refresh/lib/roster.mjs';

/** The seat each current legislator holds, keyed as the races are */
export function seatsFrom(legislators, cycle) {
  const out = {};
  for (const l of legislators || []) {
    const id = l.id?.bioguide;
    const t = l.terms?.[l.terms.length - 1];
    if (!id || !t?.state) {
      continue;
    }
    if (t.type === 'sen' && Number(t.class) !== regularClass(cycle)) {
      continue;
    }
    const key =
      t.type === 'sen'
        ? raceKey({ office: 'S', state: t.state })
        : raceKey({
            office: 'H',
            state: t.state,
            district: String(Number.isFinite(t.district) ? t.district : 0).padStart(2, '0'),
          });
    out[key] = id;
  }
  return out;
}
