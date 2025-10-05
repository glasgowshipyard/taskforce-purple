# Tier Calculation Guide: Funding Diffusion Model

## Philosophy

Tiers reflect **funding diffusion** - whether a member's power comes from:
- **Democratic**: Many small donors with distributed influence
- **Concentrated**: Wealthy individuals, corporations, or special interests

The tier system penalizes funding concentration to identify who serves voters vs who serves money.

---

## Tier Formula

**Base Tier** = Grassroots % (donations <$200)
**Adjusted Tier** = Base tier thresholds + Transparency Penalty

### Base Thresholds
- S: 90%+ grassroots
- A: 75-89%
- B: 60-74%
- C: 45-59%
- D: 30-44%
- E: 15-29%
- F: 0-14%

---

## Transparency Penalty System

Members with concerning funding sources need *higher* grassroots % to reach the same tier.

### Large Individual Donations (>$200)
**Weight**: 0.3x
**Rationale**: Class concentration - wealthy donor access and influence
**Not counted**: Only donations >$200 are penalized

### PAC Contributions

#### Committee Type Weights
| Type | Weight | Meaning |
|------|--------|---------|
| `O` (Super PAC) | 2.0x | Dark money, independent expenditures |
| `P` (Candidate) | 0.15x | Candidate's own committee (85% discount) |
| Default | 1.0x | Standard PAC |

#### Designation Weights
| Designation | Weight | Meaning |
|-------------|--------|---------|
| `D` (Leadership PAC) | 1.5x | Politician-controlled influence network |
| `B` (Lobbyist PAC) | 1.5x | Corporate/industry lobbying arm |
| `P` (Principal) | 0.15x | Principal campaign committee |
| `A` (Authorized) | 0.15x | Authorized by candidate |
| `U` (Unauthorized) | 1.0x | Standard PAC |

**Note**: Type and designation weights **multiply**. A Super PAC with lobbyist designation = 2.0 × 1.5 = 3.0x penalty.

---

## Penalty Calculation

```javascript
// Step 1: Calculate weighted concerning money
let weightedConcerning = 0;

// Large donors
if (largeDonorDonations exists) {
  weightedConcerning += largeDonorDonations * 0.3;
}

// PACs (only weights > 1.0 count as concerning)
for (each PAC contribution) {
  weight = getPACWeight(type, designation);
  if (weight > 1.0) {
    weightedConcerning += amount * weight;
  }
}

// Step 2: Calculate penalty points
penaltyPercent = (weightedConcerning / totalRaised) * 100;
penaltyPoints = Math.min(Math.floor(penaltyPercent), 30); // Max 30

// Step 3: Adjust thresholds
S_threshold = 90 + penaltyPoints
A_threshold = 75 + penaltyPoints
B_threshold = 60 + penaltyPoints
C_threshold = 45 + penaltyPoints
D_threshold = 30 + penaltyPoints
E_threshold = 15 + penaltyPoints
```

---

## Example: Dina Titus

**Funding Breakdown**:
- Total: $2,436,549
- Grassroots (<$200): $167,477 (7%)
- Large donors (>$200): $1,201,611 (49%)
- PACs: $100,000 (4%)

**Penalty Calculation**:
1. Large donor penalty: $1,201,611 × 0.3 = $360,483
2. PAC penalty (avg 1.5x weight): $100,000 × 1.5 = $150,000
3. Total weighted: $510,483
4. Penalty %: ($510,483 / $2,436,549) × 100 = 21%
5. Penalty points: 21

**Tier Assignment**:
- E tier threshold: 15 + 21 = **36% grassroots required**
- Actual grassroots: 7%
- 7% < 36% → **F tier**

**Interpretation**: Wine-track Democrat profile. Low grassroots, high large donor concentration, minimal PAC reliance. Still F tier due to class concentration, but different from corporate PAC capture.

---

## API Fields

### Core Data
- `grassrootsDonations`: FEC `individual_unitemized_contributions` (<$200)
- `largeDonorDonations`: FEC `individual_itemized_contributions` (>$200)
- `pacMoney`: Sum of `pacContributions` amounts (corrected from FEC totals)
- `totalRaised`: FEC `receipts`

### Display Fields
- `grassrootsPercent`: Calculated from `grassrootsDonations / totalRaised`
- `tier`: Final tier after penalty adjustments
- `rawFECGrassrootsPercent`: Original FEC calculation for reference
- `hasEnhancedData`: Boolean indicating PAC metadata available
- `grassrootsPACTypes`: Array of friendly PAC types (candidate committees, etc.)

### PAC Metadata
Each PAC contribution includes:
- `committee_type`: FEC committee type code
- `designation`: FEC designation code
- `transparency_weight`: Calculated penalty weight
- `weighted_amount`: Amount × weight (for penalty calculation)
- `committee_category`: Human-readable category

---

## Frontend Display

### Member Profile Cards
Show 4-part breakdown:
1. **Grassroots (<$200)**: Green/red based on %
2. **Large Donors (>$200)**: Orange (class concentration signal)
3. **PACs**: Red (institutional influence)
4. **Total Raised**: Purple

### Tier Badge
- Display tier letter (S/A/B/C/D/E/F)
- Color-coded by tier
- Tooltip explains penalty system

### Explanation Box
Include in member details:
- How tiers reflect funding diffusion
- Penalty weights for large donors and PAC types
- Member-specific penalty calculation

---

## Important Notes

1. **Never use hardcoded PAC name patterns** - always use FEC metadata (`committee_type`, `designation`)
2. **Phase 2 recalculates pacMoney** - FEC totals endpoint can be wrong, trust Schedule A itemized data
3. **Large donors are not neutral** - 0.3x penalty reflects class concentration even without PACs
4. **Candidate committees get discounts** - personal campaign apparatus is less concerning than external PACs
5. **Super PACs are maximally penalized** - dark money independent expenditures = 2.0x base weight
