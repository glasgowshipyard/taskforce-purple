#!/usr/bin/env node
/**
 * Stage 1 migration (REBUILD_SPEC.md §7): split the single `members:all` KV
 * value into one `member:{bioguideId}` key per member plus `members:list`
 * (the stored `/api/members` body).
 *
 *   node scripts/migrations/2026-10-03-split-members.mjs           # dry run
 *   node scripts/migrations/2026-10-03-split-members.mjs --apply   # write
 *
 * - `members:all` is read, never modified: it stays as the rollback copy.
 * - Each member key is written only if it doesn't already hold the same
 *   record, so re-running costs nothing for members already done.
 * - Before writing, it checks today's KV writes (Cloudflare analytics) and
 *   refuses if the run would take the day past 900 of the 1,000 allowed.
 * - The list's `lastUpdated` is when the data actually last changed (the
 *   newest member `lastUpdated`), not the frozen `last_updated` key (#38).
 *
 * Needs `npx wrangler login`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  LEGACY_KEY,
  LIST_KEY,
  listBody,
  listEntry,
  memberKey,
  sameValue,
} from '../../workers/member-store.js';

const NAMESPACE = '8318226115e2423ab5d141adfa5419f9';
const ACCOUNT = 'a4bc6c41d0c4b6b1bb25dcacf9d4d55f';
const DAILY_WRITE_CEILING = 900;

/** Pure: what the migration writes for a given members:all snapshot. */
export function buildMigration(members, { adaptiveThresholds }) {
  const records = members.map(m => ({ key: memberKey(m.bioguideId), value: JSON.stringify(m) }));
  const newest = members
    .map(m => m.lastUpdated)
    .filter(Boolean)
    .sort()
    .pop();
  const body = listBody(members.map(listEntry), {
    lastUpdated: newest ?? null,
    adaptiveThresholds,
  });
  return { records, list: { key: LIST_KEY, value: JSON.stringify(body) } };
}

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}
const kvGet = key => {
  try {
    return wrangler(['kv', 'key', 'get', key, `--namespace-id=${NAMESPACE}`, '--remote']);
  } catch {
    return null;
  }
};

function kvWritesToday() {
  const cfg = readFileSync(
    join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    'utf8'
  );
  const token = cfg.match(/^oauth_token = "([^"]+)"/m)?.[1];
  const day = new Date().toISOString().slice(0, 10);
  const query = {
    query: `query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){kvOperationsAdaptiveGroups(limit:100,filter:{date:$d}){sum{requests} dimensions{actionType}}}}}`,
    variables: { a: ACCOUNT, d: day },
  };
  const out = execFileSync(
    'curl',
    [
      '-s',
      'https://api.cloudflare.com/client/v4/graphql',
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(query),
    ],
    { encoding: 'utf8' }
  );
  const groups = JSON.parse(out).data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups;
  if (!groups) {
    throw new Error(`Could not read today's KV usage: ${out.slice(0, 200)}`);
  }
  return groups
    .filter(g => g.dimensions.actionType === 'write')
    .reduce((s, g) => s + g.sum.requests, 0);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const raw = kvGet(LEGACY_KEY);
  if (!raw) {
    throw new Error('members:all not found');
  }
  const members = JSON.parse(raw);
  const thresholds = kvGet('adaptive_thresholds');
  const adaptiveThresholds = thresholds ? JSON.parse(thresholds) : null;
  const { records, list } = buildMigration(members, { adaptiveThresholds });

  // Skip members whose key already holds the same record (safe re-runs).
  // One key listing, then existing keys fetched 100 at a time.
  const listed = JSON.parse(
    wrangler([
      'kv',
      'key',
      'list',
      `--namespace-id=${NAMESPACE}`,
      '--remote',
      '--prefix',
      'member:',
    ]).replace(/^[^[]*/, '')
  ).map(k => k.name);
  const existing = new Map();
  for (let i = 0; i < listed.length; i += 100) {
    const dir = mkdtempSync(join(tmpdir(), 'tfp-get-'));
    const file = join(dir, 'keys.json');
    writeFileSync(file, JSON.stringify(listed.slice(i, i + 100)));
    const out = wrangler(['kv', 'bulk', 'get', file, `--namespace-id=${NAMESPACE}`, '--remote']);
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
    for (const [k, v] of Object.entries(JSON.parse(json))) {
      existing.set(k, v);
    }
  }
  const todo = records.filter(
    r => !existing.has(r.key) || !sameValue(JSON.parse(existing.get(r.key)), JSON.parse(r.value))
  );
  const existingList = kvGet(LIST_KEY);
  const listNeeded = !existingList || !sameValue(JSON.parse(existingList), JSON.parse(list.value));
  const writes = todo.length + (listNeeded ? 1 : 0);
  const body = JSON.parse(list.value);
  console.log(
    `members: ${members.length} | member keys to write: ${todo.length} | list: ${listNeeded ? 'write' : 'unchanged'}`
  );
  console.log(
    `list size: ${list.value.length.toLocaleString()} bytes (members:all is ${raw.length.toLocaleString()})`
  );
  console.log(
    `list lastUpdated: ${body.lastUpdated} | adaptiveThresholds: ${JSON.stringify(body.adaptiveThresholds)}`
  );

  if (!apply) {
    console.log('Dry run: nothing written. Re-run with --apply.');
    return;
  }
  const used = kvWritesToday();
  console.log(`KV writes so far today (UTC): ${used}; this run needs ${writes}`);
  if (used + writes > DAILY_WRITE_CEILING) {
    throw new Error(
      `Refusing: ${used} + ${writes} would pass ${DAILY_WRITE_CEILING} of the 1,000 daily KV writes. Run after 00:00 UTC.`
    );
  }
  if (todo.length > 0) {
    // Members first; the list last, so the site never serves a list whose
    // members can't be opened
    const dir = mkdtempSync(join(tmpdir(), 'tfp-split-'));
    const file = join(dir, 'members.json');
    writeFileSync(file, JSON.stringify(todo));
    wrangler(['kv', 'bulk', 'put', file, `--namespace-id=${NAMESPACE}`, '--remote']);
    console.log(`wrote ${todo.length} member keys`);
  }
  if (listNeeded) {
    const dir = mkdtempSync(join(tmpdir(), 'tfp-list-'));
    const file = join(dir, 'list.json');
    writeFileSync(file, JSON.stringify([list]));
    wrangler(['kv', 'bulk', 'put', file, `--namespace-id=${NAMESPACE}`, '--remote']);
    console.log('wrote members:list');
  }
  console.log('Done. members:all was not modified (rollback copy).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
