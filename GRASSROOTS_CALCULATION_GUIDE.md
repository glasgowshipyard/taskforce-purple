# Grassroots Percentage Calculation Guide - Task Force Purple

**Date**: 2025-10-01
**Purpose**: Explain how enhanced grassroots percentages are calculated and which committee types are considered grassroots-friendly

## Enhanced vs. Raw FEC Data

The Task Force Purple API now displays **enhanced grassroots percentages** for members with detailed PAC contribution metadata, providing more accurate transparency ratings than raw FEC data.

### Display Logic

- **Members with enhanced PAC data**: Show enhanced grassroots percentage (calculated from actual PAC contributions)
- **Members without enhanced PAC data**: Show raw FEC grassroots percentage (fallback)
- **API fields**:
  - `grassrootsPercent`: Enhanced calculation (when available) or raw FEC data (fallback)
  - `rawFECGrassrootsPercent`: Original FEC percentage for reference
  - `hasEnhancedData`: Boolean indicating if enhanced calculation was used

### Example: Martin Heinrich

- **Enhanced grassroots percentage**: 91% (calculated from PAC data)
- **Raw FEC grassroots percentage**: 13% (incorrect FEC calculation)
- **Enhanced data available**: true
- **Tier**: S (correctly calculated from enhanced data)

## Committee Types & Transparency Weights

The enhanced algorithm assigns **transparency weights** to different committee types and designations to determine how "concerning" each PAC contribution is relative to grassroots funding.

### Weight Scale
- **< 1.0**: More grassroots-friendly (reduces concern)
- **1.0**: Neutral PAC (baseline concern)
- **> 1.0**: More concerning (increases transparency penalty)

### Committee Type Classifications

#### Committee Types (Primary)

| Type | Name | Weight Multiplier | Grassroots-Friendly |
|------|------|------------------|-------------------|
| **P** | Candidate Committee | **0.3x** | ✅ **Yes** (70% less concerning) |
| **O** | Super PAC | **2.0x** | ❌ **No** (2x more concerning) |
| **Q** | Qualified PAC | **1.0x** | ⚖️ Neutral |
| **N** | Nonqualified PAC | **1.0x** | ⚖️ Neutral |

#### Designation Types (Secondary)

| Designation | Name | Weight Multiplier | Grassroots-Friendly |
|-------------|------|------------------|-------------------|
| **P** | Personal/Candidate PAC | **0.15x** | ✅ **Yes** (85% less concerning) |
| **A** | Authorized Committee | **0.15x** | ✅ **Yes** (85% less concerning) |
| **D** | Leadership PAC | **1.5x** | ❌ **No** (50% more concerning) |
| **B** | Lobbyist PAC | **1.5x** | ❌ **No** (50% more concerning) |
| **U** | Unauthorized PAC | **1.0x** | ⚖️ Neutral |

### Combined Weight Calculation

Weights are **multiplied together** for committees with both type and designation:

```javascript
// Example: Candidate committee with personal designation
committee_type = 'P' (0.3x) × designation = 'P' (0.15x) = 0.045x total weight
// This makes personal candidate committees highly grassroots-friendly

// Example: Super PAC with leadership designation
committee_type = 'O' (2.0x) × designation = 'D' (1.5x) = 3.0x total weight
// This makes leadership Super PACs highly concerning
```

## Grassroots-Friendly Committee Categories

### ✅ **Highly Grassroots-Friendly** (Weight < 0.5x)
- **Candidate Committees (P + P)**: 0.045x weight
- **Candidate Committees (P + A)**: 0.045x weight
- **Personal PACs (any + P)**: 0.15x weight
- **Authorized Committees (any + A)**: 0.15x weight

*These contributions are treated as essentially grassroots funding because they represent the candidate's own fundraising apparatus or personal political committees.*

### ⚖️ **Neutral** (Weight = 1.0x)
- **Standard PACs (Q, N)** without special designations
- **Unauthorized PACs (U)**

*These are treated as typical PAC contributions - concerning but not especially problematic.*

### ❌ **Concerning** (Weight > 1.0x)
- **Super PACs (O)**: 2.0x weight
- **Leadership PACs (D)**: 1.5x weight
- **Lobbyist PACs (B)**: 1.5x weight
- **Leadership Super PACs (O + D)**: 3.0x weight

*These represent institutional/corporate influence and are weighted more heavily in transparency calculations.*

## Enhanced Calculation Process

### Step 1: Calculate Actual PAC Total
```javascript
const actualPACTotal = member.pacContributions.reduce((sum, pac) => sum + pac.amount, 0);
```

### Step 2: Calculate Base Grassroots Percentage
```javascript
const actualGrassrootsPercent = ((member.totalRaised - actualPACTotal) / member.totalRaised) * 100;
```

### Step 3: Apply Transparency Penalty (for tier calculation only)
```javascript
// Calculate weighted concerning contributions
let concerningPACMoney = 0;
for (const pac of member.pacContributions) {
  const weight = getPACTransparencyWeight(pac.committee_type, pac.designation);
  if (weight > 1.0) { // Only concerning PACs contribute to penalty
    concerningPACMoney += pac.amount * weight;
  }
}

// Apply penalty to tier thresholds
const transparencyPenalty = Math.min(Math.floor((concerningPACMoney / member.totalRaised) * 100), 15);
const adjustedThresholds = {
  S: 85 + transparencyPenalty,
  A: 70 + transparencyPenalty,
  // ... etc
};
```

## Real-World Examples

### Heinrich's Personal PACs (Grassroots-Friendly)
- **Committee Type**: P (Candidate Committee) = 0.3x
- **Designation**: P (Personal PAC) = 0.15x
- **Combined Weight**: 0.3 × 0.15 = **0.045x** (highly grassroots-friendly)
- **Result**: Personal committees treated as ~95% grassroots funding

### Corporate Super PAC (Concerning)
- **Committee Type**: O (Super PAC) = 2.0x
- **Designation**: None = 1.0x
- **Combined Weight**: 2.0 × 1.0 = **2.0x** (more concerning)
- **Result**: Super PAC contributions weighted as 2x more problematic

### Leadership Super PAC (Highly Concerning)
- **Committee Type**: O (Super PAC) = 2.0x
- **Designation**: D (Leadership PAC) = 1.5x
- **Combined Weight**: 2.0 × 1.5 = **3.0x** (highly concerning)
- **Result**: These contributions trigger maximum transparency penalties

## API Integration

### Current Implementation
The enhanced grassroots percentage is now displayed by default in the `/api/members` endpoint for all members with PAC metadata.

### Frontend Display Recommendations
1. **Primary Display**: Use `grassrootsPercent` (enhanced calculation)
2. **Detail View**: Show both `grassrootsPercent` and `rawFECGrassrootsPercent` for transparency
3. **Indicator**: Use `hasEnhancedData` to show when enhanced calculation is active
4. **Tooltip**: Explain that enhanced percentages account for committee transparency weights

### Benefits
- **More Accurate**: Personal/candidate committees properly treated as grassroots
- **Greater Transparency**: Super PACs and leadership PACs appropriately flagged
- **Consistent Tiers**: Enhanced algorithm ensures tier assignments match actual funding sources
- **Educational**: Helps users understand different types of political committees

---

**Key Insight**: The enhanced algorithm recognizes that not all "PAC" contributions are equal - personal candidate committees are fundamentally different from corporate Super PACs in terms of grassroots authenticity.