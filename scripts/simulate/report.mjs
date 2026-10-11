#!/usr/bin/env node
/**
 * The simplification simulation's report (owner's brief, 2026-10-11), from
 * the inputs a frozen run exports (run.mjs --frozen ... --report):
 *
 *   node scripts/simulate/report.mjs --inputs FILE.inputs.json --out DIR
 *
 * Writes DIR/report.md (summary first), DIR/results.json, one CSV per run
 * of the ladder and the variants, and DIR/grid.csv (every grid run). Pure
 * arithmetic on the inputs: no network, nothing published.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pacType } from '../../src/lib/pacs.js';
import { LIVE, RANK, gradeOne, personLevel, runGrid, spearman } from './lib/grid.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const outDir = arg('--out', 'simulation-report');
mkdirSync(outDir, { recursive: true });
const lines = [];
const say = (...xs) => lines.push(xs.join(''));
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const pct = (x, d = 0) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(d)}%`);
const usd = x => `$${Math.round(x).toLocaleString('en-US')}`;
const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const isLetter = t => LETTERS.includes(t);
const partyOf = p => (/^D/.test(p || '') ? 'D' : /^R/.test(p || '') ? 'R' : 'I');
const byId = new Map(inputs.members.map(m => [m.id, m]));
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

// --- The runs ---
const R0 = { ...LIVE };
const R1a = { ...R0, F1: true, F2: true };
const R1b = { ...R1a, F8cov: true, F8split: true, F9: true, F11: true };
const R2 = { ...R1b, bar: false };
const R3 = { ...R2, denominator: 'given' };
const VARIANTS = {
  R3: { ...R3 },
  A: { ...R3, allowance: 'smooth' },
  B: { ...R3, allowance: 'count' },
  C: { ...R3, allowance: 'table100' },
  D500: { ...R3, allowance: 'cap', cap: 500 },
  D1000: { ...R3, allowance: 'cap', cap: 1000 },
  D2000: { ...R3, allowance: 'cap', cap: 2000 },
  E: { ...R3, allowance: 'min' },
};
const VARIANT_WORDS = {
  R3: 'R3: the live allowance table (10/25/40/50%)',
  A: 'A: allowance rises smoothly with the share of donors holding half (10% to 100%)',
  B: 'B: allowance = number of donors holding half, as a percent (up to 100%)',
  C: 'C: the live table with the top step at 100% (keeps the 50-donor rule)',
  D500: 'D $500: each donor counted up to $500',
  D1000: 'D $1,000: each donor counted up to $1,000',
  D2000: 'D $2,000: each donor counted up to $2,000',
  E: 'E: the lower of A and B',
};
// Each run as a chain of steps from R0, so every grade change gets a cause
const CHAINS = {
  R0: [['live', R0]],
  'R0+F1': [
    ['live', R0],
    ['F1 rounding', { ...R0, F1: true }],
  ],
  'R0+F2': [
    ['live', R0],
    ['F2 withheld', { ...R0, F2: true }],
  ],
};
CHAINS.R1a = [...CHAINS['R0+F1'], ['F2 withheld', R1a]];
for (const fix of ['F8cov', 'F8split', 'F9', 'F11']) {
  CHAINS[`R1a+${fix}`] = [...CHAINS.R1a, [fix, { ...R1a, [fix]: true }]];
}
CHAINS.R1b = [
  ...CHAINS.R1a,
  ['F8 coverage', { ...R1a, F8cov: true }],
  ['F8 FEC split', { ...R1a, F8cov: true, F8split: true }],
  ['F9 credit cap', { ...R1a, F8cov: true, F8split: true, F9: true }],
  ['F11 donor count', R1b],
];
CHAINS.R2 = [...CHAINS.R1b, ['bar removed', R2]];
CHAINS.R3 = [...CHAINS.R2, ['new denominator', R3]];
for (const [k, v] of Object.entries(VARIANTS)) {
  if (k !== 'R3') {
    CHAINS[k] = [...CHAINS.R3, [`allowance ${k}`, v]];
  }
}
const GRID = {};
for (const k of Object.keys(VARIANTS)) {
  for (const credit of [0, 0.5, 1]) {
    for (const trace of [1, 2]) {
      const key = `${k} c${credit * 100} t${trace}`;
      GRID[key] = { ...VARIANTS[k], credit, trace };
      CHAINS[key] = [
        ...CHAINS[k],
        ...(credit !== 0.5 ? [[`credit ${credit * 100}%`, { ...VARIANTS[k], credit }]] : []),
        ...(trace !== 2 ? [[`trace ${trace} step`, GRID[key]]] : []),
      ];
    }
  }
}

const cache = new Map();
const run = cfg => {
  const key = JSON.stringify(cfg);
  if (!cache.has(key)) {
    cache.set(key, runGrid(inputs, cfg));
  }
  return cache.get(key);
};
const scoreFor = (r, cfg) =>
  isLetter(r?.tier) ? (cfg.F1 ? r.score : (r.x ?? r.score)) - (r.bar || 0) : null;

/** The steps along a run's chain where a member's grade changed. */
function causes(name, id, fromStep = 0) {
  const chain = CHAINS[name];
  const tags = [];
  for (let i = Math.max(1, fromStep); i < chain.length; i++) {
    const a = run(chain[i - 1][1]).results.get(id);
    const b = run(chain[i][1]).results.get(id);
    if (a?.tier !== b?.tier) {
      tags.push(`${chain[i][0]} (${a?.tier}→${b?.tier})`);
    }
  }
  return tags.join('; ') || 'score only';
}
const stepIndex = (name, cfg) =>
  CHAINS[name].findIndex(([, c]) => JSON.stringify(c) === JSON.stringify(cfg));

function distribution(results) {
  const t = {};
  for (const r of results.values()) {
    const k = isLetter(r.tier) ? r.tier : `? ${r.reason || r.tier}`;
    t[k] = (t[k] || 0) + 1;
  }
  const letters = LETTERS.map(l => `${l}${t[l] || 0}`).join(' ');
  const other = Object.entries(t)
    .filter(([k]) => !isLetter(k))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return { counts: t, text: `${letters}${other ? ` · withheld: ${other}` : ''}` };
}

function compare(aCfg, bCfg) {
  const a = run(aCfg).results;
  const b = run(bCfg).results;
  const ids = [...a.keys()].filter(id => isLetter(a.get(id)?.tier) && isLetter(b.get(id)?.tier));
  const rho = spearman(
    ids.map(id => scoreFor(a.get(id), aCfg)),
    ids.map(id => scoreFor(b.get(id), bCfg))
  );
  const two = ids.filter(id => Math.abs(RANK[a.get(id).tier] - RANK[b.get(id).tier]) >= 2);
  const changed = [...a.keys()].filter(id => a.get(id)?.tier !== b.get(id)?.tier);
  return { rho, two, changed, ids };
}

// --- PACs: kinds, given money, named checks ---
const pacGiven = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of m.gifts || []) {
    pacGiven.set(id, (pacGiven.get(id) || 0) + amt);
  }
}
function kindOf(p) {
  const k = pacType(p?.type, p?.designation);
  if (k === 'lobbyist' || k === 'group') {
    return (
      { L: 'union', C: 'company', W: 'company', T: 'trade group', M: 'membership group' }[
        p?.orgType
      ] || 'other group'
    );
  }
  return (
    {
      politician: "other politicians'",
      super: 'super',
      hybrid: 'hybrid',
      campaign: "other candidates' campaigns",
    }[k] || k
  );
}
function pacAverages(cfg) {
  const { shares } = run(cfg);
  const t = {};
  for (const [id, given] of pacGiven) {
    const k = kindOf(inputs.pacs[id]);
    const s = shares.get(id)?.[cfg.trace] || 0;
    t[k] ||= { given: 0, people: 0 };
    t[k].given += given;
    t[k].people += given * s;
  }
  return Object.fromEntries(
    Object.entries(t).map(([k, v]) => [k, { given: v.given, share: v.people / v.given }])
  );
}
const largest = pred =>
  [...pacGiven.entries()]
    .filter(([id]) => pred(inputs.pacs[id] || {}))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
const NAMED = {
  "Lockheed Martin's PAC": largest(p => /LOCKHEED MARTIN/.test(p.name || '')),
  'Largest union PAC': largest(p => kindOf(p) === 'union'),
  'Largest trade-group PAC': largest(p => kindOf(p) === 'trade group'),
  'Largest leadership PAC': largest(p => p.designation === 'D'),
};

// --- CSV ---
function csv(name, cfg, chainName) {
  const { results } = run(cfg);
  const cols = [
    'id',
    'name',
    'party',
    'state',
    's',
    'b',
    'p',
    'y',
    'own',
    'denominator',
    'n',
    'N',
    'n_over_N',
    'allowance',
    'cap',
    'reliable',
    'fallback',
    'share_from_n_biggest',
    'counted_from_people',
    'credit_dollars',
    'credit_points',
    'bar',
    'score_unrounded',
    'score',
    'grade',
    'cause',
  ];
  const rows = [cols.join(',')];
  for (const m of inputs.members) {
    const r = results.get(m.id);
    const cell = v =>
      v === null || v === undefined
        ? ''
        : typeof v === 'number'
          ? String(Math.round(v * 10000) / 10000)
          : `"${String(v).replace(/"/g, '""')}"`;
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
        r.own,
        r.denominator,
        r.n,
        r.N,
        r.nN,
        r.allowance,
        r.cap,
        r.reliable,
        r.fallback,
        r.topShare,
        r.fromPeople,
        r.creditDollars,
        r.credit,
        r.bar,
        r.x,
        r.score,
        r.tier,
        causes(chainName, m.id),
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, `${name}.csv`), rows.join('\n'));
}

// ===================== The checks first =====================
const results = {};
const R0r = run(R0).results;

// R0 against the production code's own grade on the same snapshot
const parity = inputs.members.filter(m => {
  const r = R0r.get(m.id);
  return (
    personLevel(m) && (r.tier !== m.grade?.tier || (isLetter(r.tier) && r.score !== m.grade?.score))
  );
});
// R0 against the live (published) grade, with what changed in between
const liveRows = new Map(
  inputs.live.map(l => [l.bioguide_id, { ...l, grade: JSON.parse(l.grade || 'null') }])
);
const mismatches = [];
for (const m of inputs.members) {
  const r = R0r.get(m.id);
  const pub = m.published || {};
  if (r.tier === pub.tier && (!isLetter(r.tier) || r.score === pub.score)) {
    continue;
  }
  const live = liveRows.get(m.id);
  const lf = live?.grade?.personFigures || {};
  const changed = [];
  if (!live) {
    changed.push('no live result to compare');
  }
  const money = x => usd(num(x));
  const diff = (label, a, b, { tol = 1, fmt = money } = {}) => {
    if (live && Math.abs(num(a) - num(b)) > tol) {
      changed.push(`${label} ${fmt(a)} → ${fmt(b)}`);
    }
  };
  const count = x => String(num(x));
  diff('raised', lf.totalRaised, m.pf.totalRaised);
  diff('small', lf.grassrootsDonations, m.pf.grassrootsDonations);
  diff('big', lf.largeDonorDonations, m.pf.largeDonorDonations);
  diff('PAC', lf.pacMoney, m.pf.pacMoney);
  diff('party', lf.partyMoney, m.pf.partyMoney);
  diff(
    'own',
    num(lf.ownMoney?.contributions) + num(lf.ownMoney?.loans),
    num(m.pf.ownMoney?.contributions) + num(m.pf.ownMoney?.loans)
  );
  diff('big donors', live?.donors, m.analysis?.uniqueDonors, { tol: 0, fmt: count });
  diff('donors holding half', live?.nakamoto, m.analysis?.nakamotoCoefficient, {
    tol: 0,
    fmt: count,
  });
  diff(
    'PAC gifts',
    live?.pacGifts,
    (m.gifts || []).reduce((t, [, a]) => t + a, 0)
  );
  // What the PAC gifts count for depends on each PAC's own donors and
  // receipts, which change with every bulk file
  diff("PAC money counted as people's", live?.pacCounted, r.creditDollars);
  diff('PAC bar', live?.grade?.detail?.transparencyPenalty, r.bar, { tol: 0, fmt: count });
  mismatches.push({
    id: m.id,
    name: m.name,
    live: `${pub.tier} ${pub.score ?? ''}`,
    r0: `${r.tier} ${r.score ?? ''}`,
    changed,
  });
}
const unexplained = mismatches.filter(x => !x.changed.length);
results.checks = {
  parity: parity.map(m => m.id),
  mismatches,
  unexplained: unexplained.map(x => x.id),
};

// ===================== Report =====================
const snap = inputs.snapshot || {};
say('# TFP simplification simulation');
say('');
say(
  `Snapshot captured ${snap.capturedAt || '?'} (finished ${snap.finishedAt || '?'}). FEC bulk files: ${Object.entries(
    snap.files || {}
  )
    .map(([k, v]) => `${k} ${v.lastModified}`)
    .join('; ')}. Committee totals: the FEC API at capture. Every run below uses this one snapshot.`
);
say('');
say(
  '"Allowance": the share of what people gave that big donations (over $200) may make up before the rest stops counting.'
);
say('');
if (unexplained.length || parity.length) {
  say(
    `**STOP.** ${parity.length} member(s) where the simulation's live rules disagree with the production code, and ${unexplained.length} where R0 differs from the live grade with no changed input. Nothing below is reliable until these are explained.`
  );
  say('');
}

// ---- One-page summary ----
say('## Summary');
say('');
say('Tier distribution per variant (credit 50%, PAC money traced 2 steps back):');
say('');
say('| Run | S | A | B | C | D | E | F | withheld |');
say('|---|---|---|---|---|---|---|---|---|');
const summaryRuns = [
  ['R0 (live rules)', R0],
  ['R1b (fixes)', R1b],
  ['R2 (no bar)', R2],
  ...Object.entries(VARIANTS).map(([k, v]) => [k === 'R3' ? 'R3 (new denominator)' : k, v]),
];
for (const [label, cfg] of summaryRuns) {
  const d = distribution(run(cfg).results).counts;
  const withheld = Object.entries(d)
    .filter(([k]) => !isLetter(k))
    .reduce((t, [, v]) => t + v, 0);
  say(`| ${label} | ${LETTERS.map(l => d[l] || 0).join(' | ')} | ${withheld} |`);
}
say('');
say('Reference members (grade and score):');
say('');
say(`| Member | ${summaryRuns.map(([l]) => l.split(' ')[0]).join(' | ')} |`);
say(`|---|${summaryRuns.map(() => '---').join('|')}|`);
for (const [id, name] of Object.entries(REFERENCE)) {
  say(
    `| ${name} | ${summaryRuns
      .map(([, cfg]) => {
        const r = run(cfg).results.get(id);
        return r ? `${r.tier}${isLetter(r.tier) ? ` ${r.score}` : ''}` : '–';
      })
      .join(' | ')} |`
  );
}
say('');
say('Company vs union PACs: share of their money that traces back to people (dollar-weighted):');
say('');
say('| Run | Union | Company | Gap |');
say('|---|---|---|---|');
for (const [label, cfg] of summaryRuns) {
  const a = pacAverages(cfg);
  say(
    `| ${label} | ${pct(a.union?.share)} | ${pct(a.company?.share)} | ${((a.union?.share - a.company?.share) * 100).toFixed(0)} pts |`
  );
}
say('');

// ---- Checks ----
say('## Checks');
say('');
say(
  `- The simulation's live rules against the production code, same snapshot: ${parity.length ? `**${parity.length} differ**: ${parity.map(m => m.name).join('; ')}` : 'identical for every member graded on all committees'}.`
);
say(
  `- R0 against the live grades: ${mismatches.length} differ; ${unexplained.length} with no changed input${unexplained.length ? ` (**${unexplained.map(x => x.name).join('; ')}**)` : ''}.`
);
for (const x of mismatches) {
  say(
    `  - ${x.name}: live ${x.live}, R0 ${x.r0}. Changed: ${x.changed.join(', ') || 'nothing found'}.`
  );
}
const g6 = [...R0r.values()].filter(r => r.g6).length;
say(
  `- Gate G6 (donations above receipts, not verified at source): ${g6} members in R0; unreachable by construction from R3 on (donations can't exceed money given). Gate G7 (no PAC data and unreliable donor data): 0, since every member graded here has the complete PAC list.`
);
const letters0 = [...R0r.values()].filter(r => isLetter(r.tier)).length;
const withheld0 = [...R0r.entries()].filter(([, r]) => !isLetter(r.tier));
say(
  `- ${inputs.members.length} members graded; ${letters0} letter grades; withheld: ${withheld0.map(([id, r]) => `${byId.get(id).name} (${r.reason || r.tier})`).join('; ')}.`
);
say('');

// ---- Snapshot flags ----
say('## Records behind the FEC totals');
say('');
const flags = inputs.flags || [];
const missingBy = new Map(flags.map(f => [f.id, f.missingItemized]));
const memberFlags = flags.filter(f => f.member);
const pacFlags = flags.filter(f => !f.member);
say(
  `${flags.length} committees' FEC totals include a report whose big-donor records our files don't have yet: ${memberFlags.length} of members' own committees and ${pacFlags.length} PACs. Most are reports filed in the days before the snapshot (October quarterly and monthly); some are amended older reports, which a new filing number makes look missing, so the missing amounts are an upper bound. The FEC totals are what the grade divides by; the records are what the donor test is measured on. The allowance can change only through the coverage test (records at least half the FEC's big-donor total), so that test was rerun with the missing reports left out.`
);
say('');
{
  const cfgs = [['R1b', R1b], ...Object.entries(VARIANTS)];
  say(
    '| Run | Members whose allowance changes | PACs whose allowance changes | Grades that change |'
  );
  say('|---|---|---|---|');
  for (const [label, cfg] of cfgs) {
    const alt = { ...cfg, withoutMissing: missingBy };
    const a = run(cfg);
    const b = run(alt);
    const members = inputs.members.filter(
      m => a.results.get(m.id)?.reliable !== b.results.get(m.id)?.reliable
    );
    const pacsChanged = [...a.shares.keys()].filter(
      id => a.shares.get(id)?.fallback !== b.shares.get(id)?.fallback
    );
    const grades = inputs.members.filter(
      m => a.results.get(m.id)?.tier !== b.results.get(m.id)?.tier
    );
    say(
      `| ${label} | ${members.length}${members.length ? `: ${members.map(m => m.name).join('; ')}` : ''} | ${pacsChanged.length} | ${grades.length}${grades.length ? `: ${grades.map(m => `${m.name} ${a.results.get(m.id).tier}→${b.results.get(m.id).tier}`).join('; ')}` : ''} |`
    );
  }
  say('');
  say("Members' own committees flagged:");
  say('');
  say('| Committee | Member | Latest report | Missing big-donor money (upper bound) |');
  say('|---|---|---|---|');
  for (const f of memberFlags) {
    const owners = inputs.members.filter(m => (m.pf.committees || []).some(c => c.id === f.id));
    say(
      `| ${f.id} | ${owners.map(m => m.name).join(', ')} | ${f.latestReport || ''} | ${usd(f.missingItemized)} |`
    );
  }
  say('');
}

// ---- The ladder ----
say('## The ladder');
say('');
const ladder = [
  ['R0', R0, 'live rules on the snapshot'],
  ['R1a', R1a, 'R0 + F1 (grade on the rounded score) + F2 (withhold the 4 mixed-source grades)'],
  [
    'R1b',
    R1b,
    "R1a + F8 (PAC coverage check and the FEC's own small/big split) + F9 (credit cap) + F11 (donors who net above $0)",
  ],
  ['R2', R2, 'R1b + the whole PAC bar removed'],
  ['R3', R3, 'R2 + denominator = money given by others (small + big + PAC + party)'],
];
for (const [name, cfg, words] of ladder) {
  reportRun(name, cfg, words, name === 'R0' || name === 'R1a' || name === 'R1b' ? R0 : R1b);
}

say('### Each fix on its own');
say('');
say('| Fix | Grades changed | Members |');
say('|---|---|---|');
for (const [label, cfg, base] of [
  ['F1 grade on the rounded score', { ...R0, F1: true }, R0],
  ['F2 withhold mixed-source grades', { ...R0, F2: true }, R0],
  ['F8 coverage check for PACs', { ...R1a, F8cov: true }, R1a],
  ["F8 the FEC's own small/big split for PACs", { ...R1a, F8split: true }, R1a],
  ['F9 credit cap', { ...R1a, F9: true }, R1a],
  ['F11 donors who net above $0', { ...R1a, F11: true }, R1a],
]) {
  const c = compare(base, cfg).changed;
  say(
    `| ${label} | ${c.length}${c.length ? '' : ' (changes no grade)'} | ${c
      .slice(0, 40)
      .map(
        id =>
          `${byId.get(id).name} ${run(base).results.get(id).tier}→${run(cfg).results.get(id).tier}`
      )
      .join('; ')}${c.length > 40 ? ' …' : ''} |`
  );
}
say('');

// ---- Variants ----
say('## Concentration variants (on R3; credit 50%, traced 2 steps back)');
say('');
for (const [k, cfg] of Object.entries(VARIANTS)) {
  if (k !== 'R3') {
    reportRun(k, cfg, VARIANT_WORDS[k], R1b);
  }
}

// C vs R3: the ceiling alone
{
  const c = compare(R3, VARIANTS.C).changed;
  say('### Removing the 50% ceiling alone (C against R3)');
  say('');
  say(
    `${c.length} grades change: ${c.map(id => `${byId.get(id).name} ${R3r(id).tier}→${run(VARIANTS.C).results.get(id).tier}`).join('; ')}.`
  );
  say('');
}
function R3r(id) {
  return run(R3).results.get(id);
}

// A: big jumps, and small donor bases
{
  const a = run(VARIANTS.A).results;
  const b = run(R1b).results;
  const jumps = inputs.members.filter(
    m =>
      isLetter(a.get(m.id)?.tier) &&
      isLetter(b.get(m.id)?.tier) &&
      RANK[a.get(m.id).tier] - RANK[b.get(m.id).tier] >= 2
  );
  say('### Variant A: members two or more grades up from R1b');
  say('');
  say(
    `${jumps.length} members. ${jumps
      .map(m => {
        const r = a.get(m.id);
        return `${m.name} ${b.get(m.id).tier}→${r.tier} (${r.n} of ${r.N} donors held half; they gave ${pct(r.topShare)} of all the money)`;
      })
      .join('; ')}.`
  );
  say('');
  const small = inputs.members.filter(m => {
    const r = a.get(m.id);
    return r.N !== undefined && r.N < 50;
  });
  say('### Members with fewer than 50 big donors');
  say('');
  say(
    `${small.length} members. ${small
      .map(m => {
        const r = a.get(m.id);
        return `${m.name} (${r.N} donors; R1b ${b.get(m.id).tier}, A ${r.tier})`;
      })
      .join('; ')}.`
  );
  say('');
}

// Fallback and the records-only grades (amendment 4)
say('## Unreliable donor data');
say('');
say('| Run | Members on the fallback allowance (40%) | PACs on it (of those that gave) |');
say('|---|---|---|');
for (const [label, cfg] of summaryRuns) {
  const { results: rs, shares } = run(cfg);
  const members = [...rs.values()].filter(r => r.fallback).length;
  const pacsFallback = [...pacGiven.keys()].filter(id => shares.get(id)?.fallback).length;
  say(`| ${label} | ${members} | ${pacsFallback} of ${pacGiven.size} |`);
}
say('');
const coverageFallback = inputs.members.filter(m => {
  const r = run(R1b).results.get(m.id);
  return r?.fallback && r.N >= 10 && !r.covered;
});
say(
  `Members on the fallback because our records cover under half of their FEC big-donor total: ${coverageFallback.map(m => m.name).join('; ') || 'none'}. Their grades with concentration measured on the records we have:`
);
say('');
say(`| Member | ${Object.keys(VARIANTS).join(' | ')} |`);
say(
  `|---|${Object.keys(VARIANTS)
    .map(() => '---')
    .join('|')}|`
);
for (const m of coverageFallback) {
  say(
    `| ${m.name} | ${Object.values(VARIANTS)
      .map(cfg => {
        const was = run(cfg).results.get(m.id);
        const now = run({ ...cfg, recordsOnly: true }).results.get(m.id);
        return `${was.tier}→${now.tier}`;
      })
      .join(' | ')} |`
  );
}
say('');

// F2 side table
say('## The 4 mixed-source grades, with the transfer check fixed');
say('');
const g3 = inputs.members.filter(m => !personLevel(m));
say(`| Member | Live | ${Object.keys(VARIANTS).join(' | ')} |`);
say(
  `|---|---|${Object.keys(VARIANTS)
    .map(() => '---')
    .join('|')}|`
);
for (const m of g3) {
  say(
    `| ${m.name} | ${m.published?.tier} ${m.published?.score ?? ''} | ${Object.values(VARIANTS)
      .map(cfg => {
        const r = gradeOne(m, inputs.pacs, run(cfg).shares, cfg, { ignoreInvariant: true });
        return `${r.tier} ${r.score ?? ''}`;
      })
      .join(' | ')} |`
  );
}
say('');

// Untraced money
say('## Money that is never traced');
say('');
{
  let party = 0;
  let campaigns = 0;
  let jfc = 0;
  let given = 0;
  const rows = [];
  for (const m of inputs.members) {
    const r = R3r(m.id);
    if (!r?.denominator) {
      continue;
    }
    const c = (m.gifts || [])
      .filter(([id]) => kindOf(inputs.pacs[id]) === "other candidates' campaigns")
      .reduce((t, [, a]) => t + a, 0);
    const v = (m.pf.committees || [])
      .filter(x => x.role === 'campaign' || x.role === 'leadership')
      .reduce((t, x) => t + num(x.pac), 0);
    const j = Math.max(0, num(m.pf.pacMoney) - v);
    party += num(m.pf.partyMoney);
    campaigns += c;
    jfc += j;
    given += r.denominator;
    rows.push([m, num(m.pf.partyMoney) / r.denominator, c / r.denominator, j / r.denominator]);
  }
  say(
    `Across all members: party money ${usd(party)} (${pct(party / given, 1)} of money given), other candidates' campaigns ${usd(campaigns)} (${pct(campaigns / given, 1)}), PAC money through joint funds ${usd(jfc)} (${pct(jfc / given, 1)}). Per member in the CSVs; the largest:`
  );
  say('');
  rows.sort((a, b) => b[1] + b[2] + b[3] - (a[1] + a[2] + a[3]));
  for (const [m, a, b, c] of rows.slice(0, 15)) {
    say(
      `- ${m.name}: party ${pct(a, 1)}, other campaigns ${pct(b, 1)}, PAC money through joint funds ${pct(c, 1)}`
    );
  }
  say('');
  say(
    "Counting all three as if every dollar came from people (the most tracing could ever add), at each run's credit; members whose grade changes:"
  );
  say('');
  for (const [k, cfg] of Object.entries(VARIANTS)) {
    const c = compare(cfg, { ...cfg, untracedAsPeople: true }).changed;
    say(
      `- ${k}: ${c.length}${c.length ? `: ${c.map(id => `${byId.get(id).name} ${run(cfg).results.get(id).tier}→${run({ ...cfg, untracedAsPeople: true }).results.get(id).tier}`).join('; ')}` : ''}`
    );
  }
  say('');
}

// PACs
say('## PACs');
say('');
say(
  "Average share of each kind's money that traces back to people (dollar-weighted by money given to members):"
);
say('');
const kinds = Object.keys(pacAverages(R0)).sort(
  (a, b) => pacAverages(R0)[b].given - pacAverages(R0)[a].given
);
say(`| Run | ${kinds.join(' | ')} |`);
say(`|---|${kinds.map(() => '---').join('|')}|`);
for (const [label, cfg] of summaryRuns) {
  const a = pacAverages(cfg);
  say(`| ${label} | ${kinds.map(k => pct(a[k]?.share)).join(' | ')} |`);
}
say('');
say('Named PACs (share of their money that traces back to people):');
say('');
say(`| PAC | Given to members | ${summaryRuns.map(([l]) => l.split(' ')[0]).join(' | ')} |`);
say(`|---|---|${summaryRuns.map(() => '---').join('|')}|`);
for (const [label, id] of Object.entries(NAMED)) {
  if (!id) {
    continue;
  }
  say(
    `| ${label}: ${inputs.pacs[id]?.name} | ${usd(pacGiven.get(id))} | ${summaryRuns.map(([, cfg]) => pct(run(cfg).shares.get(id)?.[cfg.trace])).join(' | ')} |`
  );
}
say('');
say("Top employer's share of a PAC's donor money (PACs with 10+ donors; measurement only):");
say('');
say('| Kind | PACs | Median | 25th pct | 75th pct | Over half |');
say('|---|---|---|---|---|---|');
for (const kind of [
  'company',
  'union',
  'trade group',
  'membership group',
  'other group',
  "other politicians'",
]) {
  const xs = [...pacGiven.keys()]
    .map(id => inputs.pacs[id])
    .filter(
      p =>
        p &&
        kindOf(p) === kind &&
        (p.profile?.donors || 0) >= 10 &&
        p.extras?.topEmployerShare !== null &&
        p.extras?.topEmployerShare !== undefined
    )
    .map(p => p.extras.topEmployerShare)
    .sort((a, b) => a - b);
  if (!xs.length) {
    continue;
  }
  const q = f => xs[Math.min(xs.length - 1, Math.floor(xs.length * f))];
  say(
    `| ${kind} | ${xs.length} | ${pct(q(0.5))} | ${pct(q(0.25))} | ${pct(q(0.75))} | ${pct(xs.filter(x => x > 0.5).length / xs.length)} |`
  );
}
say('');

// Stage 2 grid
say('## Credit and tracing (every variant)');
say('');
say(
  '| Variant | Credit | Steps back | S | A | B | C | D | E | F | Rank corr. vs R1b | 2+ grades vs R1b |'
);
say('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [key, cfg] of Object.entries(GRID)) {
  const d = distribution(run(cfg).results).counts;
  const c = compare(R1b, cfg);
  const [v, cr, tr] = key.split(' ');
  say(
    `| ${v} | ${cr.slice(1)}% | ${tr.slice(1)} | ${LETTERS.map(l => d[l] || 0).join(' | ')} | ${c.rho?.toFixed(3)} | ${c.two.length} |`
  );
}
say('');

// Itemization periods
say('## Itemization periods (FEC source)');
say('');
say(
  '11 CFR 104.3(a)(4)(i) (eCFR, read 2026-10-11): a committee reports "each person, other than any political committee, who makes a contribution to the reporting political committee during the reporting period, whose contribution or contributions aggregate in excess of $200 per calendar year (or per election cycle in the case of an authorized committee)". So a candidate\'s campaign (an authorized committee) itemizes a donor once they pass $200 in the two-year election cycle; a PAC once they pass $200 in a calendar year. A donor giving a PAC $150 in each year is never itemized; the same gifts to a campaign would be.'
);
say('');

// ---- CSVs ----
for (const [name, cfg] of [
  ['R0', R0],
  ['R1a', R1a],
  ['R1b', R1b],
  ['R2', R2],
  ['R3', R3],
  ...Object.entries(VARIANTS).filter(([k]) => k !== 'R3'),
]) {
  csv(name, cfg, name);
}
{
  const rows = ['run,id,name,score_unrounded,score,bar,grade'];
  for (const [key, cfg] of Object.entries(GRID)) {
    const rs = run(cfg).results;
    for (const m of inputs.members) {
      const r = rs.get(m.id);
      rows.push(
        [`"${key}"`, m.id, `"${m.name}"`, r.x ?? '', r.score ?? '', r.bar ?? '', r.tier].join(',')
      );
    }
  }
  writeFileSync(join(outDir, 'grid.csv'), rows.join('\n'));
}

function reportRun(name, cfg, words, base) {
  const rs = run(cfg).results;
  say(`### ${name}: ${words}`);
  say('');
  say(`Grades: ${distribution(rs).text}.`);
  const vsR0 = compare(R0, cfg);
  const vsR1b = compare(R1b, cfg);
  say(
    `Rank correlation vs R0 ${vsR0.rho?.toFixed(3)}, vs R1b ${vsR1b.rho?.toFixed(3)}. Two or more grades moved: ${vsR0.two.length} vs R0, ${vsR1b.two.length} vs R1b.`
  );
  const ref = Object.entries(REFERENCE).map(([id, n]) => {
    const r = rs.get(id);
    return `${n} ${r?.tier}${isLetter(r?.tier) ? ` ${r.score}` : ''}`;
  });
  say(`Reference members: ${ref.join(', ')}.`);
  say('');
  const baseName = base === R0 ? 'R0' : 'R1b';
  const from = stepIndex(name, base);
  const b = run(base).results;
  const movers = inputs.members
    .map(m => ({ m, a: b.get(m.id), r: rs.get(m.id) }))
    .filter(x => isLetter(x.a?.tier) && isLetter(x.r?.tier))
    .map(x => ({ ...x, delta: scoreFor(x.r, cfg) - scoreFor(x.a, base) }))
    .sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta))
    .slice(0, 25);
  say(`The 25 largest movers vs ${baseName} (score after any bar):`);
  say('');
  say('| Member | Party | Grade | Score | Cause |');
  say('|---|---|---|---|---|');
  for (const x of movers) {
    say(
      `| ${x.m.name} | ${partyOf(x.m.party)} | ${x.a.tier}→${x.r.tier} | ${scoreFor(x.a, base).toFixed(1)}→${scoreFor(x.r, cfg).toFixed(1)} | ${causes(name, x.m.id, from + 1)} |`
    );
  }
  say('');
  results[name] = {
    distribution: distribution(rs).counts,
    rhoR0: vsR0.rho,
    rhoR1b: vsR1b.rho,
    twoR0: vsR0.two.length,
    twoR1b: vsR1b.two.length,
  };
}

writeFileSync(join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
console.log(
  `report written to ${outDir}: ${lines.length} lines; parity ${parity.length}, unexplained ${unexplained.length}`
);
