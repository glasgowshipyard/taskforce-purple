# Tier Calculation Guide: Funding Diffusion Model

## Philosophy

Tiers reflect **funding diffusion** - whether a member's power comes from:
- **Democratic**: Many small donors with distributed influence
- **Concentrated**: Wealthy individuals, corporations, or special interests

The tier system distinguishes between **individual support** (grassroots + itemized) and **institutional capture** (PAC money).

---

## Tier Formula

**Individual Funding %** = Grassroots % + Itemized % - Concentration Penalty
**Adjusted Tier** = Individual Funding % vs (Base Thresholds + PAC Penalty)

### Base Thresholds
- S: 90%+ individual funding
- A: 75-89%
- B: 60-74%
- C: 45-59%
- D: 30-44%
- E: 15-29%
- F: 0-14%

---

## Individual Funding Model

### Grassroots Donations (<$200)
**Weight**: 1.0x (full credit)
**Rationale**: Small-dollar donations from ordinary people

### Itemized Donations (>$200)
**Base Weight**: 1.0x (full credit)
**Rationale**: FEC $200 threshold is a *reporting requirement*, not a wealth indicator
- $201 donation from a teacher is not "elite capture"
- $250 from a nurse is still grassroots-adjacent
- Only extreme *concentration* of itemized donations signals concern

### Concentration Penalty (Adaptive)

Itemized donations only penalized if they represent **unusual concentration** relative to political finance norms.

**Adaptive Threshold**: 70th percentile of itemized % across all members (currently ~40%, clamped 25-40%)
- Recalculated each cycle from actual distribution
- Grounded in empirical data, not arbitrary cutoffs
- Power-law distribution in political finance requires percentile-based approach

**Tiered Penalty Structure** (only if itemized % > adaptive threshold):
- **Excess 0-5%** (e.g., 40-45%): 0.1x penalty per percentage point
- **Excess 5-10%** (e.g., 45-50%): 0.2x penalty per percentage point
- **Excess 10%+** (e.g., 50%+): 0.3x penalty per percentage point

**Example**: If adaptive threshold is 40% and member has 53% itemized:
- First 5% excess: 5 × 0.1 = 0.5 penalty points
- Next 5% excess: 5 × 0.2 = 1.0 penalty points
- Remaining 3%: 3 × 0.3 = 0.9 penalty points
- **Total concentration penalty**: 2.4 percentage points

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

## Complete Calculation Flow

```javascript
// Step 1: Calculate individual funding base
grassrootsPercent = (grassrootsDonations / totalRaised) * 100;
itemizedPercent = (largeDonorDonations / totalRaised) * 100;
individualFundingPercent = grassrootsPercent + itemizedPercent;

// Step 2: Compute adaptive threshold (70th percentile of all members)
allItemizedPercents = allMembers
  .filter(m => m.totalRaised > 0 && m.largeDonorDonations !== null)
  .map(m => (m.largeDonorDonations / m.totalRaised) * 100)
  .sort((a, b) => a - b);

index = Math.floor(allItemizedPercents.length * 0.7);
adaptiveThreshold = allItemizedPercents[index];
adaptiveThreshold = Math.min(Math.max(adaptiveThreshold, 25), 40); // Clamp 25-40%

// Step 3: Apply itemization concentration penalty
if (itemizedPercent > adaptiveThreshold) {
  excess = itemizedPercent - adaptiveThreshold;

  if (excess <= 5) {
    itemizationPenalty = excess * 0.1;
  } else if (excess <= 10) {
    itemizationPenalty = (5 * 0.1) + ((excess - 5) * 0.2);
  } else {
    itemizationPenalty = (5 * 0.1) + (5 * 0.2) + ((excess - 10) * 0.3);
  }

  individualFundingPercent -= itemizationPenalty;
}

// Step 4: Calculate PAC transparency penalty
let weightedConcerningPACs = 0;
for (each PAC contribution) {
  weight = getPACWeight(type, designation);
  if (weight > 1.0) {
    weightedConcerningPACs += amount * weight;
  }
}
pacPenaltyPercent = (weightedConcerningPACs / totalRaised) * 100;
pacPenaltyPoints = Math.min(Math.floor(pacPenaltyPercent), 30); // Max 30

// Step 5: Adjust thresholds with PAC penalty
S_threshold = 90 + pacPenaltyPoints
A_threshold = 75 + pacPenaltyPoints
B_threshold = 60 + pacPenaltyPoints
C_threshold = 45 + pacPenaltyPoints
D_threshold = 30 + pacPenaltyPoints
E_threshold = 15 + pacPenaltyPoints

// Step 6: Assign tier
if (individualFundingPercent >= S_threshold) tier = 'S';
else if (individualFundingPercent >= A_threshold) tier = 'A';
else if (individualFundingPercent >= B_threshold) tier = 'B';
else if (individualFundingPercent >= C_threshold) tier = 'C';
else if (individualFundingPercent >= D_threshold) tier = 'D';
else if (individualFundingPercent >= E_threshold) tier = 'E';
else tier = 'F';
```

---

## Examples

### Example 1: AOC (High Individual, Minimal PAC)

**Funding Breakdown**:
- Total: $4,300,000
- Grassroots (<$200): $2,967,000 (69%)
- Itemized (>$200): $1,204,000 (28%)
- PACs: $17,200 (0.4%)

**Calculation** (with 40% adaptive threshold):
1. Individual funding base: 69% + 28% = 97%
2. Itemized concentration: 28% < 40% → No penalty
3. PAC penalty: Minimal, ~0 points
4. S threshold: 90 + 0 = 90%
5. 97% >= 90% → **S tier**

**Interpretation**: Model grassroots politician. High individual support (97%), minimal institutional money. Itemized donations below concentration threshold = full credit.

---

### Example 2: Bernie Sanders (Balanced Individual)

**Funding Breakdown**:
- Total: $10,000,000
- Grassroots (<$200): $4,700,000 (47%)
- Itemized (>$200): $4,100,000 (41%)
- PACs: $100,000 (1%)

**Calculation** (with 40% adaptive threshold):
1. Individual funding base: 47% + 41% = 88%
2. Itemized concentration: 41% > 40% → 1% excess
3. Concentration penalty: 1 × 0.1 = 0.1 points
4. Adjusted individual funding: 88% - 0.1% = 87.9%
5. PAC penalty: Minimal, ~0 points
6. A threshold: 75 + 0 = 75%
7. 87.9% >= 75% → **A tier**

**Interpretation**: Strong grassroots base with balanced itemized support. Slight concentration penalty (1% over threshold) barely affects tier. Overwhelmingly individual-funded.

---

### Example 3: Elizabeth Warren (Above Threshold)

**Funding Breakdown**:
- Total: $8,500,000
- Grassroots (<$200): $4,335,000 (51%)
- Itemized (>$200): $3,825,000 (45%)
- PACs: $42,500 (0.5%)

**Calculation** (with 40% adaptive threshold):
1. Individual funding base: 51% + 45% = 96%
2. Itemized concentration: 45% > 40% → 5% excess
3. Concentration penalty: 5 × 0.1 = 0.5 points
4. Adjusted individual funding: 96% - 0.5% = 95.5%
5. PAC penalty: Minimal, ~0 points
6. S threshold: 90 + 0 = 90%
7. 95.5% >= 90% → **S tier**

**Interpretation**: Strong individual funding base (96%). Modest concentration penalty (5% over threshold) doesn't affect S tier status. Minimal PAC reliance.

---

### Example 4: Dina Titus (Low Individual, Low PAC)

**Funding Breakdown**:
- Total: $2,436,549
- Grassroots (<$200): $167,477 (7%)
- Itemized (>$200): $1,201,611 (49%)
- PACs: $100,000 (4%)

**Calculation** (with 40% adaptive threshold):
1. Individual funding base: 7% + 49% = 56%
2. Itemized concentration: 49% > 40% → 9% excess
3. Concentration penalty: (5 × 0.1) + (4 × 0.2) = 0.5 + 0.8 = 1.3 points
4. Adjusted individual funding: 56% - 1.3% = 54.7%
5. PAC penalty: Minimal, ~1 point
6. C threshold: 45 + 1 = 46%
7. 54.7% >= 46% → **C tier**

**Interpretation**: "Wine-track Democrat" profile. Low grassroots (7%) but majority individual-funded (56%). Concentration penalty reduces final score. Minimal PAC reliance. Not elite capture, but not broad-based movement either.

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

1. **Individual funding vs institutional funding** - The tier system now distinguishes between:
   - **Individual support** (grassroots + itemized): Full credit unless concentration is extreme
   - **Institutional capture** (PAC money): Penalizes thresholds based on transparency weights

2. **Adaptive thresholds are empirical** - 70th percentile recalculates each cycle from actual member data:
   - Grounded in real-world campaign finance distributions
   - Automatically adjusts for political environment changes
   - Currently ~40%, clamped to 25-40% range to prevent extreme swings

3. **Itemized donations are not "wealthy donors"** - FEC $200 threshold is a reporting requirement:
   - $201 from a teacher, $250 from a nurse = still grassroots-adjacent
   - Only *concentration* above 70th percentile triggers penalties
   - Tiered penalty structure (0.1x/0.2x/0.3x) prevents cliff effects

4. **PAC penalties unchanged** - Still use FEC metadata for transparency weights:
   - Never use hardcoded PAC name patterns
   - Always use `committee_type` and `designation` codes
   - Super PACs (type `O`) = 2.0x, Leadership PACs (designation `D`) = 1.5x
   - Candidate committees (designation `P`/`A`) = 0.15x discount

5. **Phase 2 recalculates pacMoney** - FEC totals endpoint can be wrong, trust Schedule A itemized data
