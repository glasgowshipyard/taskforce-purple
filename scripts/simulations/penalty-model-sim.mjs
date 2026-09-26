// Compare the July 2026 capped-quadratic penalty with the current default
// (#42) over live data, exactly as tier recalculation sees it: members:all
// plus stored itemized analyses (rejected when from a different committee).
// Read-only. Snapshot first:
//   npx wrangler kv key get members:all --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote > members.json
//   (analyses: bulk-get itemized_analysis_v2:<bioguide> keys into one {key: object} JSON)
//   node scripts/simulations/penalty-model-sim.mjs members.json analyses.json
import { readFileSync } from 'node:fs';
import { calculateEnhancedTier, CAPPED_QUADRATIC_OPTIONS as OLD, DEFAULT_OPTIONS as NEW } from "../../workers/tier-calculation.js";
const [,, mf, af] = process.argv;
const members = JSON.parse(readFileSync(mf)); const analyses = JSON.parse(readFileSync(af));
const T = ['S','A','B','C','D','E','F'];
const conc = m => { const a = analyses['itemized_analysis_v2:' + m.bioguideId]; return a && a.committeeId === m.committeeInfo?.id ? a : null; };
const rows = [];
for (const m of members) {
  if (!(m.totalRaised > 0)) continue;
  const c = conc(m);
  const o = calculateEnhancedTier(m, c, OLD), n = calculateEnhancedTier(m, c, NEW);
  rows.push({ m, o, n });
}
const graded = rows.filter(r => T.includes(r.o.tier) && T.includes(r.n.tier));
const dist = k => T.map(t => `${t}:${graded.filter(r => r[k].tier === t).length}`).join(' ');
console.log(`graded ${graded.length} (ringfenced/other: ${rows.length - graded.length})`);
console.log('CURRENT (capped quadratic):', dist('o'));
console.log('FIXED   (excess money):    ', dist('n'));
const zeros = k => graded.filter(r => r[k].individualFundingPercent === 0).length;
console.log(`members scoring exactly 0: current ${zeros('o')} -> fixed ${zeros('n')}`);
const distinct = k => new Set(graded.map(r => r[k].individualFundingPercent)).size;
console.log(`distinct score values: current ${distinct('o')} -> fixed ${distinct('n')}`);
console.log('\nTransition (rows current, cols fixed):\n     ' + T.map(t => t.padStart(4)).join(''));
for (const a of T) console.log(`  ${a}  ` + T.map(b => String(graded.filter(r => r.o.tier === a && r.n.tier === b).length || '.').padStart(4)).join(''));
const path = {}; for (const r of graded) path[r.n.detail?.path] = (path[r.n.detail?.path] || 0) + 1;
console.log('\nscoring path (fixed):', path);
const party = {}; for (const r of graded) { const p = (r.m.party || '?')[0]; party[p] ??= {}; party[p][r.n.tier] = (party[p][r.n.tier] || 0) + 1; }
console.log('By party, fixed (descriptive):'); for (const [p, d] of Object.entries(party)) console.log(`  ${p}: ` + T.map(t => `${t}:${d[t] || 0}`).join(' '));
console.log('\nNamed checks:  tier cur->fixed | score cur->fixed | small% itemizedShare anchor(basis) penalty cur->fixed');
for (const n of ['Ocasio-Cortez','Sanders','Pelosi','Jeffries','Scalise','Johnson, Mike','Hawley','Cassidy','Fischer','Durbin','Cramer','Thanedar']) {
  const r = rows.find(x => x.m.name.includes(n)); if (!r) { console.log('  ' + n + ': -'); continue; }
  const d = r.n.detail || {}, od = r.o.detail || {};
  console.log(`  ${r.m.name.slice(0,20).padEnd(20)} ${r.o.tier}->${r.n.tier}  ${String(r.o.individualFundingPercent).padStart(3)}->${String(r.n.individualFundingPercent).padStart(3)}  small ${r.m.grassrootsPercent}% itemized ${d.itemizedPercent ?? '-'}% anchor ${d.trustAnchor ?? '-'}(${d.trustAnchorBasis ?? d.path}) pen ${od.itemizationPenalty ?? '-'}->${d.itemizationPenalty ?? '-'}`);
}
