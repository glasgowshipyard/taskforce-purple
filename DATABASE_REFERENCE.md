# Task Force Purple - Database Reference

**Last Updated**: 2026-10-07

This document provides complete reference for all KV and D1 databases used in the project, including how to query them.

## At a glance (current, 2026-10-07)

**KV `MEMBER_DATA`:**

| Key                   | What it holds                                                          | Written by                                                           |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `members:list`        | The site's member list: each member's published grade and list figures | The refresh job's publish step (one write per batch, only on change) |
| `member:{bioguideId}` | Each member's stored record (name, seat, PAC list, social handles)     | Stage 1 migration; admin endpoints                                   |
| `races:list`          | The 2026 races: everyone on November's ballot, by seat                 | The races job (only on change)                                       |

Legacy keys, frozen and no longer read for grades: `members:all`,
`itemized_analysis_v2:*`, the queue keys and `fec_mapping_*`.

**D1:**

- `tfp-results` (current): results, history, the record check, fetched
  records (packed) and race candidates (section below).
- `taskforce-purple-donors` (legacy): no longer written.

**The flow:**

1. The refresh job runs in GitHub Actions (FEC bulk files plus the FEC API).
2. It writes results to D1 `tfp-results`.
3. It publishes `members:list` to KV.
4. The API worker serves the list and reads each member page's detail from
   D1.
5. The site shows them.

Free-plan limits that bind (per day, whole account):

- KV: 1,000 writes.
- D1: 5,000,000 rows read and 100,000 written.
- D1: 500 MB per database.

---

## Cloudflare KV Storage

### Namespace: MEMBER_DATA

**ID**: `8318226115e2423ab5d141adfa5419f9`

**Purpose**: Stores processed member data, queues, and analysis results.

### Key Structure

#### Core Data Keys

**`members:all`** - LEGACY: the old complete member dataset (read-only since 2026-10-03; the site no longer reads it)

```bash
# Read the full dataset
wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote

# Pretty print
wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .

# Count total members
wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'length'

# Find a specific member by bioguideId
wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(.bioguideId == "S000033")'

# List all S-tier members
wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(.tier == "S") | {name, bioguideId, grassrootsPercent}'

# Members missing largeDonorDonations
wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(.largeDonorDonations == null or .largeDonorDonations == 0) | {name, bioguideId}'
```

**Structure**:

```json
[
  {
    "bioguideId": "S000033",
    "name": "Sanders, Bernard",
    "state": "Vermont",
    "chamber": "Senate",
    "party": "Independent",
    "totalRaised": 6483214.17,
    "grassrootsDonations": 5175000,
    "grassrootsPercent": 79.82,
    "largeDonorDonations": 1308214.17,
    "tier": "S",
    "dataCycle": 2024,
    "itemizedPercent": 20.18,
    "uniqueDonors": 13102,
    "nakamotoCoefficient": 1534,
    "nakamotoPercent": 11.7,
    "trustAnchor": 39.08
  }
]
```

#### Member records (Stage 1, 2026-10-03)

**`member:{bioguideId}`**: one member's full record. It's the source of truth
for member data, written only when a field actually differs
(`workers/member-store.js`, `MemberWriter`).

**`members:list`**: the exact `/api/members` response body (about 308 KB):
list fields only, plus `quicklook` and `conduitCount`. It's served as stored
and rewritten at most once per invocation, only when a list-visible field
changes.

**`members:all`**: the old 3.5 MB all-members value. It's **read-only** since
Stage 1: kept as the rollback copy, read only as a fallback for a member with
no key of their own yet, and deleted two weeks after the migration.

```bash
# One member's record
npx wrangler kv key get "member:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '{name, tier, totalRaised}'
# The list's size and date
npx wrangler kv key get "members:list" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '{total, lastUpdated}'
```

#### Queue Keys

**Frozen since 2026-10-04.** The itemized worker that wrote these keys is
retired; nothing reads or writes them now. The refresh job keeps its
progress in D1 `tfp-results` (`member_progress`, `rounds`). They stay until
Stage 4's cleanup.

**`itemized_processing_queue`** - Queue of members needing itemized analysis

Entries are `{bioguideId, name, failCount?, lastError?, lastFailedAt?}`. The last two have been
recorded since 2026-09-27 (API key redacted; served publicly by `/health`).

**`itemized_dropped`** - The last 20 members dropped after 3 failures (`{bioguideId, name,
lastError, droppedAt}`); read by `/health`. Written only when a member is dropped.

**`itemized_unreconciled`** - The last 20 finished collections that didn't match the FEC's own counts (`{bioguideId,
failed, at}`); read by `/health`. Written only on such a completion.

**`discovery_sweep_cursor`** - The discovery sweep's position. Its KV metadata `{ranAt}` is the
itemized worker's heartbeat for `/health` (same write, no extra cost).

```bash
# Check queue status
wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'length'

# View next 10 members to be processed
wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[0:10]'

# Find specific member in queue
wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(. == "S000033")'
```

**Structure**: Array of bioguideIds

```json
["H000273", "A000148", "B000740", ...]
```

**`priority_missing_queue`** - Priority queue for members missing largeDonorDonations (DEPRECATED - completed)

```bash
# This queue should be empty/deleted after initial backfill
wrangler kv key get "priority_missing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

#### Tracking Keys

**`last_congress_sync`** - Timestamp of last Congress member sync

```bash
# Check when Congress sync last ran
wrangler kv key get "last_congress_sync" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

**`batch_progress`** - Smart batch processing state

```bash
# View current batch processing state
wrangler kv key get "batch_progress" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .
```

**`adaptive_thresholds`** - Tier calculation thresholds

```bash
# View current tier thresholds
wrangler kv key get "adaptive_thresholds" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .
```

**Structure**:

```json
{
  "s_tier_threshold": 75.0,
  "a_tier_threshold": 50.0,
  "b_tier_threshold": 30.0,
  "c_tier_threshold": 15.0,
  "lastUpdated": "2025-10-16T12:00:00Z",
  "calculationMethod": "percentile-based"
}
```

#### Per-Member Analysis Keys

**`itemized_analysis_v2:{bioguideId}`** - Itemized donor concentration analysis
(corrected 2026-07-13: this doc previously said `analysis:{bioguideId}`,
which was never the deployed key name)

```bash
# Get analysis for specific member
wrangler kv key get "itemized_analysis_v2:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .

# Count completed analyses
wrangler kv key list --prefix="itemized_analysis_v2:" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'length'
```

**Structure** (fields as of 2026-07-13; `conduits`/`earmarked*` only on
analyses collected after 2026-07-12):

```json
{
  "bioguideId": "S000033",
  "committeeId": "C00411330",
  "cycle": 2026,
  "uniqueDonors": 13102,
  "totalTransactions": 30371,
  "totalAmount": 3695847.3,
  "avgDonation": 121.69,
  "medianDonation": 50,
  "top10Concentration": 0.022,
  "whaleWeight": 0.19,
  "nakamotoCoefficient": 1534,
  "conduits": [{ "name": "ACTBLUE", "amount": 63304, "count": 365 }],
  "earmarkedTotal": 79986,
  "earmarkedCount": 348,
  "fecReconciliation": { "fecReportedTotal": 0, "percentDifference": 0 },
  "collectionCompletedAt": "2026-01-16T..."
}
```

**`itemized_progress_v2:{bioguideId}`** - In-flight collection state
(deleted on completion)

```bash
wrangler kv key get "itemized_progress_v2:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'keys'
```

**`fec_mapping_{bioguideId}`** - Cached FEC candidate match

⚠️ Trusted forever once written. A wrong match (e.g. a same-name perennial
candidate) pins the member to that candidate's finances until cleared —
see IMPLEMENTATION_STATUS 2026-07-13 entry. Clear with
`/api/clear-fec-mapping?bioguideId=X` or `wrangler kv key delete`.

```bash
# Get FEC candidate mapping for member
wrangler kv key get "fec_mapping_S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .

# List all FEC mappings
wrangler kv key list --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(.name | startswith("fec_mapping_")) | .name'
```

**Structure**:

```json
{
  "bioguideId": "S000033",
  "committeeId": "C00411330",
  "committeeName": "BERNIE 2024",
  "lastUpdated": "2026-01-17T10:00:00Z"
}
```

### Common KV Operations

**List all keys**:

```bash
wrangler kv key list --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

**List keys with prefix**:

```bash
wrangler kv key list --prefix "analysis:" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

**Put a key**:

```bash
echo '{"test": "data"}' | wrangler kv key put "test_key" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

**Delete a key**:

```bash
wrangler kv key delete "test_key" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

---

## Cloudflare D1 Database

### Database: tfp-results (the refresh job's; current)

ID `f4ad9245-769d-4bb2-b772-c552907e1692`. Schema: `scripts/refresh/schema.sql`
(and `scripts/refresh/migrations/`). Free-plan limits that apply: 500 MB per
database; 5M rows read and 100k written a day for the whole account
(RUNBOOK §6, `node scripts/verify/d1-usage.mjs`).

| Table                               | What it holds                                                                                                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `results`                           | Each member's current result per cycle: pool, analysis (donors, concentration, conduits, FARA with registered agents and foreign clients, `pacs`: every PAC gift with each PAC's own donors), grade (with `personFigures.ownMoney`), status (complete, provisional, pending) |
| `snapshots`                         | Every result that was ever current (history)                                                                                                                                                                                                                                 |
| `grade_history`                     | One row per published grade change                                                                                                                                                                                                                                           |
| `committees`                        | Each committee's check against the FEC: counts, money, status                                                                                                                                                                                                                |
| `gap_packs`                         | Records fetched from the FEC because the bulk file lacks them: full records, Brotli-packed per committee (`scripts/refresh/gap-records.mjs C00… ` unpacks one)                                                                                                               |
| `race_candidates`                   | General-election candidates who aren't sitting members, graded (2026 races)                                                                                                                                                                                                  |
| `member_progress`, `rounds`, `runs` | The record check's progress and run history                                                                                                                                                                                                                                  |
| `d1_write_budget`                   | The job's D1 rows written and read per UTC day                                                                                                                                                                                                                               |
| `fara_employer_matches`             | Employers matched to FARA-registered firms                                                                                                                                                                                                                                   |

KV keys the job writes: `members:list` (published grades, one write per
publish) and `races:list` (the 2026 races, one write per publish).

### Database: taskforce-purple-donors (legacy; no longer written since 2026-10-04)

**ID**: `87d24fba-1e43-45a0-aa84-1610e984aee8`

**Purpose**: Stores raw itemized transaction data for all congressional members.

### Schema

**Table**: `itemized_transactions`

```sql
CREATE TABLE itemized_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bioguide_id TEXT NOT NULL,
  committee_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  contributor_first_name TEXT,
  contributor_last_name TEXT,
  contributor_state TEXT,
  contributor_zip TEXT,
  contributor_employer TEXT,
  contributor_occupation TEXT,
  amount REAL NOT NULL,
  contribution_receipt_date TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX idx_bioguide_id ON itemized_transactions(bioguide_id);
CREATE INDEX idx_committee_id ON itemized_transactions(committee_id);
CREATE INDEX idx_cycle ON itemized_transactions(cycle);
CREATE INDEX idx_amount ON itemized_transactions(amount);
CREATE INDEX idx_contributor_state ON itemized_transactions(contributor_state);
```

### Common D1 Queries

**Count total transactions**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT COUNT(*) as total FROM itemized_transactions"
```

**Get all transactions for a member**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT * FROM itemized_transactions WHERE bioguide_id = 'S000033' LIMIT 10"
```

**Count transactions per member**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT bioguide_id, COUNT(*) as tx_count FROM itemized_transactions GROUP BY bioguide_id ORDER BY tx_count DESC"
```

**Total amount raised per member**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT bioguide_id, SUM(amount) as total_raised, COUNT(*) as tx_count FROM itemized_transactions GROUP BY bioguide_id ORDER BY total_raised DESC LIMIT 10"
```

**Top 10 donors for a member**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT contributor_first_name, contributor_last_name, contributor_state, SUM(amount) as total FROM itemized_transactions WHERE bioguide_id = 'S000033' GROUP BY contributor_first_name, contributor_last_name, contributor_state ORDER BY total DESC LIMIT 10"
```

**Transactions by state**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT contributor_state, COUNT(*) as count, SUM(amount) as total FROM itemized_transactions WHERE bioguide_id = 'S000033' GROUP BY contributor_state ORDER BY total DESC"
```

**Average donation by member**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT bioguide_id, AVG(amount) as avg_donation, COUNT(*) as tx_count FROM itemized_transactions GROUP BY bioguide_id ORDER BY avg_donation DESC"
```

**Recent transactions**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT * FROM itemized_transactions WHERE bioguide_id = 'S000033' ORDER BY contribution_receipt_date DESC LIMIT 10"
```

**Unique donor count per member** (deduplication by name + state + zip):

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT bioguide_id, COUNT(DISTINCT contributor_first_name || '|' || contributor_last_name || '|' || contributor_state || '|' || contributor_zip) as unique_donors FROM itemized_transactions GROUP BY bioguide_id ORDER BY unique_donors DESC"
```

**Members with data in D1**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT DISTINCT bioguide_id FROM itemized_transactions ORDER BY bioguide_id"
```

**Database size and stats**:

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT COUNT(*) as total_rows, COUNT(DISTINCT bioguide_id) as members_with_data, SUM(amount) as total_amount FROM itemized_transactions"
```

**Delete all data for a member** (use with caution):

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "DELETE FROM itemized_transactions WHERE bioguide_id = 'TEST001'"
```

**Truncate entire table** (DANGER - deletes all data):

```bash
wrangler d1 execute taskforce-purple-donors --remote --command "DELETE FROM itemized_transactions"
```

### D1 Export/Backup

**Export database to SQL**:

```bash
# Not directly supported - use wrangler d1 export (coming soon)
# For now, query and save results:
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT * FROM itemized_transactions" --json > backup.json
```

---

## Data Relationships

> **Historical:** this section describes the old pipeline (before the 2026-10 rebuild). For the current system see the summary at the top.

### How KV and D1 Work Together

1. **Raw Transaction Storage (D1)**:
   - All itemized transactions stored in `itemized_transactions` table
   - Enables complex queries (top donors, state breakdowns, etc.)
   - Persistent storage for historical analysis

2. **Aggregated Analysis (KV)**:
   - `analysis:{bioguideId}` stores pre-calculated metrics from D1 data
   - Used by tier calculation algorithm
   - Faster access than re-querying D1

3. **Member Dataset (KV)**:
   - `members:all` contains calculated tiers and metadata
   - Joins with `analysis:{bioguideId}` for dynamic trust anchor
   - Served directly to frontend

### Data Flow

```
FEC API → Itemized Analysis Worker
           ↓
    D1 (raw transactions)
           ↓
    Analysis aggregation
           ↓
    KV (analysis:{bioguideId})
           ↓
    Data Pipeline Worker
           ↓
    KV (members:all with tiers)
           ↓
    Frontend
```

---

## Troubleshooting

> **Historical:** this section describes the old pipeline (before the 2026-10 rebuild). For the current system: RUNBOOK §2 (progress), §6 (D1) and §8 (re-grading).

### Check if member has itemized data

```bash
# Check D1
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT COUNT(*) FROM itemized_transactions WHERE bioguide_id = 'S000033'"

# Check KV analysis
wrangler kv key get "analysis:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote

# Check if in processing queue
wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(. == "S000033")'
```

### Verify processing state

```bash
# Check queue length
wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'length'

# Check last Congress sync
wrangler kv key get "last_congress_sync" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote

# Count completed analyses
wrangler kv key list --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '[.[] | select(.name | startswith("analysis:"))] | length'

# Count D1 members
wrangler d1 execute taskforce-purple-donors --remote --command "SELECT COUNT(DISTINCT bioguide_id) FROM itemized_transactions"
```

### Reprocess a member

```bash
# Add to front of queue
QUEUE=$(wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote)
echo $QUEUE | jq '. = ["S000033"] + .' | wrangler kv key put "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote

# Or delete analysis to trigger reprocessing
wrangler kv key delete "analysis:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
wrangler kv key delete "progress:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

---

## Emergency Recovery

> **Historical:** this section describes the old pipeline (before the 2026-10 rebuild). For the current system: RUNBOOK §8 (re-grade and publish).

### Rebuild members:all from scratch

**DO NOT DO THIS UNLESS ABSOLUTELY NECESSARY**

The data pipeline will reconstruct from Congress.gov and FEC APIs. This will take hours.

```bash
# Delete member dataset
wrangler kv key delete "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote

# Delete batch progress to restart
wrangler kv key delete "batch_progress" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote

# Next scheduled run will reinitialize
```

### Rebuild itemized queue

```bash
# Get all current bioguideIds
MEMBERS=$(wrangler kv key get "members:all" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '[.[].bioguideId]')

# Set as processing queue
echo $MEMBERS | wrangler kv key put "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote
```

---

## Rate Limits and Quotas

### KV Free Tier

- **Reads**: 100,000/day (unlimited in practice)
- **Writes**: 1,000/day ⚠️ **ACTIVE CONSTRAINT**
- **Deletes**: 1,000/day
- **Storage**: 1 GB

**Usage now:** about 100 writes a day at most (Stage 1 exit check), mostly
one `members:list` write per published batch. Before the rebuild the two
workers used 790-1,010 a day.

### D1 Free Tier

- **Rows read**: 5 million/day for the whole account
- **Rows written**: 100,000/day for the whole account
- **Storage**: 500 MB per database

All three were hit in October 2026: 18.8M reads (an unindexed lookup) and
the 500 MB size limit with 275k writes (uncompressed records). Both are
fixed and metered (CLAUDE.md, RUNBOOK §6). `node scripts/verify/d1-usage.mjs`
shows usage by database.

---

**This reference should be sufficient to query and manage all data even if the workers fail.**
