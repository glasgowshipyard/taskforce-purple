#!/usr/bin/env node
/**
 * Part of the daily check (calendar.yml; owner, 2026-10-25): rebuild the
 * site when the FEC's outside-spending file has changed since the live site
 * was built, so the figures keep up in the weeks groups file every day.
 * One HEAD request to the FEC and one read of the live file; writes nothing.
 * Outputs for the workflow: due (true/false), stale (a message, or empty).
 *
 *   node scripts/site/outside-check.mjs [--dry-run]
 */
import { appendFileSync } from 'node:fs';
import { SITE } from './pages.mjs';
import { ieUrl, outsideRebuild } from './outside.mjs';

const dryRun = process.argv.includes('--dry-run');

// The live file, from the site and then from the Pages project's own
// address. Each failure says why (2026-10-30: from GitHub every read failed
// silently, so the check rebuilt the site every day and the stuck-figures
// alert could never fire)
const SOURCES = [SITE, 'https://taskforce-purple.pages.dev'];
async function readLive() {
  for (const base of SOURCES) {
    const url = `${base}/data/outside.json`;
    try {
      const r = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'taskforce-purple-daily-check' },
      });
      const type = r.headers.get('content-type') || '';
      if (r.ok && type.includes('json')) {
        return await r.json();
      }
      console.log(`::warning::${url}: HTTP ${r.status}, ${type || 'no content type'}`);
    } catch (error) {
      console.log(`::warning::${url}: ${error.cause?.code || error.message}`);
    }
  }
  return null;
}
const live = await readLive();
const cycle = live?.cycle || 2026;
const size = await fetch(ieUrl(cycle), { method: 'HEAD' })
  .then(r => (r.ok ? Number(r.headers.get('content-length')) || null : null))
  .catch(() => null);
const today = new Date().toISOString().slice(0, 10);
const { due, why, stale } = outsideRebuild({ live, size, today });

console.log(
  `Outside spending: ${why}${due ? ': rebuilding the site' : ''}${dryRun && due ? ' (dry run: not started)' : ''}`
);
if (stale) {
  console.log(`::warning::${stale}`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `due=${due && !dryRun}\nstale=${(stale || '').replace(/\n/g, ' ')}\n`
  );
}
