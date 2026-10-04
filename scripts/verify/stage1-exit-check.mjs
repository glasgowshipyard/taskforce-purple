#!/usr/bin/env node
/**
 * Stage 1 exit check (REBUILD_SPEC.md §10): read Cloudflare's own analytics
 * for the API worker and KV since the migration, and compare them with the
 * exit criteria. Read-only.
 *
 *   node scripts/verify/stage1-exit-check.mjs [--since 2026-10-04T01:05:00Z]
 *
 * Criteria:
 *   1. zero `exceededResources` (CPU-limit kills) on taskforce-purple-api
 *   2. KV writes per day below the pre-pause baseline (290-500 a day,
 *      14-27 Sept 2026)
 * Also reports CPU p50/p99 and request counts, for the record.
 * Uses the wrangler login on this machine (`npx wrangler login`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = 'a4bc6c41d0c4b6b1bb25dcacf9d4d55f';
const SCRIPT = 'taskforce-purple-api';
const BASELINE_KV_WRITES = { min: 290, max: 500 };
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

function token() {
  // Any wrangler command refreshes the OAuth token if it has expired
  execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' });
  const cfg = readFileSync(
    join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    'utf8'
  );
  const t = cfg.match(/^oauth_token = "([^"]+)"/m)?.[1];
  if (!t) {
    throw new Error('No wrangler login found (run: npx wrangler login)');
  }
  return t;
}

function graphql(tok, query, variables) {
  const out = execFileSync(
    'curl',
    [
      '-s',
      'https://api.cloudflare.com/client/v4/graphql',
      '-H',
      `Authorization: Bearer ${tok}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ query, variables }),
    ],
    { encoding: 'utf8' }
  );
  const json = JSON.parse(out);
  if (json.errors?.length) {
    throw new Error(`Cloudflare analytics: ${json.errors[0].message}`);
  }
  return json.data.viewer.accounts[0];
}

const fmtPacific = iso =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function main() {
  const since = arg('--since', '2026-10-04T01:05:00Z');
  const until = new Date().toISOString();
  const hours = (Date.parse(until) - Date.parse(since)) / 3.6e6;
  const tok = token();

  const inv = graphql(
    tok,
    `
      query ($a: String!, $s: Time!, $e: Time!, $w: String!) {
        viewer {
          accounts(filter: { accountTag: $a }) {
            workersInvocationsAdaptive(
              limit: 1000
              filter: { scriptName: $w, datetime_geq: $s, datetime_leq: $e }
            ) {
              sum {
                requests
                errors
              }
              quantiles {
                cpuTimeP50
                cpuTimeP99
              }
              dimensions {
                status
              }
            }
          }
        }
      }
    `,
    { a: ACCOUNT, s: since, e: until, w: SCRIPT }
  ).workersInvocationsAdaptive;
  const byStatus = {};
  let p50 = 0;
  let p99 = 0;
  for (const g of inv) {
    byStatus[g.dimensions.status] = (byStatus[g.dimensions.status] || 0) + g.sum.requests;
    if (g.dimensions.status === 'success') {
      p50 = Math.max(p50, g.quantiles.cpuTimeP50 / 1000);
      p99 = Math.max(p99, g.quantiles.cpuTimeP99 / 1000);
    }
  }
  const killed = byStatus.exceededResources || 0;

  const kv = graphql(
    tok,
    `
      query ($a: String!, $s: Date!, $e: Date!) {
        viewer {
          accounts(filter: { accountTag: $a }) {
            kvOperationsAdaptiveGroups(limit: 1000, filter: { date_geq: $s, date_leq: $e }) {
              sum {
                requests
              }
              dimensions {
                date
                actionType
              }
            }
          }
        }
      }
    `,
    { a: ACCOUNT, s: since.slice(0, 10), e: until.slice(0, 10) }
  ).kvOperationsAdaptiveGroups;
  const days = {};
  for (const g of kv) {
    const d = (days[g.dimensions.date] ||= {});
    d[g.dimensions.actionType] = (d[g.dimensions.actionType] || 0) + g.sum.requests;
  }
  // The migration day itself carries its ~540 one-off writes; judge the
  // days after it
  const migrationDay = since.slice(0, 10);
  const judged = Object.entries(days).filter(([d]) => d !== migrationDay);
  const maxWrites = judged.length ? Math.max(...judged.map(([, v]) => v.write || 0)) : null;

  const pass1 = killed === 0;
  const pass2 = maxWrites !== null && maxWrites < BASELINE_KV_WRITES.min;
  console.log(
    `Stage 1 exit check: ${fmtPacific(since)} to ${fmtPacific(until)} Pacific (${hours.toFixed(1)} h)`
  );
  console.log(`\nAPI worker (${SCRIPT}): ${JSON.stringify(byStatus)}`);
  console.log(
    `  CPU of successful requests: p50 up to ${p50.toFixed(1)} ms, p99 up to ${p99.toFixed(1)} ms`
  );
  console.log(`  1. CPU-limit kills (exceededResources): ${killed} -> ${pass1 ? 'PASS' : 'FAIL'}`);
  console.log('\nKV operations per UTC day:');
  for (const [d, v] of Object.entries(days).sort()) {
    console.log(`  ${d}${d === migrationDay ? ' (migration day)' : ''}: ${JSON.stringify(v)}`);
  }
  console.log(
    `  2. KV writes/day after the migration day: max ${maxWrites ?? 'n/a'} vs pre-pause ${BASELINE_KV_WRITES.min}-${BASELINE_KV_WRITES.max} -> ${pass2 ? 'PASS' : maxWrites === null ? 'NOT YET (no full day after migration)' : 'FAIL'}`
  );
  if (hours < 48) {
    console.log(`\nNote: only ${hours.toFixed(1)} h have passed; the criterion is 48 h.`);
  }
  console.log(
    `\nOverall: ${pass1 && pass2 && hours >= 48 ? 'STAGE 1 EXIT CRITERIA MET' : 'NOT MET YET'}`
  );
}

main();
