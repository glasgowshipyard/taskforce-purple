# Rate Limiting Issue Analysis - Task Force Purple API

**Date**: 2025-09-30
**Issue**: Scheduled bulk processing violating rate limits and blocking individual member updates
**Severity**: High - System effectively non-functional for individual updates

## Executive Summary

The scheduled cron job (`*/15 * * * *`) is attempting to process all 538 congressional members every 15 minutes, violating multiple rate limiting constraints and rendering the individual member update system unusable.

## Current System Architecture

### Scheduled Processing
- **Trigger**: Cron schedule `*/15 * * * *` (every 15 minutes)
- **Function**: `updateCongressionalData()` → `processMembers()`
- **Current Behavior**: Attempts to process ALL 538 members in a single execution

### Phase 1 and Phase 2 Call Patterns

#### Phase 1: Basic Financial Data Collection
```javascript
// Location: data-pipeline.js:629-715
// Purpose: Fetch basic financial data for all members
const BASIC_BATCH_SIZE = 25; // Used only for storage batching, NOT rate limiting

for (const member of membersToProcess) {  // membersToProcess = ALL 538 members
    const financials = await fetchMemberFinancials(member, env);
    // ... process member

    // Storage batch every 25 members (NOT processing limit)
    if (basicProcessed % BASIC_BATCH_SIZE === 0) {
        // Save to storage, continue processing
    }
}
```

**FEC API Calls per Member**:
- 1x candidate lookup call
- 1x committee financial summary call
- 1x itemized contributions call (if committee exists)
- **Total**: ~3 FEC API calls per member

**Phase 1 Total API Calls**: 538 members × 3 calls = **1,614 FEC API calls**

#### Phase 2: PAC Enhancement (Not reached due to Phase 1 rate limiting)
```javascript
// Location: data-pipeline.js:717-770
// Purpose: Enhance PAC contributions with committee metadata
// Additional FEC API calls: 2-5 per member with PAC data
```

## Rate Limiting Constraints

### 1. FEC API Rate Limits
- **Documented Limit**: ~16.67 requests per minute (1,000 per hour)
- **Current Violation**: 1,614 requests in 15-minute window = **6,456 requests/hour**
- **Overage**: 545% above limit

### 2. Cloudflare Workers Subrequest Limits
- **Error Observed**: "Too many subrequests"
- **Trigger Point**: After ~25-50 members (75-150 FEC calls)
- **Current Violation**: Attempting 1,614+ subrequests per execution

### 3. Cloudflare Workers CPU Time Limits
- **Limit**: 30 seconds for paid plans
- **Observed**: "Exceeded CPU Limit" errors in logs

## Root Cause Analysis

### Missing Rate Limiting Implementation
The code defines `BASIC_BATCH_SIZE = 25` but **only uses it for storage batching**, not processing limits:

```javascript
// CORRECT: Storage batching (working)
if (basicProcessed % BASIC_BATCH_SIZE === 0) {
    await env.MEMBER_DATA.put('members:all', JSON.stringify(finalBasicMembers));
}

// MISSING: Processing rate limiting (not implemented)
// Should be: if (basicProcessed >= MAX_PROCESSING_LIMIT) { break; }
```

### Design vs Implementation Gap
- **Design Intent**: Process 15 members max per run (stay under 16.67/minute FEC limit)
- **Actual Implementation**: Process ALL 538 members per run
- **Missing Component**: Early termination based on rate limits

## Evidence from Logs

```
🚀 PHASE 1: Fetching basic tier data for all members...
🔍 Looking up financial data for: Heinrich, Martin (Success)
🔍 Looking up financial data for: Hagerty, Bill (Success)
...
📊 Basic processing: 25/538 members (Success)
...
🔍 Looking up financial data for: Ocasio-Cortez, Alexandria
(warn) Error fetching financials for Ocasio-Cortez, Alexandria: Too many subrequests.
```

**Pattern**:
- First 25 members: Success
- Members 26-50: Rate limited
- Individual updates: Blocked by exhausted API quota

## Impact on Individual Member Updates

### Individual Update System Design
```javascript
// Location: data-pipeline.js:1484+
// Purpose: Update single member with full Phase 1 + Phase 2 processing
// Expected API calls: ~8-15 per member (well within limits)
```

### Current Failure Mode
1. Scheduled job exhausts FEC API quota every 15 minutes
2. Individual update requests hit depleted quota
3. Returns cached/stale data instead of fresh processing
4. User sees no evidence of actual data refresh

## Documented Rate Limiting Strategy (Not Implemented)

From documentation review, the system was designed with:

1. **Government API**: Infrequent calls (weekly-ish schedule)
2. **FEC API**: Max 15 calls per run (under 16.67/minute limit)
3. **Cloudflare**: Additional safeguards to prevent subrequest limits

**Current Status**: None of these safeguards are active in the scheduled processing.

## Resolution Avenues

### 1. Immediate Fix: Implement Hard Limits
```javascript
const MAX_PHASE1_MEMBERS = 15; // Stay under FEC rate limits
let processedCount = 0;

for (const member of membersToProcess) {
    if (processedCount >= MAX_PHASE1_MEMBERS) {
        console.log(`🛑 Rate limiting: Processed ${processedCount} members, stopping`);
        break;
    }
    // ... process member
    processedCount++;
}
```

### 2. Schedule Adjustment
- **Current**: `*/15 * * * *` (every 15 minutes)
- **Proposed**: `0 */6 * * *` (every 6 hours) or daily
- **Rationale**: Allow sufficient time between bulk processing runs

### 3. Progressive Processing Strategy
- Implement member index tracking in KV storage
- Resume from last processed member on next run
- Complete all 538 members over multiple scheduled runs
- Reset index when full cycle complete

### 4. Separate Scheduling for Phases
- **Phase 1**: Process 15 members every 6 hours
- **Phase 2**: Process existing members with PAC enhancement daily
- **Individual Updates**: Always allowed (bypasses bulk quotas)

### 5. Enhanced Error Handling
- Detect "Too many subrequests" errors
- Gracefully terminate processing
- Save progress and resume on next run
- Log quota exhaustion for monitoring

## Technical Specifications for Fix

### Required Code Changes
1. **Add rate limiting constants**: `workers/data-pipeline.js:633`
2. **Implement early termination**: `workers/data-pipeline.js:641` (in member processing loop)
3. **Add progress tracking**: Store last processed member index in KV
4. **Update cron schedule**: `wrangler.toml` or deployment configuration
5. **Enhanced error detection**: Catch and handle subrequest limit errors

### Testing Strategy
1. Deploy with MAX_PHASE1_MEMBERS = 5 for testing
2. Verify early termination after 5 members
3. Confirm individual updates work after scheduled run
4. Monitor logs for "Too many subrequests" errors
5. Gradually increase limits once stable

## Monitoring Requirements

### Success Metrics
- Scheduled runs complete without "Too many subrequests" errors
- Individual member updates work consistently
- Processing progress tracked across multiple runs
- All 538 members eventually processed over time

### Alerting Needed
- FEC API quota exhaustion detection
- Cloudflare subrequest limit alerts
- Individual update failure monitoring
- Progress tracking validation

---

**Next Actions**:
1. Implement immediate hard limit fix (MAX_PHASE1_MEMBERS = 15)
2. Test with reduced batch size
3. Monitor individual update functionality restoration
4. Plan progressive processing implementation