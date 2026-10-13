// What FINAL-3 grades from, beyond a member's own figures (owner's decision,
// frozen 2026-10-12): every committee whose money reaches a member - PACs
// that give to the member's campaigns, leadership PACs and own joint funds,
// committees that direct earmarked gifts to them, and the committees that
// fund those (two steps back) - each with its own donor picture, the FEC's
// totals, who it answers to (sponsors.mjs) and, for PEOPLE sponsors, the
// people test. The maths is workers/tier-calculation.js (gradeFinal3).

import { readFileSync } from 'node:fs';
import { countryFocus } from './country-focus.mjs';
import { classifyPac, loadFacts, loadPeopleEvidence, peopleTest, sponsorEin } from './sponsors.mjs';
import { totalsType } from './discovery.mjs';

// Conduits that pass a gift to whichever candidate the donor picks; any
// other conduit directs it
export const PLATFORM = /\b(ACTBLUE|WINRED|DEMOCRACY ENGINE)\b/;
const IDS = /^C\d{8}$/;

const ITCONT = `{'CMTE_ID':'VARCHAR','AMNDT_IND':'VARCHAR','RPT_TP':'VARCHAR','TRANSACTION_PGI':'VARCHAR',
  'IMAGE_NUM':'VARCHAR','TRANSACTION_TP':'VARCHAR','ENTITY_TP':'VARCHAR','NAME':'VARCHAR','CITY':'VARCHAR',
  'STATE':'VARCHAR','ZIP_CODE':'VARCHAR','EMPLOYER':'VARCHAR','OCCUPATION':'VARCHAR','TRANSACTION_DT':'VARCHAR',
  'TRANSACTION_AMT':'VARCHAR','OTHER_ID':'VARCHAR','TRAN_ID':'VARCHAR','FILE_NUM':'VARCHAR','MEMO_CD':'VARCHAR',
  'MEMO_TEXT':'VARCHAR','SUB_ID':'VARCHAR'}`;

/** Committees, named in the bulk file's committee list, that pass gifts on. */
export async function platformIds(db) {
  return new Set(
    (await db.read('SELECT id, name FROM cm'))
      .filter(c => PLATFORM.test(String(c.name || '').toUpperCase()))
      .map(c => c.id)
  );
}

/**
 * Committees named as the conduit of earmarked gifts to these committees
 * (other than the platforms): one pass over the bulk file.
 */
export async function directingCommittees(db, itcontPath, poolIds, platforms) {
  const ids = [...new Set(poolIds)].filter(id => IDS.test(id));
  if (!ids.length) {
    return [];
  }
  const rows = await db.read(`
    WITH ids(id) AS (VALUES ${ids.map(id => `('${id}')`).join(',')})
    SELECT DISTINCT OTHER_ID AS id
    FROM read_csv('${itcontPath}', delim='|', header=false, quote='', escape='', ignore_errors=true,
                  columns=${ITCONT})
    WHERE CMTE_ID IN (SELECT id FROM ids)
      AND (TRANSACTION_TP = '15E' OR regexp_matches(coalesce(MEMO_TEXT, ''), '(?i)earmark'))
      AND regexp_matches(coalesce(OTHER_ID, ''), '^C[0-9]{8}$')`);
  return rows.map(r => r.id).filter(id => !platforms.has(id));
}

/** FEC committee records fetched once (data/committee-records.json). */
export function loadCommitteeRecords() {
  const path = new URL('../data/committee-records.json', import.meta.url).pathname;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(Object.entries(raw).filter(([id]) => IDS.test(id)));
}

const squash = x =>
  String(x || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]/g, '');

/**
 * Every committee in `ids` as FINAL-3 sees it. `profiles` / `upstream`: from
 * pacs.mjs (pacProfiles, upstreamGifts); `fecTotals`: FEC totals already in
 * hand ({ id: totals }, a frozen snapshot's), the rest asked for here, 100 a
 * call; `irsIndex`: sponsors.mjs loadIrsIndex.
 * Returns { [id]: { name, type, designation, orgType, connectedOrg,
 *   connectedCommittees, fecRecord, profile, upstream, fec, sponsor, peopleTest } }.
 */
export async function buildPacs({
  db,
  ids,
  fec,
  cycle,
  profiles,
  upstream,
  irsIndex,
  fecTotals = {},
  log = () => {},
}) {
  const want = [...new Set(ids)].filter(id => IDS.test(id));
  const cmRows = [];
  for (let i = 0; i < want.length; i += 500) {
    const part = want.slice(i, i + 500);
    cmRows.push(
      ...(await db.read(
        `SELECT id, name, type, designation, org_type, connected_org FROM cm WHERE id IN (${part.map(() => '?').join(',')})`,
        ...part
      ))
    );
  }
  // The FEC's own totals (its small/big split), 100 committees a call
  const totals = { ...fecTotals };
  const byType = new Map();
  for (const c of cmRows.filter(r => !totals[r.id])) {
    const t = totalsType(c.type);
    byType.set(t, [...(byType.get(t) || []), c]);
  }
  for (const [type, list] of byType) {
    for (let i = 0; i < list.length; i += 100) {
      const d = await fec(`/totals/${type}/`, {
        committee_id: list.slice(i, i + 100).map(c => c.id),
        cycle,
        per_page: 100,
      });
      for (const t of d.results || []) {
        totals[t.committee_id] = t;
      }
    }
  }
  // A sponsor that is itself a committee: matched on the name as filed
  const byName = new Map();
  for (const c of await db.read('SELECT id, name, type, designation FROM cm')) {
    const k = squash(c.name);
    if (k) {
      byName.set(k, [...(byName.get(k) || []), c]);
    }
  }
  const connectedOf = c => {
    const k = squash(c.connected_org);
    return k && k !== 'NONE' ? (byName.get(k) || []).filter(x => x.id !== c.id).slice(0, 5) : [];
  };
  const facts = loadFacts();
  const { forms, stated, minority } = loadPeopleEvidence();
  const records = loadCommitteeRecords();
  const asPac = c => ({
    name: c.name,
    type: c.type,
    designation: c.designation,
    orgType: c.org_type,
    connectedOrg: c.connected_org,
    connectedCommittees: connectedOf(c),
  });
  // The FEC's committee record, for committees the bulk files don't place:
  // fetched once, kept in data/committee-records.json; asked for only when
  // missing there
  let asked = 0;
  for (const c of cmRows) {
    if (records.has(c.id)) {
      continue;
    }
    const first = classifyPac(c.id, asPac(c), irsIndex, facts);
    if (first.group === 'nosponsor' || first.unsettled) {
      const r = (await fec(`/committee/${c.id}/`, {})).results?.[0];
      asked++;
      if (r) {
        records.set(c.id, {
          leadershipPac: r.leadership_pac === 'X',
          sponsorCandidates: r.sponsor_candidate_ids || [],
          affiliated: r.affiliated_committee_name || null,
        });
      }
    }
  }
  const pacs = {};
  for (const c of cmRows) {
    const t = totals[c.id];
    const p = asPac(c);
    const sponsor = classifyPac(c.id, p, irsIndex, facts, records.get(c.id) || null);
    pacs[c.id] = {
      ...p,
      fecRecord: records.get(c.id) || null,
      profile: profiles.get(c.id) || null,
      upstream: upstream.get(c.id) || [],
      fec: t
        ? {
            receipts: t.receipts,
            individuals: t.individual_contributions,
            itemized: t.individual_itemized_contributions,
            unitemized: t.individual_unitemized_contributions,
            coverageEnd: t.coverage_end_date,
          }
        : null,
      sponsor,
      peopleTest: peopleTest(c.id, sponsor, forms, stated, { minority }),
    };
    // The country label: the sponsor's own Form 990 mission (country-focus.mjs)
    const ein = sponsorEin(pacs[c.id], irsIndex);
    const focus = ein ? countryFocus(forms[ein]?.mission) : null;
    pacs[c.id].country = focus && {
      country: focus.country,
      ein,
      taxYear: forms[ein]?.taxYear ?? null,
      phrase: focus.phrase,
    };
  }
  log(
    `committees: ${cmRows.length} sorted; FEC totals for ${Object.keys(totals).length}; ${asked} committee record(s) asked for`
  );
  return pacs;
}
