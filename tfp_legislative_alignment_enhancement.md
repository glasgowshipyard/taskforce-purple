# Task Force Purple Legislative Alignment Module

## Objective

Extend Task Force Purple’s analysis to correlate **funding tiers** with **voting behavior** on specific bills.
This module will provide insight into whether grassroots-funded or PAC-funded members tend to vote in alignment with public interest or special interests.

## Data Sources

### Primary (official)

1. **Congress.gov API**
   - Bill and roll call vote data
   - Endpoints include:
     - `/bill/{congress}/{bill-type}/{bill-number}` for bill metadata
     - `/bill/{congress}/{bill-type}/{bill-number}/votes` for roll call records
   - Each vote record references the `bioguideId` for members.

2. **Task Force Purple KV Store**
   - Stores member financial tiers and funding data.
   - Example structure:
     ```json
     {
       "bioguideId": "A000360",
       "tier": "B",
       "grassrootsPercent": 61,
       "pacMoney": 31000,
       "totalRaised": 520000
     }
     ```

## Integration Logic

1. **Fetch roll call vote data**
   - Use the Congress.gov API to retrieve voting data for a bill.

2. **Join vote data with Task Force Purple member data**
   - Match each vote’s `bioguideId` with financial and tier data stored in KV.

3. **Aggregate by tier**
   - Tally Yes/No votes within each tier (S–F).
   - Compute support ratio per tier as:
     ```
     supportRatio = (yesVotes / totalVotes) * 100
     ```

4. **Output structure**
   ```json
   {
     "bill": "HR-1923",
     "policyArea": "Veterans Healthcare",
     "passed": true,
     "tierSupport": {
       "S": 95,
       "A": 88,
       "B": 73,
       "C": 45,
       "D": 32,
       "E": 18,
       "F": 11
     }
   }
   ```

## Visualization Concept

A table or bar chart displaying support percentage by tier.

| Tier | Yes Votes | No Votes | Support % |
| ---- | --------- | -------- | --------- |
| S    | 39        | 2        | 95%       |
| A    | 87        | 12       | 88%       |
| B    | 102       | 37       | 73%       |
| C    | 56        | 68       | 45%       |
| D    | 22        | 47       | 32%       |
| E    | 9         | 41       | 18%       |
| F    | 4         | 31       | 11%       |

This allows clear visibility into which funding tiers tend to vote with or against public-interest legislation.

## Implementation Path

1. **Add API Endpoint**
   - `/api/vote-alignment/:billId`
   - On call:
     - Fetch roll call vote data
     - Merge with member financial data
     - Return per-tier support ratios as JSON

2. **Cache results in KV**
   - Store as `VOTE_ALIGNMENT:<billId>` for daily refresh.

3. **Frontend Integration**
   - Create a chart component showing per-tier voting alignment.
   - Optionally include bill metadata, recent actions, and summary links.

## Rationale

This enhancement connects funding data with real-world legislative outcomes.
It exposes correlations between corporate capture and policy alignment, enabling transparent, data-driven analysis of representation quality.
