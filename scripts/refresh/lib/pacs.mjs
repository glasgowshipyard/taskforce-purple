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
import { COMMITTEE_SINCE } from '../../../workers/fec-crosswalk-additions.js';
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
export async function pacGifts(db, recipientIds, alsoNotFrom = []) {
  const ids = recipientIds.filter(id => IDS.test(id));
  if (!ids.length) {
    return [];
  }
  // Givers left out: the recipients themselves, and any other committees of
  // the member's (`alsoNotFrom`)
  const notFrom = [...new Set([...ids, ...alsoNotFrom.filter(id => IDS.test(id))])];
  const marks = ids.map(() => '?').join(',');
  const notMarks = notFrom.map(() => '?').join(',');
  const rows = await db.read(
    `SELECT o.committee_id AS id, sum(o.amount) AS amount, count(*)::INTEGER AS gifts,
        any_value(c.name) AS name, any_value(c.type) AS type, any_value(c.designation) AS designation,
        any_value(c.org_type) AS org_type, any_value(c.connected_org) AS connected_org
     FROM oth o LEFT JOIN cm c ON c.id = o.committee_id
     WHERE o.tx_type IN ('24K', '24Z') AND o.other_id IN (${marks}) AND o.committee_id NOT IN (${notMarks})
       ${sinceClause('o.other_id', 'o.date')}
     GROUP BY o.committee_id`,
    ...ids,
    ...notFrom
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

/**
 * A member's PAC gifts as their own committees reported them (raw-filings.mjs
 * campaignPacGifts: `side`), one row per giving committee, largest first, in
 * pacGifts' shape. Party committees and the member's own committees giving
 * to each other are left out, as in pacGifts. A committee whose gifts
 * couldn't all be read keeps the PACs' own reports (pacGifts).
 */
export async function campaignSideGifts(db, recipientIds, side, alsoNotFrom = []) {
  const ids = recipientIds.filter(id => IDS.test(id));
  const notFrom = new Set([...ids, ...alsoNotFrom]);
  const missing = ids.filter(id => side.missing.has(id) || !side.byRecipient.has(id));
  const fallback = missing.length ? await pacGifts(db, missing, [...ids, ...alsoNotFrom]) : [];
  const gifts = ids
    .filter(id => !missing.includes(id))
    .flatMap(id => side.byRecipient.get(id) || [])
    .filter(g => !notFrom.has(g.giver))
    .filter(
      g => !COMMITTEE_SINCE[g.recipient] || (g.date && g.date >= COMMITTEE_SINCE[g.recipient].from)
    );
  const givers = [...new Set(gifts.map(g => g.giver))];
  const info = new Map();
  for (let i = 0; i < givers.length; i += 500) {
    const chunk = givers.slice(i, i + 500);
    for (const c of await db.read(
      `SELECT id, name, type, designation, org_type, connected_org FROM cm
       WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk
    )) {
      info.set(c.id, c);
    }
  }
  const out = new Map(fallback.map(g => [g.id, { ...g }]));
  for (const g of gifts) {
    const c = info.get(g.giver) || {};
    if (PARTY_TYPES.has(c.type)) {
      continue;
    }
    const row = out.get(g.giver) || {
      id: g.giver,
      name: c.name || g.giver,
      committeeType: c.type || null,
      designation: c.designation || null,
      orgType: c.org_type || null,
      connectedOrg: c.connected_org || null,
      kind: pacType(c.type, c.designation),
      amount: 0,
      gifts: 0,
    };
    row.amount = cents(row.amount + g.amount);
    row.gifts += 1;
    out.set(g.giver, row);
  }
  return [...out.values()].filter(g => g.amount > 0).sort((a, b) => b.amount - a.amount);
}

// Gifts to a committee counted only from a date (fec-crosswalk-additions.js
// COMMITTEE_SINCE) are left out before it
function sinceClause(recipient, date) {
  const ids = Object.keys(COMMITTEE_SINCE).filter(id => IDS.test(id));
  return ids
    .map(
      id =>
        `AND NOT (${recipient} = '${id}' AND (${date} IS NULL OR ${date} < '${COMMITTEE_SINCE[id].from}'))`
    )
    .join(' ');
}

/**
 * The committees whose list of PAC gifts (campaignPacGifts: `side`) comes to
 * well under the PAC money their own reports total: under 90% and more than
 * $10,000 short. Lines naming no FEC ID and party gifts make a list a little
 * short; a list asked for on the wrong form came back nearly empty and
 * nothing said so (2026-10-31). `committees`: personFunding's breakdown.
 */
export function shortLists(committees, side) {
  return (committees || [])
    .filter(c => c.role === 'campaign' || c.role === 'leadership')
    .filter(c => side.byRecipient.has(c.committeeId) && !side.missing.has(c.committeeId))
    .map(c => ({
      committeeId: c.committeeId,
      listed: cents(side.byRecipient.get(c.committeeId).reduce((t, g) => t + g.amount, 0)),
      reported: cents(c.pac),
    }))
    .filter(c => c.listed < 0.9 * c.reported && c.reported - c.listed > 10000);
}

const DAY = 24 * 60 * 60 * 1000;
const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

// Words that say nothing about which PAC a name is
const FILLER = new Set(
  'PAC POLITICAL ACTION COMMITTEE COMM CMTE FUND THE OF FOR AND INC INCORPORATED ASSOCIATION ASSOC ASSN CORP CORPORATION CO COMPANY FEDERAL NATIONAL INTL INTERNATIONAL AMERICA AMERICAN AMERICANS'.split(
    ' '
  )
);
const wordsOf = name =>
  new Set(
    String(name || '')
      .toUpperCase()
      .replace(/'/g, '')
      .split(/[^A-Z0-9]+/)
      .filter(w => w.length > 1 && !FILLER.has(w))
  );
const shared = (a, b) => {
  const B = wordsOf(b);
  return [...wordsOf(a)].filter(w => B.has(w)).length;
};

/**
 * A campaign's PAC lines that name no FEC ID, named from the PACs' own
 * reports of the same gifts (2026-11-01: Jim Desmond's campaign listed the
 * Air Line Pilots Association's $5,000 by name alone, and leaving it out
 * cost a grade). For one receiving committee: `named`, its lines with an
 * ID; `unnamed`, those without ({amount, date, name}); `pacSide`, the PACs'
 * reports of their gifts to it ({giver, amount, date}); `nameOf`, each
 * PAC's name in the FEC's register. The PACs' gifts that match a named
 * line (same PAC and amount, within `days`) are set aside first. A gift
 * fits a line with its amount dated within `days` of it (a PAC dates a gift
 * when it sends it, the campaign when it arrives). A line takes a gift's
 * PAC when that gift is the only one that fits it and it is the only line
 * the gift fits; or, when several fit, when the PAC's registered name
 * shares at least two words with the line's name and clearly more than any
 * other that fits (the pilots' $5,000 and SpaceX's PAC's $5,000 to Jim
 * Desmond a day apart). Repeated until nothing more is named. Returns the
 * lines named, as gifts.
 */
export function nameFromPacReports({
  recipient,
  named,
  unnamed,
  pacSide,
  nameOf = () => '',
  days = 14,
}) {
  const near = (a, b) => a.date && b.date && daysApart(a.date, b.date) <= days;
  const left = pacSide.filter(p => p.amount > 0 && p.date);
  for (const g of named) {
    const i = left.findIndex(p => p.giver === g.giver && p.amount === g.amount && near(p, g));
    if (i >= 0) {
      left.splice(i, 1);
    }
  }
  let lines = unnamed.filter(u => u.amount > 0 && u.date);
  const found = [];
  const take = (u, gift) => {
    found.push({ giver: gift.giver, recipient, amount: u.amount, date: u.date });
    left.splice(left.indexOf(gift), 1);
    lines = lines.filter(x => x !== u);
  };
  // The one gift among `gifts` whose PAC's name clearly matches `name`
  const byName = (name, gifts) => {
    const scored = gifts
      .map(g => ({ g, n: shared(name, nameOf(g.giver)) }))
      .sort((a, b) => b.n - a.n);
    return scored[0]?.n >= 2 && !(scored[1]?.n >= scored[0].n) ? scored[0].g : null;
  };
  for (let changed = true; changed;) {
    changed = false;
    const fits = new Map(
      lines.map(u => [u, left.filter(p => p.amount === u.amount && near(p, u))])
    );
    const linesFor = gift => lines.filter(u => fits.get(u).includes(gift));
    for (const u of lines) {
      const mine = fits.get(u);
      let gift = mine.length === 1 && linesFor(mine[0]).length === 1 ? mine[0] : null;
      if (!gift && mine.length) {
        const pick = byName(u.name, mine);
        // ...and no other line's name matches that gift as well
        gift =
          pick && linesFor(pick).every(x => x === u || byName(x.name, [pick]) === null)
            ? pick
            : null;
      }
      if (gift) {
        take(u, gift);
        changed = true;
        break;
      }
    }
  }
  return found;
}

/**
 * Every receiving committee's lines naming no FEC ID (raw-filings.mjs
 * campaignPacGifts: `side`), named from the PACs' own reports in the bulk
 * file (oth: 24K, in-kind 24Z) and added to its gifts. Returns how many.
 */
export async function fillFromPacReports(db, side) {
  const ids = [...(side.unnamed?.keys() || [])].filter(
    id => IDS.test(id) && side.byRecipient.has(id) && !side.missing.has(id)
  );
  const pacSide = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of await db.read(
      `SELECT committee_id AS giver, other_id AS recipient, amount, date FROM oth
       WHERE tx_type IN ('24K', '24Z') AND other_id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk
    )) {
      const g = { giver: r.giver, amount: cents(r.amount), date: r.date };
      pacSide.set(r.recipient, [...(pacSide.get(r.recipient) || []), g]);
    }
  }
  const givers = [...new Set([...pacSide.values()].flat().map(g => g.giver))];
  const names = new Map();
  for (let i = 0; i < givers.length; i += 500) {
    const chunk = givers.slice(i, i + 500);
    for (const c of await db.read(
      `SELECT id, name FROM cm WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk
    )) {
      names.set(c.id, c.name);
    }
  }
  let count = 0;
  for (const id of ids) {
    const found = nameFromPacReports({
      recipient: id,
      named: side.byRecipient.get(id),
      unnamed: side.unnamed.get(id),
      pacSide: pacSide.get(id) || [],
      nameOf: giver => names.get(giver) || '',
    });
    side.byRecipient.get(id).push(...found);
    count += found.length;
  }
  return count;
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
