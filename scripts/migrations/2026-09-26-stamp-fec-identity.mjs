#!/usr/bin/env node
/**
 * ONE-OFF MIGRATION (issue #41): stamp every member's FEC identity, and strip
 * other people's money from the public record.
 *
 * The data pipeline now resolves FEC identity from the congress-legislators
 * crosswalk and the scorer refuses to grade a member unless
 * `fecIdentityVerified === true`. Existing records predate the stamp, so this
 * sets it from each member's cached FEC mapping:
 *
 *   mapping's candidate ID is one of the member's crosswalk IDs -> verified
 *   anything else (another person, or no mapping)               -> unverified
 *
 * For UNVERIFIED members with money on file, the figures and every analysis
 * field merged onto the card came from someone else's committee. They are
 * nulled - not merely hidden in the UI - because /api/members is public. The
 * member is marked UNVERIFIED and put at the front of the phase-1 queue so
 * the pipeline refetches them under their correct identity.
 *
 * For every member, analysis fields merged from a committee other than the
 * one on their record are cleared as well.
 *
 * MUST RUN BEFORE deploying the fail-closed scorer: every cron run
 * recalculates tiers, and an unstamped record is treated as unverified.
 * Run just after a cron tick (:00/:20/:40 UTC) - the pipeline read-modify-
 * writes members:all, and the script aborts if it detects a concurrent write.
 *
 *   node scripts/migrations/2026-09-26-stamp-fec-identity.mjs          # dry run
 *   node scripts/migrations/2026-09-26-stamp-fec-identity.mjs --apply  # write
 *
 * Costs: 2 KV writes (members:all, phase-1 queue). Reads: ~12 bulk calls.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';

const NS = '8318226115e2423ab5d141adfa5419f9';
const APPLY = process.argv.includes('--apply');
const dir = mkdtempSync(join(tmpdir(), 'tfp-migrate-'));

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
}
const kvGet = key => wrangler(['kv', 'key', 'get', key, `--namespace-id=${NS}`, '--remote']);
function kvPut(key, value) {
  const f = join(dir, `${key.replace(/[^a-z0-9]/gi, '_')}.json`);
  writeFileSync(f, value);
  wrangler(['kv', 'key', 'put', key, `--path=${f}`, `--namespace-id=${NS}`, '--remote']);
}
function kvBulkGet(keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += 100) {
    const f = join(dir, `bulk${i}.json`);
    writeFileSync(f, JSON.stringify(keys.slice(i, i + 100)));
    const raw = wrangler(['kv', 'bulk', 'get', f, `--namespace-id=${NS}`, '--remote']);
    // wrangler may print notices after the JSON; take the first object only
    const start = raw.indexOf('{');
    let depth = 0;
    let inString = false;
    let end = start;
    for (; end < raw.length; end++) {
      const ch = raw[end];
      if (inString) {
        if (ch === '\\') end++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    Object.assign(out, JSON.parse(raw.slice(start, end + 1)));
  }
  return out;
}

const ANALYSIS_FIELDS = [
  'nakamotoCoefficient',
  'uniqueDonors',
  'top10Concentration',
  'nakamotoPercent',
  'topConduits',
  'earmarkedIndividualTotal',
  'faraFirms',
  'faraEmployerTotal',
];
const MONEY_FIELDS = {
  totalRaised: 0,
  grassrootsDonations: 0,
  grassrootsPercent: 0,
  largeDonorDonations: null,
  pacMoney: 0,
  partyMoney: 0,
  individualFundingPercent: null,
  pacContributions: [],
  committeeInfo: null,
  committeeId: null,
  committeeName: null,
};

console.log(APPLY ? '*** APPLY MODE - will write ***' : 'Dry run (pass --apply to write)');
const originalRaw = kvGet('members:all');
const members = JSON.parse(originalRaw);
const ids = members.map(m => m.bioguideId);
const mappings = kvBulkGet(ids.map(id => `fec_mapping_${id}`));
const analyses = kvBulkGet(ids.map(id => `itemized_analysis_v2:${id}`));
const queue = JSON.parse(kvGet('processing_queue_phase1') || '[]');
console.log(
  `members ${members.length} | mappings read ${Object.values(mappings).filter(Boolean).length} | analyses read ${Object.values(analyses).filter(Boolean).length} | phase-1 queue ${queue.length}`
);

const stats = { verified: 0, unverified: 0, stripped: 0, analysisCleared: 0 };
const requeue = [];

for (const m of members) {
  const raw = mappings[`fec_mapping_${m.bioguideId}`];
  const mapping = raw ? JSON.parse(raw) : null;
  const crosswalkIds = FEC_CROSSWALK[m.bioguideId] || [];
  const verified = Boolean(mapping && crosswalkIds.includes(mapping.candidate_id));

  m.fecCandidateId = mapping?.candidate_id ?? null;
  m.fecIdentityVerified = verified;
  stats[verified ? 'verified' : 'unverified']++;

  if (!verified && (m.totalRaised || 0) > 0) {
    console.log(
      `  strip ${m.name.padEnd(28)} ${String(m.tier).padEnd(4)} was ${mapping?.candidate_id ?? '(none)'} ${mapping?.candidate_name ?? ''}`
    );
    Object.assign(m, structuredClone(MONEY_FIELDS));
    for (const f of ANALYSIS_FIELDS) m[f] = null;
    m.tier = 'UNVERIFIED';
    m.fecLookupExhausted = null;
    stats.stripped++;
    requeue.push({
      bioguideId: m.bioguideId,
      name: m.name,
      state: m.state,
      district: m.district,
      party: m.party,
    });
    continue;
  }

  // Unverified with no money: nothing to strip, but still needs a refetch
  if (!verified && crosswalkIds.length > 0) {
    m.fecLookupExhausted = null;
    requeue.push({
      bioguideId: m.bioguideId,
      name: m.name,
      state: m.state,
      district: m.district,
      party: m.party,
    });
  }

  // Analysis fields merged from a committee that is not the member's
  const araw = analyses[`itemized_analysis_v2:${m.bioguideId}`];
  const acid = araw ? JSON.parse(araw).committeeId : null;
  if (
    (!verified || (acid && acid !== m.committeeInfo?.id)) &&
    ANALYSIS_FIELDS.some(f => m[f] != null)
  ) {
    console.log(
      `  clear analysis ${m.name.padEnd(28)} analysis ${acid} vs member ${m.committeeInfo?.id}${verified ? '' : ' (unverified)'}`
    );
    for (const f of ANALYSIS_FIELDS) m[f] = null;
    stats.analysisCleared++;
  }
}

const requeueIds = new Set(requeue.map(r => r.bioguideId));
const newQueue = [...requeue, ...queue.filter(q => !requeueIds.has(q.bioguideId))];

console.log(stats, `| requeue ${requeue.length} | phase-1 queue ${queue.length} -> ${newQueue.length}`);

if (!APPLY) {
  console.log('Dry run complete - nothing written.');
  process.exit(0);
}

// Abort rather than overwrite if the pipeline wrote members:all meanwhile
if (kvGet('members:all') !== originalRaw) {
  console.error('members:all changed during the run - aborting. Re-run just after a cron tick.');
  process.exit(1);
}

kvPut('members:all', JSON.stringify(members));
kvPut('processing_queue_phase1', JSON.stringify(newQueue));
console.log('Written: members:all, processing_queue_phase1');
