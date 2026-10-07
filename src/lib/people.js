// Names, seats and money figures, in the words the site uses for them.
import { memberPath } from './router.js';
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
  };
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
    label: 'Small donors, under $200',
    short: 'Small donors',
    color: 'var(--small)',
    canvas: '#5B21B6',
  },
  big: {
    label: 'Large donors, over $200',
    short: 'Large donors',
    color: 'var(--big)',
    canvas: '#B7A6F5',
  },
  pac: { label: 'PACs', short: 'PACs', color: 'var(--pac)', canvas: '#15131C' },
  party: { label: 'Party committees', short: 'Party', color: 'var(--party)', canvas: '#9C98A6' },
  other: {
    label: 'Other (loans, transfers, own money)',
    short: 'Other',
    color: 'var(--other)',
    canvas: '#E2DFD8',
  },
};

/**
 * The receipt's lines: each kind of money, its dollars and its whole
 * percentage. Party and other money appear only when there is some.
 */
export function moneyLines(f) {
  const total = f.totalRaised;
  const big = f.largeDonorDonations;
  const known = f.grassrootsDonations + (big || 0) + f.pacMoney + f.partyMoney;
  const other = Math.max(0, total - known);
  const amounts = {
    small: f.grassrootsDonations,
    big,
    pac: f.pacMoney,
    party: f.partyMoney,
    other,
  };
  const keys = Object.keys(amounts);
  const pcts = shares(
    keys.map(k => amounts[k] || 0),
    total
  );
  return keys
    .map((key, i) => ({ key, ...MONEY_KINDS[key], amount: amounts[key], pct: pcts[i] }))
    .filter(l => {
      if (l.key === 'party' || l.key === 'other') {
        return l.pct >= 1;
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
  return hit ? hit[1] : null;
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

/** "Senate · Maine", "House · Pennsylvania 2" for a race */
export function raceSeat(race) {
  const state = stateName(race.state);
  if (race.office === 'S') {
    return `Senate · ${state}`;
  }
  const d = Number(race.district);
  return d ? `House · ${state} ${d}` : `House · ${state} at large`;
}

/** A sitting member as a receipt card; `detail` adds their donor count. */
export function memberPerson(m, detail) {
  return {
    id: m.bioguideId,
    name: displayName(m.name),
    seat: seatLabel(m),
    party: partyName(m.party),
    tier: m.tier,
    figures: gradedFigures(m),
    evidenceChecked: m.evidenceChecked ?? null,
    nakamotoCoefficient: detail?.nakamotoCoefficient ?? m.nakamotoCoefficient,
    uniqueDonors: detail?.uniqueDonors ?? null,
    href: memberPath(m.bioguideId),
  };
}
