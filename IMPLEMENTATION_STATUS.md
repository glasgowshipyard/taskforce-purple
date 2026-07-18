# Task Force Purple - Implementation Status

**Last Updated**: 2026-07-12

---

## Current System Status

1. **Data Pipeline** (taskforce-purple-api)
   - Smart batch processing every 20 minutes
   - Daily Congress member sync (adds new/removes departed members)
   - Dynamic trust anchor tier calculations (see `GRASSROOTS_CALCULATION_GUIDE.md`)
   - Tier math extracted to `workers/tier-calculation.js` with unit tests (`npm test`)
   - ~112 members stranded at `totalRaised: 0` are being backfilled after the
     July 2026 silent-skip fix (see below); expect N/A count to fall to just
     the true non-filers (delegates) over a few days of cron runs

2. **Itemized Donor Concentration Analysis** (itemized-analysis)
   - Queue-based processing, 1 member per 20-minute cron run
   - 502/537 complete as of 2026-07-12; the remaining ~35 cycle in the queue
     (mostly members without FEC committees yet)
   - Known gap: D1 `collection_metadata` has only 89 rows vs 502 KV analyses —
     D1 write errors are caught and logged but not retried

3. **Frontend** (taskforce-purple.pages.dev / taskforcepurple.com)
   - Tier display for all 537 members; member cards show donor concentration
     (Nakamoto stat + badge) and bundled-donation conduits where data exists
   - Auto-deploys on push to main — verified working again 2026-07-13 after
     six months of silent build failures (see dated entry below); check
     `npx wrangler pages deployment list --project-name=taskforce-purple`
     after frontend pushes

---

## Recent Major Updates

### 2026-07-18: Cross-Cycle Financial Corruption (post-mortem)

**Status**: ✅ FIXED, REPAIRED, VERIFIED (pipeline 13d4b0ae)

**Symptom**: 9 members at tier S with individualFundingPercent over 100%
(Cramer 170%, Gallego 747%) — the S showcase was populated by the most
corrupted records on the site.

**Causal chain** (three contributing failures, months apart):

1. **Latent** (January): `updateMemberWithPhase1Data` wrote
   totalRaised/grassroots/PAC from fresh financials but never wrote
   `largeDonorDonations`. Other write paths populated it, so records
   stayed accidentally consistent — as long as nothing ever refreshed.
2. **Trigger** (2026-07-17): the financial-staleness refresh re-fetched
   2024-class senators for cycle 2026 → fresh small totals + retained
   huge 2024 itemized = arithmetically impossible records.
3. **Mask** (July hardening): the penalty cap + score floor converted
   impossible inputs (IFP 210–787 pre-cap) into plausible-looking S
   tiers instead of failing loudly. Fixing symptoms (negative scores)
   without an input invariant hid the next corruption class.

**Fixes**: Phase 1 writer now always writes `largeDonorDonations` from
the fetch (null if absent, never cross-cycle carryover);
tier-calculation gained a sanity guard — individual funding exceeding
totalRaised is impossible, so such records refuse enhanced scoring and
fall back to grassroots-only with an `inconsistent-financials` detail
flag (unit-tested with the literal Cramer numbers). The 15 corrupted
members were re-fetched through the fixed path.

**Verified after repair + recalc**: 0 impossible records, 0 members over
100%. Cramer: S/170% → **D/39%** on real 2026 numbers. S tier now: AOC,
Warren, Ossoff, Kelly, Vindman, Sanders.

**Lesson recorded**: every "impossible" state deserves an invariant
check that fails loudly, not a clamp that makes it presentable. Related
open design question: the Nakamoto <50 absolute rule fires before the
density rule, giving small-state members with proportionally wide donor
bases (Cramer: 49 of 403 = 12%) the harshest anchor — owner's call
whether to reorder.

---

### 2026-07-17: FARA Cross-Reference + Donor Network Quicklook (issues #34, #33)

**Status**: ✅ DEPLOYED (itemized 9125ac90, pipeline c373a5fa, frontend)

**FARA (first slice)**: donations from employees of DOJ-registered
foreign-agent firms, matched by donor-reported employer.

- `fara_registrants` (D1): 533 active registrants from
  `efile.fara.gov/api/v1/Registrants/json/Active` (the only working
  endpoint — DOJ's ShortFormRegistrants and ForeignPrincipals endpoints
  404 in every format; individual-agent matching and foreign-principal
  attribution get added when DOJ fixes them)
- `fara_employer_matches` (D1): 225 exact contributor_employer strings
  mapped to registrants via precision-first normalized matching (built
  locally; refresh by re-running the match when registrants update)
- Itemized worker computes `faraFirms`/`faraEmployerTotal` per member at
  collection completion; pipeline merges to members:all; the 29 analyses
  fresh at deploy time were backfilled directly (one-time, 29 KV writes)
- Top findings at deploy: Pappas $82k/18 firms, Husted $62.5k/19,
  Moody $62k/17 — bipartisan by construction

**Presentation (the "make shady legible" pass)**:

- `src/lib/donor-taxonomy.js` (tested): display-only sector
  classification of bundlers (platform / pro-Israel lobby /
  party-machine / advocacy / industry / tribal / foreign-agent) with
  lucide icons; unknown names degrade to neutral; tier scoring still
  never touches name patterns
- Member cards: red "Foreign-agent connected money" section with DOJ
  citation + per-firm FARA registration numbers; bundled-money headline
  ("$X — Y% — didn't arrive on its own"); sector icons/labels on conduits
- Tier list rows: quicklook icons for flag-worthy networks without
  opening the card

---

### 2026-07-14: Analysis Refresh Policy + sub_id Storage (ROADMAP Phase A)

**Status**: ✅ DEPLOYED (itemized worker b52c9f79); D1 migration applied

- **Refresh policy**: when the itemized queue drains, it rebuilds itself
  from members whose analysis is missing or **>30 days old** (oldest
  first; requires `committeeInfo.id`). Staleness scans are throttled to
  one per 6h when everything is fresh. A stale analysis keeps serving
  tiers until its replacement lands (atomic swap at completion).
- **Delete-before-recollect**: a fresh collection first clears the
  member's `itemized_transactions` + `donor_aggregates` rows — makes
  re-collection idempotent and heals the 28 January-duplicated members
  as they come up for refresh.
- **Cron runs take 20 pages** (15-minute scheduled-run limit), HTTP
  `/analyze` keeps 5 (30s limit). Full-Congress pass: ~2 weeks.
- **Itemized failures get a 3-try budget** (were cycling forever, which
  would have blocked queue drain and thus rebuild).
- **`sub_id`** (FEC unique transaction id) now stored with a unique
  index; inserts are INSERT OR IGNORE. Enables incremental top-ups later.
- `/status` reports real counts (was hardcoded 537 + fake examples).

**Budget note**: at maximum sustained throughput, 20-page runs could
exceed D1's nominal 100k rows-written/day (index writes multiply row
counts). Empirically this has not been enforced as a hard block (the
2026-07-12 backfill wrote 705k rows in a day), D1 writes are non-fatal
to collection, and delete-before-recollect makes any gap self-healing on
the next refresh pass. Watch `wrangler d1 info` during the first full
pass; drop `PAGES_PER_RUN_CRON` if write errors appear in logs.

**Verified live**: honest `/status` (536 members / 499 analyses / real
queue), 5-page HTTP run processed the queue head under the new code,
`sub_id` landing in D1 (250 rows, 250 distinct). Expected trajectory:
current queue drains, first rebuild enqueues ~500 stale analyses, full
conduit coverage arrives over ~2 weeks.

---

### 2026-07-13 (functional check): Three More Intermittent-Failure Fixes

**Status**: ✅ DEPLOYED (pipeline d39ff7b1, itemized 592f831c); stale
mapping cache fully purged (18 keys, owner-approved)

Found while verifying the backfill end-to-end (worker log tails):

1. **NTP time-fetching removed**: `getCurrentYear()` queried up to 4
   external time APIs per call under the false belief that Workers' `Date`
   is broken (it only freezes within synchronous execution). When all four
   flaked — regularly — the entire financial lookup threw and the member
   deferred. Now just `new Date().getFullYear()`. Also saves ~8
   subrequests + up to 8s per lookup.
2. **`/totals/by_entity/` fallback fabricated $0**: that endpoint ignores
   `candidate_id` and returns marketwide aggregate rows with no `receipts`
   field; `.receipts || 0` turned that into a $0 "success" that overwrote
   members with zeros. Now requires candidate-level fields or fails
   properly (null → retry budget).
3. **Itemized worker had its own wrong-twin bug**: it re-searched
   candidates by last name and took the first result. Now it uses the
   `committeeInfo.id` Phase 1 already discovered (search + incumbent sort
   as fallback only).

**Verified live**: Perry, Scott $4.4M → tier E; Durbin $80k → tier F
(both N/A since Oct 2025). N/A count 111 → 96 in ~16 hours and falling.

**Known wrinkle**: members mid-collection at deploy time (J000294) resume
with a pagination cursor from the filtered fetch, so their conduit data
will be partial until re-collected under a future refresh policy.

---

### 2026-07-13 (later): Wrong-Candidate FEC Matching — the Real N/A Root Cause

**Status**: ✅ FIX DEPLOYED (pipeline d9b62a39); cache purge partially done

The Phase 1 backfill was "processing" members but writing zeros. Worker
logs revealed why: `fec_mapping_H001089` mapped Josh Hawley to
**S4MO00045 — James Gregory Hawley, a 1993 perennial candidate** (committee
cycles: 1994, 1996). Two stacked bugs:

1. Candidate matching relied on `office_sought`, which is always null in
   the FEC search response, so it always fell through to committee-type
   matching, where same-name candidates win by list order
2. The wrong candidate's $0 totals count as "found data": zeros were
   written, the member left the queue as processed, and the wrong mapping
   stayed **cached** in `fec_mapping_{bioguideId}` — so every retry
   repeated the mistake

**Fix**: sort FEC search results to prefer `incumbent_challenge === 'I'`
(we only ever look up sitting members). Verified end-to-end: after
clearing his cached mapping, Hawley resolves with $1,518,950.76 raised
(matches direct FEC query), tier F, after 9 months of N/A.

**Resolved 2026-07-13**: all remaining stale mappings (18 keys) purged with
owner approval; fresh lookups re-search through the incumbent-preferring
matcher and cache correct candidates.

---

### 2026-07-13: Pages Builds Silently Broken Since January — Fixed

**Status**: ✅ FIXED

Every Cloudflare Pages production build since commit c198808 (mid-January)
had **failed**: `npm ci` on the build image rejected a package-lock.json
that was out of sync with package.json. The live site served a stale
January bundle for ~6 months; nobody noticed because member data comes from
the API at runtime. Discovered while verifying the donor-concentration card
deploy. Fix: regenerated the lock file (verified `npm ci` passes clean).

Also corrected: docs pointed to `taskforcepurple.pages.dev`, which does not
exist (NXDOMAIN) — the real domains are **taskforce-purple.pages.dev** and
**taskforcepurple.com** (live, not "coming soon" as README claimed).

**Lesson recorded**: "auto-deploys on push" is only true when builds pass —
check `npx wrangler pages deployment list --project-name=taskforce-purple`
after frontend pushes.

---

### 2026-07-12 (evening): Conduit/Earmark Network Attribution (issue #33, first slice)

**Status**: ✅ DEPLOYED (itemized worker 4f4b2171, pipeline e4e46bec)

**What it does**: captures which networks bundle a member's individual money.
FEC earmark mechanics (verified empirically): donors appear as normal
individual rows marked "EARMARKED CONTRIBUTION" with NULL conduit fields; the
conduit's identity arrives as a separate MEMO row (entity PAC/ORG, line 11AI)
naming it, with the attributed total. We previously skipped all memo rows —
correct for money totals, but it discarded the network's name.

**Changes**:

- `workers/schedule-a-classify.js` (new, unit-tested): pure row classifier —
  invalid / conduit-memo / memo / committee / individual-earmarked / individual
- Itemized worker: dropped `contributor_type=individual` from the Schedule A
  fetch (that filter excluded the PAC-entity memo rows naming conduits);
  classifier now separates rows. Aggregates `conduitTotals` (by normalized
  name) and `earmarkedTotal` during collection; analysis output gains
  `conduits` (top 10), `earmarkedTotal`, `earmarkedCount`
- Row-count validation now compares FEC's pagination count against all rows
  seen (`rawRowCount`), since the unfiltered fetch includes memo/committee rows
- Pipeline merge: `topConduits` + `earmarkedIndividualTotal` flow into
  members:all (and thus the API) for analyses that have them
- Money totals unchanged: conduit lumps stay excluded from donor/amount math

**Validation** (live FEC data, one member committee, 800 rows): ActBlue
$63,304/365 lumps; American Israel Public Affairs Committee PAC $25,700/27
lumps; JStreetPAC $250/1 — generically-named and fully-named networks caught
by the same machinery.

**Coverage note**: only analyses collected from now on carry conduit data —
the 497 existing snapshots predate it. Full coverage arrives with the
analysis refresh policy (known limitation #1) or targeted re-collection.

---

### 2026-07-12 (later): D1 Mirror Fixed and Backfilled

**Status**: ✅ FIXED, DEPLOYED, BACKFILLED

**Root cause**: the `donor_aggregates` INSERT in `itemized-analysis.js`
packed 100 rows × 8 bound params = 800 parameters into one statement, over
D1's per-statement limit. Any member with more than ~12 donors threw on the
first chunk, and the shared try/catch silently skipped the
`collection_metadata` write too. Evidence: all 89 pre-fix metadata rows
belonged to members with 0 donors (85) or ≤12 (4); writes ceased entirely
after March 2026 once completions had real donor bases.

**Fix (deployed, worker version da4074f9)**: aggregates now use the D1 batch
API (100 single-row statements per batch, same pattern as the transactions
insert), and the metadata write has its own try/catch so an aggregates
failure can never block the completion record.

**Backfill (one-time, 2026-07-12)**:

- `donor_aggregates` rebuilt from `itemized_transactions` via GROUP BY using
  the worker's donor-key semantics: 326,136 rows across 425 members (8s)
- `collection_metadata` backfilled from the 497 KV analyses via
  `wrangler kv bulk get` (100-key chunks) → 499 total rows
- Validation against KV found 28 members whose raw transactions are inflated
  (January collection restarts re-wrote pages; no dedup key stored). Their
  52,126 aggregate rows were deleted — no row beats a wrong row. Final state:
  **397 members with verified aggregates (274,010 rows), 499 metadata rows**
- Spot-check: A000148 matches KV exactly (740 donors, $1,477,988)

---

### 2026-07-12: Tier Calculation Hardening + Phase 1 Silent-Skip Fix

**Status**: ✅ DEPLOYED

**Tier math** (was producing negative scores for 292 members; 330/537 in tier F):

- Extracted all tier math into `workers/tier-calculation.js` (pure functions,
  24 unit tests including the documented Bernie/Pelosi reference cases)
- Itemization penalty capped at 40 points (was unbounded, observed up to 390)
- `individualFundingPercent` floored at 0 (was as low as -167% in the API)
- Reliability check on concentration snapshots: <10 unique donors or <50%
  coverage of reported itemized total → neutral 40% anchor instead of the
  harshest 10% anchor (zero-donor snapshots previously read as maximum risk)
- Election-cycle math unified in one place; data-pipeline previously mapped
  odd years DOWN (2025→2024) while itemized-analysis mapped UP (2025→2026).
  FEC names cycles by the even end-year, so up is correct.
- Simulated impact across live data: tier F 330→227, negative scores 292→0,
  115 members move up, none down, reference cases unchanged

**Phase 1 silent skip** (root cause of issue #29's 112 N/A members):

- `fetchMemberFinancials` returning null previously overwrote the member with
  zeros and dequeued them as processed. Now: defer to end of queue with a
  3-attempt budget, then mark `fecLookupExhausted` (retried after 90 days)
- `initializeProcessingQueues` re-queues `totalRaised: 0` members when the
  Phase 1 queue is empty (previously early-returned because the empty queue
  key existed, stranding them forever)
- Thrown Phase 1 errors defer-and-persist so a permanently failing member
  can't stall the queue head; rate-limit errors still retry the same member

**Also fixed**: frontend truthiness bugs hiding 0% scores and rendering
negative ones; D1 reconciliation field-name mismatch (`fecItemizedTotal` /
`percentDiff` vs the actual `fecReportedTotal` / `percentDifference`) that
left those columns always null; README tier thresholds synced with code;
`npm test` now runs vitest instead of a no-op echo.

---

### 2026-01-16: Dynamic Trust Anchor System

**Status**: ✅ DEPLOYED AND WORKING

**What Changed**:

- Fixed critical denominator bug in itemized percentage calculation
- Changed from `largeDonorDonations / totalRaised` to `largeDonorDonations / (grassrootsDonations + largeDonorDonations)`
- This isolates the "human element" - of the people who gave, how reliant are you on big checks?

**Impact**:

- Bernie Sanders: 20% itemized (S-tier maintained)
- Nancy Pelosi: 35% itemized (drops to A-tier with 5% penalty)
- Correctly differentiates movement-scale funding from elite capture risk

**Files Modified**:

- `workers/data-pipeline.js` - calculateEnhancedTier() function
- `README.md` - Updated with real examples
- `DONOR_CONCENTRATION_ANALYSIS.md` - Technical documentation
- `src/App.jsx` - Frontend explanation with generic examples

### 2026-01-17: Automatic Congress Member Sync

**Status**: ✅ DEPLOYED

**What It Does**:

- Runs once per day (24-hour check in scheduled() function)
- Fetches current members from Congress.gov (2-3 API calls)
- Adds new members to dataset with empty financial data
- Removes departed members from dataset, queues, and KV storage
- Sanity check: aborts if < 400 members returned

**Impact**:

- No manual intervention needed for member list changes
- 3 departed members will be removed on first run
- Future Congress changes handled automatically

**Files Modified**:

- `workers/data-pipeline.js` - Added syncCongressMembers() and removeFromQueue()

### 2026-01-17: Itemized Analysis Scaling

**Status**: ✅ DEPLOYED (code changes)

**What Changed**:

- Replaced hardcoded Bernie/Pelosi with queue-based processing
- Updated worker to process from itemized_processing_queue
- Dynamic member lookup from members:all dataset
- Auto-removes completed members from queue

**Files Modified**:

- `workers/itemized-analysis.js` - Queue processing logic

---

### 2026-01-23: System Verification and Gap Resolution

**Status**: ✅ COMPLETED

**What Was Found**:

System verification revealed gaps between Jan 17 status report claims and actual deployed state:

1. **itemized_processing_queue** did not exist in KV storage
   - Code to process queue existed but queue was never initialized
   - Worker immediately returned "No processing queue found"
   - Only 2 members processed (Bernie & Pelosi from proof-of-concept phase)

2. **Nakamoto data not exposed in API**
   - Data existed in separate `itemized_analysis_v2:*` KV keys
   - Used internally for tier calculations but not visible to frontend
   - `/api/members` showed `nakamotoCoefficient: null` for all members

3. **Worker UI contained stale POC references**
   - Homepage still said "Sanders + Pelosi" and "every 2 minutes"
   - `/status` endpoint hardcoded to only check Bernie & Pelosi
   - Console logs referenced specific bioguide IDs

**What Was Fixed**:

1. **Initialized Processing Queue** (535 members)
   - Queried all 537 current bioguide IDs from `/api/members`
   - Excluded S000033 (Bernie) and P000197 (Pelosi) - already complete
   - Created queue as JSON array and stored in KV storage
   - Result: Worker immediately began processing at 1 member/20 minutes

2. **Exposed Nakamoto Data in API**
   - Modified `handleMembers()` in `workers/data-pipeline.js`
   - Added async loading of `itemized_analysis_v2:${bioguideId}` for each member
   - Merged concentration data into API response: `nakamotoCoefficient`, `nakamotoPercent`, `uniqueDonors`, `top10Concentration`
   - Deployed updated worker - verified Bernie shows Nakamoto: 1534 (11.7%)

3. **Updated Worker UI** (removed all POC references)
   - Homepage: Changed to "queue-based processing" and "every 20 minutes"
   - Console logs: Now show queue status instead of hardcoded names
   - `/status` endpoint: Completely rewritten to show queue progress, completion ETA, and real-time stats

**Current Verified State** (as of 2026-01-23 02:35 UTC):

- **Queue**: 502 members remaining, 35 complete (6.5%)
- **Processing Rate**: ~3 members/hour (verified working correctly)
- **Next Member**: Blackburn, Marsha (B001243)
- **ETA**: 7 days (Jan 30, 2026)
- **Nakamoto Data**: Exposed in API for all 35 completed members

**Files Modified**:

- `workers/data-pipeline.js` - handleMembers() function (lines 1740-1769)
- `workers/itemized-analysis.js` - Homepage text, scheduled() logs, getStatus() function
- `IMPLEMENTATION_STATUS.md` - This update

**KV Operations**:

- Created `itemized_processing_queue` with 535 member bioguide IDs

---

### 2026-02-21: Itemized Queue Stall Bug Fix

**Status**: ✅ FIXED AND DEPLOYED

**Bug Description**:

Itemized analysis processed only 10 members in 29 days (Jan 23 → Feb 21) despite the cron running every 20 minutes. Investigation revealed Perry, Scott (P000605) was permanently stuck at position 0 of the queue with error "No principal committee found". Every cron run hit Perry, failed, and left him in place — the queue never advanced.

**Root Cause**:

Two compounding issues:

1. The Jan 23 queue initialization added all 535 members indiscriminately, including ~115 members with `totalRaised: 0` who had been added by the Congress sync but not yet processed by the data pipeline's Phase 1 (so they have no FEC committee ID).

2. The error path in `analyzeMembers()` (lines 196–207) caught the error and recorded it, but the queue update logic (lines 220–232) only removed a member if `itemized_analysis_v2:{bioguideId}` existed after the run. Failed members were left at position 0 indefinitely.

**Fix**:

Changed queue update logic in `analyzeMembers()` in `workers/itemized-analysis.js` to distinguish three outcomes:

- **Complete** (`analysisData` exists): remove from front of queue
- **Failed** (`results[bioguideId].success === false`): defer to end of queue so others can proceed
- **In progress** (multi-run member, no result yet): keep at front

Members with no FEC committee (still awaiting Phase 1 data) will now cycle to the back and be retried automatically once the data pipeline has caught up to them.

**Current State** (as of 2026-02-21):

- 45/538 members complete (8.4%)
- 494 members in queue
- Fix deployed — queue now draining

**Files Modified**:

- `workers/itemized-analysis.js` — queue update logic in `analyzeMembers()` (lines 220–235)

---

### 2026-01-23: nakamotoCoefficient Bug Fix

**Status**: ✅ FIXED AND DEPLOYED

**Bug Description**:

API was showing only 32 of 35 completed members with Nakamoto data. Investigation revealed:

- **Affected members**: B001236 (Boozman), D000563 (Durbin), H001089 (Hawley)
- **Root cause**: Used `||` operator for nullish coalescing in `workers/data-pipeline.js` line 1769
- **Impact**: Members with `nakamotoCoefficient: 0` (valid data for zero itemized donations) were converted to `null`

**Technical Details**:

```javascript
// BEFORE (broken):
nakamotoCoefficient: concentrationData?.nakamotoCoefficient || null,

// AFTER (fixed):
nakamotoCoefficient: concentrationData?.nakamotoCoefficient ?? null,
```

The `||` operator treats `0` as falsy and returns `null`. The `??` (nullish coalescing) operator only returns `null` for `null`/`undefined`, preserving `0` as valid.

**What Was Fixed**:

- Changed three fields in `workers/data-pipeline.js` lines 1769, 1778, 1779:
  - `nakamotoCoefficient`: Now uses `??` instead of `||`
  - `uniqueDonors`: Same fix applied
  - `top10Concentration`: Same fix applied

**Verification**:

- Before: 32 members showing Nakamoto data in API
- After: 35 members showing Nakamoto data in API (matches KV count)
- Affected members now correctly show `nakamotoCoefficient: 0` instead of `null`

**Files Modified**:

- `workers/data-pipeline.js` - Lines 1769, 1778, 1779
- Deployed successfully at 2026-01-23 03:00 UTC

---

## Active Processing Queues

### Priority Queue (Missing largeDonorDonations)

- **Status**: ✅ COMPLETED
- **Members**: 0 remaining (all members have financial data)
- **Purpose**: Backfilled missing largeDonorDonations field for accurate tier calculation

### Itemized Processing Queue

- **Status**: ✅ Processing automatically
- **Members**: 502 remaining (35 complete as of 2026-01-23 02:35 UTC)
- **Rate**: ~3 members per hour (1 member every 20 minutes)
- **Progress**: 6.5% complete (35/537 members analyzed)
- **Completion**: ~7 days (estimated Jan 30, 2026)
- **Purpose**: Collect donor concentration data (Nakamoto coefficients) for all members
- **Next**: Blackburn, Marsha (B001243)

---

## Architecture Overview

### Data Pipeline Flow

```
Congress.gov API (daily sync)
    ↓
members:all dataset (540 members in KV)
    ↓
Smart Batch Processing (every 15 minutes)
    ├── Priority Queue → Fix missing largeDonorDonations
    ├── Phase 1 → Fetch financial data (grassroots, total raised)
    └── Phase 2 → Enhance with PAC details and metadata
    ↓
Tier Calculation
    ├── Base calculation (grassroots %)
    ├── Dynamic trust anchor (if concentration data available)
    └── Enhanced PAC weighting (if metadata available)
    ↓
Frontend Display (tier list)
```

### Itemized Analysis Flow

```
FEC API (Schedule A itemized contributions)
    ↓
Stream-and-Aggregate (no raw storage)
    ├── Donor deduplication (first|last|state|zip)
    ├── Amount aggregation per donor
    └── Progress tracking in KV
    ↓
Final Analysis
    ├── Unique donor count
    ├── Nakamoto coefficient (donors to control 50%)
    ├── Nakamoto % (coordination risk metric)
    └── Top-10 concentration
    ↓
Dynamic Trust Anchor Application
    └── Sliding itemization threshold (10-50%)
```

---

## Free Tier Compliance (recalculated 2026-07-12)

Both crons run every 20 minutes = 72 runs/day per worker.

### Cloudflare KV — the binding constraint (1,000 writes/day)

- data-pipeline per run: processing status + queue + members:all + tier
  recalc ≈ 4-5 writes → ~290-360/day
- itemized worker per run: progress + queue = 2 writes → ~144/day
  (+2 on a completion: analysis write + progress delete)
- **Total ≈ 450-550/day ≈ 50-55% of budget** ✅
- The July 2026 queue fixes add ~1 write per failure-defer (replaces a
  formerly skipped write) and one queue rebuild per drain cycle — noise
- KV reads: tier recalculation after each batch reads per-member
  concentration keys (~537 × 72 runs ≈ 39k/day, pre-existing);
  `/api/members` costs 3 reads per request (merged at write time,
  2026-07-12) → ~20k requests/day ceiling on the 100k read budget ✅

### Cloudflare D1

- Steady state: transaction inserts only while actively collecting
  (≤36k raw rows/day at full throughput; observed average ~7k/day),
  aggregates+metadata only on member completion. Well under 100k rows/day ✅
- **2026-07-12 one-time backfill spiked usage** (~705k rows written /
  13.6M read in 24h) — deliberate, not recurring; back to baseline next day

### External fetches per invocation (50 limit)

- data-pipeline ≤15 FEC calls; itemized ≤7 (5 pages + search + reconcile) ✅
- KV/D1 operations count against the separate 1,000 internal-ops limit;
  worst case (huge-member completion: ~130 D1 batch calls + KV ops) ≈ 15% ✅

### API rate limits

- FEC (1,000/hr): both workers combined ~66/hr ≈ 7% ✅
- Congress.gov (5,000/hr): 2-3 calls/day (daily sync) ✅

---

## Known Issues & Limitations

### Non-Issues (Previously Reported, Now Resolved)

1. **Phase 2 PAC Enhancement**: Working correctly, processes members incrementally
2. **Tier Calculation**: Enhanced algorithm working with dynamic trust anchor
3. **Bernie/Pelosi Missing**: Added to dataset, concentration analysis complete

### Actual Limitations

1. **Itemized analysis freshness**: snapshots are collected once and never
   refreshed within a cycle. Early-cycle collections understate donor counts.
   The July 2026 reliability check stops junk snapshots from distorting tiers,
   but a periodic re-analysis policy is still an open TODO.
2. **Raw `itemized_transactions` are duplicated for 28 early-collection
   members** (incl. Sanders, Pelosi): January 2026 collection restarts
   re-wrote pages and the table has no dedup key (FEC transaction IDs were
   not stored). Their `donor_aggregates` rows were deliberately deleted —
   KV analyses remain authoritative for them. Fix requires storing the FEC
   `sub_id` per transaction and re-collecting. (The broader D1 mirror
   failure was fixed and backfilled 2026-07-12, see below.)
3. ~~`/api/members` performs ~537 KV reads per request~~ **Resolved
   2026-07-12**: concentration metrics are merged into `members:all` by
   `performTierRecalculation` (runs after every cron batch), so the endpoint
   costs 3 KV reads and sends `Cache-Control: public, max-age=300`. Edge
   caching would additionally require a custom domain (Cache API is inert on
   workers.dev). N/A members merge automatically once Phase 1 gives them
   financial data.

---

## Deployment Information

### Active Workers

1. **taskforce-purple-api** (data-pipeline.js)
   - URL: https://taskforce-purple-api.dev-a4b.workers.dev
   - Version: b1ed848c (2026-01-17)
   - Cron: _/20 _ \* \* \* (every 20 minutes)

2. **taskforce-purple-itemized-analysis** (itemized-analysis.js)
   - URL: https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev
   - Version: 5e9c05e2 (2026-01-17)
   - Cron: _/20 _ \* \* \* (every 20 minutes)

3. **taskforce-purple (frontend)**
   - URL: https://taskforce-purple.pages.dev
   - Deployment: Automatic via GitHub integration

### Environment Variables

Required secrets (set via `wrangler secret put`):

- `CONGRESS_API_KEY`: Congress.gov API key
- `FEC_API_KEY`: OpenFEC API key
- `UPDATE_SECRET`: Authorization for manual API endpoints

---

## Future Enhancements (Not Scheduled)

### Potential Improvements

1. **Increase itemized processing speed**
   - Current: 1 member per 20 minutes
   - Possible: Process 2-3 members per run (requires paid KV tier)
   - Benefit: Reduce 7 days to ~2-3 days (if budget allows)

2. **Real-time voting data integration**
   - Add bipartisan overlap tracker with actual votes
   - Currently just tier rankings based on funding

3. **Historical trend analysis**
   - Track tier changes over multiple election cycles
   - Show funding pattern evolution

4. **State/district filtering**
   - Allow users to filter by geography
   - "Show me my representatives"

---

## Maintenance

### Regular Monitoring

- Check worker logs for errors: `wrangler tail taskforce-purple-api`
- Monitor queue progress: `wrangler kv key get "priority_missing_queue" --namespace-id=... --remote`
- Verify frontend updates: Check https://taskforce-purple.pages.dev

### Expected Behavior

- Priority queue: ✅ Completed (all members have financial data)
- Congress sync: ✅ Ran successfully, removed 3 departed members (537 total now)
- Itemized queue: Should decrease by ~1 member every 20 minutes (518 remaining as of 2026-01-17)

### Error Recovery

All processing is idempotent:

- Failed member updates → retry on next run
- Corrupted progress data → delete and restart from scratch
- API rate limits → worker stops gracefully, resumes next run

---

## Documentation

### Key Files

- `.CLAUDE_CONTEXT.md`: Session log and technical deep-dives
- `README.md`: Public-facing overview with examples
- `DONOR_CONCENTRATION_ANALYSIS.md`: Technical spec for concentration metrics
- `SMART_BATCHING_STRATEGY.md`: Rate limiting and queue design
- `API_STRUCTURES.md`: API endpoint documentation

### Code References

- Tier calculation: `workers/data-pipeline.js:1200-1450`
- Dynamic trust anchor: `workers/data-pipeline.js:1330-1380`
- Congress sync: `workers/data-pipeline.js:4133-4295`
- Itemized analysis: `workers/itemized-analysis.js:220-580`
- Shared constants: `workers/shared-constants.js`

---

---

## Recent Schedule Optimization (2026-01-17)

**Issue**: Hit 50% of KV daily write limit (1,000/day) at 15-minute intervals

**Solution**:

- Adjusted cron schedule from 15 minutes to 20 minutes
- Reduced daily KV writes from 1,000+ to ~790-1,010 (79-101% of limit)
- Improved timeline: 518 members × 20 min = 7 days (vs 11 days at 30-min)
- Deleted 116 orphaned transaction chunk keys from early testing

**Trade-off**: Slightly slower processing but stays within free tier limits

---

_This document reflects the current production state as of 2026-01-17 18:00 UTC. All systems operational._
