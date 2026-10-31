// Donor records from the FEC's raw electronic filings (owner, 2026-10-31:
// "we can't have stale data this close to the election"). The FEC posts each
// report as filed within minutes, but takes weeks to process its donor lines
// into the bulk file and the API's records. Until then the totals were
// current and the records weren't: after the October reports 184 grades
// fell back to the 0.40 allowance because the records held under half the
// big-donor money. A report not yet processed is now read from its raw file
// (one download, no API call), and its donor lines are used only when they
// add up, to the cent, to the itemized total on the report's own summary.

import { bulkDate } from './reconcile.mjs';

export const rawFilingUrl = fileNumber => `https://docquery.fec.gov/dcdev/posted/${fileNumber}.fec`;

// The campaign (F3) and PAC or joint fund (F3X) reports, new or amended. An
// amended report restates the whole report, so the newest filing for a
// period replaces the others
export const REPORT_FORMS = ['F3N', 'F3A', 'F3XN', 'F3XA'];

// Summary-line columns (FEC format 8.x): the coverage dates and line 11(a)(i),
// itemized contributions from individuals, for the period
const SUMMARY = {
  F3: { from: 15, to: 16, itemized: 32 },
  F3X: { from: 13, to: 14, itemized: 29 },
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
  const rows = lines
    .filter(l => l.startsWith(`SA11AI${SEPARATOR}`))
    .map(l => l.split(SEPARATOR).map(unquote));
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
  if (sum !== reported) {
    return {
      ok: false,
      why: `records add up to $${(sum / 100).toFixed(2)}, the report says $${(reported / 100).toFixed(2)}`,
      report,
      rows: [],
    };
  }
  return { ok: true, report, rows: records };
}

// Raw filings write dates YYYYMMDD; bulkDate takes the bulk file's MMDDYYYY
function reorder(yyyymmdd) {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(4, 8)}${yyyymmdd.slice(0, 4)}` : '';
}

/**
 * The reports whose records aren't processed yet: for each committee and
 * period, the newest filing, unless a filing for that period is already in
 * the processed records (`processed`: committee id -> { files: Set of file
 * numbers, newest: the latest record date }). A period that starts on or
 * before the newest processed record is left out too, so nothing can be
 * counted twice.
 */
export function unprocessedReports(filings, processed) {
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
  for (const list of periods.values()) {
    const seen = processed.get(list[0].committee_id) || { files: new Set(), newest: null };
    if (list.some(f => seen.files.has(String(f.file_number)))) {
      continue;
    }
    const start = list[0].coverage_start_date.slice(0, 10);
    if (seen.newest && start <= seen.newest) {
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
    SELECT committee_id, list(DISTINCT file_num) AS files, max(date) AS newest FROM (
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
      },
    ])
  );
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
  for (const r of unprocessedReports(filings, processed)) {
    try {
      const res = await fetchImpl(rawFilingUrl(r.fileNumber), {
        headers: { 'User-Agent': 'taskforce-purple-refresh' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const parsed = parseRawFiling(
        Buffer.from(await res.arrayBuffer()).toString('latin1'),
        r.fileNumber
      );
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
