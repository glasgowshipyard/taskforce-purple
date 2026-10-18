#!/usr/bin/env node
/**
 * The filing-calendar check (#54, REBUILD_SPEC §8): the one daily job. One
 * FEC request for the reporting dates; if a deadline members file for passed
 * a few days ago and hasn't been refreshed for, it says so (the workflow then
 * starts the refresh) and marks the deadline handled. Otherwise it ends.
 *
 *   node scripts/refresh/calendar.mjs [--dry-run] [--today YYYY-MM-DD]
 *
 * Writes `due` (true/false) and `reason` to $GITHUB_OUTPUT. The deadlines
 * already handled are kept in D1 `calendar_marks` (one row per deadline,
 * read by primary key), created here if it doesn't exist yet.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { createFecClient } from './lib/fec.mjs';
import { dueDeadline, lookupWindow } from './lib/calendar.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const dryRun = process.argv.includes('--dry-run');
const today = arg('--today', new Date().toISOString().slice(0, 10));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const output = (name, value) =>
  process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);

// As the refresh job loads it: the environment, or locally API_KEYS.md
function fecKey() {
  if (process.env.FEC_API_KEY) {
    return process.env.FEC_API_KEY;
  }
  const local = new URL('../../API_KEYS.md', import.meta.url).pathname;
  return existsSync(local) ? readFileSync(local, 'utf8').match(/`([A-Za-z0-9]{40})`/)?.[1] : null;
}

const fec = createFecClient(fecKey());
const window = lookupWindow(today);
const answer = await fec('/reporting-dates/', { ...window, per_page: 100, sort: 'due_date' });
const dates = answer.results || [];
log(
  `calendar: ${dates.length} reporting date(s) due ${window.min_due_date} to ${window.max_due_date}`
);

const cf = createCloudflare();
const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);
if (!dryRun) {
  await d1(
    `CREATE TABLE IF NOT EXISTS calendar_marks (
       deadline TEXT PRIMARY KEY,  -- 'YYYY-MM-DD TYPE': a deadline refreshed for
       started_at TEXT NOT NULL
     )`
  );
}
// Only the deadlines in the window, each by primary key
const keys = [...new Set(dates.map(d => `${String(d.due_date).slice(0, 10)} ${d.report_type}`))];
let handled = new Set();
if (keys.length) {
  try {
    const rows = await d1(
      `SELECT deadline FROM calendar_marks WHERE deadline IN (${keys.map(() => '?').join(',')})`,
      keys
    );
    handled = new Set(rows.map(r => r.deadline));
  } catch (error) {
    // A dry run before the table exists: nothing handled yet
    if (!dryRun) {
      throw error;
    }
  }
}

const due = dueDeadline(dates, today, handled);
if (!due) {
  log('calendar: no deadline to refresh for today');
  output('due', 'false');
} else {
  log(`${due.reason}: a refresh is due`);
  if (!dryRun) {
    await d1(
      'INSERT INTO calendar_marks (deadline, started_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
      [due.key, new Date().toISOString()]
    );
  }
  output('due', String(!dryRun));
  output('reason', due.reason);
}
log(`calendar: ${fec.calls} FEC call(s), ${cf.stats.d1Queries} D1 quer(ies)`);
