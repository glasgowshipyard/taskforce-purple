// Who a PAC answers to: TFP's own sorting (owner's decision, 2026-10-11),
// not the FEC's sponsor field alone. Every PAC goes in one group, decided in
// this order, with the reason kept:
//
//   politician  leadership PACs, candidates' committees, joint funds that
//               aren't the member's own, PACs run by members of Congress
//   business    the sponsor is a business by IRS status: a 501(c)(6)
//               business league, or not tax-exempt at all (companies,
//               partnerships, LLCs, co-ops, mutual insurers). IRS status
//               overrides the FEC field.
//   people      the sponsor is a labor organization (IRS 501(c)(5), or FEC
//               sponsor type L when the IRS file has no match), or a
//               non-business member or issue organization
//   nosponsor   nonconnected PACs with no business or politician behind them
//   party       party committees (never PAC money; kept for tracing)
//
// IRS status comes from the Exempt Organizations Business Master File,
// matched on the sponsor's exact name after tidying (never a fuzzy match).
// Where the FEC and the IRS don't settle it, a stated fact about the sponsor
// decides (sponsor-facts.json), and is listed.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const IRS_FILES = ['eo1', 'eo2', 'eo3', 'eo4'];
const irsUrl = name => `https://www.irs.gov/pub/irs-soi/${name}.csv`;

/** Download the IRS master file (four regional CSVs) if missing. */
export function ensureIrs(dir, log = console.log) {
  const files = [];
  for (const name of IRS_FILES) {
    const path = join(dir, `${name}.csv`);
    if (!existsSync(path) || statSync(path).size === 0) {
      log(`downloading ${irsUrl(name)}`);
      execFileSync('curl', ['-sL', '--fail', '--max-time', '600', '-o', path, irsUrl(name)]);
    }
    files.push(path);
  }
  return files;
}

/** A name tidied for exact matching: case, punctuation, abbreviations, company endings. */
export function normalizeName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(ASSN|ASSOC)\b/g, 'ASSOCIATION')
    .replace(/\bNATL\b/g, 'NATIONAL')
    .replace(/\bINTL\b/g, 'INTERNATIONAL')
    .replace(/\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|LLC|LLP|PC)\b/g, ' ')
    .replace(/^\s*THE\b/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A PAC's own name with the PAC words taken off: its sponsor's name, often. */
export function stripPacWords(name) {
  let s = String(name || '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(EMPLOYEES OF|POLITICAL ACTION COMMITTEE OF( THE)?|PAC OF( THE)?)\s+/, '');
  const tail =
    /\s*[-,;:]?\s*([A-Z-]*PAC|POLITICAL ACTION COMMITTEE|POLITICAL ACTION FUND|POLITICAL ACTION LEAGUE|POLITICAL VICTORY FUND|POLITICAL EDUCATION FUND|POLITICAL FUND|POLITICAL ACTION|PAC|FEDERAL|EMPLOYEES?|EMPLOYEE GOOD GOVERNMENT FUND|GOOD GOVERNMENT FUND|GOOD GOVERNMENT COMMITTEE|CIVIC ACTION COMMITTEE|PUBLIC AFFAIRS COUNCIL|INC\.?|AKA .*|- .*)\s*$/;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(tail, '');
    if (next === s) {
      break;
    }
    s = next;
  }
  return s.trim();
}

// IRS subsection codes for trusts that can't be a PAC's sponsor (employee
// benefit and pension trusts): set aside when a sponsor's name also matches
// an organization of another kind
const BENEFIT_TRUSTS = new Set(['09', '17', '18', '20', '21', '22', '23']);
// Businesses although exempt: the owner names co-ops and mutual insurers
// as businesses (01 federal credit unions, 12 co-ops, 14 credit unions, 15
// small mutual insurers, 16 crop financing)
const EXEMPT_BUSINESS = new Set(['01', '12', '14', '15', '16']);
const SUBSECTION_WORDS = {
  '01': 'a federal corporation such as a federal credit union',
  '03': 'a charity',
  '04': 'a social welfare organization',
  '05': 'a labor or agricultural organization',
  '06': 'a business league (trade or professional association)',
  '07': 'a social club',
  '08': 'a fraternal society',
  10: 'a fraternal society',
  12: 'a cooperative',
  14: 'a credit union',
  15: 'a mutual insurer',
  16: 'a crop financing corporation',
  19: "a veterans' organization",
};

/** Group for an IRS subsection. */
export function groupForSubsection(code) {
  if (code === '06' || EXEMPT_BUSINESS.has(code)) {
    return 'business';
  }
  return 'people';
}

/** Index of IRS records: tidied name -> Map(subsection -> EIN). `rows`: { EIN, NAME, SUBSECTION }. */
export function buildIrsIndex(rows) {
  const index = new Map();
  for (const r of rows) {
    const key = normalizeName(r.NAME);
    if (!key) {
      continue;
    }
    const subs = index.get(key) || new Map();
    const seen = subs.get(r.SUBSECTION);
    subs.set(r.SUBSECTION, { ein: seen?.ein || r.EIN, count: (seen?.count || 0) + 1 });
    index.set(key, subs);
  }
  return index;
}

/** The IRS's word on a sponsor's name: matched (one kind), ambiguous, or unmatched. */
export function irsStatus(index, name) {
  const subs = index.get(normalizeName(name));
  if (!subs) {
    return { status: 'unmatched' };
  }
  let codes = [...subs.keys()];
  if (codes.some(c => !BENEFIT_TRUSTS.has(c))) {
    codes = codes.filter(c => !BENEFIT_TRUSTS.has(c));
  }
  const groups = [...new Set(codes.map(groupForSubsection))];
  if (groups.length === 1) {
    return {
      status: codes.length === 1 ? 'matched' : 'matched-same-kind',
      subsection: codes.length === 1 ? codes[0] : codes.join('/'),
      ein: subs.get(codes[0]).ein,
      group: groups[0],
    };
  }
  // Records of different kinds under one name (a national body and its
  // chapters): the kind most of them are, when most clearly are
  const byGroup = new Map();
  for (const c of codes) {
    const g = groupForSubsection(c);
    byGroup.set(g, (byGroup.get(g) || 0) + subs.get(c).count);
  }
  const ranked = [...byGroup].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((t, [, n]) => t + n, 0);
  const counts = codes.map(c => `${c}:${subs.get(c).count}`).join(', ');
  if (ranked[0][1] >= total * 0.75 && ranked[0][1] > (ranked[1]?.[1] || 0)) {
    const code = codes
      .filter(c => groupForSubsection(c) === ranked[0][0])
      .sort((a, b) => subs.get(b).count - subs.get(a).count)[0];
    return {
      status: 'majority',
      subsection: code,
      ein: subs.get(code).ein,
      group: ranked[0][0],
      counts,
    };
  }
  return { status: 'ambiguous', subsections: counts };
}

const COMPANY_ENDING =
  /\b(INC|INCORPORATED|CORP|CORPORATION|COMPANY|LLC|L\.L\.C|LLP|L\.L\.P|LP|L\.P|PLLC|P\.C|LTD|BANCORP|HOLDINGS)\b\.?/;
// A "connected organization" that is itself a political committee (a PAC's
// own super PAC or fund), not an organization sponsoring the PAC
const POLITICAL_COMMITTEE =
  /\b(PAC|POLITICAL ACTION|VICTORY|CAMPAIGN|FOR CONGRESS|FOR SENATE|SUPER PAC)\b|\bVOTE\b/;
const FEC_ORG = {
  C: 'a corporation',
  L: 'a labor organization',
  M: 'a membership organization',
  T: 'a trade association',
  V: 'a cooperative',
  W: 'a corporation without capital stock',
};
const realName = s => {
  const t = String(s || '').trim();
  return t && t.toUpperCase() !== 'NONE' ? t : null;
};

/** What the FEC's sponsor field alone would say (the earlier sorting, for comparison). */
export function fecGroup(p) {
  const desig = p?.designation;
  if (['D', 'J', 'P', 'A'].includes(desig) || ['H', 'S', 'P'].includes(p?.type)) {
    return 'politician';
  }
  if (['X', 'Y', 'Z'].includes(p?.type)) {
    return 'party';
  }
  const org = p?.orgType;
  if (org === 'L' || org === 'M') {
    return 'people';
  }
  if (org === 'C' || org === 'T' || org === 'V' || org === 'W') {
    return 'business';
  }
  return realName(p?.connectedOrg) ? 'unclear' : 'nosponsor';
}

/**
 * One committee's group and why. `p`: { name, type, designation, orgType,
 * connectedOrg }; `index`: buildIrsIndex(); `facts`: { [id]: { group, fact } }.
 * Returns { group, reason, irs, settledBy }.
 */
export function classifyPac(id, p, index, facts = {}, fecRecord = null) {
  const f = facts[id];
  if (f) {
    return { group: f.group, reason: f.fact, irs: null, settledBy: 'stated fact' };
  }
  const desig = p?.designation;
  const type = p?.type;
  // The FEC's own committee record: registered as a leadership PAC, or
  // sponsored by a candidate (a member's PAC that isn't designated D)
  if (fecRecord?.leadershipPac || fecRecord?.sponsorCandidates?.length) {
    const who = fecRecord.sponsorCandidates?.length
      ? `sponsored by candidate ${fecRecord.sponsorCandidates.join(', ')}`
      : `registered as a leadership PAC${fecRecord.affiliated ? ` (affiliated: ${fecRecord.affiliated})` : ''}`;
    return {
      group: 'politician',
      reason: `FEC committee record: ${who}`,
      irs: null,
      settledBy: 'FEC record',
    };
  }
  if (['X', 'Y', 'Z'].includes(type)) {
    return { group: 'party', reason: 'A party committee', irs: null, settledBy: 'FEC' };
  }
  if (desig === 'D') {
    return {
      group: 'politician',
      reason: 'A leadership PAC (FEC designation D)',
      irs: null,
      settledBy: 'FEC',
    };
  }
  if (desig === 'J') {
    return {
      group: 'politician',
      reason: "Another politician's joint fund (FEC designation J)",
      irs: null,
      settledBy: 'FEC',
    };
  }
  if (['H', 'S', 'P'].includes(type) || desig === 'P' || desig === 'A') {
    return { group: 'politician', reason: "A candidate's committee", irs: null, settledBy: 'FEC' };
  }
  const org = p?.orgType || null;
  const sponsor = realName(p?.connectedOrg);
  // The IRS on the named sponsor; or on the PAC's own name when the FEC says
  // it has a sponsor (a sponsor type, or a lobbying registrant's PAC)
  let irs = sponsor ? irsStatus(index, sponsor) : { status: 'unmatched' };
  let matchedOn = sponsor ? 'sponsor name' : null;
  if (irs.status === 'unmatched' && sponsor) {
    const tidied = irsStatus(index, stripPacWords(sponsor));
    if (tidied.status !== 'unmatched') {
      irs = tidied;
    }
  }
  if (irs.status === 'unmatched' && (org || desig === 'B')) {
    const byPac = irsStatus(index, stripPacWords(p?.name));
    if (byPac.status !== 'unmatched') {
      irs = byPac;
      matchedOn = 'PAC name';
    }
  }
  if (irs.status === 'matched' || irs.status === 'matched-same-kind' || irs.status === 'majority') {
    const words =
      SUBSECTION_WORDS[irs.subsection] || `IRS 501(c)(${String(irs.subsection).replace(/^0/, '')})`;
    return {
      group: irs.group,
      reason: `IRS: 501(c)(${String(irs.subsection).replace(/(^|\/)0/g, '$1')}), ${words} (matched on ${matchedOn}${irs.status === 'majority' ? `; most of the records under this name: ${irs.counts}` : ''})`,
      irs: { ...irs, matchedOn },
      settledBy: 'IRS',
    };
  }
  // The IRS doesn't settle it: the FEC's sponsor type, then the name
  const note =
    irs.status === 'ambiguous'
      ? ` (IRS: several records of different kinds, ${irs.subsections})`
      : '';
  if (org === 'L') {
    return {
      group: 'people',
      reason: `FEC: sponsor is a labor organization; not settled by the IRS file${note}`,
      irs,
      settledBy: 'FEC',
    };
  }
  if (org && org !== 'M') {
    return {
      group: 'business',
      reason: `FEC: sponsor is ${FEC_ORG[org]}; no IRS exempt record${note}`,
      irs,
      settledBy: 'FEC',
    };
  }
  const named = sponsor || p?.name || '';
  const ending =
    String(sponsor || '')
      .toUpperCase()
      .match(COMPANY_ENDING) ||
    String(p?.name || '')
      .toUpperCase()
      .match(COMPANY_ENDING);
  if (ending) {
    return {
      group: 'business',
      reason: `The sponsor's name is a company's ("${ending[1]}"); no IRS exempt record${note}`,
      irs,
      settledBy: 'name',
    };
  }
  if (org === 'M') {
    return {
      group: 'people',
      reason: `FEC: sponsor is a membership organization; not settled by the IRS file${note}`,
      irs,
      settledBy: 'FEC',
      unsettled: true,
    };
  }
  if (sponsor && POLITICAL_COMMITTEE.test(sponsor.toUpperCase())) {
    return {
      group: 'nosponsor',
      reason: `Its "connected organization" (${sponsor}) is another political committee, not a sponsor`,
      irs,
      settledBy: 'FEC',
    };
  }
  if (sponsor) {
    return {
      group: 'people',
      reason: `Names a sponsor (${named}) with no sponsor type, not found in the IRS file: not settled`,
      irs,
      settledBy: 'none',
      unsettled: true,
    };
  }
  return {
    group: 'nosponsor',
    reason: 'No sponsor type and no connected organization',
    irs,
    settledBy: 'FEC',
  };
}

/** Load stated facts (sponsor-facts.json next to this module's data folder). */
export function loadFacts() {
  const path = new URL('../data/sponsor-facts.json', import.meta.url).pathname;
  if (!existsSync(path)) {
    return {};
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([id]) => /^C\d{8}$/.test(id)));
}

/** Read the IRS CSVs into an index (DuckDB `read`). */
export async function loadIrsIndex(read, files) {
  const list = files.map(f => `'${f}'`).join(',');
  const rows = await read(
    `SELECT EIN, NAME, SUBSECTION FROM read_csv([${list}], header=true, all_varchar=true)`
  );
  return buildIrsIndex(rows);
}
