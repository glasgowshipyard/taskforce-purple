#!/usr/bin/env node
/**
 * The final candidate (owner's decisions, 2026-10-11), on the same frozen
 * snapshot: PACs in TFP's own groups, whole own joint funds, no donor
 * minimum, the transfer check per committee, Hinson's Senate ID. Report and
 * CSVs from a frozen run's inputs (exported from the final-grading branch).
 *
 *   node scripts/simulate/report-final.mjs --inputs FILE.inputs.json --irs DIR --out DIR
 *
 * The PAC sorting is re-run here from the exported FEC records with the
 * current stated facts (scripts/refresh/data/sponsor-facts.json), so facts
 * can be refined without another export.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  IRS_FILES,
  classifyPac,
  fecGroup,
  loadFacts,
  loadIrsIndex,
} from '../refresh/lib/sponsors.mjs';
import { LIVE, RANK, runGrid, spearman } from './lib/grid.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const outDir = arg('--out', 'simulation-final');
mkdirSync(outDir, { recursive: true });

// --- Re-sort every PAC with the current facts ---
const conn = await (await DuckDBInstance.create(':memory:')).connect();
const irsIndex = await loadIrsIndex(
  async sql => (await conn.runAndReadAll(sql)).getRowObjects(),
  IRS_FILES.map(f => join(arg('--irs'), `${f}.csv`))
);
const facts = loadFacts();
for (const [id, p] of Object.entries(inputs.pacs)) {
  p.sponsor = classifyPac(id, p, irsIndex, facts, p.fecRecord);
  p.fecGroup = fecGroup(p);
}

const lines = [];
const say = (...xs) => lines.push(xs.join(''));
const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const pct = (x, d = 0) =>
  x === null || x === undefined || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`;
const usd = x => `$${Math.round(x).toLocaleString('en-US')}`;
const usdM = x => `$${(x / 1e6).toFixed(1)}M`;
const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const isLetter = t => LETTERS.includes(t);
const partyOf = p => (/^D/.test(p || '') ? 'D' : /^R/.test(p || '') ? 'R' : 'I');
const byId = new Map(inputs.members.map(m => [m.id, m]));
const GROUP = {
  politician: 'POLITICIAN',
  business: 'BUSINESS',
  people: 'PEOPLE',
  nosponsor: 'NO SPONSOR',
  party: 'PARTY',
  unclear: 'UNCLEAR',
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

// --- The runs ---
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
const TFP = {
  credit: { people: 1, nosponsor: 1, business: 0, politician: 0, party: 0 },
  source: 'tfp',
  upstreamZero: true,
};
const FINAL = { ...E, fixedInvariant: true, noMinDonors: true, wholeFunds: true, groups: TFP };
const CHAIN = [
  ['E', E],
  ['transfer check fixed', { ...E, fixedInvariant: true }],
  ['no donor minimum', { ...E, fixedInvariant: true, noMinDonors: true }],
  ['own joint funds in full', { ...E, fixedInvariant: true, noMinDonors: true, wholeFunds: true }],
  ['PACs by who they answer to, at full credit', FINAL],
];
const cache = new Map();
const run = cfg => {
  const key = JSON.stringify(cfg);
  if (!cache.has(key)) {
    cache.set(key, runGrid(inputs, cfg));
  }
  return cache.get(key);
};
const F = run(FINAL).results;
const scoreOf = r => (isLetter(r?.tier) ? r.score : null);
const counts = results => {
  const t = {};
  for (const r of results.values()) {
    const k = isLetter(r.tier) ? r.tier : '?';
    t[k] = (t[k] || 0) + 1;
  }
  return t;
};
function causes(id) {
  const tags = [];
  for (let i = 1; i < CHAIN.length; i++) {
    const a = run(CHAIN[i - 1][1]).results.get(id);
    const b = run(CHAIN[i][1]).results.get(id);
    if (a?.tier !== b?.tier) {
      tags.push(`${CHAIN[i][0]} (${a?.tier}→${b?.tier})`);
    } else if (Math.abs((b?.x ?? 0) - (a?.x ?? 0)) >= 1) {
      tags.push(`${CHAIN[i][0]} (${b.x - a.x > 0 ? '+' : ''}${(b.x - a.x).toFixed(0)})`);
    }
  }
  return tags.join('; ') || 'no change';
}
function upDown(fromTier) {
  const t = {
    D: { up: 0, down: 0, same: 0, of: 0 },
    R: { up: 0, down: 0, same: 0, of: 0 },
    I: { up: 0, down: 0, same: 0, of: 0 },
  };
  for (const m of inputs.members) {
    const a = fromTier(m);
    const b = F.get(m.id)?.tier;
    if (!isLetter(a) || !isLetter(b)) {
      continue;
    }
    const p = t[partyOf(m.party)];
    p.of++;
    p[RANK[b] > RANK[a] ? 'up' : RANK[b] < RANK[a] ? 'down' : 'same']++;
  }
  return t;
}

// PAC money to members under Final: gifts to campaigns, leadership PACs and own funds
const pacGiven = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of [...(m.gifts || []), ...(m.giftsToFunds || [])]) {
    pacGiven.set(id, (pacGiven.get(id) || 0) + amt);
  }
}
const allGiven = [...pacGiven.values()].reduce((t, v) => t + v, 0);
const groupOf = id => inputs.pacs[id]?.sponsor?.group || 'nosponsor';
const finalShares = run(FINAL).shares;

// ===================== Report =====================
const snap = inputs.snapshot || {};
say('# Final candidate');
say('');
say(
  `Same snapshot (captured ${snap.capturedAt}; FEC bulk files dated 11 October). Inputs exported from the final-grading branch. ${inputs.fetchedLive?.length || 0} FEC answers the snapshot lacked were fetched live${inputs.fetchedLive?.length ? ` between ${inputs.fetchedLive[0].at} and ${inputs.fetchedLive.at(-1).at}` : ''}: Hinson's Senate campaign, totals for PACs that gave only to members' own joint funds, and committee records for PACs the data didn't settle. IRS Exempt Organizations Business Master File dated 7 September 2026.`
);
say('');

// 1. Grades
say('## 1. Grades');
say('');
{
  const c = counts(F);
  const cE = counts(run(E).results);
  say('| Run | S | A | B | C | D | E | F | withheld |');
  say('|---|---|---|---|---|---|---|---|---|');
  say(
    `| E (round one's rules, on this export) | ${LETTERS.map(l => cE[l] || 0).join(' | ')} | ${cE['?'] || 0} |`
  );
  say(`| **Final** | ${LETTERS.map(l => `**${c[l] || 0}**`).join(' | ')} | ${c['?'] || 0} |`);
  say('');
  const withheld = inputs.members.filter(m => !isLetter(F.get(m.id)?.tier));
  say(
    `Withheld: ${withheld.map(m => `${m.name} (${F.get(m.id).reason || F.get(m.id).tier})`).join('; ') || 'none'}.`
  );
  say('');
  say('Reference members:');
  say('');
  say('| Member | Live | E | Final | Final score: from people / PACs counted |');
  say('|---|---|---|---|---|');
  for (const [id, name] of Object.entries(REFERENCE)) {
    const m = byId.get(id);
    const e = run(E).results.get(id);
    const r = F.get(id);
    say(
      `| ${name} | ${m.published?.tier} ${m.published?.score ?? ''} | ${e.tier} ${e.score ?? ''} | ${r.tier} ${r.score ?? ''} | ${pct(r.fromPeople / r.denominator)} / ${pct(r.creditDollars / r.denominator)} |`
    );
  }
  say('');
  // The 10 whose own joint funds raised the most
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
  say('| Member | Party | Own funds raised | Money given (Final) | Live | E | Final |');
  say('|---|---|---|---|---|---|---|');
  for (const { m, raised } of top) {
    const e = run(E).results.get(m.id);
    const r = F.get(m.id);
    say(
      `| ${m.name} | ${partyOf(m.party)} | ${usdM(raised)} | ${usdM(r.denominator || 0)} | ${m.published?.tier} ${m.published?.score ?? ''} | ${e.tier} ${e.score ?? ''} | ${r.tier} ${r.score ?? ''} |`
    );
  }
  say('');
}

// 2. Party
say('## 2. Up and down by party');
say('');
say('| Against | Democrats up | down | same | Republicans up | down | same |');
say('|---|---|---|---|---|---|---|');
for (const [label, fn] of [
  ['live', m => m.published?.tier],
  ['E', m => run(E).results.get(m.id)?.tier],
]) {
  const t = upDown(fn);
  say(
    `| ${label} | ${t.D.up} of ${t.D.of} | ${t.D.down} | ${t.D.same} | ${t.R.up} of ${t.R.of} | ${t.R.down} | ${t.R.same} |`
  );
}
say('');

// 3. Movers vs E
say('## 3. The 25 largest movers against E');
say('');
{
  const e = run(E).results;
  const movers = inputs.members
    .filter(m => isLetter(e.get(m.id)?.tier) && isLetter(F.get(m.id)?.tier))
    .map(m => ({ m, d: scoreOf(F.get(m.id)) - scoreOf(e.get(m.id)) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 25);
  say('| Member | Party | Grade | Score | Cause |');
  say('|---|---|---|---|---|');
  for (const { m } of movers) {
    say(
      `| ${m.name} | ${partyOf(m.party)} | ${e.get(m.id).tier}→${F.get(m.id).tier} | ${e.get(m.id).score}→${F.get(m.id).score} | ${causes(m.id)} |`
    );
  }
  say('');
  say(
    `Grades changed against E: ${inputs.members.filter(m => e.get(m.id)?.tier !== F.get(m.id)?.tier).length}. Rank correlation with E: ${spearman(...[e, F].map(rs => inputs.members.filter(m => isLetter(e.get(m.id)?.tier) && isLetter(F.get(m.id)?.tier)).map(m => scoreOf(rs.get(m.id)))))?.toFixed(3)}.`
  );
  say('');
  const upper = run({ ...FINAL, nonOwnFundsZero: true }).results;
  const n = inputs.members.filter(m => F.get(m.id)?.tier !== upper.get(m.id)?.tier);
  const nonOwn = inputs.members.reduce(
    (t, m) =>
      t +
      (m.pf.committees || [])
        .filter(c => c.role === 'joint' && !c.ownFund)
        .reduce((s, c) => s + num(c.toMember), 0),
    0
  );
  say(
    `Transfers from other politicians' joint funds (not the member's own): ${usdM(nonOwn)} in all, still counted by each fund's own mix of donors, as before. Counted as POLITICIAN money (0) instead, at most ${n.length} grades would change.`
  );
  say('');
}

// 4. Groups
say('## 4. Money to members by group');
say('');
{
  const t = {};
  for (const [id, amt] of pacGiven) {
    const g = groupOf(id);
    t[g] ||= { n: 0, amt: 0 };
    t[g].n++;
    t[g].amt += amt;
  }
  say('| Group | PACs | Given to members | Share | Counts toward grades |');
  say('|---|---|---|---|---|');
  for (const g of ['people', 'nosponsor', 'business', 'politician']) {
    const v = t[g] || { n: 0, amt: 0 };
    const counted = [...pacGiven]
      .filter(([id]) => groupOf(id) === g)
      .reduce(
        (s, [id, amt]) => s + amt * (finalShares.get(id)?.[2] || 0) * (TFP.credit[g] ?? 0),
        0
      );
    say(
      `| ${GROUP[g]} | ${v.n.toLocaleString('en-US')} | ${usdM(v.amt)} | ${pct(v.amt / allGiven, 1)} | ${usdM(counted)} |`
    );
  }
  say(`| All | ${pacGiven.size.toLocaleString('en-US')} | ${usdM(allGiven)} | 100% | |`);
  say('');
  for (const g of ['people', 'nosponsor', 'business', 'politician']) {
    say(`### ${GROUP[g]}: the 15 largest`);
    say('');
    say(
      '| PAC | Given | Traces to people | FEC type / designation / sponsor type | Connected organization | Why this group |'
    );
    say('|---|---|---|---|---|---|');
    for (const [id, amt] of [...pacGiven]
      .filter(([pid]) => groupOf(pid) === g)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)) {
      const p = inputs.pacs[id];
      say(
        `| ${p.name} | ${usd(amt)} | ${pct(finalShares.get(id)?.[2])} | ${p.type || ''} / ${p.designation || ''} / ${p.orgType || '–'} | ${p.connectedOrg || ''} | ${p.sponsor.reason} |`
      );
    }
    say('');
  }
}

// 5. Groups that differ from the FEC field alone
say('## 5. PACs whose group differs from the FEC field alone');
say('');
{
  const diff = [...pacGiven]
    .filter(([id]) => {
      const p = inputs.pacs[id];
      const fec = p.fecGroup === 'unclear' ? 'unclear' : p.fecGroup;
      return fec !== p.sponsor.group;
    })
    .sort((a, b) => b[1] - a[1]);
  const moves = {};
  for (const [id, amt] of diff) {
    const p = inputs.pacs[id];
    const k = `${GROUP[p.fecGroup]} → ${GROUP[p.sponsor.group]}`;
    moves[k] ||= { n: 0, amt: 0 };
    moves[k].n++;
    moves[k].amt += amt;
  }
  say(
    `${diff.length} PACs that gave to members, ${usdM(diff.reduce((t, [, a]) => t + a, 0))}. By move:`
  );
  say('');
  say('| FEC field alone → TFP | PACs | Given |');
  say('|---|---|---|');
  for (const [k, v] of Object.entries(moves).sort((a, b) => b[1].amt - a[1].amt)) {
    say(`| ${k} | ${v.n} | ${usdM(v.amt)} |`);
  }
  say('');
  say(
    'Every one, largest first (UNCLEAR is what the FEC field alone gave for cooperatives, corporations without capital stock, and sponsors named without a type):'
  );
  say('');
  say('| PAC | Given | FEC field alone | TFP | The fact |');
  say('|---|---|---|---|---|');
  for (const [id, amt] of diff) {
    const p = inputs.pacs[id];
    say(
      `| ${p.name} | ${usd(amt)} | ${GROUP[p.fecGroup]} | ${GROUP[p.sponsor.group]} | ${p.sponsor.reason} |`
    );
  }
  say('');
}

// 6. IRS matching
say('## 6. IRS matching');
say('');
{
  const sponsors = [...pacGiven.keys()]
    .map(id => inputs.pacs[id])
    .filter(
      p =>
        !['politician', 'party'].includes(p.sponsor.group) || p.sponsor.settledBy === 'stated fact'
    );
  const by = {};
  for (const p of sponsors) {
    const k = p.sponsor.settledBy;
    by[k] = (by[k] || 0) + 1;
  }
  const irs = sponsors.filter(p => p.sponsor.settledBy === 'IRS');
  const subs = {};
  for (const p of irs) {
    const k = String(p.sponsor.irs?.subsection || '').split('/')[0];
    subs[k] = (subs[k] || 0) + 1;
  }
  say(
    `Of ${sponsors.length} giving PACs outside POLITICIAN: ${Object.entries(by)
      .map(([k, v]) => `${v} settled by ${k}`)
      .join(', ')}.`
  );
  say('');
  say(
    `Matched in the IRS file: ${irs.length} (by the sponsor's name or, where the FEC says a sponsor exists, the PAC's own name; exact after tidying, or by most of the records under one name). By kind: ${Object.entries(
      subs
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `501(c)(${k.replace(/^0/, '')}) ${v}`)
      .join(', ')}.`
  );
  say('');
  const unmatched = sponsors.filter(
    p => p.sponsor.settledBy !== 'IRS' && p.sponsor.group !== 'nosponsor'
  );
  const rule = p =>
    p.sponsor.settledBy === 'stated fact'
      ? 'a stated fact'
      : p.sponsor.settledBy === 'name'
        ? "the sponsor's name is a company's"
        : p.sponsor.unsettled
          ? 'not settled'
          : `FEC sponsor type: ${p.orgType || 'none'}`;
  const byRule = {};
  for (const p of unmatched) {
    const k = `${rule(p)} → ${GROUP[p.sponsor.group]}`;
    byRule[k] ||= { n: 0, amt: 0 };
    byRule[k].n++;
    byRule[k].amt += pacGiven.get(idOf(p)) || 0;
  }
  say(
    `Not matched in the IRS file: ${unmatched.length} giving PACs outside NO SPONSOR (a corporation, partnership or LLC isn't tax-exempt, so it has no IRS record; nearly all of these are companies). How each was decided:`
  );
  say('');
  say('| Decided by | PACs | Given |');
  say('|---|---|---|');
  for (const [k, v] of Object.entries(byRule).sort((a, b) => b[1].amt - a[1].amt)) {
    say(`| ${k} | ${v.n} | ${usdM(v.amt)} |`);
  }
  say('');
  say(
    'Every one decided by a stated fact, by name, or not settled (the rest, decided by the FEC sponsor type, are in PACs.csv with their reasons):'
  );
  say('');
  say('| PAC | Given | Sponsor | Group | Decided by |');
  say('|---|---|---|---|---|');
  for (const p of unmatched
    .filter(q => !rule(q).startsWith('FEC'))
    .sort((a, b) => (pacGiven.get(idOf(b)) || 0) - (pacGiven.get(idOf(a)) || 0))) {
    say(
      `| ${p.name} | ${usd(pacGiven.get(idOf(p)) || 0)} | ${p.connectedOrg || '–'} | ${GROUP[p.sponsor.group]}${p.sponsor.unsettled ? ' (not settled)' : ''} | ${p.sponsor.reason} |`
    );
  }
  say('');
}
function idOf(p) {
  return Object.keys(inputs.pacs).find(id => inputs.pacs[id] === p);
}

// 7. Named PACs
say('## 7. Named PACs');
say('');
{
  const largest = pred =>
    [...pacGiven].filter(([id]) => pred(inputs.pacs[id] || {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  const named = [
    ['Lockheed Martin', largest(p => /LOCKHEED MARTIN/.test(p.name || ''))],
    ['Air Line Pilots', largest(p => /AIR LINE PILOTS/.test(p.name || ''))],
    ['American Bankers', largest(p => /AMERICAN BANKERS ASSOCIATION/.test(p.name || ''))],
    [
      'National Association of Realtors',
      largest(p => /NATIONAL ASSOCIATION OF REALTORS/.test(p.name || '')),
    ],
    [
      "Emmer's leadership PAC",
      largest(p => /ELECTING MAJORITY MAKING EFFECTIVE REPUBLICANS/.test(p.name || '')),
    ],
  ];
  say('| PAC | Given to members | Group | Why | Traces to people | Counts |');
  say('|---|---|---|---|---|---|');
  for (const [label, id] of named) {
    if (!id) {
      continue;
    }
    const p = inputs.pacs[id];
    const s = finalShares.get(id)?.[2];
    say(
      `| ${label}: ${p.name} | ${usd(pacGiven.get(id))} | ${GROUP[p.sponsor.group]} | ${p.sponsor.reason} | ${pct(s)} | ${pct(s * (TFP.credit[p.sponsor.group] ?? 0))} |`
    );
  }
  say('');
}

// 8. Weak spot
say('## 8. The weak spot, recomputed');
say('');
{
  const weak = inputs.members
    .map(m => ({ m, r: F.get(m.id) }))
    .filter(({ r }) => ['S', 'A'].includes(r?.tier) && r.topShare >= 0.4)
    .sort((a, b) => b.r.topShare - a.r.topShare);
  say(
    `${weak.length} members graded S or A although the donors holding half their big-donor money gave 40% or more of all the money given to them (own joint funds in full, donors at full check size):`
  );
  say('');
  say(
    '| Member | Grade | Donors holding half | Big donors | They gave, of all the money | Allowance |'
  );
  say('|---|---|---|---|---|---|');
  for (const { m, r } of weak) {
    say(
      `| ${m.name} | ${r.tier} ${r.score} | ${r.n} | ${r.N} | ${pct(r.topShare)} | ${pct(r.allowance)} |`
    );
  }
  say('');
}

// 9. FEC gaps
say('## 9. FEC gaps: PACs that name a sponsor but give no sponsor type');
say('');
{
  const gaps = Object.entries(inputs.pacs)
    .filter(
      ([, p]) =>
        !p.orgType &&
        p.connectedOrg &&
        p.connectedOrg.trim() &&
        p.connectedOrg.trim().toUpperCase() !== 'NONE' &&
        !['D', 'J', 'P', 'A'].includes(p.designation) &&
        !['H', 'S', 'P', 'X', 'Y', 'Z'].includes(p.type)
    )
    .sort((a, b) => (pacGiven.get(b[0]) || 0) - (pacGiven.get(a[0]) || 0));
  say(`${gaps.length} committees (listed only; the FEC was not contacted):`);
  say('');
  say('| Committee | ID | Given to members | Connected organization | TFP group |');
  say('|---|---|---|---|---|');
  for (const [id, p] of gaps) {
    say(
      `| ${p.name} | ${id} | ${usd(pacGiven.get(id) || 0)} | ${p.connectedOrg} | ${GROUP[p.sponsor.group]} |`
    );
  }
  say('');
}

// 10. Earmarks
say('## 10. Earmarked gifts (report only)');
say('');
{
  say(
    'How earmarks are found: in the FEC itemized records of a member\'s own committees, a gift is earmarked when its transaction type is 15E (earmarked contribution) or its memo says "earmarked"; the record names the committee that passed it on (the conduit) in its OTHER_ID field. Only gifts the member\'s committees itemize appear (donors over $200 in the cycle), so smaller earmarked gifts are not in these figures.'
  );
  say('');
  const PLATFORM = /\b(ACTBLUE|WINRED|DEMOCRACY ENGINE)\b/;
  const conduits = new Map();
  let platform = 0;
  let directing = 0;
  let unknown = 0;
  for (const m of inputs.members) {
    for (const c of m.conduits || []) {
      const isPlatform = PLATFORM.test(String(c.name).toUpperCase());
      if (!c.id) {
        unknown += c.amount;
        continue;
      }
      if (isPlatform) {
        platform += c.amount;
        continue;
      }
      directing += c.amount;
      const e = conduits.get(c.id) || { name: c.name, amount: 0, count: 0, members: new Map() };
      e.amount += c.amount;
      e.count += c.count;
      e.members.set(m.name, (e.members.get(m.name) || 0) + c.amount);
      conduits.set(c.id, e);
    }
  }
  say(
    `Processing platforms (ActBlue, WinRed and Democracy Engine: they forward to any candidate the donor picks): ${usdM(platform)}. PACs and other committees that direct gifts to candidates they choose: ${usdM(directing)}, through ${conduits.size} committees. No conduit named: ${usdM(unknown)}.`
  );
  say('');
  say('The 20 largest directing committees:');
  say('');
  say('| Committee | ID | Earmarked to members | Gifts | Members (largest first) |');
  say('|---|---|---|---|---|');
  for (const [id, e] of [...conduits].sort((a, b) => b[1].amount - a[1].amount).slice(0, 20)) {
    const ms = [...e.members].sort((a, b) => b[1] - a[1]);
    say(
      `| ${e.name} | ${id} | ${usd(e.amount)} | ${e.count.toLocaleString('en-US')} | ${ms
        .slice(0, 12)
        .map(([n, a]) => `${n} ${usd(a)}`)
        .join('; ')}${ms.length > 12 ? `; and ${ms.length - 12} more` : ''} |`
    );
  }
  say('');
  // Per member, in the CSV
}

// ---- CSVs ----
{
  const cell = v =>
    v === null || v === undefined
      ? ''
      : typeof v === 'number'
        ? String(Math.round(v * 10000) / 10000)
        : `"${String(v).replace(/"/g, '""')}"`;
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
    'own_funds_raised',
    'denominator',
    'n',
    'N',
    'n_over_N',
    'allowance',
    'reliable',
    'fallback',
    'share_from_n_biggest',
    'counted_from_people',
    'pac_people',
    'pac_no_sponsor',
    'pac_business',
    'pac_politician',
    'pac_counted',
    'earmarked_platforms',
    'earmarked_directing',
    'score_unrounded',
    'score',
    'grade',
    'live_grade',
    'e_grade',
    'cause',
  ];
  const rows = [cols.join(',')];
  const PLATFORM = /\b(ACTBLUE|WINRED|DEMOCRACY ENGINE)\b/;
  for (const m of inputs.members) {
    const r = F.get(m.id);
    const byG = { people: 0, nosponsor: 0, business: 0, politician: 0 };
    for (const [id, amt] of [...(m.gifts || []), ...(m.giftsToFunds || [])]) {
      byG[groupOf(id)] = (byG[groupOf(id)] || 0) + amt;
    }
    const plat = (m.conduits || [])
      .filter(c => PLATFORM.test(String(c.name).toUpperCase()))
      .reduce((t, c) => t + c.amount, 0);
    const dir = (m.conduits || [])
      .filter(c => c.id && !PLATFORM.test(String(c.name).toUpperCase()))
      .reduce((t, c) => t + c.amount, 0);
    const funds = (m.pf.committees || [])
      .filter(c => c.role === 'joint' && c.ownFund)
      .reduce((t, c) => t + num(c.raised), 0);
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
        funds,
        r.denominator,
        r.n,
        r.N,
        r.nN,
        r.allowance,
        r.reliable,
        r.fallback,
        r.topShare,
        r.fromPeople,
        byG.people,
        byG.nosponsor,
        byG.business,
        byG.politician,
        r.creditDollars,
        plat,
        dir,
        r.x,
        r.score,
        r.tier,
        m.published?.tier,
        run(E).results.get(m.id)?.tier,
        causes(m.id),
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, 'Final.csv'), rows.join('\n'));
  const pcols = [
    'id',
    'name',
    'type',
    'designation',
    'org_type',
    'connected_org',
    'irs_status',
    'irs_subsection',
    'irs_ein',
    'irs_matched_on',
    'fec_leadership_pac',
    'fec_sponsor_candidates',
    'fec_field_group',
    'group',
    'settled_by',
    'not_settled',
    'reason',
    'given_to_members',
    'traces_to_people',
    'counts',
  ];
  const prow = [pcols.join(',')];
  for (const [id, p] of Object.entries(inputs.pacs).sort(
    (a, b) => (pacGiven.get(b[0]) || 0) - (pacGiven.get(a[0]) || 0)
  )) {
    const sh = finalShares.get(id)?.[2];
    prow.push(
      [
        id,
        p.name,
        p.type,
        p.designation,
        p.orgType,
        p.connectedOrg,
        p.sponsor.irs?.status,
        p.sponsor.irs?.subsection || p.sponsor.irs?.subsections,
        p.sponsor.irs?.ein,
        p.sponsor.irs?.matchedOn,
        p.fecRecord?.leadershipPac ?? '',
        (p.fecRecord?.sponsorCandidates || []).join(' '),
        GROUP[p.fecGroup],
        GROUP[p.sponsor.group],
        p.sponsor.settledBy,
        Boolean(p.sponsor.unsettled),
        p.sponsor.reason,
        pacGiven.get(id) || 0,
        sh,
        sh !== undefined ? sh * (TFP.credit[p.sponsor.group] ?? 0) : '',
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, 'PACs.csv'), prow.join('\n'));
}

writeFileSync(join(outDir, 'report.md'), lines.join('\n'));
writeFileSync(
  join(outDir, 'final-results.json'),
  JSON.stringify({ counts: counts(F), e: counts(run(E).results) })
);
console.log(`written to ${outDir}: ${lines.length} lines`);
