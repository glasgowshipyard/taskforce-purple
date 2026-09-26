/**
 * PERSON-LEVEL FUNDING (issues #32, #41)
 *
 * The unit is the member, not a committee. A member's money arrives through
 * several FEC committees - their campaign, joint fundraising funds (JFCs), a
 * leadership PAC, and for a House member running for Senate, a second
 * campaign. The tier used to see only the first. On 2026-09-26 one senior
 * member's campaign held 29% of the money raised in her name; her joint fund
 * had 152 donors, 8 of whom supplied half of it, the largest $315,100.
 *
 * Three questions, answered separately (agreed with the owner 2026-09-26):
 *
 *   1. WHAT THE MEMBER RECEIVED - the grade. Their campaign(s) and leadership
 *      PAC, plus whatever any joint fund transferred to them, split by that
 *      fund's own donor mix. Every JFC is treated alike, so no dollar is ever
 *      credited to two members (many funds are shared).
 *   2. WHO THE MEMBER'S PATRONS ARE - the concentration test. The donors of
 *      the member's own joint funds count in full, whichever committee their
 *      cheque ended up in. "Own" = registered under the member's candidacy, or
 *      found by its transfers with the member receiving most of what it
 *      passed on.
 *   3. EVERYTHING RAISED IN THEIR NAME - disclosure. Each fund's full take,
 *      its big-cheque share, what reached the member, what went elsewhere.
 *
 * Pure except fetchPersonFunding, which takes an injected `fec` function so
 * the pipeline and the read-only trial share one implementation.
 */

const num = x => (Number.isFinite(x) ? x : 0);

// FEC designation: P principal, A authorized, J joint fundraising,
// D leadership PAC. Anything else is not the member's own vehicle.
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
 * The member's own committees active in `cycle`, de-duplicated. `committees`
 * is everything found under their crosswalk candidate IDs (authorized
 * committees + leadership PACs by sponsor). Dead JFCs from old cycles are
 * dropped by the cycle filter.
 */
export function selectVehicles(committees, cycle) {
  const byId = new Map();
  for (const c of committees || []) {
    const role = vehicleRole(c);
    if (!role || !(c.cycles || []).includes(cycle) || byId.has(c.committee_id)) {
      continue;
    }
    byId.set(c.committee_id, { committeeId: c.committee_id, name: c.name, role });
  }
  return [...byId.values()].sort((a, b) => a.committeeId.localeCompare(b.committeeId));
}

/**
 * Classify transfers received by the member's money vehicles (campaigns and
 * leadership PACs), from FEC Schedule A line 12 with committee senders. Each
 * row names its sender, so nothing is inferred:
 *
 *   sender is another of the member's money vehicles -> internal (already
 *     counted where it was raised; netted from receipts)
 *   sender is a joint fund (designation J), registered to the member or not
 *     -> a JFC transfer, credited to the member and split by the fund's mix
 *   anything else (party committees etc.) -> left as is
 *
 * Totals alone cannot do this: a fund and a campaign report up to different
 * dates, and a fund raised last cycle has no receipts this cycle.
 */
export function classifyTransfers(moneyVehicles, transferRows) {
  const own = new Set((moneyVehicles || []).map(v => v.committeeId));
  let internal = 0;
  const jfcs = new Map();
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
      const j = jfcs.get(sender) || {
        committeeId: sender,
        name: r.contributor?.name || '',
        received: 0,
      };
      j.received += amount;
      jfcs.set(sender, j);
    }
  }
  return { internal, jfcs: [...jfcs.values()] };
}

// Money a fund passed on to other committees, per its FEC totals
function transfersOut(t) {
  return (
    num(t?.transfers_to_other_authorized_committee) +
    num(t?.transfers_to_affiliated_committee) +
    num(t?.transfers_to_affiliated_party)
  );
}

/**
 * Is a joint fund the MEMBER'S OWN fund (its donors count toward their
 * concentration test in full), or a shared one (it counts only by what it
 * transferred to them)?
 *
 * Own = registered under the member's candidacy, OR the member's committees
 * are its largest candidate recipient (party committees excluded) per the
 * fund's own disbursement records. A leader's fund exists to raise for the
 * party - "GROW THE MAJORITY" raised $95.8M, passed $74.8M on and sent the
 * Speaker $5.0M - so "received most of it" would wrongly call it shared.
 * Without disbursement data, fall back to "received at least half".
 * Evidence-based throughout; no name matching.
 */
export function isMembersOwnFund(jfc, memberCommitteeIds = []) {
  if (jfc.registered) {
    return true;
  }
  if (jfc.largestCandidateRecipient) {
    return memberCommitteeIds.includes(jfc.largestCandidateRecipient);
  }
  const out = transfersOut(jfc.totals);
  return out > 0 && jfc.received / out >= 0.5;
}

/**
 * The candidate committee that received the most from a fund, from its
 * Schedule B disbursements (transfers out). Party committees (FEC committee
 * types X/Y/Z) are excluded - a leader's fund always sends most to the party.
 */
export function largestCandidateRecipient(disbursementRows) {
  const byRecipient = new Map();
  for (const r of disbursementRows || []) {
    if (r.memo_code === 'X') {
      continue;
    }
    const id = r.recipient_committee_id || r.recipient_committee?.committee_id;
    const type = r.recipient_committee?.committee_type;
    if (!id || ['X', 'Y', 'Z'].includes(type)) {
      continue;
    }
    byRecipient.set(id, (byRecipient.get(id) || 0) + num(r.disbursement_amount));
  }
  let best = null;
  for (const [id, amount] of byRecipient) {
    if (!best || amount > best.amount) {
      best = { id, amount };
    }
  }
  return best?.id ?? null;
}

/**
 * Combine into the member's figures (question 1) and the disclosure
 * (question 3). Donor buckets of the member's own money vehicles sum
 * directly (contributions are recorded once, where the donor gave);
 * receipts are reduced by internal transfers; money received from joint
 * funds is already inside the receiving committee's receipts and is
 * re-classified into donor buckets by the fund's own mix.
 *
 * @param moneyVehicles [{committeeId, role, name, totals, bigCheques?}]
 * @param transfers     {internal, jfcs:[{committeeId, name, received, totals, registered, bigCheques?}]}
 */
export function combineVehicleTotals(moneyVehicles, transfers = { internal: 0, jfcs: [] }) {
  const withTotals = (moneyVehicles || []).filter(v => v.totals && num(v.totals.receipts) > 0);
  const gross = withTotals.reduce((s, v) => s + num(v.totals.receipts), 0);
  const sum = f => withTotals.reduce((s, v) => s + num(v.totals[f]), 0);

  const buckets = {
    grassrootsDonations: sum('individual_unitemized_contributions'),
    largeDonorDonations: sum('individual_itemized_contributions'),
    pacMoney: sum('other_political_committee_contributions'),
    partyMoney: sum('political_party_committee_contributions'),
  };
  for (const j of transfers.jfcs || []) {
    const r = num(j.totals?.receipts);
    if (r > 0 && j.received > 0) {
      buckets.grassrootsDonations +=
        j.received * (num(j.totals.individual_unitemized_contributions) / r);
      buckets.largeDonorDonations +=
        j.received * (num(j.totals.individual_itemized_contributions) / r);
      buckets.pacMoney += j.received * (num(j.totals.other_political_committee_contributions) / r);
      buckets.partyMoney +=
        j.received * (num(j.totals.political_party_committee_contributions) / r);
    }
  }

  const internal = Math.min(num(transfers.internal), gross);
  const totalRaised = gross - internal;
  const largestSingle = Math.max(0, ...withTotals.map(v => num(v.totals.receipts)));

  const committees = [
    ...withTotals.map(v => ({
      committeeId: v.committeeId,
      name: v.name,
      role: v.role,
      raised: num(v.totals.receipts),
      bigCheques: v.bigCheques ?? null,
      smallDonors: num(v.totals.individual_unitemized_contributions),
      pac: num(v.totals.other_political_committee_contributions),
    })),
    ...(transfers.jfcs || []).map(j => ({
      committeeId: j.committeeId,
      name: j.name,
      role: 'joint',
      registered: Boolean(j.registered),
      ownFund: isMembersOwnFund(
        j,
        withTotals.map(v => v.committeeId)
      ),
      raised: num(j.totals?.receipts),
      bigCheques: j.bigCheques ?? null,
      toMember: j.received,
      passedElsewhere: Math.max(0, transfersOut(j.totals) - j.received),
    })),
  ];

  return {
    totalRaised,
    ...buckets,
    grassrootsPercent:
      totalRaised > 0 ? Math.round((buckets.grassrootsDonations / totalRaised) * 100) : 0,
    internalTransfers: internal,
    committees,
    // Everything raised under the member's name: own vehicles plus the full
    // take of their own funds (disclosure only - not used for the grade)
    raisedInName:
      totalRaised +
      committees
        .filter(c => c.role === 'joint' && c.ownFund)
        .reduce((s, c) => s + Math.max(0, c.raised - c.toMember), 0),
    // Invariants, asserted by callers
    invariantsHold: totalRaised <= gross + 1 && totalRaised >= largestSingle - 1,
  };
}

/** Committees whose itemized donors form the member's concentration pool. */
export function donorCommitteeIds(result) {
  return (result.committees || [])
    .filter(c => c.role !== 'joint' || c.ownFund)
    .map(c => c.committeeId)
    .sort();
}

/** Stable identity of a committee set, recorded on analyses. */
export function committeeSignature(ids) {
  return [...(ids || [])].sort().join(',');
}

/** Thrown when discovery would exceed the caller's per-run request budget. */
export class RequestBudgetExceeded extends Error {}

/**
 * Wrap a `fec` function so it refuses to make more than `max` requests.
 * Cloudflare's free plan allows 50 outbound requests per worker run.
 */
export function withRequestBudget(fec, max) {
  let used = 0;
  const wrapped = async (path, params) => {
    if (used >= max) {
      throw new RequestBudgetExceeded(`request budget of ${max} reached at ${path}`);
    }
    used++;
    return fec(path, params);
  };
  wrapped.used = () => used;
  return wrapped;
}

/**
 * Fetch and combine everything for one member. `fec(path, params)` returns
 * the parsed JSON body; the caller owns rate limiting and the API key.
 *
 * FEC calls: 2 per crosswalk ID (committees + sponsored), 1 per committee
 * for totals and 1 for the big-cheque band, and one page per 100 transfer
 * rows on each money vehicle. Typically 8-20 per member.
 */
export async function fetchPersonFunding(fec, crosswalkIds, cycle) {
  const found = [];
  for (const id of crosswalkIds) {
    found.push(...((await fec(`/candidate/${id}/committees/`, { per_page: 100 })).results || []));
    found.push(
      ...((await fec('/committees/', { sponsor_candidate_id: id, per_page: 100 })).results || [])
    );
  }
  const vehicles = selectVehicles(found, cycle);
  const registeredJfcIds = new Set(
    vehicles.filter(v => v.role === 'joint').map(v => v.committeeId)
  );
  const moneyVehicles = vehicles.filter(v => v.role !== 'joint');

  const totalsOf = async committeeId =>
    ((await fec(`/committee/${committeeId}/totals/`, { cycle })).results || [])[0] || null;
  const bigChequesOf = async committeeId => {
    const bands = (
      await fec('/schedules/schedule_a/by_size/', { committee_id: committeeId, cycle })
    ).results;
    return (bands || []).filter(b => b.size >= 2000).reduce((s, b) => s + num(b.total), 0);
  };
  // The FEC's size breakdown does not always reconcile with the committee's
  // receipts (one leadership PAC showed $2,000+ cheques at 149% of what it
  // raised). An unreconciled figure is not published: null, shown as "—".
  const reconciledBigCheques = (big, totals) =>
    big !== null && totals && big <= num(totals.receipts) * 1.02 ? big : null;

  for (const v of moneyVehicles) {
    v.totals = await totalsOf(v.committeeId);
    v.bigCheques = v.totals
      ? reconciledBigCheques(await bigChequesOf(v.committeeId), v.totals)
      : null;
  }

  const rows = [];
  for (const v of moneyVehicles) {
    if (!v.totals) {
      continue;
    }
    const line = ['H', 'S', 'P'].includes(v.totals.committee_type) ? 'F3-12' : 'F3X-12';
    // Largest first: actual transfers are big, while the memo rows that
    // itemize a fund's PAC donors are small. Stop at the first page with no
    // actual (non-memo) transfer on it - one or two pages even for a member
    // whose line 12 carries hundreds of memo rows.
    let last = {};
    for (;;) {
      const d = await fec('/schedules/schedule_a/', {
        committee_id: v.committeeId,
        two_year_transaction_period: cycle,
        line_number: line,
        contributor_type: 'committee',
        sort: '-contribution_receipt_amount',
        per_page: 100,
        ...last,
      });
      const page = d.results || [];
      rows.push(...page);
      const li = d.pagination?.last_indexes;
      if (!li || page.length === 0 || !page.some(r => r.memo_code !== 'X')) {
        break;
      }
      last = { ...li };
    }
  }

  const transfers = classifyTransfers(moneyVehicles, rows);
  // Registered funds that sent nothing this cycle are still disclosed
  for (const id of registeredJfcIds) {
    if (!transfers.jfcs.some(j => j.committeeId === id)) {
      const v = vehicles.find(x => x.committeeId === id);
      transfers.jfcs.push({ committeeId: id, name: v.name, received: 0 });
    }
  }
  for (const j of transfers.jfcs) {
    j.registered = registeredJfcIds.has(j.committeeId);
    j.totals = await totalsOf(j.committeeId);
    j.bigCheques = j.totals
      ? reconciledBigCheques(await bigChequesOf(j.committeeId), j.totals)
      : null;
    if (!j.registered) {
      // One page of its largest transfers out is enough to find its biggest
      // candidate recipient
      const d = await fec('/schedules/schedule_b/', {
        committee_id: j.committeeId,
        two_year_transaction_period: cycle,
        sort: '-disbursement_amount',
        per_page: 100,
      });
      j.largestCandidateRecipient = largestCandidateRecipient(d.results);
    }
  }

  const result = combineVehicleTotals(moneyVehicles, transfers);
  return { ...result, donorCommitteeIds: donorCommitteeIds(result) };
}
