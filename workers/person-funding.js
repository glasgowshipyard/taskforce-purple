/**
 * PERSON-LEVEL FUNDING (issues #32, #41)
 *
 * The unit is the member, not a committee. A member's money arrives through
 * several FEC committees - their campaign, a joint fundraising committee
 * (JFC), a leadership PAC, and for a House member running for Senate, a
 * second campaign - and the tier used to see only the first. On 2026-09-26
 * one senior member's campaign committee held 29% of the money raised in her
 * name; a JFC holding 30% had 152 donors, 8 of whom supplied half of it,
 * the largest $315,100. None of that reached the grade.
 *
 * This module is pure: it takes FEC committee records and totals and says
 * which committees belong to the member and what they raised, counted once.
 */

// Only these kinds of committee are the member's own money vehicles.
// FEC designation: P principal, A authorized, J joint fundraising,
// D leadership PAC.
export function vehicleRole(committee) {
  switch (committee.designation) {
    case 'P':
    case 'A':
      return 'campaign';
    case 'J':
      return 'joint';
    case 'D':
      return 'leadership';
    default:
      return null;
  }
}

/**
 * Committees active in `cycle` that are the member's money vehicles,
 * de-duplicated by committee ID. `committees` is every committee found under
 * the member's crosswalk candidate IDs - authorized committees plus
 * leadership PACs found by sponsor. Long tails of dead JFCs are normal and
 * excluded by the cycle filter.
 */
export function selectVehicles(committees, cycle) {
  const byId = new Map();
  for (const c of committees || []) {
    const role = vehicleRole(c);
    if (!role || !(c.cycles || []).includes(cycle) || byId.has(c.committee_id)) {
      continue;
    }
    byId.set(c.committee_id, {
      committeeId: c.committee_id,
      name: c.name,
      role,
      candidateId: c.candidate_ids?.[0] ?? c.sponsor_candidate_ids?.[0] ?? null,
    });
  }
  return [...byId.values()].sort((a, b) => a.committeeId.localeCompare(b.committeeId));
}

const num = x => (Number.isFinite(x) ? x : 0);

/**
 * Classify the transfers a member's committees received (FEC Schedule A,
 * line 12 "Transfers from authorized committees", memo rows excluded).
 * Each row names its sender, so nothing is inferred:
 *
 *   sender is one of the member's own vehicles  -> internal: the money is
 *     already counted where it was raised, so it is netted out
 *   sender is a joint fundraising committee (designation J) not in the set
 *     -> external JFC: a fund not registered under the member's candidacy
 *     (e.g. "TEAM SCALISE") or raised in an earlier cycle. Its money is
 *     already inside the receiving committee's receipts; it is re-classified
 *     from "other" into donor buckets using the sender's own mix
 *   anything else (party committees etc.) -> left as is
 *
 * A totals-only approach cannot do this: a JFC and a campaign report up to
 * different dates, and a fund raised last cycle has no receipts this cycle.
 */
export function classifyTransfers(vehicles, transferRows) {
  const own = new Set((vehicles || []).map(v => v.committeeId));
  let internal = 0;
  const external = new Map(); // senderId -> { name, amount }
  for (const r of transferRows || []) {
    if (r.memo_code === 'X') {
      continue;
    }
    const amount = num(r.contribution_receipt_amount);
    const sender = r.contributor_id || r.contributor?.committee_id;
    if (!sender || amount <= 0) {
      continue;
    }
    if (own.has(sender)) {
      internal += amount;
    } else if (r.contributor?.designation === 'J') {
      const e = external.get(sender) || {
        committeeId: sender,
        name: r.contributor?.name || '',
        amount: 0,
      };
      e.amount += amount;
      external.set(sender, e);
    }
  }
  return { internal, externalJfcs: [...external.values()] };
}

/**
 * Combine the member's vehicles into one set of figures, counted once.
 *
 * Contributions are recorded by the committee the donor gave to, so the
 * donor buckets of the member's own vehicles sum directly. Receipts are
 * reduced by internal transfers (already counted at the sender). Money that
 * arrived from an external JFC is apportioned into the donor buckets by that
 * JFC's own composition - "the member received $X from a fund whose money
 * was Y% from itemized donors".
 *
 * Money a member's own JFC raised and passed to OTHER committees (a party
 * committee) stays counted: donors wrote those cheques to a fund in the
 * member's name.
 *
 * @param vehicles   [{committeeId, role, name, totals}]
 * @param transfers  output of classifyTransfers, externalJfcs carrying .totals
 */
export function combineVehicleTotals(vehicles, transfers = { internal: 0, externalJfcs: [] }) {
  const withTotals = (vehicles || []).filter(v => v.totals && num(v.totals.receipts) > 0);
  const gross = withTotals.reduce((s, v) => s + num(v.totals.receipts), 0);
  const sum = f => withTotals.reduce((s, v) => s + num(v.totals[f]), 0);

  const buckets = {
    grassrootsDonations: sum('individual_unitemized_contributions'),
    largeDonorDonations: sum('individual_itemized_contributions'),
    pacMoney: sum('other_political_committee_contributions'),
    partyMoney: sum('political_party_committee_contributions'),
  };
  const externalJfcs = [];
  for (const j of transfers.externalJfcs || []) {
    const t = j.totals;
    const r = num(t?.receipts);
    if (r > 0) {
      buckets.grassrootsDonations += j.amount * (num(t.individual_unitemized_contributions) / r);
      buckets.largeDonorDonations += j.amount * (num(t.individual_itemized_contributions) / r);
      buckets.pacMoney += j.amount * (num(t.other_political_committee_contributions) / r);
      buckets.partyMoney += j.amount * (num(t.political_party_committee_contributions) / r);
    }
    externalJfcs.push({ committeeId: j.committeeId, name: j.name, amount: j.amount });
  }

  const internal = Math.min(num(transfers.internal), gross);
  const totalRaised = gross - internal;
  const largestSingle = Math.max(0, ...withTotals.map(v => num(v.totals.receipts)));

  return {
    totalRaised,
    ...buckets,
    grassrootsPercent:
      totalRaised > 0 ? Math.round((buckets.grassrootsDonations / totalRaised) * 100) : 0,
    internalTransfers: internal,
    vehicles: withTotals.map(v => ({
      committeeId: v.committeeId,
      name: v.name,
      role: v.role,
      receipts: num(v.totals.receipts),
    })),
    externalJfcs,
    // Invariants, asserted by callers: netting removes only money that was
    // moved, never leaves less than the largest single committee raised, and
    // the named buckets cannot exceed what was raised by more than the FEC's
    // net-of-refunds reporting allows.
    invariantsHold: totalRaised <= gross + 1 && totalRaised >= largestSingle - 1,
  };
}

/** Stable identity of the committee set, recorded on analyses. */
export function vehicleSignature(vehicles) {
  return (vehicles || [])
    .map(v => v.committeeId)
    .sort()
    .join(',');
}
