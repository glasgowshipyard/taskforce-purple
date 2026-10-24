// What kind of PAC gave the money, from the FEC's own codes (committee type
// and designation), for members graded before FINAL-3. The weights are the
// grading's (workers/tier-calculation.js getPACTransparencyWeight): this
// file only names them.
import { getPACTransparencyWeight } from '../../workers/tier-calculation.js';

// What the "Country-focused" label means, and what it can't see (owner,
// 2026-10-23: explain the Form 990). One test for every country
// (scripts/refresh/lib/country-focus.mjs); it changes no grade
export const COUNTRY_FOCUS_NOTE =
  "Groups that don't pay tax file a Form 990 with the IRS every year, describing their mission in their own words. A PAC is marked Country-focused when the group behind it says, on that form, that it exists to advance a particular country's interests or its relationship with the United States. The same test is used for every country. It can only check PACs set up by a group that files a Form 990, so a company's PAC, or a PAC with no group behind it, is never marked, whatever it works on. The label doesn't change any grade.";

export const PAC_TYPES = {
  super: {
    label: 'Super PAC',
    heavier: true,
  },
  hybrid: {
    label: 'Hybrid PAC',
    heavier: false,
  },
  politician: {
    label: "Another politician's PAC",
    heavier: true,
  },
  lobbyist: {
    label: 'Lobbyist PAC',
    heavier: false,
  },
  campaign: {
    label: "Another candidate's campaign",
    heavier: false,
  },
  group: {
    label: 'Company, union or group PAC',
    heavier: false,
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
