#!/usr/bin/env node
/**
 * Look at the records the refresh job fetched from the FEC for a committee
 * (stored Brotli-packed in D1 tfp-results `gap_packs`). Unpacks them to a
 * JSON-lines file you can query with DuckDB, plus a short summary.
 *
 *   node scripts/refresh/gap-records.mjs C00857615 [--cycle 2026] [--out file.jsonl]
 *   duckdb -c "SELECT memo_code, count(*) FROM read_json_auto('file.jsonl') GROUP BY 1"
 *
 * Read-only: one D1 query, a handful of rows.
 */
import { writeFileSync } from 'node:fs';
import { cycleForYear } from '../../workers/tier-calculation.js';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { loadStored } from './lib/gap-store.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const committeeId = process.argv[2];
if (!/^C\d{8}$/.test(committeeId || '')) {
  console.error(
    'usage: node scripts/refresh/gap-records.mjs C00000000 [--cycle 2026] [--out file]'
  );
  process.exit(1);
}
const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
const out = arg('--out', `${committeeId}-${cycle}.jsonl`);

const cf = createCloudflare();
const stored = await loadStored((sql, p) => cf.d1(RESULTS_DB, sql, p), committeeId, cycle);
const all = [
  ...stored.gap.map(r => ({ kind: 'gap', ...r })),
  ...stored.earmarked.map(r => ({ kind: 'earmarked', ...r })),
];
writeFileSync(out, all.map(r => JSON.stringify(r)).join('\n') + (all.length ? '\n' : ''));

const memo = all.filter(r => r.memo_code === 'X').length;
const dollars = all
  .filter(r => r.memo_code !== 'X')
  .reduce((s, r) => s + (Number(r.contribution_receipt_amount) || 0), 0);
console.log(
  `${committeeId} cycle ${cycle}: ${stored.gap.length} gap record(s), ${stored.earmarked.length} earmarked; ${memo} memo line(s); $${Math.round(dollars).toLocaleString()} in non-memo records`
);
console.log(`written to ${out}`);
