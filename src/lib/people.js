// Names, seats and money figures, in the words the site uses for them.
import { peoplePowerInfluence } from '../../workers/tier-calculation.js';
import { memberPath } from './paths.js';
import { DELEGATE_ONLY, stateByName, stateByCode } from './states.js';

/**
 * Congress lists names "Last, First Middle "Nick", Jr.". People know them as
 * "Nick Last" or "First Last": initials are dropped, compound first names
 * ("Mary Gay") kept, suffixes go at the end.
 */
export function displayName(raw) {
  if (!raw || !raw.includes(',')) {
    return raw || '';
  }
  const [last, ...rest] = raw.split(',').map(s => s.trim());
  let given = rest.join(' ');
  const suffixes = [];
  given = given.replace(/\b(Jr\.?|Sr\.?|II|III|IV)\s*$/i, m => {
    suffixes.push(m.trim());
    return '';
  });
  const nick = given.match(/["“]([^"”]+)["”]/);
  const first = nick
    ? nick[1]
    : given
        .split(/\s+/)
        .filter(w => w && !/^[A-Z]\.?$/.test(w))
        .join(' ');
  return [first, last, ...suffixes].filter(Boolean).join(' ');
}

export const stateCode = name => stateByName[name]?.code || name;
export const stateName = code => stateByCode[code]?.name || code;

function delegateTitle(code) {
  return code === 'PR' ? 'Resident Commissioner' : 'Delegate';
}

/** "Senator", "Representative", "Delegate" */
export function roleTitle(m) {
  if (m.chamber === 'Senate') {
    return 'Senator';
  }
  const code = stateCode(m.state);
  return DELEGATE_ONLY.has(code) ? delegateTitle(code) : 'Representative';
}

/** "SENATE · OHIO", "HOUSE · OHIO 4", "HOUSE · ALASKA AT LARGE", "DELEGATE · GUAM" */
export function seatLabel(m) {
  if (m.chamber === 'Senate') {
    return `Senate · ${m.state}`;
  }
  const code = stateCode(m.state);
  if (DELEGATE_ONLY.has(code)) {
    return `${delegateTitle(code)} · ${m.state}`;
  }
  const d = Number(m.district);
  return d ? `House · ${m.state} ${d}` : `House · ${m.state} at large`;
}

export const usd = n =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));

/** $2.1M, $610K, $9,400 */
export function usdShort(n) {
  const v = Math.abs(n || 0);
  if (v >= 1e6) {
    return `$${(n / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (v >= 1e4) {
    return `$${Math.round(n / 1e3)}K`;
  }
  return usd(n);
}

export const count = n => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

/**
 * The money figures a grade was computed on: all their committees once the
 * grade uses them (#32), otherwise their campaign committee. Every figure on
 * a page goes through this, so a page never contradicts its own grade.
 */
export function gradedFigures(m) {
  const all = m.gradeBasis === 'all-committees' && m.personFigures;
  const f = all ? m.personFigures : m;
  return {
    allCommittees: Boolean(all),
    totalRaised: f.totalRaised || 0,
    grassrootsDonations: f.grassrootsDonations || 0,
    // null means not collected yet, which is not the same as none
    largeDonorDonations: Number.isFinite(f.largeDonorDonations) ? f.largeDonorDonations : null,
    pacMoney: f.pacMoney || 0,
    partyMoney: f.partyMoney || 0,
    grassrootsPercent: f.grassrootsPercent ?? 0,
    // The candidate's own gifts and loans (#59): shown, not graded
    ownMoney: (f.ownMoney?.contributions || 0) + (f.ownMoney?.loans || 0),
    ownRepaid: f.ownMoney?.repaid || 0,
    // The date the FEC filings behind the figures run to ('2026-09-30')
    filedThrough: all ? f.filedThrough || null : null,
  };
}

/**
 * The figures the grade was worked out on: the money from others, with the
 * candidate's own money set aside (workers/grading.js, #59).
 */
export function othersFigures(f) {
  return { ...f, totalRaised: Math.max(0, f.totalRaised - (f.ownMoney || 0)), ownMoney: 0 };
}

// Whole percentages that add up to what they share (largest remainder)
function shares(values, total) {
  const raw = values.map(v => (total > 0 ? (v / total) * 100 : 0));
  const floors = raw.map(Math.floor);
  let left =
    Math.min(100, Math.round(raw.reduce((s, v) => s + v, 0))) - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) {
      break;
    }
    floors[i]++;
    left--;
  }
  return floors;
}

export const MONEY_KINDS = {
  small: {
    label: 'Small donations, under $200',
    short: 'Small donations',
    color: 'var(--small)',
    canvas: '#5B21B6',
  },
  big: {
    label: 'Big donations, over $200',
    short: 'Big donations',
    color: 'var(--big)',
    canvas: '#B7A6F5',
  },
  pac: { label: 'PACs', short: 'PACs', color: 'var(--pac)', canvas: '#15131C' },
  directed: {
    label: 'Gifts passed on by a committee',
    short: 'Passed on',
    color: 'var(--directed)',
    canvas: '#6B6578',
  },
  politicians: {
    label: 'Parties and other politicians',
    short: 'Politicians',
    color: 'var(--party)',
    canvas: '#9C98A6',
  },
  party: { label: 'Party committees', short: 'Party', color: 'var(--party)', canvas: '#9C98A6' },
  own: {
    label: 'Their own money',
    short: 'Own money',
    color: 'var(--own)',
    canvas: '#E3A008',
  },
  other: {
    label: 'Other (loans, transfers, refunds)',
    short: 'Other',
    color: 'var(--other)',
    canvas: '#E2DFD8',
  },
};

/**
 * Whole dollars that add up exactly to `target` (by default the rounded
 * total; largest remainder), so a receipt's lines always sum to its total.
 */
export function wholeDollars(amounts, target) {
  const raw = amounts.map(a => Math.max(0, Number(a) || 0));
  const floors = raw.map(Math.floor);
  let left =
    (target ?? Math.round(raw.reduce((s, a) => s + a, 0))) - floors.reduce((s, a) => s + a, 0);
  const order = raw.map((a, i) => [a - floors[i], i]).sort((x, y) => y[0] - x[0]);
  for (const [, i] of order) {
    if (left <= 0) {
      break;
    }
    floors[i]++;
    left--;
  }
  return floors;
}

/**
 * The receipt, from the grade's own working (FINAL-3 `grade.detail`), so it
 * matches the "Why" line for line (owner, 2026-10-17: one source of truth).
 * `counted`: the kinds of money the grade is on, in the Why's order;
 * `left`: own money and other money, shown but not graded; whole dollars
 * that add up exactly to `subtotal` and `total`. `f`: gradedFigures.
 *
 * The total is what the FEC says they raised. Where the grade's money comes
 * to more than that (money passed on by other politicians' joint funds that
 * the member's own reports don't show yet), the total is the sum of the
 * lines, so the receipt still adds up. That gap is a fault in how the total
 * is worked out (workers/person-funding.js), not something to show.
 */
export function receiptLines(detail, f) {
  const v = x => Math.max(0, Number(x) || 0);
  const counted = [
    ['small', v(detail.small)],
    ['big', v(detail.big)],
    ['pac', v(detail.pac)],
    ['directed', v(detail.directed)],
    ['politicians', v(detail.party) + v(detail.otherPoliticiansFunds)],
  ];
  const given = counted.reduce((s, [, a]) => s + a, 0);
  const own = v(f.ownMoney);
  const left = [
    ['own', own],
    ['other', Math.max(0, v(f.totalRaised) - given - own)],
  ];
  // Rounded in two steps, so both the subtotal and the total come out exact
  const subtotal = Math.round(given);
  const total = Math.round(given + left.reduce((s, [, a]) => s + a, 0));
  const line = ([key], amount) => ({ key, ...MONEY_KINDS[key], amount });
  const countedDollars = wholeDollars(
    counted.map(([, a]) => a),
    subtotal
  );
  const leftDollars = wholeDollars(
    left.map(([, a]) => a),
    total - subtotal
  );
  const countedLines = counted.map((k, i) => line(k, countedDollars[i]));
  const leftLines = left.map((k, i) => line(k, leftDollars[i]));
  return {
    // Small, big and PAC money always show, even at $0; the rest when there is some
    counted: countedLines.filter(l => ['small', 'big', 'pac'].includes(l.key) || l.amount > 0),
    subtotal,
    left: leftLines.filter(l => l.amount > 0),
    total,
  };
}

/**
 * The receipt's lines without FINAL-3's working (no grade detail): each
 * kind of money, its dollars and its whole percentage. Party, own and other
 * money appear when there is some; the dollars add up to the total.
 */
export function moneyLines(f) {
  const total = f.totalRaised;
  const big = f.largeDonorDonations;
  const own = f.ownMoney || 0;
  const known = f.grassrootsDonations + (big || 0) + f.pacMoney + f.partyMoney + own;
  const other = Math.max(0, total - known);
  const amounts = {
    small: f.grassrootsDonations,
    big,
    pac: f.pacMoney,
    party: f.partyMoney,
    own,
    other,
  };
  const keys = Object.keys(amounts);
  const pcts = shares(
    keys.map(k => amounts[k] || 0),
    total
  );
  const dollars = wholeDollars(keys.map(k => amounts[k] || 0));
  return keys
    .map((key, i) => ({
      key,
      ...MONEY_KINDS[key],
      // null: big donations not collected yet, which is not the same as none
      amount: amounts[key] === null ? null : dollars[i],
      pct: pcts[i],
    }))
    .filter(l => {
      if (l.key === 'party' || l.key === 'other' || l.key === 'own') {
        return l.amount > 0;
      }
      return true;
    });
}

/**
 * "N people gave half the big-check money, out of M": how few donors, largest
 * first, hold half the itemized money. `of` is null when we only have N.
 */
export function concentration(m) {
  const n = m.nakamotoCoefficient ?? m.nakamoto;
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  const of = Number.isFinite(m.uniqueDonors) && m.uniqueDonors > 0 ? m.uniqueDonors : null;
  // Under ten named donors the measure says nothing useful
  if (of !== null && of < 10) {
    return null;
  }
  return { n, of };
}

/** "One in four" etc. for a share, or null if it isn't near a simple one */
export function fractionWords(r) {
  const known = [
    [1 / 4, 'One in four'],
    [1 / 3, 'One in three'],
    [1 / 2, 'Half'],
    [2 / 3, 'Two in three'],
    [3 / 4, 'Three in four'],
    [4 / 5, 'Four in five'],
    [9 / 10, 'Nine in ten'],
  ];
  const hit = known.find(([v]) => Math.abs(r - v) <= 0.03);
  if (!hit) {
    return null;
  }
  // Never round a share up or down to a fraction it isn't: 47.6% is "Nearly
  // half", not "Half" (a reviewer's catch, 2026-10-17)
  const [v, words] = hit;
  if (Math.abs(r - v) < 0.005) {
    return words;
  }
  return r < v ? `Nearly ${words.toLowerCase()}` : `Just over ${words.toLowerCase()}`;
}

const PARTY_CODES = {
  DEM: 'Democratic',
  REP: 'Republican',
  LIB: 'Libertarian',
  GRE: 'Green',
  IND: 'Independent',
  NNE: 'No party',
  NPA: 'No party',
  UN: 'Unaffiliated',
};

/** A party as words, whether it arrives as words or as an FEC code */
export const partyName = p => PARTY_CODES[p] || p || 'Party not given';

/** A candidate's party as their ballot prints it, else the FEC's */
export const ballotPartyName = c => c.ballotParty || partyName(c.party);

/** "Senate · Maine", "House · Pennsylvania 2" for a race */
export function raceSeat(race) {
  const state = stateName(race.state);
  const special = race.special ? ' (special election)' : '';
  if (race.office === 'S') {
    return `Senate · ${state}${special}`;
  }
  const d = Number(race.district);
  return `${d ? `House · ${state} ${d}` : `House · ${state} at large`}${special}`;
}

/**
 * A sitting member as a receipt card. `detail` (their /api/member-detail)
 * supplies People, Power and Influence while the list doesn't carry them.
 */
export function memberPerson(m, detail) {
  return {
    id: m.bioguideId,
    name: displayName(m.name),
    seat: seatLabel(m),
    party: partyName(m.party),
    tier: m.tier,
    withheldReason: m.withheldReason ?? null,
    figures: gradedFigures(m),
    evidenceChecked: m.evidenceChecked ?? null,
    ppi: m.peoplePowerInfluence ?? peoplePowerInfluence(detail?.grade?.detail),
    cycle: m.gradeCycle ?? null,
    href: memberPath(m.bioguideId, m.name),
  };
}
