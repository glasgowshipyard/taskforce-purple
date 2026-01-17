# Task Force Purple - Database Reference

**Last Updated**: 2026-01-17

This document provides complete reference for all KV and D1 databases used in the project, including how to query them.

---

## Cloudflare KV Storage

### Namespace: MEMBER_DATA

**ID**: `8318226115e2423ab5d141adfa5419f9`

**Purpose**: Stores processed member data, queues, and analysis results.

### Key Structure

#### Core Data Keys

**`members:all`** - Complete member dataset (537 members)

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

#### Queue Keys

**`itemized_processing_queue`** - Queue of members needing itemized analysis

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

**`analysis:{bioguideId}`** - Itemized donor concentration analysis

```bash
# Get analysis for specific member
wrangler kv key get "analysis:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .

# List all members with completed analysis
wrangler kv key list --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '.[] | select(.name | startswith("analysis:")) | .name'

# Count completed analyses
wrangler kv key list --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq '[.[] | select(.name | startswith("analysis:"))] | length'
```

**Structure**:

```json
{
  "bioguideId": "S000033",
  "totalItemized": 1308214.17,
  "uniqueDonors": 13102,
  "nakamotoCoefficient": 1534,
  "nakamotoPercent": 11.7,
  "totalTransactions": 15847,
  "avgDonation": 82.55,
  "lastUpdated": "2026-01-17T15:30:00Z"
}
```

**`progress:{bioguideId}`** - Processing progress for itemized analysis

```bash
# Check progress for member
wrangler kv key get "progress:S000033" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq .
```

**`fec_mapping_{bioguideId}`** - FEC committee ID mappings

```bash
# Get FEC committee for member
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

### Database: taskforce-purple-donors

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

**Current Usage** (at 20-min intervals):

- Data pipeline: ~360-576 writes/day
- Itemized analysis: ~432 writes/day
- **Total**: ~790-1,010 writes/day (79-101% of limit)

### D1 Free Tier

- **Rows read**: 5 million/day
- **Rows written**: 100,000/day
- **Storage**: 500 MB

**Current Usage**:

- Itemized analysis: ~1,000 rows/member × 1 member per 30 min = 48,000 rows/day
- **Well within limits**

---

**This reference should be sufficient to query and manage all data even if the workers fail.**
