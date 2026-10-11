#!/usr/bin/env node
/**
 * Second round of the simplification simulation (owner, 2026-10-11): PAC
 * money by who the PAC answers to (variant E-S), joint funds in the donor
 * test, the donor minimum, the fallback's PAC money, and the transfer check.
 * Same frozen snapshot; pure arithmetic on a frozen run's inputs.
 *
 *   node scripts/simulate/report-sponsors.mjs --inputs FILE.inputs.json --out DIR
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE, RANK, personLevel, runGrid, sponsorGroup, spearman } from './lib/grid.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const inputs = JSON.parse(readFileSync(arg('--inputs'), 'utf8'));
const outDir = arg('--out', 'simulation-sponsors');
mkdirSync(outDir, { recursive: true });
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
const GROUP_WORDS = {
  people: 'PEOPLE',
  money: 'MONEY',
  politician: 'ONE POLITICIAN',
  nosponsor: 'NO SPONSOR',
  unclear: 'UNCLEAR',
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
const EF = { ...E, fixedInvariant: true };
const groups = (unclearAs, nosponsor = 1) => ({
  credit: { people: 1, nosponsor, money: 0, politician: 0 },
  unclearAs,
  upstreamZero: true,
});
const ES = unclearAs => ({ ...EF, groups: groups(unclearAs) });
const ES0 = unclearAs => ({ ...EF, groups: groups(unclearAs, 0) });
const EJ = { ...E, jfcProRata: true };
const EM = { ...E, noMinDonors: true };
const EP = { ...E, fixedInvariant: true, jfcProRata: true, noMinDonors: true };
const EPS = unclearAs => ({ ...EP, groups: groups(unclearAs) });

// Steps from E to E-S, so every grade change gets a cause
const chainES = unclearAs => [
  ['E', E],
  ['transfer check fixed', EF],
  [
    'MONEY and ONE POLITICIAN PACs to 0',
    {
      ...EF,
      groups: {
        credit: { people: 0.5, nosponsor: 0.5, money: 0, politician: 0 },
        unclearAs,
        upstreamZero: false,
      },
    },
  ],
  [
    'PEOPLE and NO SPONSOR PACs at full credit',
    {
      ...EF,
      groups: {
        credit: { people: 1, nosponsor: 1, money: 0, politician: 0 },
        unclearAs,
        upstreamZero: false,
      },
    },
  ],
  ['money from MONEY and ONE POLITICIAN committees traced as 0', ES(unclearAs)],
];

const cache = new Map();
const run = cfg => {
  const key = JSON.stringify(cfg, (k, v) => (v instanceof Map ? [...v] : v));
  if (!cache.has(key)) {
    cache.set(key, runGrid(inputs, cfg));
  }
  return cache.get(key);
};
const scoreOf = r => (isLetter(r?.tier) ? r.score - (r.bar || 0) : null);
function causes(chain, id) {
  const tags = [];
  for (let i = 1; i < chain.length; i++) {
    const a = run(chain[i - 1][1]).results.get(id);
    const b = run(chain[i][1]).results.get(id);
    if (a?.tier !== b?.tier) {
      tags.push(`${chain[i][0]} (${a?.tier}→${b?.tier})`);
    } else if (Math.abs((b?.x ?? 0) - (a?.x ?? 0)) >= 0.5) {
      tags.push(`${chain[i][0]} (${(b.x - a.x).toFixed(0)} pts)`);
    }
  }
  return tags.join('; ') || 'no change';
}
function counts(results) {
  const t = {};
  for (const r of results.values()) {
    const k = isLetter(r.tier) ? r.tier : '?';
    t[k] = (t[k] || 0) + 1;
  }
  return t;
}
function changed(aCfg, bCfg) {
  const a = run(aCfg).results;
  const b = run(bCfg).results;
  return inputs.members.filter(m => a.get(m.id)?.tier !== b.get(m.id)?.tier);
}
function upDown(aRes, bRes) {
  const t = {
    D: { up: 0, down: 0, of: 0 },
    R: { up: 0, down: 0, of: 0 },
    I: { up: 0, down: 0, of: 0 },
  };
  for (const m of inputs.members) {
    const a = aRes(m);
    const b = bRes(m);
    if (!isLetter(a) || !isLetter(b)) {
      continue;
    }
    const p = t[partyOf(m.party)];
    p.of++;
    if (RANK[b] > RANK[a]) {
      p.up++;
    } else if (RANK[b] < RANK[a]) {
      p.down++;
    }
  }
  return t;
}

// --- PAC money by group ---
const pacGiven = new Map();
for (const m of inputs.members) {
  for (const [id, amt] of m.gifts || []) {
    pacGiven.set(id, (pacGiven.get(id) || 0) + amt);
  }
}
const groupOf = id => sponsorGroup(inputs.pacs[id]);

// ===================== Report =====================
const snap = inputs.snapshot || {};
say('# PACs by who they answer to');
say('');
say(
  `Same snapshot as the first round (captured ${snap.capturedAt}; FEC bulk files dated 11 October). Inputs re-exported from it (no new data) to add two measures: the donor test with joint-fund gifts scaled to what reached the member, and each committee's transfers from the member's own committees.`
);
say('');

// Sorting rules as applied
say('## How PACs were sorted');
say('');
say('From FEC fields only, in this order:');
say('');
say(
  "1. ONE POLITICIAN: leadership PACs (designation D), joint fundraising committees (designation J) and candidates' committees (type H, S or P, or designation P or A)."
);
say('2. PEOPLE: sponsor type (ORG_TP) L (labor organization) or M (membership organization).');
say('3. MONEY: sponsor type C (corporation) or T (trade association).');
say(
  '4. UNCLEAR: sponsor type V (cooperative) or W (corporation without capital stock), and PACs that name a connected organization but give no sponsor type.'
);
say('5. NO SPONSOR: no sponsor type and no connected organization.');
say('');
say(
  'Readings, where the FEC fields and the brief differ: the sponsor type decides even when no connected organization is named (171 corporate PACs, $29M, name none); a connected organization with no sponsor type is UNCLEAR, not NO SPONSOR; joint funds count as ONE POLITICIAN. Party committees never count as PAC money (they are left out of the gifts, as before); as committees that gave to a PAC, they keep their traced share.'
);
say('');

// Item 3: dollars by group
say('## Money given to members, by group');
say('');
say('| Group | PACs | Given to members | Share of PAC money |');
say('|---|---|---|---|');
const totals = {};
let allGiven = 0;
for (const [id, amt] of pacGiven) {
  const g = groupOf(id);
  totals[g] ||= { n: 0, amt: 0 };
  totals[g].n++;
  totals[g].amt += amt;
  allGiven += amt;
}
for (const g of ['people', 'money', 'politician', 'nosponsor', 'unclear']) {
  const t = totals[g] || { n: 0, amt: 0 };
  say(
    `| ${GROUP_WORDS[g]} | ${t.n.toLocaleString('en-US')} | ${usdM(t.amt)} | ${pct(t.amt / allGiven, 1)} |`
  );
}
say(`| All | ${pacGiven.size.toLocaleString('en-US')} | ${usdM(allGiven)} | 100% |`);
say('');

// Item 1: distributions and reference members
say('## Grades');
say('');
const RUNS = [
  ['E (last round)', E],
  ['E, transfer check fixed', EF],
  ['E-S, UNCLEAR as PEOPLE', ES('people')],
  ['E-S, UNCLEAR as MONEY', ES('money')],
  ['E-S as PEOPLE, NO SPONSOR at 0', ES0('people')],
  ['E-S as MONEY, NO SPONSOR at 0', ES0('money')],
];
say('| Run | S | A | B | C | D | E | F | withheld |');
say('|---|---|---|---|---|---|---|---|---|');
for (const [label, cfg] of RUNS) {
  const c = counts(run(cfg).results);
  say(`| ${label} | ${LETTERS.map(l => c[l] || 0).join(' | ')} | ${c['?'] || 0} |`);
}
say('');
for (const u of ['people', 'money']) {
  const n0 = changed(ES(u), ES0(u)).length;
  say(
    `- NO SPONSOR at 0 instead of full credit (UNCLEAR as ${GROUP_WORDS[u]}): ${n0} grades change.`
  );
}
const unclearDiff = changed(ES('people'), ES('money'));
say(
  `- UNCLEAR as PEOPLE against UNCLEAR as MONEY: ${unclearDiff.length} grades differ${unclearDiff.length ? `: ${unclearDiff.map(m => `${m.name} ${run(ES('people')).results.get(m.id).tier}/${run(ES('money')).results.get(m.id).tier}`).join('; ')}` : ''}.`
);
say('');
say('Reference members (grade and score):');
say('');
say(`| Member | ${RUNS.map(([l]) => l).join(' | ')} |`);
say(`|---|${RUNS.map(() => '---').join('|')}|`);
for (const [id, name] of Object.entries(REFERENCE)) {
  say(
    `| ${name} | ${RUNS.map(([, cfg]) => {
      const r = run(cfg).results.get(id);
      return r ? `${r.tier}${isLetter(r.tier) ? ` ${r.score}` : ''}` : '–';
    }).join(' | ')} |`
  );
}
say('');

// The 25 largest movers vs E
for (const u of ['people']) {
  const cfg = ES(u);
  const a = run(E).results;
  const b = run(cfg).results;
  const movers = inputs.members
    .filter(m => isLetter(a.get(m.id)?.tier) && isLetter(b.get(m.id)?.tier))
    .map(m => ({ m, d: scoreOf(b.get(m.id)) - scoreOf(a.get(m.id)) }))
    .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
    .slice(0, 25);
  say(`### The 25 largest movers, E-S (UNCLEAR as PEOPLE) against E`);
  say('');
  say('| Member | Party | Grade | Score | PAC money by group (given) | Cause |');
  say('|---|---|---|---|---|---|');
  for (const { m } of movers) {
    const byG = {};
    for (const [id, amt] of m.gifts || []) {
      const g = groupOf(id);
      byG[g] = (byG[g] || 0) + amt;
    }
    const mix = Object.entries(byG)
      .sort((x, y) => y[1] - x[1])
      .map(([g, v]) => `${GROUP_WORDS[g]} ${usd(v)}`)
      .join(', ');
    say(
      `| ${m.name} | ${partyOf(m.party)} | ${a.get(m.id).tier}→${b.get(m.id).tier} | ${a.get(m.id).score}→${b.get(m.id).score} | ${mix} | ${causes(chainES(u), m.id)} |`
    );
  }
  say('');
}

// Item 2: up and down by party
say('## Up and down by party');
say('');
say('| Comparison | Democrats up | Democrats down | Republicans up | Republicans down |');
say('|---|---|---|---|---|');
for (const [label, cfg] of RUNS.slice(2)) {
  const vsE = upDown(
    m => run(E).results.get(m.id)?.tier,
    m => run(cfg).results.get(m.id)?.tier
  );
  const vsLive = upDown(
    m => m.published?.tier,
    m => run(cfg).results.get(m.id)?.tier
  );
  say(
    `| ${label} vs E | ${vsE.D.up} of ${vsE.D.of} | ${vsE.D.down} | ${vsE.R.up} of ${vsE.R.of} | ${vsE.R.down} |`
  );
  say(
    `| ${label} vs live | ${vsLive.D.up} of ${vsLive.D.of} | ${vsLive.D.down} | ${vsLive.R.up} of ${vsLive.R.of} | ${vsLive.R.down} |`
  );
}
say('');

// Item 4: 15 largest per group
say('## The 15 largest PACs in each group');
say('');
for (const g of ['people', 'money', 'politician', 'nosponsor', 'unclear']) {
  const list = [...pacGiven.entries()]
    .filter(([id]) => groupOf(id) === g)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  say(`### ${GROUP_WORDS[g]}`);
  say('');
  say('| PAC | Given to members | Type | Designation | ORG_TP | Connected organization |');
  say('|---|---|---|---|---|---|');
  for (const [id, amt] of list) {
    const p = inputs.pacs[id] || {};
    say(
      `| ${p.name || id} | ${usd(amt)} | ${p.type || ''} | ${p.designation || ''} | ${p.orgType || ''} | ${p.connectedOrg || ''} |`
    );
  }
  say('');
}

// Item 5: named PACs
say('## Named PACs');
say('');
const largest = pred =>
  [...pacGiven.entries()]
    .filter(([id]) => pred(inputs.pacs[id] || {}))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
const NAMED = [
  ["Lockheed Martin's PAC", largest(p => /LOCKHEED MARTIN/.test(p.name || ''))],
  ['Air Line Pilots Association PAC', largest(p => /AIR LINE PILOTS/.test(p.name || ''))],
  [
    'American Bankers Association PAC',
    largest(p => /AMERICAN BANKERS ASSOCIATION/.test(p.name || '')),
  ],
  ['The largest leadership PAC', largest(p => p.designation === 'D')],
];
say('| PAC | Given to members | Group | Traces to people (E test) | Counts toward grades in E-S |');
say('|---|---|---|---|---|');
for (const [label, id] of NAMED) {
  if (!id) {
    continue;
  }
  const share = run(ES('people')).shares.get(id)?.[2];
  const g = groupOf(id);
  const credit =
    g === 'people' || g === 'nosponsor' ? 1 : g === 'unclear' ? 'as PEOPLE: 1; as MONEY: 0' : 0;
  say(
    `| ${label}: ${inputs.pacs[id]?.name} | ${usd(pacGiven.get(id))} | ${GROUP_WORDS[g]} | ${pct(share)} | ${typeof credit === 'number' ? pct(share * credit) : credit} |`
  );
}
say('');

// Item 9: the transfer check
say('## The transfer check (item 9)');
say('');
const g3 = inputs.members.filter(m => !personLevel(m));
say(
  "| Member | Total (all committees) | Largest committee | Its receipts | From the member's own committees | Receipts less those | Check before | Check fixed | E (fixed) | E-S as PEOPLE |"
);
say('|---|---|---|---|---|---|---|---|---|---|');
for (const m of g3) {
  const vehicles = (m.pf.committees || []).filter(c => c.role !== 'joint');
  const big = vehicles.sort((a, b) => b.raised - a.raised)[0];
  const into = num(m.internalIn?.[big.id]);
  const rEF = run(EF).results.get(m.id);
  const rES = run(ES('people')).results.get(m.id);
  say(
    `| ${m.name} | ${usd(m.pf.totalRaised)} | ${big.id} | ${usd(big.raised)} | ${usd(into)} | ${usd(big.raised - into)} | fails | ${personLevel(m, { fixedInvariant: true }) ? 'passes' : 'fails'} | ${rEF.tier} ${rEF.score ?? ''} | ${rES.tier} ${rES.score ?? ''} |`
  );
}
const others = inputs.members.filter(
  m => personLevel(m) !== personLevel(m, { fixedInvariant: true }) && !g3.includes(m)
);
say('');
say(
  `The fixed check is weaker than the old one (each committee's receipts less transfers from the member's own committees, never more), so no member who passed before fails now: ${others.length} other members change.`
);
say('');

// Item 6: joint funds in the donor test
say('## Joint funds in the donor test (item 6)');
say('');
const withJfc = inputs.members.filter(m =>
  (m.pf.committees || []).some(c => c.role === 'joint' && c.ownFund)
);
say(
  `The donor test did count each donor's gifts to a member's own joint fund at full size (the settled rule of 26 September: the fund's donors count in full for the member it mainly exists for). ${withJfc.length} members have an own joint fund. Run below with each gift scaled to the share of the fund's money that reached the member (what it passed to them ÷ what it raised); switching would reverse that settled rule.`
);
say('');
{
  const a = run(E).results;
  const b = run(EJ).results;
  const c = counts(b);
  say(
    `E with scaled joint-fund gifts: ${LETTERS.map(l => `${l}${c[l] || 0}`).join(' ')}, withheld ${c['?'] || 0}. ${changed(E, EJ).length} grades change from E.`
  );
  say('');
  say(
    '| Member | Donors holding half (E → scaled) | Big donors | They gave, of all the money | Grade |'
  );
  say('|---|---|---|---|---|');
  for (const id of ['H001089', 'S001217', 'G000555', 'J000299', 'S001176', 'C001035', 'C001056']) {
    const m = byId.get(id);
    if (!m) {
      continue;
    }
    const ra = a.get(id);
    const rb = b.get(id);
    say(
      `| ${m.name} | ${ra.n} → ${rb.n} | ${ra.N} → ${rb.N} | ${pct(ra.topShare)} → ${pct(rb.topShare)} | ${ra.tier} ${ra.score} → ${rb.tier} ${rb.score} |`
    );
  }
  say('');
  const weak = cfg =>
    inputs.members
      .map(m => ({ m, r: run(cfg).results.get(m.id) }))
      .filter(({ r }) => ['S', 'A'].includes(r?.tier) && r.topShare >= 0.4)
      .sort((p, q) => q.r.topShare - p.r.topShare);
  for (const [label, cfg] of [
    ['E', E],
    ['E with scaled joint-fund gifts', EJ],
  ]) {
    const w = weak(cfg);
    say(
      `Weak spot under ${label}: ${w.length} members graded S or A although the donors holding half their big money gave 40% or more of all the money${w.length ? `: ${w.map(({ m, r }) => `${m.name} ${r.tier} ${r.score} (${r.n} donors, ${pct(r.topShare)})`).join('; ')}` : ''}.`
    );
    say('');
  }
}

// Item 7: the donor minimum
say('## No "fewer than 10 donors" fallback (item 7)');
say('');
{
  const a = run(E).results;
  const b = run(EM).results;
  const c = counts(b);
  const gone = inputs.members.filter(m => a.get(m.id)?.fallback && !b.get(m.id)?.fallback);
  say(
    `E without the donor minimum: ${LETTERS.map(l => `${l}${c[l] || 0}`).join(' ')}. Members off the 40% fallback: ${gone.map(m => `${m.name} (${a.get(m.id).N} donors; allowance 40% → ${pct(b.get(m.id).allowance, 1)}; ${a.get(m.id).tier} ${a.get(m.id).score} → ${b.get(m.id).tier} ${b.get(m.id).score})`).join('; ') || 'none'}. Still on it, because our records cover under half the FEC's big-donor total: ${
      inputs.members
        .filter(m => b.get(m.id)?.fallback)
        .map(m => m.name)
        .join('; ') || 'none'
    }.`
  );
  say('');
}

// Item 8: PAC money on the fallback
say('## PAC money on the 40% fallback (item 8)');
say('');
say('| Run | PACs on the fallback | Their money to members | Share of all PAC money |');
say('|---|---|---|---|');
for (const [label, cfg] of [
  ['E (with the 10-donor minimum)', E],
  ['E without it (item 7)', EM],
]) {
  const sh = run(cfg).shares;
  const ids = [...pacGiven.keys()].filter(id => sh.get(id)?.fallback);
  const amt = ids.reduce((t, id) => t + pacGiven.get(id), 0);
  say(
    `| ${label} | ${ids.length} of ${pacGiven.size} | ${usdM(amt)} | ${pct(amt / allGiven, 1)} |`
  );
}
say('');

// Combined
say('## All of it together');
say('');
say(
  'E′ = E with the transfer check fixed, scaled joint-fund gifts and no donor minimum. E′-S = E′ with PACs by who they answer to.'
);
say('');
const COMBINED = [
  ['E', E],
  ['E′', EP],
  ['E′-S, UNCLEAR as PEOPLE', EPS('people')],
  ['E′-S, UNCLEAR as MONEY', EPS('money')],
];
say('| Run | S | A | B | C | D | E | F | withheld | Rank corr. vs E |');
say('|---|---|---|---|---|---|---|---|---|---|');
for (const [label, cfg] of COMBINED) {
  const c = counts(run(cfg).results);
  const a = run(E).results;
  const b = run(cfg).results;
  const ids = inputs.members
    .filter(m => isLetter(a.get(m.id)?.tier) && isLetter(b.get(m.id)?.tier))
    .map(m => m.id);
  const rho = spearman(
    ids.map(id => scoreOf(a.get(id))),
    ids.map(id => scoreOf(b.get(id)))
  );
  say(
    `| ${label} | ${LETTERS.map(l => c[l] || 0).join(' | ')} | ${c['?'] || 0} | ${rho?.toFixed(3)} |`
  );
}
say('');
say(`| Member | ${COMBINED.map(([l]) => l).join(' | ')} |`);
say(`|---|${COMBINED.map(() => '---').join('|')}|`);
for (const [id, name] of Object.entries(REFERENCE)) {
  say(
    `| ${name} | ${COMBINED.map(([, cfg]) => {
      const r = run(cfg).results.get(id);
      return `${r.tier}${isLetter(r.tier) ? ` ${r.score}` : ''}`;
    }).join(' | ')} |`
  );
}
say('');

// ---- CSVs ----
function csv(name, cfg, chain) {
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
    'reliable',
    'fallback',
    'share_from_n_biggest',
    'counted_from_people',
    'pac_people',
    'pac_money',
    'pac_one_politician',
    'pac_no_sponsor',
    'pac_unclear',
    'credit_dollars',
    'credit_points',
    'score_unrounded',
    'score',
    'grade',
    'cause',
  ];
  const rows = [cols.join(',')];
  for (const m of inputs.members) {
    const r = results.get(m.id);
    const byG = { people: 0, money: 0, politician: 0, nosponsor: 0, unclear: 0 };
    for (const [id, amt] of m.gifts || []) {
      byG[groupOf(id)] += amt;
    }
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
        r.reliable,
        r.fallback,
        r.topShare,
        r.fromPeople,
        byG.people,
        byG.money,
        byG.politician,
        byG.nosponsor,
        byG.unclear,
        r.creditDollars,
        r.credit,
        r.x,
        r.score,
        r.tier,
        chain ? causes(chain, m.id) : '',
      ]
        .map(cell)
        .join(',')
    );
  }
  writeFileSync(join(outDir, `${name}.csv`), rows.join('\n'));
}
csv('E', E, null);
csv('E-S', ES('people'), chainES('people'));
csv('E-S-unclear-as-money', ES('money'), chainES('money'));
csv('E-prime', EP, null);
csv('E-prime-S', EPS('people'), null);

writeFileSync(join(outDir, 'report.md'), lines.join('\n'));
console.log(`written to ${outDir}: ${lines.length} lines`);
