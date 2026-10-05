#!/usr/bin/env node
/**
 * Publish the refresh job's grades to the site by hand (the job also does it
 * at the end of every run). One KV write, only if the list changes.
 *
 *   node scripts/refresh/publish.mjs [--cycle 2026] [--dry-run]
 */
import { cycleForYear } from '../../workers/tier-calculation.js';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { publishGrades } from './lib/publish.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

const cf = createCloudflare();
const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
const dryRun = process.argv.includes('--dry-run');
const r = await publishGrades({
  cf,
  d1: (sql, params) => cf.d1(RESULTS_DB, sql, params),
  cycle,
  dryRun,
  log: console.log,
});
for (const c of r.gradeChanges) {
  console.log(`  ${c.name}: ${c.from} -> ${c.to}`);
}
