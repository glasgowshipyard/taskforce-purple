#!/usr/bin/env node
/**
 * One-off repack of D1 tfp-results, after D1's daily write limit resets
 * (00:00 UTC 2026-10-07, 5 pm PDT 2026-10-06). Run on GitHub's machines by
 * .github/workflows/d1-repack.yml, or by hand:
 *
 *   node scripts/migrations/2026-10-06-repack.mjs
 *
 * tfp-results is full (D1's 500 MB). Nothing can be added until the old
 * gap_records table (117,450 uncompressed FEC records, 438 MB) is gone, and
 * its records can only be packed after that. So, stopping at the first
 * failure:
 *   1. On a throwaway database, check that DROP TABLE costs a handful of row
 *      writes, not one per row (D1's limit is 100,000 a day for the whole
 *      account), and that it frees the space.
 *   2. Read every record and pack it in memory (full records, Brotli; owner's
 *      choice), checking every record unpacks identical.
 *   3. Drop gap_records.
 *   4. Create gap_packs, write the packs, and read them back from D1 to check
 *      them byte for byte. A committee whose packs didn't save is marked for
 *      a fresh check, so its records are fetched from the FEC again; nothing
 *      is ever graded on missing records.
 *   5. Report; `restart=true` in GITHUB_OUTPUT when everything passed.
 * Safe to run twice: it stops if gap_records is already gone.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { RESULTS_DB, createCloudflare } from '../refresh/lib/cloudflare.mjs';
import { packRecords, unpackRecords } from '../refresh/lib/gap-store.mjs';

const cf = createCloudflare();
const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);
const report = [];
const say = line => {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
  report.push(line);
};
const output = (k, v) =>
  process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const finish = ok => {
  output('restart', ok ? 'true' : 'false');
  output('report', Buffer.from(report.join('\n')).toString('base64'));
  say(
    `D1 used by this repack: ${cf.stats.d1RowsWritten} rows written, ${cf.stats.d1RowsRead} read`
  );
  process.exit(ok ? 0 : 1);
};

const tables = new Set(
  (await d1("SELECT name FROM sqlite_master WHERE type = 'table'")).map(t => t.name)
);
if (!tables.has('gap_records')) {
  say(
    tables.has('gap_packs')
      ? 'Already done: gap_records is gone and gap_packs exists. Nothing to do.'
      : 'gap_records is gone but gap_packs is missing: stopping for a person to look.'
  );
  finish(false);
}

// 1. Does DROP TABLE cost a write per row, and does it free space?
const scratch = await cf.d1Create(`tfp-scratch-droptest-${Date.now()}`);
let dropCost;
let freed;
try {
  const q = (sql, p) => cf.d1WithMeta(scratch, sql, p);
  await q('CREATE TABLE t (sub_id TEXT PRIMARY KEY, committee_id TEXT, record TEXT)');
  await q('CREATE INDEX t_committee ON t (committee_id)');
  const filled = await q(
    `INSERT INTO t WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 2000)
     SELECT 's' || x, 'C' || (x % 20), hex(randomblob(1000)) FROM n`
  );
  const dropped = await q('DROP TABLE t');
  dropCost = dropped.meta.rows_written ?? null;
  freed = filled.meta.size_after - dropped.meta.size_after;
  say(
    `Drop test on a throwaway database: filling 2,000 rows wrote ${filled.meta.rows_written} rows (${(filled.meta.size_after / 1e6).toFixed(1)} MB); dropping the table wrote ${dropCost} rows and freed ${(freed / 1e6).toFixed(1)} MB.`
  );
} finally {
  await cf.d1Delete(scratch);
}
if (dropCost === null || dropCost > 100 || freed < 1e6) {
  say(
    'STOPPED before touching anything: dropping a table is not cheap and space-freeing on D1, so dropping gap_records could burn a day of the account’s writes or not free the space. Next option: move results into a fresh database instead (needs the API worker redeployed with its new binding).'
  );
  finish(false);
}

// 2. Pack every committee's records in memory, checking each one
const committees = await d1(
  'SELECT committee_id, cycle, COUNT(*) AS n FROM gap_records GROUP BY committee_id, cycle ORDER BY n DESC'
);
const packed = [];
let records = 0;
let before = 0;
let after = 0;
for (const c of committees) {
  const orig = { gap: [], earmarked: [] };
  const text = new Map();
  let last = 0;
  for (;;) {
    const rows = await d1(
      `SELECT rowid AS rid, sub_id, kind, record FROM gap_records
       WHERE committee_id = ? AND cycle = ? AND rowid > ? ORDER BY rowid LIMIT 1000`,
      [c.committee_id, c.cycle, last]
    );
    for (const r of rows) {
      orig[r.kind].push(JSON.parse(r.record));
      text.set(String(r.sub_id), r.record);
      before += r.record.length;
    }
    if (rows.length < 1000) {
      break;
    }
    last = rows[rows.length - 1].rid;
  }
  const packs = [];
  let unpacked = 0;
  for (const kind of ['gap', 'earmarked']) {
    const sorted = orig[kind].sort((a, b) => String(a.sub_id).localeCompare(String(b.sub_id)));
    for (const p of packRecords(sorted)) {
      for (const r of unpackRecords(p.data)) {
        if (text.get(String(r.sub_id)) !== JSON.stringify(r)) {
          say(
            `STOPPED before touching anything: ${c.committee_id} record ${r.sub_id} didn't pack identical.`
          );
          finish(false);
        }
        unpacked++;
      }
      after += p.data.length;
      packs.push({ kind, ...p });
    }
  }
  if (unpacked !== text.size) {
    say(
      `STOPPED before touching anything: ${c.committee_id} packed ${unpacked} of ${text.size} records.`
    );
    finish(false);
  }
  records += text.size;
  packed.push({ committeeId: c.committee_id, cycle: c.cycle, packs });
}
say(
  `Packed ${records.toLocaleString()} records from ${committees.length} committees in memory: ${(before / 1e6).toFixed(1)} MB as stored, ${(after / 1e6).toFixed(1)} MB packed; every record unpacks identical.`
);

// 3. Drop the old table
const drop = await cf.d1WithMeta(RESULTS_DB, 'DROP TABLE gap_records');
say(
  `Dropped gap_records: ${drop.meta.rows_written} rows written; the database is now ${(drop.meta.size_after / 1e6).toFixed(1)} MB.`
);

// 4. Write the packs and check them from D1
const schema = readFileSync(
  new URL('../refresh/migrations/2026-10-06-gap-packs.sql', import.meta.url),
  'utf8'
);
await d1(schema.slice(schema.indexOf('CREATE TABLE')));
const now = new Date().toISOString();
const failed = [];
for (const c of packed) {
  try {
    for (const p of c.packs) {
      await d1(
        `INSERT INTO gap_packs (committee_id, cycle, kind, pack, records, data, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [c.committeeId, c.cycle, p.kind, p.pack, p.records, p.data, now]
      );
    }
    const back = await d1(
      'SELECT kind, pack, data FROM gap_packs WHERE committee_id = ? AND cycle = ?',
      [c.committeeId, c.cycle]
    );
    const ok =
      back.length === c.packs.length &&
      c.packs.every(p =>
        back.some(b => b.kind === p.kind && b.pack === p.pack && b.data === p.data)
      );
    if (!ok) {
      throw new Error('read back differs');
    }
  } catch (error) {
    failed.push(c);
    say(`  ${c.committeeId}: packs not saved (${error.message})`);
  }
}
for (const c of failed) {
  // Its records will be fetched from the FEC again on the next check
  await d1(
    "UPDATE committees SET status = 'unchecked', note = 'records to fetch again (repack 2026-10-06)' WHERE committee_id = ? AND cycle = ?",
    [c.committeeId, c.cycle]
  );
}
const [{ n: packRows }] = await d1('SELECT COUNT(*) AS n FROM gap_packs');
const size = (await cf.d1WithMeta(RESULTS_DB, 'SELECT 1')).meta.size_after;
say(
  `Wrote ${packRows} pack rows for ${packed.length - failed.length} of ${packed.length} committees, each checked byte for byte from D1; the database is now ${(size / 1e6).toFixed(1)} MB of 500.${failed.length ? ` ${failed.length} committee(s) marked to fetch again.` : ''}`
);

// Charge this repack to the job's D1 ledger
const today = new Date().toISOString().slice(0, 10);
await d1(
  `INSERT INTO d1_write_budget (day, rows_written, rows_read) VALUES (?, ?, ?)
   ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written,
     rows_read = rows_read + excluded.rows_read`,
  [today, cf.stats.d1RowsWritten + 1, cf.stats.d1RowsRead]
);
finish(failed.length === 0);
