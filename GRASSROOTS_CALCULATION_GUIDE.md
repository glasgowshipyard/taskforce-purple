# Tier Calculation Guide

**Last Updated**: 2026-07-12
**Implementation**: `workers/tier-calculation.js` (pure functions, unit-tested in `workers/tier-calculation.test.js`)

> Historical note: this guide previously described an adaptive-percentile
> threshold system with tiered linear penalties (0.1x/0.2x/0.3x). That design
> was replaced in January 2026 by the dynamic trust anchor system documented
> here, and hardened in July 2026 (penalty cap, score floor, reliability
> check). If a doc or comment references the percentile system, it is stale.

## Philosophy

Tiers reflect **funding diffusion** — whether a member's power comes from many
small donors with distributed influence, or from concentrated wealthy
individuals and institutions. The system distinguishes:

- **Individual support** (grassroots + itemized donations from people)
- **Institutional capture** (PAC money, weighted by transparency)
- **Coordination risk** (how few donors could organize to threaten funding)

## The Calculation

### Step 1: Individual funding percent

```
individualFunding = grassrootsDonations + largeDonorDonations
individualFundingPercent = individualFunding / totalRaised × 100
```

- `grassrootsDonations`: FEC `individual_unitemized_contributions` (<$200)
- `largeDonorDonations`: FEC `individual_itemized_contributions` (>$200)

### Step 2: Itemized share (the "human element" ratio)

```
itemizedShare = largeDonorDonations / individualFunding × 100
```

The denominator is **individual funding, not total raised**. Of the people who
gave, how reliant is the member on big checks? Using totalRaised would let PAC
money dilute the ratio.

### Step 3: Dynamic trust anchor

The allowed itemized share before penalties depends on how easily the donor
base could coordinate, measured by the **Nakamoto coefficient** (number of top
donors controlling 50% of itemized money) from the donor concentration
analysis:

| Condition | Anchor | Meaning |
| --- | --- | --- |
| Nakamoto < 50 donors | 10% | Dinner party: coordination trivial |
| Nakamoto % of donors < 5% | 25% | Elite capture: country-club scale |
| Nakamoto % of donors < 10% | 40% | Standard: requires organization |
| Nakamoto % of donors ≥ 10% | 50% | Movement: coordination impossible |
| No / unreliable concentration data | 40% | Neutral default |

**Reliability check (added July 2026)**: a concentration snapshot only counts
if it has ≥10 unique donors AND its collected total covers ≥50% of the
member's FEC-reported itemized contributions. Early-cycle partial snapshots
previously read as "tiny donor base" and wrongly triggered the 10% anchor.

### Step 4: Itemization penalty (capped quadratic)

```
excess  = max(0, itemizedShare − anchor)
penalty = min(excess² / 20, 40)
individualFundingPercent −= penalty
individualFundingPercent = max(0, individualFundingPercent)   // floor
```

The quadratic punishes structural capture harder than minor slips. The **cap
(40 points)** and **floor (0)** were added in July 2026: without them, typical
members with mostly-itemized individual funding took penalties of 200–390
points and 292 members had negative scores.

### Step 5: PAC transparency penalty (threshold shift)

Weighted concerning PAC money shifts the tier thresholds upward, max 30
points:

| PAC type | Weight |
| --- | --- |
| `O` Super PAC | 2.0x |
| `D` Leadership / `B` Lobbyist designation | 1.5x (multiplies) |
| `P`/`A` Candidate/Authorized committees | 0.15x (never penalized) |
| Unknown metadata | 1.0x (neutral, never penalized) |

```
concerningPercent = Σ(amount × weight, where weight > 1) / totalRaised × 100
pacPenalty = min(floor(concerningPercent), 30)
```

### Step 6: Tier assignment

```
S ≥ 90+pacPenalty   A ≥ 75+…   B ≥ 60+…   C ≥ 45+…   D ≥ 30+…   E ≥ 15+…   else F
```

### Fallback path

Members with no PAC metadata AND no reliable concentration data are tiered on
raw grassroots percent against the unshifted thresholds. Members with
`totalRaised = 0` are `N/A`.

## Reference cases (locked in unit tests)

| Member | Itemized share | Anchor | Penalty | Tier |
| --- | --- | --- | --- | --- |
| Sanders (13k donors, Nakamoto 11.7%) | 20% | 50% (movement) | 0 | S |
| Pelosi (2.6k donors, Nakamoto 4.4%) | 35% | 25% (elite) | 5 | A |
| Zero-donor snapshot (junk data) | any | 40% (default) | bounded | — |

Run `npm test` before changing any of this.
