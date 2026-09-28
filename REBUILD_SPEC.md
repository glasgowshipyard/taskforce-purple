# Rebuild spec: collection, storage and grading around the person

**Status: DRAFT, awaiting owner approval. Nothing here is built yet.**
Written 2026-09-28 by Claude, who wrote the code this replaces. Umbrella
issue: #47. Supersedes the fix plans in #46 and #44; the evidence in those
issues still stands.

Anyone building this: read the whole document first, then `CLAUDE.md`. Every
number below was measured or checked against Cloudflare's or the FEC's docs
on 2026-09-28 unless marked **VERIFY**. Re-measure anything you rely on.

---

## 1. Why a rebuild, not more patches

The grading maths (`workers/tier-calculation.js`) is sound and tested. Also
sound, and kept: identity lookup (`fec-crosswalk.js`), the FEC reconciliation
gate, the committee discovery in `person-funding.js`, and the alerts
(`health.js`). What I built underneath them is broken at the foundation:

1. **The unit is wrong.** In October 2025 (#20) I built donor collection
   around one committee per member, the principal campaign committee. I never
   asked how money reaches a member. Joint funds (money arrives at the
   campaign as a single transfer; the donors are only in the fund's records)
   and leadership PACs (a separate committee) were invisible. Person-level
   collection (#32) was bolted on in September 2026 and has completed for
   nobody. Every live grade still uses the campaign committee alone.
2. **Every update rewrites everything.**
   - All 539 members live in one 3.5 MB KV value (`members:all`, 88% of it
     PAC donation lists that only the detail popup shows). 14 functions
     read-modify-write the whole value to change one member.
   - Every pipeline run re-grades all 528 members; measured, it changed 0.
   - Every page view parses and re-serialises the whole blob.
   - Each collection re-saves its entire growing progress record every run.
3. **The workers are killed for it.** The free plan allows 10 ms CPU per
   invocation. Pipeline runs use about 400 ms, so Cloudflare kills
   invocations for hours at a time, most days, including the site's own
   `/api/members` requests (#46). The itemized worker went from about
   6–20 ms to about 80 ms after #32.
4. **The permanent donor record sets the pace of grading.**
   - D1 costs 5 row-writes per donation: the row, an unused `AUTOINCREMENT`
     counter and three indexes.
   - Donations are written page by page, and the collection stops for the day
     when the 85k self-cap is hit.
   - AOC's campaign committee alone is about 600k FEC records; at this rate
     she takes about 5 weeks.
   - One queue handles one member at a time, so everyone behind her waits.
5. **Failures are silent or destructive.**
   - Failed D1 writes are logged and skipped (#43).
   - A member with no donor-concentration data gets a default that allows S
     (AOC, Murphy and Kelly are S with no concentration data at all).
   - After 3 "strikes" a member is silently dropped.
   - Design changes restarted collections from zero: AOC's 26,436-row
     progress was thrown away when person-level went in.

Patching this has produced two grading paths side by side and a codebase I
misread myself. Rebuild the collection, storage and grading-publication
layer; keep the maths.

## 2. Non-negotiable rules

Settled by the owner. `CLAUDE.md` has the older ones; this list adds
2026-09-28's.

- **Ballroom principle.** Itemized money is individual support, penalised
  only when the donor base is concentrated. Never "itemized = bad".
- **The person is the unit.** Grade on everything the member _received_
  across their campaign(s), leadership PAC and money transferred in from joint
  funds, counted once. Money a joint fund passed to others is disclosed, not
  graded. (Pelosi's Victory Fund raised about $2.6M; about $250k reached her.)
- **Identity is looked up, never inferred** (crosswalk only).
- **No grade without complete evidence.** A letter grade is published only
  when all of these hold:
  - D1 holds every itemized donation for every one of the member's committees
    in the current cycle;
  - those counts match the FEC's **exact** counts;
  - the money matches the FEC's totals to the dollar.

  Until then the member shows **"Grade pending"** (owner decision
  2026-09-28), plus the FEC-reported figures, labelled plainly as covering
  the campaign committee only. No capped letters and no default-anchor
  grades.

- **Every member ends up graded.** Pending must always clear:
  - nobody is dropped (no strikes);
  - a failed collection retries later with growing gaps;
  - a mismatch re-collects the affected slice;
  - anyone pending too long, relative to their campaign's size, raises an
    alert.

  Members with no FEC filings get N/A, not pending.

- **Lean, diff updates.** Write only the record that changed, and only if its
  value differs. Never rewrite or recompute a whole dataset to change one
  item. Any design that needs a whole-dataset write must be raised with the
  owner first.
- **History is never obliterated.**
  - Completed analyses are kept as dated snapshots.
  - Grade changes are kept as a history.
  - A design change must build on existing data, or snapshot it first; it
    never restarts from zero silently.
- **D1 is the permanent donor record and the source of the analysis** (see
  §4.4). It exists for accuracy (#20: "store every unique donor + full dollar
  amount, no aggregation that loses detail").
- **Free tier only.** No R2: it needs a billing subscription and bills
  overage. Never propose paid plans.
- **Owner-facing alerts come with a solution.** Say "fixed X", or "problem Y,
  proposed fix Z, need a yes".

## 3. Platform limits (verified 2026-09-28) and current usage

| Workers Free limit                                       | Value                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| CPU per invocation (HTTP and cron)                       | **10 ms**. Over it: error 1102 `exceededResources`                                |
| Requests per day                                         | 100,000                                                                           |
| Outbound `fetch` per invocation                          | 50                                                                                |
| Calls to Cloudflare services (KV, D1, R2) per invocation | 1,000                                                                             |
| KV per day, per account (operations fail when exceeded)  | 1,000 writes, 100,000 reads, 1,000 deletes, 1,000 lists                           |
| KV writes to the same key                                | 1 per second                                                                      |
| KV value size / storage                                  | 25 MiB / 1 GB                                                                     |
| D1 rows written / read per day                           | 100,000 / 5,000,000 (**VERIFY**: per account or per database; the docs don't say) |
| D1 database size                                         | **500 MB per database**, 10 databases, 5 GB per account                           |
| D1 queries per invocation                                | 50 (**VERIFY** how batches count)                                                 |
| Cache API                                                | **Does not work on `*.workers.dev`**, where the API lives. Not used.              |
| FEC API                                                  | 60 requests per minute per key                                                    |

**Current usage** (14–27 Sept):

- KV: 290–500 writes and 15k–31k reads a day.
- API worker: 72–113 invocations a day. 72 are cron, so about 17 are site
  requests.
- D1 (`taskforce-purple-donors`): **414 MB of 500 MB**; 1,689,625 rows
  (1,307,609 with `sub_id`) across 480 members; 84,678 rows written in the
  last 24 h.

**FEC behaviour you must design for:**

- **Deep cursor pages time out** (504 after 30 s) on big committees. Adding
  `max_date` set to the cursor's date fixes it; this is live since 2026-09-28.
- **Whole-cycle counts for big committees are estimates** and drift: AOC's
  committee C00639591 read 548,837 and then 641,806 on the same day, both
  `is_count_exact: false`.
- **One-month slices return exact counts**: July 2025 gave 30,081,
  `is_count_exact: true`. Individual requests still fail transiently, so
  retry.

## 4. Target design

### 4.1 Storage map

| Where   | Key / table                           | What                                                                                                      | Written when                                                                       |
| ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| KV      | `member:{bioguideId}`                 | Full member record: the source of truth for member data                                                   | Only when a field actually differs (diff)                                          |
| KV      | `members:list`                        | Only what the list page needs, measured at 155 KB for 539 members                                         | Only when a list-visible field of some member changes; at most once per invocation |
| KV      | `analysis:{bioguideId}`               | Current published analysis, including evidence status                                                     | On completion                                                                      |
| KV      | `analysis:{bioguideId}:{collectedAt}` | Dated snapshot, never overwritten                                                                         | On completion (1 write)                                                            |
| KV      | `grade_history:{bioguideId}`          | Append-only grade changes                                                                                 | Only when the grade changes                                                        |
| KV      | `collect:{bioguideId}`                | Collection state: per-committee, per-slice cursors and counts. **Small and fixed-size; no donor totals.** | Once per run for the member being collected                                        |
| D1 (v2) | `donations`                           | One row per itemized donation, keyed by FEC `sub_id`                                                      | As collected                                                                       |
| D1 (v2) | `slices`                              | Per member, committee and month: the FEC's exact count, our count, status                                 | As slices complete                                                                 |
| D1      | `d1_write_budget`, FARA tables        | As today                                                                                                  | As today                                                                           |

`members:all` stays untouched as a rollback copy for two weeks after
cut-over, then goes.

### 4.2 The one write path for member data

`saveMember(env, before, after)`:

- Diff field by field. Nothing differs: no write.
- Otherwise write `member:{id}`.
- If a list-visible field differs, patch that member's entry in
  `members:list`, with one list write per invocation however many members
  changed.

All 14 current writers of `members:all` go through it. No code writes a
whole-dataset value again.

Re-grading follows the same rule:

- Re-grade only members whose inputs changed: the member just processed, and
  members whose analysis changed. For the latter, the analysis write carries
  KV metadata `{updatedAt}`; the pipeline lists that prefix once per run and
  compares it with the member's `lastMergedAt`.
- A **rolling safety check** re-grades about 50 members per run from a cursor,
  a full pass about every 4 h. It must not be a single sweep: reading every
  member and analysis in one run exceeds the 1,000-calls-per-invocation limit.

### 4.3 Collection around the person

- **Which committees.** Keep `person-funding.js` discovery: crosswalk IDs,
  then the member's authorized committees, leadership PAC and the joint funds
  that count as theirs. The donor pool is every committee whose money the
  member received.
- **Two lanes.**
  - Big campaigns (for example, over 100k FEC records across their
    committees) and everyone else get separate queues and separate shares of
    the daily D1 budget. The default is 50/50.
  - A giant only slows itself.
  - Within a lane, one member is collected at a time, and the lanes alternate
    runs.
- **Months, not one long cursor.** Collect each committee month by month.
  Each month is a slice with the FEC's exact count, so:
  - completeness is provable per slice;
  - a failed or mismatched slice is re-collected on its own;
  - no cursor ever gets deep enough to time out.

  Within a slice, keep `last_index` plus `max_date` pagination.

- **Failures.**
  - Temporary FEC errors (429, 5xx) end the run and keep everything already
    fetched.
  - Retries back off: next run, then 1 h, 6 h, 24 h.
  - No strikes and no drops. Every failure records its reason and time.
  - Repeated failure for one member raises an alert but never blocks the
    other lane.
- **Never restart from zero.** Slices already complete and reconciled are
  kept. A design change that changes the pool adds or removes committees'
  slices; it doesn't discard the others.
- **Refresh is incremental.** After a member's first complete pass, refresh
  fetches only new filings: the open months, plus amendments found by the
  count check. There are no full re-collections.

### 4.4 Analysis computed from the evidence in D1

The growing per-member progress record (`donorTotals`, `allAmounts`) goes
away. It is what would reach several MB and CPU-kill AOC's collection.
Instead:

- Collection only writes donations to D1 and cursor/count state to KV.
- At completion, the analysis is computed **by SQL in D1** over the member's
  rows:
  - unique donors (donor key `FIRST|LAST|STATE|ZIP5`, as today);
  - top-10 share;
  - the Nakamoto coefficient (window function: cumulative sum ordered by
    donor total, descending);
  - median;
  - conduit and earmark totals;
  - FARA employer matches (join against the 225 `fara_employer_matches`
    strings).
- The worker receives a handful of numbers, so its CPU stays small.
- Reads are cheap: an AOC-size member is roughly a few hundred thousand rows
  read, against 5M a day. **VERIFY** the query time on AOC-size data before
  relying on it.
- The grade is therefore computed from the stored evidence itself. The
  evidence and the grade cannot disagree.

### 4.5 D1 layout (v2)

- **Schema.**
  - `donations(sub_id TEXT PRIMARY KEY, bioguide_id, committee_id, cycle,
month, contributor_first_name, contributor_last_name, contributor_state,
contributor_zip, contributor_employer, contributor_occupation, amount,
receipt_date, row_class) WITHOUT ROWID`.
  - One secondary index, `(bioguide_id, cycle)`.
  - No `AUTOINCREMENT`, and no employer index (FARA is computed per member at
    completion).
  - **Measure** the real row-writes per new row and per duplicate on
    production before sizing anything, as was done for v1 (RUNBOOK §6).
- **Meter.** `INSERT ... ON CONFLICT DO NOTHING`, charged from `meta.changes`
  as today.
- **A failed D1 write fails the page.** The cursor doesn't advance and
  nothing is counted (#43). No catch-and-continue.
- **Size.** 500 MB per database is a hard wall, and the current database is
  at 414 MB.
  - New data goes into new databases, one per cycle, sharded by member when a
    cycle outgrows one. A small KV registry maps member and cycle to a
    database; all of one member's cycle lives in one database.
  - The owner's "separate DBs for big players" fits here: big-lane members can
    have their own databases.
  - The dashboard's alert on database size is part of §4.9.
- **Legacy database.** Keep `taskforce-purple-donors` read-only as history. Do
  not bulk-delete: deletes cost about 4 row-writes each, so clearing it would
  eat weeks of budget. Retire it after the first v2 pass completes, with the
  owner's OK.
- **VERIFY: whether D1's 100k writes a day is per database or per account.**
  If it is per database, splitting across databases multiplies write capacity
  and shortens the first pass (§6) accordingly. The test:
  1. Pause both crons.
  2. On a scratch database, write past 100k in one UTC day.
  3. Check whether writes to a second database still succeed.
  4. Delete the scratch databases and resume the crons.

  The owner must OK the test day.

### 4.6 Grading and publication

- **Inputs.** Grades come from the D1-computed analysis (§4.4) plus the FEC
  committee totals, both summed across the person's committees and netted for
  money moved between their own committees.
- **The guard.** It runs on every re-grade:
  - A letter is published only if every slice is reconciled, D1's count
    equals the FEC's exact count per committee, the money matches, and the
    data is for the current cycle.
  - Otherwise the result is `PENDING`, with a reason and progress.
  - The default trust anchor can never produce a published grade: no evidence
    means pending.
- **Ringfences** (DISPUTED / UNVERIFIED) stay, with #40's rule: no percentage
  whose denominator is in dispute.
- **Grade history.** Each published change is appended to
  `grade_history:{id}`, with the analysis snapshot it came from.

### 4.7 Site and API

- `/api/members` returns the `members:list` string exactly as stored, with no
  parse.
- The list-page header gets its date from when the list was last written,
  which fixes #38.
- `/api/member-detail` returns `member:{id}`, the current analysis, evidence
  status and progress, and grade history. The detail popup takes its heavy
  fields (PAC lists, FARA firms, conduits) from here.
- Frontend:
  - A **"Grade pending"** state, in plain English, with what's been checked so
    far.
  - FEC figures labelled "campaign committee only" until person-level
    evidence is complete.
  - Apolitical wording; no politician names in UI examples.

### 4.8 Pipeline worker (Congress + FEC totals)

- It keeps its job: the member list from Congress.gov, and FEC committee
  totals and PAC details.
- Every write goes through `saveMember`, and it processes only what changed.
- Per-run CPU target: under 10 ms. With the 155 KB list and single-member
  records this is plausible; **measure it**.

### 4.9 Alerts (`health.js`)

Keep what exists and add:

- a member pending longer than expected for their size;
- a lane that hasn't advanced in 30 h;
- a slice that failed its count check twice;
- any D1 database over 400 MB;
- KV or D1 daily usage over 80% of the limit.

An optional extra is a Cloudflare kill-count check. It needs a read-only
analytics token that the owner creates and stores as a GitHub secret.

## 5. Budgets the design must meet (check each per stage)

| Resource                         | Limit                     | Target                                           |
| -------------------------------- | ------------------------- | ------------------------------------------------ |
| CPU per invocation, both workers | 10 ms                     | Under 10 ms; zero `exceededResources` over 48 h  |
| KV writes / day                  | 1,000                     | Below today's 290–500                            |
| KV reads / day                   | 100,000                   | Below today's 15–31k                             |
| KV lists / day                   | 1,000                     | ≤ ~100 (72 pipeline + health)                    |
| D1 writes / day                  | 100,000 (self-cap 85,000) | Meter unchanged; lanes split it                  |
| D1 reads / day                   | 5,000,000                 | Completion SQL plus FARA under 1M on a heavy day |
| D1 size                          | 500 MB per database       | No database over 400 MB (alert)                  |
| FEC calls                        | 60 / min                  | ≤ 1 per second sustained, as today               |

## 6. First full pass: what to expect

Every member's first person-level pass has to write every itemized donation
to D1.

- **Estimate** (**VERIFY** during discovery, by recording each committee's
  exact sliced count): roughly 2–4M donation rows across Congress for the
  2026 cycle.
- **Pace**: at about 3 row-writes per row (to be measured) under the 85k/day
  cap, about 28k rows a day, so the **first pass takes roughly 70–140 days**.
- **Scope**: most members show "Grade pending" for much of that time. Small
  campaigns finish in hours to days, and big ones take weeks in their own
  lane.
- **What changes it**: if the per-database verification (§4.5) shows D1's
  write limit is per database, the time divides by the number of databases
  written in parallel.
- After the first pass, refresh is incremental and small.

## 7. Stages (each proven live before the next starts)

**Stage 0: approve and freeze.**

- The owner approves this spec.
- No more patches to the old collection and storage paths except to stop
  active harm.

**Stage 1: storage diffs** (stops the kills; §4.1–4.2, 4.7–4.8).

- Build:
  - `member:{id}` and `members:list`, with `saveMember`;
  - re-grade only on change, plus the rolling check;
  - `/api/members` served as stored;
  - the detail popup fed from member-detail;
  - #38.
- Migration: 539 member keys plus the list is about 540 KV writes. Run it just
  after 00:00 UTC (5 pm Pacific), in two halves over two nights. Until a
  member has their own key, reads fall back to `members:all`.
- Exit criteria:
  - offline, identical grades and list fields for all 539 members from the
    same snapshot;
  - 48 h with zero `exceededResources` on the pipeline;
  - KV writes below baseline.

**Stage 2: evidence** (§4.3–4.5).

- Build:
  - D1 v2 (measure its costs first);
  - month slices with exact counts;
  - the two lanes;
  - no strikes, with backoff;
  - D1 write failures fail the page;
  - analysis by SQL;
  - FARA across all committees.
- Exit criteria, with each of these complete, reconciled slice by slice and
  analysed from D1:
  - one small member;
  - Sanders;
  - Pelosi (campaign, PAC to the Future, Victory Fund share);

  and AOC progressing in the big lane without CPU kills.

**Stage 3: the guard** (§4.6, 4.7).

- Build:
  - `PENDING` state, frontend "Grade pending";
  - the evidence guard;
  - reference cases as CI tests on a frozen real-data snapshot:
    - Sanders is graded as a movement donor base;
    - Pelosi is never graded on campaign-only evidence;
    - a no-evidence member is never lettered.
- Grades switch to person-level member by member as evidence completes.
- Exit criteria:
  - CI reference cases pass;
  - no published letter anywhere without complete evidence (checked by query).

**Stage 4: history and upkeep.**

- Build:
  - analysis snapshots and grade history;
  - incremental refresh;
  - retire `members:all` and, with the owner's OK, the legacy D1 database;
  - the full sweep for the same patterns elsewhere (see §10).

## 8. Verification standards (every stage)

- **Offline equivalence.** An offline harness in `scripts/` runs the real
  worker code against a snapshot of real KV and D1 data with stubbed FEC.
  It proves grades are identical where no change is intended, and it measures
  CPU, KV and D1 operations per run before and after. (An ad-hoc version was
  built during 2026-09-28's investigation; rebuild it properly in the repo.)
- **Live checks after every deploy, from Cloudflare analytics** (GraphQL
  `workersInvocationsAdaptive`, `kvOperationsAdaptiveGroups`), against the
  prior four weeks:
  - CPU p50 and p99;
  - `exceededResources` counts;
  - KV and D1 operations.
- **CI.** After every push, report every job of the Actions run for that
  commit. Nothing is called "passing" from local tests alone.
- **Docs.** Update `IMPLEMENTATION_STATUS.md` (dated entry),
  `DATABASE_REFERENCE.md`, `API_STRUCTURES.md`, `RUNBOOK.md` (every command
  must keep working) and `GRASSROOTS_CALCULATION_GUIDE.md`.

## 9. Every open issue, and where it goes

| Issue                            | Where it lands                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| #47 umbrella                     | This spec                                                                                                                                          |
| #46 CPU kills                    | Stage 1                                                                                                                                            |
| #45 first alert                  | Closes itself when checks pass                                                                                                                     |
| #44 big campaigns never finish   | Stage 2 (lanes, slices, analysis from D1, no growing progress record)                                                                              |
| #43 D1 holes                     | Stage 2 (write failure fails the page; slice counts prove completeness)                                                                            |
| #42 145 at 0%                    | Step 4 fix deployed (145 → 4). The remaining 4 are on the fallback path; Stage 3 makes that path pending, not a grade                              |
| #41 wrong FEC candidate          | Fixed by the crosswalk (deployed). Close after Stage 3 confirms no member is graded without verified identity                                      |
| #40 disputed denominators        | Stage 3 display rules                                                                                                                              |
| #39 prior-cycle grades           | Stage 3 guard (current-cycle evidence only)                                                                                                        |
| #38 frozen lastUpdated           | Stage 1                                                                                                                                            |
| #34 FARA                         | Stage 2 (SQL at completion, across all committees)                                                                                                 |
| #33 network / conduits           | Conduit and earmark totals kept in the Stage 2 analysis; connected-organisation lookups deferred                                                   |
| #32 person-level funding         | Stages 2–3                                                                                                                                         |
| #31 STOCK Act composite          | Deferred until after Stage 4 (needs grade history)                                                                                                 |
| #21 PAC colour coding            | Deferred (frontend nicety)                                                                                                                         |
| #20 donor concentration          | Superseded by Stage 2; close at its exit                                                                                                           |
| #19 tier calc broken             | Superseded by the concentration design and the Step 4 fix; close                                                                                   |
| #18 bio data                     | Deferred (feature)                                                                                                                                 |
| #16 hardcoded fallbacks          | Keys and `UPDATE_SECRET` done 2026-09-27; date fallbacks and magic numbers in the Stage 1 sweep; then close                                        |
| #14 combine delete and FEC cache | `fec_mapping_*` is still referenced 3× in the pipeline. If the crosswalk fully replaces it (**VERIFY**), retire the cache in Stage 1 and close #14 |
| #12 cron control API             | Deferred (low)                                                                                                                                     |
| #5 force-update endpoint         | The remaining bug (a member object passed as the committee ID) is fixed when admin endpoints move to `saveMember` in Stage 1                       |
| #1 voting data                   | Deferred (separate feature)                                                                                                                        |

## 10. Problems discussed 2026-09-28 that no issue covered

- **Strikes silently drop members** → removed (§4.3).
- **The default trust anchor lets unevidenced members reach S** → pending
  (§4.6).
- **Collections restart from zero on design changes** → never (§2, §4.3).
- **The itemized queue was last built 31 Aug.** A first pass longer than the
  30-day refresh would mean the queue never drains → refresh is incremental
  (§4.3).
- **`workers/recalculate-metrics.js`**, an old standalone worker that reads
  D1 → confirm whether it's deployed or used; delete if not.
- **`DATABASE_REFERENCE.md`** shows an outdated D1 schema and says grades come
  from D1 (they don't today) → rewrite in Stage 1–2.
- **The full sweep, beyond this spec.** Every read and write path and every
  per-run task, checked for:
  - whole-dataset writes;
  - unconditional work that changes nothing;
  - silent `catch` blocks that turn failure into "no data";
  - CPU against 10 ms.

## 11. Decisions the owner needs to make

1. Approve this spec (Stage 0).
2. Accept the first-pass timeline (§6), or approve the one-day D1 per-database
   write test that could shorten it.
3. The lane split of the D1 budget: default 50/50, big versus regular.
4. Confirm the deferrals in §9: #1, #12, #18, #21, #31.
