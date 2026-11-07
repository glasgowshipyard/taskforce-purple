// The totals check (scripts/verify/totals-check.mjs, and every refresh run
// since 2026-11-06): a person's money as the grade counts it, against the
// FEC's own per-committee totals (the bulk file committee_summary_{cycle}.csv,
// one download, no calls on the FEC key).
//
// For each person it adds up the FEC's figures for their own committees
// (campaign, leadership PAC, the joint funds that are theirs) plus what other
// politicians' joint funds passed to them, and compares that with the
// grade's working (grade.detail):
//
//   people  small + big + directed    vs  individuals (INDV_CONTB)
//   small   small, less small gifts    vs  unitemized (INDV_UNITEM_CONTB)
//           reported by name
//   pac     pac                       vs  other committees (OTH_CMTE_CONTB)
//   party   party                     vs  party committees (PTY_CMTE_CONTB)
//   given   the grade's whole total   at most everything received (TTL_RECEIPTS)
//   others  other politicians' funds  all their joint funds passed on
//
// A difference is named when it's over $1,000 and over 1% (other
// politicians' funds: over $1).

export const summaryUrl = cycle =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/committee_summary_${cycle}.csv`;

const csvRow = line => {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
};

/** The FEC's file as a Map: committee ID -> its totals and coverage date */
export function parseSummary(text) {
  const lines = text.split('\n').filter(Boolean);
  const head = csvRow(lines[0]);
  const col = name => head.indexOf(name);
  const byId = new Map();
  for (const line of lines.slice(1)) {
    const c = csvRow(line);
    const n = name => Number(c[col(name)]) || 0;
    byId.set(c[col('CMTE_ID')], {
      individuals: n('INDV_CONTB'),
      unitemized: n('INDV_UNITEM_CONTB'),
      others: n('OTH_CMTE_CONTB'),
      party: n('PTY_CMTE_CONTB'),
      receipts: n('TTL_RECEIPTS'),
      through: c[col('CVG_END_DT')],
      // H House, S Senate, P presidential campaign; anything else is a PAC
      // or party committee
      type: c[col('CMTE_TP')] || null,
    });
  }
  return byId;
}

const round = x => Math.round(x * 100) / 100;

/**
 * One person's money against the FEC's totals. `detail`: the grade's
 * working; `committees`: their money trail's committees (role, ownFund,
 * toMemberCounted); `since`: COMMITTEE_SINCE (committees counted only from
 * a date, the owner's decision). Returns { off: { measure: { site, fec,
 * diff } }, missing, since, fecThrough }
 */
export function compareTotals(detail, committees, fecById, since = {}) {
  const d = detail ?? {};
  const fec = { people: 0, small: 0, pac: 0, party: 0 };
  let receipts = 0;
  const missing = [];
  const counted = [];
  const through = new Set();
  let passed = 0;
  for (const c of committees ?? []) {
    if (c.role === 'joint' && !c.ownFund) {
      passed += c.toMemberCounted ?? 0;
      receipts += c.toMemberCounted ?? 0;
      continue;
    }
    if (since[c.committeeId]) {
      counted.push(`${c.committeeId} from ${since[c.committeeId].from}`);
    }
    const f = fecById.get(c.committeeId);
    if (!f) {
      missing.push(c.committeeId);
      continue;
    }
    // A campaign that became a PAC during the cycle is counted from its
    // campaign reports only (person-funding.js campaignReportTotals); the
    // FEC's file adds up its whole cycle, the PAC's money too
    if (c.role === 'campaign' && f.type && !['H', 'S', 'P'].includes(f.type)) {
      counted.push(`${c.committeeId}, a campaign that became a PAC, to its last campaign report`);
    }
    fec.people += f.individuals;
    fec.small += f.unitemized;
    fec.pac += f.others;
    fec.party += f.party;
    receipts += f.receipts;
    through.add(f.through);
  }
  const site = {
    people: (d.small ?? 0) + (d.big ?? 0) + (d.directed ?? 0),
    // Small gifts reported by name count as small since 2026-11-02; the
    // FEC's unitemized figure leaves them out
    small: (d.small ?? 0) - (d.smallItemized ?? 0),
    pac: d.pac ?? 0,
    party: d.party ?? 0,
  };
  const off = {};
  // The grade can't count more money than the committees took in
  if ((d.given ?? 0) > receipts * 1.02 + 1000) {
    off.given = { site: round(d.given), fec: round(receipts), diff: round(d.given - receipts) };
  }
  for (const k of Object.keys(site)) {
    const diff = site[k] - fec[k];
    if (Math.abs(diff) > 1000 && Math.abs(diff) > 0.01 * Math.max(fec[k], site[k])) {
      off[k] = { site: round(site[k]), fec: round(fec[k]), diff: round(diff) };
    }
  }
  const others = d.otherPoliticiansFunds ?? 0;
  if (Math.abs(others - passed) > 1) {
    off.others = { site: round(others), fec: round(passed), diff: round(others - passed) };
  }
  return { off, missing, since: counted, fecThrough: [...through].sort() };
}

const digits = s => String(s || '').replace(/\D/g, '');
// The FEC's file writes MMDDYYYY or YYYYMMDD; the site, YYYY-MM-DD
const asYmd = s => {
  const d = digits(s);
  return d.length === 8 && Number(d.slice(0, 4)) < 1900 ? d.slice(4) + d.slice(0, 4) : d;
};

// One reporting period (the longest, a quarter, and a little): figures
// further apart than this aren't waiting on the other file, they're wrong
const WAIT_DAYS = 100;
const ymdDays = ymd =>
  Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) /
  86400000;

/**
 * How a compared person stands: 'match'; 'since' (differs, with a
 * committee counted by rule: from a date, or a campaign that became a PAC
 * counted to its last campaign report); 'waiting' (differs, but the FEC's file
 * runs to the report before or after the site's figures: after a filing
 * deadline the two can be days apart); 'differs'
 */
export function totalsVerdict(r, siteThrough) {
  const differs = r.missing.length || Object.keys(r.off).length;
  if (!differs) {
    return 'match';
  }
  if (r.since.length) {
    return 'since';
  }
  const latest = r.fecThrough.map(asYmd).sort().at(-1);
  const site = digits(siteThrough);
  if (
    site.length === 8 &&
    latest?.length === 8 &&
    site !== latest &&
    Math.abs(ymdDays(site) - ymdDays(latest)) <= WAIT_DAYS
  ) {
    return 'waiting';
  }
  return 'differs';
}

/** One line naming what's off */
export function describeTotals(r) {
  const parts = Object.entries(r.off).map(
    ([k, v]) => `${k} site ${v.site} FEC ${v.fec} (${v.diff > 0 ? '+' : ''}${v.diff})`
  );
  if (r.missing.length) {
    parts.push(`not in the FEC's file: ${r.missing.join(' ')}`);
  }
  return parts.join('; ');
}
