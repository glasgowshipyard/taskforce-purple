#!/usr/bin/env node
/**
 * Stage 1 exit check (REBUILD_SPEC.md §10): the new storage serves exactly
 * what the old one did, for every member, from the same real data.
 *
 *   node scripts/verify/stage1-equivalence.mjs [--snapshot DIR] [--old-ref REF]
 *
 * Runs the OLD worker (git REF, default origin/main) and the NEW worker (the
 * working tree) against one snapshot of production KV, with no network:
 *   - /api/members: every new list entry equals the old served member on
 *     every list field; quicklook/conduitCount match what the old row derived
 *   - /api/member-detail: the new `member` equals the old served member
 *     exactly, and every other detail field is unchanged
 *   - /api/members/{id} and /api/status: unchanged (status's lastUpdated is
 *     deliberately different, #38)
 *   - re-grading: the new chunked re-grade leaves every member identical to
 *     the old full recalculation (ignoring its timestamp), and counts writes
 * Exits 1 on any difference.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildMigration } from '../migrations/2026-10-03-split-members.mjs';
import { LIST_FIELDS, memberKey, sameValue, servedMember } from '../../workers/member-store.js';
import { quicklookSectors } from '../../src/lib/donor-taxonomy.js';

const NAMESPACE = '8318226115e2423ab5d141adfa5419f9';
const REPO = resolve(new URL('../..', import.meta.url).pathname);
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024,
  });
}

function snapshot(dir) {
  if (existsSync(join(dir, 'kv.json'))) {
    return JSON.parse(readFileSync(join(dir, 'kv.json'), 'utf8'));
  }
  mkdirSync(dir, { recursive: true });
  const listed = JSON.parse(
    wrangler([
      'kv',
      'key',
      'list',
      `--namespace-id=${NAMESPACE}`,
      '--remote',
      '--prefix',
      'itemized_analysis_v2:',
    ]).replace(/^[^[]*/, '')
  ).map(k => k.name);
  const keys = [...listed, 'members:all', 'adaptive_thresholds', 'last_updated'];
  const kv = {};
  for (let i = 0; i < keys.length; i += 100) {
    const file = join(dir, `keys-${i}.json`);
    writeFileSync(file, JSON.stringify(keys.slice(i, i + 100)));
    const out = wrangler(['kv', 'bulk', 'get', file, `--namespace-id=${NAMESPACE}`, '--remote']);
    for (const [k, v] of Object.entries(
      JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
    )) {
      if (v !== null) {
        kv[k] = v;
      }
    }
  }
  writeFileSync(join(dir, 'kv.json'), JSON.stringify(kv));
  return kv;
}

function stubEnv(initial) {
  const store = new Map(Object.entries(initial));
  const stats = { put: 0, delete: 0, putKeys: [] };
  return {
    store,
    stats,
    env: {
      UPDATE_SECRET: 'test-secret',
      FEC_API_KEY: 'x',
      CONGRESS_API_KEY: 'x',
      MEMBER_DATA: {
        get: async k => store.get(k) ?? null,
        put: async (k, v) => {
          stats.put++;
          stats.putKeys.push(k);
          store.set(k, v);
        },
        delete: async k => {
          stats.delete++;
          store.delete(k);
        },
        list: async () => ({ keys: [...store.keys()].map(name => ({ name })) }),
      },
    },
  };
}

async function loadWorker(source, label) {
  const dir = mkdtempSync(join(tmpdir(), `tfp-${label}-`));
  const file = join(dir, `${label}-pipeline.mjs`);
  writeFileSync(
    file,
    source.replace(/from '\.\/([^']+)'/g, (_, p) => `from '${REPO}/workers/${p}'`)
  );
  return (await import(file)).default;
}

const call = async (worker, env, path, init) => {
  const res = await worker.fetch(new Request(`https://x${path}`, init), env);
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const strip = (m, keys) => Object.fromEntries(Object.entries(m).filter(([k]) => !keys.includes(k)));

async function main() {
  const snapDir = arg('--snapshot', join(tmpdir(), 'tfp-stage1-snapshot'));
  const oldRef = arg('--old-ref', 'origin/main');
  const kv = snapshot(snapDir);
  const members = JSON.parse(kv['members:all']);
  console.log(`snapshot: ${members.length} members, ${Object.keys(kv).length} keys (${snapDir})`);

  globalThis.fetch = async () => {
    throw new Error('network disabled in equivalence check');
  };
  const quiet = console.log;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  const out = (...a) => quiet(...a);

  const oldWorker = await loadWorker(
    execFileSync('git', ['show', `${oldRef}:workers/data-pipeline.js`], {
      cwd: REPO,
      encoding: 'utf8',
    }),
    'old'
  );
  const newWorker = await loadWorker(
    readFileSync(join(REPO, 'workers/data-pipeline.js'), 'utf8'),
    'new'
  );

  const migration = buildMigration(members, {
    adaptiveThresholds: JSON.parse(kv.adaptive_thresholds),
  });
  const migrated = { ...kv, [migration.list.key]: migration.list.value };
  for (const r of migration.records) {
    migrated[r.key] = r.value;
  }

  const problems = [];
  const problem = msg => problems.length < 25 && problems.push(msg);

  // /api/members
  const O = stubEnv(kv);
  const N = stubEnv(migrated);
  const t0 = process.cpuUsage();
  const oldMembers = await call(oldWorker, O.env, '/api/members');
  const t1 = process.cpuUsage(t0);
  const t2 = process.cpuUsage();
  const newMembers = await call(newWorker, N.env, '/api/members');
  const t3 = process.cpuUsage(t2);
  const oldBody = JSON.parse(oldMembers.text);
  const newBody = JSON.parse(newMembers.text);
  out(
    `/api/members: old ${oldMembers.text.length.toLocaleString()} bytes, ${((t1.user + t1.system) / 1000).toFixed(1)} ms CPU | new ${newMembers.text.length.toLocaleString()} bytes, ${((t3.user + t3.system) / 1000).toFixed(1)} ms CPU, served from ${newMembers.headers.get('X-TFP-Source')}`
  );
  if (newBody.total !== oldBody.total || newBody.members.length !== oldBody.members.length) {
    problem(`member count differs: ${oldBody.members.length} vs ${newBody.members.length}`);
  }
  if (!sameValue(newBody.adaptiveThresholds, oldBody.adaptiveThresholds)) {
    problem('adaptiveThresholds differ');
  }
  const newById = new Map(newBody.members.map(e => [e.bioguideId, e]));
  let listFieldChecks = 0;
  for (const old of oldBody.members) {
    const e = newById.get(old.bioguideId);
    if (!e) {
      problem(`${old.bioguideId} missing from new list`);
      continue;
    }
    for (const f of LIST_FIELDS) {
      listFieldChecks++;
      if (!sameValue(old[f], e[f])) {
        problem(
          `${old.bioguideId}.${f}: old ${JSON.stringify(old[f])} new ${JSON.stringify(e[f])}`
        );
      }
    }
    if (!sameValue(quicklookSectors(old), e.quicklook)) {
      problem(`${old.bioguideId}.quicklook differs`);
    }
    if ((old.topConduits?.length || 0) !== e.conduitCount) {
      problem(`${old.bioguideId}.conduitCount differs`);
    }
  }
  out(
    `  list fields compared: ${listFieldChecks.toLocaleString()} | old lastUpdated ${oldBody.lastUpdated} -> new ${newBody.lastUpdated} (#38, intended)`
  );

  // /api/member-detail and /api/members/{id}
  const oldServed = new Map(oldBody.members.map(m => [m.bioguideId, m]));
  let detailChecks = 0;
  for (const m of members) {
    const id = m.bioguideId;
    const od = JSON.parse(
      (await call(oldWorker, O.env, `/api/member-detail?bioguideId=${id}`)).text
    );
    const nd = JSON.parse(
      (await call(newWorker, N.env, `/api/member-detail?bioguideId=${id}`)).text
    );
    if (!sameValue(strip(nd, ['member']), od)) {
      problem(`${id}: member-detail fields other than .member differ`);
    }
    if (!sameValue(nd.member, oldServed.get(id))) {
      problem(`${id}: member-detail .member differs from the old served member`);
    }
    const os = JSON.parse((await call(oldWorker, O.env, `/api/members/${id}`)).text);
    const ns = JSON.parse((await call(newWorker, N.env, `/api/members/${id}`)).text);
    for (const [k, v] of Object.entries(os)) {
      if (!sameValue(v, ns[k])) {
        problem(`${id}: /api/members/{id}.${k} differs`);
      }
    }
    if (!sameValue(nd.member, servedMember(m))) {
      problem(`${id}: detail member is not servedMember(record)`);
    }
    detailChecks++;
  }
  out(`/api/member-detail and /api/members/{id}: ${detailChecks} members compared`);

  // /api/status
  const os = JSON.parse((await call(oldWorker, O.env, '/api/status')).text);
  const ns = JSON.parse((await call(newWorker, N.env, '/api/status')).text);
  if (!sameValue(strip(os, ['lastUpdated']), strip(ns, ['lastUpdated']))) {
    problem('/api/status differs (other than lastUpdated)');
  }
  out('/api/status: compared');

  // Re-grading: old full recalculation vs new chunked re-grade
  const OR = stubEnv(kv);
  const auth = { method: 'POST', headers: { Authorization: 'Bearer test-secret' } };
  const oldRecalc = await call(oldWorker, OR.env, '/api/recalculate-tiers', auth);
  const oldAfter = new Map(JSON.parse(OR.store.get('members:all')).map(m => [m.bioguideId, m]));
  const NR = stubEnv(migrated);
  let offset = 0;
  let chunks = 0;
  let changed = 0;
  let maxChunkMs = 0;
  while (offset !== null) {
    const c0 = process.cpuUsage();
    const r = JSON.parse(
      (await call(newWorker, NR.env, `/api/recalculate-tiers?offset=${offset}&limit=10`, auth)).text
    );
    const c = process.cpuUsage(c0);
    maxChunkMs = Math.max(maxChunkMs, (c.user + c.system) / 1000);
    if (!r.success) {
      problem(`new recalc failed at offset ${offset}: ${r.error}`);
      break;
    }
    changed += r.stats.changed;
    chunks++;
    offset = r.stats.nextOffset;
  }
  for (const [id, old] of oldAfter) {
    const neu = JSON.parse(NR.store.get(memberKey(id)));
    if (!sameValue(strip(old, ['lastTierRecalculated']), strip(neu, ['lastTierRecalculated']))) {
      problem(`${id}: re-grade result differs`);
    }
  }
  out(
    `re-grade: old = 1 call, ${OR.stats.put} KV write(s) of the whole list (status ${oldRecalc.status}) | new = ${chunks} calls of 10, ${NR.stats.put} KV writes, ${changed} members changed, slowest call ${maxChunkMs.toFixed(1)} ms CPU`
  );

  if (problems.length) {
    out(`\nFAIL: ${problems.length}${problems.length === 25 ? '+' : ''} differences`);
    problems.forEach(p => out(`  ${p}`));
    process.exit(1);
  }
  out('\nPASS: the new storage serves exactly what the old one did, for every member.');
}

main().catch(e => {
  console.error = console.error || (() => {});
  process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
