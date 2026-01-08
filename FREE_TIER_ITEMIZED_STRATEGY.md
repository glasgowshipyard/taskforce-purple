# Free-Tier Itemized Donor Analysis Strategy

**Created:** 2026-01-08
**Status:** Design Document (Not Yet Implemented)
**Priority:** CRITICAL BLOCKER for scaling Issue #20

## The Problem

**Current prototype implementation does NOT scale to free tier:**
- Bernie Sanders: 76 chunks × 500 KB = 38 MB
- Nancy Pelosi: 40 chunks × 500 KB = 20 MB
- **Extrapolated to 535 members: ~15.5 GB**
- Cloudflare free tier KV: **1 GB limit**
- **Over by 14.5 GB** ❌

**Why this happened:** Prototype stores raw transaction chunks for re-querying. This was useful for debugging/validation but is not sustainable for production.

## The Solution: Stream-and-Aggregate

**Core Principle:** Never store raw transactions. Process incrementally and store only aggregates + final metrics.

### Architecture Comparison

#### Current (Prototype)
```
Fetch 500 transactions → Store in KV chunk → Repeat 76 times
                                ↓
                         38 MB stored per member
                                ↓
                         Load all chunks → Deduplicate → Metrics
```

#### Free-Tier (Proposed)
```
Fetch 500 transactions → Update aggregates in-memory → Save aggregates to KV
                                ↓
                         ~1 MB stored per member (during collection)
                                ↓
                         When complete → Calculate metrics → Save 2 KB final
```

## Data Structure Design

### Progress Key (During Collection)

**Key:** `itemized_progress:{bioguideId}`
**Size:** ~1 MB per member
**Lifetime:** Temporary (deleted after analysis complete)

```javascript
{
  // Donor deduplication map
  "donorTotals": {
    "JOHN|SMITH|CA|90210": 450.00,
    "JANE|DOE|NY|10001": 275.00,
    "SARAH|JOHNSON|TX|75001": 125.50
    // ... ~13,000 entries for Bernie-scale
    // Size: 13K donors × 50 bytes avg = 650 KB
  },

  // All donation amounts (for median calculation)
  "allAmounts": [27, 50, 100, 250, 27, 35, ...],
  // Size: 37K transactions × 8 bytes = 296 KB

  // Running totals
  "totalTransactions": 37612,
  "totalAmount": 3695847.30,

  // Pagination state
  "lastCursor": {
    "last_index": "12345",
    "last_contribution_receipt_date": "2025-12-31"
  },

  // Status
  "complete": false,
  "fecTotalCount": 37612,
  "committeeId": "C00411330",
  "cycle": 2026,
  "lastUpdated": "2026-01-08T14:30:00Z"
}
```

### Analysis Key (After Completion)

**Key:** `itemized_analysis:{bioguideId}`
**Size:** ~2 KB per member
**Lifetime:** Permanent (kept for current + previous cycle)

```javascript
{
  "bioguideId": "S000033",
  "name": "Bernie Sanders",
  "cycle": 2026,

  // Core metrics
  "uniqueDonors": 13102,
  "totalTransactions": 37612,
  "totalAmount": 3695847.30,
  "avgDonation": 98.26,
  "medianDonation": 27.00,

  // Concentration metrics
  "top10Concentration": 0.022,  // 2.2%
  "giniCoefficient": 0.45,       // To be implemented
  "herfindahlIndex": 0.0015,     // To be implemented

  // Top donors (for display)
  "topDonors": [
    {"name": "JOHN SMITH", "state": "CA", "total": 8100.00},
    {"name": "JANE DOE", "state": "NY", "total": 7250.00}
    // ... top 10 only
  ],

  // Metadata
  "committeeId": "C00411330",
  "collectionCompletedAt": "2026-01-08T18:45:23Z",
  "lastUpdated": "2026-01-08T18:45:23Z"
}
```

## Worker Logic (Pseudo-Code)

### Cron Handler (Every 2 Minutes)

```javascript
async function processNextChunk(env) {
  const members = [
    { bioguideId: 'S000033', committeeId: 'C00411330' },
    { bioguideId: 'P000197', committeeId: 'C00213512' }
    // ... expand to all 535
  ];

  for (const member of members) {
    // Load current progress (or start fresh)
    const progressKey = `itemized_progress:${member.bioguideId}`;
    const progress = await loadProgress(env, progressKey, member);

    if (progress.complete) continue; // Skip completed members

    // Fetch next batch (500 transactions)
    const transactions = await fetchFEC(member.committeeId, progress.lastCursor);

    if (transactions.length === 0) {
      // Complete! Calculate final metrics
      await finalizeAnalysis(env, member, progress);
      await env.MEMBER_DATA.delete(progressKey); // Cleanup temp data
      continue;
    }

    // Update aggregates IN-MEMORY
    updateAggregates(progress, transactions);

    // Save updated progress (NOT raw transactions)
    await env.MEMBER_DATA.put(progressKey, JSON.stringify(progress));
  }
}
```

### Update Aggregates (In-Memory)

```javascript
function updateAggregates(progress, transactions) {
  // Convert to Map for efficient updates
  const donorTotals = new Map(Object.entries(progress.donorTotals || {}));

  for (const tx of transactions) {
    // Skip memo entries (double-counting prevention)
    if (tx.memoed_subtotal === true) continue;

    // Composite deduplication key
    const firstName = (tx.contributor_first_name || '').toUpperCase().trim();
    const lastName = (tx.contributor_last_name || '').toUpperCase().trim();
    const state = (tx.contributor_state || '').toUpperCase().trim();
    const zip = (tx.contributor_zip || '').trim();
    const key = `${firstName}|${lastName}|${state}|${zip}`;

    // Aggregate by donor
    const currentTotal = donorTotals.get(key) || 0;
    donorTotals.set(key, currentTotal + tx.contribution_receipt_amount);

    // Track all amounts for median calculation
    progress.allAmounts.push(tx.contribution_receipt_amount);

    // Running totals
    progress.totalTransactions++;
    progress.totalAmount += tx.contribution_receipt_amount;
  }

  // Convert back to object for JSON storage
  progress.donorTotals = Object.fromEntries(donorTotals);
}
```

### Finalize Analysis

```javascript
async function finalizeAnalysis(env, member, progress) {
  const donorAmounts = Object.values(progress.donorTotals);

  // Sort for top-N and concentration
  const sortedDonors = Object.entries(progress.donorTotals)
    .map(([key, amount]) => {
      const [first, last, state, zip] = key.split('|');
      return { key, amount, first, last, state, zip };
    })
    .sort((a, b) => b.amount - a.amount);

  const top10 = sortedDonors.slice(0, 10);
  const top10Total = top10.reduce((sum, d) => sum + d.amount, 0);

  // Calculate median (sort amounts in-place)
  progress.allAmounts.sort((a, b) => a - b);
  const mid = Math.floor(progress.allAmounts.length / 2);
  const median = progress.allAmounts.length % 2 === 0
    ? (progress.allAmounts[mid - 1] + progress.allAmounts[mid]) / 2
    : progress.allAmounts[mid];

  const analysis = {
    bioguideId: member.bioguideId,
    cycle: 2026,
    uniqueDonors: sortedDonors.length,
    totalTransactions: progress.totalTransactions,
    totalAmount: progress.totalAmount,
    avgDonation: progress.totalAmount / progress.totalTransactions,
    medianDonation: median,
    top10Concentration: top10Total / progress.totalAmount,
    topDonors: top10.map(d => ({
      name: `${d.first} ${d.last}`,
      state: d.state,
      total: d.amount
    })),
    committeeId: member.committeeId,
    collectionCompletedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };

  // Store final analysis (2 KB)
  const analysisKey = `itemized_analysis:${member.bioguideId}`;
  await env.MEMBER_DATA.put(analysisKey, JSON.stringify(analysis));

  console.log(`✅ ${member.bioguideId} complete: ${analysis.uniqueDonors} unique donors`);
}
```

## Storage Math Verification

### During Collection Phase

**Worst case:** All 535 members collecting simultaneously

```
Per member progress key: ~1 MB
Total: 535 × 1 MB = 535 MB
Free tier limit: 1024 MB (1 GB)
Safety margin: 489 MB (48%) ✅
```

### After Collection Complete

**All 535 members analyzed:**

```
Per member analysis key: ~2 KB
Total: 535 × 2 KB = 1070 KB ≈ 1 MB
Free tier limit: 1024 MB (1 GB)
Safety margin: 1023 MB (99.9%) ✅
```

### With Two-Cycle Retention

**Current cycle (2026) + Previous cycle (2024):**

```
Analysis for 2026: 535 × 2 KB = 1 MB
Analysis for 2024: 535 × 2 KB = 1 MB
Total: 2 MB
Free tier limit: 1024 MB (1 GB)
Safety margin: 1022 MB (99.8%) ✅
```

## Write Operation Limits

### Cloudflare KV Free Tier
- **Writes per day:** 1,000
- **Reads per day:** 10,000,000

### Collection Phase Write Requirements

**Per member:**
- Bernie: 37,612 transactions ÷ 500 per batch = 76 progress updates
- Pelosi: 19,659 transactions ÷ 500 per batch = 40 progress updates
- Average: ~58 progress updates + 1 final analysis = 59 writes

**All 535 members:**
- Total writes: 535 × 59 = **31,565 writes**
- Free tier limit: 1,000 writes/day
- **Time required: 32 days** (at max write rate)

**With parallel collection (reasonable pacing):**
- 10 members per day: 590 writes/day ✅ (under 1K limit)
- Completion time: 535 ÷ 10 = **54 days**

**This is acceptable for initial collection.** Subsequent updates only refresh changed members.

## Migration Path from Prototype

### Step 1: Code Refactor
- Remove transaction chunk storage (lines 355-357 in itemized-prototype.js)
- Refactor to aggregate storage structure
- Add finalization logic for metrics calculation
- Add progress cleanup after completion

### Step 2: Deploy and Test
- Deploy updated worker
- Test on Bernie + Pelosi again to validate
- Verify storage stays under 2 MB for both

### Step 3: Expand Coverage
- Add all 535 members to processing list
- Pace at 10 members/day to stay under write limits
- Monitor KV storage usage

### Step 4: Integration
- Once all members collected, integrate into tier calculation
- Build dashboard/API endpoints for concentration data
- Implement cycle rollover (keep current + previous)

## Trade-Offs

### What We Lose
- ❌ Cannot re-query raw transaction history
- ❌ Cannot change deduplication logic without re-collecting
- ❌ Cannot drill down into specific donations after collection

### What We Keep
- ✅ All necessary concentration metrics (unique donors, top-10%, Gini, etc.)
- ✅ Fits entirely in free tier (535 MB → 1 MB)
- ✅ Can re-collect fresh data anytime by deleting analysis keys
- ✅ Proven deduplication logic from Bernie/Pelosi test

### Why This Trade-Off Makes Sense

**The raw transaction data is not the product.** The concentration metrics are the product. Once we've proven the deduplication logic works (Bernie + Pelosi test did this), we don't need to keep 15 GB of transaction history. If we need to change the logic later, we re-collect (API is free, just takes time).

## Future Enhancements

### Phase 1: Advanced Metrics (After Refactor)
- Gini coefficient calculation
- Herfindahl-Hirschman Index
- Lorenz curve data points
- Donor decile breakdowns

### Phase 2: Cycle Management
- Automatic cycle detection (2026 → 2028 rollover)
- Keep current + previous cycle only
- Delete old cycle data (2 MB → 2 MB stays constant)

### Phase 3: Incremental Updates
- For members with new transactions, update only delta
- Avoid re-collecting entire history
- Smart invalidation of stale analysis

## References

- **Original Issue:** GitHub Issue #20
- **Prototype Code:** `workers/itemized-prototype.js`
- **Bug Fixes:** `CRITICAL_BUG_FIX_2026-01-07.md`
- **Full Analysis:** `DONOR_CONCENTRATION_ANALYSIS.md`
- **Test Results:** Bernie Sanders (13,102 donors, 2.2% concentration), Nancy Pelosi (2,597 donors, 7.7% concentration)

---

**Status:** Ready for implementation
**Estimated Effort:** 1-2 days refactor + 54 days initial collection
**Risk:** Low (proven logic, just storage optimization)
**Blocker Resolution:** Unblocks Issue #20 production scaling
