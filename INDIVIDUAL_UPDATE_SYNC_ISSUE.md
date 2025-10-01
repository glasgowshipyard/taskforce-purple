# Individual Member Update Sync Issue - Task Force Purple API

**Date**: 2025-10-01
**Issue**: Individual member updates don't sync to main storage, making them invisible on the website
**Severity**: High - Feature is functionally broken

## Problem Summary

The individual member update system (`/api/update-member/@username`) processes data correctly but doesn't integrate with the main dataset that powers the website. This creates a critical disconnect between individual updates and site visibility.

## Technical Analysis

### Current Architecture Flaw

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│ Individual Updates  │    │ Smart Batch Updates  │    │ Website Display │
│ /api/update-member  │    │ /api/update-data     │    │ /api/members    │
└─────────────────────┘    └──────────────────────┘    └─────────────────┘
           │                           │                           │
           │                           │                           │
           ▼                           ▼                           │
    ┌──────────────┐           ┌──────────────────┐                │
    │ Isolated     │           │ Main Storage     │◄───────────────┘
    │ Processing   │           │ members:all      │
    │ (Orphaned)   │           │ (KV)             │
    └──────────────┘           └──────────────────┘
```

### Evidence from Testing

**Bernie Sanders Individual Update:**
- ✅ **API Call Successful**: `/api/update-member/@sensanders`
- ✅ **Data Processed**: $8.2M raised, 47% grassroots, Tier B
- ✅ **PAC Enhancement**: 20 contributions with metadata
- ❌ **Website Visibility**: Still shows $0 raised, Tier "N/A"

**Lindsey Graham Smart Batch Update:**
- ✅ **API Call Successful**: Processed via `/api/update-data`
- ✅ **Data Processed**: $4.5M raised, Tier S
- ✅ **Website Visibility**: Shows correctly on site

### Storage Investigation

```bash
# Main API (website data source)
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | \
  jq '.members[] | select(.name | contains("Sanders"))'

# Result: {name: "Sanders, Bernard", tier: "N/A", totalRaised: 0, lastUpdated: "2025-09-29"}
```

**Individual update data exists somewhere but not in `members:all` KV storage.**

## Root Cause Analysis

### 1. Individual Update Processing Flow
- ✅ Handle lookup: `@sensanders` → bioguide `S000033`
- ✅ Financial data fetch: FEC API calls successful
- ✅ PAC enhancement: Committee metadata applied
- ✅ Tier calculation: Enhanced algorithm working
- ❌ **Missing**: Merge updated data back to `members:all` storage

### 2. Smart Batch Processing Flow
- ✅ Process multiple members efficiently
- ✅ Update `members:all` storage directly
- ✅ Maintain main dataset integrity
- ✅ Website immediately reflects changes

### 3. Tier Recalculation System
- ✅ Reads from `members:all` storage
- ✅ Recalculates tiers from existing data
- ❌ **Limitation**: Can't recalculate data that isn't in main storage

## Required Fix Architecture

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│ Individual Updates  │    │ Smart Batch Updates  │    │ Website Display │
│ /api/update-member  │    │ /api/update-data     │    │ /api/members    │
└─────────────────────┘    └──────────────────────┘    └─────────────────┘
           │                           │                           │
           │                           │                           │
           ▼                           ▼                           │
    ┌──────────────────────────────────────────────────┐          │
    │           Main Storage Sync                      │          │
    │           members:all (KV)                       │◄─────────┘
    └──────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Auto Tier Recalc    │
                    │ Update site data    │
                    └─────────────────────┘
```

## Implementation Requirements

### 1. Individual Update Storage Integration

**Current Code Location**: `workers/data-pipeline.js:1484+` (handleUpdateMember function)

**Required Changes**:
```javascript
async function handleUpdateMember(env, corsHeaders, request) {
  // ... existing processing logic ...

  // MISSING: Merge updated member back to main storage
  const existingMembers = await env.MEMBER_DATA.get('members:all');
  const membersArray = existingMembers ? JSON.parse(existingMembers) : [];

  // Find and replace or add updated member
  const memberIndex = membersArray.findIndex(m => m.bioguideId === updatedMember.bioguideId);
  if (memberIndex >= 0) {
    membersArray[memberIndex] = updatedMember;
  } else {
    membersArray.push(updatedMember);
  }

  // Save back to main storage
  await env.MEMBER_DATA.put('members:all', JSON.stringify(membersArray));

  // Trigger tier recalculation for immediate site sync
  await recalculateTiersFromMainStorage(env);
}
```

### 2. Automatic Tier Recalculation

**Current Behavior**: Manual recalculation required
**Required Behavior**: Auto-recalculate after individual updates

**Implementation**:
- Individual updates should trigger tier recalculation automatically
- Ensure updated member appears on website immediately
- Maintain data consistency across all endpoints

### 3. Smart Batch Integration

**Current Status**: Smart batch works correctly
**Enhancement**: Ensure smart batch also triggers recalculation
**Benefit**: Consistent behavior across both update methods

## Testing Verification

### Before Fix
```bash
# Individual update
curl -X POST "/api/update-member/@sensanders" -H "Authorization: Bearer ..."
# Result: Data processed but not visible on site

# Website check
curl -s "/api/members" | jq '.members[] | select(.name | contains("Sanders"))'
# Result: Still shows old data (Tier "N/A", $0 raised)
```

### After Fix (Expected)
```bash
# Individual update
curl -X POST "/api/update-member/@sensanders" -H "Authorization: Bearer ..."
# Result: Data processed AND automatically synced to main storage

# Website check (immediate)
curl -s "/api/members" | jq '.members[] | select(.name | contains("Sanders"))'
# Result: Shows updated data (Tier "B", $8.2M raised)
```

## Priority Classification

**Impact**: High - Individual updates are functionally useless without site integration
**Effort**: Medium - Requires storage merge logic and auto-recalculation
**Risk**: Low - Enhancement to existing working systems

## Current Workaround

1. Use individual member updates for data processing verification
2. Rely on smart batch processing for website-visible updates
3. Manual tier recalculation after bulk changes

**Note**: This workaround makes individual updates unsuitable for production use cases where immediate site visibility is required.

---

## Next Steps

1. Implement storage merge logic in individual update handler
2. Add automatic tier recalculation trigger
3. Test end-to-end workflow: individual update → storage sync → site visibility
4. Verify no regression in smart batch processing behavior
5. Update documentation to reflect unified update behavior

**Goal**: Make individual member updates immediately visible on the website, matching the behavior users would expect from a functional system.