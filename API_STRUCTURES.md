# API Data Structures Documentation

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
`GET /v1/committee/{committeeId}/totals/?cycle=2024`

Returns financial summary data.

## CRITICAL NOTES

1. **Worker uses LIST endpoint** - always use `member.terms?.item?.[0]?.chamber`
2. **Individual endpoint is different** - uses `member.terms?.[0]?.chamber`
3. **Chamber values:** "House of Representatives" or "Senate"
4. **Never assume structure without testing both endpoints**

## API Rate Limits

### FEC API (api.open.fec.gov)
- **Standard Rate Limit**: 1,000 requests per hour (~16.67 requests per minute)
- **Enhanced Rate Limit**: 7,200 requests per hour (120 requests per minute) - requires email request
- **Rate Limit Headers**: Returns `X-RateLimit-Limit` and `X-RateLimit-Remaining`
- **Error Code**: 429 when rate limit exceeded
- **Pages**: Limited to 100 results per page

### Congress.gov API
- **Appears unlimited** for our current usage patterns
- **Pagination**: 250 members per page works fine

### Current Problem: FEC Rate Limiting
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
curl -s "https://api.congress.gov/v3/member/congress/119?currentMember=true&offset=0&limit=1&api_key=zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9" | jq '.members[0] | {bioguideId, name, terms}'
```

### Test Individual Member Structure
```bash
curl -s "https://api.congress.gov/v3/member/H001046?api_key=zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9" | jq '.member.terms'
```

### Test FEC Candidate Search
```bash
curl -s "https://api.open.fec.gov/v1/candidates/search/?api_key=zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9&q=Heinrich&office=S&state=NM" | jq '.results[0]'
```

### Check Current API Data
```bash
# Count members with financial data
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '.members | map(select(.totalRaised > 0)) | length'

# Check specific member
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '.members[] | select(.bioguideId == "H001046")'
```

### Test Update Endpoint
```bash
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-data" -H "UPDATE_SECRET: taskforce_purple_2025_update"
```

## NEW: Batch FEC Update System

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
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-fec-batch" -H "Authorization: Bearer taskforce_purple_2025_update"
```

**Custom batch size (5 members):**
```bash
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/update-fec-batch?batch=5" -H "Authorization: Bearer taskforce_purple_2025_update"
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