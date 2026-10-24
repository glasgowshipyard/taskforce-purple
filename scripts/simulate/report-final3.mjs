#!/usr/bin/env node
/**
 * FINAL-3, the freeze candidate (owner, 2026-10-12): FINAL-2 with
 *   1. the people test's stricter reading (members elect most of the board)
 *   2. unions covered by the LMRDA pass on the law
 *   3. rule 6 for FEC sponsor types C and T only
 *   4. a sponsor whose members are businesses is BUSINESS
 * Same snapshot and export as FINAL-2. FINAL-2 is first reproduced from the
 * same code (each change switched off) and checked member by member
 * against FINAL-2's own results, so every grade change is put down to one
 * of the four, or shown as unexplained.
 *
 *   node scripts/simulate/report-final3.mjs --inputs FILE.inputs.json --irs DIR
 *     --final2 DIR (FINAL-2's Final2.csv and PACs.csv) --out DIR
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  IRS_FILES,
  RULE6_TYPES,
  classifyPac,
  loadFacts,
  loadIrsIndex,
  loadPeopleEvidence,
  peopleTest,
} from '../refresh/lib/sponsors.mjs';
import { LIVE, RANK, runGrid } from './lib/grid.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const outDir = arg('--out', 'simulation-final3');
mkdirSync(outDir, { recursive: true });

const csv = path => {
  const [head, ...rows] = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const split = line => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          q = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        q = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const cols = split(head);
  return rows.map(r => Object.fromEntries(split(r).map((v, i) => [cols[i], v])));
};
const f2Grades = new Map(csv(join(arg('--final2'), 'Final2.csv')).map(r => [r.id, r]));
const f2Pacs = new Map(csv(join(arg('--final2'), 'PACs.csv')).map(r => [r.id, r]));

const conn = await (await DuckDBInstance.create(':memory:')).connect();
const irsIndex = await loadIrsIndex(
  async sql => (await conn.runAndReadAll(sql)).getRowObjects(),
  IRS_FILES.map(f => join(arg('--irs'), `${f}.csv`))
);
const allFacts = loadFacts();
const { forms, stated, minority } = loadPeopleEvidence();

// --- The steps: FINAL-2, then each change added in the owner's order ---
const factsUpTo = rule =>
  Object.fromEntries(
    Object.entries(allFacts).filter(([, f]) => !(f.since === 'FINAL-3' && f.rule > rule))
  );
const STEPS = [
  ['FINAL-2', { rule6: ['C', 'T', 'W', 'V'], facts: 0, strict: false, lmrda: false }],
  ['1. most of the board', { rule6: ['C', 'T', 'W', 'V'], facts: 0, strict: true, lmrda: false }],
  [
    '2. unions under the LMRDA',
    { rule6: ['C', 'T', 'W', 'V'], facts: 0, strict: true, lmrda: true },
  ],
  ['3. rule 6 for C and T only', { rule6: RULE6_TYPES, facts: 3, strict: true, lmrda: true }],
  ['4. members that are businesses', { rule6: RULE6_TYPES, facts: 4, strict: true, lmrda: true }],
];
const sortWith = o => {
  const facts = factsUpTo(o.facts);
  const pacs = {};
  for (const [id, p] of Object.entries(inputs.pacs)) {
    const sponsor = classifyPac(id, p, irsIndex, facts, p.fecRecord, { rule6: o.rule6 });
    pacs[id] = {
      ...p,
      sponsor,
      peopleTest: peopleTest(id, sponsor, forms, stated, {
        strict: o.strict,
        lmrda: o.lmrda,
        minority,
      }),
    };
  }
  return pacs;
};
// FINAL-2's grading settings
const CFG = {
  ...LIVE,
  F1: true,
  F2: true,
  F8cov: true,
  F8split: true,
  F9: true,
  F11: true,
  bar: false,
  denominator: 'given',
  allowance: 'min',
  fixedInvariant: true,
  noMinDonors: true,
  wholeFunds: true,
  groups: {
    credit: { people: 1 },
    source: 'tfp',
    upstreamZero: true,
    upstreamByCredit: true,
    peopleTest: true,
  },
  nonOwnAsPolitician: true,
  selfFunded: 0.5, // FINAL3.selfFunded
  directedAsGifts: true,
};
const runs = STEPS.map(([label, o]) => {
  const pacs = sortWith(o);
  const { results, shares } = runGrid({ ...inputs, pacs }, CFG);
  return { label, pacs, results, shares };
});
const F2 = runs[0];
const F3 = runs.at(-1);

const lines = [];
const say = (...xs) => lines.push(xs.join(''));
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const pct = (x, d = 0) =>
  x === null || x === undefined || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`;
const usd = x => `$${Math.round(x).toLocaleString('en-US')}`;
const usdM = x => `$${(x / 1e6).toFixed(1)}M`;
const esc = s => String(s ?? '').replace(/\|/g, '/');
const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const isLetter = t => LETTERS.includes(t);
const partyOf = p => (/^D/.test(p || '') ? 'D' : /^R/.test(p || '') ? 'R' : 'I');
const byId = new Map(inputs.members.map(m => [m.id, m]));
const GROUP = {
  politician: 'POLITICIAN',
  business: 'BUSINESS',
  people: 'PEOPLE',
  board: 'BOARD',
  untested: 'NOT TESTED',
  nosponsor: 'NO SPONSOR',
  party: 'PARTY',
};
const groupIn = (run, id) => {
  const p = run.pacs[id];
  const g = p?.sponsor?.group || 'nosponsor';
  return g !== 'people'
    ? g
    : p.peopleTest?.elected === true
      ? 'people'
      : p.peopleTest?.elected === false
        ? 'board'
        : 'untested';
};
const counts = results => {
  const t = {};
  for (const r of results.values()) {
    const k = isLetter(r.tier) ? r.tier : '?';
    t[k] = (t[k] || 0) + 1;
  }
  return t;
};
const upDown = (from, to) => {
  const t = Object.fromEntries(['D', 'R', 'I'].map(k => [k, { up: 0, down: 0, same: 0, of: 0 }]));
  for (const m of inputs.members) {
    const a = from(m.id);
    const b = to(m.id);
    if (!isLetter(a) || !isLetter(b)) {
      continue;
    }
    const p = t[partyOf(m.party)];
    p.of++;
    p[RANK[b] > RANK[a] ? 'up' : RANK[b] < RANK[a] ? 'down' : 'same']++;
  }
  return t;
};
const REFERENCE = {
  S000033: 'Sanders',
  O000172: 'Ocasio-Cortez',
  C000127: 'Cantwell',
  P000197: 'Pelosi',
  C001116: 'Clyde',
  R000600: 'Radewagen',
  J000305: 'Jacobs',
  P000595: 'Peters',
};
const pacGiven = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of [...(m.gifts || []), ...(m.giftsToFunds || [])]) {
    pacGiven.set(id, (pacGiven.get(id) || 0) + amt);
  }
}
const directedTo = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of Object.entries(m.shapeDirected?.directedOut || {})) {
    if (amt > 0) {
      directedTo.set(id, (directedTo.get(id) || 0) + amt);
    }
  }
}
const moneyOf = id => (pacGiven.get(id) || 0) + (directedTo.get(id) || 0);

// --- The check: FINAL-2 reproduced ---
const mismatch = inputs.members.filter(m => {
  const a = f2Grades.get(m.id);
  const b = F2.results.get(m.id);
  return a && (a.grade !== b.tier || num(a.score) !== num(b.score));
});
const pacMismatch = [...f2Pacs.values()].filter(
  r => r.group && GROUP[groupIn(F2, r.id)] !== r.group
);

// Each changed grade's cause: the step(s) where its score moved
const causeOf = id => {
  const steps = [];
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1].results.get(id);
    const b = runs[i].results.get(id);
    steps.push({ i, a, b, dx: Math.abs(num(b?.x) - num(a?.x)) });
  }
  // The rules that moved the rounded score or the grade; else the one that
  // moved the unrounded score most
  let moved = steps.filter(({ a, b }) => a?.tier !== b?.tier || a?.score !== b?.score);
  if (!moved.length) {
    moved = steps
      .filter(t => t.dx > 1e-9)
      .sort((p, q) => q.dx - p.dx)
      .slice(0, 1);
  }
  return (
    moved.map(({ i, a, b }) => `${runs[i].label} (${a?.score}→${b?.score})`).join('; ') || 'none'
  );
};
// The PACs behind a member's change: those whose group changed and that gave
// or directed money to the member
const changedPacs = Object.keys(inputs.pacs).filter(id => groupIn(F2, id) !== groupIn(F3, id));
const changedSet = new Set(changedPacs);
const pacsBehind = m => {
  const ids = new Map();
  for (const [id, amt] of [...(m.gifts || []), ...(m.giftsToFunds || [])]) {
    if (changedSet.has(id)) {
      ids.set(id, (ids.get(id) || 0) + amt);
    }
  }
  for (const [id, amt] of Object.entries(m.shapeDirected?.directedOut || {})) {
    if (changedSet.has(id) && amt > 0) {
      ids.set(id, (ids.get(id) || 0) + amt);
    }
  }
  return [...ids]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, amt]) => `${inputs.pacs[id]?.name?.slice(0, 40)} ${usd(amt)}`)
    .join('; ');
};

// ===================== Report =====================
const c3 = counts(F3.results);
const c2 = counts(F2.results);
const vsLive = upDown(
  id => byId.get(id)?.published?.tier,
  id => F3.results.get(id)?.tier
);
const vsF2 = upDown(
  id => F2.results.get(id)?.tier,
  id => F3.results.get(id)?.tier
);
const gradeChanges = inputs.members.filter(
  m => F2.results.get(m.id)?.tier !== F3.results.get(m.id)?.tier
);
const scoreChanges = inputs.members.filter(
  m => F2.results.get(m.id)?.score !== F3.results.get(m.id)?.score
);
const unexplained = gradeChanges.filter(m => causeOf(m.id) === 'none');
const withheld = inputs.members.filter(m => !isLetter(F3.results.get(m.id)?.tier));
const peopleIds = [...pacGiven.keys()].filter(id => groupIn(F3, id) === 'people');
const sumOf = ids => ids.reduce((t, id) => t + (pacGiven.get(id) || 0), 0);
const countsFor = (run, id) => (groupIn(run, id) === 'people' ? run.shares.get(id)?.[2] || 0 : 0);
const counted = run => [...pacGiven].reduce((t, [id, a]) => t + a * countsFor(run, id), 0);
const countedDirected = run =>
  [...directedTo].reduce((t, [id, a]) => t + a * countsFor(run, id), 0);

say('# FINAL-3');
say('');
say(
  `Same snapshot and export as FINAL-2 (run 38328698299). FINAL-2 reproduced from the same code with the four changes switched off: ${mismatch.length === 0 ? 'every member' : `${inputs.members.length - mismatch.length} of ${inputs.members.length} members`} matches FINAL-2's grade and score${pacMismatch.length ? `, and ${f2Pacs.size - pacMismatch.length} of ${f2Pacs.size} PACs its group` : ', and every PAC its group'}.`
);
say('');
say('## In plain English');
say('');
say(
  `- **Grades:** S ${c3.S || 0}, A ${c3.A || 0}, B ${c3.B || 0}, C ${c3.C || 0}, D ${c3.D || 0}, E ${c3.E || 0}, F ${c3.F || 0}. ${withheld.length} withheld (${withheld.map(m => m.name).join('; ')}).`
);
say(
  `- **Against FINAL-2:** ${gradeChanges.length} grades change (Democrats ${vsF2.D.up} up, ${vsF2.D.down} down; Republicans ${vsF2.R.up} up, ${vsF2.R.down} down); ${scoreChanges.length} scores move. ${unexplained.length === 0 ? 'Every change comes from one of the four rules.' : `${unexplained.length} changes come from none of the four rules (listed in section 3).`}`
);
say(
  `- **Against the live grades:** Democrats ${vsLive.D.up} of ${vsLive.D.of} up, ${vsLive.D.down} down; Republicans ${vsLive.R.up} of ${vsLive.R.of} up, ${vsLive.R.down} down.`
);
say(
  `- **PAC money that counts:** ${peopleIds.length} PACs pass the people test; they gave ${usdM(sumOf(peopleIds))}, of which ${usdM(counted(F3))} counts (FINAL-2: ${usdM(counted(F2))}). Directed gifts that count: ${usdM(countedDirected(F3))} (FINAL-2: ${usdM(countedDirected(F2))}).`
);
say(
  `- **PACs whose group changed:** ${changedPacs.filter(id => moneyOf(id) > 0).length} that gave or directed money to members.`
);
say('');

say('## 1. Grades');
say('');
say('| Run | S | A | B | C | D | E | F | withheld |');
say('|---|---|---|---|---|---|---|---|---|');
const cL = counts(new Map(inputs.members.map(m => [m.id, { tier: m.published?.tier }])));
say(`| Live | ${LETTERS.map(l => cL[l] || 0).join(' | ')} | ${cL['?'] || 0} |`);
for (const r of runs) {
  const c = counts(r.results);
  const bold = r === F3;
  say(
    `| ${bold ? '**FINAL-3**' : r.label === 'FINAL-2' ? 'FINAL-2' : `+ ${r.label}`} | ${LETTERS.map(l => (bold ? `**${c[l] || 0}**` : c[l] || 0)).join(' | ')} | ${c['?'] || 0} |`
  );
}
say('');
say('Reference members:');
say('');
say('| Member | Live | FINAL-2 | FINAL-3 | From people | PACs counted | Directed gifts counted |');
say('|---|---|---|---|---|---|---|');
for (const [id, name] of Object.entries(REFERENCE)) {
  const m = byId.get(id);
  const a = F2.results.get(id);
  const r = F3.results.get(id);
  say(
    `| ${name} | ${m.published?.tier} ${m.published?.score ?? ''} | ${a.tier} ${a.score ?? ''} | ${r.tier} ${r.score ?? ''} | ${pct(r.fromPeople / r.denominator)} | ${pct(r.creditDollars / r.denominator)} | ${pct(r.earmarkDollars / r.denominator)} |`
  );
}
say('');

say('## 2. Up and down by party');
say('');
say('| Against | Democrats up | down | same | Republicans up | down | same |');
say('|---|---|---|---|---|---|---|');
for (const [label, t] of [
  ['live', vsLive],
  ['FINAL-2', vsF2],
]) {
  say(
    `| ${label} | ${t.D.up} of ${t.D.of} | ${t.D.down} | ${t.D.same} | ${t.R.up} of ${t.R.of} | ${t.R.down} | ${t.R.same} |`
  );
}
say('');
say('By rule (each added to the one before, in the order of the brief):');
say('');
say('| Step | Grades changed | Democrats up | down | Republicans up | down |');
say('|---|---|---|---|---|---|');
for (let i = 1; i < runs.length; i++) {
  const t = upDown(
    id => runs[i - 1].results.get(id)?.tier,
    id => runs[i].results.get(id)?.tier
  );
  const n = inputs.members.filter(
    m => runs[i - 1].results.get(m.id)?.tier !== runs[i].results.get(m.id)?.tier
  ).length;
  say(`| ${runs[i].label} | ${n} | ${t.D.up} | ${t.D.down} | ${t.R.up} | ${t.R.down} |`);
}
say('');

say('## 3. Every grade change from FINAL-2');
say('');
say(
  `${gradeChanges.length} members. The cause is the rule at which the score moved; the PACs are those whose group changed and that gave or directed money to the member.`
);
say('');
say('| Member | Party | FINAL-2 | FINAL-3 | Cause | PACs behind it |');
say('|---|---|---|---|---|---|');
for (const m of gradeChanges.sort(
  (a, b) =>
    num(F3.results.get(a.id)?.score) -
    num(F2.results.get(a.id)?.score) -
    (num(F3.results.get(b.id)?.score) - num(F2.results.get(b.id)?.score))
)) {
  const a = F2.results.get(m.id);
  const r = F3.results.get(m.id);
  say(
    `| ${m.name} | ${partyOf(m.party)} | ${a.tier} ${a.score} | ${r.tier} ${r.score} | ${causeOf(m.id)} | ${esc(pacsBehind(m))} |`
  );
}
say('');

say('## 4. Every PAC whose group changed from FINAL-2');
say('');
{
  const rows = changedPacs.filter(id => moneyOf(id) > 0).sort((a, b) => moneyOf(b) - moneyOf(a));
  const moves = {};
  for (const id of rows) {
    const k = `${GROUP[groupIn(F2, id)]} → ${GROUP[groupIn(F3, id)]}`;
    moves[k] ||= { n: 0, amt: 0 };
    moves[k].n++;
    moves[k].amt += moneyOf(id);
  }
  say(`${rows.length} PACs that gave or directed money to members. By move:`);
  say('');
  say('| FINAL-2 → FINAL-3 | PACs | Given + directed |');
  say('|---|---|---|');
  for (const [k, v] of Object.entries(moves).sort((a, b) => b[1].amt - a[1].amt)) {
    say(`| ${k} | ${v.n} | ${usdM(v.amt)} |`);
  }
  say('');
  const stepOf = id => {
    for (let i = 1; i < runs.length; i++) {
      if (groupIn(runs[i - 1], id) !== groupIn(runs[i], id)) {
        return runs[i].label;
      }
    }
    return '–';
  };
  say('| PAC | Given + directed | FINAL-2 | FINAL-3 | Rule | The fact |');
  say('|---|---|---|---|---|---|');
  for (const id of rows) {
    const p = F3.pacs[id];
    const g = groupIn(F3, id);
    const fact = ['people', 'board', 'untested'].includes(g)
      ? `${p.peopleTest.evidence}`
      : p.sponsor.reason;
    say(
      `| ${esc(p.name)} | ${usd(moneyOf(id))} | ${GROUP[groupIn(F2, id)]} | ${GROUP[g]} | ${stepOf(id)} | ${esc(fact)} |`
    );
  }
  say('');
}

say('## 5. The people test, as it now stands');
say('');
{
  const tested = [...new Set([...pacGiven.keys(), ...directedTo.keys()])].filter(
    id => F3.pacs[id]?.sponsor?.group === 'people'
  );
  const by = { law: [], form: [], fact: [], board: [], untested: [] };
  for (const id of tested) {
    const t = F3.pacs[id].peopleTest;
    const k =
      t.elected === null
        ? 'untested'
        : t.elected === false
          ? 'board'
          : t.rule === 2
            ? 'law'
            : /^Stated fact/.test(t.evidence)
              ? 'fact'
              : 'form';
    by[k].push(id);
  }
  const row = (label, ids) =>
    say(`| ${label} | ${ids.length} | ${usdM(ids.reduce((t, id) => t + moneyOf(id), 0))} |`);
  say('| PEOPLE sponsors | PACs | Given + directed |');
  say('|---|---|---|');
  row('Pass: a union covered by the LMRDA (rule 2)', by.law);
  row('Pass: Form 990, members elect most of the board', by.form);
  row('Pass: a stated fact (no Form 990)', by.fact);
  row('BOARD: members elect a minority, none, or the board is its own membership', by.board);
  row('Not tested: no Form 990, no stated fact', by.untested);
  say('');
  say('Every BOARD sponsor:');
  say('');
  say('| PAC | Given + directed | Why |');
  say('|---|---|---|');
  for (const id of by.board.sort((a, b) => moneyOf(b) - moneyOf(a))) {
    say(
      `| ${esc(F3.pacs[id].name)} | ${usd(moneyOf(id))} | ${esc(F3.pacs[id].peopleTest.evidence)} |`
    );
  }
  say('');
  say(
    'Unions and employee groups on the Form 990 test: public-sector and federal unions (not covered by the LMRDA), federations of unions, and national unions whose coverage I did not state (they pass the Form 990 test either way):'
  );
  say('');
  say('| PAC | Given + directed | Result | Evidence |');
  say('|---|---|---|---|');
  for (const id of tested
    .filter(i => {
      const p = F3.pacs[i];
      return (
        (p.orgType === 'L' ||
          /UNION|POLICE|FIRE ?FIGHTER|EMPLOYEES|CORRECTION|BENEVOLENT/.test(p.name || '')) &&
        p.peopleTest.rule !== 2 &&
        !/^Stated fact/.test(p.peopleTest.evidence)
      );
    })
    .sort((a, b) => moneyOf(b) - moneyOf(a))) {
    const p = F3.pacs[id];
    say(
      `| ${esc(p.name)} | ${usd(moneyOf(id))} | ${GROUP[groupIn(F3, id)]} | ${esc(p.peopleTest.evidence)} |`
    );
  }
  say('');
}

if (unexplained.length) {
  say('## Changes no rule explains');
  say('');
  for (const m of unexplained) {
    say(`- ${m.name}: ${F2.results.get(m.id)?.tier} → ${F3.results.get(m.id)?.tier}`);
  }
  say('');
}
if (mismatch.length || pacMismatch.length) {
  say('## FINAL-2 not reproduced');
  say('');
  for (const m of mismatch.slice(0, 40)) {
    const a = f2Grades.get(m.id);
    const b = F2.results.get(m.id);
    say(`- ${m.name}: FINAL-2 ${a.grade} ${a.score}, reproduced ${b.tier} ${b.score}`);
  }
  for (const r of pacMismatch.slice(0, 40)) {
    say(`- PAC ${r.name}: FINAL-2 ${r.group}, reproduced ${GROUP[groupIn(F2, r.id)]}`);
  }
  say('');
}

// ---- CSVs ----
const cell = v =>
  v === null || v === undefined
    ? ''
    : typeof v === 'number'
      ? String(Math.round(v * 10000) / 10000)
      : `"${String(v).replace(/"/g, '""')}"`;
{
  const cols = [
    'id',
    'name',
    'party',
    'state',
    's',
    'b',
    'p',
    'y',
    'politician_funds',
    'directed',
    'own',
    'denominator',
    'n',
    'N',
    'allowance',
    'fallback',
    'counted_from_people',
    'pac_counted',
    'directed_counted',
    'score_unrounded',
    'score',
    'grade',
    'final2_grade',
    'final2_score',
    'live_grade',
    'cause_vs_final2',
  ];
  const rows = [cols.join(',')];
  for (const m of inputs.members) {
    const r = F3.results.get(m.id);
    const a = F2.results.get(m.id);
    rows.push(
      [
        m.id,
        m.name,
        partyOf(m.party),
        m.state,
        r.s,
        r.b,
        r.p,
        r.y,
        r.j,
        r.e,
        r.own,
        r.denominator,
        r.n,
        r.N,
        r.allowance,
        r.fallback,
        r.fromPeople,
        r.creditDollars,
        r.earmarkDollars,
        r.x,
        r.score,
        r.tier,
        a?.tier,
        a?.score,
        m.published?.tier,
        a?.score !== r.score ? causeOf(m.id) : '',
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, 'Final3.csv'), rows.join('\n'));
}
{
  const cols = [
    'id',
    'name',
    'type',
    'designation',
    'org_type',
    'connected_org',
    'group',
    'final2_group',
    'settled_by',
    'reason',
    'people_test_ein',
    'form990_name',
    'form990_tax_year',
    'line6_members',
    'line7a_members_elect',
    'voting_board_members',
    'schedule_o',
    'people_test',
    'given_to_members',
    'directed_to_members',
    'traces_to_people',
    'counts',
  ];
  const rows = [cols.join(',')];
  for (const id of Object.keys(inputs.pacs).sort((a, b) => moneyOf(b) - moneyOf(a))) {
    const p = F3.pacs[id];
    const t = p.peopleTest;
    const f = t.ein ? forms[t.ein] : null;
    rows.push(
      [
        id,
        p.name,
        p.type,
        p.designation,
        p.orgType,
        p.connectedOrg,
        GROUP[groupIn(F3, id)],
        GROUP[groupIn(F2, id)],
        p.sponsor.settledBy,
        p.sponsor.reason,
        t.ein,
        f?.name,
        f?.taxYear,
        f?.found ? f.members : null,
        f?.found ? f.elect : null,
        f?.votingMembers,
        (f?.notes || []).join(' / '),
        t.evidence,
        pacGiven.get(id) || 0,
        directedTo.get(id) || 0,
        F3.shares.get(id)?.[2],
        countsFor(F3, id),
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, 'PACs.csv'), rows.join('\n'));
}
writeFileSync(join(outDir, 'report.md'), lines.join('\n'));

// The one-page spec, its result line from this run
const spec = `## Spec: FINAL-3

**Meaning.** A member's grade is the share of the money given to them, and to their own joint funds, that comes from many different people. Big donations count only as far as the people who gave them are many and spread out. PAC money counts only when the PAC's sponsor is run by its members (they elect most of its board, or it is a union bound by federal labor law to hold member elections), and only as far as the PAC's own money traces back to many people. Money from businesses, politicians, parties, and PACs that answer to a board or to their organizers counts 0.

**Formula** (per member, cycle 2026):

- money given: \`G = s + b + p + y\` across the member's campaigns, leadership PACs and own joint funds (in full; transfers between them counted once). Own money, interest, refunds, loans and transfers are left out.
- other politicians' joint funds: what they passed to the member comes out of \`s, b, p, y\` by each fund's own mix and counts 0 (POLITICIAN); it stays in \`G\`.
- directed gifts: gifts earmarked through a committee other than ActBlue, WinRed or Democracy Engine come out of \`b\` and the donor test, and count as that committee's gift: \`e × share\` if it passes the people test, else 0. Never under the PAC cap.
- donor test, on the remaining big-donor records of those committees, each donor's gifts at full size, donors who net above $0: \`N\` big donors, \`n\` the fewest who gave half the big-donor money.
- allowance: \`a = min(0.10 + 0.90 × clamp((n/N − 0.025) / 0.075, 0, 1), min(1, n/100))\`; \`a = 0.40\` only when our records cover under half the FEC's big-donor total.
- big money counted: \`min(b, a × (s + b))\`.
- each PAC's share from people: the same test on the PAC's own money (the FEC's small/big split, its own donors), plus the money of committees that funded it (2 steps back) where those committees pass the people test; all other committee money, and money we can't trace, counts 0.
- the people test: a labor union covered by the Labor-Management Reporting and Disclosure Act passes on the law. Any other PEOPLE sponsor passes only if its members elect most of its voting board: its latest Form 990 answers Yes on Part VI line 7a, line 6 says it has members, and its Schedule O doesn't show members electing only a minority (or the board being its own membership). Otherwise BOARD (0). No Form 990: a stated fact decides; otherwise not tested (0) and listed.
- PAC money counted: \`Σ gift × share\` for PEOPLE PACs that pass the test, scaled down so it never exceeds the PAC money in the member's figures.
- score: \`x = 100 × (s + min(b, a(s + b)) + PAC money counted + directed gifts counted) / G\`, at most 100.
- grade on \`round(x)\`: S at least 90, A 75, B 60, C 45, D 30, E 15, otherwise F.
- no grade (?): no confirmed FEC identity; no campaign committee for the cycle; own money that doesn't fit inside the receipts.

**Constants**: 0.10 and 0.90 (allowance range), 2.5% and 10% (spread), 100 donors, 0.40 fallback, 50% record coverage, credit 1 (PEOPLE that pass the test) and 0 (everything else), 2 steps back, bands 90/75/60/45/30/15.

**Sorting rule** (each PAC in one group, in this order): a stated fact, where one is listed. POLITICIAN: leadership PACs (FEC designation D, or the FEC's leadership-PAC flag or sponsoring candidate), candidates' committees, other politicians' joint funds, PACs whose connected organization is a candidate's committee, leadership PAC, joint fund or politician, and PACs linked to a congressional caucus or run by members of Congress (one test, both parties). PARTY: party committees, and PACs whose connected organization is one. NO SPONSOR: a connected organization that is another (non-party, non-politician) committee, or none. BUSINESS: FEC sponsor type corporation (C) or trade association (T), whatever the IRS says; cooperatives; credit unions, insurers (fraternal benefit societies that sell insurance included), health plans and chambers of commerce; agricultural producers' groups; a sponsor whose members are businesses; a 501(c)(6) business league or exempt co-op, credit union or mutual insurer by IRS status; a sponsor with no IRS exempt record (a corporation without capital stock, W, included) or a company name. PEOPLE: a labor organization (FEC type L, or 501(c)(5) not a producers' group) or another member or issue organization by IRS status or FEC type M or W. The IRS can make a PAC BUSINESS, never un-make a C or T; leaving BUSINESS takes a stated fact. An IRS match made on another name, or under mixed records, is checked and listed.

**Result on the snapshot**: S ${c3.S || 0}, A ${c3.A || 0}, B ${c3.B || 0}, C ${c3.C || 0}, D ${c3.D || 0}, E ${c3.E || 0}, F ${c3.F || 0}; ${withheld.length} withheld.
`;
writeFileSync(join(outDir, 'spec.md'), spec);
writeFileSync(
  join(outDir, 'final3-results.json'),
  JSON.stringify({
    counts: c3,
    final2: c2,
    vsLive,
    vsF2,
    gradeChanges: gradeChanges.length,
    unexplained: unexplained.length,
    reproduced: mismatch.length === 0 && pacMismatch.length === 0,
  })
);
console.log(
  `written to ${outDir}: ${lines.length} lines; FINAL-2 reproduced: ${mismatch.length} member and ${pacMismatch.length} PAC mismatches; ${gradeChanges.length} grade changes, ${unexplained.length} unexplained`
);
