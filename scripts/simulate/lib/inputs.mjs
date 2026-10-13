// What the simplification simulation needs beyond the live grade (owner's
// brief, 2026-10-11): each member's and each PAC's donor picture under the
// rules being tested. Measured on the same records the live grade uses.
//   - donors who net above $0 only (F11; PACs already count only those)
//   - the money held by the biggest donors
//   - each donor's money capped at $500, $1,000 and $2,000 (variant D)
//   - for PACs, the share of their donors' money from the top employer
// Nothing here grades: scripts/simulate/lib/grid.mjs does.

import { ITEMIZED_TYPES } from '../../refresh/lib/reconcile.mjs';

const IDS = /^C\d{8}$/;
export const CAPS = [500, 1000, 2000];
const round2 = x => Math.round((Number(x) || 0) * 100) / 100;

const ITCONT_COLUMNS = `{'CMTE_ID':'VARCHAR','AMNDT_IND':'VARCHAR','RPT_TP':'VARCHAR','TRANSACTION_PGI':'VARCHAR',
  'IMAGE_NUM':'VARCHAR','TRANSACTION_TP':'VARCHAR','ENTITY_TP':'VARCHAR','NAME':'VARCHAR','CITY':'VARCHAR',
  'STATE':'VARCHAR','ZIP_CODE':'VARCHAR','EMPLOYER':'VARCHAR','OCCUPATION':'VARCHAR','TRANSACTION_DT':'VARCHAR',
  'TRANSACTION_AMT':'VARCHAR','OTHER_ID':'VARCHAR','TRAN_ID':'VARCHAR','FILE_NUM':'VARCHAR','MEMO_CD':'VARCHAR',
  'MEMO_TEXT':'VARCHAR','SUB_ID':'VARCHAR'}`;

/**
 * A member's donors, on the rows analyzePool reads (bulk rows that count,
 * plus the record check's API rows). `liveN`: the live Nakamoto coefficient,
 * to add up what the same donors hold.
 */
export async function memberDonorShape(bulk, poolIds, liveN, weights = null, opts = {}) {
  if (!poolIds.length || !poolIds.every(id => IDS.test(id))) {
    return null;
  }
  const ids = poolIds.map(i => `'${i}'`).join(',');
  // FINAL-2: gifts earmarked through a committee that directs them (any
  // conduit but the processing platforms, `opts.platforms`) count as that
  // committee's gift, so they leave the donor test
  const platforms = (opts.platforms || []).filter(id => IDS.test(id));
  const directed = `(tx_type = '15E' OR regexp_matches(coalesce(memo_text, ''), '(?i)earmark'))
    AND regexp_matches(coalesce(other_id, ''), '^C[0-9]{8}$')
    ${platforms.length ? `AND other_id NOT IN (${platforms.map(i => `'${i}'`).join(',')})` : ''}`;
  const keep = opts.platforms ? `AND NOT (${directed})` : '';
  // `weights` (committee id -> 0-1): each gift counted at that fraction, so a
  // joint fund's donors count only for the money that reached the member
  const w = Object.entries(weights || {}).filter(([id, x]) => IDS.test(id) && Number.isFinite(x));
  const amount = w.length
    ? `amount * CASE committee_id ${w.map(([id, x]) => `WHEN '${id}' THEN ${Math.max(0, Math.min(1, x))}`).join(' ')} ELSE 1 END`
    : 'amount';
  const all = `(SELECT * FROM bulk WHERE committee_id IN (${ids}) AND counts
                 AND sub_id NOT IN (SELECT sub_id FROM api)
                 UNION ALL
                 SELECT * FROM api WHERE committee_id IN (${ids}) AND counts)`;
  const rows = `(SELECT * FROM ${all} WHERE TRUE ${keep})`;
  const [r] = await bulk.read(
    `
    WITH d AS (
      SELECT upper(trim(split_part(name, ',', 2))) || '|' || upper(trim(split_part(name, ',', 1)))
          || '|' || upper(trim(coalesce(state, ''))) || '|' || coalesce(zip5, '') AS donor,
        sum(${amount}) AS amt
      FROM ${rows} GROUP BY 1),
    pos AS (SELECT donor, amt FROM d WHERE amt > 0),
    ranked AS (
      SELECT amt,
        row_number() OVER (ORDER BY amt DESC, donor) AS rk,
        sum(amt) OVER (ORDER BY amt DESC, donor ROWS UNBOUNDED PRECEDING) AS cum
      FROM pos),
    agg AS (
      SELECT count(*)::INTEGER AS donors, coalesce(sum(amt), 0) AS total,
        ${CAPS.map(k => `coalesce(sum(least(amt, ${k})), 0) AS capped${k}`).join(', ')}
      FROM pos),
    nak AS (SELECT count(*)::INTEGER AS n FROM ranked, agg WHERE ranked.cum - ranked.amt < agg.total * 0.5)
    SELECT agg.*, nak.n AS nakamoto,
      (SELECT coalesce(sum(amt), 0) FROM ranked WHERE rk <= ?) AS topLive,
      (SELECT coalesce(sum(ranked.amt), 0) FROM ranked, nak WHERE ranked.rk <= nak.n) AS topPositive
    FROM agg, nak`,
    Number(liveN) || 0
  );
  // The directed gifts left out, by the committee that directed them
  const directedOut = opts.platforms
    ? Object.fromEntries(
        (
          await bulk.read(`SELECT other_id AS id, sum(amount) AS amount FROM ${all}
             WHERE ${directed} GROUP BY 1 HAVING sum(amount) <> 0`)
        ).map(d => [d.id, round2(d.amount)])
      )
    : undefined;
  // Where the big money came from: the same donors' money by their state
  // (`opts.byState`, for the member page; owner and Craig, 2026-10-13)
  const byState = opts.byState
    ? (
        await bulk.read(`
        WITH d AS (
          SELECT upper(trim(coalesce(state, ''))) AS st,
            upper(trim(split_part(name, ',', 2))) || '|' || upper(trim(split_part(name, ',', 1)))
              || '|' || upper(trim(coalesce(state, ''))) || '|' || coalesce(zip5, '') AS donor,
            sum(${amount}) AS amt
          FROM ${rows} GROUP BY 1, 2)
        SELECT st AS state, sum(amt) AS amount FROM d WHERE amt > 0 GROUP BY 1 ORDER BY 2 DESC, 1`)
      ).map(x => ({ state: x.state || null, amount: round2(x.amount) }))
    : undefined;
  return {
    donors: r.donors,
    nakamoto: r.nakamoto,
    total: round2(r.total),
    topLive: round2(r.topLive),
    topPositive: round2(r.topPositive),
    capped: Object.fromEntries(CAPS.map(k => [k, round2(r[`capped${k}`])])),
    ...(directedOut ? { directedOut } : {}),
    ...(byState ? { byState } : {}),
  };
}

/**
 * For every PAC: each donor's money capped (variant D), and the share of its
 * donors' money from the top employer. Same rows as pacProfiles (itemized
 * individual money, memos dropped, donors who net above $0).
 * Returns Map id -> { capped: {500, 1000, 2000}, topEmployer, topEmployerShare }.
 */
export async function pacExtras(db, itcontPath, pacIds) {
  const ids = [...new Set(pacIds)].filter(id => IDS.test(id));
  const out = new Map();
  if (!ids.length) {
    return out;
  }
  const list = ids.map(id => `('${id}')`).join(',');
  const types = [...ITEMIZED_TYPES].map(t => `'${t}'`).join(',');
  const source = `read_csv('${itcontPath}', delim='|', header=false, quote='', escape='', ignore_errors=true,
      columns=${ITCONT_COLUMNS})`;
  const where = `CMTE_ID IN (SELECT id FROM ids) AND TRANSACTION_TP IN (${types}) AND coalesce(MEMO_CD, '') <> 'X'`;
  const donors = await db.read(`
    WITH ids(id) AS (VALUES ${list}),
    d AS (
      SELECT CMTE_ID AS id,
        upper(trim(split_part(NAME, ',', 2))) || '|' || upper(trim(split_part(NAME, ',', 1)))
          || '|' || upper(trim(coalesce(STATE, ''))) || '|' || substr(coalesce(ZIP_CODE, ''), 1, 5) AS donor,
        sum(TRY_CAST(TRANSACTION_AMT AS DOUBLE)) AS total
      FROM ${source} WHERE ${where}
      GROUP BY 1, 2
      HAVING sum(TRY_CAST(TRANSACTION_AMT AS DOUBLE)) > 0)
    SELECT id, ${CAPS.map(k => `sum(least(total, ${k})) AS capped${k}`).join(', ')}
    FROM d GROUP BY id`);
  for (const r of donors) {
    out.set(r.id, {
      capped: Object.fromEntries(CAPS.map(k => [k, round2(r[`capped${k}`])])),
      topEmployer: null,
      topEmployerShare: null,
    });
  }
  // Employers as written, upper case, punctuation dropped: noisy, so this is
  // a measurement, not a variant
  const employers = await db.read(`
    WITH ids(id) AS (VALUES ${list}),
    e AS (
      SELECT CMTE_ID AS id,
        trim(regexp_replace(upper(coalesce(EMPLOYER, '')), '[^A-Z0-9 ]', '', 'g')) AS employer,
        sum(TRY_CAST(TRANSACTION_AMT AS DOUBLE)) AS total
      FROM ${source} WHERE ${where}
      GROUP BY 1, 2),
    ranked AS (
      SELECT id, employer, total,
        row_number() OVER (PARTITION BY id ORDER BY total DESC, employer) AS rk,
        sum(total) OVER (PARTITION BY id) AS all_total
      FROM e WHERE total > 0)
    SELECT id, employer, total, all_total FROM ranked WHERE rk = 1`);
  for (const r of employers) {
    const p = out.get(r.id) || { capped: null };
    out.set(r.id, {
      ...p,
      topEmployer: r.employer || null,
      topEmployerShare:
        r.all_total > 0 ? Math.round((r.total / r.all_total) * 10000) / 10000 : null,
    });
  }
  return out;
}
