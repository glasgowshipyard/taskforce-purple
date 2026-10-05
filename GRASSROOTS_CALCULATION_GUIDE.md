# Tier Calculation Guide

**Last Updated**: 2026-10-04
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

## Whose money, and whose donors

The unit is the member, not a committee (agreed 2026-09-26). Two different
questions, answered separately (`workers/person-funding.js`):

1. **The money graded** is what the member _received_: their campaign(s)
   and leadership PAC, plus whatever any joint fund transferred to them,
   split into small donors, large donors, PACs and party by that fund's own
   mix. Transfers between the member's own committees count once.
2. **The donors tested for concentration** are those of every committee in
   the member's pool: their campaign(s), leadership PAC, and their **own**
   joint funds in full.

**Which joint funds are the member's own** (`isMembersOwnFund`, `fundOwner`):

- a fund registered under the member's candidacy; or
- the member the fund's payments mostly went to. Payments are added up per
  person, all of a member's committees together, with party committees
  left out (a leader's fund always sends most to the party). If the top two
  recipients are within 1% of each other, the fund was split evenly: it is
  shared, and nobody's own (owner, 2026-10-04). Example: a fund paying eight
  committees $91,000 each, two of them one member's campaign and leadership
  PAC, is that member's; a fund split 50/50 between two members is shared.
- With no payment records at all, a fund is the member's if they received at
  least half of what it passed on.

A shared fund still counts for each member by the money they received
(question 1); only its donors stay out of their concentration test.

**Grade first, confirm after** (owner, 2026-10-04). Grades are computed from
the FEC's bulk files as soon as they're available, then checked record by
record against the FEC (`scripts/refresh/`). Until the check is done the
grade is provisional (`evidenceChecked: false`); the check confirms it or
shifts it.

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

| Condition                          | Anchor | Meaning                            |
| ---------------------------------- | ------ | ---------------------------------- |
| Nakamoto < 50 donors               | 10%    | Dinner party: coordination trivial |
| Nakamoto % of donors < 5%          | 25%    | Elite capture: country-club scale  |
| Nakamoto % of donors < 10%         | 40%    | Standard: requires organization    |
| Nakamoto % of donors ≥ 10%         | 50%    | Movement: coordination impossible  |
| No / unreliable concentration data | 40%    | Neutral default                    |

**Reliability check (added July 2026)**: a concentration snapshot only counts
if it has ≥10 unique donors AND its collected total covers ≥50% of the
member's FEC-reported itemized contributions. Early-cycle partial snapshots
previously read as "tiny donor base" and wrongly triggered the 10% anchor.

### Step 4: Itemization penalty (excess money)

```
excess  = max(0, itemizedShare − anchor)          // points of INDIVIDUAL money
penalty = excess / 100 × rawIndividualFundingPercent   // same money, as points of TOTAL
individualFundingPercent −= penalty
```

Itemized money above the anchor stops counting as people-funding. That is
the whole rule: a broad donor base (movement anchor, 50%) keeps credit for
more of its itemized money than a dinner party (10%). A score can never fall
below the member's small-donor share, so no cap or floor is needed.

**Why it changed (September 2026, #42).** From July to September the penalty
was `min(excess² / 20, 40)`, floored at 0. It measured the excess in points of
individual money, squared it, and subtracted it from a share of total money —
two different denominators — so raw penalties reached 200–390 points. A cap
of 40 and a floor at 0 were bolted on to stop negative scores, and together
they put **145 members on an identical 0**, erasing every difference below
40%. The cap also _limited_ the penalty for the most concentrated donor
bases, letting them sit a tier or more above where their filings put them.
Simulated on live data before deploying (`scripts/simulations/penalty-model-sim.mjs`):
zeros 145 → 0; top of the table unchanged (the reference S/A members carry no
penalty under either model).

### Step 5: PAC transparency penalty (threshold shift)

Weighted concerning PAC money shifts the tier thresholds upward, max 30
points:

| PAC type                                  | Weight                          |
| ----------------------------------------- | ------------------------------- |
| `O` Super PAC                             | 2.0x                            |
| `D` Leadership / `B` Lobbyist designation | 1.5x (multiplies)               |
| `P`/`A` Candidate/Authorized committees   | 0.15x (never penalized)         |
| Unknown metadata                          | 1.0x (neutral, never penalized) |

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

| Member                               | Itemized share | Anchor         | Penalty | Tier |
| ------------------------------------ | -------------- | -------------- | ------- | ---- |
| Sanders (13k donors, Nakamoto 11.7%) | 20%            | 50% (movement) | 0       | S    |
| Pelosi (2.6k donors, Nakamoto 4.4%)  | 35%            | 25% (elite)    | 5       | A    |
| Zero-donor snapshot (junk data)      | any            | 40% (default)  | bounded | —    |

Run `npm test` before changing any of this.
