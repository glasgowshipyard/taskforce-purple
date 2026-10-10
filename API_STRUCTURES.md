# API Data Structures Documentation

## Current endpoints at a glance (2026-10-07)

API worker `https://taskforce-purple-api.dev-a4b.workers.dev`:

| Endpoint                                                                                | What it does                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/members`                                                                      | The member list as stored (`members:list`)                                      |
| `GET /api/members/{bioguideId}`                                                         | One member's list entry                                                         |
| `GET /api/member-detail?bioguideId=`                                                    | One member's page: grade, money trail, donors, evidence (from D1 `tfp-results`) |
| `GET /api/status`                                                                       | Counts from the list                                                            |
| `GET /api/health`                                                                       | The health verdict (problems, each with a proposed fix)                         |
| `GET /api/races`                                                                        | The 2026 races (404 until published)                                            |
| `GET /api/candidate-detail?id=`                                                         | A race candidate's page                                                         |
| `GET /api/social-handles`                                                               | Members' social handles                                                         |
| `POST /api/refresh-social-handles`, `/api/remove-member/{id}`, `/api/clear-fec-mapping` | Admin, need `$UPDATE_SECRET`                                                    |

**Retired (HTTP 410):**

- `/api/update-data`, `/api/update-fec-batch`, `/api/smart-batch`,
  `/api/test-member`, `/api/reset-pac-data` and
  `/api/refresh-congress-metadata` (Stage 1).
- `/api/debug-kv` (2026-10-04).
- `/api/recalculate-tiers`, `/api/process-candidate` and
  `/api/update-member/@…` (Stage 3).
- The whole itemized worker.

Grades come from the refresh job (RUNBOOK §8). Sections below marked
historical describe the old pipeline; the dated sections at the end are
current.

## Congress.gov API

### Important: Different endpoints return different structures!

#### Members List Endpoint (used by Worker)

`GET /v3/member/congress/119?currentMember=true`

```json
{
  "members": [
    {
      "bioguideId": "F000484",
      "name": "Fine, Randy",
      "terms": {
        "item": [
          {
            "chamber": "House of Representatives",
            "startYear": 2025
          }
        ]
      }
    }
  ]
}
```

**Access chamber:** `member.terms?.item?.[0]?.chamber`

#### Individual Member Endpoint (for detailed lookups)

`GET /v3/member/H001046`

```json
{
  "member": {
    "bioguideId": "H001046",
    "name": "Heinrich, Martin",
    "terms": [
      {
        "chamber": "House of Representatives",
        "congress": 111,
        "startYear": 2009,
        "endYear": 2011
      },
      {
        "chamber": "Senate",
        "congress": 119,
        "startYear": 2025
      }
    ]
  }
}
```

**Access chamber:** `member.terms?.[0]?.chamber` (first term) or `member.terms?.[member.terms.length - 1]?.chamber` (current term)

## FEC API

### Candidate Search

`GET /v1/candidates/search/?q=Heinrich&office=S&state=NM`

Returns candidates with `candidate_id` needed for financial lookups.

### Financial Totals

`GET /v1/committee/{committeeId}/totals/?cycle=${ELECTION_CYCLE}`

Returns financial summary data. Uses dynamic election cycle calculation (2025→2024, 2026→2026, etc.).

## CRITICAL NOTES

1. **Worker uses LIST endpoint** - always use `member.terms?.item?.[0]?.chamber`
2. **Individual endpoint is different** - uses `member.terms?.[0]?.chamber`
3. **Chamber values:** "House of Representatives" or "Senate"
4. **Never assume structure without testing both endpoints**

## API Rate Limits

### FEC API (api.open.fec.gov)

- **Standard Rate Limit**: 1,000 requests per hour (~16.67 requests per minute)
- **Enhanced Rate Limit**: 7,200 requests per hour (120 requests per minute) - requires email request.
  **Our key has had it since 2026-10-07** (header `X-RateLimit-Limit: 120`).
- **Rate Limit Headers**: Returns `X-RateLimit-Limit` and `X-RateLimit-Remaining`
- **Error Code**: 429 when rate limit exceeded
- **Pages**: Limited to 100 results per page

### Congress.gov API

- **Appears unlimited** for our current usage patterns
- **Pagination**: 250 members per page works fine

### Historical: FEC rate limiting in the old pipeline

**Issue**: Processing 535 members × 3 FEC calls each = 1,605 API calls

- **Candidate search** (1 call per member)
- **Financial totals** (1 call per member)
- **PAC details** (1 call per member)

**Math**: 1,605 calls ÷ 16.67 calls/minute = **96.3 minutes needed** minimum

**Current Worker**: 1 second delay = 60 calls/minute = **EXCEEDS RATE LIMIT**

**Solution**: Need 3.6+ second delays between FEC calls to stay under 16.67/minute

## Common API Test Requests

### Test Congress.gov List Structure (what Worker uses)

```bash
curl -s "https://api.congress.gov/v3/member/congress/119?currentMember=true&offset=0&limit=1&api_key=$YOUR_API_KEY" | jq '.members[0] | {bioguideId, name, terms}'
```

### Test Individual Member Structure

```bash
curl -s "https://api.congress.gov/v3/member/H001046?api_key=$YOUR_API_KEY" | jq '.member.terms'
```

### Test FEC Candidate Search

```bash
curl -s "https://api.open.fec.gov/v1/candidates/search/?api_key=$YOUR_API_KEY&q=Heinrich&office=S&state=NM" | jq '.results[0]'
```

### Check Current API Data

```bash
# Count members with financial data
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '.members | map(select(.totalRaised > 0)) | length'

# Check specific member
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '.members[] | select(.bioguideId == "H001046")'
```

### Test Update Endpoint (historical: retired, answers 410)

```bash
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-data" -H "Authorization: Bearer $UPDATE_SECRET"
```

### Individual Member Update

```bash
# Update by username (requires social handle mapping)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-member/@bernie" -H "Authorization: Bearer $UPDATE_SECRET"

# Update by bioguide ID (fallback for members without usernames)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-member/@G000386" -H "Authorization: Bearer $UPDATE_SECRET"
```

**Note**: The endpoint first tries to find the username in social handle mapping. If not found, it checks if the input matches bioguide ID pattern (letter + 6 digits) and uses it directly. This allows updating members like Chuck Grassley who have `"username": null`.

### Remove Member from Storage

```bash
# Remove corrupted member data from KV storage (requires bioguide ID)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/remove-member/G000386" -H "Authorization: Bearer $UPDATE_SECRET"
```

**Purpose**: Surgically removes a member's data from the `members:all` KV storage key. This is useful for fixing corrupted data (like Chuck Grassley's 1977-1978 PAC dates) by removing the bad data so fresh data can be fetched on the next update.

**Response format:**

```json
{
  "success": true,
  "message": "Successfully removed member from storage",
  "removedMember": {
    "bioguideId": "G000386",
    "name": "Grassley, Chuck",
    "state": "IA",
    "party": "Republican"
  },
  "remainingMembers": 537,
  "lastUpdated": "2025-10-02T15:30:00.000Z"
}
```

**Use Case**: When a member has corrupted or outdated data cached in KV storage that isn't being refreshed by normal update calls. After removal, the next update call will fetch fresh data from APIs.

## Historical: the batch FEC update system (retired)

### Problem Solved

The original full pipeline (`/api/update-data`) was timing out when processing all 538 members due to:

- 15-second delays between FEC API calls (required for rate limiting)
- Cloudflare Worker execution time limits (~10 minutes)
- Processing 538 members × 15 seconds = 2+ hours needed
- No incremental saving meant timeouts lost all progress

### Solution: Batch Processing

New `/api/update-fec-batch` endpoint processes small batches efficiently:

#### Key Features

1. **No Congress.gov calls** - Uses existing member data from storage
2. **Small batches** - Default 3 members, max 10 for safety
3. **Incremental saving** - Progress saved after each member
4. **Progress tracking** - Resumes where it left off using KV storage
5. **Two-phase processing** - Financial data first, then PAC details
6. **Stays within Worker limits** - Each run takes ~1-2 minutes

#### Usage Examples

**Basic batch run (3 members):**

```bash
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-fec-batch" -H "Authorization: Bearer $UPDATE_SECRET"
```

**Custom batch size (5 members):**

```bash
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-fec-batch?batch=5" -H "Authorization: Bearer $UPDATE_SECRET"
```

**Response format:**

```json
{
  "success": true,
  "message": "FEC batch update completed",
  "batchSize": 3,
  "processed": 3,
  "updated": 2,
  "phase": "financial",
  "nextIndex": 15,
  "totalMembers": 538,
  "lastUpdated": "2025-09-29T23:45:00.000Z"
}
```

#### Processing Phases

**Phase 1: Financial Data**

- Processes members without `totalRaised` or with `totalRaised = 0`
- Updates: `totalRaised`, `grassrootsDonations`, `grassrootsPercent`, `pacMoney`, `tier`
- Moves to Phase 2 when all members have financial data

**Phase 2: PAC Details**

- Processes members with financial data but missing PAC details
- Updates: `pacContributions`, `pacDetailsStatus = 'complete'`
- Resets to Phase 1 when complete

#### Progress Tracking

- **KV Key**: `batch_progress`
- **Format**: `{"lastProcessedIndex": 15, "phase": "financial"}`
- **Auto-resume**: Each run continues from `lastProcessedIndex + 1`
- **Auto-reset**: Restarts from beginning when all phases complete

#### Deployment Strategy

1. **Manual testing**: Run single batches to verify functionality
2. **Scheduled execution**: Set up cron job to run every 15-30 minutes
3. **Full coverage**: 538 members ÷ 3 per batch = ~180 runs = 45-90 hours for complete update

#### Rate Limiting Compliance

- **FEC API**: 15-second delays maintained (under 16.67 calls/minute limit)
- **Cloudflare**: Each batch run stays well under time limits
- **No Congress.gov calls**: Eliminates unnecessary API usage

#### Monitoring

Use existing `/api/status` endpoint to track progress:

- `withFinancialData`: Members with Phase 1 complete
- `withPACDetails`: Members with Phase 2 complete
- `twoCallStrategy.phase2Progress`: Shows PAC completion ratio

## Historical proposal: enhanced PAC tiering (built in 2025; see GRASSROOTS_CALCULATION_GUIDE)

### Current Problem

Current tier calculations may be unfairly penalizing decent representatives by treating all PAC money equally. A $1000 donation from a candidate's own committee vs. a Super PAC should have different transparency implications.

### Solution: FEC Committee Type/Designation Tiering

Instead of subjective hardcoded PAC rankings, use **official FEC metadata** to create dynamic tier adjustments:

#### FEC Committee Types (`committee_type`)

**Source**: [FEC Committee Types](https://18f.github.io/openFEC-documentation/codes/#committee-type-codes)

| Code  | Type                                         | Transparency Impact                             |
| ----- | -------------------------------------------- | ----------------------------------------------- |
| `"O"` | **Super PAC** (independent expenditure only) | 🚩 **High concern** - unlimited corporate money |
| `"N"` | **Nonqualified PAC**                         | ⚠️ **Medium concern** - limited contributions   |
| `"Q"` | **Qualified PAC** (multicandidate)           | ⚠️ **Medium concern** - established PAC         |
| `"P"` | **Principal candidate committee**            | ✅ **Low concern** - candidate's own committee  |

#### FEC Designations (`designation`)

**Source**: [FEC Designation Codes](https://18f.github.io/openFEC-documentation/codes/#committee-designation-codes)

| Code  | Type                             | Transparency Impact                               |
| ----- | -------------------------------- | ------------------------------------------------- |
| `"D"` | **Leadership PAC**               | 🚩 **High concern** - political influence vehicle |
| `"B"` | **Lobbyist/registrant PAC**      | 🚩 **High concern** - direct lobbying connection  |
| `"U"` | **Unauthorized PAC**             | ⚠️ **Medium concern** - not candidate-controlled  |
| `"P"` | **Principal campaign committee** | ✅ **Low concern** - official candidate committee |
| `"A"` | **Authorized by candidate**      | ✅ **Low concern** - candidate oversight          |

### Proposed Tier Adjustment Logic

**Base Calculation**: Current grassroots percentage determines base tier (S/A/B/C/D)

**PAC Weight Adjustments**: Apply multipliers to PAC contribution amounts based on committee metadata:

```javascript
function getPACTransparencyWeight(committee) {
  // Base weight: 1.0 (normal PAC concern)
  let weight = 1.0;

  // Committee Type adjustments
  if (committee.committee_type === 'O') {
    weight *= 2.0; // Super PACs are 2x more concerning
  } else if (committee.committee_type === 'P') {
    weight *= 0.3; // Candidate committees are 70% less concerning
  }

  // Designation adjustments
  if (committee.designation === 'D' || committee.designation === 'B') {
    weight *= 1.5; // Leadership/Lobbyist PACs 50% more concerning
  } else if (committee.designation === 'P' || committee.designation === 'A') {
    weight *= 0.5; // Authorized committees 50% less concerning
  }

  return weight;
}
```

**Example Impact**:

- $10,000 from Super PAC → Weighted as $20,000 (worse tier)
- $10,000 from candidate committee → Weighted as $3,000 (better tier)
- $10,000 from Leadership PAC → Weighted as $15,000 (worse tier)

### Implementation Complexity: **LOW-MEDIUM**

**✅ Easy Parts**:

- FEC API already returns `committee_type` and `designation` fields
- No additional API calls needed
- Logic is straightforward mathematical weighting

**⚠️ Medium Complexity**:

- Need to modify tier calculation in `workers/data-pipeline.js:315-325`
- Requires updating PAC data structure to store metadata
- Need to recalculate existing member tiers with new weights

### Implementation Steps:

1. **Update PAC fetching** to capture `committee_type` and `designation`
2. **Modify tier calculation** to apply transparency weights
3. **Add new fields** to member data structure
4. **Recalculate existing tiers** with new methodology
5. **Update frontend** to show PAC transparency categories

### API Changes Needed:

- **PAC Details**: Add `committee_type`, `designation`, `transparency_weight` fields
- **Member Data**: Add `weighted_pac_total`, `transparency_breakdown` fields
- **Status API**: Add PAC category distribution stats

This would make tier calculations much more nuanced and fair while staying completely objective and based on official FEC classifications.

## FEC Election Cycle Handling

### Current Implementation (2025-01-01)

Dynamic election cycle calculation using system date:

```javascript
const ELECTION_CYCLE = (() => {
  const currentYear = new Date().getFullYear();
  // For odd years, use the previous even year (e.g., 2025 -> 2024)
  // For even years, use the current year (e.g., 2024 -> 2024)
  return currentYear % 2 === 0 ? currentYear : currentYear - 1;
})();
```

### Applied to FEC API Calls

- **Committee Totals**: `cycle=${ELECTION_CYCLE}`
- **Entity Totals**: `election_year=${ELECTION_CYCLE}&cycle=${ELECTION_CYCLE}`
- **Schedule A**: `two_year_transaction_period=${ELECTION_CYCLE}`

### Calculation Results

- **2025 → 2024** (current situation)
- **2024 → 2024**
- **2026 → 2026**
- **2027 → 2026**

### Benefits

- **Automatic updates**: No manual intervention needed each election cycle
- **Performance**: Calculated once per worker cold start, not per API call
- **Accuracy**: Always pulls data from the correct election cycle

## Itemized worker (retired 2026-10-04)

Every URL on `https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev`
(`/analyze`, `/status`, `/health`) answers `410` with a pointer to
`/api/health`. Donor collection is the refresh job (GitHub Actions,
`scripts/refresh/`); the old code is in git history.

## `GET /api/health` (added 2026-10-04)

Public, read-only, never cached. Returns
`{ checkedAt, ok, problems: [{id, message, fix}], notes: [] }` from
`workers/health.js`: the site's member list (KV `members:list`) and the
refresh job's record in D1 `tfp-results` (latest run, failed members,
unreconciled committees, today's D1 write ledger). Read by
`scripts/health-alert.sh` at the end of every refresh job (RUNBOOK §10).
Cost per call: 1 KV read and one D1 batch of 4 small reads; no writes.

`/api/debug-kv` was retired the same day (410): it reported a queue that no
longer exists, and each public call spent one of the free tier's 1,000 daily
KV list operations.

## Stage 1 changes (2026-10-03, REBUILD_SPEC.md)

- **`GET /api/members`** returns the stored `members:list` body as-is (header
  `X-TFP-Source: members:list`): `{members, lastUpdated, total,
adaptiveThresholds}`. Each entry has only list fields: `bioguideId, name,
party, state, district, chamber, tier, totalRaised, grassrootsPercent,
rawFECGrassrootsPercent, grassrootsDonations, largeDonorDonations, pacMoney,
individualFundingPercent, gradeBasis, personFigures, fecIdentityVerified,
nakamotoCoefficient, faraEmployerTotal, pacDetailsStatus, lastUpdated`, plus
  `quicklook` (the row's warning-icon sectors) and `conduitCount`.
  `lastUpdated` is when the list's data last changed (#38).
- **`GET /api/member-detail?bioguideId=`** adds `member`: the member's full
  served record (PAC donations, FARA firms, conduits and so on).
- **`/api/remove-member/{id}`** also clears that member's `fec_mapping_*` (#14).
- **Retired (HTTP 410):** `/api/update-data`, `/api/update-fec-batch`,
  `/api/smart-batch`, `/api/test-member`, `/api/reset-pac-data`,
  `/api/refresh-congress-metadata`, and the scheduled (cron) handler. Each
  rewrote every member to change one. The refresh job (Stage 2) replaces
  them. The sections above that describe them are historical.

## Stage 3 changes (2026-10-05)

- **`GET /api/member-detail?bioguideId=`**: for a member graded by the
  refresh job, everything comes from their row in D1 `tfp-results`:
  - `member`: their record with the result laid over it (tier, gradeBasis,
    personFigures, `evidenceChecked`, donors, Nakamoto, conduits, FARA);
  - `moneyTrail` and `topDonors`;
  - `donorPoolCommitteeIds`;
  - `evidence: { checked, notes }`. `checked` is true when every record has
    been checked against the FEC's, false while the grade comes from the bulk
    files only. `notes` lists where the FEC's own figures disagree (D3);
  - `grade: { score, detail }` (added 2026-10-07, letter grades only, null
    otherwise): the grade's working from `workers/tier-calculation.js`.
    `detail` holds `rawIndividualFundingPercent`, `itemizedPercent`,
    `trustAnchor` and `trustAnchorBasis` (dinner-party, elite-capture,
    standard, movement, default), `itemizationPenalty` and
    `transparencyPenalty`. The member page explains the grade from it.
  - `member.personFigures.ownMoney` (added 2026-10-09, #59): `{ contributions,
loans, repaid }`, the candidate's own gifts and loans to their campaign
    and what it repaid them, from the FEC candidate summary. Left out of the
    grade, shown on the receipt. Present only when non-zero.
  - `member.pacSummary` (added 2026-10-09, #57): every PAC gift to the
    member's campaigns and leadership PAC: `{ total, count, byKind, list }`,
    `list` the 30 largest with each PAC's FEC type, designation, organisation
    type, sponsor and `profile` (its own receipts, money from individuals,
    named donors and how few gave half). Members graded before it keep the
    record's old `pacContributions` only.
  - `member.faraAgentTotal` (added 2026-10-09, #60): money from donors
    personally registered as foreign agents (named on their firm's DOJ
    short-form list); `faraEmployerTotal` stays everyone at a registered
    firm. Each `faraFirms` entry adds `agentAmount`, `agents`, `clientCount`,
    `countries` and `clients` (name, country, government or not).

  - `grade.detail.pacCredit` (added 2026-10-09, #57 version A): points of the
    score that come from PAC money traced back to people (half of it counts).
    Present, 0 included, on every grade worked out with the full PAC list;
    absent on older grades, and the page then leaves the PAC step out.
  - `member.pacSummary.counted` and `list[].peopleShare` (added 2026-10-09):
    dollars of the member's PAC money that count toward the grade, and each
    PAC's share of money traced to people (0-1, traced one level deeper;
    null when the FEC has no summary for it).
  - `member.withheldReason` (added 2026-10-09; also on `/api/members`
    entries): why a grade is withheld, for "?" grades only:
    `identity-not-confirmed`, `no-campaign-committee` (the FEC lists no
    campaign committee for the cycle), `not-graded`.

  Members not graded by the job (no FEC identity, or pending) get the old
  stored record, with `evidence: null`, and never its old letter grade: a
  member the job looked at and couldn't grade is withheld with the reason.
  One D1 read per request.

- **`GET /api/members`** list entries carry `evidenceChecked`.
- **Retired (HTTP 410):** `/api/recalculate-tiers`, `/api/process-candidate`
  and `/api/update-member/@{handle}`. They re-graded through the old engine
  and would have overwritten published grades. Re-grade with the refresh job
  instead (RUNBOOK §8).

## The 2026 races (2026-10-07, ROADMAP Phase E)

- **`GET /api/races`**: KV `races:list` as stored:
  `{cycle, field, races: [{key, office, state, district, label, candidates:
[{candidateId, bioguideId, name, party, ici, tier, evidenceChecked,
totalRaised, smallDonors, largeDonors, pac, uniqueDonors, nakamoto}]}],
updatedAt}`. HTTP 404 until the races job publishes. The site shows the
  Races tab only when `field` is `12g` (November's ballot).
- **`GET /api/candidate-detail?id={FEC candidate ID}`**: a candidate who
  isn't a sitting member, from D1 `race_candidates`, in the same shape as
  `/api/member-detail` (member, moneyTrail, topDonors, evidence). One D1
  read.
