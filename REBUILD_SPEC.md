# Rebuild spec: collection, storage and grading around the person

**Status: DRAFT v2, awaiting owner approval. Nothing here is built yet.**
Written 2026-09-28 by Claude, who wrote the code this replaces. Revised
2026-10-03 after a review found four build-breaking gaps; they are fixed in
§4.3, §4.4, §4.6 and §4.10. Also added 2026-10-03: the FEC bulk file
(§4.11) and stock trading (§4.12). Umbrella issue: #47. Supersedes the fix plans in
#46 and #44; the evidence in those issues still stands.

Anyone building this: read the whole document first, then `CLAUDE.md` (and
§7 Stage 0 for the lines of `CLAUDE.md` this spec overrides). Every number
below was measured, or checked against Cloudflare's or the FEC's docs, on
the date given, unless marked **VERIFY**. Re-measure anything you rely on.

---

## 1. Why a rebuild, not more patches

The grading maths (`workers/tier-calculation.js`) is sound and tested. Also
sound, and kept: identity lookup (`fec-crosswalk.js`), the FEC reconciliation
idea, committee discovery (`person-funding.js`) and the alerts (`health.js`).
What I built underneath them is broken at the foundation:

1. **The unit is wrong.** In October 2025 (#20) I built donor collection
   around one committee per member, the principal campaign committee. I never
   asked how money reaches a member. Joint funds (money arrives at the
   campaign as one transfer; the donors are only in the fund's records) and
   leadership PACs (a separate committee) were invisible. Person-level
   collection (#32) was bolted on in September 2026 and has completed for
   nobody. Every live grade still uses the campaign committee alone.
2. **Every update rewrites everything.**
   - All 539 members live in one 3.5 MB KV value (`members:all`, 88% of it
     PAC donation lists only the detail popup shows). 14 functions
     read-modify-write the whole value to change one member.
   - Every pipeline run re-grades all 528 members; measured, it changed 0.
   - Every page view parses and re-serialises the whole blob.
   - Each collection re-saves its entire growing progress record every run.
3. **The workers are killed for it.** The free plan allows 10 ms CPU per
   invocation.
   - Pipeline runs use about 400 ms, so Cloudflare kills invocations for
     hours at a time, most days, including the site's own `/api/members`
     requests (#46).
   - The itemized worker uses 34–51 ms per collection run. That is mostly
     **reading the FEC's responses**: one 100-row Schedule A page is 383 KB
     (81 fields a row), so a 20-page run reads about 7.7 MB. Measured
     2026-10-03: 7.7 ms just to parse it on an M-series Mac; Workers CPUs are
     slower.
4. **The permanent donor record sets the pace of grading.**
   - D1 costs 5 row-writes per donation: the row, an unused `AUTOINCREMENT`
     counter and three indexes.
   - Collection stops for the day when the 85k self-cap is hit.
   - One queue handles one member at a time. AOC's campaign committee alone
     is about 600k FEC records, and everyone behind her waits.
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
- **No grade without complete evidence.**
  - A letter grade is published only when the evidence for every one of the
    member's committees is complete and reconciled (§4.6).
  - Until then the member shows **"Grade pending"** (owner decision
    2026-09-28), plus the FEC-reported figures, labelled plainly as covering
    the campaign committee only.
  - No capped letters, and no default-anchor grades.
- **Every member ends up graded.** Pending must always clear:
  - nobody is dropped (no strikes);
  - a failed collection retries with growing gaps;
  - a mismatch re-collects the affected slice;
  - anyone pending too long for their size raises an alert.

  Members with no FEC filings get N/A, not pending. Where these two rules
  could conflict (a mismatch in the FEC's own data), §4.6 defines the path,
  pending owner decision D3.

- **Lean, diff updates.** Write only the record that changed, and only if its
  value differs. Never rewrite or recompute a whole dataset to change one
  item. Any design that needs a whole-dataset write is raised with the owner
  first.
- **Work happens only when the data can have changed.** Campaign money only
  changes when committees file reports with the FEC, mostly quarterly. So
  refreshing anything about a member (totals, donors, grades) is triggered
  by **the FEC filing calendar** (§4.13), or by an explicit event: a new
  member, a corrected identity, a scoring change, a failed slice. Never by a
  clock.
  - No weekly, monthly, hourly or "rolling" re-checks of stored statistics.
  - No cron left running for work that is finished.
  - A finished cycle is never re-fetched.
  - Monitoring of the system itself (`/health`) is not covered by this rule.
- **History is never obliterated.**
  - Completed analyses are kept as dated snapshots.
  - Grade changes are kept as a history.
  - A design change builds on existing data or snapshots it first; it never
    restarts from zero silently.
- **D1 is the permanent donor record and the source of the analysis**
  (§4.4). It exists for accuracy (#20: "store every unique donor + full dollar
  amount, no aggregation that loses detail").
- **Free tier only.** No R2: it needs a billing subscription and bills
  overage. Never propose paid plans.
- **Owner-facing alerts come with a solution:** "fixed X", or "problem Y,
  proposed fix Z, need a yes".

## 3. Platform limits and current usage

Cloudflare docs checked 2026-09-28 and 2026-10-03.

| Limit (Workers Free)                                     | Value                                                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU per invocation (HTTP and cron)                       | **10 ms**. Over it: error 1102 `exceededResources`                                                                                                                                                                |
| Cron triggers                                            | 5 per account; a cron invocation may run up to 15 min wall time                                                                                                                                                   |
| Requests per day                                         | 100,000 (**VERIFY** whether cron invocations count)                                                                                                                                                               |
| Outbound `fetch` per invocation                          | 50                                                                                                                                                                                                                |
| Calls to Cloudflare services (KV, D1, R2) per invocation | 1,000                                                                                                                                                                                                             |
| KV per day, per account (operations fail when exceeded)  | 1,000 writes, 100,000 reads, 1,000 deletes, 1,000 lists                                                                                                                                                           |
| KV writes to the same key                                | 1 per second                                                                                                                                                                                                      |
| KV value size / storage                                  | 25 MiB / 1 GB                                                                                                                                                                                                     |
| D1 rows written / read per day                           | 100,000 / 5,000,000 (**VERIFY**: per account or per database; the docs don't say)                                                                                                                                 |
| D1 database size                                         | **500 MB per database**, 10 databases, 5 GB per account                                                                                                                                                           |
| D1 per query                                             | 30 s maximum duration; 100 bound parameters                                                                                                                                                                       |
| D1 queries per invocation                                | 50. The docs say per-query limits apply to each statement in a batch. **VERIFY** whether batch statements count toward the 50: AOC's 3,453 donations on 2026-09-28 all landed, at well over 50 statements per run |
| Worker bindings                                          | Fixed at deploy time: a worker can only use D1 databases declared in its config                                                                                                                                   |
| Cache API                                                | Does not work on `*.workers.dev`, where the API lives. Not used.                                                                                                                                                  |
| FEC API                                                  | 60 requests per minute per key                                                                                                                                                                                    |

**Current usage** (14–27 Sept):

- KV: 290–500 writes and 15k–31k reads a day.
- API worker: 72–113 invocations a day; 72 are cron.
- D1 (`taskforce-purple-donors`): **414 MB of 500 MB**; 1,689,625 rows
  (1,307,609 with `sub_id`) across 480 members.

**FEC behaviour to design for** (measured 2026-09-28 and 2026-10-03):

- **Deep cursor pages time out** (504 after 30 s) on big committees. Adding
  `max_date` set to the cursor's date fixes it; this is live.
- **Whole-cycle counts for big committees are estimates** and drift: AOC's
  C00639591 read 548,837 and then 641,806 on the same day,
  `is_count_exact: false`.
- **One-month slices returned an exact count** (July 2025: 30,081,
  `is_count_exact: true`). Only one month has been tested. Busy months may
  still return estimates, so slices must split further (§4.3).
- **Individual requests fail transiently.** The first attempt at the same
  month came back empty, and the retry worked.
- **Responses are heavy:** 383 KB per 100-row page.
- **Only about a third of a big committee's records are individual
  donations.** AOC: 3,453 of 10,200 records seen. The rest are memo lines
  (for example conduit lumps) and committee money.

## 4. Target design

### 4.1 Storage map

KV writes are the scarcest resource (1,000 a day for the whole account), so
KV holds only what the site and API read often. Anything written every run
lives in D1.

| Where             | Key / table                    | What                                                                                                       | Written when                                                                       |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| KV                | `member:{bioguideId}`          | Full member record, the source of truth for member data                                                    | Only when a field actually differs (diff)                                          |
| KV                | `members:list`                 | Only what the list page needs, measured at 155 KB for 539 members                                          | Only when a list-visible field of some member changes; at most once per invocation |
| KV                | `analysis:{bioguideId}`        | Current published analysis, including evidence status                                                      | On completion                                                                      |
| D1 control DB     | `collect_state`                | Per member: lane, current committee and slice, cursor, backoff, last error                                 | Every collection run (cheap here; it would exhaust KV)                             |
| D1 control DB     | `slices`                       | Per member, committee and slice: date range, the FEC's exact count, records seen, donations stored, status | As slices progress                                                                 |
| D1 control DB     | `analysis_snapshots`           | Every completed analysis, dated, never overwritten                                                         | On completion                                                                      |
| D1 control DB     | `grade_history`                | One row per published grade change, with its snapshot ID                                                   | Only when a grade changes                                                          |
| D1 control DB     | `shards`                       | Which donations database holds each member's cycle                                                         | When a member's cycle is assigned                                                  |
| D1 control DB     | `d1_write_budget`, FARA master | The write ledger; FARA registrants and employer matches                                                    | As today                                                                           |
| D1 donation shard | `donations`                    | One row per individual donation, keyed by FEC `sub_id`                                                     | As collected                                                                       |
| D1 donation shard | `fara_employer_matches` (copy) | The 225 employer strings, copied into every shard; D1 cannot join across databases                         | When the FARA list is refreshed                                                    |

`members:all` stays untouched as a rollback copy for two weeks after
cut-over, then goes. `taskforce-purple-donors` becomes read-only legacy
history (§4.5).

### 4.2 The one write path for member data

`saveMember(env, before, after)`:

- Diff field by field. Nothing differs: no write.
- Otherwise write `member:{id}`.
- If a list-visible field differs, patch that member's entry in
  `members:list`, with one list write per invocation however many members
  changed.

All 14 current writers of `members:all` go through it. No code writes a
whole-dataset value again.

**Re-grade only on change:**

- The members to re-grade are the one just processed and those whose
  analysis changed. The analysis write carries KV metadata `{updatedAt}`; the
  pipeline lists that prefix once per run and compares it with the member's
  `lastMergedAt`.
- A **full re-grade** happens only on an explicit event: a scoring change,
  or the filing-calendar refresh (§4.13). It's spread across invocations,
  about 50 members each, because reading every member and analysis in one
  run exceeds the 1,000-calls-per-invocation limit. There is no standing
  rolling re-check.
- **Concurrency.** An admin re-grade running at the same time as another
  write can lose one list patch, because KV has no transactions. Admin
  endpoints therefore take a simple lock (a D1 row) while they write, so the
  clash can't happen. There's no background job to repair it afterwards.

### 4.3 Collection around the person

- **Which committees.** Keep `person-funding.js` discovery: crosswalk IDs,
  then the member's authorized committees, leadership PAC and the joint funds
  that count as theirs. The donor pool is every committee whose money the
  member received.
- **Small runs, often (CPU), only while there is collection to do.**
  - **Only while it has work.** During a first pass or a filing-deadline
    refresh, collection runs **every minute**, fetching **a few pages** per
    run: start at 3, and tune to stay under 10 ms by measured CPU. When the
    work is done, collection stops.
    - The first invocation that finds nothing to do disables collection
      (a D1 flag), and later invocations exit at once without touching the
      FEC.
    - The filing-calendar trigger (§4.13) re-enables it.
  - **Instead of an idle cron.** A cron schedule can't be switched off
    without a deploy. So the every-minute trigger exists only in the
    backfill/refresh deploy; between refreshes the worker is deployed with
    one daily calendar check (§4.13). **VERIFY** whether simply exiting
    early is cheap enough to keep one schedule; if it is, the D1 flag alone
    will do.
  - At 3 pages a minute, FEC paging is about 430k records a day. D1, not
    CPU, then sets the pace.
  - One handler decides what each minute does: collection for a lane, or
    discovery for a member whose committees aren't known yet. Discovery also
    runs on the calendar and on events, not as a standing sweep.
  - Per-run state goes to D1 `collect_state`, not KV: about 1,440 runs a day
    would exceed KV's whole daily write allowance.
- **Two lanes.**
  - Big campaigns (for example, over 100k FEC records across their
    committees) and everyone else get separate queues and separate shares of
    the daily D1 budget. The default is 50/50 (decision D4).
  - Lanes alternate minutes, and within a lane one member is collected at a
    time. A giant only slows itself.
- **Slices with exact counts.**
  - Collect each committee in date slices. Start with calendar months. If the
    FEC's count for a slice is not exact (`is_count_exact: false`), split it
    into weeks, then days, until it is.
  - Every slice records the FEC's exact count. Within a slice, use
    `last_index` plus `max_date` pagination.
- **Two checks per slice, because D1 stores only individual donations** (a
  third of a big committee's records):
  1. **Records seen = the FEC's exact count for the slice.** Every record
     paged through is counted, memo lines and committee money included. This
     proves we read the whole slice.
  2. **Donations in D1 for the slice = our count of individual donations
     classified in it.** This proves we stored everything we should have.

  A slice is complete only when both hold. A failure re-collects just that
  slice.

- **Failures.**
  - Temporary FEC errors (429, 5xx) end the run and keep everything already
    fetched.
  - Retries back off: next run, then 1 h, 6 h, 24 h.
  - No strikes and no drops. Every failure records its reason and time.
  - Repeated failure alerts but never blocks the other lane.
- **Never restart from zero.** Complete slices are kept. A change to the pool
  adds or removes committees' slices; it never discards the others.
- **Refresh is incremental and calendar-driven** (§4.13). After a filing
  deadline:
  - fetch the slices covered by the newly filed reports;
  - re-check the counts only of slices whose reports were amended (the FEC
    filings list shows amendments; one call per amended report);
  - re-collect only slices whose count changed.

  Nothing runs between deadlines.

### 4.4 Analysis computed from the evidence in D1

The growing progress record (`donorTotals`, `allAmounts`) goes away.
Collection writes donations to the member's shard and state to the control
database. At completion, the analysis is computed **by SQL in the shard**
over the member's rows:

- unique donors (donor key `FIRST|LAST|STATE|ZIP5`, as today);
- top-10 share;
- the Nakamoto coefficient (window function: cumulative sum ordered by donor
  total, descending);
- median;
- conduit and earmark totals;
- FARA employer matches (join against the shard's copy of
  `fara_employer_matches`).

The worker receives a handful of numbers, so its CPU stays small. An
AOC-size member is a few hundred thousand rows read, against 5M a day.

**VERIFY in Stage 0:** D1 supports the window function, and the query runs
well under D1's 30 s limit at AOC's size. Test it on the largest member
already in the legacy database (C001098: 98,131 transactions), then
extrapolate. If it's too slow, compute per committee and combine the donor
totals in a small second query.

The grade is therefore computed from the stored evidence itself. The evidence
and the grade cannot disagree.

### 4.5 D1 layout (v2)

- **Databases, all pre-provisioned and bound in the worker's config** (they
  cannot be created on the fly):
  - `tfp-control`: state, slices, snapshots, grade history, shard registry,
    write ledger, FARA master tables.
  - `tfp-donations-2026-a`, `-b`, …: donation shards.
- **Sizing the shards.** The legacy database averages about 245 bytes per row
  including indexes, which is about 2M rows per 500 MB database. Size the
  number of shards from the Stage 0 census (§6), with headroom. A member's
  whole cycle lives in one shard. Big-lane members can have their own shard
  (the owner's "separate DBs for big players").
- **Donation schema.**
  - `donations(sub_id TEXT PRIMARY KEY, bioguide_id, committee_id, cycle,
slice_id, contributor_first_name, contributor_last_name, contributor_state,
contributor_zip, contributor_employer, contributor_occupation, amount,
receipt_date, row_class) WITHOUT ROWID`, plus one index on
    `(bioguide_id, cycle)`.
  - No `AUTOINCREMENT`, and no employer index.
  - **VERIFY** that D1 supports `WITHOUT ROWID`, and **measure** the real
    row-writes per new row and per duplicate on production before sizing
    anything, as was done for v1 (RUNBOOK §6).
- **Meter.** `INSERT ... ON CONFLICT DO NOTHING`, charged from `meta.changes`.
  If Stage 0 shows the write limit is per database, the meter becomes per
  database.
- **A failed D1 write fails the page.** The cursor doesn't advance and the
  page isn't counted (#43).
- **Legacy database.** `taskforce-purple-donors` becomes read-only history.
  - It isn't reused for v2 evidence: copying rows costs the same D1 writes as
    inserting them fresh, and D1 can't analyse one member across two
    databases.
  - It isn't bulk-deleted: deletes cost about 4 row-writes each.
  - It's retired after the first v2 pass, with the owner's OK.
- **The in-flight collection.** The current itemized worker (AOC at the front
  as of 2026-09-28) keeps running on the old path until Stage 2's cut-over,
  then stops. Its rows stay in the legacy database, and v2 collects every
  member fresh.

### 4.6 Grading and publication

- **Inputs.** The D1-computed analysis (§4.4) plus FEC committee totals,
  both summed across the person's committees and netted for money moved
  between their own committees.
- **The guard.** It runs on every re-grade. A letter is published only if:
  - every slice of every committee is complete (both checks in §4.3);
  - the itemized-individual money we counted matches each committee's FEC
    total to the dollar;
  - the evidence is for the cycle being graded (§4.10).

  Otherwise the result is `PENDING`, with a reason and progress. The default
  trust anchor can never produce a published grade.

- **When our records match the FEC exactly but the money doesn't** (decision
  D3). This happens when every slice's count matches but the FEC's own
  summary total differs from the sum of its itemized records, which is a
  quirk in the FEC's data, not ours.
  - The proposed path: re-collect the money-mismatched slices once.
  - If the counts still match exactly and the money still differs, publish
    the grade with the difference disclosed in plain English: "the FEC's
    summary total differs from its own itemized records by $X".
  - Otherwise such a member would stay pending forever, which breaks "every
    member ends up graded".
- **Ringfences** (DISPUTED / UNVERIFIED) stay, with #40's rule: no percentage
  whose denominator is in dispute.
- **Grade history.** Each published change gets a `grade_history` row
  pointing at its `analysis_snapshots` row.

### 4.7 Site and API

- `/api/members` returns the `members:list` string exactly as stored, with no
  parse. The header date comes from when the list was last written (#38).
- `/api/member-detail` returns `member:{id}`, the current analysis, evidence
  status and progress, and grade history. The popup takes its heavy fields
  (PAC lists, FARA firms, conduits) from here.
- Frontend:
  - **"Grade pending"** in plain English, with what's been checked so far.
  - FEC figures labelled "campaign committee only" until person-level
    evidence is complete.
  - Grades show which cycle they cover (§4.10).
  - Apolitical wording; no politician names in UI examples.

### 4.8 Pipeline worker (Congress + FEC totals)

- It keeps its job: the member list from Congress.gov, and FEC committee
  totals and PAC details.
- **On events, not a clock.** Today it cycles through members every 20
  minutes, re-fetching FEC totals that change only when a report is filed.
  - **FEC totals and PAC details** are refreshed after each filing deadline
    (§4.13) and for a member whose filings list shows a new or amended
    report.
  - **The Congress.gov member list** is checked once a day. Membership
    changes rarely, but a death, resignation or special election must show
    up promptly. That's one cheap call a day; the member data itself is
    written only on a diff.
- Every write goes through `saveMember`, and it processes only what changed.
- Its FEC responses are heavy too (§3). Keep pages per run small, and
  **measure CPU per run with real FEC responses**, not stubs: the 2026-09-28
  offline run used stubs and understated it.

### 4.9 Alerts (`health.js`)

Keep what exists and add:

- a member pending longer than expected for their size;
- a lane that hasn't advanced in 30 h;
- a slice that failed a check twice;
- any donations database over 400 MB;
- KV or D1 daily usage over 80% of the limit;
- a published grade older than its cycle (§4.10).

An optional extra is a Cloudflare kill-count check. It needs a read-only
analytics token that the owner creates and stores as a GitHub secret.

### 4.10 Election cycles (decisions D1 and D2)

Today every member, senators included, is graded on the current FEC two-year
period only (`cycleForYear`, `cycle=` on totals). This has to be defined
before the 2026 cycle closes on **31 December 2026**: a 70–140-day first pass
finishes about then.

- **Rollover (D1). Proposed:**
  - A member's published grade is their **most recent complete cycle**,
    labelled with that cycle ("2025–26 cycle").
  - From 1 January 2027 the 2028 cycle is collected incrementally in the
    background.
  - A member switches to the new cycle once its evidence is complete and it
    has at least one full FEC quarterly report (Q1 2027, filed by 15 April).
  - Until then the 2026 grade stays, and the card shows the new cycle's money
    so far as the current trajectory. That covers the owner's "historical
    trend(s) AND current trajectory".
- **Senators (D2).** Senators raise across a six-year term, but are graded on
  two-year periods.
  - Option (a): keep two-year periods for everyone, the same rule for all.
  - Option (b): grade senators on all three periods of their current term.

  Proposed: (a), with the senator's earlier periods shown as history, because
  (b) triples their collection.

### 4.11 The FEC bulk file: replacing most of the API backfill

**Found and validated 2026-10-03** (results below). It is fast and nearly
complete but not exact, so the proposal is a hybrid: the bulk file, plus the
API only for slices whose counts differ. If adopted, rewrite §4.3, §4.5, §6
and Stage 2 around it before building.

**What exists.** The FEC publishes every itemized individual contribution of
a cycle, to every committee, as one file: `indiv26.zip`.

- **Size and freshness.** 2.2 GB compressed for 2026 (4.2 GB for the full
  2024 cycle), re-published weekly by the FEC; last modified Sunday 27 Sept 2026.
- **Columns.** The same fields we collect: committee ID, donor name, city,
  state, zip, employer, occupation, date, amount, memo code, transaction type,
  file number and `SUB_ID` (the same unique record ID the API returns).

**What it would change.**

- **One pass after each filing deadline** (§4.13). The FEC re-publishes the
  file weekly, but we only need it when new reports are due.
  - A scheduled **GitHub Actions** job (free for public repos; the runners
    have the disk and memory a Worker doesn't) downloads the file and streams
    it.
  - It keeps only the rows for the committees in every member's donor pool.
  - It computes every member's donor statistics in one go, across all their
    committees: unique donors, top-10 share, Nakamoto, median, conduit and
    earmark totals, FARA employer matches.
- **No backfill queue.** The 70–140-day first pass (§6), the lanes, slices,
  shards and the D1 write budget for donations all stop being needed for
  grading. Small and huge campaigns finish in the same pass.
- **It matches the filing cycle.** Money changes only when committees file,
  and the pass runs only after filing deadlines.
- **The source of truth** is the dated FEC file plus our derived results,
  which are reproducible from it.
  - What D1 keeps becomes a decision (D6): every donation row as before, or
    per-member donor totals and the top donors with their `SUB_ID`s as
    evidence pointers.
  - Owner's principle to respect: "no aggregation that loses detail" (#20).

**Validation results (2026-10-03).** The file was processed on the owner's
Mac with DuckDB, version of 27 Sept 2026.

- **Speed.** All 32,280,757 rows (9,374 committees), 12 GB unzipped, were
  scanned in **2.4 s**. Extracting chosen committees took 3.1 s. Download
  53 s, unzip 41 s. Cost isn't a factor in how often it runs; the filing
  calendar is (§4.13).
- **Concentration matches the API-collected analyses:**

  | Member           | Bulk file: donors / Nakamoto | API analysis: donors / Nakamoto |
  | ---------------- | ---------------------------- | ------------------------------- |
  | Williams (small) | 165 / 23                     | 167 / 23 (20 Sept)              |
  | Pelosi campaign  | 2,718 / 404                  | 2,729 / 408 (17 Aug)            |
  | Sanders          | 20,189 / 3,147               | 13,102 / 1,534 (14 Jan, stale)  |

  All three are in the same concentration band either way.

- **But it is NOT exact, for two reasons:**
  1. **Amounts are rounded to whole dollars.** No row has cents. Gaps
     against the FEC's itemized totals:
     - Sanders: $1,101 over 122k rows;
     - Pelosi's campaign: $963;
     - PAC to the Future: $1,147;
     - Victory Fund: $0.36.
  2. **It is missing records the API has.** Williams (C00752584): 31 of 351
     API records ($7,795 of $154,007, including one $7,000 gift) are absent
     from both `itcont.txt` and the `by_date` files.
     - One missing record is live in the API today, on the Q2 2026 report
       (file 1997804, line 11AI). The bulk file contains other rows from that
       same report.
     - The cause is unknown. The 320 matched records agree to the dollar.
- **Mapping.** Transaction types `15` (direct), `15E` (earmarked) and `11`
  (e.g. tribal) are the itemized-individual money. `22Y` are refunds.
  `MEMO_CD = 'X'` rows are memos.

**Consequence: the bulk file can't be the evidence on its own. A hybrid
design meets the exactness rule** (proposed; decision D6):

1. **Bulk pass after each filing deadline** (GitHub Actions) builds every member's donor set
   across all their committees in seconds.
2. **Per committee and slice, compare** the bulk record count with the FEC
   API's exact count (§4.3 slices). Matching slices are done. Mismatched
   slices fetch **only those slices** from the API, and the API version
   replaces the bulk rows. Williams-size gaps cost a handful of API calls,
   not a backfill.
3. **Cents.** Grades and concentration are unaffected by whole-dollar
   rounding. To meet "money to the dollar", either:
   - (a) fetch exact amounts from the API for the money check (costly; it
     brings the API backfill back); or
   - (b) reconcile with the FEC's rounding made explicit: the gap must be
     under $0.50 per record, and the record sets must match exactly by
     `SUB_ID`.

   Owner decision; (b) is proposed. It is a stated, explainable rule, not a
   tolerance for missing money: the records themselves must all be present.

Writing the results into Cloudflare from Actions needs a Cloudflare API
token, stored as a GitHub secret. The owner creates it once; Claude doesn't
handle credential values.

### 4.12 Stock trading (design placeholder; rules undecided)

Issue #31. The owner wants trading folded into the grade: "a member can enter
at S and trade themselves to F". This section records what disclosure
actually looks like and every open question. **No scoring rule is decided.**

**What's disclosed, and how (checked 2026-10-03):**

- **The House** (disclosures-clerk.house.gov).
  - **A structured index.** A yearly zip (`2026FD.zip`, 62 KB) holds an XML
    and TXT list of every filing: name, state and district, filing type,
    date and a document ID. 2026 so far has 407 stock-trade reports
    (Periodic Transaction Reports, "PTRs", type `P`).
  - **The trades are only inside per-report PDFs**
    (`/public_disc/ptr-pdfs/2026/{DocID}.pdf`).
    - **88% (360 of 407) are filed electronically.** Their PDFs carry real,
      extractable text: asset, ticker, sale or purchase, transaction and
      notification dates, amount range, owner, and sometimes a description
      with exact share counts and prices.
    - **12% (47) are scanned paper:** images, no text. These need OCR or
      manual entry.
  - **There is no data feed or API of the trades themselves.**
- **The Senate** (efdsearch.senate.gov).
  - **Behind a legal agreement.** Searching requires clicking "I understand
    the prohibitions" first. Not done: accepting it is the owner's call.
  - **Format unverified.** From general knowledge, electronically filed
    reports are HTML tables and paper ones are scanned images.
- **The law** (5 U.S.C. app. § 105(c), quoted on the Senate's agreement page)
  applies to House and Senate reports alike. It's unlawful to use a report:
  - "for any commercial purpose, other than by news and communications media
    for dissemination to the general public";
  - "for determining or establishing the credit rating of any individual";
  - "in the solicitation of money for any political, charitable, or other
    purpose".

  The penalty is up to $10,000 per violation.

- **Amounts are ranges** ($1,001–$15,000, $15,001–$50,000, …), not exact.
- **Filing rule.** Trades must be reported within 30 days of notification and
  45 days of the trade.

**When it runs.** Trade reports aren't filed on the quarterly calendar; each
is due within 45 days of the trade. The daily calendar check (§4.13) also
fetches the House index (one 62 KB file). It processes only document IDs it
hasn't seen, and does nothing if there are none.

**Where it would run.** PDF parsing and OCR can't fit in a Worker's 10 ms. It
runs in a scheduled GitHub Actions job (the same pattern as §4.11), which
writes parsed trades into D1. The volume is small: hundreds of reports a
year.

**How it fits the rebuild.** Trades become a second kind of evidence
alongside donations, each with its own completeness check.

- A grade that includes trading is only published when both are complete.
- What counts as complete for trades is itself an open question: every
  report in the House index parsed, and scans handled?

**Open questions** (owner; nothing to be built until answered):

- T1. What counts against a member?
  - owning individual stocks at all;
  - trading at all;
  - trading in industries their committees oversee;
  - late filing (past the 45-day rule);
  - volume or value;
  - trades by a spouse or dependent ("Owner" column);
  - trades just before related legislation or committee action.
- T2. How much can trading move the grade, and can it ever raise one?
- T3. How are amount ranges scored: midpoint, low end, or band?
- T4. Scanned paper filings: OCR (error-prone), manual entry, or "can't read
  this, so disclosure-quality penalty"?
- T5. Accepting the Senate agreement, and confirming Task Force Purple's use
  is lawful: it's dissemination to the public, and the site must never use
  trade data to ask for money (donation appeals).
- T6. Third-party parsed feeds (the Apify actors offered on #31, others):
  acceptable if free and their terms allow it, or parse it ourselves?
- T7. Members' broader holdings: annual disclosures (types `A`/`O`) also list
  assets. In scope?
- T8. Which committee-to-industry mapping defines "industries they oversee",
  and from what source?

### 4.13 The FEC filing calendar drives every refresh

- **The deadlines.** For candidate committees (House and Senate):
  - quarterly reports due 15 April, 15 July and 15 October, and a year-end
    report due 31 January;
  - in an election year, a pre-general report (12 days before the election)
    and a post-general report (30 days after);
  - pre-primary reports, depending on the state's primary date;
  - monthly filers (some PACs, party committees and joint funds) on the
    20th.

  The FEC publishes the exact dates each cycle. Load them from the FEC's
  calendar, never hard-code them.

- **The trigger.** A single **daily check** (one cheap call) asks whether a
  deadline has passed since the last refresh, plus a few days for the FEC to
  process the reports. If not, it ends. If so, it starts the refresh: the
  bulk pass (§4.11) and/or collection (§4.3), FEC totals for the pipeline
  (§4.8), then re-grading the members whose data changed.
- **The daily check is the only thing that runs on a clock, apart from
  `/health`.** If a cron trigger can't be avoided, it does nothing beyond
  that one check.
- **Late and amended filings.** The refresh compares each member's filings
  list with what we hold, and fetches only reports that are new or amended
  since the last refresh.
- **Finished cycles are never refreshed.** Their last refresh is final,
  apart from an amendment found during a refresh of the next cycle, which is
  rare and handled as an event.

## 5. Budgets the design must meet (check each per stage)

| Resource                         | Limit                     | Target                                                         |
| -------------------------------- | ------------------------- | -------------------------------------------------------------- |
| CPU per invocation, both workers | 10 ms                     | Under 10 ms; zero `exceededResources` over 48 h                |
| Itemized invocations / day       | 100,000 requests          | About 1,440 during a backfill or refresh; about 1 otherwise    |
| KV writes / day                  | 1,000                     | Well below today's 290–500 (collection state moved to D1)      |
| KV reads / day                   | 100,000                   | Below today's 15–31k                                           |
| KV lists / day                   | 1,000                     | ≤ ~100                                                         |
| D1 writes / day                  | 100,000 (self-cap 85,000) | Meter unchanged; lanes split it; state rows are a few thousand |
| D1 reads / day                   | 5,000,000                 | Completion SQL plus FARA under 1M on a heavy day               |
| D1 size                          | 500 MB per database       | No database over 400 MB (alert)                                |
| FEC calls                        | 60 / min per key          | ≤ ~4 a minute itemized, plus the pipeline's                    |

## 6. First full pass: what to expect

Every member's first person-level pass has to write every individual
donation to D1.

- **Size: unknown until measured.** The earlier guess was 2–4M rows. Stage 0
  replaces it with a **census**: discovery plus exact sliced counts for every
  member's committees. That's cheap: one count call per slice, at most a few
  thousand calls spread over days.
- **Pace.** D1 writes set the pace: at about 3 row-writes per row (to be
  measured) under the 85k cap, about 28k donations a day. At 2–4M rows,
  that's about 70–140 days.
- **If the write limit is per database** (Stage 0 test), the pace multiplies
  by the number of shards written in parallel.
- **Order.** Small campaigns finish in hours to days. Big ones take weeks in
  their own lane. After the first pass, refresh is incremental and small.

## 7. Stages (each proven live before the next starts)

**Stage 0: approve, measure, freeze.**

- The owner approves this spec and decides D1–D5 (§11).
- **Update `CLAUDE.md` at approval** where it contradicts this spec, or a
  builder will follow the old lines:
  - "KV is the source of truth for tiers. D1 is an analytical mirror" →
    D1 holds the evidence and the analysis; KV holds member records, the
    list and published analyses.
  - "failures defer to the end with a retry budget. Preserve this pattern" →
    no strikes; back off and alert (§4.3).
  - The architecture diagram and the crons (`*/20`, "one member/run").
- **Measurements, before anything is built:**
  1. **Is the D1 write limit per database or per account?**
     1. Pause both crons.
     2. On a scratch database, write past 100k rows in one UTC day.
     3. See whether writes to a second scratch database still succeed.
     4. Delete both and resume the crons.

     The owner OKs the day (D5).

  2. **How do D1 batch statements count** toward the 50 queries per
     invocation?
  3. **Does D1 support `WITHOUT ROWID`** and window functions, and how fast is
     the analysis SQL at the largest member's size (§4.4)?
  4. **Itemized CPU** per run at 1–5 pages, on real FEC responses.
  5. **The census** (§6), which replaces the timeline guess and sizes the
     shards.
  6. **FEC bulk file: validated 2026-10-03** (§4.11). If D6 adopts the hybrid, rewrite §4.3,
     §4.5, §6 and Stage 2 around the deadline-driven bulk pass before building
     them.
- **Freeze.** No more patches to the old collection and storage paths
  except to stop active harm.

**Stage 1: storage diffs** (stops the kills; §4.1–4.2, 4.7–4.8).

- Build:
  - `member:{id}` and `members:list` with `saveMember`;
  - re-grade only on change and on explicit events;
  - the pipeline moved to the filing calendar (§4.8, §4.13);
  - `/api/members` served as stored;
  - the popup fed from member-detail;
  - #38.
- Migration: about 540 KV writes. Run it just after 00:00 UTC (5 pm
  Pacific), in two halves over two nights. Until a member has their own key,
  reads fall back to `members:all`.
- Exit criteria:
  - offline, identical grades and list fields for all 539 members from the
    same snapshot;
  - 48 h with zero `exceededResources` on the pipeline;
  - KV writes below baseline.

**Stage 2: evidence** (§4.3–4.5).

- Build:
  - the control database and the shards;
  - every-minute small runs;
  - slices with exact counts and both checks;
  - the two lanes;
  - backoff, no strikes;
  - write failures fail the page;
  - analysis by SQL;
  - FARA across all committees;
  - cut-over from the old itemized path (§4.5).
- Exit criteria, with each of these complete with every slice passing both
  checks and analysed from D1:
  - one small member;
  - Sanders;
  - Pelosi (campaign, PAC to the Future, Victory Fund share);

  and AOC progressing in the big lane with zero CPU kills.

**Stage 3: the guard** (§4.6, 4.7, 4.10).

- Build:
  - `PENDING` and the frontend "Grade pending";
  - the evidence guard and the D3 path;
  - cycle labels and the rollover rule;
  - reference cases as CI tests on a frozen real-data snapshot:
    - Sanders is graded as a movement donor base;
    - Pelosi is never graded on campaign-only evidence;
    - a no-evidence member is never lettered.
- Grades switch to person-level member by member as evidence completes.
- Exit criteria:
  - CI reference cases pass;
  - no published letter without complete evidence (checked by query).
- **Deadline: the rollover rule must be live before 1 January 2027.** If the
  stages are behind, build it on its own, ahead of the rest of Stage 3. This
  is the one date that can't move.

**Stage 4: history and upkeep.**

- Build:
  - grade history and snapshots in the site;
  - calendar-driven incremental refresh, including amended reports (§4.13);
  - retire `members:all` and, with the owner's OK, the legacy database;
  - the full sweep (§10).

## 8. Verification standards (every stage)

- **Offline harness in `scripts/`.** It runs the real worker code against a
  snapshot of real KV and D1 data and **real recorded FEC responses**, not
  empty stubs. It proves grades are identical where no change is intended,
  and measures CPU, KV and D1 operations per run before and after.
- **Live checks after every deploy, from Cloudflare analytics** (GraphQL
  `workersInvocationsAdaptive`, `kvOperationsAdaptiveGroups`), against the
  prior four weeks:
  - CPU p50 and p99;
  - `exceededResources` counts;
  - KV and D1 operations.
- **CI.** After every push, report every job of that commit's Actions run.
  Nothing is "passing" from local tests alone.
- **Docs.** Update `IMPLEMENTATION_STATUS.md` (dated entry),
  `DATABASE_REFERENCE.md`, `API_STRUCTURES.md`, `RUNBOOK.md` (every command
  must keep working), `GRASSROOTS_CALCULATION_GUIDE.md` and `CLAUDE.md`.

## 9. Every open issue, and where it goes

| Issue                            | Where it lands                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| #47 umbrella                     | This spec                                                                                                                            |
| #46 CPU kills                    | Stage 1 (pipeline); Stage 2 (itemized)                                                                                               |
| #45 first alert                  | Closes itself when checks pass                                                                                                       |
| #44 big campaigns never finish   | Stage 2 (lanes, slices, analysis from D1, small runs)                                                                                |
| #43 D1 holes                     | Stage 2 (write failure fails the page; per-slice donation check)                                                                     |
| #42 145 at 0%                    | Step 4 fix deployed (145 → 4). The remaining 4 are on the fallback path; Stage 3 makes that path pending                             |
| #41 wrong FEC candidate          | Fixed by the crosswalk. Close after Stage 3 confirms no member is graded without verified identity                                   |
| #40 disputed denominators        | Stage 3 display rules                                                                                                                |
| #39 prior-cycle grades           | Stage 3 (cycle labels and the rollover rule, §4.10)                                                                                  |
| #38 frozen lastUpdated           | Stage 1                                                                                                                              |
| #34 FARA                         | Stage 2 (SQL at completion against each shard's copy)                                                                                |
| #33 network / conduits           | Conduit and earmark totals kept in the Stage 2 analysis; connected-organisation lookups deferred                                     |
| #32 person-level funding         | Stages 2–3                                                                                                                           |
| #31 STOCK Act composite          | Designed for in §4.12 (disclosure formats checked, open questions T1–T8); build waits on the owner's answers                         |
| #21 PAC colour coding            | Deferred                                                                                                                             |
| #20 donor concentration          | Superseded by Stage 2; close at its exit                                                                                             |
| #19 tier calc broken             | Superseded by the concentration design and the Step 4 fix; close                                                                     |
| #18 bio data                     | Deferred                                                                                                                             |
| #16 hardcoded fallbacks          | Keys and `UPDATE_SECRET` done 2026-09-27; date fallbacks and magic numbers in the Stage 1 sweep; then close                          |
| #14 combine delete and FEC cache | `fec_mapping_*` is still referenced 3× in the pipeline. If the crosswalk fully replaces it (**VERIFY**), retire it in Stage 1; close |
| #12 cron control API             | Deferred                                                                                                                             |
| #5 force-update endpoint         | The remaining bug (a member object passed as the committee ID) is fixed when admin endpoints move to `saveMember` in Stage 1         |
| #1 voting data                   | Deferred                                                                                                                             |

## 10. Problems found outside the issues

- **Strikes silently drop members** → removed (§4.3).
- **The default trust anchor lets unevidenced members reach S** → pending
  (§4.6).
- **Collections restart from zero on design changes** → never (§2, §4.3).
- **The itemized queue was last built 31 Aug.** A first pass longer than the
  30-day refresh means the queue never drains → refresh is incremental
  (§4.3).
- **FEC responses are heavy** (383 KB a page), which the original diagnosis
  missed → small runs, every minute, only while there's collection to do
  (§4.3).
- **No rule existed for cycle rollover or senators' six-year terms** → §4.10.
- **`workers/recalculate-metrics.js`**, an old standalone worker that reads
  D1 → confirm whether it's deployed or used; delete if not.
- **`DATABASE_REFERENCE.md`** shows an outdated D1 schema and says grades come
  from D1 → rewrite in Stages 1–2.
- **The full sweep.** Every read and write path and every per-run task,
  checked for:
  - whole-dataset writes;
  - unconditional work that changes nothing;
  - silent `catch` blocks that turn failure into "no data";
  - CPU against 10 ms.

## 11. Decisions the owner needs to make

1. **D1 – Cycle rollover** (§4.10). Keep the last complete cycle's grade,
   labelled, until the new cycle has complete evidence and its first
   quarterly report, showing the new cycle as trajectory meanwhile. Yes or
   no?
2. **D2 – Senators** (§4.10). Two-year periods like everyone else, with
   earlier periods shown as history (proposed), or their whole six-year term?
3. **D3 – Records match the FEC exactly but the money doesn't** (§4.6).
   Publish with the difference disclosed (proposed), or stay pending?
4. **D4 – Lane split** of the daily D1 budget: 50/50 big versus regular
   (proposed)?
5. **D5 – The one-day D1 write test** (Stage 0). It pauses both crons for a
   day.
6. **D6 – The FEC bulk file** (§4.11, validated: fast, same concentration,
   but rounded to dollars and missing some records):
   - **(a)** Adopt the hybrid: a bulk pass after each filing deadline, plus
     API fetches only for
     slices whose counts differ.
   - **(b)** The cents rule: records must match exactly by FEC ID, and money
     within the FEC's whole-dollar rounding (under $0.50 a record). The
     alternative is fetching every amount from the API.
   - **(c)** Does D1 keep every donation row, or per-member donor totals plus
     the top donors with their FEC record IDs?
7. **Stock trading** (§4.12): T1–T8. It isn't built until these are
   answered; designing for it now just keeps the rebuild from having to be
   redone.
8. **Approve the spec,** and the deferrals in §9: #1, #12, #18, #21. #31 is
   now designed for in §4.12, but its build waits on T1–T8.
