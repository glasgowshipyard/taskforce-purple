// Outside spending (owner, 2026-10-25): what groups other than the
// candidate's own committees spent to help or hurt them, from the FEC's
// independent-expenditure file. Super PACs and other groups file these
// within a day or two of spending (24- and 48-hour reports), and the FEC
// rebuilds the file daily, so it's current where the FEC's processed
// figures run days behind. Not part of any grade: shown beside it, with the
// BOOSTED stamp when the help outweighs the candidate's whole campaign
// (src/lib/outside.js).
//
// Read at site build time (scripts/site/prerender.mjs): two public files,
// no API key.
//   independent_expenditure_<cycle>.csv  every reported outside spend
//   cm<yy>.zip                           the FEC's register of committees
//
// The FEC publishes whatever is filed and reviews it later, so the file
// carries things that aren't spending:
//   - filers who aren't on the register of committees (2026-10-25: four,
//     claiming over $17 billion between them): left out, and counted;
//   - a later version of the same item (an amendment, or a 24-hour item
//     restated on the group's regular report): counted once.

import { inflateRawSync } from 'node:zlib';

export const ieUrl = cycle =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/independent_expenditure_${cycle}.csv`;
export const registerUrl = cycle =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/cm${String(cycle).slice(2)}.zip`;

// Spenders shown per side for each person
const SHOWN = 5;
// The FEC's election types kept apart; anything else (convention, other) is O
const STAGES = ['P', 'R', 'G', 'S'];

/** A CSV of quoted or plain fields, with "" for a quote inside a field */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body
    .filter(r => r.length === head.length)
    .map(r => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

/** The one file inside a zip (the register is a single cm.txt) */
export function unzipOne(buffer) {
  // End of central directory, then the first central-directory entry
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) {
    eocd--;
  }
  if (eocd < 0) {
    throw new Error('not a zip file');
  }
  const cd = buffer.readUInt32LE(eocd + 16);
  const method = buffer.readUInt16LE(cd + 10);
  const size = buffer.readUInt32LE(cd + 20);
  const local = buffer.readUInt32LE(cd + 42);
  const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}

/** Committee IDs on the register (cm.txt: pipe-separated, ID first) */
export const registeredIds = text =>
  new Set(
    text
      .split('\n')
      .map(line => line.slice(0, line.indexOf('|')))
      .filter(Boolean)
  );

const MONTHS = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};
/** "09-OCT-26" -> "2026-10-09" (null when missing or unreadable) */
export function fecDate(text) {
  const m = String(text ?? '').match(/^(\d{2})-([A-Z]{3})-(\d{2})$/);
  if (!m || !(m[2] in MONTHS)) {
    return null;
  }
  return new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1])))
    .toISOString()
    .slice(0, 10);
}

const amendment = text => (text === 'N' ? 0 : Number(String(text).replace(/\D/g, '')) || 1);

/**
 * Each candidate's outside spending for the cycle, from the file's rows.
 * `registered`: the register's committee IDs. Returns
 *   { candidates: { [candidateId]: { for, against, byStage, spenders } }, through, left }
 * where byStage splits for and against by the election it was for (P
 * primary, R runoff, G general, S special, O anything else: owner,
 * 2026-11-04, so the general election can be looked at on its own),
 * spenders are the biggest on each side ({ id, name, side, amount }),
 * `through` is the newest filing in the file, and `left` counts the
 * unregistered filers left out.
 */
export function outsideSpending(rows, registered, cycle) {
  const left = new Map();
  // 1. One row per item: the newest version of each spender's transaction
  const items = new Map();
  let through = null;
  for (const r of rows) {
    if (!r.cand_id || !['S', 'O'].includes(r.sup_opp)) {
      continue;
    }
    if (String(r.fec_election_yr) !== String(cycle)) {
      continue;
    }
    const amount = Number(r.exp_amo);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    if (!registered.has(r.spe_id)) {
      const l = left.get(r.spe_id) || { amount: 0 };
      l.amount += amount;
      left.set(r.spe_id, l);
      continue;
    }
    const received = fecDate(r.receipt_dat);
    if (received && (!through || received > through)) {
      through = received;
    }
    const key = `${r.spe_id}|${r.tran_id}`;
    const old = items.get(key);
    const version = [received || '', amendment(r.amndt_ind)];
    if (
      !old ||
      version[0] > old.version[0] ||
      (version[0] === old.version[0] && version[1] >= old.version[1])
    ) {
      items.set(key, { r, amount, version });
    }
  }
  // 2. The same spend under a new transaction ID in a later filing (a
  // 24-hour item restated on the regular report): counted once. Items in
  // the same filing stay separate, as two buys of the same size can be
  const seen = new Map();
  const candidates = {};
  for (const { r, amount } of items.values()) {
    const same = `${r.spe_id}|${r.cand_id}|${r.sup_opp}|${amount}|${r.dissem_dt || r.exp_date}`;
    const files = seen.get(same) || new Set();
    if (files.size && !files.has(r.file_num)) {
      continue;
    }
    files.add(r.file_num);
    seen.set(same, files);

    const c = (candidates[r.cand_id] ||= {
      for: 0,
      against: 0,
      byStage: {},
      bySpender: new Map(),
    });
    const side = r.sup_opp === 'S' ? 'for' : 'against';
    c[side] += amount;
    const stage = STAGES.includes(r.ele_type) ? r.ele_type : 'O';
    (c.byStage[stage] ||= { for: 0, against: 0 })[side] += amount;
    const k = `${side}|${r.spe_id}`;
    const s = c.bySpender.get(k) || {
      id: r.spe_id,
      name: r.spe_nam.trim(),
      side,
      amount: 0,
      stages: [],
      general: 0,
      special: 0,
    };
    s.amount += amount;
    // The general election's own (and a special election's), for the
    // results page's sides (raceSpenders)
    s.general += r.ele_type === 'G' ? amount : 0;
    s.special += r.ele_type === 'S' ? amount : 0;
    // Which election it was for (primary, runoff, general), so a page can
    // say a group spent against them in the primary (owner, 2026-10-25)
    if (['P', 'R', 'G'].includes(r.ele_type) && !s.stages.includes(r.ele_type)) {
      s.stages.push(r.ele_type);
    }
    c.bySpender.set(k, s);
  }
  // Every spender on each candidate, kept apart from what's published
  // for them (raceSpenders adds them up race by race)
  const everySpender = {};
  for (const [id, c] of Object.entries(candidates)) {
    const all = [...c.bySpender.values()].sort((a, b) => b.amount - a.amount);
    everySpender[id] = all;
    c.spenders = ['for', 'against'].flatMap(side =>
      all
        .filter(s => s.side === side)
        .slice(0, SHOWN)
        .map(s => ({ id: s.id, name: s.name, side: s.side, amount: s.amount, stages: s.stages }))
    );
    c.spenderCount = { for: 0, against: 0 };
    for (const s of all) {
      c.spenderCount[s.side] += 1;
    }
    delete c.bySpender;
  }
  return {
    candidates,
    everySpender,
    through,
    left: {
      filers: left.size,
      amount: [...left.values()].reduce((s, l) => s + l.amount, 0),
    },
  };
}

// A race is given its sides when outside groups spent at least this in its
// general election
const SIDES_FROM = 1e6;
// Groups listed on each side, each with at least 1% of the race's money
const SIDE_GROUPS = 5;
const SIDE_SHARE = 0.01;

/**
 * Who backed whom, race by race (the results page, owner 2026-11-06): the
 * general election's outside money (and a special election's own), each
 * group's spending added up on the side it took. A group is on a
 * candidate's side when it spent for them or against their opponent; the
 * two sides are the two candidates outside money was most spent on.
 * `races`: the published races. Returns { raceKey: { sides: [{
 * candidateId, groups: [{ id, name, amount }] }] } }, the biggest
 * SIDE_GROUPS groups on each side with SIDE_SHARE of the race's money
 */
export function raceSpenders(everySpender, races) {
  const out = {};
  for (const race of races || []) {
    const amountOf = s => s.general + (race.special ? s.special : 0);
    const spent = race.candidates
      .filter(c => c.candidateId && everySpender[c.candidateId])
      .map(c => {
        const list = everySpender[c.candidateId].filter(s => amountOf(s) > 0);
        return { c, list, total: list.reduce((t, s) => t + amountOf(s), 0) };
      })
      .filter(x => x.total > 0)
      .sort((a, b) => b.total - a.total);
    const main = spent.slice(0, 2);
    const total = spent.reduce((t, x) => t + x.total, 0);
    if (main.length < 2 || total < SIDES_FROM) {
      continue;
    }
    const sides = main.map(() => new Map());
    main.forEach((m, i) => {
      for (const s of m.list) {
        // For this candidate: their side; against them: their opponent's
        const side = sides[s.side === 'for' ? i : 1 - i];
        const g = side.get(s.id) || { id: s.id, name: s.name, amount: 0 };
        g.amount += amountOf(s);
        side.set(s.id, g);
      }
    });
    out[race.key] = {
      sides: main.map((m, i) => ({
        candidateId: m.c.candidateId,
        groups: [...sides[i].values()]
          .filter(g => g.amount >= SIDE_SHARE * total)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, SIDE_GROUPS)
          .map(g => ({ ...g, amount: Math.round(g.amount) })),
      })),
    };
  }
  return out;
}

/** Whole dollars, rounded once at the end, so a person's figures add up */
const whole = c => ({
  ...c,
  for: Math.round(c.for),
  against: Math.round(c.against),
  byStage: Object.fromEntries(
    Object.entries(c.byStage || {}).map(([k, v]) => [
      k,
      { for: Math.round(v.for), against: Math.round(v.against) },
    ])
  ),
  spenders: c.spenders.map(s => ({
    ...s,
    amount: Math.round(s.amount),
    stages: [...(s.stages || [])].sort((a, b) => 'PRG'.indexOf(a) - 'PRG'.indexOf(b)),
  })),
});

/**
 * By person, as the site looks them up: a member by bioguide ID, adding up
 * the candidate IDs they hold (fec-crosswalk), anyone else by candidate ID
 */
export function byPerson(candidates, crosswalk, others) {
  const people = {};
  const add = (key, ids) => {
    const parts = ids.map(id => candidates[id]).filter(Boolean);
    if (!parts.length) {
      return;
    }
    if (parts.length === 1) {
      people[key] = whole(parts[0]);
      return;
    }
    const spenders = new Map();
    for (const p of parts) {
      for (const s of p.spenders) {
        const k = `${s.side}|${s.id}`;
        const t = spenders.get(k) || { ...s, amount: 0, stages: [] };
        t.amount += s.amount;
        t.stages = [...new Set([...t.stages, ...(s.stages || [])])];
        spenders.set(k, t);
      }
    }
    const all = [...spenders.values()].sort((a, b) => b.amount - a.amount);
    const byStage = {};
    for (const p of parts) {
      for (const [k, v] of Object.entries(p.byStage || {})) {
        const t = (byStage[k] ||= { for: 0, against: 0 });
        t.for += v.for;
        t.against += v.against;
      }
    }
    people[key] = whole({
      for: parts.reduce((s, p) => s + p.for, 0),
      against: parts.reduce((s, p) => s + p.against, 0),
      byStage,
      spenders: ['for', 'against'].flatMap(side =>
        all.filter(s => s.side === side).slice(0, SHOWN)
      ),
      spenderCount: {
        for: Math.max(...parts.map(p => p.spenderCount.for)),
        against: Math.max(...parts.map(p => p.spenderCount.against)),
      },
    });
  };
  for (const [bioguideId, ids] of Object.entries(crosswalk)) {
    add(bioguideId, ids);
  }
  for (const id of others) {
    add(id, [id]);
  }
  return people;
}

/**
 * Download and work out the cycle's outside spending. Throws if either file
 * can't be read; the build then keeps the live site's copy.
 */
export async function loadOutside(cycle, crosswalk, others, races = []) {
  const get = async url => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    return response;
  };
  const csv = await get(ieUrl(cycle));
  const lastModified = csv.headers.get('last-modified');
  const fileSize = Number(csv.headers.get('content-length')) || null;
  const rows = parseCsv(await csv.text());
  const register = unzipOne(Buffer.from(await (await get(registerUrl(cycle))).arrayBuffer()));
  const registered = registeredIds(register.toString('latin1'));
  if (rows.length < 1000 || registered.size < 1000) {
    throw new Error(`outside spending: ${rows.length} rows, ${registered.size} committees`);
  }
  const { candidates, everySpender, through, left } = outsideSpending(rows, registered, cycle);
  return {
    cycle,
    through,
    fileModified: lastModified,
    fileSize,
    source: ieUrl(cycle),
    left,
    people: byPerson(candidates, crosswalk, others),
    races: raceSpenders(everySpender, races),
  };
}

/**
 * The daily check's question (owner, 2026-10-25): has the FEC's file
 * changed since the live site was built? The FEC rewrites the file every
 * day whether or not anything was filed, so its size is compared, not its
 * date. Until OUTSIDE_UNTIL (the post-election reports' deadline), then it
 * switches itself off. Also says when the live copy has been kept for
 * days because the build couldn't read the FEC's files.
 */
export const OUTSIDE_UNTIL = '2026-12-03';
export function outsideRebuild({ live, size, today }) {
  if (today > OUTSIDE_UNTIL) {
    return { due: false, why: `switched off after ${OUTSIDE_UNTIL}` };
  }
  const stale =
    live?.keptSince && (Date.parse(today) - Date.parse(live.keptSince)) / 86400000 >= 2
      ? `The site's outside-spending figures haven't updated since ${live.keptSince}: the site build couldn't read the FEC's files.`
      : null;
  if (!live) {
    return { due: true, why: 'the live site has no outside-spending file', stale };
  }
  if (!size) {
    return { due: false, why: "the FEC's file didn't answer", stale };
  }
  return live.fileSize === size
    ? { due: false, why: `unchanged (${size} bytes)`, stale }
    : { due: true, why: `changed (${live.fileSize ?? 'unknown'} -> ${size} bytes)`, stale };
}
