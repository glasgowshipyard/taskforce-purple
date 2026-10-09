// What kind of PAC gave the money, in plain words, from the FEC's own codes
// (committee type and designation). The weights are the grading's
// (workers/tier-calculation.js getPACTransparencyWeight): this file only
// names them. Companies and unions aren't told apart here: the FEC's
// organisation type isn't in our data yet (#57).
import { getPACTransparencyWeight } from '../../workers/tier-calculation.js';

export const PAC_TYPES = {
  super: {
    label: 'Super PAC',
    heavier: true,
    why: 'Super PACs can take unlimited money from anyone, including companies and the very wealthy.',
  },
  hybrid: {
    label: 'Hybrid PAC',
    heavier: false,
    why: 'A PAC with a second, super PAC account that can take unlimited money.',
  },
  politician: {
    label: "Another politician's PAC",
    heavier: true,
    why: 'Run by another politician. Money passed between politicians can buy goodwill and influence.',
  },
  lobbyist: {
    label: 'Lobbyist PAC',
    heavier: true,
    why: 'Run by a registered lobbyist or by a group that lobbies Congress.',
  },
  campaign: {
    label: "Another candidate's campaign",
    heavier: false,
    why: "Money from another candidate's own campaign. It counts much less against the grade.",
  },
  group: {
    label: 'Company, union or group PAC',
    heavier: false,
    why: 'Pools money from the staff or members of a company, union, trade group or cause.',
  },
};

/** The kind of PAC, from the FEC's committee type and designation codes. */
export function pacType(committeeType, designation) {
  if (committeeType === 'O') {
    return 'super';
  }
  if (designation === 'D') {
    return 'politician';
  }
  if (designation === 'B') {
    return 'lobbyist';
  }
  if (committeeType === 'V' || committeeType === 'W') {
    return 'hybrid';
  }
  if (committeeType === 'P' || designation === 'P' || designation === 'A') {
    return 'campaign';
  }
  return 'group';
}

/**
 * The PAC donations we hold, one row per PAC, largest first. Rows that came
 * from a person rather than a committee (no committee ID: the old collection
 * mixed in the candidate's own cheques) are not PACs and are left out.
 */
export function pacRows(contributions = []) {
  const byId = new Map();
  for (const p of contributions) {
    if (!p.contributorId || !(p.amount > 0)) {
      continue;
    }
    const row = byId.get(p.contributorId) || {
      id: p.contributorId,
      name: p.pacName || 'Unnamed committee',
      type: pacType(p.committee_type, p.designation),
      // As the grade counts it: more than 1 means it counts more heavily
      weight: getPACTransparencyWeight(p.committee_type, p.designation),
      amount: 0,
    };
    row.amount += p.amount;
    byId.set(p.contributorId, row);
  }
  return [...byId.values()].sort((a, b) => b.amount - a.amount);
}

// The FEC's organisation type (ORG_TP) for a PAC's sponsor
const ORG_LABELS = {
  C: 'Company',
  W: 'Company',
  L: 'Union',
  T: 'Trade group',
  M: 'Membership group',
  V: 'Cooperative',
};

/** A PAC's name for its kind: "Union PAC", "Super PAC", "Another politician's PAC". */
export function pacLabel(pac) {
  if (pac.kind === 'lobbyist' || pac.kind === 'group') {
    return `${ORG_LABELS[pac.orgType] || 'Group'} PAC`;
  }
  return PAC_TYPES[pac.kind]?.label || 'PAC';
}

/** The kinds, in the order the split bar shows them, with plain names. */
export const PAC_KINDS = [
  { kind: 'super', label: 'Super PACs', color: '#7B1E3A' },
  { kind: 'politician', label: "Other politicians' PACs", color: '#C2412B' },
  { kind: 'lobbyist', label: 'PACs of groups that lobby Congress', color: '#E07A5F' },
  { kind: 'hybrid', label: 'Hybrid PACs', color: '#8F7FA8' },
  { kind: 'group', label: 'Other company, union and group PACs', color: '#9C98A6' },
  { kind: 'campaign', label: "Other candidates' campaigns", color: '#CFCBC1' },
];

const pct = x => `${Math.round(x * 100)}%`;

/**
 * Where a PAC's own money came from, in a line (looking through it, #57):
 * how much from people, how much in small donations, and how few people
 * gave half its big donations. Null when the FEC has no summary for it.
 */
export function peopleLine(profile) {
  if (!profile?.receipts || !(profile.individuals >= 0)) {
    return null;
  }
  const fromPeople = Math.min(1, profile.individuals / profile.receipts);
  const small = Math.max(
    0,
    Math.min(1, (profile.individuals - (profile.itemized || 0)) / profile.receipts)
  );
  const few =
    profile.nakamoto && profile.donors >= 10
      ? `. Half its big donations came from ${profile.nakamoto.toLocaleString('en-US')} ${profile.nakamoto === 1 ? 'person' : 'people'}`
      : '';
  return `Its own money: ${pct(fromPeople)} from people, ${pct(small)} in small donations${few}.`;
}
