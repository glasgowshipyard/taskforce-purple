// A member's donor analysis, computed in DuckDB over every committee in their
// donor pool (REBUILD_SPEC.md §5 step 6). Same definitions as the itemized
// worker's calculateMetricsFromAggregates, so grades mean the same thing:
//   - a donor is FIRST|LAST|STATE|ZIP5; their total nets refunds/corrections
//   - uniqueDonors counts every donor key
//   - totalTransactions and the median are over gifts (amount > 0)
//   - top10Concentration = the 10 largest donors' total / totalAmount
//   - nakamotoCoefficient = how few donors, largest first, hold half the money
// Rows: bulk-file rows plus API gap fills, only those that count as itemized
// individual money.

import { isGovernment } from './fara.mjs';

const IDS = /^C\d{8}$/;

// A name reduced to letters only, upper case: for matching a donor to a
// registered agent ("O'Neil, John P." and "ONEIL, JOHN" are the same)
const LETTERS = x => `regexp_replace(upper(coalesce(${x}, '')), '[^A-Z]', '', 'g')`;

/**
 * The foreign-agent tables for this batch: employer -> registered firm (the
 * old pipeline's matches, D1 fara_employer_matches) and, from the DOJ's own
 * files (lib/fara.mjs), each firm's registered individuals and foreign
 * clients, active at any time in the cycle (#60).
 */
export async function loadFara(bulk, rows, files = null, cycle = null) {
  await bulk.conn.run(
    'CREATE OR REPLACE TABLE fara (employer VARCHAR, fara_firm VARCHAR, registration_number VARCHAR)'
  );
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await bulk.conn.run(
      `INSERT INTO fara VALUES ${batch.map(() => '(?,?,?)').join(',')}`,
      batch.flatMap(r => [r.employer, r.fara_firm, String(r.registration_number ?? '')])
    );
  }
  // Active at any time in the two years of the cycle
  const since = cycle ? `${cycle - 1}-01-01` : '1900-01-01';
  const ended = col =>
    `(coalesce(${col}, '') = '' OR try_strptime(${col}, '%m/%d/%Y') >= DATE '${since}')`;
  await bulk.conn.run(
    files
      ? `CREATE OR REPLACE TABLE fara_agents AS
         SELECT "Registration Number" AS reg, ${LETTERS('"Short Form Last Name"')} AS last,
           ${LETTERS(`split_part(trim("Short Form First Name"), ' ', 1)`)} AS first,
           trim("Short Form First Name") || ' ' || trim("Short Form Last Name") AS name
         FROM read_csv('${files.shortForms}', header=true, all_varchar=true)
         WHERE ${ended('"Short Form Termination Date"')}`
      : 'CREATE OR REPLACE TABLE fara_agents (reg VARCHAR, last VARCHAR, first VARCHAR, name VARCHAR)'
  );
  await bulk.conn.run(
    files
      ? `CREATE OR REPLACE TABLE fara_clients AS
         SELECT DISTINCT "Registration Number" AS reg, trim("Foreign Principal") AS client,
           trim("Country/Location Represented") AS country
         FROM read_csv('${files.principals}', header=true, all_varchar=true)
         WHERE ${ended('"Foreign Principal Termination Date"')}`
      : 'CREATE OR REPLACE TABLE fara_clients (reg VARCHAR, client VARCHAR, country VARCHAR)'
  );
}

/**
 * conduitName(committeeId) resolves a conduit committee's name (cached by
 * the caller). Earmarked rows name their conduit in other_id.
 */
export async function analyzePool(bulk, poolIds, { conduitName }) {
  if (!poolIds.length || !poolIds.every(id => IDS.test(id))) {
    throw new Error('analyzePool: invalid or empty committee pool');
  }
  const { read } = bulk;
  const ids = poolIds.map(i => `'${i}'`).join(',');
  const rows = `(SELECT * FROM bulk WHERE committee_id IN (${ids}) AND counts
                 AND sub_id NOT IN (SELECT sub_id FROM api)
                 UNION ALL
                 SELECT * FROM api WHERE committee_id IN (${ids}) AND counts)`;
  const donors = `(SELECT upper(trim(split_part(name, ',', 2))) || '|' || upper(trim(split_part(name, ',', 1)))
                     || '|' || upper(trim(coalesce(state, ''))) || '|' || coalesce(zip5, '') AS donor,
                   sum(amount) AS total
                   FROM ${rows} GROUP BY 1)`;

  const [s] = await read(`
    WITH d AS ${donors},
    ranked AS (SELECT donor, total, sum(total) OVER (ORDER BY total DESC, donor ROWS UNBOUNDED PRECEDING) AS cum FROM d),
    gifts AS (SELECT amount FROM ${rows} WHERE amount > 0)
    SELECT
      (SELECT count(*) FROM d)::INTEGER AS uniqueDonors,
      (SELECT coalesce(sum(amount), 0) FROM ${rows}) AS totalAmount,
      (SELECT count(*) FROM gifts)::INTEGER AS totalTransactions,
      (SELECT quantile_cont(amount, 0.5) FROM gifts) AS medianDonation,
      (SELECT min(amount) FROM gifts) AS minDonation,
      (SELECT max(amount) FROM gifts) AS maxDonation,
      (SELECT coalesce(sum(total), 0) FROM (SELECT total FROM d ORDER BY total DESC LIMIT 10)) AS top10Total,
      (SELECT coalesce(sum(total), 0) FROM d) AS donorTotal,
      (SELECT count(*) FROM ranked WHERE cum - total < (SELECT sum(total) FROM d) * 0.5)::INTEGER AS nakamotoCoefficient,
      (SELECT coalesce(sum(total), 0) FROM (SELECT total FROM d ORDER BY total DESC
         LIMIT greatest(1, ceil((SELECT count(*) FROM d) * 0.01)::INTEGER))) AS top1PctTotal
  `);
  const topDonors = await read(`
    WITH d AS ${donors}
    SELECT donor, total FROM d ORDER BY total DESC, donor LIMIT 10`);

  // Earmarked money and the conduits that bundled it (issue #33)
  const earmarks = await read(`
    SELECT other_id, sum(amount) amount, count(*)::INTEGER n
    FROM ${rows}
    WHERE (tx_type = '15E' OR regexp_matches(coalesce(memo_text, ''), '(?i)earmark')) AND amount > 0
    GROUP BY 1 ORDER BY amount DESC`);
  const conduitTotals = new Map();
  for (const e of earmarks) {
    const name =
      e.other_id && IDS.test(e.other_id) ? await conduitName(e.other_id) : 'UNKNOWN CONDUIT';
    const c = conduitTotals.get(name) || { name, amount: 0, count: 0 };
    c.amount += Number(e.amount);
    c.count += e.n;
    conduitTotals.set(name, c);
  }

  // Donations from people at firms registered as foreign agents (issue #34),
  // and which of those donors are personally registered as agents (#60):
  // their name is on the firm's own short-form list at the DOJ
  const faraRows = `(SELECT r.*, f.fara_firm, f.registration_number,
      EXISTS (SELECT 1 FROM fara_agents a WHERE a.reg = f.registration_number
        AND a.last = ${LETTERS(`split_part(r.name, ',', 1)`)}
        AND a.first = ${LETTERS(`split_part(trim(split_part(r.name, ',', 2)), ' ', 1)`)}) AS is_agent
      FROM ${rows} r JOIN fara f ON r.employer = f.employer)`;
  const fara = await read(`
    SELECT fara_firm, registration_number, round(sum(amount), 2) AS total, count(*)::INTEGER AS donations,
      round(sum(amount) FILTER (WHERE is_agent), 2) AS agent_total
    FROM ${faraRows} GROUP BY 1, 2 ORDER BY total DESC`);
  const agents = await read(`
    SELECT registration_number, upper(trim(split_part(name, ',', 2))) || ' ' || upper(trim(split_part(name, ',', 1))) AS donor,
      round(sum(amount), 2) AS total
    FROM ${faraRows} WHERE is_agent GROUP BY 1, 2 ORDER BY total DESC LIMIT 20`);
  const shown = fara.slice(0, 8).map(f => f.registration_number);
  const clients = shown.length
    ? await read(
        `SELECT reg, client, country FROM fara_clients WHERE reg IN (${shown.map(() => '?').join(',')}) ORDER BY country, client`,
        ...shown
      )
    : [];

  const totalAmount = Number(s.totalAmount);
  return {
    committeeIds: [...poolIds].sort(),
    uniqueDonors: s.uniqueDonors,
    totalTransactions: s.totalTransactions,
    totalAmount: Math.round(totalAmount * 100) / 100,
    avgDonation: s.totalTransactions ? totalAmount / s.totalTransactions : 0,
    medianDonation: s.medianDonation === null ? 0 : Number(s.medianDonation),
    minDonation: s.minDonation === null ? 0 : Number(s.minDonation),
    maxDonation: s.maxDonation === null ? 0 : Number(s.maxDonation),
    top10Concentration: totalAmount ? Number(s.top10Total) / totalAmount : 0,
    whaleWeight: Number(s.donorTotal) ? Number(s.top1PctTotal) / Number(s.donorTotal) : 0,
    nakamotoCoefficient: s.nakamotoCoefficient,
    conduits: [...conduitTotals.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map(c => ({ ...c, amount: Math.round(c.amount * 100) / 100 })),
    earmarkedTotal: Math.round(earmarks.reduce((t, e) => t + Number(e.amount), 0) * 100) / 100,
    earmarkedCount: earmarks.reduce((t, e) => t + e.n, 0),
    faraFirms: fara.slice(0, 8).map(f => {
      const mine = clients.filter(c => c.reg === f.registration_number);
      return {
        name: f.fara_firm,
        registrationNumber: f.registration_number,
        amount: Number(f.total),
        donations: f.donations,
        agentAmount: Number(f.agent_total || 0),
        agents: agents
          .filter(a => a.registration_number === f.registration_number)
          .slice(0, 5)
          .map(a => ({ name: a.donor, amount: Number(a.total) })),
        clientCount: mine.length,
        countries: [...new Set(mine.map(c => c.country).filter(Boolean))].sort(),
        clients: mine.slice(0, 8).map(c => ({
          name: c.client,
          country: c.country,
          government: isGovernment(c.client),
        })),
      };
    }),
    // Everyone at a registered firm, and those personally registered (#60)
    faraEmployerTotal: Math.round(fara.reduce((t, f) => t + Number(f.total), 0) * 100) / 100,
    faraAgentTotal:
      Math.round(fara.reduce((t, f) => t + Number(f.agent_total || 0), 0) * 100) / 100,
    topDonors: topDonors.map(d => {
      const [first, last, state, zip] = d.donor.split('|');
      return { name: `${first} ${last}`.trim(), state, zip, amount: Number(d.total) };
    }),
  };
}
