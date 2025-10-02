# F-Tier Enhancement: Corporate Capture Classification

**Date**: 2025-10-01
**Priority**: MEDIUM - Quality of Life Improvement
**Status**: PROPOSED - Needs Implementation Assessment

## Issue Summary

Currently, the most corporate-captured members (0-5% grassroots funding) are lumped into D-tier with members who have 6-19% grassroots funding. This doesn't adequately distinguish between "mostly corporate" and "completely corporate-captured" representatives.

## Proposed Solution

### **New Tier Structure:**
- **S-tier**: 80%+ grassroots (People-powered champions)
- **A-tier**: 60-79% grassroots (Mostly grassroots)
- **B-tier**: 40-59% grassroots (Mixed funding)
- **C-tier**: 20-39% grassroots (Corporate-leaning)
- **D-tier**: 6-19% grassroots (Mostly corporate)
- **F-tier**: 0-5% grassroots (Completely corporate-captured)

### **Target Use Case:**
**Lindsey Graham** - Currently showing 22% grassroots (D-tier) but with enhanced transparency penalties, members like him often have 0% grassroots and deserve the F-tier designation for complete corporate capture.

## Technical Implementation Scope

### **Backend Changes Required:**

#### 1. **Tier Calculation Logic** (`workers/data-pipeline.js`)
```javascript
// Current thresholds (lines ~612-618)
const thresholds = { S: 80, A: 60, B: 40, C: 20, D: 0 };

// Proposed thresholds
const thresholds = { S: 80, A: 60, B: 40, C: 20, D: 6, F: 0 };
```

#### 2. **Enhanced Tier Function** (lines ~637-641)
```javascript
// Current
if (actualGrassrootsPercent >= adjustedThresholds.S) return 'S';
if (actualGrassrootsPercent >= adjustedThresholds.A) return 'A';
if (actualGrassrootsPercent >= adjustedThresholds.B) return 'B';
if (actualGrassrootsPercent >= adjustedThresholds.C) return 'C';
return 'D';

// Proposed
if (actualGrassrootsPercent >= adjustedThresholds.S) return 'S';
if (actualGrassrootsPercent >= adjustedThresholds.A) return 'A';
if (actualGrassrootsPercent >= adjustedThresholds.B) return 'B';
if (actualGrassrootsPercent >= adjustedThresholds.C) return 'C';
if (actualGrassrootsPercent >= adjustedThresholds.D) return 'D';
return 'F';
```

#### 3. **Standard Tier Function** (lines ~609-615)
Similar updates needed for the fallback tier calculation.

### **Frontend Changes Required:**

#### 1. **Tier Sorting** (`src/components/MembersList.jsx:132`)
```javascript
// Current
const tierOrder = { 'S': 6, 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'N/A': 1 };

// Proposed
const tierOrder = { 'S': 7, 'A': 6, 'B': 5, 'C': 4, 'D': 3, 'F': 2, 'N/A': 1 };
```

#### 2. **Tier Badge Styling**
Need to add F-tier styling (likely red to match corporate capture theme).

#### 3. **Showcase Logic** (lines ~95-125)
Add F-tier to the showcase page member selection.

### **Potential Complexity Factors:**

#### **🟢 LOW COMPLEXITY:**
- Basic threshold updates
- Tier comparison logic
- Frontend sorting

#### **🟡 MEDIUM COMPLEXITY:**
- Ensuring all tier references are updated consistently
- Testing edge cases around 5-6% threshold
- Visual design for F-tier badges

#### **🔴 HIGH COMPLEXITY:**
- Historical data migration (if needed)
- Performance impact of additional tier
- User education about new tier

## Expected Benefits

### **User Experience:**
- **Clear distinction** between "mostly corporate" (D) vs "completely captured" (F)
- **Better accountability** for representatives with 0% grassroots funding
- **Motivational effect** - F-tier creates strong incentive for transparency

### **Data Accuracy:**
- **Granular classification** of corporate capture levels
- **Proper labeling** for members like Lindsey Graham (0% grassroots)
- **Enhanced transparency** in funding source representation

## Implementation Risks

### **Low Risk:**
- **Backward compatibility** - existing tiers remain unchanged
- **User confusion** - F-tier clearly indicates worst performance
- **Performance impact** - minimal additional computation

### **Medium Risk:**
- **Threshold tuning** - may need adjustment based on real data distribution
- **Frontend complexity** - ensuring all UI components handle F-tier

## Testing Strategy

### **Before Implementation:**
1. **Analyze current D-tier distribution** - how many would become F-tier?
2. **Identify test cases** - Lindsey Graham, other 0% grassroots members
3. **Review UI mockups** - ensure F-tier styling is appropriate

### **After Implementation:**
1. **Verify tier assignments** - check that thresholds work correctly
2. **Test edge cases** - members right at 5-6% boundary
3. **UI testing** - ensure all views handle F-tier properly

## Success Metrics

- **F-tier population**: 5-15 members (corporate-captured representatives)
- **User clarity**: Clear visual distinction between D and F tiers
- **System stability**: No performance degradation
- **Data accuracy**: Proper classification of 0% grassroots members

---

**Next Steps:**
1. **Technical assessment** - review implementation complexity
2. **Design review** - determine F-tier visual styling
3. **Implementation plan** - backend first, then frontend
4. **Testing plan** - ensure robust tier classification

**Priority**: Implement after current data quality fixes are stable.
