#!/usr/bin/env node
/**
 * The totals check: every graded member and candidate's money, as the site
 * holds it, against the FEC's own per-committee totals (the bulk file
 * committee_summary_{cycle}.csv: one download, no calls on the FEC key).
 *
 * What's compared, and when a difference counts: lib/totals.mjs, which every
 * refresh run also uses (2026-11-06). Some differences are by rule and are
 * listed apart: no letter grade (self-funded, disputed), a committee counted
 * only from a date (COMMITTEE_SINCE), and the FEC's file running to another
 * report than the site's figures (after a filing deadline, for a few days).
 *
 *   node scripts/verify/totals-check.mjs [--members-only] [--file committee_summary.csv] [--out report.json]
 *
 * Read-only: reads the site's API (one request per person: about 1,450
 * Worker requests) and the FEC's bulk file.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMITTEE_SINCE } from '../../workers/fec-crosswalk-additions.js';
import { compareTotals, parseSummary, summaryUrl, totalsVerdict } from './lib/totals.mjs';

const API = 'https://taskforce-purple-api.dev-a4b.workers.dev/api';
const CYCLE = 2026;
const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const membersOnly = process.argv.includes('--members-only');

// The FEC's file, one row per committee
let file = arg('--file');
if (!file) {
  file = join(mkdtempSync(join(tmpdir(), 'tfp-totals-')), `committee_summary_${CYCLE}.csv`);
  execFileSync('curl', ['-sSLf', '-o', file, summaryUrl(CYCLE)]);
}
const fecById = parseSummary(readFileSync(file, 'utf8'));

const get = async path => {
  for (let tries = 0; ; tries++) {
    const r = await fetch(`${API}${path}`);
    if (r.ok) {
      return r.json();
    }
    if (tries >= 2) {
      throw new Error(`${path}: HTTP ${r.status}`);
    }
    await new Promise(res => setTimeout(res, 2000));
  }
};

// Everyone graded: members, then candidates who aren't members
const people = [];
const list = await get('/members');
for (const m of Array.isArray(list) ? list : list.members) {
  people.push({ kind: 'member', id: m.bioguideId, name: m.name, tier: m.tier });
}
if (!membersOnly) {
  const races = await get('/races');
  const seen = new Set();
  const walk = v => {
    if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      if (v.candidateId && !v.bioguideId && /^[SABCDEF]$/.test(v.tier ?? '')) {
        if (!seen.has(v.candidateId)) {
          seen.add(v.candidateId);
          people.push({ kind: 'candidate', id: v.candidateId, name: v.name, tier: v.tier });
        }
      } else {
        Object.values(v).forEach(walk);
      }
    }
  };
  walk(races);
}

const results = [];
let next = 0;
async function worker() {
  while (next < people.length) {
    const p = people[next++];
    try {
      const det =
        p.kind === 'member'
          ? await get(`/member-detail?bioguideId=${p.id}`)
          : await get(`/candidate-detail?id=${p.id}`);
      const r = compareTotals(
        det.grade?.detail,
        det.moneyTrail?.committees,
        fecById,
        COMMITTEE_SINCE
      );
      results.push({
        ...p,
        siteThrough: det.member?.personFigures?.filedThrough ?? null,
        ...r,
      });
    } catch (e) {
      results.push({ ...p, error: e.message });
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const graded = r => /^[SABCDEF]$/.test(r.tier ?? '');
const differs = r => r.error || r.missing?.length || Object.keys(r.off ?? {}).length;
const describe = r => {
  const parts = Object.entries(r.off ?? {}).map(
    ([k, v]) => `${k} site ${v.site} FEC ${v.fec} (${v.diff > 0 ? '+' : ''}${v.diff})`
  );
  if (r.missing?.length) {
    parts.push(`not in the FEC's file: ${r.missing.join(' ')}`);
  }
  if (r.error) {
    parts.push(r.error);
  }
  return `${r.kind} ${r.id} ${r.name} [${r.tier}] site through ${r.siteThrough ?? '?'}, FEC through ${r.fecThrough?.join('/') || '?'}: ${parts.join('; ')}`;
};
const byId = (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
const notGraded = results.filter(r => !graded(r));
const verdict = r => (r.error ? 'differs' : totalsVerdict(r, r.siteThrough));
const bySince = results.filter(r => graded(r) && verdict(r) === 'since');
const waiting = results.filter(r => graded(r) && verdict(r) === 'waiting');
const unexplained = results.filter(r => graded(r) && verdict(r) === 'differs');

const members = people.filter(p => p.kind === 'member').length;
console.log(
  `Checked ${results.length}: ${members} members, ${results.length - members} candidates`
);
console.log(
  `Graded and matching the FEC's totals: ${results.filter(r => graded(r) && !differs(r)).length}`
);
console.log(`No letter grade (not compared): ${notGraded.length}`);
console.log(
  `Differ by a committee counted by rule (from a date, or a campaign that became a PAC): ${bySince.length}`
);
for (const r of bySince.sort(byId)) {
  console.log(`  ${describe(r)} [${r.since.join(', ')}]`);
}
console.log(`Differ while the FEC's file runs to another report (wait for it): ${waiting.length}`);
for (const r of waiting.sort(byId)) {
  console.log(`  ${describe(r)}`);
}
console.log(`Differ, not explained: ${unexplained.length}`);
for (const r of unexplained.sort(byId)) {
  console.log(`  ${describe(r)}`);
}
const out = arg('--out');
if (out) {
  writeFileSync(out, JSON.stringify(results, null, 1));
}
