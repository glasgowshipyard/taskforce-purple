// Addresses a person can read out (owner, 2026-10-24): /race/2026/house/
// california-50, /member/scott-peters-P000608. Pure, so the site, the
// pre-built pages (scripts/site/) and the tests share them. The ID stays in
// a person's address because names collide (Alaska's two Dan Sullivans);
// the name in front is only for reading, and any name with the right ID
// opens the page. Older addresses still work (router.js matchRoute).
import { stateByCode } from './states.js';

const slug = text =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// "Doe, Jane Q" (the FEC's order) or "Jane Doe" -> "jane-q-doe"
function nameSlug(name) {
  const [last, ...rest] = String(name ?? '').split(',');
  return slug(rest.length ? `${rest.join(' ')} ${last}` : last);
}

const stateSlugs = Object.fromEntries(Object.values(stateByCode).map(s => [slug(s.name), s.code]));

/** /member/scott-h-peters-P000608 (no name: /member/P000608) */
export const memberPath = (id, name) =>
  `/member/${name ? `${nameSlug(name)}-` : ''}${encodeURIComponent(id)}`;

/** /candidate/steve-cohen-H6CA50324 */
export const candidatePath = (id, name) =>
  `/candidate/${name ? `${nameSlug(name)}-` : ''}${encodeURIComponent(id)}`;

/** The ID at the end of a person's address, whatever name is in front */
export const idFromSlug = text => {
  const m = String(text ?? '').match(/([A-Z][0-9]{6}|[HSP][0-9][A-Z0-9]{7})$/i);
  return m ? m[1].toUpperCase() : String(text ?? '');
};

/**
 * A race's address from its key and cycle: "H-CA-50" -> /race/2026/house/
 * california-50; "S-AK" -> /race/2026/senate/alaska; at-large House seats
 * are the state alone; a special election ends in "-special"
 */
export function racePath(key, cycle) {
  const m = String(key).match(/^([HS])-([A-Z]{2})(?:-(\d{2}))?-?(-special)?$/);
  if (!m || !cycle) {
    return `/race/${cycle ? `${cycle}/` : ''}${encodeURIComponent(String(key).replace(/-$/, ''))}`;
  }
  const [, office, state, district, special] = m;
  const place = slug(stateByCode[state]?.name || state);
  const seat = office === 'H' && district && district !== '00' ? `-${Number(district)}` : '';
  return `/race/${cycle}/${office === 'S' ? 'senate' : 'house'}/${place}${seat}${special ? '-special' : ''}`;
}

/** A race's key from an address's office and place ("house", "california-50") */
export function raceKeyFrom(office, place) {
  const m = String(place ?? '').match(/^(.*?)(?:-(\d{1,2}))?(-special)?$/);
  const state = m && stateSlugs[m[1]];
  if (!state || !['house', 'senate'].includes(office)) {
    return null;
  }
  const special = m[3] ? '-special' : '';
  if (office === 'senate') {
    return `S-${state}${special}`;
  }
  return `H-${state}-${m[2] ? m[2].padStart(2, '0') : '00'}${special}`;
}
