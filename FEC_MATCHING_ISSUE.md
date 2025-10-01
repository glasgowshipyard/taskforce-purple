# 🚨 CRITICAL: FEC Candidate Matching Data Integrity Issue

**Date**: 2025-10-01
**Severity**: HIGH - Affects data accuracy across all members
**Status**: IDENTIFIED - Needs immediate fix

## Issue Summary

The FEC candidate lookup is matching the wrong candidates, leading to incorrect financial data and tier assignments.

### Specific Case Identified

**Expected**: Lindsey Graham (R-SC, Senate)
- **Committee ID**: S0SC00149
- **Office**: U.S. Senate from South Carolina

**Actually Matched**: Allen Graham (Different candidate)
- **Committee ID**: C00779579
- **Wrong candidate entirely**

### Impact

- **Tier assignments completely invalid** for affected members
- **Grassroots percentages wrong** - pulling data from different candidates
- **User trust compromised** - system showing false information
- **Unknown scope** - could affect many members with common names

## Root Cause Analysis

### Current FEC Lookup Logic Problems

1. **Name-only matching** - searches by name without state/chamber validation
2. **No verification** that matched committee belongs to correct candidate
3. **Missing disambiguation** for common names (Graham, Johnson, Smith, etc.)
4. **Insufficient logging** - can't verify which candidate was actually matched

### Code Location

**File**: `workers/data-pipeline.js`
**Lines**: 165, 187
**Function**: `updateMemberFinancialData()`

### Exact Root Cause

**Line 165**: FEC search API call CORRECTLY includes state + office filters:
```javascript
`https://api.open.fec.gov/v1/candidates/search/?api_key=${apiKey}&q=${encodeURIComponent(member.name.split(',')[0])}&office=${office}&state=${stateAbbr}`
```

**Line 187**: BUT then blindly takes first result WITHOUT validation:
```javascript
const candidate = searchData.results[0];  // ← CRITICAL BUG
```

**Problem**: Even though the search filters by state/office, multiple candidates can still be returned (e.g., current + past candidates), and the code just takes `results[0]` without verifying it's the right person.

## Required Fixes

### 1. Enhanced Matching Criteria
```javascript
// Current (broken): Match by name only
const candidates = await fetchFECCandidates(name);

// Fixed: Match by name + state + office
const candidates = await fetchFECCandidates({
  name: member.name,
  state: member.state,
  office: member.chamber === 'House' ? 'H' : 'S'
});
```

### 2. Committee ID Validation
```javascript
// Validate committee ID pattern matches expected office
if (member.chamber === 'Senate' && !committeeId.startsWith('S')) {
  console.warn(`Committee ID ${committeeId} doesn't match Senate pattern for ${member.name}`);
  return null;
}
```

### 3. Enhanced Logging
```javascript
console.log(`✅ FEC Match: ${member.name} (${member.state}-${member.chamber}) → ${candidate.name} (ID: ${candidate.candidate_id}, Committee: ${committeeId})`);
```

## Immediate Actions Needed

1. **STOP current data processing** - tier assignments are invalid
2. **Fix FEC matching logic** in data-pipeline.js
3. **Re-run data collection** for all members with enhanced matching
4. **Audit existing data** to identify other incorrect matches
5. **Add validation checks** to prevent future mismatches

## Testing Strategy

### Before Fix
- Document current Lindsey Graham data (committee ID, amounts)
- Identify other suspicious tier assignments

### After Fix
- Verify Lindsey Graham matches S0SC00149 (correct Senate committee)
- Spot-check other senators with common names
- Validate tier assignments make intuitive sense

## Affected Members (Suspected)

Members with common last names likely affected:
- **Graham** (Lindsey vs Allen)
- **Johnson** (multiple candidates)
- **Smith** (multiple candidates)
- **Brown** (multiple candidates)
- **Miller** (multiple candidates)

## Data Integrity Checklist

- [ ] Fix FEC candidate matching logic
- [ ] Add state + chamber validation
- [ ] Implement committee ID pattern validation
- [ ] Enhanced logging for match verification
- [ ] Re-process all member data
- [ ] Audit tier assignments for sanity
- [ ] Add automated validation checks
- [ ] Document fixed matching criteria

---

**Priority**: 🔥 CRITICAL - All current tier data is potentially invalid until this is fixed.