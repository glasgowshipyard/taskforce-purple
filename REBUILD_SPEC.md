# Rebuild spec: collection, storage and grading around the person

**Status: v3, APPROVED by the owner 2026-10-03. Stage 0 in progress; nothing
is built yet.**

Written by Claude, who wrote the code this replaces. This version replaces
v1 and v2 (git history has them). Everything about the API backfill, lanes,
shards and the every-minute collector is gone. Umbrella issue: #47.

**All scheduled jobs are paused** (2026-10-03, owner's decision) until this
is built. See `IMPLEMENTATION_STATUS.md`.

Anyone building this: read the whole document, then `CLAUDE.md`. Numbers
were measured, or checked against Cloudflare's or the FEC's docs, on the
dates given. **VERIFY** marks what still has to be measured before relying
on it.

---

## 1. Why a rebuild

The grading maths (`workers/tier-calculation.js`) is sound and tested. Also
kept: identity lookup (`fec-crosswalk.js`), committee discovery
(`person-funding.js`), the Schedule A classification rules
(`schedule-a-classify.js`) and the alert checks (`health.js`). What I built
around them is broken at the foundation:

1. **The unit is wrong.** In October 2025 I built donor collection around one
   committee per member, the campaign committee. Joint funds (money arrives
   as one transfer; the donors are only in the fund's records) and
   leadership PACs were invisible. Every live grade still uses the campaign
   committee alone.
2. **Every update rewrites everything.** All 539 members live in one 3.5 MB
   KV value. 14 functions rewrite it to change one member. Every run
   re-grades all 528 members (measured: 0 changed). Every page view re-parses
   the whole blob.
3. **Cloudflare kills the workers for it.** The limit is 10 ms CPU per
   invocation.
   - Pipeline runs used about 400 ms, so they were killed for hours most
     days, along with the site's own data requests (#46).
   - The donor collector used 34–51 ms per run, mostly reading the FEC's
     heavy responses (383 KB per 100 records).
4. **Collection by API is far too slow.** Copying every donation through the
   FEC API into D1 at 5 row-writes each, one member at a time, would take
   70–140 days for Congress. AOC alone is about 600k FEC records.
5. **Failures were silent or destructive.**
   - D1 write failures were skipped (#43).
   - Members with no donor data defaulted to a setting that allows S (AOC,
     Murphy and Kelly).
   - After 3 strikes a member was silently dropped.
   - Design changes restarted collections from zero.
6. **Work ran on clocks, not on change.** Totals were re-fetched every 20
   minutes and analyses re-collected every 30 days, although campaign money
   only changes when committees file reports.

## 2. Rules (settled; see also `CLAUDE.md`)

- **Ballroom principle.** Itemized money is individual support, penalised
  only when the donor base is concentrated.
- **The person is the unit.** Grade on everything the member _received_ across
  their campaign(s), leadership PAC and money transferred in from joint funds,
  counted once. Money a joint fund passed to others is disclosed, not graded.
- **Identity is looked up, never inferred** (crosswalk only).
- **No grade without complete evidence.**
  - A letter is published only when every committee in the member's pool is
    complete and reconciled (§6).
  - Until then: **"Grade pending"**, plus the FEC totals labelled "campaign
    committee only".
  - No default-anchor grades.
- **Every member ends up graded.** Nobody is ever dropped. Failures retry
  and alert. If the FEC's own figures contradict each other, publish with a
  note (§6).
- **Lean, diff updates.** Write only what changed, and only if its value
  differs. Never rewrite a whole dataset to change one item.
- **Work only when data can have changed.** Refresh on the FEC filing
  calendar or an explicit event. Never on a clock (§8).
- **History is never obliterated.** Results are kept as dated snapshots, and
  grade changes as history. Nothing restarts from zero silently.
- **Free tier only.**
- **Owner-facing alerts come with a solution.**

## 3. Architecture

```
                  FEC filing calendar / explicit event
                                 │
                                 ▼
 ┌──────────────── GitHub Actions: "refresh" job ────────────────┐
 │ Congress.gov roster ─┐                                        │
 │ FEC API: discovery, totals, filings, exact counts, gap fills  │
 │ FEC bulk file indiv26.zip ──► DuckDB: pooled donor analysis   │
 │ tier-calculation.js (same code) ──► evidence guard ──► grade  │
 │ diff against what Cloudflare holds ──► write only changes     │
 └───────────────────────────────┬───────────────────────────────┘
                                 │ Cloudflare API (KV + D1)
                                 ▼
  KV: member:{id}, members:list, analysis:{id}    D1: results, history, gaps
                                 │
                                 ▼
          API worker (read-only serving) ──► React frontend (Pages)
```

- **Why Actions.** Every FEC-heavy task leaves Cloudflare, where the 10 ms
  CPU limit kept killing it. GitHub Actions is free for public repos, with
  minutes of CPU, gigabytes of disk and memory, and up to 6 h per job.
  Workers only serve: one KV read per request, no parsing. So the CPU limit
  stops mattering.
- **The itemized worker is retired** at Stage 2's cut-over. The pipeline
  worker becomes the read-only API worker: `/api/members`,
  `/api/member-detail`, `/health`, plus the existing admin endpoints rebuilt
  on the diff writer.
- **Same grading code.** The job imports `workers/tier-calculation.js`
  directly (Node). There is one source of truth for the maths.

## 4. Platform limits and current usage

| Limit                                                   | Value                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Workers Free CPU per invocation                         | 10 ms (over it: error 1102 `exceededResources`)                                                           |
| KV per day, per account (operations fail when exceeded) | 1,000 writes, 100,000 reads, 1,000 deletes, 1,000 lists                                                   |
| KV value size / storage                                 | 25 MiB / 1 GB                                                                                             |
| D1 per day                                              | 100,000 rows written (self-capped at 85,000), 5,000,000 rows read                                         |
| D1 database size                                        | 500 MB per database (`taskforce-purple-donors` is at 414 MB)                                              |
| Cloudflare service calls per invocation                 | 1,000                                                                                                     |
| FEC API                                                 | 60 requests per minute per key                                                                            |
| GitHub Actions (public repo)                            | Free; up to 6 h per job; runners with ~14 GB free disk and 16 GB memory (**VERIFY** current runner specs) |

**Writes made through the Cloudflare API count against the same KV and D1
limits** as writes made from Workers. The job's diff writing (§7) is what
keeps it inside them.

**Usage before the pause** (14–27 Sept): 290–500 KV writes a day; 72 cron
invocations a day on the pipeline.

## 5. The refresh job (GitHub Actions)

`.github/workflows/refresh.yml` runs `scripts/refresh/` (Node + DuckDB).

**Trigger** (§8): the daily calendar check decides whether a refresh is due;
events trigger it directly; it can also be run by hand. Each run is
idempotent and resumable: per-member progress is recorded in D1, so a run
that's interrupted or hits the 6 h limit continues where it stopped.

**Steps:**

1. **Roster.** Fetch the Congress.gov member list. Diff it against `member:*`.
   New, departed and changed members are events.
2. **Identity and committees.** The crosswalk gives each member's FEC IDs.
   Discovery (`person-funding.js`, run in Node, so no request budget) finds
   the member's committees and joint funds and builds the donor pool. It
   re-runs only for a new member, a corrected identity, or a new committee
   seen in filings.
3. **FEC totals and filings,** per committee in every pool. The filings list
   tells the job which reports are new or amended since the last refresh.
   Committees with nothing new are skipped entirely.
4. **Bulk pass.**
   - Download `indiv{yy}.zip` (2.2 GB for 2026) if the FEC's copy is newer
     than the last one used.
   - **Disk:** GitHub's standard runner has 14 GB of SSD (checked
     2026-10-03; 4 cores, 16 GB RAM, free for public repos). The zip
     unpacks to 12 GB because it holds the data twice (`itcont.txt` plus
     `by_date/` copies). Extract **only `itcont.txt`** (5.6 GB), for about
     7.8 GB in total.
   - DuckDB keeps only the rows for committees in any member's pool. A full
     scan of all 32.3M rows took 2.4 s on the owner's Mac.
5. **Gap check and fill** (the hybrid, D6a). Established in Stage 0
   (2026-10-03, on Williams C00752584, where every record was checked by
   `SUB_ID`). The bulk file is exactly a subset of the FEC's own
   **`is_individual=true`** set, and three things together make a committee
   complete:
   1. **Missing individual records.** Compare the bulk file's record count
      with the API's exact count for `is_individual=true`. Any difference is
      records the bulk file is missing. Williams: the API had 356, the bulk
      file 326; all 326 were in the API set, so 30 were missing and none
      were extra. Where the counts differ, or the FEC's count is only an
      estimate, narrow it down by month, then week, then day, and fetch
      **only those slices**. The API's records, with cents, replace the bulk
      file's for those slices.
   2. **Earmarked gifts the FEC doesn't flag as individual.** A person's
      donation passed through a PAC conduit (Williams: a $7,000 gift
      "earmarked for End Citizens United") is on the individual line but
      flagged `is_individual: false`. The bulk file leaves it out, yet the
      FEC's itemized total counts it. **One call per committee** finds them
      all: `line_number=F3-11AI&is_individual=false&contributor_type=individual`.
      Williams returned exactly 1; Pelosi's and Sanders's campaigns returned 0. Fetch them, then classify them with `schedule-a-classify.js` (memo
      lines excluded).
   3. **The money check** (§6). Proven exact on Williams: 352 non-memo
      individual records ($147,007.00) plus the 1 earmarked gift ($7,000)
      equals the FEC's itemized total of $154,007.00, to the cent.
   - Within an API slice, paginate with `last_index` plus `max_date`. Deep
     cursors without `max_date` time out.
   - **VERIFY at Stage 2's exit:** Pelosi's campaign (API 23,295
     individual records against the bulk file's 23,159) reconciles the same
     way once its 136 missing records are filled.
6. **Analysis**, in DuckDB, over each member's pooled donors (donor key
   `FIRST|LAST|STATE|ZIP5`, as today):
   - unique donors, top-10 share, Nakamoto coefficient and median;
   - conduit and earmark totals;
   - FARA employer matches against the 225 `fara_employer_matches` strings.
7. **Reconcile and grade** (§6).
8. **Write only changes** (§7).
9. **Report.** A run summary goes in the job log and the D1 `runs` table:
   members changed, pending (with reasons), failed (with reasons). Any
   failure or new mismatch opens or updates a `system-alert` issue, with the
   proposed fix where one is known.

**Credentials.** The job needs two GitHub repository secrets. They are
created once by the owner; Claude never handles the values.

- `FEC_API_KEY`: set by extending `scripts/rotate-secrets.sh`, which also
  runs `gh secret set` with the same pasted key.
- `CLOUDFLARE_API_TOKEN`: a scoped token with KV write on the
  `MEMBER_DATA` namespace and D1 edit on the project databases, nothing
  else. The owner creates it in the Cloudflare dashboard, and a small script
  stores it with `gh secret set`.

**Expected run time** (**VERIFY** on the first run):

- **First full run:** a few hours, dominated by FEC API calls at 60 a
  minute (discovery, totals and counts for about 3,000 committees, plus gap
  slices).
- **Later runs:** only committees with new filings, so minutes.

The whole of Congress is graded after the first run, not after 70–140 days.

## 6. Reconciliation and the evidence guard

For each committee in a member's pool:

1. **Records are complete.** After gap filling, every slice's record count
   equals the FEC's exact count. Records are matched by FEC `SUB_ID`.
2. **Money matches within the FEC's own rounding** (D6b). The bulk file
   carries whole dollars, so for each committee: |sum of our itemized
   individual money − the FEC's reported itemized total| < $0.50 × the
   number of records. This is not a tolerance for missing money: every
   record must be present (check 1).
3. **If the records are complete but the FEC's reported total still differs
   by more than that** (the FEC's figures contradict each other), the grade
   is published anyway, with a plain-English note that the FEC's figures
   differ by $X (D3).

**The guard.** It runs on every grading. A letter is published only if every
committee in the member's pool passes checks 1 and 2, or 1 and 3 with the
note, and the evidence is for the cycle being graded (§9). Otherwise:
`PENDING`, with a reason and progress.

- The default trust anchor can never produce a published grade.
- Ringfences (DISPUTED / UNVERIFIED) stay, with #40's rule: no percentage
  whose denominator is in dispute.

## 7. Storage

| Where | Key / table                    | What                                                                                                                        | Written when                                         |
| ----- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| KV    | `member:{bioguideId}`          | Full member record                                                                                                          | Only when a field differs                            |
| KV    | `members:list`                 | What the list page needs (measured 155 KB for 539 members)                                                                  | Only when a list-visible field changes; once per run |
| KV    | `analysis:{bioguideId}`        | Current published analysis, evidence status, reconciliation notes                                                           | Only when it differs                                 |
| D1    | `results`                      | Per member and cycle: donor statistics, top donors with FEC `SUB_ID`s, the FEC file date used, reconciliation per committee | Only when it differs                                 |
| D1    | `gap_records`                  | Records fetched from the API to fill bulk-file gaps (full detail, cents)                                                    | When fetched                                         |
| D1    | `snapshots`                    | Every published analysis, dated, never overwritten                                                                          | When a published analysis changes                    |
| D1    | `grade_history`                | One row per published grade change, pointing to its snapshot                                                                | When a grade changes                                 |
| D1    | `runs`, `member_progress`      | Run summaries; per-member progress and failures (for resuming and retries)                                                  | During a run                                         |
| D1    | `d1_write_budget`, FARA tables | As today                                                                                                                    | As today                                             |

- **D1 does not copy every donation** (D6c). The FEC's bulk file is the full
  record; every result names the dated file it came from and is reproducible
  from it. Only gap-fill records are stored in full.
- **D1 location.** These tables go in a new small database, `tfp-results`.
  The legacy `taskforce-purple-donors` (414 MB) becomes read-only history and
  is retired with the owner's OK once v3 is live. It is never bulk-deleted:
  deletes cost about 4 row-writes each.
- **The diff writer.** One function, `saveMember(before, after)`, used by both
  the job and the admin endpoints. It writes `member:{id}` only if a field
  differs, and patches `members:list` only if a list-visible field differs,
  at most once per run. No code writes a whole-dataset value again.
- **Budget.**
  - **KV writes:** the first full run can change most members, about 540
    writes. Later runs change a handful. The job reads the day's KV write
    count before writing, and stops and resumes the next day rather than
    exceed it.
  - **D1:** writes are small and charged to the existing meter (CLAUDE.md
    rule).
- **Locking.** Admin endpoints and the job take a D1 lock row while writing
  `members:list`, so two writers can't clash.

## 8. When anything runs

Campaign money only changes when committees file. So:

- **One daily calendar check** (a GitHub Actions schedule, one cheap
  request). It is the only clock-driven job.
  - **Filing deadlines.** It reads the FEC's reporting dates from the FEC
    API, never hard-coded. Candidate committees file quarterly (15 Apr,
    15 Jul, 15 Oct, 31 Jan), plus pre- and post-general reports in election
    years and pre-primary reports by state. Some PACs, party committees and
    joint funds file monthly (the 20th).
  - **Starting a refresh.** If a deadline has passed since the last refresh,
    plus a few days for the FEC to process the reports, it starts the job.
    Otherwise it ends.
  - **Retries.** If members have outstanding failures, it retries them, with
    growing gaps between attempts (1, 3, then 7 days).
  - **The roster** is part of the job. Membership changes (deaths,
    resignations, special elections) are rare but must be prompt, so the
    daily check fetches the Congress.gov roster (one request) and starts a
    small job only if it changed.
- **Events** start the job directly:
  - a roster change;
  - a corrected identity;
  - a deployed scoring change (full re-grade from stored results, with no FEC
    calls);
  - a manual run.
- **Nothing else is scheduled.**
  - No weekly, monthly, hourly or rolling re-checks.
  - No Worker crons.
  - A finished cycle is never refreshed again.
- **Monitoring.**
  - **Failed runs:** GitHub emails the owner when a workflow run fails, and
    the job opens a `system-alert` issue for any member failure or mismatch
    (§5 step 9).
  - **The site:** `/health` stays as a page anyone can check. The hourly
    health workflow isn't revived; the daily check reads `/health` too and
    raises an issue if the site's data API isn't answering.

## 9. Election cycles

- **Rollover** (D1, yes).
  - A member's published grade is their **most recent complete cycle**,
    labelled with it ("2025–26 cycle").
  - From 1 January 2027 the 2028 cycle is refreshed on its own calendar.
  - A member switches to the new cycle once its evidence is complete and its
    first quarterly report is in (Q1 2027, due 15 April).
  - Until then the card shows the new cycle's money so far as "current
    trajectory".
- **Senators** (D2): graded on two-year periods like everyone else, with
  their earlier periods shown as history.
- **Deadline: the rollover rule must be live before 1 January 2027.** It's the
  one date in this plan that can't move.

## 10. Stages (each proven live before the next starts)

**Stage 0: approve and prepare.**

- The owner approves this spec.
- **Update `CLAUDE.md`** where it contradicts this spec:
  - "KV is the source of truth for tiers. D1 is an analytical mirror" →
    KV holds member records and published analyses; D1 holds results,
    history and gap records; the FEC bulk file is the full donation record.
  - The queue / retry-budget rule → no queues; per-member failures retry on
    the calendar check.
  - The architecture diagram and crons → §3 and §8.
- **The owner creates the two GitHub secrets** (§5) by running
  `bash scripts/set-github-secrets.sh`. It checks both values before
  storing them; future key rotations update GitHub too.
- **Measurements:**
  1. ~~The comparable-count filter~~: done 2026-10-03 (`is_individual=true`,
     plus the earmarked-gift call; §5 step 5).
  2. ~~The reporting-dates endpoint~~: done 2026-10-03. Use
     `/v1/reporting-dates/?min_due_date=…&max_due_date=…`; `due_date_gte` is
     ignored. It returns every deadline: quarterlies, monthlies, and
     pre-general reports entered state by state (Q3 due 15 Oct 2026, M10 on
     20 Oct, 12G on 22 Oct).
  3. ~~Current GitHub runner specs~~: done 2026-10-03 (see §5 step 4).
  4. FEC rate limit confirmed from the response headers:
     `x-ratelimit-limit: 60`, over a short (per-minute) window.
- **Freeze:** no patches to the old collection paths. Everything is
  already paused.

**Stage 1: lean storage and serving** (fixes #46 and #38).

- Build:
  - `member:{id}`, `members:list` and `saveMember`;
  - `/api/members` served as stored, with no parse;
  - the detail popup fed from `/api/member-detail`;
  - the admin endpoints rebuilt on `saveMember` (#5);
  - the list's date taken from when it was last written (#38).
- **Migration:** about 540 KV writes, run just after 00:00 UTC (5 pm
  Pacific), in two halves over two nights. Reads fall back to `members:all`
  until a member's key exists.
- Exit criteria:
  - offline, identical grades and list fields for all 539 members from the
    same snapshot;
  - zero `exceededResources` on the API worker over 48 h of normal traffic;
  - KV writes below the pre-pause baseline.

**Stage 2: the refresh job** (§5–7; fixes #44, #43, #32 collection and #34).

- Build:
  - the workflow and `scripts/refresh/`;
  - the `tfp-results` database;
  - the bulk pass;
  - gap check and fill;
  - DuckDB analysis;
  - reconciliation;
  - the diff writing;
  - the run report and alerts;
  - the itemized worker retired.
- **Grades are computed but not yet published** under the new basis (Stage
  3).
- Exit criteria, each fully reconciled with the right gaps filled:
  - Williams (her 31 missing records filled from the API);
  - Sanders;
  - Pelosi (campaign, PAC to the Future and her Victory Fund share);
  - AOC;
  - plus one full run over all of Congress with a clean report.

**Stage 3: the guard and publication** (§6, §9; fixes #39, #40 and #42's
remainder).

- Build:
  - `PENDING` and the frontend "Grade pending";
  - the evidence guard and the D3 note;
  - cycle labels and the rollover rule;
  - reference cases as CI tests on a frozen real-data snapshot:
    - Sanders is graded as a movement donor base;
    - Pelosi is never graded on campaign-only evidence;
    - a member without evidence is never given a letter.
- Then person-level grades are switched on.
- Exit criteria:
  - CI reference cases pass;
  - no published letter without complete evidence (checked by query).
- **Before 1 January 2027, whatever else is late.**

**Stage 4: history and clean-up.**

- Grade history and the trajectory shown on member cards.
- Retire `members:all` and, with the owner's OK, the legacy D1 database.
- Delete `workers/recalculate-metrics.js` if it's unused.
- Rewrite `DATABASE_REFERENCE.md`.
- The full sweep of any remaining code for:
  - whole-dataset writes;
  - clock-driven work;
  - silent `catch` blocks;
  - CPU against 10 ms.

## 11. Verification standards (every stage)

- **Offline harness** (`scripts/`): runs the real code against snapshots of
  real data and recorded FEC responses. It proves grades are unchanged where
  no change is intended, and measures operations.
- **The refresh job is checked against the FEC itself:** reconciliation per
  committee (§6) is part of every run, not a one-off test.
- **After each deploy:** Cloudflare analytics (CPU p50 and p99,
  `exceededResources`, KV and D1 operations) against the pre-pause baseline.
- **CI:** report every job of the Actions run for each pushed commit.
- **Docs:** `IMPLEMENTATION_STATUS.md` (dated entry), `DATABASE_REFERENCE.md`,
  `API_STRUCTURES.md`, `RUNBOOK.md` (every command must keep working),
  `GRASSROOTS_CALCULATION_GUIDE.md` and `CLAUDE.md`.

## 12. Decisions (owner, 2026-10-03)

- **D1, rollover:** yes; keep the last complete cycle's grade until the new
  cycle is ready (§9).
- **D2, senators:** two-year periods, for simplicity (§9).
- **D3, the FEC's own figures disagree:** publish, with a note of the
  difference (§6).
- **D6a, collection:** the hybrid, meaning the bulk file plus API fills for
  mismatched slices (§5).
- **D6b, cents:** whole dollars accepted; every record must be present (§6).
- **D6c, D1 contents:** results, not a copy of every donation (§7).
- **Dropped as moot:** D4 (lane split) and D5 (D1 write test).
- **Rule:** refresh on the filing calendar or events, never a clock (§8).
- **Approved 2026-10-03:** §3's move of all FEC work into GitHub Actions,
  and the two GitHub secrets it needs (§5).

## 13. Stock trading (paused by the owner)

Owner's principle (T1): "anyone making trades that produce financial benefit
while in office are dirty". The discussion is paused. What has been checked
(2026-10-03):

- **The House** publishes a structured XML index of all filings: 407
  stock-trade reports (PTRs) in 2026 so far. The trades are in per-report
  PDFs. 88% are filed electronically with extractable text (asset, ticker,
  buy or sell, dates, amount range, a "capital gains over $200?" column); 12%
  are scanned paper.
- **The Senate's** search sits behind a legal agreement, which has not been
  accepted.
- **The law** (5 U.S.C. app. § 105(c)) forbids using the reports for
  commercial purposes (except news media), for credit ratings, or to ask
  for money.
- **Amounts are ranges.** Filing is due within 45 days of a trade.
- **It would fit this architecture** as another step in the refresh job,
  triggered by new document IDs in the House index, which the daily check
  can fetch cheaply.

**Open, and paused:**

- spouses and dependants;
- which assets count (individual stocks versus funds and bonds);
- what "dirty" does to the grade;
- scanned filings;
- the Senate agreement;
- third-party feeds;
- annual holdings;
- the committee-to-industry mapping.

## 14. Every open issue, and where it goes

| Issue                          | Where it lands                                                         |
| ------------------------------ | ---------------------------------------------------------------------- |
| #47 umbrella                   | This spec                                                              |
| #46 CPU kills                  | Stage 1 (serving) and Stage 2 (FEC work leaves Cloudflare)             |
| #45 first alert                | Close; the alerting is replaced (§8)                                   |
| #44 big campaigns never finish | Stage 2 (bulk file; AOC in the exit criteria)                          |
| #43 D1 holes                   | Stage 2 (records checked by count and `SUB_ID`; no copy to lose)       |
| #42 145 at 0%                  | Step 4 fix deployed (145 → 4); Stage 3 makes the fallback path pending |
| #41 wrong FEC candidate        | Fixed by the crosswalk; close after Stage 3                            |
| #40 disputed denominators      | Stage 3                                                                |
| #39 prior-cycle grades         | Stage 3 (§9)                                                           |
| #38 frozen lastUpdated         | Stage 1                                                                |
| #34 FARA                       | Stage 2 (DuckDB match across all committees)                           |
| #33 network / conduits         | Stage 2 analysis; connected-organisation lookups deferred              |
| #32 person-level funding       | Stages 2–3                                                             |
| #31 STOCK Act composite        | §13, paused                                                            |
| #21 PAC colour coding          | Deferred                                                               |
| #20 donor concentration        | Superseded by Stage 2; close at its exit                               |
| #19 tier calc broken           | Superseded; close                                                      |
| #18 bio data                   | Deferred                                                               |
| #16 hardcoded fallbacks        | Keys done 2026-09-27; the rest in Stage 4's sweep                      |
| #14 delete plus FEC cache      | `fec_mapping_*` retired with the old pipeline paths in Stage 2; close  |
| #12 cron control API           | Close: no Worker crons remain                                          |
| #5 force-update endpoint       | Stage 1 (admin endpoints on `saveMember`)                              |
| #1 voting data                 | Deferred                                                               |
