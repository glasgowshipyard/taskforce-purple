// Every PAC gift to a member, and each PAC's own donors (#57). From the FEC's
// bulk files: the PACs report their gifts to candidates and their committees
// (oth, 24K and in-kind 24Z); the committee master gives each PAC's type,
// designation, organisation type and sponsor; the PAC summary (webk) and the
// itemized file (indiv) say where each PAC's own money came from.
//
// What the grade uses (version A, owner 2026-10-09): the full list of
// gifts, so the PAC weighting (tier-calculation.js
// calculateTransparencyPenalty) sees all of a member's PAC money instead of
// the old pipeline's top 20 to the campaign alone; and each PAC's own donor
// picture, so the money a PAC passes on from people counts in part as
// people money (tier-calculation.js tracePacs, pacPeopleCredit).

import { pacType } from '../../../src/lib/pacs.js';
import { PAC_TRACING, pacPeopleCredit } from '../../../workers/tier-calculation.js';
import { ITEMIZED_TYPES } from './reconcile.mjs';

const IDS = /^C\d{8}$/;
const PARTY_TYPES = new Set(['X', 'Y', 'Z']);
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const cents = x => Math.round(num(x) * 100) / 100;

/**
 * PAC gifts to the given committees (a member's campaigns and leadership
 * PAC), one row per giving committee, largest first. Party committees are
 * left out (party money is counted on its own) and so are the member's own
 * committees giving to each other.
 */
export async function pacGifts(db, recipientIds) {
  const ids = recipientIds.filter(id => IDS.test(id));
  if (!ids.length) {
    return [];
  }
  const marks = ids.map(() => '?').join(',');
  const rows = await db.read(
    `SELECT o.committee_id AS id, sum(o.amount) AS amount, count(*)::INTEGER AS gifts,
        any_value(c.name) AS name, any_value(c.type) AS type, any_value(c.designation) AS designation,
        any_value(c.org_type) AS org_type, any_value(c.connected_org) AS connected_org
     FROM oth o LEFT JOIN cm c ON c.id = o.committee_id
     WHERE o.tx_type IN ('24K', '24Z') AND o.other_id IN (${marks}) AND o.committee_id NOT IN (${marks})
     GROUP BY o.committee_id`,
    ...ids,
    ...ids
  );
  return rows
    .filter(r => !PARTY_TYPES.has(r.type) && num(r.amount) > 0)
    .map(r => ({
      id: r.id,
      name: r.name || r.id,
      committeeType: r.type || null,
      designation: r.designation || null,
      orgType: r.org_type || null,
      connectedOrg: r.connected_org || null,
      kind: pacType(r.type, r.designation),
      amount: cents(r.amount),
      gifts: r.gifts,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/** Gifts in the shape the grade reads (tier-calculation.js). */
export function asPacContributions(gifts) {
  return gifts.map(g => ({
    pacName: g.name,
    amount: g.amount,
    contributorId: g.id,
    committee_type: g.committeeType,
    designation: g.designation,
  }));
}

/**
 * Each PAC's own money: total receipts and how much came from individuals
 * (webk), and its named donors (indiv): how many, and how few gave half its
 * itemized money. One pass over the itemized file for all PACs at once.
 * Returns Map id -> { receipts, individuals, fromAffiliates, otherCommittees,
 * itemized, donors, nakamoto }.
 */
export async function pacProfiles(db, itcontPath, pacIds) {
  const ids = [...new Set(pacIds)].filter(id => IDS.test(id));
  const out = new Map();
  if (!ids.length) {
    return out;
  }
  const totals = await db.read(
    `SELECT id, receipts, individuals, from_affiliates, other_committees FROM webk
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids
  );
  for (const t of totals) {
    out.set(t.id, {
      receipts: cents(t.receipts),
      individuals: cents(t.individuals),
      fromAffiliates: cents(t.from_affiliates),
      otherCommittees: cents(t.other_committees),
      itemized: 0,
      donors: 0,
      nakamoto: null,
    });
  }
  const list = ids.map(id => `('${id}')`).join(',');
  const types = [...ITEMIZED_TYPES].map(t => `'${t}'`).join(',');
  const donors = await db.read(`
    WITH ids(id) AS (VALUES ${list}),
    rows AS (
      SELECT CMTE_ID AS id,
        upper(trim(split_part(NAME, ',', 2))) || '|' || upper(trim(split_part(NAME, ',', 1)))
          || '|' || upper(trim(coalesce(STATE, ''))) || '|' || substr(coalesce(ZIP_CODE, ''), 1, 5) AS donor,
        sum(TRY_CAST(TRANSACTION_AMT AS DOUBLE)) AS total
      FROM read_csv('${itcontPath}', delim='|', header=false, quote='', escape='', ignore_errors=true,
        columns={'CMTE_ID':'VARCHAR','AMNDT_IND':'VARCHAR','RPT_TP':'VARCHAR','TRANSACTION_PGI':'VARCHAR',
          'IMAGE_NUM':'VARCHAR','TRANSACTION_TP':'VARCHAR','ENTITY_TP':'VARCHAR','NAME':'VARCHAR','CITY':'VARCHAR',
          'STATE':'VARCHAR','ZIP_CODE':'VARCHAR','EMPLOYER':'VARCHAR','OCCUPATION':'VARCHAR','TRANSACTION_DT':'VARCHAR',
          'TRANSACTION_AMT':'VARCHAR','OTHER_ID':'VARCHAR','TRAN_ID':'VARCHAR','FILE_NUM':'VARCHAR','MEMO_CD':'VARCHAR',
          'MEMO_TEXT':'VARCHAR','SUB_ID':'VARCHAR'})
      WHERE CMTE_ID IN (SELECT id FROM ids) AND TRANSACTION_TP IN (${types}) AND coalesce(MEMO_CD, '') <> 'X'
      GROUP BY 1, 2
      HAVING sum(TRY_CAST(TRANSACTION_AMT AS DOUBLE)) > 0
    ),
    ranked AS (
      SELECT id, total,
        sum(total) OVER (PARTITION BY id ORDER BY total DESC, donor ROWS UNBOUNDED PRECEDING) AS cum,
        sum(total) OVER (PARTITION BY id) AS all_total
      FROM rows
    )
    SELECT id, count(*)::INTEGER AS donors, max(all_total) AS itemized,
      count(*) FILTER (WHERE cum - total < all_total * 0.5)::INTEGER AS nakamoto
    FROM ranked GROUP BY id`);
  for (const d of donors) {
    const p = out.get(d.id) || {
      receipts: null,
      individuals: null,
      fromAffiliates: null,
      otherCommittees: null,
    };
    out.set(d.id, { ...p, itemized: cents(d.itemized), donors: d.donors, nakamoto: d.nakamoto });
  }
  return out;
}

/**
 * The member's PAC money for the page: totals by kind, how much of it counts
 * as people money (`counted`, dollars, as the grade counts it), and the
 * largest PACs with each one's own donor picture and the share of its money
 * traced to people (`peopleShare`, 0-1, null when the FEC has no summary).
 * `traced`: tier-calculation.js tracePacs().
 */
export function pacSummary(gifts, profiles, traced = new Map(), limit = 30) {
  const byKind = {};
  for (const g of gifts) {
    byKind[g.kind] = cents((byKind[g.kind] || 0) + g.amount);
  }
  const depth = PAC_TRACING.depth;
  return {
    total: cents(gifts.reduce((t, g) => t + g.amount, 0)),
    count: gifts.length,
    byKind,
    counted: pacPeopleCredit(gifts, traced),
    list: gifts.slice(0, limit).map(g => ({
      ...g,
      profile: profiles.get(g.id) || null,
      peopleShare: traced.has(g.id)
        ? Math.round(traced.get(g.id)[depth].share * 1000) / 1000
        : null,
    })),
  };
}

/**
 * Committees that gave to each PAC (the PACs' upstream money), from the
 * giving committees' own reports: Map PAC id -> [{ id, amount }]. For
 * tracing a PAC's money one level further (#57, depth 2).
 */
export async function upstreamGifts(db, pacIds) {
  const ids = [...new Set(pacIds)].filter(id => IDS.test(id));
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) {
    return out;
  }
  const list = ids.map(id => `('${id}')`).join(',');
  const rows = await db.read(`
    WITH ids(id) AS (VALUES ${list})
    SELECT o.other_id AS pac, o.committee_id AS id, sum(o.amount) AS amount
    FROM oth o JOIN ids ON ids.id = o.other_id
    WHERE o.tx_type IN ('24K', '24G', '24Z') AND o.committee_id <> o.other_id
    GROUP BY 1, 2 HAVING sum(o.amount) > 0`);
  for (const r of rows) {
    out.get(r.pac).push({ id: r.id, amount: cents(r.amount) });
  }
  return out;
}
