#!/usr/bin/env node
/**
 * FINAL-2 (owner, 2026-10-12), on the same frozen snapshot: the people test
 * (a PAC counts only if its sponsor's members elect its leaders, from the
 * sponsor's Form 990), NO SPONSOR at 0, gifts earmarked through a directing
 * committee counted as that committee's gift, other politicians' joint-fund
 * transfers as POLITICIAN money, and the sorting rules 6-12.
 *
 *   node scripts/simulate/report-final2.mjs --inputs FILE.inputs.json --irs DIR
 *     --final DIR (Final's Final.csv and PACs.csv) --out DIR
 *
 * Every number in the report, the plain-English summary included, is
 * computed here from the same results (none typed by hand).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  IRS_FILES,
  classifyPac,
  fecGroup,
  irsStatus,
  stripPacWords,
  loadFacts,
  loadIrsIndex,
  loadPeopleEvidence,
  peopleTest,
} from '../refresh/lib/sponsors.mjs';
import { LIVE, RANK, runGrid, spearman } from './lib/grid.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const outDir = arg('--out', 'simulation-final2');
mkdirSync(outDir, { recursive: true });

// Final's results (11 October), for "changed from Final"
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
const finalGrades = new Map(csv(join(arg('--final'), 'Final.csv')).map(r => [r.id, r]));
const finalPacs = new Map(csv(join(arg('--final'), 'PACs.csv')).map(r => [r.id, r]));

// --- Sort every PAC, and the people test ---
const conn = await (await DuckDBInstance.create(':memory:')).connect();
const irsIndex = await loadIrsIndex(
  async sql => (await conn.runAndReadAll(sql)).getRowObjects(),
  IRS_FILES.map(f => join(arg('--irs'), `${f}.csv`))
);
const facts = loadFacts();
const { forms, stated } = loadPeopleEvidence();
for (const [id, p] of Object.entries(inputs.pacs)) {
  p.sponsor = classifyPac(id, p, irsIndex, facts, p.fecRecord);
  p.byRules = classifyPac(id, p, irsIndex, {}, p.fecRecord); // without stated facts
  p.fecGroup = fecGroup(p);
  p.peopleTest = peopleTest(id, p.sponsor, forms, stated);
}

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
const FINAL_GROUP = { 'NO SPONSOR': 'nosponsor' };
const finalGroupOf = id => {
  const g = finalPacs.get(id)?.group;
  return g ? FINAL_GROUP[g] || g.toLowerCase() : null;
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

// The people test as written reads line 7a: may members elect or appoint
// one or more of the governing body? These sponsors answer Yes, but their
// own Schedule O says members elect only one director, or that the board
// is its own membership: under the stricter reading (members elect the
// leaders), BOARD. A comparison only (section 5).
const NAMED_REF = {
  C00247403: { ein: '352841377', who: 'NORPAC, the related 501(c)(4)' },
  C00193433: { ein: '461067490', who: "EMILY's List Action, the related 501(c)(4)" },
  C00710848: { ein: '833298146', who: 'Democratic Majority for Israel' },
};
const STRICT = {
  530217164: 'AIPAC: members elect one of 39 directors',
  261507828: 'J Street: members elect one of 24 directors',
  521733698: 'League of Conservation Voters: members elect one of 23 directors',
  521219782: 'National Community Action Foundation: members elect one at-large director',
  133976062: 'NRDC Action Fund: members elect one director; NRDC is its sole institutional member',
  205355252: 'Environment America: members elect one of five directors',
  132630359: 'Reproductive Freedom for All: members elect one at-large director',
  821291110: 'Onward Together: members elect one of three directors',
  208802884: 'Everytown for Gun Safety Action Fund: the board serves as the members',
  300233489:
    "Alaska Wilderness League Action: its one voting member, the League's president, appoints the board",
  900080500:
    'Environmental Defense Action Fund: the board of EDF, a related charity, chooses the directors',
  133539048:
    'Planned Parenthood Action Fund: the regular members are the board; associate members elect one director',
};

// --- The runs: a chain from the live rules to FINAL-2, one change a step ---
const E = {
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
};
const BASE = { ...E, fixedInvariant: true, noMinDonors: true };
const WHOLE = { ...BASE, wholeFunds: true };
const SORTED = {
  ...WHOLE,
  groups: {
    credit: { people: 1, nosponsor: 1 },
    source: 'tfp',
    upstreamZero: true,
  },
};
const TESTED = {
  ...WHOLE,
  groups: {
    credit: { people: 1 },
    source: 'tfp',
    upstreamZero: true,
    upstreamByCredit: true,
    peopleTest: true,
  },
};
const FUNDS = { ...TESTED, nonOwnAsPolitician: true };
const FINAL2 = { ...FUNDS, directedAsGifts: true };
const CHAIN = [
  ['the round-one rules and fixes (E, the transfer check, no donor minimum)', BASE],
  ['own joint funds in full', WHOLE],
  [
    'PAC sorting (from every PAC at half credit, as live, to TFP groups: PEOPLE and NO SPONSOR in full, BUSINESS and POLITICIAN 0; FINAL-2 rules 6-12)',
    SORTED,
  ],
  ['the people test, and NO SPONSOR at 0 (rules 1-2)', TESTED],
  ["other politicians' joint funds as POLITICIAN (rule 5)", FUNDS],
  ['earmarks through directing committees (rule 4)', FINAL2],
];
const SHORT = {
  [CHAIN[0][0]]: 'round-one rules',
  [CHAIN[1][0]]: 'own funds in full',
  [CHAIN[2][0]]: 'PAC sorting',
  [CHAIN[3][0]]: 'people test',
  [CHAIN[4][0]]: "other politicians' funds",
  [CHAIN[5][0]]: 'earmarks',
};
const cache = new Map();
const run = cfg => {
  const key = JSON.stringify(cfg);
  if (!cache.has(key)) {
    cache.set(key, runGrid(inputs, cfg));
  }
  return cache.get(key);
};
const F2 = run(FINAL2).results;
const strictPacs = Object.fromEntries(
  Object.entries(inputs.pacs).map(([id, p]) => [
    id,
    STRICT[p.peopleTest?.ein] && p.peopleTest?.elected
      ? { ...p, peopleTest: { ...p.peopleTest, elected: false } }
      : p,
  ])
);
const FS = runGrid({ ...inputs, pacs: strictPacs }, FINAL2).results;
const shares = run(FINAL2).shares;
const scoreOf = r => (isLetter(r?.tier) ? r.score : null);
const tierOf = (step, id) =>
  step < 0 ? byId.get(id)?.published?.tier : run(CHAIN[step][1]).results.get(id)?.tier;
const counts = results => {
  const t = {};
  for (const r of results.values()) {
    const k = isLetter(r.tier) ? r.tier : '?';
    t[k] = (t[k] || 0) + 1;
  }
  return t;
};
// What moved a member from Final: the steps from PAC sorting on
function causes(id) {
  const tags = [];
  const fin = finalGrades.get(id);
  const sorted = run(SORTED).results.get(id);
  if (fin && isLetter(fin.grade) && Math.abs(num(sorted?.score) - num(fin.score)) >= 1) {
    tags.push(`sorting since Final (${fin.score}→${sorted?.score})`);
  }
  for (let i = 3; i < CHAIN.length; i++) {
    const a = run(CHAIN[i - 1][1]).results.get(id);
    const b = run(CHAIN[i][1]).results.get(id);
    if (a?.tier !== b?.tier || Math.abs(num(b?.x) - num(a?.x)) >= 1) {
      tags.push(`${SHORT[CHAIN[i][0]]} (${a?.score}→${b?.score})`);
    }
  }
  return tags.join('; ') || 'rounding';
}
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

// PAC money to members (gifts to campaigns, leadership PACs and own funds)
const pacGiven = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of [...(m.gifts || []), ...(m.giftsToFunds || [])]) {
    pacGiven.set(id, (pacGiven.get(id) || 0) + amt);
  }
}
// Directed gifts, by directing committee (the donor test's own figures)
const directedTo = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of Object.entries(m.shapeDirected?.directedOut || {})) {
    if (amt > 0) {
      const d = directedTo.get(id) || { amount: 0, members: new Map() };
      d.amount += amt;
      d.members.set(m.name, (d.members.get(m.name) || 0) + amt);
      directedTo.set(id, d);
    }
  }
}
const allGiven = [...pacGiven.values()].reduce((t, v) => t + v, 0);
const groupOf = id => {
  const p = inputs.pacs[id];
  const g = p?.sponsor?.group || 'nosponsor';
  return g !== 'people'
    ? g
    : p.peopleTest?.elected === true
      ? 'people'
      : p.peopleTest?.elected === false
        ? 'board'
        : 'untested';
};
const countsFor = id => (groupOf(id) === 'people' ? shares.get(id)?.[2] || 0 : 0);
const pacName = id => inputs.pacs[id]?.name || conduitName(id);
function conduitName(id) {
  for (const m of inputs.members) {
    const c = (m.conduits || []).find(x => x.id === id);
    if (c) {
      return c.name;
    }
  }
  return id;
}

// ===================== Report =====================
const snap = inputs.snapshot || {};
const fl = inputs.fetchedLive || [];
say('# FINAL-2');
say('');
say(
  `Same snapshot (captured ${snap.capturedAt}; FEC bulk files dated 11 October), exported again from the final-grading branch with what FINAL-2 needs: the donor test without directed gifts, each joint fund's mix, the directing committees traced, and sponsors that are committees. ${fl.length} FEC answers the snapshot lacked were fetched live${fl.length ? ` (${fl[0].at} to ${fl.at(-1).at})` : ''}. IRS master file dated 7 September 2026; Forms 990 from the IRS e-file archive (returns filed 2023 to 2026).`
);
say('');

// ---- Plain English (every figure computed below) ----
const c2 = counts(F2);
const live = inputs.members.map(m => m.published?.tier);
const vsLive = upDown(
  id => byId.get(id)?.published?.tier,
  id => F2.get(id)?.tier
);
const vsFinal = upDown(
  id => finalGrades.get(id)?.grade,
  id => F2.get(id)?.tier
);
const withheld = inputs.members.filter(m => !isLetter(F2.get(m.id)?.tier));
const peopleN = [...pacGiven.keys()].filter(id => groupOf(id) === 'people');
const boardN = [...pacGiven.keys()].filter(id => groupOf(id) === 'board');
const untestedN = [...pacGiven.keys()].filter(id => groupOf(id) === 'untested');
const sumOf = ids => ids.reduce((t, id) => t + (pacGiven.get(id) || 0), 0);
const countedPac = [...pacGiven].reduce((t, [id, a]) => t + a * countsFor(id), 0);
const countedDirected = [...directedTo].reduce((t, [id, d]) => t + d.amount * countsFor(id), 0);
say('## In plain English');
say('');
say(
  `- **Grades:** S ${c2.S || 0}, A ${c2.A || 0}, B ${c2.B || 0}, C ${c2.C || 0}, D ${c2.D || 0}, E ${c2.E || 0}, F ${c2.F || 0}. ${withheld.length} withheld${withheld.length ? ` (${withheld.map(m => `${m.name}: ${F2.get(m.id).reason || F2.get(m.id).tier}`).join('; ')})` : ''}.`
);
say(
  `- **Against the live grades:** Democrats ${vsLive.D.up} of ${vsLive.D.of} up, ${vsLive.D.down} down; Republicans ${vsLive.R.up} of ${vsLive.R.of} up, ${vsLive.R.down} down.`
);
say(
  `- **Against Final:** Democrats ${vsFinal.D.up} up, ${vsFinal.D.down} down; Republicans ${vsFinal.R.up} up, ${vsFinal.R.down} down. ${inputs.members.filter(m => finalGrades.get(m.id)?.grade !== F2.get(m.id)?.tier).length} grades differ from Final.`
);
say(
  `- **PAC money that counts:** only PACs whose sponsor's members elect its leaders: ${peopleN.length} PACs, ${usdM(sumOf(peopleN))} given to members, of which ${usdM(countedPac)} traces to people and counts. ${boardN.length} PACs (${usdM(sumOf(boardN))}) answer to a board their members don't elect; ${untestedN.length} (${usdM(sumOf(untestedN))}) couldn't be tested and count 0 for now. Everything else (business, politicians, no sponsor, parties) counts 0.`
);
say(
  `- **Earmarks:** ${usdM([...directedTo.values()].reduce((t, d) => t + d.amount, 0))} in gifts directed by ${directedTo.size} committees left the members' big-donor money and donor tests; ${usdM(countedDirected)} of it counts, through directing committees that pass the people test.`
);
say('');

// 14. Tiers and reference members
say('## 1. Grades');
say('');
{
  const cF = {};
  for (const r of finalGrades.values()) {
    const k = isLetter(r.grade) ? r.grade : '?';
    cF[k] = (cF[k] || 0) + 1;
  }
  const cL = {};
  for (const t of live) {
    const k = isLetter(t) ? t : '?';
    cL[k] = (cL[k] || 0) + 1;
  }
  say('| Run | S | A | B | C | D | E | F | withheld |');
  say('|---|---|---|---|---|---|---|---|---|');
  say(`| Live | ${LETTERS.map(l => cL[l] || 0).join(' | ')} | ${cL['?'] || 0} |`);
  say(`| Final (11 Oct) | ${LETTERS.map(l => cF[l] || 0).join(' | ')} | ${cF['?'] || 0} |`);
  say(`| **FINAL-2** | ${LETTERS.map(l => `**${c2[l] || 0}**`).join(' | ')} | ${c2['?'] || 0} |`);
  const cS = counts(FS);
  say(
    `| FINAL-2, stricter reading of line 7a (section 5) | ${LETTERS.map(l => cS[l] || 0).join(' | ')} | ${cS['?'] || 0} |`
  );
  say('');
  say('Reference members:');
  say('');
  say('| Member | Live | Final | FINAL-2 | From people | PACs counted | Directed gifts counted |');
  say('|---|---|---|---|---|---|---|');
  for (const [id, name] of Object.entries(REFERENCE)) {
    const m = byId.get(id);
    const r = F2.get(id);
    const f = finalGrades.get(id);
    say(
      `| ${name} | ${m.published?.tier} ${m.published?.score ?? ''} | ${f?.grade} ${f?.score} | ${r.tier} ${r.score ?? ''} | ${pct(r.fromPeople / r.denominator)} | ${pct(r.creditDollars / r.denominator)} | ${pct(r.earmarkDollars / r.denominator)} |`
    );
  }
  say('');
  const fundsOf = m =>
    (m.pf.committees || [])
      .filter(c => c.role === 'joint' && c.ownFund)
      .reduce((t, c) => t + num(c.raised), 0);
  const top = inputs.members
    .map(m => ({ m, raised: fundsOf(m) }))
    .filter(x => x.raised > 0)
    .sort((a, b) => b.raised - a.raised)
    .slice(0, 10);
  say('The 10 members whose own joint funds raised the most:');
  say('');
  say('| Member | Party | Own funds raised | Money given | Live | Final | FINAL-2 |');
  say('|---|---|---|---|---|---|---|');
  for (const { m, raised } of top) {
    const r = F2.get(m.id);
    const f = finalGrades.get(m.id);
    say(
      `| ${m.name} | ${partyOf(m.party)} | ${usdM(raised)} | ${usdM(r.denominator || 0)} | ${m.published?.tier} ${m.published?.score ?? ''} | ${f?.grade} ${f?.score} | ${r.tier} ${r.score ?? ''} |`
    );
  }
  say('');
}

// Movers against Final
say('## 2. The 25 largest movers against Final');
say('');
{
  const movers = inputs.members
    .filter(m => isLetter(finalGrades.get(m.id)?.grade) && isLetter(F2.get(m.id)?.tier))
    .map(m => ({ m, d: scoreOf(F2.get(m.id)) - num(finalGrades.get(m.id).score) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 25);
  say('| Member | Party | Grade | Score | Cause |');
  say('|---|---|---|---|---|');
  for (const { m } of movers) {
    const f = finalGrades.get(m.id);
    say(
      `| ${m.name} | ${partyOf(m.party)} | ${f.grade}→${F2.get(m.id).tier} | ${f.score}→${F2.get(m.id).score} | ${causes(m.id)} |`
    );
  }
  say('');
  const both = inputs.members.filter(
    m => isLetter(finalGrades.get(m.id)?.grade) && isLetter(F2.get(m.id)?.tier)
  );
  say(
    `Rank correlation with Final: ${spearman(
      both.map(m => num(finalGrades.get(m.id).score)),
      both.map(m => scoreOf(F2.get(m.id)))
    )?.toFixed(3)}.`
  );
  say('');
}

// 15. Party by cause
say('## 3. Up and down by party, by cause');
say('');
say(
  'Each step adds one change to the one before, in this order (a different order would split the effect differently). Counts are grade changes at that step.'
);
say('');
say('| Step | Democrats up | down | Republicans up | down |');
say('|---|---|---|---|---|');
for (let i = 0; i < CHAIN.length; i++) {
  const t = upDown(
    id => tierOf(i - 1, id),
    id => tierOf(i, id)
  );
  say(`| ${CHAIN[i][0]} | ${t.D.up} | ${t.D.down} | ${t.R.up} | ${t.R.down} |`);
}
say(
  `| **All together, against live** | **${vsLive.D.up} of ${vsLive.D.of}** | **${vsLive.D.down}** | **${vsLive.R.up} of ${vsLive.R.of}** | **${vsLive.R.down}** |`
);
say('');

// Groups
say('## 4. PAC money to members by group');
say('');
{
  const order = ['people', 'board', 'untested', 'nosponsor', 'business', 'politician', 'party'];
  say('| Group | PACs | Given to members | Share | Counts toward grades |');
  say('|---|---|---|---|---|');
  for (const g of order) {
    const ids = [...pacGiven.keys()].filter(id => groupOf(id) === g);
    if (!ids.length) {
      continue;
    }
    say(
      `| ${GROUP[g]} | ${ids.length} | ${usdM(sumOf(ids))} | ${pct(sumOf(ids) / allGiven, 1)} | ${usdM(ids.reduce((t, id) => t + pacGiven.get(id) * countsFor(id), 0))} |`
    );
  }
  say(`| All | ${pacGiven.size} | ${usdM(allGiven)} | 100% | ${usdM(countedPac)} |`);
  say('');
  say(
    'BOARD: a PEOPLE sponsor whose Form 990 says its members do not elect its governing body (line 7a No), so it answers to its board. NOT TESTED: no Form 990 found and no stated fact yet; counted 0 for now (section 6).'
  );
  say('');
}

// A3. Sponsors tested
say('## 5. The people test: every sponsor tested');
say('');
{
  const tested = [...pacGiven.keys(), ...directedTo.keys()]
    .filter((id, i, a) => a.indexOf(id) === i)
    .map(id => ({ id, p: inputs.pacs[id] }))
    .filter(({ p }) => p?.sponsor?.group === 'people');
  const named = [
    ['AIPAC', /AMERICAN ISRAEL PUBLIC AFFAIRS/],
    ['RJC', /REPUBLICAN JEWISH COALITION/],
    ['DMFI', /\bDMFI\b/],
    ['J Street', /JSTREET|J STREET/],
    ['NORPAC', /^NORPAC/],
    ["Emily's List", /^EMILY/],
    ['Club for Growth', /CLUB FOR GROWTH/],
    ['Senate Conservatives Fund', /SENATE CONSERVATIVES FUND/],
    ['Human Rights Campaign', /HUMAN RIGHTS CAMPAIGN/],
    ['SBA Pro-Life America', /SUSAN B\.? ANTHONY|SBA PRO-LIFE/],
  ];
  const given = id => (pacGiven.get(id) || 0) + (directedTo.get(id)?.amount || 0);
  say('The named sponsors:');
  say('');
  say('| Asked about | PAC | Given + directed | Group | Form 990 (Part VI) | Result |');
  say('|---|---|---|---|---|---|');
  for (const [label, re] of named) {
    const ids = Object.keys(inputs.pacs)
      .filter(id => re.test(String(inputs.pacs[id].name || '').toUpperCase()))
      .sort((a, b) => given(b) - given(a))
      .slice(0, 2);
    if (!ids.length) {
      say(`| ${label} | not among the PACs in this export | | | | |`);
      continue;
    }
    for (const id of ids) {
      const p = inputs.pacs[id];
      const t = p.peopleTest;
      // Nonconnected PACs: their affiliated organization's Form 990, for
      // reference (NO SPONSOR counts 0 either way)
      const ref = NAMED_REF[id] ? forms[NAMED_REF[id].ein] : null;
      const refNote = ref
        ? `${NAMED_REF[id].who} (EIN ${NAMED_REF[id].ein}): ${ref.found ? `Form 990 for ${ref.taxYear}, line 7a ${ref.elect ? 'Yes' : 'No'}` : ref.why}; `
        : '';
      const testedNote =
        p.sponsor.group === 'people'
          ? t.evidence
          : `${t.ein ? `${t.evidence}; ` : ''}${refNote}not tested: group is ${GROUP[p.sponsor.group]}`;
      say(
        `| ${label} | ${esc(p.name)} (${id}) | ${usd(given(id))} | ${GROUP[p.sponsor.group]} | ${esc(testedNote)} | ${GROUP[groupOf(id)]}: counts ${pct(countsFor(id))} |`
      );
    }
  }
  say('');
  say(
    `Every PEOPLE sponsor (${tested.length} PACs that gave to members or directed gifts), largest first. "Members elect" is line 7a; where Schedule O explains it, the explanation is in PACs.csv (schedule_o).`
  );
  say('');
  say('| PAC | Given + directed | Sponsor tested | Tax year | Line 6 | Line 7a | Result |');
  say('|---|---|---|---|---|---|---|');
  for (const { id, p } of tested.sort((a, b) => given(b.id) - given(a.id))) {
    const t = p.peopleTest;
    const f = t.ein ? forms[t.ein] : null;
    say(
      `| ${esc(p.name)} | ${usd(given(id))} | ${t.ein ? `${esc(f?.name || '')} (EIN ${t.ein})` : '–'} | ${t.taxYear || '–'} | ${f?.found ? (f.members ? 'Yes' : 'No') : '–'} | ${f?.found ? (f.elect ? 'Yes' : 'No') : esc(t.evidence)} | ${GROUP[groupOf(id)]} |`
    );
  }
  say('');
  // The stricter reading
  const strictIds = Object.keys(inputs.pacs).filter(
    id => STRICT[inputs.pacs[id].peopleTest?.ein] && inputs.pacs[id].sponsor.group === 'people'
  );
  const st = upDown(
    id => F2.get(id)?.tier,
    id => FS.get(id)?.tier
  );
  say(
    `**The stricter reading.** Line 7a asks whether members may elect or appoint "one or more" of the governing body, so a Yes doesn't always mean members elect the leaders. ${strictIds.length} PACs' sponsors answer Yes while their own Schedule O says members elect one director, or that the board is its own membership. Counted as BOARD instead, ${inputs.members.filter(m => F2.get(m.id)?.tier !== FS.get(m.id)?.tier).length} grades would change: Democrats ${st.D.up} up, ${st.D.down} down; Republicans ${st.R.up} up, ${st.R.down} down.`
  );
  say('');
  say('| PAC | Given + directed | What its Form 990 says |');
  say('|---|---|---|');
  for (const id of strictIds.sort((a, b) => given(b) - given(a))) {
    say(
      `| ${esc(inputs.pacs[id].name)} | ${usd(given(id))} | ${esc(STRICT[inputs.pacs[id].peopleTest.ein])} |`
    );
  }
  say('');
  // The 20 largest unions
  const unions = tested
    .filter(({ p }) => p.orgType === 'L' || /\b05\b/.test(String(p.sponsor.irs?.subsection || '')))
    .sort((a, b) => given(b.id) - given(a.id))
    .slice(0, 20);
  say('The 20 largest unions (by money given to members):');
  say('');
  say('| Union PAC | Given | Form 990 | Members elect (7a) | Voting board members | Result |');
  say('|---|---|---|---|---|---|');
  for (const { id, p } of unions) {
    const t = p.peopleTest;
    const f = t.ein ? forms[t.ein] : null;
    say(
      `| ${esc(p.name)} | ${usd(given(id))} | ${f?.found ? `${esc(f.name)}, ${f.taxYear}` : esc(t.evidence)} | ${f?.found ? (f.elect ? 'Yes' : 'No') : '–'} | ${f?.votingMembers ?? '–'} | ${GROUP[groupOf(id)]} |`
    );
  }
  say('');
}

// Unsettled and untested
say('## 6. Still unsettled');
say('');
{
  const rows = [...pacGiven.keys(), ...directedTo.keys()]
    .filter((id, i, a) => a.indexOf(id) === i)
    .filter(id => groupOf(id) === 'untested')
    .map(id => ({
      id,
      p: inputs.pacs[id],
      amt: (pacGiven.get(id) || 0) + (directedTo.get(id)?.amount || 0),
    }))
    .sort((a, b) => b.amt - a.amt);
  say(
    `${rows.length} PACs, ${usdM(rows.reduce((t, r) => t + r.amt, 0))} given or directed to members. Each counts 0 until settled.`
  );
  say('');
  say('| PAC | Sponsor | Given + directed | Why |');
  say('|---|---|---|---|');
  for (const { p, amt } of rows) {
    say(
      `| ${esc(p.name)} | ${esc(p.connectedOrg || '–')} | ${usd(amt)} | ${esc(p.sponsor.unsettled ? `${p.sponsor.reason}. ${p.peopleTest.evidence}` : p.peopleTest.evidence)} |`
    );
  }
  say('');
}

// PACs whose group changed from Final
say('## 7. Every PAC whose group changed from Final');
say('');
{
  const changed = [...pacGiven.keys(), ...directedTo.keys()]
    .filter((id, i, a) => a.indexOf(id) === i)
    .filter(id => finalGroupOf(id) && finalGroupOf(id) !== groupOf(id))
    .map(id => ({ id, amt: (pacGiven.get(id) || 0) + (directedTo.get(id)?.amount || 0) }))
    .sort((a, b) => b.amt - a.amt);
  const moves = {};
  for (const { id, amt } of changed) {
    const k = `${GROUP[finalGroupOf(id)] || finalGroupOf(id)} → ${GROUP[groupOf(id)]}`;
    moves[k] ||= { n: 0, amt: 0 };
    moves[k].n++;
    moves[k].amt += amt;
  }
  say(`${changed.length} PACs. By move:`);
  say('');
  say('| Final → FINAL-2 | PACs | Given + directed |');
  say('|---|---|---|');
  for (const [k, v] of Object.entries(moves).sort((a, b) => b[1].amt - a[1].amt)) {
    say(`| ${k} | ${v.n} | ${usdM(v.amt)} |`);
  }
  say('');
  say('| PAC | Given + directed | Final | FINAL-2 | The fact |');
  say('|---|---|---|---|---|');
  for (const { id, amt } of changed) {
    const p = inputs.pacs[id];
    const fact =
      groupOf(id) === 'board' || groupOf(id) === 'untested' || groupOf(id) === 'people'
        ? `${p.sponsor.reason}. People test: ${p.peopleTest.evidence}`
        : p.sponsor.reason;
    say(
      `| ${esc(p.name)} | ${usd(amt)} | ${GROUP[finalGroupOf(id)] || finalGroupOf(id)} | ${GROUP[groupOf(id)]} | ${esc(fact)} |`
    );
  }
  say('');
}

// Rules 6-12 lists
say('## 8. Sorting rules 6-12: the lists');
say('');
{
  const giving = [...pacGiven.keys()];
  // Rule 6: leaving BUSINESS needs a stated fact
  const left = giving.filter(
    id =>
      inputs.pacs[id].byRules.group === 'business' && inputs.pacs[id].sponsor.group !== 'business'
  );
  say(`### Rule 6: PACs the rules make BUSINESS that a stated fact moves out (${left.length})`);
  say('');
  if (left.length) {
    say('| PAC | Given | Now | The fact |');
    say('|---|---|---|---|');
    for (const id of left.sort((a, b) => pacGiven.get(b) - pacGiven.get(a))) {
      const p = inputs.pacs[id];
      say(
        `| ${esc(p.name)} | ${usd(pacGiven.get(id))} | ${GROUP[p.sponsor.group]} | ${esc(p.sponsor.reason)} |`
      );
    }
  } else {
    say('None.');
  }
  say('');
  // Rule 6 holding: the FEC files the sponsor as a company, the IRS lists a
  // non-business kind; kept BUSINESS (no stated fact moves them)
  const held = giving.filter(id => {
    const p = inputs.pacs[id];
    if (p.sponsor.group !== 'business' || !/stays BUSINESS/.test(p.sponsor.reason)) {
      return false;
    }
    const names = [p.connectedOrg, stripPacWords(p.connectedOrg), stripPacWords(p.name)];
    return names.some(n => n && irsStatus(irsIndex, n).group === 'people');
  });
  say(
    `### Rule 6 holding: filed by the FEC as a company, listed by the IRS as a non-business kind (${held.length}, kept BUSINESS)`
  );
  say('');
  say(
    'The FEC field wins under rule 6. Many nonprofits file as a corporation without capital stock (W), so some issue groups land here. None is moved without a stated fact; the owner may give one.'
  );
  say('');
  say('| PAC | Given | FEC sponsor type | IRS says |');
  say('|---|---|---|---|');
  for (const id of held.sort((a, b) => pacGiven.get(b) - pacGiven.get(a))) {
    const p = inputs.pacs[id];
    const names = [p.connectedOrg, stripPacWords(p.connectedOrg), stripPacWords(p.name)];
    const hit = names.map(n => n && irsStatus(irsIndex, n)).find(r => r?.group === 'people');
    say(
      `| ${esc(p.name)} | ${usd(pacGiven.get(id))} | ${p.orgType} | 501(c)(${String(hit.subsection).replace(/^0/, '')}) ${esc(hit.irsName || '')}, EIN ${hit.ein} |`
    );
  }
  say('');
  // Rules 7 and 8, and the name rules
  const named = giving.filter(id => inputs.pacs[id].sponsor.settledBy === 'name');
  say(
    `### Rules 6-8 by name: insurers, health plans, credit unions, chambers, producers' groups, companies (${named.length})`
  );
  say('');
  say('| PAC | Given | Why |');
  say('|---|---|---|');
  for (const id of named.sort((a, b) => pacGiven.get(b) - pacGiven.get(a)).slice(0, 60)) {
    const p = inputs.pacs[id];
    say(`| ${esc(p.name)} | ${usd(pacGiven.get(id))} | ${esc(p.sponsor.reason)} |`);
  }
  if (named.length > 60) {
    say(`| and ${named.length - 60} more (PACs.csv) | | |`);
  }
  say('');
  // Rule 9: IRS matches to confirm
  const checks = giving.filter(id => inputs.pacs[id].byRules.check);
  say(`### Rule 9: IRS matches made on another name, or under mixed records (${checks.length})`);
  say('');
  say('| PAC | Given | The match | Group | Stated fact |');
  say('|---|---|---|---|---|');
  for (const id of checks.sort((a, b) => pacGiven.get(b) - pacGiven.get(a))) {
    const p = inputs.pacs[id];
    say(
      `| ${esc(p.name)} | ${usd(pacGiven.get(id))} | ${esc(p.byRules.reason)} | ${GROUP[p.sponsor.group]} | ${p.sponsor.settledBy === 'stated fact' ? esc(p.sponsor.reason) : 'none: the match stands as read'} |`
    );
  }
  say('');
  // Rule 10: connected organization is a committee or a politician
  const r10 = Object.keys(inputs.pacs).filter(id =>
    /connected organization,|connected organization is|reads as another political committee/i.test(
      inputs.pacs[id].sponsor.reason
    )
  );
  say(
    `### Rule 10: sponsors that are committees or politicians (${r10.filter(id => pacGiven.has(id)).length} that gave)`
  );
  say('');
  say('| PAC | Given | Connected organization | Group | Why |');
  say('|---|---|---|---|---|');
  for (const id of r10
    .filter(i => pacGiven.has(i))
    .sort((a, b) => pacGiven.get(b) - pacGiven.get(a))) {
    const p = inputs.pacs[id];
    say(
      `| ${esc(p.name)} | ${usd(pacGiven.get(id))} | ${esc(p.connectedOrg)} | ${GROUP[p.sponsor.group]} | ${esc(p.sponsor.reason)} |`
    );
  }
  say('');
  // Rule 11: caucus PACs
  const CAUCUS =
    /CAUCUS|TUESDAY GROUP|NEW DEMOCRAT|BLUE DOG|\bBOLD PAC\b|PROBLEM SOLVERS|NO LABELS|SEAL PAC|SUSTAINABLE ENERGY|FUTURE FORUM|MAIN STREET|FREEDOM FUND|REPUBLICAN STUDY|ASPIRE PAC|HISPANIC CONFERENCE/;
  const caucus = Object.keys(inputs.pacs).filter(id =>
    CAUCUS.test(String(inputs.pacs[id].name || '').toUpperCase())
  );
  say(
    `### Rule 11: PACs linked to a congressional caucus or run by members (${caucus.length} found by name)`
  );
  say('');
  say('| PAC | Given | Group | The fact |');
  say('|---|---|---|---|');
  for (const id of caucus.sort((a, b) => (pacGiven.get(b) || 0) - (pacGiven.get(a) || 0))) {
    const p = inputs.pacs[id];
    say(
      `| ${esc(p.name)} (${id}) | ${usd(pacGiven.get(id) || 0)} | ${GROUP[p.sponsor.group]} | ${esc(p.sponsor.reason)} |`
    );
  }
  say('');
  // Rule 12: the 50 largest NO SPONSOR PACs
  const ns = giving
    .filter(id => inputs.pacs[id].byRules.group === 'nosponsor')
    .sort((a, b) => pacGiven.get(b) - pacGiven.get(a))
    .slice(0, 50);
  say('### Rule 12: the 50 largest NO SPONSOR PACs, checked');
  say('');
  say('| PAC | Given | FEC type / designation | Group now | Stated fact |');
  say('|---|---|---|---|---|');
  for (const id of ns) {
    const p = inputs.pacs[id];
    say(
      `| ${esc(p.name)} | ${usd(pacGiven.get(id))} | ${p.type || ''} / ${p.designation || ''} | ${GROUP[p.sponsor.group]} | ${p.sponsor.settledBy === 'stated fact' ? esc(p.sponsor.reason) : 'none found: no business or politician behind it on the record'} |`
    );
  }
  say('');
}

// Earmarks
say('## 9. Earmarks through directing committees');
say('');
{
  say(
    `Gifts the member's own committees itemize as earmarked (transaction type 15E or an "earmark" memo) whose conduit is a committee other than ActBlue, WinRed or Democracy Engine. Taken out of the member's big-donor money and donor test, and counted as the directing committee's gift: at its traced share if it passes the people test, otherwise 0. Never under the PAC credit cap. ${directedTo.size} committees, ${usdM([...directedTo.values()].reduce((t, d) => t + d.amount, 0))}.`
  );
  say('');
  say(
    '| Committee | Directed to members | Group | Traces to people | Counts | Members (largest first) |'
  );
  say('|---|---|---|---|---|---|');
  for (const [id, d] of [...directedTo].sort((a, b) => b[1].amount - a[1].amount).slice(0, 25)) {
    const ms = [...d.members].sort((a, b) => b[1] - a[1]);
    say(
      `| ${esc(pacName(id))} (${id}) | ${usd(d.amount)} | ${GROUP[groupOf(id)] || 'not traced'} | ${pct(shares.get(id)?.[2])} | ${usd(d.amount * countsFor(id))} | ${ms
        .slice(0, 8)
        .map(([n, a]) => `${n} ${usd(a)}`)
        .join('; ')}${ms.length > 8 ? `; and ${ms.length - 8} more` : ''} |`
    );
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
    'final_grade',
    'final_score',
    'live_grade',
    'cause_vs_final',
  ];
  const rows = [cols.join(',')];
  for (const m of inputs.members) {
    const r = F2.get(m.id);
    const f = finalGrades.get(m.id);
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
        f?.grade,
        f ? num(f.score) : null,
        m.published?.tier,
        causes(m.id),
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, 'Final2.csv'), rows.join('\n'));
}
{
  const cols = [
    'id',
    'name',
    'type',
    'designation',
    'org_type',
    'connected_org',
    'connected_committee',
    'group',
    'final_group',
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
  const ids = Object.keys(inputs.pacs).sort(
    (a, b) =>
      (pacGiven.get(b) || 0) +
      (directedTo.get(b)?.amount || 0) -
      ((pacGiven.get(a) || 0) + (directedTo.get(a)?.amount || 0))
  );
  for (const id of ids) {
    const p = inputs.pacs[id];
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
        (p.connectedCommittees || []).map(c => `${c.id} ${c.name}`).join('; '),
        GROUP[groupOf(id)],
        GROUP[finalGroupOf(id)] || finalGroupOf(id),
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
        directedTo.get(id)?.amount || 0,
        shares.get(id)?.[2],
        countsFor(id),
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, 'PACs.csv'), rows.join('\n'));
}

writeFileSync(join(outDir, 'report.md'), lines.join('\n'));

// The one-page spec, its result line from this run
const spec = `## Spec: FINAL-2

**Meaning.** A member's grade is the share of the money given to them, and to their own joint funds, that comes from many different people. Big donations count only as far as the people who gave them are many and spread out. PAC money counts only when the PAC's sponsor is run by its members (they elect its leaders), and only as far as the PAC's own money traces back to many people. Money from businesses, politicians, parties, and PACs that answer to a board or to their organizers counts 0.

**Formula** (per member, cycle 2026):

- money given: \`G = s + b + p + y\` across the member's campaigns, leadership PACs and own joint funds (in full; transfers between them counted once). Own money, interest, refunds, loans and transfers are left out.
- other politicians' joint funds: what they passed to the member comes out of \`s, b, p, y\` by each fund's own mix and counts 0 (POLITICIAN); it stays in \`G\`.
- directed gifts: gifts earmarked through a committee other than ActBlue, WinRed or Democracy Engine come out of \`b\` and the donor test, and count as that committee's gift: \`e × share\` if it passes the people test, else 0. Never under the PAC cap.
- donor test, on the remaining big-donor records of those committees, each donor's gifts at full size, donors who net above $0: \`N\` big donors, \`n\` the fewest who gave half the big-donor money.
- allowance: \`a = min(0.10 + 0.90 × clamp((n/N − 0.025) / 0.075, 0, 1), min(1, n/100))\`; \`a = 0.40\` only when our records cover under half the FEC's big-donor total.
- big money counted: \`min(b, a × (s + b))\`.
- each PAC's share from people: the same test on the PAC's own money (the FEC's small/big split, its own donors), plus the money of committees that funded it (2 steps back) where those committees pass the people test; all other committee money, and money we can't trace, counts 0.
- the people test: a PEOPLE sponsor's latest Form 990, Part VI line 7a (members may elect the governing body): Yes passes, No is BOARD (0). No Form 990: a stated fact decides (union locals: the Labor-Management Reporting and Disclosure Act's election rule); otherwise not tested (0) and listed.
- PAC money counted: \`Σ gift × share\` for PEOPLE PACs that pass the test, scaled down so it never exceeds the PAC money in the member's figures.
- score: \`x = 100 × (s + min(b, a(s + b)) + PAC money counted + directed gifts counted) / G\`, at most 100.
- grade on \`round(x)\`: S at least 90, A 75, B 60, C 45, D 30, E 15, otherwise F.
- no grade (?): no confirmed FEC identity; no campaign committee for the cycle; own money that doesn't fit inside the receipts.

**Constants**: 0.10 and 0.90 (allowance range), 2.5% and 10% (spread), 100 donors, 0.40 fallback, 50% record coverage, credit 1 (PEOPLE that pass the test) and 0 (everything else), 2 steps back, bands 90/75/60/45/30/15.

**Sorting rule** (each PAC in one group, in this order): a stated fact, where one is listed. POLITICIAN: leadership PACs (FEC designation D, or the FEC's leadership-PAC flag or sponsoring candidate), candidates' committees, other politicians' joint funds, PACs whose connected organization is a candidate's committee, leadership PAC, joint fund or politician, and PACs linked to a congressional caucus or run by members of Congress (one test, both parties). PARTY: party committees, and PACs whose connected organization is one. NO SPONSOR: a connected organization that is another (non-party, non-politician) committee, or none. BUSINESS: FEC sponsor type corporation, trade association, cooperative or corporation without capital stock (whatever the IRS says); credit unions, insurers (fraternal benefit societies that sell insurance included), health plans and chambers of commerce; agricultural producers' groups; a 501(c)(6) business league or exempt co-op, credit union or mutual insurer by IRS status; a company name. PEOPLE: a labor organization (FEC type L, or 501(c)(5) not a producers' group) or another member or issue organization by IRS status or FEC type M. The IRS can make a PAC BUSINESS, never un-make one; leaving BUSINESS takes a stated fact. An IRS match made on another name, or under mixed records, is checked and listed.

**Result on the snapshot**: S ${c2.S || 0}, A ${c2.A || 0}, B ${c2.B || 0}, C ${c2.C || 0}, D ${c2.D || 0}, E ${c2.E || 0}, F ${c2.F || 0}; ${withheld.length} withheld.
`;
writeFileSync(join(outDir, 'spec.md'), spec);
writeFileSync(
  join(outDir, 'final2-results.json'),
  JSON.stringify({ counts: c2, strict: counts(FS), vsLive, vsFinal, chain: CHAIN.map(([k]) => k) })
);
console.log(`written to ${outDir}: ${lines.length} lines`);
