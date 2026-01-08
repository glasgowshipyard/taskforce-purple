# Critical Bug Fix: Itemized Donor Analysis Data Corruption

**Date**: 2026-01-07
**Severity**: CRITICAL
**Impact**: All previous donor concentration metrics were invalid

## Summary

Discovered and fixed three critical bugs in the itemized donor concentration analysis that caused 50%+ data loss. Previous results showing Bernie Sanders with 8,408 unique donors and Nancy Pelosi with 1,476 unique donors were based on corrupted, incomplete data.

## Bugs Discovered

### Bug #1: Pagination Completion Logic (CRITICAL)

**Problem**:
```javascript
// OLD (BROKEN):
const isComplete = pagesProcessed < maxPagesToFetch;
```

The worker checked if `pagesProcessed < maxPagesToFetch` to determine completion. This meant any early break from the fetch loop (including getting empty results) would mark the analysis as "complete."

**Impact**:
- Bernie Sanders: Collected only 17,566 of 37,612 transactions (47% complete)
- Nancy Pelosi: Collected only 11,484 of ~23,000 transactions (estimated 50% complete)
- Worker marked both as "✅ COMPLETE" despite missing 20,000+ transactions

**Fix**:
```javascript
// NEW (FIXED):
let reachedEnd = false;
// ... in loop when empty results:
if (transactions.length === 0) {
  reachedEnd = true;
  break;
}
const isComplete = reachedEnd;
```

Now properly tracks whether we actually received empty results from the FEC API.

### Bug #2: Deduplication Using Inconsistent Field

**Problem**:
```javascript
// OLD (BROKEN):
const normalizedName = tx.contributor_name.toUpperCase().trim();
```

Used the `contributor_name` field which has inconsistent formats:
- "SMITH, JOHN"
- "JOHN SMITH"
- "Smith, John"

Same person with different formats = counted as different donors.

**Impact**:
- Inflated unique donor counts
- Understated concentration metrics
- Inconsistent with FEC committee practices

**Fix**:
```javascript
// NEW (FIXED):
const firstName = (tx.contributor_first_name || '').toUpperCase().trim();
const lastName = (tx.contributor_last_name || '').toUpperCase().trim();
const compositeKey = `${firstName}|${lastName}|${state}|${zip}`;
```

Uses separate first/last name fields that are consistently formatted.

### Bug #3: Missing Reconciliation Validation

**Problem**:
No validation that:
1. Collected transaction count matched FEC's reported total
2. Summed transaction amounts matched FEC's `individual_itemized_contributions`

**Impact**:
- Bugs #1 and #2 went undetected for months
- No way to verify data collection completeness
- No confidence in calculated metrics

**Fix**:
Added two validation checks:

1. **Transaction Count Validation**:
```javascript
if (progress.fecTotalCount && progress.totalTransactions !== progress.fecTotalCount) {
  log(`⚠️ WARNING: Transaction count mismatch!`);
  log(`   FEC reported: ${progress.fecTotalCount} transactions`);
  log(`   We collected: ${progress.totalTransactions} transactions`);
}
```

2. **Financial Reconciliation**:
```javascript
const fecItemizedTotal = fecTotal.individual_itemized_contributions || 0;
const ourCalculatedTotal = analysis.totalAmount;
const difference = Math.abs(fecItemizedTotal - ourCalculatedTotal);
const percentDiff = fecItemizedTotal > 0 ? (difference / fecItemizedTotal) * 100 : 0;

if (percentDiff > 1) {
  log(`⚠️ WARNING: Totals differ by more than 1%!`);
}
```

## Files Modified

- `workers/itemized-prototype.js` (Lines 271-445)
  - Fixed pagination completion logic
  - Fixed deduplication to use first_name + last_name
  - Added transaction count validation
  - Added financial reconciliation
  - Improved progress logging

## Re-Collection Status

- ✅ Deployed fixed worker
- ✅ Deleted corrupted data for Bernie Sanders (17,566 bad transactions)
- ✅ Deleted corrupted data for Nancy Pelosi (11,484 bad transactions)
- 🔄 Bernie Sanders re-collection in progress (37,612 transactions, ETA ~45 min)
- ⏸️ Nancy Pelosi queued (will auto-start after Bernie completes)

## Testing

Before deploying, verified:
1. ✅ FEC API pagination works correctly (tested with real cursors)
2. ✅ Transaction count validation displays correctly
3. ✅ Progress shows "X/Y (Z%)" format
4. ✅ Worker stays within all limits (CPU, subrequests, FEC rate limit)

Current limits usage:
- Worker execution: ~9s of 30s limit (30%)
- Subrequests: 5-7 of 50 limit (14%)
- FEC rate limit: 2.5 calls/min of 16.67 limit (15%)

## Key Learnings

1. **`contributor_aggregate_ytd` is NOT FEC's deduplication** - it's the committee's own tracking. FEC doesn't deduplicate donors; committees are responsible for tracking "same donor."

2. **Dedup strategy `first|last|state|zip` is sound** - matches committee practice of using "name and mailing address" per FEC guidelines.

3. **Always validate collection completeness** - without reconciliation checks, critical bugs can go undetected.

## Expected Results After Re-Collection

Once Bernie completes (all 37,612 transactions):
- Unique donor count will likely be ~16-18K (up from 8,408)
- Top-10 concentration will likely be <2% (down from 2.9%)
- Total amount will reconcile to FEC's $3,695,847.30

Once Pelosi completes:
- Unique donor count will likely be ~3-4K (up from 1,476)
- Top-10 concentration will likely be ~5-6% (down from 8.9%)
- The Bernie vs Pelosi comparison will finally be valid

## Recommendations for Future

1. **Always add reconciliation validation** for any data collection
2. **Test completion logic** with edge cases (early breaks, errors)
3. **Verify field formats** before using for deduplication
4. **Monitor progress visually** (X/Y format helps catch issues early)

---

**For GitHub Issues**: This can be split into separate issues:
- Issue: "Fix pagination completion logic causing early termination"
- Issue: "Fix deduplication using inconsistent contributor_name field"
- Issue: "Add reconciliation validation for data collection"

**For Git Commit**:
```
fix(itemized-prototype): Fix critical data loss bugs in donor analysis

- Fix pagination completion logic (was stopping at 47% complete)
- Fix deduplication to use first_name + last_name fields
- Add transaction count and financial reconciliation validation
- Improve progress logging to show X/Y (Z%) format

BREAKING: All previous concentration metrics were invalid.
Re-collection in progress for Bernie Sanders and Nancy Pelosi.
```
