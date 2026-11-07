// The PAC tables for download (#67, #70; owner, 2026-11-07). Written by
// every refresh run that grades every member (the filing calendar's
// grade-only runs) into public/data/, and committed by the workflow only
// when they changed: the site serves them, and git keeps a dated record of
// every PAC's classification. Pure: run.mjs writes the files.
//   pacs.csv               every PAC that gave to a member: who it answers
//                          to, why, the people share and what counted
//   pac-sponsor-gaps.csv   PACs whose FEC registration names a sponsor but
//                          leaves its type blank (#70)

import { final3Group } from '../../../workers/tier-calculation.js';
import { PAC_GROUP_NAMES } from '../../../src/lib/pacs.js';
import { FEC_ORG } from './sponsors.mjs';

const cell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (head, rows) =>
  `${head.join(',')}\n${rows.map(r => r.map(cell).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
const dollars = x => Math.round(x * 100) / 100;
const sponsorNamed = s => {
  const t = String(s || '').trim();
  return t && t.toUpperCase() !== 'NONE' ? t : '';
};

/**
 * What each PAC gave to members, from the job's gift lists: `gifts` is an
 * iterable of [memberId, [{ id, amount }]] (the campaign side and the
 * members' own joint funds). Returns Map id -> { given, members: Set }
 */
export function givenToMembers(gifts) {
  const out = new Map();
  for (const [member, list] of gifts) {
    for (const g of list || []) {
      if (!(g.amount > 0)) {
        continue;
      }
      const t = out.get(g.id) || { given: 0, members: new Set() };
      t.given += g.amount;
      t.members.add(member);
      out.set(g.id, t);
    }
  }
  return out;
}

/** Every PAC that gave to a member, most given first */
export function pacsCsv(pacs, shares, given) {
  const head = [
    'committee_id',
    'name',
    'answers_to',
    'people_share_pct',
    'given_to_members',
    'counted_as_people',
    'members_given_to',
    'sponsor_as_filed',
    'sponsor_type_as_filed',
    'why',
    'people_test',
    'country_focus',
    'fec_page',
  ];
  const rows = [...given.entries()]
    .sort((a, b) => b[1].given - a[1].given || a[0].localeCompare(b[0]))
    .map(([id, t]) => {
      const p = pacs[id];
      const group = final3Group(p);
      const share = shares.get(id) ?? null;
      // As each member's grade counts it: only the people group, at its share
      const counted = group === 'people' && share !== null ? t.given * share : 0;
      return [
        id,
        p?.name || '',
        PAC_GROUP_NAMES[group] || group,
        share === null ? '' : Math.round(share * 1000) / 10,
        dollars(t.given),
        dollars(counted),
        t.members.size,
        sponsorNamed(p?.connectedOrg),
        FEC_ORG[p?.orgType] || '',
        p?.sponsor?.reason || '',
        group === 'people' || group === 'board' || group === 'untested'
          ? p?.peopleTest?.evidence || ''
          : '',
        p?.country?.country || '',
        `https://www.fec.gov/data/committee/${id}/`,
      ];
    });
  return csv(head, rows);
}

/**
 * PACs that gave to a member whose FEC registration names a sponsor but
 * leaves the sponsor type (ORG_TP) blank (#70), most given first.
 * Politicians' and parties' committees are left out: a leadership PAC names
 * its politician or their fund, and the FEC asks no sponsor type of it
 */
export function sponsorGapsCsv(pacs, given) {
  const head = ['committee_id', 'name', 'sponsor_as_filed', 'given_to_members', 'fec_page'];
  const rows = [...given.entries()]
    .filter(
      ([id]) =>
        sponsorNamed(pacs[id]?.connectedOrg) &&
        !pacs[id]?.orgType &&
        !['politician', 'party'].includes(final3Group(pacs[id]))
    )
    .sort((a, b) => b[1].given - a[1].given || a[0].localeCompare(b[0]))
    .map(([id, t]) => [
      id,
      pacs[id]?.name || '',
      sponsorNamed(pacs[id]?.connectedOrg),
      dollars(t.given),
      `https://www.fec.gov/data/committee/${id}/`,
    ]);
  return csv(head, rows);
}
