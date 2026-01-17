# Smart Batching Strategy - Rate-Limited Progressive Processing

**Date**: 2025-10-01
**Status**: Ready for Implementation
**Goal**: Complete all 538 members within 1-3 days while respecting rate limits

## Current Data State

- **Total Members**: 538
- **Phase 1 Complete**: 35 members (6.5%)
- **Phase 2 Complete**: 13 members (2.4%)
- **Phase 1 Remaining**: 503 members (93.5%)
- **Phase 2 Remaining**: 525 members (97.6%)

## Rate Limit Constraints

### FEC API Limits

- **Official Limit**: 1,000 requests per hour
- **Practical Rate**: 16.67 requests per minute
- **Safety Buffer**: Use 15 requests per minute maximum

### Cloudflare Worker Limits

- **Subrequest Limit**: ~50-100 per execution (based on observed "Too many subrequests")
- **CPU Time Limit**: 30 seconds
- **Safety Strategy**: 15 FEC calls per 15-minute execution

## API Call Requirements

### Phase 1 (Financial Data Collection)

**Per Member**: 3 FEC API calls

1. Candidate lookup call
2. Committee financial summary call
3. Itemized contributions call

**Total Phase 1 Remaining**: 503 members × 3 calls = **1,509 FEC calls**

### Phase 2 (PAC Enhancement)

**Per Member**: 2-5 FEC API calls (varies by PAC count)

1. Committee metadata lookup (per unique PAC)
2. Committee details fetch (per unique PAC)

**Average**: 4 calls per member
**Total Phase 2 Remaining**: 525 members × 4 calls = **2,100 FEC calls**

**Grand Total**: 3,609 FEC calls remaining

## Smart Batching Mathematics

### Implemented Mixed Batch Sizes (CURRENT)

- **Mixed Batch Strategy**: 3 Phase 1 + 1 Phase 2 per cycle
- **Phase 1**: 3 members × 3 calls = 9 FEC calls
- **Phase 2**: 1 member × 4 calls = 4 FEC calls
- **Total per cycle**: 13 FEC calls (leaves 2 calls buffer)
- **Benefit**: Ensures Phase 2 processing even with 47+ members waiting

### Rate Limit Compliance Check

#### Per-Minute Rate

- **Execution Frequency**: Every 15 minutes
- **Calls Per Execution**: 12-14 calls
- **Effective Rate**: 12 calls ÷ 15 minutes = **0.8 calls/minute**
- **FEC Limit**: 16.67 calls/minute
- **Safety Margin**: 95.2% under limit ✅

#### Per-Hour Rate

- **Executions Per Hour**: 4 runs
- **Calls Per Hour**: 4 × 14 = **56 calls**
- **FEC Limit**: 1,000 calls/hour
- **Safety Margin**: 94.4% under limit ✅

#### Per-Day Rate

- **Executions Per Day**: 96 runs (24 hours × 4)
- **Calls Per Day**: 96 × 13 = **1,248 calls**
- **Monthly Allowance**: 30 × 1,000 = 30,000 calls
- **Daily Percentage**: 4.2% of monthly budget ✅

## Completion Timeline

### Phase 1 (Financial Data)

- **Remaining**: 503 members
- **Batch Size**: 4 members per run
- **Runs Needed**: 503 ÷ 4 = 126 runs
- **Time to Complete**: 126 ÷ 4 = **31.5 hours = 1.3 days**

### Phase 2 (PAC Enhancement)

- **Current Queue**: 25 members (have financial data, need PAC data)
- **Future Queue**: 503 members (after Phase 1 completion)
- **Total Phase 2**: 528 members
- **Batch Size**: 3 members per run
- **Runs Needed**: 528 ÷ 3 = 176 runs
- **Time to Complete**: 176 ÷ 4 = **44 hours = 1.8 days**

### Total Completion Time

**Parallel Processing**: Phase 2 can start immediately on available members
**Sequential Completion**: 1.3 days (Phase 1) + 1.8 days (Phase 2) = **3.1 days**
**Optimized Completion**: ~**2-2.5 days** with mixed batching

## Adaptive Frequency Strategy

### Dynamic Schedule Based on Completion Rate

```javascript
function getOptimalCronSchedule(completionPercentage) {
  if (completionPercentage < 50%) return "*/15 * * * *"; // Every 15 min (catch-up)
  if (completionPercentage < 90%) return "*/30 * * * *"; // Every 30 min (normal)
  if (completionPercentage < 99%) return "0 */2 * * *";  // Every 2 hours (maintenance)
  return "0 0 */1 * *";                                  // Daily (refresh)
}
```

### Current Phase: Catch-up Mode

- **Schedule**: `*/15 * * * *` (every 15 minutes)
- **Duration**: Until 50% completion (~1 day)
- **Expected Transition**: October 3rd to normal mode

## Implementation Architecture

### KV Storage Design

```javascript
// Processing queues
processing_queue_phase1: ["bioguideId1", "bioguideId2", ...] // 503 members
processing_queue_phase2: ["bioguideId3", "bioguideId4", ...] // 25 members currently

// Processing status
processing_status: {
  phase1_completed: 35,
  phase1_remaining: 503,
  phase2_completed: 13,
  phase2_remaining: 525,
  last_run_timestamp: "2025-10-01T...",
  last_batch_size: 14,
  rate_limit_buffer: 15,
  completion_percentage: 6.5
}

// Member status tracking
member_status_[bioguideId]: {
  phase1_status: "complete|pending|failed",
  phase1_timestamp: "2025-10-01T...",
  phase1_attempts: 1,
  phase2_status: "complete|pending|failed",
  phase2_timestamp: "2025-10-01T...",
  phase2_attempts: 1,
  last_error: null,
  api_calls_used: 7
}
```

### Smart Batch Processing Logic (IMPLEMENTED)

```javascript
async function processSmartBatch(env) {
  const callBudget = 15; // Conservative limit
  let callsUsed = 0;
  let processedMembers = [];

  // Mixed batch processing: alternate between Phase 1 and Phase 2
  const phase1Queue = await getPhase1Queue(env);
  const phase2Queue = await getPhase2Queue(env);

  // Mixed batching strategy: 3 Phase 1 + 1 Phase 2 per cycle (13 calls, 2 buffer)
  while ((phase1Queue.length > 0 || phase2Queue.length > 0) && callsUsed < callBudget) {
    // Process up to 3 Phase 1 members (9 calls)
    let phase1Count = 0;
    while (phase1Queue.length > 0 && phase1Count < 3 && callsUsed + 3 <= callBudget) {
      const member = phase1Queue.shift();
      await processPhase1Member(member, env);
      callsUsed += 3;
      phase1Count++;
      processedMembers.push({ member: member.name, phase: 1 });
    }

    // Process 1 Phase 2 member if budget allows (4 calls)
    if (phase2Queue.length > 0 && callsUsed + 4 <= callBudget) {
      const member = phase2Queue.shift();
      await processPhase2Member(member, env);
      callsUsed += 4;
      processedMembers.push({ member: member.name, phase: 2 });
    }
  }

  await updateProcessingStatus(env, callsUsed, processedMembers);

  console.log(
    `📊 Smart batch complete: ${callsUsed}/15 calls used, ${processedMembers.length} members processed`
  );
  return { callsUsed, processedMembers, remainingBudget: callBudget - callsUsed };
}
```

## Error Handling & Recovery

### Rate Limit Detection

- **Monitor**: "Too many subrequests" errors
- **Action**: Immediate batch termination
- **Recovery**: Mark failed members for retry
- **Backoff**: Reduce batch size temporarily

### Checkpoint Persistence

- **Save After**: Every successful member processing
- **Resume From**: Last successful member
- **Retry Logic**: Failed members get 3 attempts before quarantine

### Graceful Degradation

```javascript
if (rateLimitDetected) {
  currentBatchSize = Math.max(1, currentBatchSize - 1);
  console.log(`⚠️ Rate limit hit, reducing batch size to ${currentBatchSize}`);
}
```

## Monitoring & Alerts

### Success Metrics

- **Processing Rate**: Members per hour
- **API Efficiency**: Calls per successful member
- **Completion Progress**: Percentage complete
- **Error Rate**: Failed members per batch

### Expected Performance

- **Daily Throughput**: 384 Phase 1 + 288 Phase 2 = 672 members/day
- **API Usage**: 1,344 calls/day (4.5% of monthly budget)
- **Completion**: 2-3 days for full dataset
- **Error Rate**: <1% (with retry logic)

## Next Steps

1. ✅ **Document Strategy** (this document)
2. 🔄 **Implement Checkpoint System**
3. 🔄 **Add Smart Batch Processing**
4. 🔄 **Deploy with Rate Limit Monitoring**
5. ⏰ **Enable Cron Schedule** (`*/15 * * * *`)
6. 📊 **Monitor Progress** (expect completion in 2-3 days)

---

**Confidence Level**: High
**Risk Level**: Low (95%+ under rate limits)
**Expected Outcome**: Full dataset in 2-3 days with zero rate limit violations
