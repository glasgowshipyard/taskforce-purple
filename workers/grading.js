// Grading a member from their record and their donor analysis. Pure: used by
// the API worker (with the analysis it reads from KV) and by the refresh job
// (with the analysis it computes), so both grade exactly the same way.
// The tier maths itself is in tier-calculation.js.

import { calculateEnhancedTier as computeEnhancedTier } from './tier-calculation.js';

/**
 * `analysis` must already be known to belong to the member (same committee;
 * the caller rejects a mismatched one, issue #41), or be null.
 */
export function gradeMember(member, analysis) {
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
    : computeEnhancedTier(scored, analysis);
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
