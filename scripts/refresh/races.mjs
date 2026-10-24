#!/usr/bin/env node
/**
 * The 2026 races (ROADMAP Phase E; owner's go 2026-10-07): grade every
 * candidate in November's general election, not only sitting members, and
 * publish the races to KV `races:list` for the site's Races view.
 *
 *   node scripts/refresh/races.mjs [--cycle 2026] [--dry-run] [--field ballot|test]
 *     [--states ME,PA] [--batch 100] [--bulk-dir DIR] [--out races.json]
 *
 * Who's on the ballot (owner, 2026-10-23): the general-election candidates
 * Wikipedia lists for each seat, each matched to their own FEC registration
 * for that seat (lib/ballot.mjs). The FEC alone can't say: campaigns that
 * lost a primary or are retiring still file the pre-general report (12G).
 * Those filers are the check: a seat where one isn't listed is held back
 * (and alerted) until scripts/refresh/data/ballot.json records why they're
 * not on the ballot, with a source. `--field test` takes House and Senate
 * candidates who raised $500,000 or more instead; that includes primary
 * losers, so it is always a dry run.
 *
 * Sitting members keep the grade the refresh job gives them (members:list).
 * Everyone else is graded here exactly like a member: all their committees,
 * from the FEC's bulk files, shown as still being double-checked (grade
 * first, confirm after). Their identity is the FEC's candidate ID.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { committeesFinal3, gradeMemberFinal3 } from '../../workers/grading.js';
import { LIST_KEY, sameValue } from '../../workers/member-store.js';
import {
  final3PacShares,
  gradingCycle,
  peoplePowerInfluence,
} from '../../workers/tier-calculation.js';
import { memberDonorShape } from '../simulate/lib/inputs.mjs';
import { analyzePool, loadFara } from './lib/analysis.mjs';
import { buildPacs, directingCommittees, platformIds } from './lib/final3.mjs';
import { pacGifts, pacProfiles, upstreamGifts } from './lib/pacs.mjs';
import { ensureIrs, loadIrsIndex } from './lib/sponsors.mjs';
import { apiRowToBulkShape, ensureBulkFile, insertApiRows, loadBulk } from './lib/bulk.mjs';
import { loadStored } from './lib/gap-store.mjs';
import {
  classifyScheduleARow,
  countsAsItemizedIndividual,
} from '../../workers/schedule-a-classify.js';
import { RESULTS_DB, createCloudflare } from './lib/cloudflare.mjs';
import { discoverPeople, ensureZip, loadDiscoveryFiles } from './lib/discovery.mjs';
import { createFecClient } from './lib/fec.mjs';
import { buildRaces, displayName, parseWeball } from './lib/races.mjs';
import { ballotField, parseCn, seatChanges, seatOf, WIKI_PAGES, wikiSeats } from './lib/ballot.mjs';
import { stateByName } from '../../src/lib/states.js';

export const RACES_KEY = 'races:list';
// Matches checked by hand, and campaigns checked as not on the ballot
const BALLOT_FILE = new URL('./data/ballot.json', import.meta.url).pathname;
// A committee whose check has an outcome (as in the refresh job)
const SETTLED = new Set(['reconciled', 'reconciled-with-note', 'mismatch']);
const RECONCILED = new Set(['reconciled', 'reconciled-with-note']);
const countsApi = r => countsAsItemizedIndividual(classifyScheduleARow(r));
const TEST_FLOOR = 500000;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const now = () => new Date().toISOString();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function fecKey() {
  if (process.env.FEC_API_KEY) {
    return process.env.FEC_API_KEY;
  }
  const local = new URL('../../API_KEYS.md', import.meta.url).pathname;
  return existsSync(local) ? readFileSync(local, 'utf8').match(/`([A-Za-z0-9]{40})`/)?.[1] : null;
}

/** A Wikipedia page's HTML, at its current revision or `oldid`, through its API */
async function wikiPage(title, oldid = null) {
  const which = oldid ? { oldid: String(oldid) } : { page: title };
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'parse', ...which, prop: 'text|revid', format: 'json', formatversion: '2' })}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TaskForcePurple/1.0 (https://taskforcepurple.com)' },
  });
  const d = await res.json();
  if (!d.parse?.text) {
    throw new Error(`Wikipedia page ${title}: ${d.error?.info || res.status}`);
  }
  return { title: d.parse.title, revid: d.parse.revid, html: d.parse.text };
}

// Committees that filed the pre-general report: the general-election field.
// The FEC's processed filings list takes days to catch up after the
// deadline (on 23 October 2026 it had 689 of 1,181 filers), so the
// electronic filings, listed within minutes, are read as well
async function preGeneralFilers(fec, cycle) {
  const ids = new Set();
  for (let page = 1; ; page++) {
    const d = await fec('/filings/', {
      report_type: '12G',
      cycle,
      form_type: 'F3',
      per_page: 100,
      page,
    });
    for (const f of d.results || []) {
      ids.add(f.committee_id);
    }
    if (page >= (d.pagination?.pages || 1)) {
      break;
    }
  }
  const processed = ids.size;
  for (const form_type of ['F3N', 'F3A']) {
    for (let page = 1; ; page++) {
      const d = await fec('/efile/filings/', {
        form_type,
        min_receipt_date: `${cycle}-10-01`,
        per_page: 100,
        page,
      });
      for (const f of d.results || []) {
        if (f.document_description === `PRE-GENERAL ${cycle}`) {
          ids.add(f.committee_id);
        }
      }
      if (page >= (d.pagination?.pages || 1)) {
        break;
      }
    }
  }
  log(
    `pre-general filers: ${processed} processed, ${ids.size - processed} more filed electronically`
  );
  return ids;
}

async function main() {
  const started = Date.now();
  const cycle = Number(arg('--cycle', gradingCycle()));
  const field = arg('--field', 'ballot');
  const dryRun = process.argv.includes('--dry-run') || field === 'test';
  const states = arg('--states', '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const batchSize = Number(arg('--batch', 100));
  const bulkDir = arg('--bulk-dir', join(tmpdir(), 'tfp-bulk'));
  mkdirSync(bulkDir, { recursive: true });

  const cf = createCloudflare();
  const fec = createFecClient(fecKey());
  const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);

  // The FEC's files: donations, committees and links, candidate summaries
  const file = ensureBulkFile(cycle, bulkDir, log);
  const db = await loadDiscoveryFiles(cycle, bulkDir, log);
  const weball = parseWeball(
    readFileSync(
      ensureZip('weball', `weball${String(cycle).slice(2)}.txt`, cycle, bulkDir, log),
      'latin1'
    )
  );

  const memberOf = new Map();
  for (const [bioguideId, ids] of Object.entries(FEC_CROSSWALK)) {
    for (const id of ids) {
      memberOf.set(id, bioguideId);
    }
  }

  // 1. The field: who Wikipedia lists for each seat, matched to the FEC
  // (lib/ballot.mjs); a seat where someone whose campaign filed the
  // pre-general report isn't listed is held back until that's checked
  let field_;
  let sources = null;
  const held = [];
  const wikiChanges = [];
  let published = false;
  if (field === 'test') {
    field_ = [...weball.values()]
      .filter(c => c.receipts >= TEST_FLOOR)
      .map(c => ({ ...c, ids: [c.candidateId] }));
  } else {
    const book = existsSync(BALLOT_FILE) ? JSON.parse(readFileSync(BALLOT_FILE, 'utf8')) : {};
    const { resolved = {}, checked = {}, pinned = {} } = book[cycle] || {};
    // The versions that were checked (owner, 2026-10-23): anyone can edit
    // Wikipedia, so the field comes from the pinned revisions, and what's
    // changed since is listed for checking, never published unchecked
    const pages = {};
    const seatsOn = (office, p) =>
      wikiSeats(p.html, office)
        .map(s => ({ ...seatOf(office, s.label, stateByName), candidates: s.candidates }))
        .filter(s => s.state);
    for (const office of ['H', 'S']) {
      const latest = await wikiPage(WIKI_PAGES[office](cycle));
      const pin = pinned[office];
      pages[office] = pin && pin !== latest.revid ? await wikiPage(latest.title, pin) : latest;
      if (pages[office] !== latest) {
        const changes = seatChanges(seatsOn(office, pages[office]), seatsOn(office, latest));
        wikiChanges.push(...changes.map(c => ({ ...c, revid: latest.revid })));
      }
    }
    log(
      `Wikipedia: ${wikiChanges.length} seat(s) changed since the checked versions` +
        (wikiChanges.length
          ? ` (${wikiChanges.map(c => `${c.key}: ${[...c.added.map(n => `+${n}`), ...c.removed.map(n => `-${n}`)].join(', ')}`).join('; ')})`
          : '')
    );
    sources = Object.fromEntries(
      Object.entries(pages).map(([o, p]) => [o, { title: p.title, revid: p.revid }])
    );
    const seats = Object.entries(pages).flatMap(([office, p]) => seatsOn(office, p));
    const cn = parseCn(readFileSync(ensureZip('cn', 'cn.txt', cycle, bulkDir, log), 'latin1'));
    const filers = await preGeneralFilers(fec, cycle);
    const ballot = ballotField({ seats, cn, cycle, filers, resolved });
    const count = fit => ballot.flatMap(s => s.candidates).filter(c => c.fit === fit).length;
    log(
      `ballot: ${ballot.length} seats from Wikipedia (House rev ${sources.H.revid}, Senate rev ${sources.S.revid}); ` +
        `${ballot.reduce((n, s) => n + s.candidates.length, 0)} candidates: ${count('full')} matched by full name, ` +
        `${count('family')} by family name only, ${count('full-other-district')} registered for another district, ` +
        `${count('checked')} checked by hand, ${count('none')} not registered with the FEC, ${count('ambiguous')} unclear`
    );
    field_ = [];
    for (const s of ballot) {
      const unchecked = s.unlisted.filter(p => !checked[`${s.key}|${p.pcc}`]);
      if (unchecked.length) {
        held.push({
          key: s.key,
          unlisted: unchecked.map(p => ({ name: p.names[0], ids: p.candidateIds, pcc: p.pcc })),
        });
        continue;
      }
      for (const c of s.candidates) {
        if (c.fit === 'ambiguous') {
          log(
            `  ${s.key}: ${c.name} fits more than one registration: ${c.options.map(o => o.names[0]).join('; ')}`
          );
        }
        if (!c.person) {
          field_.push({
            candidateId: null,
            ids: [],
            listedName: c.name,
            listedParty: c.party,
            name: c.name,
            party: c.party,
            ici: null,
            office: s.office,
            state: s.state,
            district: s.district,
            unregistered: true,
          });
          continue;
        }
        const ids = c.person.candidateIds;
        const id = ids.find(i => memberOf.has(i)) || ids[0];
        const r = cn.find(x => x.candidateId === id);
        field_.push({
          candidateId: id,
          ids,
          listedName: c.name,
          listedParty: c.party,
          name: r.name,
          party: r.party,
          ici: r.ici,
          office: s.office,
          state: s.state,
          district: s.district,
        });
      }
    }
    log(
      `held back until checked: ${held.length} seats where a campaign that filed the pre-general report isn't listed` +
        (held.length
          ? ` (${held.map(h => `${h.key}: ${h.unlisted.map(u => u.name).join(', ')}`).join('; ')})`
          : '')
    );
  }
  if (states.length) {
    field_ = field_.filter(c => states.includes(c.state));
  }

  // 2. Sitting members keep their published grade
  const list = JSON.parse((await cf.kvGet(LIST_KEY)) || '{"members":[]}').members;
  const listById = new Map(list.map(m => [m.bioguideId, m]));
  const registered = field_.filter(c => c.candidateId);
  const members = registered.filter(c => memberOf.has(c.candidateId));
  const others = registered.filter(c => !memberOf.has(c.candidateId));
  log(
    `field (${field}${states.length ? `, ${states.join(',')}` : ''}): ${field_.length} candidates, ${members.length} sitting members, ${others.length} to grade`
  );

  // 3. Grade everyone else, like a member
  const discovered = await discoverPeople({
    fec,
    db,
    people: others.map(c => ({ id: c.candidateId, ids: c.ids })),
    cycle,
    log,
  });
  const names = new Map((await db.read('SELECT id, name FROM cm')).map(c => [c.id, c.name]));
  // FINAL-3, as for members (refresh job): every committee whose money
  // reaches a candidate, who it answers to, and its share traced to people
  const giftsFor = new Map();
  const fundGiftsFor = new Map();
  for (const [id, pf] of discovered) {
    const vehicles = (pf.committees || [])
      .filter(c => c.role === 'campaign' || c.role === 'leadership')
      .map(c => c.committeeId);
    giftsFor.set(id, await pacGifts(db, vehicles));
    if (pf.whole?.ownFunds?.length) {
      fundGiftsFor.set(id, await pacGifts(db, pf.whole.ownFunds, vehicles));
    }
  }
  const platforms = await platformIds(db);
  const givers = [...giftsFor.values(), ...fundGiftsFor.values()].flatMap(g => g.map(x => x.id));
  const directing = await directingCommittees(
    db,
    file.path,
    [...discovered.values()].flatMap(pf => pf.donorCommitteeIds || []),
    platforms
  );
  const upstream = await upstreamGifts(db, [...givers, ...directing]);
  const upIds = [...upstream.values()].flatMap(u => u.map(x => x.id));
  const profiles = await pacProfiles(db, file.path, [...givers, ...directing, ...upIds]);
  const irsIndex = await loadIrsIndex(sql => db.read(sql), ensureIrs(bulkDir, log));
  const pacs = await buildPacs({
    db,
    ids: [...givers, ...directing, ...upIds],
    fec,
    cycle,
    profiles,
    upstream,
    irsIndex,
    log,
  });
  const shares = final3PacShares(pacs);
  const fara = await d1(
    'SELECT employer, fara_firm, registration_number FROM fara_employer_matches'
  );
  const graded = new Map();
  // Candidates not yet fully checked: the workflow starts the candidate
  // check while there are any (#55)
  let unchecked = 0;
  for (let b = 0; b < others.length; b += batchSize) {
    const batch = others.slice(b, b + batchSize);
    const ids = [
      ...new Set(batch.flatMap(c => discovered.get(c.candidateId)?.donorCommitteeIds || [])),
    ];
    const bulk = await loadBulk(file.path, ids.length ? ids : ['C00000000']);
    await loadFara(bulk, fara);
    // Committees already checked against the FEC's records (#55: the
    // candidate check, check-candidates.mjs, or a member's): their fetched
    // records join the bulk file's, as in the refresh job
    const checkedStatus = new Map();
    for (const id of ids) {
      const [prior] = await d1(
        'SELECT status FROM committees WHERE committee_id = ? AND cycle = ?',
        [id, cycle]
      );
      checkedStatus.set(id, prior?.status || 'unchecked');
      if (prior && SETTLED.has(prior.status)) {
        const stored = await loadStored(d1, id, cycle);
        await insertApiRows(
          bulk.conn,
          [...stored.gap, ...stored.earmarked].map(row => apiRowToBulkShape(row, countsApi(row)))
        );
      }
    }
    for (const c of batch) {
      const pf = discovered.get(c.candidateId);
      if (!pf?.donorCommitteeIds?.length) {
        graded.set(c.candidateId, {
          status: 'pending',
          pf: pf || null,
          analysis: null,
          grade: null,
        });
        continue;
      }
      const analysis = await analyzePool(bulk, pf.donorCommitteeIds, {
        conduitName: async id => names.get(id) || id,
      });
      // Graded from the bulk files, shown as still being double-checked
      const shapeDirected = await memberDonorShape(
        bulk,
        pf.donorCommitteeIds,
        analysis.nakamotoCoefficient,
        null,
        { platforms: [...platforms], byState: true }
      );
      const gifts = giftsFor.get(c.candidateId) || [];
      const fundGifts = fundGiftsFor.get(c.candidateId) || [];
      // Checked when every committee reconciled; until then provisional
      const statuses = pf.donorCommitteeIds.map(id => checkedStatus.get(id) || 'unchecked');
      const ok = statuses.every(s => RECONCILED.has(s));
      const pending = !ok && statuses.every(s => RECONCILED.has(s) || s === 'unchecked');
      if (!ok) {
        unchecked++;
      }
      const grade = gradeMemberFinal3(
        {
          pf,
          whole: pf.whole || null,
          reconciliation: { ok, pending },
          record: null,
          shapeDirected,
          gifts: gifts.map(g => [g.id, g.amount]),
          giftsToFunds: fundGifts.map(g => [g.id, g.amount]),
        },
        pacs,
        shares
      );
      analysis.conduits = (analysis.conduits || []).map(c => ({
        ...c,
        country: (c.id && pacs[c.id]?.country?.country) || null,
      }));
      analysis.pacs = committeesFinal3(
        { gifts, giftsToFunds: fundGifts, directedOut: shapeDirected?.directedOut },
        pacs,
        shares
      );
      analysis.donorTest = shapeDirected && {
        donors: shapeDirected.donors,
        nakamoto: shapeDirected.nakamoto,
        total: shapeDirected.total,
        // Where the big money came from, by donor state (owner and Craig, 2026-10-13)
        byState: shapeDirected.byState || [],
      };
      graded.set(c.candidateId, { status: ok ? 'complete' : 'provisional', pf, analysis, grade });
    }
    log(`graded ${Math.min(b + batchSize, others.length)} of ${others.length}`);
  }

  // 4. The races, everyone side by side
  const entry = c => {
    const bioguideId = memberOf.get(c.candidateId) || null;
    const base = {
      candidateId: c.candidateId,
      bioguideId,
      name: displayName(c.name),
      party: c.party,
      ici: c.ici,
      office: c.office,
      state: c.state,
      district: c.district,
      // The party as the ballot prints it (Wikipedia's list): the FEC's
      // codes say OTH for most small parties
      ballotParty: c.listedParty || null,
    };
    if (c.unregistered) {
      // On the ballot but not registered with the FEC (no need to until a
      // campaign raises or spends $5,000): nothing to grade
      return { ...base, name: c.listedName, registered: false, tier: null };
    }
    if (bioguideId) {
      const m = listById.get(bioguideId) || {};
      const pf = m.gradeBasis === 'all-committees' && m.personFigures ? m.personFigures : m;
      return {
        ...base,
        name: m.name || base.name,
        tier: m.tier || null,
        evidenceChecked: m.evidenceChecked ?? null,
        totalRaised: pf.totalRaised ?? null,
        smallDonors: pf.grassrootsDonations ?? null,
        largeDonors: pf.largeDonorDonations ?? null,
        pac: pf.pacMoney ?? null,
        nakamoto: m.nakamotoCoefficient ?? null,
        peoplePowerInfluence: m.peoplePowerInfluence ?? null,
      };
    }
    const g = graded.get(c.candidateId) || {};
    return {
      ...base,
      name: c.listedName || base.name,
      tier: g.grade?.tier || null,
      evidenceChecked: g.grade ? g.grade.evidenceChecked : null,
      totalRaised: g.pf?.totalRaised ?? c.receipts ?? null,
      smallDonors: g.pf?.grassrootsDonations ?? null,
      largeDonors: g.pf?.largeDonorDonations ?? null,
      pac: g.pf?.pacMoney ?? null,
      uniqueDonors: g.analysis?.donorTest?.donors ?? g.analysis?.uniqueDonors ?? null,
      nakamoto: g.analysis?.donorTest?.nakamoto ?? g.analysis?.nakamotoCoefficient ?? null,
      peoplePowerInfluence: peoplePowerInfluence(g.grade?.detail),
    };
  };
  const races = buildRaces(field_.map(entry));
  const tiers = {};
  for (const g of graded.values()) {
    const t = g.grade?.tier || 'pending';
    tiers[t] = (tiers[t] || 0) + 1;
  }
  log(`${races.length} races; challengers' and open-seat grades: ${JSON.stringify(tiers)}`);
  for (const r of races.slice(0, 3)) {
    log(
      `  ${r.state} ${r.label}: ${r.candidates.map(c => `${c.name} (${c.party}${c.ici === 'I' ? ', incumbent' : ''}) ${c.tier || '-'}`).join(' | ')}`
    );
  }

  const out = arg('--out', null);
  if (out) {
    writeFileSync(out, JSON.stringify({ cycle, field, sources, held, races }, null, 1));
    log(`races written to ${out}`);
  }
  if (dryRun) {
    log(`dry run${field === 'test' ? ' (test field)' : ''}: nothing written`);
  } else {
    // Each graded candidate, written only if something changed
    for (const c of others) {
      const g = graded.get(c.candidateId);
      await d1(
        `INSERT INTO race_candidates (candidate_id, cycle, office, state, district, name, party, ici, computed_at, pool, analysis, grade, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(candidate_id, cycle) DO UPDATE SET name=excluded.name, party=excluded.party, ici=excluded.ici,
           computed_at=excluded.computed_at, pool=excluded.pool, analysis=excluded.analysis, grade=excluded.grade,
           status=excluded.status
         WHERE race_candidates.pool IS NOT excluded.pool OR race_candidates.analysis IS NOT excluded.analysis
           OR race_candidates.grade IS NOT excluded.grade OR race_candidates.status IS NOT excluded.status`,
        [
          c.candidateId,
          cycle,
          c.office,
          c.state,
          c.district,
          c.name,
          c.party,
          c.ici,
          now(),
          g.pf
            ? JSON.stringify({
                committees: g.pf.committees,
                donorCommitteeIds: g.pf.donorCommitteeIds,
                totals: { totalRaised: g.pf.totalRaised, raisedInName: g.pf.raisedInName },
              })
            : null,
          g.analysis ? JSON.stringify(g.analysis) : null,
          g.grade
            ? JSON.stringify({
                tier: g.grade.tier,
                individualFundingPercent: g.grade.individualFundingPercent,
                ...(g.grade.disputeReason
                  ? { disputed: true, disputeReason: g.grade.disputeReason }
                  : {}),
                gradeBasis: g.grade.gradeBasis,
                personFigures: g.grade.personFigures,
                evidenceChecked: g.grade.evidenceChecked,
                detail: g.grade.detail,
              })
            : null,
          g.status,
        ]
      );
    }
    // The races list: one KV write, only if it changed
    const body = { cycle, field, sources, races };
    const current = JSON.parse((await cf.kvGet(RACES_KEY)) || 'null');
    if (current && sameValue({ ...current, updatedAt: undefined }, body)) {
      log('races list unchanged');
    } else {
      await cf.kvPut(RACES_KEY, JSON.stringify({ ...body, updatedAt: now() }));
      log(`published ${races.length} races`);
      published = true;
    }
    // Charge D1's own figures to the job's ledger
    await d1(
      `INSERT INTO d1_write_budget (day, rows_written, rows_read) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written,
         rows_read = rows_read + excluded.rows_read`,
      [now().slice(0, 10), cf.stats.d1RowsWritten + 1, cf.stats.d1RowsRead]
    );
  }
  log(
    `done in ${Math.round((Date.now() - started) / 60000)} min: ${fec.calls} FEC calls, ${cf.stats.d1RowsWritten} D1 rows written, ${cf.stats.kvWrites} KV writes; ${unchecked} candidate(s) not yet fully checked`
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `unchecked=${dryRun ? 0 : unchecked}\nlist_changed=${published}\nwiki_changes=${wikiChanges.length}\nwiki_changed=${wikiChanges.map(c => `${c.key} (${[...c.added.map(n => `added ${n}`), ...c.removed.map(n => `removed ${n}`)].join(', ')})`).join('; ')}\nheld=${held.length}\nheld_seats=${held.map(h => `${h.key} (${h.unlisted.map(u => u.name).join(', ')})`).join('; ')}\n`
    );
  }
}

main().catch(error => {
  console.error(`races job failed: ${error.message}`);
  process.exit(1);
});
