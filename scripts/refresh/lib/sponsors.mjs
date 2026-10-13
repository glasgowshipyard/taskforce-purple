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

// IRS records that can't be a PAC's sponsor, so a name matching only these
// is no match: 501(c)(3) charities (barred from campaign activity, so they
// can't set up a PAC; a company's namesake foundation often shares its name)
// and employee benefit and pension trusts (a company's own trust often
// shares its name)
const NOT_SPONSORS = new Set(['03', '09', '17', '18', '20', '21', '22', '23']);
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

/**
 * Group for an IRS subsection. 501(c)(5) covers labor, agricultural and
 * horticultural groups alike, and the IRS's own sub-codes don't tell them
 * apart reliably (unions coded as farm groups and the reverse), so a
 * 501(c)(5) sponsor is decided by the FEC's sponsor type in classifyPac.
 */
export function groupForSubsection(code) {
  if (code === '06' || EXEMPT_BUSINESS.has(code)) {
    return 'business';
  }
  return 'people';
}
const codeWords = code => SUBSECTION_WORDS[code] || 'an exempt organization';
const codeLabel = code => `501(c)(${String(code).replace(/^0/, '')})`;

/**
 * Index of IRS records: tidied name -> Map(subsection -> { ein, count, name,
 * state }). Where several records share a name and kind (a union's national
 * body and its locals), the EIN kept is the one with the most revenue: the
 * national body, as a rule, whose Form 990 the people test reads.
 * `rows`: { EIN, NAME, SUBSECTION, REVENUE_AMT?, STATE? }.
 */
export function buildIrsIndex(rows) {
  const index = new Map();
  for (const r of rows) {
    const key = normalizeName(r.NAME);
    if (!key) {
      continue;
    }
    const code = r.SUBSECTION;
    const subs = index.get(key) || new Map();
    const seen = subs.get(code);
    const revenue = Number(r.REVENUE_AMT) || 0;
    const top = !seen || revenue > seen.revenue;
    subs.set(code, {
      ein: top ? r.EIN : seen.ein,
      name: top ? r.NAME : seen.name,
      state: top ? r.STATE || null : seen.state,
      revenue: top ? revenue : seen.revenue,
      count: (seen?.count || 0) + 1,
    });
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
  const codes = [...subs.keys()].filter(c => !NOT_SPONSORS.has(c));
  if (!codes.length) {
    return { status: 'unmatched', note: 'only charity or benefit-trust records under this name' };
  }
  const groupOf = c => groupForSubsection(c);
  const groups = [...new Set(codes.map(groupOf))];
  if (groups.length === 1) {
    const top = [...codes].sort((a, b) => subs.get(b).count - subs.get(a).count)[0];
    return {
      status: codes.length === 1 ? 'matched' : 'matched-same-kind',
      subsection: top,
      ein: subs.get(top).ein,
      irsName: subs.get(top).name,
      group: groups[0],
      counts: codes.map(c => `${codeLabel(c)}:${subs.get(c).count}`).join(', '),
    };
  }
  // Records of different kinds under one name (a national body and its
  // chapters): the kind most of them are, when most clearly are
  const byGroup = new Map();
  for (const c of codes) {
    const g = groupOf(c);
    byGroup.set(g, (byGroup.get(g) || 0) + subs.get(c).count);
  }
  const ranked = [...byGroup].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((t, [, n]) => t + n, 0);
  const counts = codes.map(c => `${codeLabel(c)}:${subs.get(c).count}`).join(', ');
  if (ranked[0][1] >= total * 0.75 && ranked[0][1] > (ranked[1]?.[1] || 0)) {
    const code = codes
      .filter(c => groupOf(c) === ranked[0][0])
      .sort((a, b) => subs.get(b).count - subs.get(a).count)[0];
    return {
      status: 'majority',
      subsection: code,
      ein: subs.get(code).ein,
      irsName: subs.get(code).name,
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

// FINAL-2 (owner, 2026-10-12), rule 8: agricultural producers' groups are
// business, whatever the FEC's sponsor type or the IRS's kind
const PRODUCERS =
  /\b(FARM BUREAU|GROWERS?|PRODUCERS|CATTLEMEN|CATTLEMENS|CATTLE|DAIRY ?(FARMERS|MEN)|CORN|SOYBEANS?|WHEAT|SORGHUM|PEANUTS?|COTTON|RICE|SUGAR|BEET|CANE|PORK|POULTRY|EGG|CITRUS|POTATO|FRUIT|VEGETABLE|RANCHERS|FARMERS (UNION|COOPERATIVE|COOP|EDUCATIONAL))\b/;
// Rules 6 and 7: credit unions (the owner's co-ops), insurers and health
// plans, and chambers of commerce are business by what they are
const BUSINESS_NAME =
  /\b(CREDIT UNIONS?|BLUE CROSS|BLUE SHIELD|HEALTH PLANS?|CHAMBER OF COMMERCE|REGIONAL CHAMBER)\b/;
// Rule 7: insurers are business whatever their tax status (fraternal
// benefit societies that sell life insurance); other fraternal societies
// are unchanged. Named by stated fact (sponsor-facts.json) where the name
// doesn't say it
const INSURER = /\b(INSURANCE|ASSURANCE|THRIVENT|WOODMEN|MUTUAL LIFE|LIFE INSURANCE)\b/;
const BUSINESS_TYPES = ['C', 'T', 'W', 'V'];

/**
 * One committee's group and why (FINAL-2 rules). `p`: { name, type,
 * designation, orgType, connectedOrg, connectedCommittees? }; `index`:
 * buildIrsIndex(); `facts`: { [id]: { group, fact } }; `fecRecord`: the
 * FEC's committee record (leadership PAC flag, sponsoring candidates).
 * Returns { group, reason, irs, settledBy, unsettled?, check? }. `check`:
 * an IRS match a person should confirm (rule 9: the name differs from the
 * record matched, or the records under the name are mixed).
 */
export function classifyPac(id, p, index, facts = {}, fecRecord = null) {
  const f = facts[id];
  if (f?.group) {
    // A fact can name the sponsor's EIN, for the people test
    return {
      group: f.group,
      reason: f.fact,
      irs: f.ein ? { ein: f.ein, matchedOn: 'stated fact' } : null,
      settledBy: 'stated fact',
    };
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
  // Rule 10: a sponsor that is itself a committee. A candidate's committee,
  // a leadership PAC or a joint fund: POLITICIAN; a party: party money;
  // any other committee: no sponsor behind it
  // (FEC "C9" filers, types I, E and C, are organizations reporting their
  // own spending: the sponsor itself, not another committee)
  const linked = (p?.connectedCommittees || []).filter(
    c => !/^C9/.test(c.id) && !['I', 'E', 'C'].includes(c.type)
  );
  const pol = linked.find(
    c => ['H', 'S', 'P'].includes(c.type) || ['P', 'A', 'D', 'J'].includes(c.designation)
  );
  if (pol) {
    const kind =
      pol.designation === 'D'
        ? 'a leadership PAC'
        : pol.designation === 'J'
          ? 'a joint fund'
          : "a candidate's committee";
    return {
      group: 'politician',
      reason: `Its connected organization, ${pol.name} (${pol.id}), is ${kind}`,
      irs: null,
      settledBy: 'FEC',
    };
  }
  const party = linked.find(c => ['X', 'Y', 'Z'].includes(c.type));
  if (party) {
    return {
      group: 'party',
      reason: `Its connected organization, ${party.name} (${party.id}), is a party committee`,
      irs: null,
      settledBy: 'FEC',
    };
  }
  if (linked.length && !org) {
    const c = linked[0];
    return {
      group: 'nosponsor',
      reason: `Its connected organization, ${c.name} (${c.id}), is another political committee (FEC type ${c.type || '–'}${c.designation ? `, designation ${c.designation}` : ''}), not a politician's or a party's`,
      irs: null,
      settledBy: 'FEC',
    };
  }
  // Rule 6: filed by the FEC as a company or trade group: BUSINESS whatever
  // its IRS match (the IRS can make a PAC business, never un-make one)
  if (BUSINESS_TYPES.includes(org)) {
    return {
      group: 'business',
      reason: `FEC: sponsor is ${FEC_ORG[org]}; stays BUSINESS whatever its IRS record`,
      irs: null,
      settledBy: 'FEC',
    };
  }
  const named = `${sponsor || ''} ${p?.name || ''}`.toUpperCase();
  const what = named.match(BUSINESS_NAME) || named.match(INSURER);
  if (what) {
    return {
      group: 'business',
      reason: `A ${/CREDIT/.test(what[1]) ? 'credit union' : /CHAMBER/.test(what[1]) ? 'chamber of commerce' : 'health plan or insurer'} ("${what[1]}" in its name): BUSINESS`,
      irs: null,
      settledBy: 'name',
    };
  }
  // Rule 8: agricultural producers' groups
  const crop = named.match(PRODUCERS);
  if (crop && org !== 'L') {
    return {
      group: 'business',
      reason: `An agricultural producers' group ("${crop[1]}" in its name): BUSINESS`,
      irs: null,
      settledBy: 'name',
    };
  }
  // The IRS on the named sponsor; or on the PAC's own name when the FEC says
  // it has a sponsor (a sponsor type, or a lobbying registrant's PAC)
  let irs = sponsor ? irsStatus(index, sponsor) : { status: 'unmatched' };
  let matchedOn = sponsor ? 'sponsor name' : null;
  if (irs.status === 'unmatched' && sponsor) {
    const tidied = irsStatus(index, stripPacWords(sponsor));
    if (tidied.status !== 'unmatched') {
      irs = tidied;
      matchedOn = 'sponsor name less PAC words';
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
    const several = irs.status !== 'matched' ? `; records under this name: ${irs.counts}` : '';
    // Rule 9: a match a person should confirm with a stated fact: made on
    // a name other than the sponsor's as filed, or a name the IRS holds
    // records of different kinds under
    const check = irs.status !== 'matched' || matchedOn !== 'sponsor name';
    const where = `matched on ${matchedOn}${irs.irsName ? `, IRS record "${irs.irsName}", EIN ${irs.ein}` : ''}${several}`;
    if (irs.group === 'business') {
      return {
        group: 'business',
        reason: `IRS: ${codeLabel(irs.subsection)}, ${codeWords(irs.subsection)} (${where})`,
        irs: { ...irs, matchedOn },
        settledBy: 'IRS',
        check,
      };
    }
    return {
      group: 'people',
      reason: `IRS: ${codeLabel(irs.subsection)}, ${codeWords(irs.subsection)} (${where})${org ? `; FEC: sponsor is ${FEC_ORG[org]}` : ''}`,
      irs: { ...irs, matchedOn },
      settledBy: 'IRS',
      check,
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
      reason: `FEC: sponsor is a labor organization; not in the IRS file under this name${note}`,
      irs,
      settledBy: 'FEC',
    };
  }
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
      reason: `FEC: sponsor is a membership organization; not in the IRS file under this name${note}`,
      irs,
      settledBy: 'FEC',
    };
  }
  if (sponsor && POLITICAL_COMMITTEE.test(sponsor.toUpperCase())) {
    return {
      group: 'nosponsor',
      reason: `Its "connected organization" (${sponsor}) reads as another political committee, not found by that name in the FEC's committee list`,
      irs,
      settledBy: 'FEC',
      check: true,
    };
  }
  if (sponsor) {
    return {
      group: 'people',
      reason: `Names a sponsor (${sponsor}) with no sponsor type, not found in the IRS file: not settled`,
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

/**
 * The people test (FINAL-2, rule 1): a PEOPLE PAC counts only if its
 * sponsor's members elect its governing body, read from the sponsor's
 * latest Form 990, Part VI line 7a (form990.json, by EIN). With no Form 990
 * found, a stated fact decides (people-test.json, by committee: `elected`
 * and `fact`, and `ein` where the sponsor was identified by hand).
 * Returns { elected: true | false | null, evidence, ein, taxYear, note }.
 */
export function peopleTest(id, sorted, forms = {}, stated = {}) {
  const s = stated[id] || {};
  const ein = s.ein || sorted?.irs?.ein || null;
  const form = ein ? forms[ein] : null;
  if (form?.found && form.elect !== null && form.elect !== undefined && s.elected === undefined) {
    // Line 7a as written (members, stockholders or other persons may elect
    // or appoint one or more of the governing body); line 6 is reported
    const members = form.members === false ? ' (line 6: no members or stockholders)' : '';
    const elected = form.elect;
    return {
      elected,
      ein,
      taxYear: form.taxYear,
      evidence: `Form 990 for ${form.taxYear} (EIN ${ein}, ${form.name}), Part VI line 7a: ${form.elect ? 'Yes' : 'No'}${members}`,
      note: form.notes?.find(n => /7\s*A/i.test(n)) || form.notes?.[0] || null,
      votingMembers: form.votingMembers ?? null,
    };
  }
  if (s.elected !== undefined) {
    return {
      elected: s.elected,
      ein,
      taxYear: null,
      evidence: `Stated fact: ${s.fact}`,
      note: form && !form.found ? form.why : null,
    };
  }
  return {
    elected: null,
    ein,
    taxYear: null,
    evidence: ein
      ? `No Form 990 answer (EIN ${ein}: ${form ? form.why || 'line 7a not answered' : 'not looked up'}); no stated fact yet`
      : 'Sponsor not identified in the IRS file; no stated fact yet',
    note: null,
  };
}

/** Load the people test's evidence: Form 990 answers and stated facts. */
export function loadPeopleEvidence() {
  const read = name => {
    const path = new URL(`../data/${name}`, import.meta.url).pathname;
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  };
  const stated = read('people-test.json');
  return {
    forms: read('form990.json'),
    stated: Object.fromEntries(Object.entries(stated).filter(([k]) => /^C\d{8}$/.test(k))),
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
    `SELECT EIN, NAME, SUBSECTION, CLASSIFICATION, REVENUE_AMT, STATE
     FROM read_csv([${list}], header=true, all_varchar=true)`
  );
  return buildIrsIndex(rows);
}
