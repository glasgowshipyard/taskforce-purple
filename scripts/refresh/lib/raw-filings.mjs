// Donor records from the FEC's raw electronic filings (owner, 2026-10-31:
// "we can't have stale data this close to the election"). The FEC posts each
// report as filed within minutes, but takes weeks to process its donor lines
// into the bulk file and the API's records. Until then the totals were
// current and the records weren't: after the October reports 184 grades
// fell back to the 0.40 allowance because the records held under half the
// big-donor money. A report not yet processed is now read from its raw file
// (one download, no API call), and its donor lines are used only when they
// add up, to the cent, to the itemized total on the report's own summary.

import { COMMITTEE_SINCE } from '../../../workers/fec-crosswalk-additions.js';
import { scheduleAPages } from './fec.mjs';
import { bulkDate } from './reconcile.mjs';

export const rawFilingUrl = fileNumber => `https://docquery.fec.gov/dcdev/posted/${fileNumber}.fec`;

// The campaign (F3) and PAC or joint fund (F3X) reports, new or amended. An
// amended report restates the whole report, so the newest filing for a
// period replaces the others
export const REPORT_FORMS = ['F3N', 'F3A', 'F3XN', 'F3XA'];

// Summary-line columns (FEC format 8.x): the coverage dates, line 11(a)(i),
// itemized contributions from individuals, for the period
// and line 11(c), contributions from other political committees (PACs)
const SUMMARY = {
  F3: { from: 15, to: 16, itemized: 32, pacs: 36 },
  F3X: { from: 13, to: 14, itemized: 29, pacs: 33 },
};

// Schedule A columns (FEC format 8.x)
const SA = {
  committee: 1,
  transaction: 2,
  backReference: 3,
  entity: 5,
  organization: 6,
  last: 7,
  first: 8,
  middle: 9,
  prefix: 10,
  suffix: 11,
  state: 15,
  zip: 16,
  date: 19,
  amount: 20,
  employer: 23,
  occupation: 24,
  donorCommittee: 25,
  memoCode: 42,
  memoText: 43,
};

const SEPARATOR = '\x1c';
const unquote = v => {
  const s = String(v ?? '').trim();
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"')
    ? s.slice(1, -1).replace(/""/g, '"').trim()
    : s;
};
const cents = x => Math.round(Number(x) * 100);

/**
 * One raw filing's report and itemized individual records (line 11a(i)), in
 * the bulk table's shape (bulk.mjs). `ok` is false, with `why`, when the
 * records don't add up to the report's own itemized total.
 */
export function parseRawFiling(text, fileNumber) {
  const lines = String(text).split(/\r?\n/);
  const summary = (lines[1] || '').split(SEPARATOR);
  const form = unquote(summary[0]).replace(/[NA]$/, '');
  const at = SUMMARY[form];
  if (!at) {
    return { ok: false, why: `not a report (${summary[0] || 'empty'})`, rows: [] };
  }
  // Some filing programs write the line code in lower case ("SA11Ai"), and
  // some leave empty fields off the end of a line
  const linesOf = code =>
    lines
      .filter(l => l.slice(0, code.length + 1).toUpperCase() === `${code}${SEPARATOR}`)
      .map(l => {
        const r = l.split(SEPARATOR).map(unquote);
        while (r.length <= SA.memoText) {
          r.push('');
        }
        return r;
      });
  const rows = linesOf('SA11AI');
  // The conduit an earmarked gift came through: the conduit's own line that
  // the gift refers back to, else the committee its memo names
  const committeeOf = new Map();
  const byName = new Map();
  for (const r of rows) {
    const id = r[SA.donorCommittee];
    if (/^C\d{8}$/.test(id)) {
      committeeOf.set(r[SA.transaction], id);
      byName.set(r[SA.organization].toUpperCase(), id);
    }
  }
  const conduitOf = r => {
    const back = committeeOf.get(r[SA.backReference]);
    if (back) {
      return back;
    }
    const memo = r[SA.memoText].toUpperCase();
    for (const [name, id] of byName) {
      if (name && memo.includes(name)) {
        return id;
      }
    }
    return null;
  };
  const records = rows.map(r => {
    const memo = r[SA.memoCode] === 'X';
    const earmarked = /earmark/i.test(r[SA.memoText]);
    const person = [r[SA.first], r[SA.middle], r[SA.prefix], r[SA.suffix]]
      .filter(Boolean)
      .join(' ');
    return {
      committee_id: r[SA.committee],
      sub_id: `raw.${fileNumber}.${r[SA.transaction]}`,
      tx_type: earmarked ? '15E' : '15',
      entity: r[SA.entity] || null,
      name: r[SA.last] ? `${r[SA.last]}, ${person}`.trim() : r[SA.organization] || null,
      state: r[SA.state] || null,
      zip5: r[SA.zip].slice(0, 5) || null,
      employer: r[SA.employer] || null,
      occupation: r[SA.occupation] || null,
      date: bulkDate(reorder(r[SA.date])),
      amount: Number(r[SA.amount]) || 0,
      memo,
      other_id: earmarked || memo ? conduitOf(r) : null,
      memo_text: r[SA.memoText] || null,
      source: 'raw',
      counts: !memo,
      file_num: String(fileNumber),
    };
  });
  const sum = records.filter(r => r.counts).reduce((t, r) => t + cents(r.amount), 0);
  const reported = cents(unquote(summary[at.itemized]));
  const report = {
    committeeId: unquote(summary[1]),
    fileNumber: String(fileNumber),
    from: bulkDate(reorder(unquote(summary[at.from]))),
    to: bulkDate(reorder(unquote(summary[at.to]))),
    itemized: reported / 100,
  };
  const pacs = pacGiftsOf(linesOf('SA11C'), cents(unquote(summary[at.pacs])));
  if (sum !== reported) {
    return {
      ok: false,
      why: `records add up to $${(sum / 100).toFixed(2)}, the report says $${(reported / 100).toFixed(2)}`,
      report,
      rows: [],
      pacs,
    };
  }
  return { ok: true, report, rows: records, pacs };
}

// The report's PAC gifts (line 11c), used only when they add up to the
// report's own line 11(c) total to the cent. A line that names no FEC ID is
// kept out of the list: with no committee to look up it counts as no one's
// people money, which is how the grade treats a PAC it can't test
function pacGiftsOf(rows, reported) {
  const counted = rows.filter(r => r[SA.memoCode] !== 'X');
  const sum = counted.reduce((t, r) => t + cents(r[SA.amount]), 0);
  if (sum !== reported) {
    return {
      ok: false,
      why: `PAC gifts add up to $${(sum / 100).toFixed(2)}, the report says $${(reported / 100).toFixed(2)}`,
      gifts: [],
      unnamed: 0,
    };
  }
  const named = counted.filter(r => /^C\d{8}$/.test(r[SA.donorCommittee]));
  return {
    ok: true,
    gifts: named.map(r => ({
      giver: r[SA.donorCommittee],
      recipient: r[SA.committee],
      amount: Math.round(Number(r[SA.amount]) * 100) / 100,
      date: bulkDate(reorder(r[SA.date])),
    })),
    unnamed: counted.length - named.length,
  };
}

// Raw filings write dates YYYYMMDD; bulkDate takes the bulk file's MMDDYYYY
function reorder(yyyymmdd) {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(4, 8)}${yyyymmdd.slice(0, 4)}` : '';
}

/**
 * The reports whose records aren't processed yet: for each committee and
 * period, the newest filing, unless a filing for that period is already in
 * the processed records (`processed`: committee id -> { files: Set of file
 * numbers, newest: the latest record date }). `figures` (reportFigures)
 * says which reports have records to read: one whose `field` is 0 is left
 * out, and any other is read whatever its date (a negative figure is
 * refunds, 2026-10-31), since the FEC doesn't
 * process reports in order (a committee's October report was processed
 * before its September one, 2026-10-31). A report not in `figures` yet is
 * read only when it starts after the newest processed record, and none is
 * read when a processed record (`dates`) falls in its period, so nothing
 * can be counted twice.
 */
export function unprocessedReports(filings, processed, figures = new Map(), field = 'pacs') {
  const periods = new Map();
  for (const f of filings) {
    if (!REPORT_FORMS.includes(f.form_type) || !f.coverage_start_date || !f.coverage_end_date) {
      continue;
    }
    const key = `${f.committee_id}|${f.coverage_start_date.slice(0, 10)}|${f.coverage_end_date.slice(0, 10)}`;
    const list = periods.get(key) || [];
    list.push(f);
    periods.set(key, list);
  }
  const out = [];
  for (const [key, list] of periods) {
    const seen = processed.get(list[0].committee_id) || { files: new Set(), newest: null };
    if (list.some(f => seen.files.has(String(f.file_number)))) {
      continue;
    }
    const start = list[0].coverage_start_date.slice(0, 10);
    const end = list[0].coverage_end_date.slice(0, 10);
    const figure = figures.get(key)?.[field];
    if (figure !== undefined ? figure === 0 : seen.newest && start <= seen.newest) {
      continue;
    }
    if ((seen.dates || []).some(d => d >= start && d <= end)) {
      continue;
    }
    const newest = [...list].sort(
      (a, b) =>
        String(b.receipt_date).localeCompare(String(a.receipt_date)) ||
        Number(b.file_number) - Number(a.file_number)
    )[0];
    out.push({
      committeeId: newest.committee_id,
      fileNumber: String(newest.file_number),
      from: start,
      to: newest.coverage_end_date.slice(0, 10),
    });
  }
  return out.sort(
    (a, b) => a.committeeId.localeCompare(b.committeeId) || a.from.localeCompare(b.from)
  );
}

/**
 * Add the records of every report not yet processed, for these committees,
 * to the bulk connection's `api` table. One FEC call per 20 committees (the
 * filings list) and one download per report. Returns what was added and
 * what was refused, for the log and the run summary.
 */
export async function addRawFilings({
  fec,
  bulk,
  committeeIds,
  cycle,
  insertRows,
  log = () => {},
  fetchImpl = fetch,
}) {
  const ids = [...new Set(committeeIds)].filter(id => /^C\d{8}$/.test(id));
  const added = [];
  const refused = [];
  if (!ids.length) {
    return { added, refused };
  }
  const list = ids.map(i => `'${i}'`).join(',');
  const seen = await bulk.read(`
    SELECT committee_id, list(DISTINCT file_num) AS files, max(date) AS newest,
      list(DISTINCT date) AS dates FROM (
      SELECT committee_id, file_num, date FROM bulk WHERE committee_id IN (${list})
      UNION ALL
      SELECT committee_id, file_num, date FROM api WHERE committee_id IN (${list}) AND source <> 'raw'
    ) GROUP BY 1`);
  const processed = new Map(
    seen.map(r => [
      r.committee_id,
      {
        files: new Set((r.files?.items ?? r.files ?? []).filter(Boolean).map(String)),
        newest: r.newest || null,
        dates: (r.dates?.items ?? r.dates ?? []).filter(Boolean).map(String),
      },
    ])
  );
  const filings = await listFilings(fec, ids, cycle);
  const figures = await reportFigures(fec, ids, cycle);
  for (const r of unprocessedReports(filings, processed, figures, 'itemized')) {
    try {
      const parsed = parseRawFiling(await download(r.fileNumber, fetchImpl), r.fileNumber);
      if (!parsed.ok) {
        refused.push({ ...r, why: parsed.why });
        log(
          `  ${r.committeeId} raw report ${r.fileNumber} (${r.from} to ${r.to}) not used: ${parsed.why}`
        );
        continue;
      }
      await insertRows(bulk.conn, parsed.rows);
      const counted = parsed.rows.filter(x => x.counts).length;
      added.push({ ...r, records: counted, itemized: parsed.report.itemized });
      log(
        `  ${r.committeeId} raw report ${r.fileNumber} (${r.from} to ${r.to}): ${counted} records, $${parsed.report.itemized.toLocaleString('en-US')}`
      );
    } catch (error) {
      refused.push({ ...r, why: error.message });
      log(`  ${r.committeeId} raw report ${r.fileNumber}: download failed: ${error.message}`);
    }
  }
  return { added, refused };
}

// The committees' report filings this cycle, 20 committees a call
async function listFilings(fec, ids, cycle) {
  const filings = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    for (let page = 1; ; page++) {
      const d = await fec('/efile/filings/', {
        committee_id: chunk,
        form_type: REPORT_FORMS,
        min_receipt_date: `${cycle - 1}-01-01`,
        per_page: 100,
        page,
        sort: '-receipt_date',
      });
      filings.push(...(d.results || []));
      if (page >= (d.pagination?.pages || 1)) {
        break;
      }
    }
  }
  return filings;
}

/**
 * Each report's itemized donors (line 11(a)(i)) and PAC gifts (line 11(c))
 * from the FEC's report figures, which arrive within days of filing, by
 * committee and period (the key unprocessedReports uses). 100 committees a
 * call, campaign reports and PAC reports both asked for.
 */
export async function reportFigures(fec, ids, cycle) {
  const out = new Map();
  for (const path of ['/reports/house-senate/', '/reports/pac-party/']) {
    for (let i = 0; i < ids.length; i += 100) {
      for (let page = 1; ; page++) {
        const d = await fec(path, {
          committee_id: ids.slice(i, i + 100),
          cycle,
          is_amended: false,
          per_page: 100,
          page,
        });
        for (const r of d.results || []) {
          if (!r.coverage_start_date || !r.coverage_end_date) {
            continue;
          }
          const key = `${r.committee_id}|${r.coverage_start_date.slice(0, 10)}|${r.coverage_end_date.slice(0, 10)}`;
          const was = out.get(key) || { itemized: 0, pacs: 0 };
          const itemized = Number(r.individual_itemized_contributions_period) || 0;
          const pacs = Number(r.other_political_committee_contributions_period) || 0;
          out.set(key, {
            itemized: was.itemized || itemized,
            pacs: was.pacs || pacs,
          });
        }
        if (page >= (d.pagination?.pages || 1)) {
          break;
        }
      }
    }
  }
  return out;
}

async function download(fileNumber, fetchImpl) {
  const res = await fetchImpl(rawFilingUrl(fileNumber), {
    headers: { 'User-Agent': 'taskforce-purple-refresh' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}

/**
 * Every PAC gift to these committees as each committee itself reported it
 * (line 11c), for the cycle: the same reports the PAC totals come from, so
 * a member's list can't come to more than their PAC total (owner,
 * 2026-10-31: the PACs' own reports, which the list was built from before,
 * disagree with the campaigns'; Susan Collins's campaign reported $1.59M
 * from PACs and the PACs $2.56M). Reports the FEC has processed come from
 * its API (10 committees a call, the most it takes); the rest from the raw filings, each used
 * only when its PAC lines add up to its own line 11(c). Both report forms'
 * line 11(c) are asked for, whatever the committee is registered as: a
 * committee registered as a PAC can file campaign reports (Bonnie Watson
 * Coleman's, 2026-10-31, whose list was asked for on the wrong form and
 * came back nearly empty). One call per form: given two line numbers, the
 * FEC answers for the first only.
 * Returns the gifts by receiving committee, and the committees whose
 * gifts couldn't all be read (for those the caller keeps the PACs' side).
 */
export async function campaignPacGifts({
  fec,
  committeeIds,
  cycle,
  log = () => {},
  fetchImpl = fetch,
}) {
  const ids = [...new Set(committeeIds)].filter(id => /^C\d{8}$/.test(id));
  const byRecipient = new Map(ids.map(id => [id, []]));
  const missing = new Set();
  const processed = new Map();
  const stats = { processed: 0, raw: 0, reports: 0, unnamed: 0 };
  const keep = (recipient, g) => byRecipient.get(recipient)?.push(g);
  for (const line of ['F3-11C', 'F3X-11C']) {
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      try {
        await scheduleAPages(
          fec,
          {
            committee_id: chunk,
            two_year_transaction_period: cycle,
            line_number: line,
          },
          rows => {
            for (const r of rows) {
              const seen = processed.get(r.committee_id) || {
                files: new Set(),
                newest: null,
                dates: [],
              };
              seen.files.add(String(r.file_number));
              const date = String(r.contribution_receipt_date || '').slice(0, 10) || null;
              if (date && (!seen.newest || date > seen.newest)) {
                seen.newest = date;
              }
              if (date) {
                seen.dates.push(date);
              }
              processed.set(r.committee_id, seen);
              if (r.memo_code === 'X') {
                continue;
              }
              if (!/^C\d{8}$/.test(r.contributor_id || '')) {
                stats.unnamed++;
                continue;
              }
              stats.processed++;
              keep(r.committee_id, {
                giver: r.contributor_id,
                recipient: r.committee_id,
                amount: Math.round(Number(r.contribution_receipt_amount) * 100) / 100,
                date,
              });
            }
          }
        );
      } catch (error) {
        chunk.forEach(id => missing.add(id));
        log(
          `  PAC gifts for ${chunk.join(', ')}: ${error.message}; the PACs' own reports are used`
        );
      }
    }
  }
  const read = ids.filter(id => !missing.has(id));
  const reports = unprocessedReports(
    await listFilings(fec, read, cycle),
    processed,
    await reportFigures(fec, read, cycle),
    'pacs'
  );
  for (const r of reports) {
    try {
      const parsed = parseRawFiling(await download(r.fileNumber, fetchImpl), r.fileNumber);
      if (!parsed.pacs?.ok) {
        missing.add(r.committeeId);
        log(
          `  ${r.committeeId} raw report ${r.fileNumber} PAC gifts not used: ${parsed.pacs?.why || parsed.why}; the PACs' own reports are used`
        );
        continue;
      }
      stats.reports++;
      stats.raw += parsed.pacs.gifts.length;
      stats.unnamed += parsed.pacs.unnamed;
      parsed.pacs.gifts.forEach(g => keep(r.committeeId, g));
    } catch (error) {
      missing.add(r.committeeId);
      log(`  ${r.committeeId} raw report ${r.fileNumber}: download failed: ${error.message}`);
    }
  }
  log(
    `PAC gifts as the committees reported them: ${stats.processed} processed, ${stats.raw} from ${stats.reports} raw report(s), ${stats.unnamed} line(s) naming no FEC ID left out; ${missing.size} committee(s) kept on the PACs' own reports`
  );
  return { byRecipient, missing, stats };
}

/**
 * Leave out the records of a committee counted only from a date
 * (fec-crosswalk-additions.js COMMITTEE_SINCE) dated before it, from both
 * the bulk file's rows and the fetched ones.
 */
export async function dropBefore(bulk, committeeIds) {
  for (const id of committeeIds.filter(c => COMMITTEE_SINCE[c] && /^C\d{8}$/.test(c))) {
    for (const table of ['bulk', 'api']) {
      await bulk.conn.run(
        `DELETE FROM ${table} WHERE committee_id = '${id}' AND (date IS NULL OR date < '${COMMITTEE_SINCE[id].from}')`
      );
    }
  }
}
