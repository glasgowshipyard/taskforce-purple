/**
 * SCHEDULE A ROW CLASSIFICATION - pure functions, unit-tested
 *
 * FEC earmark mechanics on a recipient committee's Schedule A (verified
 * empirically 2026-07-12, see issue #33):
 *
 * - The individual donors appear as normal non-memo 11AI rows, but with
 *   memo_text like "* EARMARKED CONTRIBUTION: SEE BELOW" and a NULL
 *   conduit_committee_id - the row does NOT name the conduit.
 * - The conduit's identity arrives as a SEPARATE MEMO row: memoed_subtotal
 *   true, entity_type PAC/ORG/COM, line 11AI, contributor_name = the conduit
 *   (e.g. "AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC", "ACTBLUE"), amount
 *   = the attributed total.
 *
 * So: memo rows stay OUT of money totals (double-counting) but their
 * conduit lumps are aggregated separately for network attribution.
 */

// Committee-ish entity types that can act as a conduit/bundler
const CONDUIT_ENTITY_TYPES = new Set(['PAC', 'ORG', 'COM', 'CCM', 'PTY']);

// FEC marks memo entries two ways; either one makes a row a memo
const isMemo = tx => tx.memoed_subtotal === true || tx.memo_code === 'X';

/**
 * Classify a Schedule A transaction row (from an UNFILTERED fetch - the
 * worker no longer passes contributor_type=individual, because that filter
 * drops the PAC-entity memo rows that name conduits).
 *
 * Counting follows the FEC's own definition (2026-09-26). The FEC's
 * "itemized individual contributions" total is exactly the non-memo rows on
 * LINE 11AI - "contributions from individuals/persons other than political
 * committees". That line includes non-people that may legally give to a
 * campaign, such as tribal nations filed as organisations, and negative
 * refund/correction rows that net against a donor. The old rule went by
 * entity type and dropped both, so our totals disagreed with the FEC's (one
 * campaign: two tribal contributions, $4,500). Rows without a line number
 * fall back to the entity-type rule.
 *
 * Returns one of:
 *  - 'invalid'               - zero or unusable amount
 *  - 'conduit-memo'          - memo lump naming a conduit; aggregate for
 *                              attribution, exclude from money totals
 *  - 'memo'                  - other memo row; skip entirely
 *  - 'committee'             - not an itemized individual contribution
 *                              (other lines: PAC money, transfers, other
 *                              receipts); skip here
 *  - 'individual-adjustment' - negative 11AI row (refund/correction): nets
 *                              against the donor and the total
 *  - 'individual-earmarked'  - countable row that arrived pre-bundled
 *                              through some conduit
 *  - 'individual'            - ordinary countable row
 */
export function classifyScheduleARow(tx) {
  const amount = tx.contribution_receipt_amount;
  if (!Number.isFinite(amount) || amount === 0) {
    return 'invalid';
  }

  const entityType = (tx.entity_type || '').toUpperCase();
  const line = (tx.line_number || '').toUpperCase();

  if (isMemo(tx)) {
    if (
      amount > 0 &&
      line === '11AI' &&
      CONDUIT_ENTITY_TYPES.has(entityType) &&
      tx.contributor_name
    ) {
      return 'conduit-memo';
    }
    return 'memo';
  }

  if (line) {
    if (line !== '11AI') {
      return 'committee';
    }
  } else if (CONDUIT_ENTITY_TYPES.has(entityType)) {
    return 'committee';
  }

  if (amount < 0) {
    return 'individual-adjustment';
  }

  if (/earmark/i.test(tx.memo_text || '')) {
    return 'individual-earmarked';
  }

  return 'individual';
}

/** Does this class count toward itemized individual money? */
export function countsAsItemizedIndividual(rowClass) {
  return (
    rowClass === 'individual' ||
    rowClass === 'individual-earmarked' ||
    rowClass === 'individual-adjustment'
  );
}

// Normalize a conduit's reported name so filing variations aggregate
// together ("AIPAC PAC" vs "AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC"
// stay distinct - only whitespace/case/punctuation noise is folded)
export function normalizeConduitName(name) {
  return (name || '').toUpperCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();
}

// Reduce a conduit totals map to the top N for storage (KV values stay small)
export function topConduits(conduitTotals, n = 10) {
  return Object.entries(conduitTotals)
    .map(([name, v]) => ({ name, amount: Math.round(v.amount * 100) / 100, count: v.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}
