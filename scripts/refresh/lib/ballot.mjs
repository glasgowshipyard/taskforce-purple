/**
 * Who's on November's ballot (owner, 2026-10-23): the general-election
 * candidates Wikipedia lists for each seat, each matched to their own FEC
 * registration for that seat. The FEC alone can't say: campaigns that lost
 * a primary, or whose member is retiring, still file the pre-general report
 * (on 23 October 2026 Cornyn's did, after losing the runoff). Matching is a
 * lookup inside one seat, never a search across Congress: a candidate is
 * matched only when exactly one FEC registration in that seat fits their
 * name, and one person with two FEC IDs (a second statement of candidacy)
 * is one person, found by their principal campaign committee.
 */
import { fold, SHORT_FORMS } from '../../../src/lib/search.js';

const TITLES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'mr', 'mrs', 'ms', 'dr', 'hon', 'rev']);
const words = text =>
  fold(String(text).replace(/['’]/g, ''))
    .split(' ')
    .filter(w => w && !TITLES.has(w));

/** Every form a first name goes by: Daniel, Dan, Danny */
function forms(name) {
  const out = new Set([name]);
  for (const [full, short] of Object.entries(SHORT_FORMS)) {
    if (full === name || short.includes(name)) {
      out.add(full);
      short.forEach(s => out.add(s));
    }
  }
  return out;
}

/** The FEC's "LAST, FIRST MIDDLE 'NICK', JR" as family and given names */
export function fecName(name) {
  const [last, ...rest] = String(name).split(',');
  return { family: words(last), given: words(rest.join(' ')) };
}

/**
 * How a name as Wikipedia gives it ("Dan S. Sullivan", "Debbie Wasserman
 * Schultz") fits an FEC registration: 'full' (first and family name both in
 * it, in either order: the FEC has "NICK, LALOTA" and a married name before
 * a maiden one), 'family' (family name only) or null
 */
export function nameFit(wikiName, fec) {
  const w = words(wikiName);
  const { family, given } = fecName(fec);
  if (w.length < 2 || !family.length) {
    return null;
  }
  const all = new Set([...family, ...given]);
  const last = w[w.length - 1];
  const tail = w.slice(-family.length).join(' ');
  const lastFits = all.has(last) || tail === family.join(' ');
  if (!lastFits) {
    return null;
  }
  const first = w[0];
  const firstFits =
    [...forms(first)].some(f => all.has(f) && f !== last) ||
    (first.length === 1 && given.some(g => g[0] === first));
  if (firstFits) {
    return 'full';
  }
  return family.includes(last) || tail === family.join(' ') ? 'family' : null;
}

/**
 * What Wikipedia's middle initials say about a registration: 'agree' (the
 * FEC has those initials), 'differ' (it has other middle names) or null
 */
function initials(wikiName, fec) {
  const given = words(wikiName)
    .slice(1, -1)
    .filter(x => x.length === 1);
  const middle = fecName(fec).given.slice(1);
  if (!given.length || !middle.length) {
    return null;
  }
  return given.every(i => middle.some(g => g[0] === i)) ? 'agree' : 'differ';
}

/** FEC candidate rows grouped into people by principal campaign committee */
export function people(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = r.pcc || r.candidateId;
    const p = byKey.get(key) || {
      pcc: r.pcc || null,
      pccs: r.pcc ? [r.pcc] : [],
      candidateIds: [],
      names: new Set(),
      party: r.party,
    };
    p.candidateIds.push(r.candidateId);
    p.names.add(r.name);
    byKey.set(key, p);
  }
  return [...byKey.values()].map(p => ({ ...p, names: [...p.names] }));
}

/**
 * Wikipedia's candidates for one seat matched to that seat's FEC people:
 * each { name, party, person, fit } with person null when no single
 * person fits (never registered: raised under $5,000; or two people fit)
 */
export function matchSeat(listed, seatPeople) {
  return listed.map(c => {
    const scored = seatPeople
      .map(p => {
        const fits = p.names.map(n => nameFit(c.name, n));
        return {
          p,
          fit: fits.includes('full') ? 'full' : fits.includes('family') ? 'family' : null,
          initials: p.names.map(n => initials(c.name, n)),
        };
      })
      .filter(x => x.fit);
    let pool = scored.some(x => x.fit === 'full') ? scored.filter(x => x.fit === 'full') : scored;
    // Two people of one name in one race (Alaska's Senate race, 2026: Dan
    // J. and Dan S. Sullivan): the middle initial decides
    if (pool.length > 1 && pool.some(x => x.initials.includes('agree'))) {
      pool = pool.filter(x => x.initials.includes('agree'));
    } else if (pool.length > 1) {
      pool = pool.filter(x => !x.initials.includes('differ'));
    }
    // One person registered twice under one name, without the same
    // committee (a second statement of candidacy): still one person
    if (
      pool.length > 1 &&
      new Set(
        pool.map(x => fecName(x.p.names[0]).family.join(' ') + '|' + fecName(x.p.names[0]).given[0])
      ).size === 1
    ) {
      pool = [{ ...pool[0], p: mergePeople(pool.map(x => x.p)) }];
    }
    if (pool.length === 1) {
      return { ...c, person: pool[0].p, fit: pool[0].fit };
    }
    return {
      ...c,
      person: null,
      fit: pool.length ? 'ambiguous' : 'none',
      options: pool.map(x => x.p),
    };
  });
}

function mergePeople(ps) {
  return {
    pcc: ps.find(p => p.pcc)?.pcc ?? null,
    pccs: [...new Set(ps.map(p => p.pcc).filter(Boolean))],
    candidateIds: ps.flatMap(p => p.candidateIds),
    names: [...new Set(ps.flatMap(p => p.names))],
    party: ps[0].party,
  };
}

// Wikipedia's pages, read through its API at a fixed revision so every seat
// can link the exact version it came from
export const WIKI_PAGES = {
  H: cycle => `${cycle}_United_States_House_of_Representatives_elections`,
  S: cycle => `${cycle}_United_States_Senate_elections`,
};

const decode = s =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const text = s =>
  decode(s.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const cellsOf = row =>
  [...row.matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(m => ({ tag: m[1], html: m[2] }));

/** The candidates in a table cell: "▌Name (Party)" list items */
function listed(cell) {
  return [...cell.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => {
    const t = text(m[1]).replace(/▌/g, '').trim();
    const p = t.match(/^(.*?)\s*\(([^()]*)\)$/);
    return p ? { name: p[1].trim(), party: p[2].trim() } : { name: t, party: null };
  });
}

/**
 * The seats and candidates on a page's results tables: [{ label, section,
 * candidates }]. House labels are "Alabama 1", "Alaska at-large"; Senate
 * labels are the state, with "(Class 3)" for a special election
 */
export function wikiSeats(html, office) {
  const out = [];
  const sections = [...html.matchAll(/<h2 id="([^"]+)"/g)];
  sections.forEach((s, k) => {
    const section = s[1].replace(/_/g, ' ');
    if (office === 'H' && /^(Special elections|Retirements|Resignations|Summary)/.test(section)) {
      return;
    }
    const body = html.slice(s.index, sections[k + 1]?.index ?? html.length);
    for (const [, table] of body.matchAll(/<table class="wikitable[^"]*">([\s\S]*?)<\/table>/g)) {
      const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
      if (!rows.slice(0, 2).join('').includes('Candidates')) {
        continue;
      }
      for (const row of rows) {
        const cells = cellsOf(row);
        const last = cells[cells.length - 1];
        if (cells.length < 3 || !last.html.includes('<li>')) {
          continue;
        }
        out.push({ label: text(cells[0].html), section, candidates: listed(last.html) });
      }
    }
  });
  return out;
}

const STATE_NAMES = { 'U.S. Virgin Islands': 'Virgin Islands' };

/** A Wikipedia seat label as { office, state, district } (null if not a seat) */
export function seatOf(office, label, stateByName) {
  if (office === 'S') {
    const st = stateByName[label.replace(/\s*\(Class \d\)\s*$/, '').trim()];
    return st ? { office, state: st.code, district: '' } : null;
  }
  const m = label.match(/^(.*) (\d+|at-large)$/);
  const st = m && stateByName[STATE_NAMES[m[1]] || m[1]];
  return st
    ? { office, state: st.code, district: m[2] === 'at-large' ? '00' : m[2].padStart(2, '0') }
    : null;
}

export const seatKey = s => `${s.office}-${s.state}-${s.office === 'H' ? s.district : ''}`;

/** The FEC's candidate master file (cn.txt) as rows */
export function parseCn(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map(l => l.split('|'))
    .map(f => ({
      candidateId: f[0],
      name: f[1],
      party: f[2],
      year: f[3],
      state: f[4],
      office: f[5],
      district: f[6],
      ici: f[7],
      pcc: f[9] || null,
    }));
}

/**
 * November's field: every seat Wikipedia lists, each listed candidate
 * matched to their FEC registration for that seat (a House candidate whose
 * registration names another district of the same state, after district
 * lines were redrawn, only on a full name fit). `resolved` holds matches
 * checked by hand, by seat key and listed name: { candidateId, why }.
 * Returns the seats, and the people in each seat whose campaign filed the
 * pre-general report but who aren't listed (`filers`: committee IDs), to
 * be checked against the state's list
 */
export function ballotField({ seats, cn, cycle, filers = new Set(), resolved = {} }) {
  const year = String(cycle);
  const rows = cn.filter(r => r.year === year && (r.office === 'H' || r.office === 'S'));
  const inSeat = s =>
    rows.filter(
      r =>
        r.office === s.office &&
        r.state === s.state &&
        (s.office === 'S' || s.district === '00' || r.district === s.district)
    );
  const inState = s => rows.filter(r => r.office === s.office && r.state === s.state);
  const byId = new Map(cn.map(r => [r.candidateId, r]));
  return seats.map(s => {
    const key = seatKey(s);
    const seatPeople = people(inSeat(s));
    const statePeople = s.office === 'H' ? people(inState(s)) : seatPeople;
    const candidates = matchSeat(s.candidates, seatPeople).map((c, k) => {
      const hand = resolved[`${key}|${c.name}`];
      if (hand) {
        const r = byId.get(hand.candidateId);
        const p =
          statePeople.find(x => x.candidateIds.includes(hand.candidateId)) || (r && people([r])[0]);
        return { ...c, person: p || null, fit: 'checked', why: hand.why };
      }
      if (!c.person && s.office === 'H') {
        const again = matchSeat([s.candidates[k]], statePeople)[0];
        if (again.person && again.fit === 'full') {
          return { ...again, fit: 'full-other-district' };
        }
      }
      return c;
    });
    const listedPccs = new Set(
      candidates.flatMap(c => c.person?.pccs || [c.person?.pcc]).filter(Boolean)
    );
    const unlisted = seatPeople.filter(p => p.pcc && filers.has(p.pcc) && !listedPccs.has(p.pcc));
    return { ...s, key, candidates, unlisted };
  });
}
