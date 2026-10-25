# Tier Calculation Guide

**Last Updated**: 2026-10-18
**Implementation**: `workers/tier-calculation.js` `gradeFinal3` (pure, unit-tested; checked
member by member against the simulation by `scripts/simulate/check-final3.mjs`), wrapped by
`workers/grading.js` `gradeMemberFinal3`. Inputs gathered by the refresh job
(`scripts/refresh/run.mjs`, `scripts/refresh/lib/final3.mjs`); PAC sorting and the people
test in `scripts/refresh/lib/sponsors.mjs` with the data in `scripts/refresh/data/`.

## FINAL-3: the method since 13 October 2026

The owner froze this on 2026-10-12 after four simulation rounds on one FEC snapshot (Final,
FINAL-2, FINAL-3; reports in IMPLEMENTATION_STATUS.md). It replaced version A (the trust anchor,
half credit for PAC money traced to people, and the PAC bar), now in
`docs/history/method-version-a.md`.
The one-page spec, as shown on /how:

**Meaning.** A member's grade is the share of the money given to them, and to their own joint funds, that comes from many different people. Big donations count only as far as the people who gave them are many and spread out. PAC money counts only when the PAC's sponsor is run by its members (they elect most of its board, or it is a union bound by federal labor law to hold member elections), and only as far as the PAC's own money traces back to many people. Money from companies' PACs, politicians, parties, and PACs that answer to a board or to their organizers counts 0.

**Formula** (per member, cycle 2026):

- money given: `G = s + b + p + y` across the member's campaigns, leadership PACs and own joint funds (in full; transfers between them counted once). Own money, interest, refunds, loans and transfers are left out.
- other politicians' joint funds: what they passed to the member comes out of `s, b, p, y` by each fund's own mix and counts 0 (POLITICIAN); it stays in `G`. Together they never count for more than the member's committees report receiving as transfers, less what came from the member's own committees and funds (a campaign can re-report a fund's transfer as the donations behind it; counting both counted that money twice; 2026-10-18).
- directed gifts: gifts earmarked through a committee other than ActBlue, WinRed or Democracy Engine come out of `b` and the donor test, and count as that committee's gift: `e × share` if it passes the people test, else 0. Never under the PAC cap.
- donor test, on the remaining big-donor records of those committees, each donor's gifts at full size, donors who net above $0: `N` big donors, `n` the fewest who gave half the big-donor money.
- allowance: `a = min(0.10 + 0.90 × clamp((n/N − 0.025) / 0.075, 0, 1), min(1, n/100))`; `a = 0.40` only when the records cover under half the FEC's big-donor total.
- big money counted: `min(b, a × (s + b))`.
- each PAC's share from people: the same test on the PAC's own money (the FEC's small/big split, its own donors), plus the money of committees that funded it (2 steps back) where those committees pass the people test; all other committee money, and money that can't be traced, counts 0.
- the people test: a labor union covered by the Labor-Management Reporting and Disclosure Act passes on the law. Any other PEOPLE sponsor passes only if its members elect most of its voting board: its latest Form 990 answers Yes on Part VI line 7a, line 6 says it has members, and its Schedule O doesn't show members electing only a minority (or the board being its own membership). Otherwise BOARD (0). No Form 990: a stated fact decides; otherwise not tested (0) and listed.
- PAC money counted: `Σ gift × share` for PEOPLE PACs that pass the test, scaled down so it never exceeds the PAC money in the member's figures.
- score: `x = 100 × (s + min(b, a(s + b)) + PAC money counted + directed gifts counted) / G`, at most 100.
- grade on `round(x)`: S at least 90, A 75, B 60, C 45, D 30, E 15, otherwise F.
- no grade (?): no confirmed FEC identity; no campaign committee for the cycle; own money that doesn't fit inside the receipts.

**Why the allowance has a count of 100 as well as a share** (owner, 2026-10-24; the reasoning was never written down until now). It's the ballroom principle (CLAUDE.md, settled January 2026): big donations count as individual support unless the donor base is concentrated, and 100 people is about one room's worth. If half the big-donor money came from fewer people than could sit at one fundraiser, the base is concentrated, however the share works out. The share limit alone can't see that: a campaign with very few donors passes it by default (5 of 40 is 12.5%). The count limit is `min(1, n/100)`; the allowance is the smaller of the two. History: the earlier table (version A, `docs/history/method-version-a.md`) used 50 donors as its floor (under 50 gave only a 10% allowance); the 100-person count came in with the 2026-10-11 simplification simulation (`count` in `scripts/simulate/lib/grid.mjs`), where the lower of the spread test and the number test was the leading candidate (E), frozen as FINAL-3 on 2026-10-12. Neither limit looks at how large each gift is, only how many people and what share.

**Constants**: 0.10 and 0.90 (allowance range), 2.5% and 10% (spread), 100 donors, 0.40 fallback, 50% record coverage, credit 1 (PEOPLE that pass the test) and 0 (everything else), 2 steps back, bands 90/75/60/45/30/15.

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
