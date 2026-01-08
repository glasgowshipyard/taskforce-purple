# Prototype vs Free-Tier: Refactor Comparison

**Date:** 2026-01-08
**Files:**
- Prototype: `workers/itemized-prototype.js`
- Free-Tier: `workers/itemized-free-tier.js`

## The Problem Being Solved

**Prototype storage requirements:**
- Bernie: 38 MB (76 chunks of raw transactions)
- Pelosi: 20 MB (40 chunks of raw transactions)
- Extrapolated to 535 members: **15.5 GB**
- Cloudflare KV free tier: **1 GB**
- **Over by 14.5 GB** ❌

## Key Architectural Changes

### 1. Progress Data Structure

**Prototype (itemized-prototype.js, line 256):**
```javascript
progress = {
  bioguideId,
  committeeId,
  cycle,
  totalTransactions: 0,
  totalChunks: 0,
  transactionBuffer: [],  // ❌ Stores 500 raw transaction objects
  // ... pagination fields
};
```

**Free-Tier (itemized-free-tier.js, line 267):**
```javascript
progress = {
  bioguideId,
  committeeId,
  cycle,
  totalTransactions: 0,
  totalAmount: 0,              // ✅ Running total
  donorTotals: {},             // ✅ Map: "FIRST|LAST|STATE|ZIP" → amount
  allAmounts: [],              // ✅ Array for median (numbers only, not full objects)
  // ... pagination fields
};
```

**Storage impact:**
- Prototype: 500 transactions × ~500 bytes = ~250 KB per buffer
- Free-Tier: ~13K donors × 50 bytes + 37K numbers × 8 bytes = ~950 KB total (not per chunk)

### 2. Transaction Processing

**Prototype (lines 327-333):**
```javascript
// Add transaction to buffer
progress.transactionBuffer.push(transaction);

// When buffer reaches 1000, save as chunk
if (progress.transactionBuffer.length >= TRANSACTIONS_PER_CHUNK) {
  const chunkKey = `transactions:${bioguideId}:chunk_${chunkNumber}`;
  await env.MEMBER_DATA.put(chunkKey, JSON.stringify(progress.transactionBuffer));
  progress.transactionBuffer = [];
}
```

**Free-Tier (lines 341-359):**
```javascript
// Update aggregates in-memory (NO storage)
for (const tx of transactions) {
  if (tx.memoed_subtotal === true) continue;

  const compositeKey = `${firstName}|${lastName}|${state}|${zip}`;

  // Aggregate by donor
  progress.donorTotals[compositeKey] =
    (progress.donorTotals[compositeKey] || 0) + tx.contribution_receipt_amount;

  // Track amounts for median
  progress.allAmounts.push(tx.contribution_receipt_amount);

  // Running totals
  progress.totalTransactions++;
  progress.totalAmount += tx.contribution_receipt_amount;
}
```

**Storage impact:**
- Prototype: Creates 76 KV keys for Bernie (each 250-500 KB)
- Free-Tier: Updates same aggregates in-place (no new keys)

### 3. Chunk Storage

**Prototype (lines 354-362):**
```javascript
// Save buffer as chunk to KV
if (progress.transactionBuffer.length > 0) {
  const chunkKey = `transactions:${bioguideId}:chunk_${chunkNumber}`;
  await env.MEMBER_DATA.put(chunkKey, JSON.stringify(progress.transactionBuffer));

  progress.totalChunks++;
  progress.transactionBuffer = [];
}
```

**Free-Tier:**
```javascript
// ✅ REMOVED ENTIRELY - No chunk storage
// Aggregates are saved in progress key instead
```

**Storage impact:**
- Prototype: 76 chunk keys × 500 KB = 38 MB (Bernie)
- Free-Tier: 0 chunk keys = 0 MB ✅

### 4. Final Analysis

**Prototype (lines 386-401):**
```javascript
// Load ALL chunks back into memory
const allTransactions = [];
for (let i = 0; i < progress.totalChunks; i++) {
  const chunkKey = `transactions:${bioguideId}:chunk_${i}`;
  const chunkData = await env.MEMBER_DATA.get(chunkKey);
  const chunkTransactions = JSON.parse(chunkData);
  allTransactions.push(...chunkTransactions);  // 37K objects in memory
}

// Analyze all transactions
const analysis = analyzeTransactions(allTransactions);
```

**Free-Tier (lines 436-497):**
```javascript
// Calculate metrics from aggregates (already in progress object)
function calculateMetricsFromAggregates(progress, log) {
  const donorTotals = progress.donorTotals;    // Already aggregated
  const allAmounts = progress.allAmounts;      // Already collected

  // Sort for top-N
  const sortedDonors = Object.entries(donorTotals)
    .sort((a, b) => b[1] - a[1]);

  // Calculate median
  allAmounts.sort((a, b) => a - b);
  const median = allAmounts[Math.floor(allAmounts.length / 2)];

  // Return metrics
  return {
    uniqueDonors: sortedDonors.length,
    avgDonation: progress.totalAmount / allAmounts.length,
    medianDonation: median,
    top10Concentration: top10Total / progress.totalAmount,
    // ...
  };
}
```

**Memory impact:**
- Prototype: Loads 37K full transaction objects (~18 MB) into memory at once
- Free-Tier: Already has aggregates (~950 KB), just sorts and calculates

### 5. Cleanup After Completion

**Prototype:**
```javascript
// ❌ NO CLEANUP - Chunks remain in KV forever
// Progress key remains in KV
// Total: 38 MB + progress key stays in storage
```

**Free-Tier (lines 434-435):**
```javascript
// Store final analysis (2 KB)
await env.MEMBER_DATA.put(analysisKey, JSON.stringify(analysis));

// Delete progress to save storage
await env.MEMBER_DATA.delete(progressKey);
log(`🗑️ Cleaned up progress data (saved ${progressSize} KB)`);
```

**Storage impact:**
- Prototype: 38 MB permanent storage per member
- Free-Tier: 2 KB permanent storage per member (19,000× smaller)

## Storage Comparison Table

| Phase | Prototype | Free-Tier | Savings |
|-------|-----------|-----------|---------|
| **During Collection (Bernie)** | | | |
| Progress key | ~10 KB | ~950 KB | -940 KB |
| Transaction chunks | 38 MB (76 keys) | 0 MB | +38 MB |
| **SUBTOTAL** | **38 MB** | **950 KB** | **97.5% reduction** |
| | | | |
| **After Collection (Bernie)** | | | |
| Analysis key | ~2 KB | ~2 KB | 0 |
| Progress key | ~10 KB | 0 (deleted) | +10 KB |
| Transaction chunks | 38 MB (76 keys) | 0 MB | +38 MB |
| **SUBTOTAL** | **38 MB** | **2 KB** | **99.995% reduction** |
| | | | |
| **All 535 Members (Collection)** | | | |
| Total storage | 15.5 GB | 535 MB | **96.5% reduction** |
| KV free tier | 1 GB | 1 GB | |
| **FITS IN FREE TIER?** | **❌ NO** | **✅ YES** | |
| | | | |
| **All 535 Members (After Cleanup)** | | | |
| Total storage | 15.5 GB | 1 MB | **99.99% reduction** |
| KV free tier | 1 GB | 1 GB | |
| **FITS IN FREE TIER?** | **❌ NO** | **✅ YES** | |

## Code Size Comparison

**Prototype:**
- Lines of code: ~610
- Complexity: Chunk management, buffer handling, multi-stage loading

**Free-Tier:**
- Lines of code: ~555
- Complexity: Simpler (no chunking logic)
- **55 lines removed** by eliminating chunking

## What We Keep

✅ **All the good stuff from the prototype:**
- Cursor-based pagination (fixed bug)
- Proper deduplication using `first|last|state|zip`
- Memo entry filtering
- Transaction count validation
- Financial reconciliation with FEC
- All concentration metrics (unique donors, top-10%, median, etc.)

## What We Lose

❌ **Trade-offs:**
- Cannot re-query raw transaction history
- Cannot change deduplication logic without re-collecting
- Cannot drill down into individual donations after analysis

## Why This Trade-Off Is Acceptable

**The raw transactions are not the product.** The concentration metrics are the product.

Once we've proven the deduplication logic works (Bernie + Pelosi test validated it), we don't need 15.5 GB of transaction history sitting in storage forever. We can always re-collect fresh data if needed (FEC API is free, just takes time).

## Migration Path

**Option 1: Clean slate (recommended)**
1. Deploy `itemized-free-tier.js` to NEW worker name
2. Let it collect fresh data for Bernie + Pelosi
3. Verify results match prototype
4. Expand to all 535 members
5. Retire prototype worker

**Option 2: In-place upgrade**
1. Deploy `itemized-free-tier.js` to same worker name
2. Delete existing chunk keys (cleanup old data)
3. Let it collect fresh with new architecture

**Recommendation:** Clean slate. Keep prototype for reference/comparison.

## Testing Plan

**Phase 1: Validation (2-3 days)**
1. Deploy free-tier worker alongside prototype
2. Collect Bernie + Pelosi data
3. Compare metrics:
   - Unique donors count
   - Total amount
   - Average/median donation
   - Top-10 concentration
4. Verify storage stays under 2 MB for both

**Phase 2: Expansion (54 days)**
1. Add all 535 members to processing list
2. Pace at ~10 members/day (stay under 1K writes/day limit)
3. Monitor KV storage (should peak at 535 MB during collection)
4. Verify cleanup (should drop to ~1 MB after all complete)

**Phase 3: Integration**
1. Update tier calculation to use concentration metrics
2. Build dashboard/API endpoints
3. Implement cycle rollover (keep current + previous)

## Key Files

- **New worker:** `workers/itemized-free-tier.js`
- **New config:** `workers/wrangler-free-tier.toml`
- **Design doc:** `FREE_TIER_ITEMIZED_STRATEGY.md`
- **Old worker:** `workers/itemized-prototype.js` (keep for reference)
- **Old config:** `workers/wrangler-itemized.toml` (keep for reference)

---

**Status:** Ready for testing
**Risk:** Low (same proven logic, just different storage strategy)
**Blocker Resolution:** Unblocks Issue #20 production scaling to 535 members
