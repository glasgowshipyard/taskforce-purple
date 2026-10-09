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
