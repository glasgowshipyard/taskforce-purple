#!/usr/bin/env node
/**
 * D1 usage by database and day, from Cloudflare's own analytics. D1's free
 * limits are per ACCOUNT per day (UTC): 5,000,000 rows read and 100,000
 * written, shared by every project on it. Over either, D1 refuses that kind
 * of query on every database until midnight UTC (5 pm PDT).
 *
 *   node scripts/verify/d1-usage.mjs [days]      # default: today and yesterday
 *
 * Read-only; uses your wrangler login.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ACCOUNT = 'a4bc6c41d0c4b6b1bb25dcacf9d4d55f';
const NAMES = {
  'f4ad9245-769d-4bb2-b772-c552907e1692': 'tfp-results',
  '87d24fba-1e43-45a0-aa84-1610e984aee8': 'taskforce-purple-donors (legacy)',
};

// Any wrangler command refreshes the OAuth token if it has expired
execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' });
let token;
for (const p of [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
]) {
  try {
    token = readFileSync(p, 'utf8').match(/^oauth_token = "([^"]+)"/m)?.[1];
  } catch {
    // try the next location
  }
  if (token) {
    break;
  }
}
if (!token) {
  throw new Error('No wrangler login found: run npx wrangler login');
}

const days = Number(process.argv[2] || 2);
const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
const query = `query($a: string!, $d: Date!) { viewer { accounts(filter: { accountTag: $a }) {
  d1AnalyticsAdaptiveGroups(limit: 200, filter: { date_geq: $d }) {
    sum { readQueries writeQueries rowsRead rowsWritten } dimensions { databaseId date } } } } }`;
const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { a: ACCOUNT, d: since } }),
});
const body = await res.json();
if (body.errors) {
  throw new Error(JSON.stringify(body.errors));
}
const groups = body.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups;
const byDay = new Map();
for (const g of groups) {
  byDay.set(g.dimensions.date, [...(byDay.get(g.dimensions.date) || []), g]);
}
for (const [day, list] of [...byDay].sort()) {
  const read = list.reduce((s, g) => s + g.sum.rowsRead, 0);
  const written = list.reduce((s, g) => s + g.sum.rowsWritten, 0);
  console.log(
    `${day} (UTC): ${read.toLocaleString()} rows read of 5,000,000; ${written.toLocaleString()} written of 100,000`
  );
  for (const g of list.sort((a, b) => b.sum.rowsRead - a.sum.rowsRead)) {
    console.log(
      `  ${NAMES[g.dimensions.databaseId] || g.dimensions.databaseId}: ${g.sum.rowsRead.toLocaleString()} read (${g.sum.readQueries} queries), ${g.sum.rowsWritten.toLocaleString()} written`
    );
  }
}
