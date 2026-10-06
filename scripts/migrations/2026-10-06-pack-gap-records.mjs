#!/usr/bin/env node
/**
 * One-off (2026-10-06): move the records in D1 tfp-results `gap_records`
 * (one uncompressed row each, 438 MB, which filled D1's 500 MB) into
 * `gap_packs` (full records, Brotli-packed per committee, about 6 MB).
 * Owner's choice: keep full records, compressed.
 *
 *   node scripts/migrations/2026-10-06-pack-gap-records.mjs           # dry run: pack and verify in memory
 *   node scripts/migrations/2026-10-06-pack-gap-records.mjs --apply   # write packs, then verify from D1
 *   node scripts/migrations/2026-10-06-pack-gap-records.mjs --drop    # re-verify every committee from D1, then drop gap_records
 *
 * Verification: every committee's unpacked records must equal the originals
 * exactly (same record IDs, and each record's JSON identical to what was
 * stored). --drop refuses unless every committee verifies in that same run.
 * Needs the gap_packs table (migrations/2026-10-06-gap-packs.sql).
 */
import { RESULTS_DB, createCloudflare } from '../refresh/lib/cloudflare.mjs';
import { loadStored, packRecords, saveStored, unpackRecords } from '../refresh/lib/gap-store.mjs';

const apply = process.argv.includes('--apply');
const drop = process.argv.includes('--drop');
const cf = createCloudflare();
const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// A committee's original records, paged by rowid along the committee index
async function originals(committeeId, cycle) {
  const out = { gap: [], earmarked: [] };
  const text = new Map();
  let after = 0;
  for (;;) {
    const rows = await d1(
      `SELECT rowid AS rid, sub_id, kind, record FROM gap_records
       WHERE committee_id = ? AND cycle = ? AND rowid > ? ORDER BY rowid LIMIT 1000`,
      [committeeId, cycle, after]
    );
    for (const r of rows) {
      out[r.kind].push(JSON.parse(r.record));
      text.set(String(r.sub_id), r.record);
    }
    if (rows.length < 1000) {
      return { ...out, text };
    }
    after = rows[rows.length - 1].rid;
  }
}

// Same record IDs, and each record's JSON exactly as originally stored
function matches(orig, packed) {
  const all = [...packed.gap, ...packed.earmarked];
  if (all.length !== orig.text.size) {
    return `count ${all.length} vs ${orig.text.size}`;
  }
  for (const r of all) {
    if (orig.text.get(String(r.sub_id)) !== JSON.stringify(r)) {
      return `record ${r.sub_id} differs`;
    }
  }
  return null;
}

const committees = await d1(
  'SELECT committee_id, cycle, COUNT(*) AS n FROM gap_records GROUP BY committee_id, cycle ORDER BY n DESC'
);
log(
  `${committees.length} committees, ${committees.reduce((s, c) => s + c.n, 0)} records in gap_records`
);

let bad = 0;
let records = 0;
let before = 0;
let after = 0;
let written = 0;
for (const c of committees) {
  const orig = await originals(c.committee_id, c.cycle);
  records += orig.text.size;
  before += [...orig.text.values()].reduce((s, t) => s + t.length, 0);
  let problem;
  if (drop || apply) {
    if (apply) {
      written += await saveStored(d1, c.committee_id, c.cycle, orig);
    }
    // Verify what D1 now holds
    problem = matches(orig, await loadStored(d1, c.committee_id, c.cycle));
  } else {
    // Dry run: pack and unpack in memory, as saveStored would
    const packed = { gap: [], earmarked: [] };
    for (const kind of ['gap', 'earmarked']) {
      const sorted = [...orig[kind]].sort((a, b) =>
        String(a.sub_id).localeCompare(String(b.sub_id))
      );
      for (const p of packRecords(sorted)) {
        after += p.data.length;
        packed[kind].push(...unpackRecords(p.data));
      }
    }
    problem = matches(orig, packed);
  }
  if (problem) {
    bad++;
    log(`  ${c.committee_id}: MISMATCH (${problem})`);
  }
}
log(
  `${records} records in ${committees.length} committees: ${(before / 1e6).toFixed(1)} MB as stored${
    after ? `, ${(after / 1e6).toFixed(1)} MB packed` : ''
  }; ${bad} committee(s) failed verification${apply ? `; ${written} pack row(s) written` : ''}`
);
log(`D1: ${cf.stats.d1RowsRead} rows read, ${cf.stats.d1RowsWritten} written`);

if (drop) {
  if (bad || !committees.length) {
    log('NOT dropping gap_records: verification failed (or nothing to verify)');
    process.exit(1);
  }
  await d1('DROP TABLE gap_records');
  log(`dropped gap_records; D1 rows written by the drop counted above: ${cf.stats.d1RowsWritten}`);
}
if (bad) {
  process.exit(1);
}
