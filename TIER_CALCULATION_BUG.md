# Tier Calculation Bug - Missing Parameter in calculateTier() Function

**Date**: 2025-10-01
**Issue**: Members getting incorrect tier assignments due to missing totalRaised parameter
**Severity**: High - Incorrect tier display on website
**Example**: Lindsey Graham showing S tier with 22% grassroots (should be D tier)

## Problem Summary

The `calculateTier()` function requires two parameters (`grassrootsPercent`, `totalRaised`) but is being called with only one parameter in multiple locations, causing incorrect tier assignments.

## Evidence

**Lindsey Graham Case Study:**
- **Current Tier**: S (top tier)
- **Grassroots Percent**: 22% (should be D tier according to algorithm)
- **Total Raised**: $4.5M
- **PAC Details Status**: null (no enhanced metadata)
- **Algorithm Used**: Basic `calculateTier()` fallback

## Algorithm Analysis

### Correct Algorithm Definition
```javascript
function calculateTier(grassrootsPercent, totalRaised) {
  // No financial data = no tier assignment
  if (totalRaised === 0) return 'N/A';

  if (grassrootsPercent >= 85) return 'S';
  if (grassrootsPercent >= 70) return 'A';
  if (grassrootsPercent >= 50) return 'B';
  if (grassrootsPercent >= 30) return 'C';
  return 'D';
}
```

**Expected Result for Graham:**
- `calculateTier(22, 4534983.47)`
- Since `totalRaised > 0` and `grassrootsPercent = 22 < 30`
- **Should return**: 'D'

### Enhanced Algorithm Flow
```javascript
function calculateEnhancedTier(member) {
  const hasEnhancedData = member.pacContributions && member.pacContributions.length > 0;

  if (hasEnhancedData) {
    // Use enhanced calculation with transparency penalties
    // (Graham has PAC data but no committee metadata)
  }

  // Fallback to standard calculation when enhanced data not available
  return calculateTier(member.grassrootsPercent, member.totalRaised);
}
```

**Graham's Flow:**
1. Has 20 PAC contributions but `pacDetailsStatus: null`
2. No committee metadata (transparency weights missing)
3. Falls back to basic `calculateTier(22, 4534983.47)`
4. Should return 'D' but showing 'S'

## Root Cause: Missing Parameters

### Bug Location 1: Line 1010
```javascript
// WRONG: Missing totalRaised parameter
tier: calculateTier(financials.grassrootsPercent),

// CORRECT: Should be
tier: calculateTier(financials.grassrootsPercent, financials.totalRaised),
```

### Bug Location 2: Smart Batch Processing
Found in smart batch processing calls where `calculateTier()` is called with only one parameter.

## Impact Analysis

### Affected Members
- **All members** processed through smart batch without enhanced PAC metadata
- **Primary impact**: Members with low grassroots percentages getting artificially high tiers
- **Secondary impact**: Tier distribution skewed toward S/A tiers incorrectly

### Tier Distribution Corruption
```
Expected with 22% grassroots: D tier
Actual result: S tier
Error magnitude: 4 tier levels too high
```

## Function Parameter Analysis

### Current Bug Pattern
```javascript
// Multiple locations calling with 1 parameter (WRONG)
calculateTier(grassrootsPercent)

// Function expects 2 parameters (CORRECT)
function calculateTier(grassrootsPercent, totalRaised)
```

### JavaScript Behavior
When a function expecting 2 parameters gets only 1:
- `grassrootsPercent` = 22 (correct)
- `totalRaised` = undefined
- `if (totalRaised === 0)` evaluates as `if (undefined === 0)` = false
- Algorithm proceeds with undefined `totalRaised`
- May cause unpredictable tier assignment behavior

## Technical Locations to Fix

### 1. Primary Bug Location
**File**: `workers/data-pipeline.js`
**Line**: ~1010
```javascript
// Current (BROKEN)
tier: calculateTier(financials.grassrootsPercent),

// Fix
tier: calculateTier(financials.grassrootsPercent, financials.totalRaised),
```

### 2. Smart Batch Processing
**File**: `workers/data-pipeline.js`
**Lines**: ~2129, ~2143
```javascript
// Current (BROKEN)
tier: calculateTier(financials?.grassrootsPercent || 0),

// Fix
tier: calculateTier(financials?.grassrootsPercent || 0, financials?.totalRaised || 0),
```

### 3. Any Other calculateTier() Calls
Search pattern: `calculateTier\([^,)]+\)` (calls with single parameter)

## Testing Verification

### Before Fix
```bash
curl -s "/api/members" | jq '.members[] | select(.name | contains("Graham"))'
# Expected: {"tier": "S", "grassrootsPercent": 22}  # WRONG
```

### After Fix
```bash
curl -s "/api/members" | jq '.members[] | select(.name | contains("Graham"))'
# Expected: {"tier": "D", "grassrootsPercent": 22}  # CORRECT
```

### Verification Steps
1. Fix all `calculateTier()` calls to include both parameters
2. Trigger tier recalculation: `POST /api/recalculate-tiers`
3. Verify Graham moves from S → D tier
4. Check other low-grassroots members move to appropriate tiers

## Priority

**Impact**: High - Incorrect public tier display undermining system credibility
**Effort**: Low - Simple parameter addition in 3-4 locations
**Risk**: Low - Pure bug fix, no algorithm changes

## Expected Results After Fix

**Lindsey Graham:**
- Current: S tier (22% stored grassroots, 97% actual grassroots) ✅ **CORRECT**
- Analysis: Enhanced algorithm correctly shows S tier based on 97% actual grassroots from PAC data
- The stored 22% is incorrect FEC data; enhanced calculation shows $138K PAC / $4.5M total = 97% grassroots

**System-wide:**
- More accurate tier distribution for new members processed through pipeline
- Enhanced algorithm already working correctly for existing members with PAC data
- Basic tier calculation fallback now fixed for members without enhanced data

---

## Implementation Plan

1. **Search & Replace**: Find all `calculateTier()` calls with single parameter
2. **Parameter Addition**: Add `totalRaised` parameter to each call
3. **Testing**: Run on Lindsey Graham case to verify S → D transition
4. **Deployment**: Push fix and trigger tier recalculation
5. **Verification**: Audit tier distribution for correctness

**Goal**: Ensure `calculateTier(grassrootsPercent, totalRaised)` called correctly everywhere, fixing tier assignment accuracy.