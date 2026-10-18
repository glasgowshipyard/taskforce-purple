# The grading method before FINAL-3 (version A)

> **Historical** (moved out of GRASSROOTS_CALCULATION_GUIDE.md on
> 2026-10-18). Version A graded from the trust anchor, an itemization
> penalty, half credit for PAC money traced to people and the PAC bar. It
> was replaced by FINAL-3 on 2026-10-13 (the guide at the repository root).
> Kept as the record of what the earlier grades meant.

## Before FINAL-3 (version A, superseded 2026-10-13)

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

### Step 4b: PAC money traced to people (#57, owner 2026-10-09)

A PAC isn't good or bad by itself: what matters is who funded it. Each PAC
that gave to the member is looked through to its own donors with the same
rules as a member's (`pacPeopleShare`): its share from individuals, less big
donations above the allowance its donor concentration earns. Money the PAC
got from other committees counts as far as those committees' own donors pass
the same test ("one level deeper", depth 2); anything still untraced counts
as not people. Half of the result counts (`PAC_TRACING = { credit: 0.5,
depth: 2 }`): a PAC's leaders, not its donors, choose where the money goes.

```
peopleShare(PAC) = (individuals − itemizationPenalty) / receipts
                   + Σ upstream gift × upstream peopleShare / receipts
pacPeopleCredit  = Σ gift × peopleShare(PAC) × 0.5        (dollars)
score           += pacPeopleCredit / totalRaised × 100     (capped at 100)
```

Inputs, from the FEC bulk files (`scripts/refresh/lib/pacs.mjs`): every 24K
and 24Z gift to the member's campaigns and leadership PAC (`oth`, giver-
reported); each PAC's receipts and individual contributions (`webk`); its
named donors and Nakamoto coefficient (`indiv`); the committees that gave to
it (`oth` 24K/24G/24Z with OTHER_ID = the PAC). Party committees are left
out (party money is counted on its own).

Simulated across all 536 gradable members before deploying (2026-10-09,
grade-report artifacts of runs 37998209219 and 38010301349): see
IMPLEMENTATION_STATUS.md for the tier distributions at 25/50/100% credit and
the party split. The method page states the credit and its sensitivity.

### Step 5: PAC transparency penalty (threshold shift)

Weighted concerning PAC money shifts the tier thresholds upward, max 30
points:

| PAC type                                | Weight                                     |
| --------------------------------------- | ------------------------------------------ |
| `O` Super PAC                           | 2.0x                                       |
| `D` Leadership PAC (another politician) | 1.5x (multiplies; 1.0-1.5 being simulated) |
| `B` Lobbyist/registrant designation     | 1.0x since 2026-10-09 (was 1.5x)           |
| `P`/`A` Candidate/Authorized committees | 0.15x (never penalized)                    |
| Unknown metadata                        | 1.0x (neutral, never penalized)            |

Designation `B` stopped counting extra in version A (owner, 2026-10-09): it
covers about 77% of PAC money to members, company and union PACs alike, so it
said nothing about who funds a PAC; Step 4b measures that directly.

```
concerningPercent = Σ(amount × weight, where weight > 1) / totalRaised × 100
pacPenalty = min(floor(concerningPercent), 30)
```

### Step 6: Tier assignment

```
S ≥ 90+pacPenalty   A ≥ 75+…   B ≥ 60+…   C ≥ 45+…   D ≥ 30+…   E ≥ 15+…   else F
```

**Which PAC list (#57, 2026-10-09).** The penalty and Step 4b read every PAC
gift to the member's campaigns and leadership PAC from the FEC bulk files
(`member.pacContributions`, with `pacListComplete: true`). Until 2026-10-09
the penalty read only the old pipeline's top-20 gifts to the campaign
committee (Martin Heinrich: $100,000 of $1.1M).

### Fallback path

Members with no PAC metadata AND no reliable concentration data were tiered
on raw grassroots percent against the unshifted thresholds: a small-donor
share alone, which put Radewagen on 0%. A complete PAC list is data even when
it's empty (`pacListComplete`), so since 2026-10-09 every member graded by the
refresh job takes the full path, with the default allowance when the donor
concentration isn't reliable. Members with `totalRaised = 0` are `N/A`.

## Reference cases under version A

| Member                               | Itemized share | Anchor         | Penalty | Tier |
| ------------------------------------ | -------------- | -------------- | ------- | ---- |
| Sanders (13k donors, Nakamoto 11.7%) | 20%            | 50% (movement) | 0       | S    |
| Pelosi (2.6k donors, Nakamoto 4.4%)  | 35%            | 25% (elite)    | 5       | A    |
| Zero-donor snapshot (junk data)      | any            | 40% (default)  | bounded | —    |
