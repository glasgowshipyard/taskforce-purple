# Tier Calculation Guide

**Last Updated**: 2026-10-09
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

### Step 0: The candidate's own money is set aside (#59, owner 2026-10-08)

A candidate's own gifts and loans to their campaign (FEC candidate summary
file `weball`: `CAND_CONTRIB` + `CAND_LOANS`, across every candidate ID they
have) are taken out of `totalRaised` before anything else. Being rich or
driven makes a member depend on no one, so own money neither helps nor
hurts the grade. It's kept in `personFigures.ownMoney` and shown on the
receipt, with the loans their campaign repaid them (`CAND_LOAN_REPAY`).

If the own money doesn't fit inside what the FEC says they raised (money
from others would be smaller than the donations, PAC and party money we know
came from others, with 2% tolerance), the figures don't reconcile to
source: no grade, `DISPUTED` with `disputeReason: own-money-exceeds-receipts`
(#62). `workers/grading.js`.

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

### Withheld grades (one rule, owner 2026-10-09)

A letter grade is published only when it was worked out from this cycle's
FEC records, matched to the member and reconciled with the FEC's own totals
(`workers/member-store.js publishedMember`). Otherwise the site shows "?"
with the reason (`withheldReason`): no confirmed FEC identity (UNVERIFIED);
the refresh job found nothing it could grade, such as no campaign committee
registered for the cycle (UNVERIFIED, `no-campaign-committee`); figures that
don't reconcile, such as own money larger than the receipts (DISPUTED). A
stored letter grade from the old pipeline is never shown in their place.

## Reference cases (locked in unit tests)

| Member                               | Itemized share | Anchor         | Penalty | Tier |
| ------------------------------------ | -------------- | -------------- | ------- | ---- |
| Sanders (13k donors, Nakamoto 11.7%) | 20%            | 50% (movement) | 0       | S    |
| Pelosi (2.6k donors, Nakamoto 4.4%)  | 35%            | 25% (elite)    | 5       | A    |
| Zero-donor snapshot (junk data)      | any            | 40% (default)  | bounded | —    |

**Real-data reference members** (`workers/reference-cases.test.js`,
2026-10-07): the live grading inputs of Sanders (S, movement donor base),
AOC (S, itemized money as support), Pelosi (B, graded on all her committees,
never her campaign alone) and Armstrong (no confirmed FEC identity, so no
letter), frozen in `workers/fixtures/reference-members.json`. A failing one
means a change moved a settled grade. Simulate it across all members and
agree it with the owner before regenerating the fixture
(`node scripts/verify/make-reference-fixtures.mjs`).

Run `npm test` before changing any of this.
