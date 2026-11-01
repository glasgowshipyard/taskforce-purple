#!/usr/bin/env node
/**
 * The totals check: every graded member and candidate's money, as the site
 * holds it, against the FEC's own per-committee totals (the bulk file
 * committee_summary_{cycle}.csv: one download, no calls on the FEC key).
 *
 * For each person it adds up the FEC's figures for their own committees
 * (campaign, leadership PAC, the joint funds that are theirs) plus what other
 * politicians' joint funds passed to them, and compares that with the
 * grade's working (grade.detail):
 *
 *   people  small + big + directed    vs  individuals (INDV_CONTB)
 *   small   small                     vs  unitemized (INDV_UNITEM_CONTB)
 *   pac     pac                       vs  other committees (OTH_CMTE_CONTB)
 *   party   party                     vs  party committees (PTY_CMTE_CONTB)
 *   given   the grade's whole total   at most everything received (TTL_RECEIPTS)
 *
 * A difference is named when it's over $1,000 and over 1%. Some are by
 * rule and are listed apart: no letter grade (self-funded, disputed), a
 * committee counted only from a date (COMMITTEE_SINCE). Also listed: money
 * from other politicians' joint funds left out of the total because the
 * fund shows no money raised this cycle, with what it would do to the grade.
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
  execFileSync('curl', [
    '-sSLf',
    '-o',
    file,
    `https://www.fec.gov/files/bulk-downloads/${CYCLE}/committee_summary_${CYCLE}.csv`,
  ]);
}
const csvRow = line => {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
};
const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
const head = csvRow(lines[0]);
const col = name => head.indexOf(name);
const fecById = new Map();
for (const line of lines.slice(1)) {
  const c = csvRow(line);
  const n = name => Number(c[col(name)]) || 0;
  fecById.set(c[col('CMTE_ID')], {
    individuals: n('INDV_CONTB'),
    unitemized: n('INDV_UNITEM_CONTB'),
    others: n('OTH_CMTE_CONTB'),
    party: n('PTY_CMTE_CONTB'),
    receipts: n('TTL_RECEIPTS'),
    through: c[col('CVG_END_DT')],
  });
}

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

const round = x => Math.round(x * 100) / 100;
const BANDS = [
  ['S', 90],
  ['A', 75],
  ['B', 60],
  ['C', 45],
  ['D', 30],
  ['E', 15],
];
const letter = x => BANDS.find(([, from]) => x >= from)?.[0] ?? 'F';
function compare(detail, trail) {
  const d = detail ?? {};
  const fec = { people: 0, small: 0, pac: 0, party: 0 };
  // Everything the committees took in, joint funds' passed money included
  let receipts = 0;
  const missing = [];
  const since = [];
  const through = new Set();
  let leftOut = 0;
  for (const c of trail?.committees ?? []) {
    // Another politician's joint fund: in the grade by its mix, and left
    // out when it shows no money raised this cycle (no mix)
    if (c.role === 'joint' && !c.ownFund) {
      if (!c.mix) {
        leftOut += c.toMemberCounted ?? 0;
      }
      receipts += c.toMemberCounted ?? 0;
      continue;
    }
    if (COMMITTEE_SINCE[c.committeeId]) {
      since.push(`${c.committeeId} from ${COMMITTEE_SINCE[c.committeeId].from}`);
    }
    const f = fecById.get(c.committeeId);
    if (!f) {
      missing.push(c.committeeId);
      continue;
    }
    fec.people += f.individuals;
    fec.small += f.unitemized;
    fec.pac += f.others;
    fec.party += f.party;
    receipts += f.receipts;
    through.add(f.through);
  }
  const site = {
    people: (d.small ?? 0) + (d.big ?? 0) + (d.directed ?? 0),
    small: d.small ?? 0,
    pac: d.pac ?? 0,
    party: d.party ?? 0,
  };
  const off = {};
  // The grade can't count more money than the committees took in
  if ((d.given ?? 0) > receipts * 1.02 + 1000) {
    off.given = { site: round(d.given), fec: round(receipts), diff: round(d.given - receipts) };
  }
  for (const k of Object.keys(site)) {
    const diff = site[k] - fec[k];
    if (Math.abs(diff) > 1000 && Math.abs(diff) > 0.01 * Math.max(fec[k], site[k])) {
      off[k] = { site: round(site[k]), fec: round(fec[k]), diff: round(diff) };
    }
  }
  // What the left-out money would do to the grade, were it in the total
  let ifCounted = null;
  if (leftOut > 0 && d.given > 0) {
    const x = (d.score * d.given) / (d.given + leftOut);
    ifCounted = { leftOut: round(leftOut), score: Math.round(x), letter: letter(Math.round(x)) };
  }
  return { off, missing, since, ifCounted, fecThrough: [...through].sort() };
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
      const r = compare(det.grade?.detail, det.moneyTrail);
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
const bySince = results.filter(r => graded(r) && differs(r) && r.since?.length);
const unexplained = results.filter(r => graded(r) && differs(r) && !r.since?.length);
const leftOut = results.filter(r => graded(r) && r.ifCounted);

const members = people.filter(p => p.kind === 'member').length;
console.log(
  `Checked ${results.length}: ${members} members, ${results.length - members} candidates`
);
console.log(
  `Graded and matching the FEC's totals: ${results.filter(r => graded(r) && !differs(r)).length}`
);
console.log(`No letter grade (not compared): ${notGraded.length}`);
console.log(`Differ by a committee counted from a date (owner's decision): ${bySince.length}`);
for (const r of bySince.sort(byId)) {
  console.log(`  ${describe(r)} [${r.since.join(', ')}]`);
}
console.log(`Differ, not explained: ${unexplained.length}`);
for (const r of unexplained.sort(byId)) {
  console.log(`  ${describe(r)}`);
}
console.log(
  `Other politicians' joint fund money left out (fund shows nothing raised this cycle): ${leftOut.length}`
);
for (const r of leftOut.sort(byId)) {
  const c = r.ifCounted;
  const moved = c.letter === r.tier ? 'same letter' : `would be ${c.letter}`;
  console.log(
    `  ${r.kind} ${r.id} ${r.name} [${r.tier}]: $${c.leftOut}; counted, score ${c.score}, ${moved}`
  );
}
const out = arg('--out');
if (out) {
  writeFileSync(out, JSON.stringify(results, null, 1));
}
