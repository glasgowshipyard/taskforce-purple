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

/**
 * Classify a Schedule A transaction row (from an UNFILTERED fetch - the
 * worker no longer passes contributor_type=individual, because that filter
 * drops the PAC-entity memo rows that name conduits).
 *
 * Returns one of:
 *  - 'invalid'              - zero/negative amount, unusable
 *  - 'conduit-memo'         - memo lump naming a conduit; aggregate for
 *                             attribution, exclude from money totals
 *  - 'memo'                 - other memo row; skip entirely
 *  - 'committee'            - non-memo committee/org row (PAC contributions
 *                             etc.); skip here, the data pipeline's Phase 2
 *                             handles committee money
 *  - 'individual-earmarked' - countable individual row that arrived
 *                             pre-bundled through some conduit
 *  - 'individual'           - ordinary countable individual row
 */
export function classifyScheduleARow(tx) {
  if (!tx.contribution_receipt_amount || tx.contribution_receipt_amount <= 0) {
    return 'invalid';
  }

  const entityType = (tx.entity_type || '').toUpperCase();

  if (tx.memoed_subtotal === true) {
    if (tx.line_number === '11AI' && CONDUIT_ENTITY_TYPES.has(entityType) && tx.contributor_name) {
      return 'conduit-memo';
    }
    return 'memo';
  }

  if (CONDUIT_ENTITY_TYPES.has(entityType)) {
    return 'committee';
  }

  if (/earmark/i.test(tx.memo_text || '')) {
    return 'individual-earmarked';
  }

  return 'individual';
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
