# Tier Calculation Guide

**Last Updated**: 2026-11-01
**Implementation**: `workers/tier-calculation.js` `gradeFinal3` (pure, unit-tested; checked
member by member against the simulation by `scripts/simulate/check-final3.mjs`), wrapped by
`workers/grading.js` `gradeMemberFinal3`. Inputs gathered by the refresh job
(`scripts/refresh/run.mjs`, `scripts/refresh/lib/final3.mjs`); PAC sorting and the people
test in `scripts/refresh/lib/sponsors.mjs` with the data in `scripts/refresh/data/`.

## FINAL-3: the method since 13 October 2026, big-donor test since 2 November

The owner froze this on 2026-10-12 after four simulation rounds on one FEC snapshot (Final,
FINAL-2, FINAL-3; reports in IMPLEMENTATION_STATUS.md). It replaced version A (the trust anchor,
half credit for PAC money traced to people, and the PAC bar), now in
`docs/history/method-version-a.md`. On 2026-11-02 the owner changed its big-donor test: small
itemized gifts are small, and wealthy donors' money is Power (below). The one-page spec, as shown
on /how:

**Meaning.** A member's grade is the share of the money given to them, and to their own joint funds, that comes from many different people. Big donations count only from people who gave less than $7,000 in all, and only as far as many people gave them. PAC money counts only when the PAC's sponsor is run by its members (they elect most of its board, or it is a union bound by federal labor law to hold member elections), and only as far as the PAC's own money traces back to many people. Money from companies' PACs, politicians, parties, and PACs that answer to a board or to their organizers counts 0.

**Formula** (per member, cycle 2026):

- money given: `G = s + b + p + y` across the member's campaigns, leadership PACs and own joint funds (in full; transfers between them counted once). Own money, interest, refunds, loans and transfers are left out.
- other politicians' joint funds: what they passed to the member comes out of `s, b, p, y` by each fund's own mix and counts 0 (POLITICIAN); it stays in `G`. The part in no bucket (a fund that raised nothing this cycle, so has no mix, or money that wasn't donations) is added to `G` as theirs too, so all of it is in the total (2026-11-01; before, it was left out). Together they never count for more than the member's committees report receiving as transfers, less what came from the member's own committees and funds (a campaign can re-report a fund's transfer as the donations behind it; counting both counted that money twice; 2026-10-18).
- directed gifts: gifts earmarked through a committee other than ActBlue, WinRed or Democracy Engine come out of `b` and the donor test, and count as that committee's gift: `e × share` if it passes the people test, else 0. Never under the PAC cap.
- small gifts reported by name: on the remaining donor records of those committees, each donor's gifts added up at full size, donors who net above $0, the share of the money from people who gave $200 or less in all moves from `b` to `s` (`smallItemized`). The FEC's itemized total holds them when a campaign itemizes every gift, as many do with online gifts.
- donor test, on the people who gave more than $200: `N` big donors, `n` the fewest who gave half the big-donor money, and `w` the share of the money from wealthy donors, who gave $7,000 or more in all (two maximum donations).
- allowance: `a = min(0.10 + 0.90 × clamp((n/N − 0.025) / 0.075, 0, 1), min(1, n/100))`: a small share of the big donors, or fewer than 100 people, giving half of it.
- big money counted: `min(b × (1 − w), a × (s + b))`.
- no grade (?) when the records cover under half the FEC's itemized total (`DISPUTED`, `records-incomplete`; shown as "Checking records").
- each PAC's share from people: the same test on the PAC's own money (the FEC's small/big split, its own donors; where its records cover under half, its big-donor money counts up to 0.40 of its money from individuals), plus the money of committees that funded it (2 steps back) where those committees pass the people test; all other committee money, and money that can't be traced, counts 0.
- the people test: a labor union covered by the Labor-Management Reporting and Disclosure Act passes on the law. Any other PEOPLE sponsor passes only if its members elect most of its voting board: its latest Form 990 answers Yes on Part VI line 7a, line 6 says it has members, and its Schedule O doesn't show members electing only a minority (or the board being its own membership). Otherwise BOARD (0). No Form 990: a stated fact decides; otherwise not tested (0) and listed.
- PAC money counted: `Σ gift × share` for PEOPLE PACs that pass the test, scaled down so it never exceeds the PAC money in the member's figures.
- score: `x = 100 × (s + big money counted + PAC money counted + directed gifts counted) / G`, at most 100.
- grade on `round(x)`: S at least 90, A 75, B 60, C 45, D 30, E 15, otherwise F.
- no grade (?): no confirmed FEC identity; no campaign committee for the cycle; own money that doesn't fit inside the receipts; donor records that cover under half the itemized money.

**Why the big-donor test changed** (owner, 2026-11-01 and 11-02). The ballroom principle
(CLAUDE.md, settled January 2026) says big donations count as individual support unless the
donor base is concentrated. FINAL-3 measured only concentration: how few people gave half the
big money (the count, under 100: one room's worth) and what share of the big donors they were
(the share, 2.5% to 10%). Two faults:

- It couldn't see wealth. The legal limit makes every maxed-out donor's gift the same, so they
  look evenly spread: a Senate campaign whose big money came mostly from donors giving the
  maximum for both the primary and the general (1,488 of 14,300 gave half, 10.4%) got full
  credit and an S on 75% big-donor money. The owner: "maxed out people are POWER"; "one donation
  is fine, two are a real indicator". So $7,000 or more in all (two maximum donations, $3,500 for
  each election in 2025-26), across the politician's committees, is a wealthy donor, and all of
  their money is Power (the whole person, not the part over the line). A $3,500 line was built
  and simulated first: it moved 299 members' grades and turned 37 of 52 states' map colour
  redder; the owner chose $7,000.
- It counted small gifts as big. The FEC's itemized total holds every gift a campaign reports by
  name, and many itemize every online gift: one House candidate's $680,000 "big" money came from
  12,123 people averaging $56. Those donors made the top donors look like a tiny share, so the
  share test read broad campaigns as concentrated. The owner: "Small gifts are not big
  donations." Small or big now goes by what each person gave in all.

The share test stays, measured on real big donors (over $200): it still catches real
concentration (32 people giving half of one leader's big money). The 0.40 middle allowance for
short records is gone: a grade that can't be worked out from the records isn't given.

The history: version A's trust-anchor table (`docs/history/method-version-a.md`, Step 3) capped
big money at 50% of the money from individuals even for its "movement" bases; the 2026-10-11
simplification simulation removed that cap (239 grades on its own) and dropped variant D (each
donor counted up to $500/$1,000/$2,000) for cutting big donations "however many people gave".
The weak-spot check then (top donors giving 40% or more of all the money) couldn't see thousands
of maxed-out donors.

**Constants**: $200 (this or less in all is a small donor), $7,000 (this or more in all is a wealthy donor), 0.10 and 0.90 (allowance range), 2.5% and 10% (spread), 100 donors (a room), 50% record coverage, 0.40 (a PAC's limit when its records are short), credit 1 (PEOPLE that pass the test) and 0 (everything else), 2 steps back, bands 90/75/60/45/30/15.

**Sorting rule** (each PAC in one group, in this order): a stated fact, where one is listed. POLITICIAN: leadership PACs (FEC designation D, or the FEC's leadership-PAC flag or sponsoring candidate), candidates' committees, other politicians' joint funds, PACs whose connected organization is a candidate's committee, leadership PAC, joint fund or politician, and PACs linked to a congressional caucus or run by members of Congress (one test, both parties). PARTY: party committees, and PACs whose connected organization is one. NO SPONSOR: a connected organization that is another (non-party, non-politician) committee, or none. BUSINESS: FEC sponsor type corporation (C) or trade association (T), whatever the IRS says; cooperatives; credit unions, insurers (fraternal benefit societies that sell insurance included), health plans and chambers of commerce; agricultural producers' groups; a sponsor whose members are businesses; a 501(c)(6) business league or exempt co-op, credit union or mutual insurer by IRS status; a sponsor with no IRS exempt record (a corporation without capital stock, W, included) or a company name. PEOPLE: a labor organization (FEC type L, or 501(c)(5) not a producers' group) or another member or issue organization by IRS status or FEC type M or W. The IRS can make a PAC BUSINESS, never un-make a C or T; leaving BUSINESS takes a stated fact. An IRS match made on another name, or under mixed records, is checked and listed.

---

## Whose money, and whose donors

The unit is the member, not a committee (agreed 2026-09-26). Two different
questions, answered separately (`workers/person-funding.js`):

1. **The money graded** is what the member _received_: their campaign(s)
   and leadership PAC, plus whatever any joint fund transferred to them,
   split into small donors, large donors, PACs and party by that fund's own
   mix. Transfers between the member's own committees count once. Money
   from other politicians' funds never counts for more than the member's
   own reports show arriving as transfers (`otherFundsCounted`).
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

## The candidate's own money is set aside (#59, owner 2026-10-08)

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

## Withheld grades (one rule, owner 2026-10-09)

A letter grade is published only when it was worked out from this cycle's
FEC records, matched to the member and reconciled with the FEC's own totals
(`workers/member-store.js publishedMember`). Otherwise the site shows "?"
with the reason (`withheldReason`): no confirmed FEC identity (UNVERIFIED);
the refresh job found nothing it could grade, such as no campaign committee
registered for the cycle (UNVERIFIED, `no-campaign-committee`); figures that
don't reconcile, such as own money larger than the receipts (DISPUTED). A
stored letter grade from the old pipeline is never shown in their place.

The money graded (small + big + PAC + party) can't be more than the
committees took in (`totalRaised`). When it is, by over 2% and $1,000, the
campaign's own reports contradict each other: no grade, `DISPUTED` with
`disputeReason: more-than-received` (owner, 2026-11-01; `gradeFinal3`). On
1 November 2026 it caught one campaign, Ohio 8's: two quarterly reports
saying nothing came in while listing donations, with the small-donor figure
repeated as party money. No member was caught.

## How the site shows a grade

A member's receipt, graph and "Why" all come from the grade's own working
(`grade.detail`, `workers/grading.js` `gradeMemberFinal3`), so they agree
line for line (owner, 2026-10-17). The receipt's lines are whole dollars
that add up exactly to its subtotal (the money the grade is on) and total.
The three parts are whole percentages adding up to 100 (`peoplePowerInfluence`
in tier-calculation.js), and the Why list's pieces are rounded to add up to
their part, so one piece can be a point off its own dollars (the owner's
choice).

## Reference members (locked in unit tests)

**Real-data reference members** (`workers/reference-cases.test.js`,
2026-10-07): the live grading inputs of Sanders (S, movement donor base),
AOC (S, itemized money as support), Pelosi (B, graded on all her committees,
never her campaign alone) and Armstrong (no confirmed FEC identity, so no
letter), frozen in `workers/fixtures/reference-members.json`. A failing one
means a change moved a settled grade. Simulate it across all members and
agree it with the owner before regenerating the fixture
(`node scripts/verify/make-reference-fixtures.mjs`).

Run `npm test` before changing any of this.
