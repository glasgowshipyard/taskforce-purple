#!/usr/bin/env node
/**
 * The roster update (#53): keeps the site's member list in step with Congress.
 *
 *   node scripts/refresh/roster.mjs [--dry-run] [--allow-big]
 *
 * Reads the public roster (unitedstates/congress-legislators, the source of
 * the identity crosswalk) and the site's members:list, then:
 *   - a new member gets a record (member:{id}) and a list entry, ungraded
 *     until the refresh grades them on the campaign that won their seat;
 *   - a member who left is taken off the list (their record is kept, so an
 *     old link still works);
 *   - a member whose party or seat changed has it updated;
 *   - workers/fec-crosswalk.js is regenerated when the IDs changed.
 * Lean: KV writes only for members who changed, and one list write.
 * Refuses a roster that looks broken (lib/roster.mjs rosterRefusal).
 *
 * In GitHub Actions it writes `added`, `changed`, `removed` and
 * `crosswalk` to $GITHUB_OUTPUT for the workflow's next steps.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { LIST_KEY, listBody, listEntry, memberKey, sameValue } from '../../workers/member-store.js';
import { createCloudflare } from './lib/cloudflare.mjs';
import {
  LEGISLATORS_URL,
  crosswalkFile,
  newRecord,
  rosterChanges,
  rosterFrom,
  rosterRefusal,
} from './lib/roster.mjs';

const dryRun = process.argv.includes('--dry-run');
const allowBig = process.argv.includes('--allow-big');
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const output = (name, value) =>
  process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);

const res = await fetch(LEGISLATORS_URL);
if (!res.ok) {
  throw new Error(`roster: ${LEGISLATORS_URL} answered HTTP ${res.status}`);
}
const roster = rosterFrom(await res.json());
const cf = createCloudflare();
const list = JSON.parse((await cf.kvGet(LIST_KEY)) || 'null');
if (!list?.members?.length) {
  throw new Error('roster: members:list is missing; refusing to build a list from nothing');
}
const changes = rosterChanges(roster, list.members);
const refusal = rosterRefusal(roster, changes, { allowBig });
if (refusal) {
  throw new Error(`roster: not applied: ${refusal}`);
}
log(
  `roster: ${roster.size} legislators, ${list.members.length} on the site; ${changes.added.length} to add, ${changes.removed.length} to take off, ${changes.changed.length} changed`
);
for (const r of changes.added) {
  log(
    `  add ${r.bioguideId} ${r.name} (${r.chamber}, ${r.state}${r.district ? ` ${r.district}` : ''}, ${r.party}) FEC ${r.fecIds.join(' ') || 'none'}`
  );
}
for (const m of changes.removed) {
  log(`  take off ${m.bioguideId} ${m.name} (${m.chamber}, ${m.state})`);
}
for (const c of changes.changed) {
  log(
    `  change ${c.id} ${c.name}: ${Object.entries(c.fields)
      .map(([f, [was, now]]) => `${f} ${was} -> ${now}`)
      .join(', ')}`
  );
}

// The identity crosswalk: rewritten only when the IDs themselves changed
const mapping = Object.fromEntries([...roster.values()].map(r => [r.bioguideId, r.fecIds]));
const crosswalkChanged = !sameValue(mapping, FEC_CROSSWALK);
if (crosswalkChanged) {
  const path = new URL('../../workers/fec-crosswalk.js', import.meta.url).pathname;
  if (!dryRun) {
    writeFileSync(path, crosswalkFile(roster, { generated: new Date().toISOString() }));
    execFileSync('npx', ['prettier', '--write', path], { stdio: 'ignore' });
  }
  log(`crosswalk: ${dryRun ? 'would be' : ''} regenerated`);
}

const nothing = !changes.added.length && !changes.removed.length && !changes.changed.length;
if (!dryRun && !nothing) {
  const now = new Date().toISOString();
  const patches = new Map();
  for (const r of changes.added) {
    const record = newRecord(r, now);
    await cf.kvPut(memberKey(r.bioguideId), JSON.stringify(record));
    patches.set(r.bioguideId, listEntry(record));
  }
  for (const c of changes.changed) {
    const record = JSON.parse((await cf.kvGet(memberKey(c.id))) || 'null');
    const update = Object.fromEntries(Object.entries(c.fields).map(([f, [, now2]]) => [f, now2]));
    if (record) {
      await cf.kvPut(memberKey(c.id), JSON.stringify({ ...record, ...update }));
    }
    const entry = list.members.find(m => m.bioguideId === c.id);
    patches.set(c.id, { ...entry, ...update });
  }
  const gone = new Set(changes.removed.map(m => m.bioguideId));
  const entries = [
    ...list.members.filter(m => !gone.has(m.bioguideId)).map(m => patches.get(m.bioguideId) || m),
    ...changes.added.map(r => patches.get(r.bioguideId)),
  ];
  await cf.kvPut(
    LIST_KEY,
    JSON.stringify(
      listBody(entries, { lastUpdated: now, adaptiveThresholds: list.adaptiveThresholds })
    )
  );
  log(`written: ${cf.stats.kvWrites} KV write(s); the list has ${entries.length} members`);
}

output('added', changes.added.map(r => r.bioguideId).join(','));
output('changed', changes.changed.map(c => c.id).join(','));
output('removed', changes.removed.map(m => m.bioguideId).join(','));
output('crosswalk', String(crosswalkChanged && !dryRun));
