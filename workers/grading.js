// Grading a member from their record and their donor analysis. Pure: used by
// the API worker (with the analysis it reads from KV) and by the refresh job
// (with the analysis it computes), so both grade exactly the same way.
// The tier maths itself is in tier-calculation.js.

import {
  DEFAULT_OPTIONS,
  calculateEnhancedTier as computeEnhancedTier,
  final3Group,
  gradeFinal3,
} from './tier-calculation.js';

/**
 * `analysis` must already be known to belong to the member (same committee;
 * the caller rejects a mismatched one, issue #41), or be null. `options`
 * (simulations only) override production's tier options.
 */
export function gradeMember(member, analysis, options = null) {
  // Grade basis (#32). Once a member's analysis pools donors from every
  // committee they run, grade on everything they received - campaign(s),
  // leadership PAC, and money transferred in from joint funds - so the
  // concentration test and the money it tests describe the same thing.
  // Until then, grade on the campaign committee: switching the money to
  // all committees while concentration still saw only the campaign's donors
  // would grade big-cheque joint-fund money unexamined.
  // ...and only when every committee's records and money reconciled with the
  // FEC's own figures at completion.
  //
  // Grade first, confirm after (owner, 2026-10-04): a member graded from the
  // FEC's bulk files before the record-by-record check is graded the same
  // way, marked not yet checked (`reconciliation.pending`). The check then
  // confirms the grade or shifts it.
  const pf = analysis?.personLevel ? analysis.personFunding : null;
  const reconciled = analysis?.reconciliation?.ok === true;
  const awaitingCheck = analysis?.reconciliation?.pending === true;
  const personLevel = Boolean(
    pf && !pf.failed && pf.totalRaised > 0 && pf.invariantsHold && (reconciled || awaitingCheck)
  );
  // A candidate's own money (gifts and loans to their own campaign) is left
  // out of the grade (#59, owner 2026-10-08): being rich or driven makes
  // them depend on no one. It's still shown, so it's kept in personFigures.
  // It must fit inside what they raised; if it doesn't, the figures don't
  // reconcile to source and no grade is published (#62).
  const own = personLevel ? ownMoneyTotal(pf.ownMoney) : 0;
  const fromOthers = personLevel ? pf.totalRaised - own : 0;
  const ownDoesntFit = own > 0 && fromOthers < fundedByOthers(pf) * 0.98 - 1;
  const scored = personLevel
    ? {
        ...member,
        totalRaised: fromOthers,
        grassrootsDonations: pf.grassrootsDonations,
        largeDonorDonations: pf.largeDonorDonations,
        grassrootsPercent:
          own > 0 && fromOthers > 0
            ? Math.round((pf.grassrootsDonations / fromOthers) * 100)
            : pf.grassrootsPercent,
        pacMoney: pf.pacMoney,
        partyMoney: pf.partyMoney,
      }
    : member;

  const result = ownDoesntFit
    ? {
        tier: 'DISPUTED',
        disputed: true,
        disputeReason: 'own-money-exceeds-receipts',
        individualFundingPercent: null,
        detail: { path: 'disputed' },
      }
    : computeEnhancedTier(
        scored,
        analysis,
        options ? { ...DEFAULT_OPTIONS, ...options } : DEFAULT_OPTIONS
      );
  result.gradeBasis = personLevel
    ? 'all-committees'
    : pf && !pf.failed && !reconciled
      ? 'campaign-committee-rechecking'
      : 'campaign-committee';
  // true: every record checked against the FEC; false: graded from the bulk
  // files, check still to come; null: not graded on all committees
  result.evidenceChecked = personLevel ? reconciled : null;
  result.personFigures = personLevel
    ? {
        totalRaised: pf.totalRaised,
        grassrootsDonations: pf.grassrootsDonations,
        largeDonorDonations: pf.largeDonorDonations,
        pacMoney: pf.pacMoney,
        partyMoney: pf.partyMoney,
        grassrootsPercent: pf.grassrootsPercent,
        ...(own > 0 ? { ownMoney: pf.ownMoney } : {}),
      }
    : null;
  return result;
}

/** A candidate's own money in their receipts: their gifts plus their loans. */
export function ownMoneyTotal(ownMoney) {
  return ownMoney ? (ownMoney.contributions || 0) + (ownMoney.loans || 0) : 0;
}

// Money we know came from someone other than the candidate
const fundedByOthers = pf =>
  (pf.grassrootsDonations || 0) +
  (pf.largeDonorDonations || 0) +
  (pf.pacMoney || 0) +
  (pf.partyMoney || 0);

const round2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

/**
 * A member's grade under FINAL-3 (owner, frozen 2026-10-12), in the shape the
 * site and the publish step read. `inputs`: gradeFinal3's member inputs;
 * `pacs`, `shares`: the committees and their traced people shares.
 * `detail.method` is 'final-3'; the working is in dollars.
 */
export function gradeMemberFinal3(inputs, pacs, shares) {
  const g = gradeFinal3(inputs, pacs, shares);
  const pf = inputs.whole ? { ...inputs.pf, ...inputs.whole } : inputs.pf;
  const graded = ['S', 'A', 'B', 'C', 'D', 'E', 'F'].includes(g.tier);
  const reconciled = inputs.reconciliation?.ok === true;
  const ownMoney = pf?.ownMoney;
  return {
    tier: g.tier,
    individualFundingPercent: graded ? g.score : null,
    ...(g.tier === 'DISPUTED' ? { disputed: true, disputeReason: g.reason } : {}),
    ...(g.tier === 'N/A' ? { withheldReason: g.reason } : {}),
    gradeBasis: g.reason === 'mixed-source' ? null : 'all-committees',
    evidenceChecked: g.reason === 'mixed-source' ? null : reconciled,
    personFigures:
      g.reason === 'mixed-source'
        ? null
        : {
            totalRaised: pf.totalRaised,
            grassrootsDonations: pf.grassrootsDonations,
            largeDonorDonations: pf.largeDonorDonations,
            pacMoney: pf.pacMoney,
            partyMoney: pf.partyMoney,
            grassrootsPercent: pf.totalRaised
              ? Math.round((pf.grassrootsDonations / pf.totalRaised) * 100)
              : 0,
            ...(ownMoneyTotal(ownMoney) > 0 ? { ownMoney } : {}),
          },
    detail: {
      method: 'final-3',
      // Money given, by kind, after other politicians' funds and directed
      // gifts are taken out (dollars)
      small: round2(g.s),
      big: round2(g.b),
      pac: round2(g.p),
      party: round2(g.y),
      otherPoliticiansFunds: round2(g.j),
      directed: round2(g.e),
      given: round2(g.denominator),
      // The donor test and the allowance
      donors: g.N ?? null,
      fewestHoldingHalf: g.n ?? null,
      allowance: Number.isFinite(g.allowance) ? Math.round(g.allowance * 10000) / 10000 : null,
      reliable: g.reliable ?? null,
      bigCounted: round2(g.counted),
      // What counts
      fromPeople: round2(g.fromPeople),
      pacCounted: round2(g.creditDollars),
      directedCounted: round2(g.earmarkDollars),
      score: graded ? g.score : null,
    },
  };
}

/**
 * The committees behind a member's grade, for the member page: each PAC's
 * gift, its group, its traced people share and what counts; and the
 * committees that directed gifts to the member. `gifts`, `giftsToFunds`:
 * [{ id, name, amount, ... }] (pacs.mjs pacGifts); `directedOut`: { id: $ }.
 */
export function committeesFinal3(
  { gifts = [], giftsToFunds = [], directedOut = {} },
  pacs,
  shares,
  limit = 30
) {
  const row = (g, to) => {
    const p = pacs[g.id];
    const group = final3Group(p);
    const share = shares.get(g.id) ?? null;
    return {
      ...g,
      to,
      group,
      peopleShare: share === null ? null : Math.round(share * 1000) / 1000,
      counts: group === 'people' && share !== null ? Math.round(g.amount * share * 100) / 100 : 0,
      why: p?.sponsor?.reason || null,
      test:
        group === 'people' || group === 'board' || group === 'untested'
          ? p?.peopleTest?.evidence || null
          : null,
    };
  };
  const list = [
    ...gifts.map(g => row(g, 'campaign')),
    ...giftsToFunds.map(g => row(g, 'own joint fund')),
  ].sort((a, b) => b.amount - a.amount);
  const directed = Object.entries(directedOut)
    .filter(([, a]) => a > 0)
    .map(([id, amount]) => row({ id, name: pacs[id]?.name || id, amount }, 'directed'))
    .sort((a, b) => b.amount - a.amount);
  const sum = xs => Math.round(xs.reduce((t, x) => t + x, 0) * 100) / 100;
  return {
    method: 'final-3',
    total: sum(list.map(r => r.amount)),
    count: list.length,
    byGroup: list.reduce((t, r) => ({ ...t, [r.group]: sum([t[r.group] || 0, r.amount]) }), {}),
    list: list.slice(0, limit),
    directed: directed.slice(0, limit),
    directedTotal: sum(directed.map(r => r.amount)),
  };
}
