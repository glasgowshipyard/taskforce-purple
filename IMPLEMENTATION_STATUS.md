# Task Force Purple - Implementation Status

**Last Updated**: 2026-10-04

---

## 2026-10-07: the 2026 races, built (ROADMAP Phase E)

Owner's go, with the four recommendations: November's ballot, provisional
grades, a Races tab, and third-party candidates who file.

- **Who's on the ballot:** campaigns that filed the FEC's pre-general report
  (12G, due 22 October), mapped to candidates through the committee links.
  Nothing outside FEC data is used. Before the 22nd there's no way to tell
  primary losers apart (the summary file's election-result fields are
  empty), so `--field test` (candidates over $500,000) is a dry run only.
  It showed why: senators not up this year, and a former senator the FEC
  still flags as an incumbent.
- **Grading** (`scripts/refresh/races.mjs`): a challenger is graded exactly
  like a member (zip discovery, all committees, bulk-file analysis,
  `gradeMember`, provisional). The identity is the FEC's candidate ID.
  Sitting members keep their published grade. Maine test: 7 candidates in
  a minute, 14 FEC calls.
- **Storage:** D1 `race_candidates` (migration 2026-10-07, applied; written
  only on change) and KV `races:list` (one write, only on change).
- **API:** `/api/races` (404 until published, which hides the tab) and
  `/api/candidate-detail?id=` (same shape as a member's detail).
- **Site:** a Races tab (state picker; each seat's candidates side by side
  with grade, money mix and the "being double-checked" note; "Where the
  money comes from" opens the same money trail as a member page). "In
  office now" means a current member as Congress lists them, not the FEC's
  incumbent flag. Checked at phone width; nothing scrolls sideways.
- **Schedule:** `.github/workflows/races.yml` runs 23 and 27 October at
  8 am PDT, then disables itself.
- **To come:** the record-by-record check for challengers, after the
  members' pass.
- **DuckDB is pinned in `package.json`** (devDependencies, 1.5.6-r.1), so
  `npm ci` installs the same version everywhere. Until now the workflows
  installed it separately (`npm install --no-save`), so it wasn't in the
  lockfile, and the 2026-10-06 `npm audit fix` removed my local copy.
  DuckDB isn't a stored database: each job builds one in memory from the
  FEC's zip on GitHub's machines and throws it away. Nothing depends on
  the owner's Mac.

---

## 2026-10-07: issue sweep, and two fixes it turned up (#41, #40)

**Fixes (744bd04):**

- **Julie Johnson** (J000310) was graded on all her committees but shown
  UNVERIFIED: her record carried a stale "identity not verified" flag from
  2026-09-26, and I had the refresh job pass it through. The job only grades
  members it looked up in the crosswalk, so it now grades them as verified.
  She is graded E, checked.
- **Alan Armstrong** (A000383) has no FEC ID in the crosswalk's source yet,
  but still showed an old F. A member not graded by the job now keeps their
  stored grade only on a confirmed identity; otherwise UNVERIFIED (list and
  member page).
- **#40:** a ringfenced member's bundling line no longer shows a percentage
  of the disputed individual total; the dollar amount stays.

**Issues closed with evidence:** #52, #46 (2026-10-06), #44, #43, #41, #40,
#38, #34, #32, #20, #19, #14, #12.

**Left open:**

- #47, the rebuild umbrella.
- #42, now down to 1 member at 0%, on the fallback path (Stage 3 item).
- #39, cycle labels (Stage 3).
- #33, connected-organisation lookups deferred.
- #31, stocks (paused).
- Deferred: #21, #18, #16 (Stage 4 sweep) and #1.

---

## 2026-10-05: Stage 1 exit check passed

`node scripts/verify/stage1-exit-check.mjs`, 50.9 h from the migration (Oct 3
18:05 to Oct 5 20:57 PDT): **0** CPU-limit kills on the API worker (p99 CPU
up to 11.5 ms), and KV writes after the migration day at most **103 a day**
against the pre-pause 290-500. Stage 1 is complete.

---

## 2026-10-05 evening: the results database hit D1's 500 MB size limit (mine)

**What happened.** The check run restarted at 17:31 PDT wrote 274,854 D1
rows (the account's limit is 100,000 a day) and failed at 20:12 with
"Exceeded maximum DB size". D1 refused writes on the whole account until
midnight UTC (5 pm PDT on 2026-10-06), the owner's other projects
included; reads and the site were unaffected.

**Cause (mine).** I stored every record fetched from the FEC as one
uncompressed row in `gap_records`, the full API record (about 3.7 KB).
TEAM JORDAN (C00857615), a joint fund, has 125,374 records at the FEC but
4,453 in the bulk file. Almost all the missing ones are small gifts from
donors under $200 for the year, itemized voluntarily, which the bulk file
largely leaves out. The job fetched 78,585 of them (286 MB) inside one batch,
and the write cap was only checked between batches. `gap_records` reached
117,450 rows and 438 MB.

**Fix (owner's choice: full records, compressed):**

- `gap_packs` replaces `gap_records`: each committee's records, exactly as
  the FEC returned them, Brotli-packed up to 5,000 a row
  (`scripts/refresh/lib/gap-store.mjs`). Dry run over all 117,450 records:
  438.4 MB became 7.6 MB, every record unpacked identical. A committee now
  writes a few rows however many records it has.
- A later pass now reuses stored records. Before this, they were reused only
  within the same pass, so the next pass would have searched everything
  again. The search counts stored records as known and fetches only ranges
  that still differ. Test: Daines's campaign, 302 stored records, checked in
  4 FEC calls with no search and the same verdict.
- Health alerts at 400 MB (`d1-size-high`).
- `node scripts/refresh/gap-records.mjs C00857615` unpacks a committee's
  records to a file for DuckDB (RUNBOOK §6).
- **Applied 2026-10-06 at 17:51 PDT** on GitHub's machines (one-off
  workflow `d1-repack.yml`, started by hand when the 00:05 UTC schedule
  hadn't fired by 17:50; it disabled itself afterwards). The database was
  full, so the order was: test the drop, pack in memory, drop, then write
  (`scripts/migrations/2026-10-06-repack.mjs`). Owner's OK: "you have to
  self approve".
  - Drop test on a throwaway database: 0 rows written, 4.2 MB freed.
  - 117,450 records from 166 committees packed in memory, 438.4 MB to
    7.6 MB, every one unpacking identical.
  - `gap_records` dropped (2 rows written): the database went from 500 MB to
    6.3 MB.
  - 264 pack rows written, all 166 committees checked byte for byte; 13.5 MB
    of 500.
  - The repack used 6,539 rows written and 238,016 read.
  - The record check restarted (run 37554375546); report in issue #52.

---

## 2026-10-05: Stage 3 publish built; I exceeded D1's daily read limit for the whole account

**Incident (mine).** The refresh job reloads a checked committee's fetched
records with `SELECT record FROM gap_records WHERE committee_id = ?`. I never
indexed `committee_id`, so every lookup scanned the whole table. Between 5 pm
PDT on 2026-10-04 and 7 am on 2026-10-05, `tfp-results` read **18.8 million
rows** (3,142 queries) against the account's **5 million a day**, and D1
refused reads on every database in the account until midnight UTC (5 pm
PDT), including the owner's other projects. Nothing alerted: the job metered
writes, not reads, and the health check had no read check.

- Stopped: the running check (run 37300955430) was cancelled.
- Fix, applied after the reset: `migrations/2026-10-05-gap-index-and-reads.sql`
  (index on `gap_records (committee_id, cycle)`; the ledger gains `rows_read`).
  The job now meters rows read from D1's own figures, won't start above 2.5M
  and stops at 3M. Health alerts at 4M (`d1-reads-high`), and its "database
  unreadable" alert now explains the daily-limit case.
- `scripts/verify/d1-usage.mjs`: usage by database from Cloudflare's
  analytics (RUNBOOK §6).

**Stage 3 publish** (owner's yes 2026-10-05):

- **Publishing** (`scripts/refresh/lib/publish.mjs`): each graded result is
  laid over the member's record, and `members:list` is rewritten once, only
  if it changed. Every grade change goes to `grade_history`. It runs after
  every batch of every refresh run (`publish.mjs` by hand). One KV write per
  publish instead of about 1,080 per-member writes.
- `/api/member-detail` reads the member's result from D1 (figures, money
  trail, top donors, evidence state, FEC-difference notes), falling back to
  the stored record for members not graded.
- **Retired (410):** `/api/recalculate-tiers`, `/api/process-candidate` and
  `/api/update-member/@`. They re-graded through the old engine, which would
  overwrite published grades. The old engine is removed from the API worker
  (2,100 to 942 lines); the worker no longer calls the FEC or Congress.gov.
- **Member page:** a plain "still being double-checked" note while a grade
  is provisional, "Checked" once confirmed, and FEC-difference notes (D3).
- **Published 2026-10-05 17:30 PDT**, after D1's reset:
  - the index migration applied first (78k rows read, 38.9k written, charged
    by hand to the ledger so the job's cap accounts for it);
  - then 536 members graded on the site, 193 grades changed (each in
    `grade_history`).
  - Live checks: Hawley A and AOC S, both checked; Sanders S and Pelosi B,
    still being double-checked, with the note showing on Pelosi's page;
    health clear.
  - The record check restarted (run 37394452463). The scheduled task meant
    to do this at 17:10 stalled at its first permission prompt and was
    stopped.
- **Blair (B001328):** his only FEC committee is registered as an ordinary
  PAC, so his pool is empty. He is recorded as pending, not failed, and
  keeps his current grade.

---

## 2026-10-04: Grade first, confirm after; discovery from the bulk files; fund owners

Owner's decisions (recorded in CLAUDE.md settled decisions, REBUILD_SPEC
§12 D7 and D8, and GRASSROOTS_CALCULATION_GUIDE "Whose money, and whose
donors"):

- **D7, grade first, confirm after.** Every member is graded from the FEC's
  bulk files now; the record-by-record check runs behind it and confirms or
  shifts each grade. Replaces "Grade pending" (decided before the bulk file
  was found).
- **D8, joint-fund owners kept, ties fixed.** A fund belongs to the member
  its payments mostly went to, adding up each member's committees as one
  person; an even split (top two within 1%) is shared, nobody's own. I had
  written the rule to pick the single biggest committee, so an even split
  went to whichever came first in the data: the API and the zip disagreed
  for 5 of the first 25 senators.

**Built:**

- `scripts/refresh/lib/discovery.mjs`: every member's committees, funds,
  transfers and totals from the FEC's ccl, cm and oth zips plus batched API
  calls. About 125 FEC calls for Congress instead of about 13,000. For the
  25 members already checked, totals matched the API version exactly; the
  only pool differences were the ties above.
- `run.mjs --grade-only` (workflow input `grade_only`, its own lane):
  grades from the bulk files, no record check. Pelosi B, AOC S, Williams F
  in one minute and 14 FEC calls, identical to their checked grades.
- `gradeMember`: `evidenceChecked` (true checked, false provisional).
- `fundOwner` replaces `largestCandidateRecipient` (tests added).
- The check paces at 900 FEC calls an hour, leaving room for grading.

**Tie rule simulated across all 537 members** (provisional grades, before
and after): 45 members' donor pools change and **4 grades move**:

- Alsobrooks C to D;
- Golden D to C;
- Fitzpatrick E to D;
- Meng E to D.

The rest keep their grade. AOC stays S: the Squad Victory Fund paid four
members (AOC, Pressley, Omar, Tlaib) $91,000 into both their campaign and
leadership PAC, so it is a four-way tie, shared (31,197 donors counted
instead of 31,805). I first told the owner the fund would be hers; that was
wrong.

**The "$2,000+" figure** (money trail, display only) still comes from the
FEC's size bands: no count of the zip's cheques reproduces them (the FEC's
figure is often twice the member's actual $2,000-and-over cheques).

**Hand-over worked:** run 37245496660 finished at 22:31 PDT and started run
37268190655 itself.

---

## 2026-10-04: Pelosi and AOC reconcile; first full pass running

**Dry run (Actions 37210788336), every committee reconciled:**

- **AOC:** campaign, Courage to Change and the Squad Victory Fund. 438
  records missing from the bulk file were filled from the API. The money
  is within $1,706 across 286,000 records (whole-dollar rounding). Grade
  **S** on all committees: 31,850 donors, Nakamoto 4,611.
- **Pelosi:** campaign, PAC to the Future and both victory funds; 64 records
  filled. Grade **B** on all committees (the site shows A, campaign only):
  5,011 donors, Nakamoto 25 (the site's campaign-only figure is 408).
- 2,674 FEC calls, 2 h 51 min. Nothing written (dry run).

**First full pass** (round `round-2026-10-04T18:01:53.440Z`, run
37222770431, started 11:01 PDT by the owner). The first batch of 25
senators finished at 14:07 PDT: all done, none failed, 103 committees.

**My run-time estimate was wrong.** I estimated 7–10 hours from Williams
alone. Measured: about 3 hours per batch of 25 senators, so the first pass
is roughly 2–3 days at 1,000 FEC calls an hour. Two reasons:

- finding each member's committees costs about 1½ minutes;
- big campaigns' gap searches cost 300–2,000 calls each.

Most "missing" records are **memo lines**: a campaign's report restates
each joint-fund donor as a memo (type 15J, or untyped memo X). The bulk file
leaves them out, and the API can't filter them out of its counts, so the
search chases them; once fetched, they're kept out of money totals.
Examples:

- Hagerty: 918 of his 930 "missing" records were 15J memos.
- Across the first batch: about 85% memo lines, plus 114 real donations
  missing from the bulk file.

This is a first-pass cost only: later rounds reload the stored records and
search only new filings. The owner has asked the FEC for the upgraded key
(7,200 calls an hour).

**Changes:**

- The job checks the D1 budget before every batch, not only at start
  (`a0a39ec`).
- **A pass continues itself** (`fd53799`). A run that stops on its time
  budget with members left, having finished at least one, starts the next
  run of the same round (`workflow_dispatch` with the workflow's own token,
  `actions: write`). A D1-budget stop doesn't chain.
- **No new member or committee after the time budget**; a committee
  mid-search stops at a hard deadline 15 minutes later and is left for the
  next run, not failed. Before, I had the job check time only between
  batches, and a batch of senators takes about 3 hours, so a late batch
  could be killed at the job's 350-minute limit.
- The run going now started before these changes: it won't chain, and its
  second batch may be cut off at the limit (committees already checked are
  reused). The next run is started by hand once; after that the pass
  continues itself.

---

## 2026-10-04: Health moves to the API worker; the itemized worker is retired

- **`/api/health`** on the API worker (`6c413a7a`) replaces the itemized
  worker's `/health`. `workers/health.js` is rewritten for the new system:
  - the site's member list (missing, or under 530 members);
  - the refresh job's latest run (failed, or "running" 7+ hours, i.e.
    killed);
  - failing members, with reasons;
  - committees that couldn't be reconciled;
  - the D1 write ledger at 95k+;
  - the results database unreadable.
    Every problem carries a proposed fix. The API worker's `wrangler.toml`
    (gitignored) gains a read binding `RESULTS_DB` to `tfp-results`.
- **Alerts:** the Refresh workflow ends by running `scripts/health-alert.sh`
  (always, pass or fail), which opens, updates or closes the one
  `system-alert` issue, adding the job's own failure with its log link. This
  replaces the workflow's separate "Refresh job failed" issue. The hourly
  Health alert workflow stays off (REBUILD_SPEC §8).
- **A crashed refresh run now records itself as failed** and charges the D1
  rows it already wrote. Before, I had it leave the run "running" forever
  and the ledger short.
- **The itemized worker is retired** (`6c416433`): a stub that answers 410
  on every URL (`workers/itemized-retired.js`). I deleted its code and tests
  (1,496 lines; last version `04d44c4` in history) and the D1 meter only it
  used (`d1-write-budget.js`). Its two worker secrets are deleted, and
  `rotate-secrets.sh` no longer sets them.
- **`/api/debug-kv` retired (410).** It was public, reported a queue that no
  longer exists, and each call spent one of the free tier's 1,000 daily KV
  list operations.
- The KV keys it wrote (`itemized_analysis_v2:*`, queues) stay as they are,
  frozen; the site still reads the analyses until Stage 3 publishes from
  `tfp-results`.

---

## 2026-10-03: Stage 2 in progress: the refresh job (REBUILD_SPEC §5)

Built (`be1d27b`); nothing is published yet, by design:

- **`scripts/refresh/`** (Node + DuckDB) has these parts:
  - an FEC client paced under the key's real limit;
  - a Cloudflare REST client (KV and D1; every D1 write is charged to the
    `tfp-results` ledger from D1's own `rows_written`);
  - the bulk loader (extracts only `itcont.txt`, which fits a runner's
    14 GB disk);
  - per-committee reconciliation;
  - pooled donor analysis in DuckDB;
  - the `run.mjs` orchestrator (`--members`, `--dry-run`).
- **D1 `tfp-results`** (`f4ad9245`): runs, member progress, committees,
  gap records, results, snapshots, grade history, the write ledger, and the
  225 FARA employer matches (copied).
- **`workers/grading.js`**: the grade step, now shared by the API worker and
  the job. The equivalence check gives identical grades for all 539 members.
- **`.github/workflows/refresh.yml`**: manual dispatch only (everything
  scheduled is paused); it opens a `system-alert` issue on failure.

**Reconciliation, as built.** The bulk file is a subset of the FEC's
`is_individual=true` records, so:

1. Compare counts.
2. On a mismatch, binary-search the dates (one count call per half) and
   fetch only small ranges that still differ.
3. Make one more call per committee for gifts earmarked through PAC
   conduits, which the FEC doesn't flag as individual.
4. Do the money check within whole-dollar rounding.

**Proven on Williams (W000788).** Her campaign had 30 records missing from
the bulk file and a $7,000 earmarked gift, all filled from the API; the
money is within $2 of the FEC's total. Her leadership PAC matches exactly.
That took 26 FEC calls locally, and also in GitHub Actions (run 37169374224):
secrets OK, 2.2 GB downloaded in 29 s and extracted in 43 s, identical
result.

**Found: the FEC limit is 1,000 calls an hour per personal key**, not 60 a
minute (the FEC's own 429 message). The job paces at 3.7 s a call and waits
out 429s. The first full pass will take roughly 7–10 hours over two or three
runs, or 1–2 hours with a free upgraded key from apiinfo@fec.gov (the owner
has the email to send).

**Next:** the Sanders, Pelosi and AOC reconciliation (dry run 37170371462),
then the itemized worker's retirement, the filing-calendar check, and a full
run.

---

## 2026-10-03: Stage 1 deployed: one record per member, slim list, diff-only writes (#46)

REBUILD_SPEC.md Stage 1. API worker `9973eabf`; frontend `4544c53` (Pages).

- **Storage.** `member:{bioguideId}` holds each member's full record;
  `members:list` holds the exact `/api/members` body (308 KB, against 3.5 MB
  for `members:all`). `workers/member-store.js` is the only writer: it writes
  a member only when a field differs, and the list at most once per
  invocation, only when a list-visible field changed.
- **Serving.** `/api/members` returns the stored list without parsing it.
  Offline, on production data: 0.8 ms CPU against 37.3 ms before. The
  profile fetches the member's full record from `/api/member-detail` when it
  opens.
- **Re-grading** works per member, 10 per call (the slowest, cold call
  measured 9.6–10.1 ms CPU offline), and writes only what changed. Use
  `scripts/recalculate-all.sh`.
- **Fixed on the way:**
  - #5: `process-candidate` passed the member object as the committee ID
    and threw the PAC results away.
  - `process-candidate` accepted anyone; it now needs the admin secret.
  - #14: `remove-member` now also clears the member's `fec_mapping_*`.
  - #38: the list's date is when its data last changed (18:21 UTC today),
    not 16 Jan.
  - The profile no longer promises a scan "within about three weeks".
- **Retired (HTTP 410):** the batch engine and its endpoints (`update-data`,
  `update-fec-batch`, `smart-batch`, `test-member`, `reset-pac-data`,
  `refresh-congress-metadata`) and the cron handler. Each rewrote every
  member to change one. 2,073 lines of unreachable code were deleted (git
  history keeps it). The refresh job (Stage 2) replaces them.
- **Proof:** `node scripts/verify/stage1-equivalence.mjs` runs the old and
  new workers against the same production snapshot with no network. All 539
  members are identical on every list field (11,319 compared), on
  member-detail, on `/api/members/{id}` and on `/api/status` (apart from the
  #38 date). Re-grading gives identical results with 0 writes, where the old
  path rewrote the whole list.
- **Migration: done at 18:02 Pacific on 3 Oct (01:02 UTC 4 Oct)**, by a
  one-off scheduled run. 539 `member:*` keys and `members:list` were written,
  using about 548 of the day's 1,000 KV writes; `members:all` was untouched.
  - **Verified:** the live `/api/members` serves `members:list` (539 members,
    308,549 bytes; the 308,541 counted in characters, because a few names
    have accented letters). The site shows "Last updated: 03/10/2026". A
    profile opens and loads its full record in one detail call (checked in a
    browser on Pelosi). A dry-run re-check finds every stored key identical.
  - **The first scheduled attempt (17:10 Pacific) failed before writing
    anything.** It reported `members:all not found` because the script's
    `kvGet` turned every wrangler failure into "not found". It has been fixed
    to return null only for a real 404 and to report anything else with
    wrangler's own error. The cause of that failure isn't known; the same
    read worked a minute later. Recovering needed the owner to approve a
    re-run, which the pre-approved setup was meant to avoid.
  - For about 2 minutes after the write the CLI couldn't read
    `members:list`, while the site already served it. That's documented KV
    behaviour: new keys can take up to 60 s to become visible everywhere,
    and longer when a lookup just before the write cached the miss.
- **Still to meet for Stage 1's exit:** 48 h of zero `exceededResources` on
  the API worker, and KV writes below the pre-pause baseline, both read from
  Cloudflare analytics after the migration.
- **Known:** `adaptiveThresholds` in the list is the cached July value. The
  old path would have recomputed it after 17 Oct; recomputing it moves to the
  refresh job (Stage 2). The itemized worker's `/status` still reads
  `members:all`, which stays as the rollback copy until that worker is
  retired in Stage 2.

---

## 2026-10-03: all scheduled jobs PAUSED for the rebuild (owner's decision)

The owner paused everything while the rebuild spec (`REBUILD_SPEC.md`, #47)
is settled:

- **Pipeline:** cron triggers removed (`crons = []` in `wrangler.toml`; was
  `*/20`).
- **Itemized worker:** cron triggers removed (was `10,30,50`).
- **Health alert:** GitHub workflow disabled.

Applied with `wrangler triggers deploy`, which changes triggers only, not
code. Verified via the Cloudflare API: both workers report no schedules.
The site keeps serving its current data, and admin endpoints still work.
No data is refreshed, and AOC's and Yakym's in-progress collections are
frozen where they stand.

**Do not re-enable** the old schedules: the rebuild replaces them with
filing-calendar triggers (REBUILD_SPEC §4.13). To undo the pause in an
emergency only: restore the `crons` lines from git history, run
`npx wrangler triggers deploy` (pipeline) and
`cd workers && npx wrangler triggers deploy --config wrangler-itemized-analysis.toml`,
then `gh workflow enable health-alert.yml`.

---

## Current System Status (measured 2026-09-26)

1. **Data pipeline** (`taskforce-purple-api`, cron */20): 539 members synced
   daily from Congress.gov. FEC identity from the crosswalk: 498 verified,
   25 shown as "Checking" while being refetched (one per Phase 1 run), 15
   N/A (non-filers). Tiers: S 11 · A 18 · B 20 · C 22 · D 54 · E 70 · F 304.
   **The grades still come from the July 2026 penalty model, which flattens
   145 members to exactly 0% — fix built, not deployed (see In flight).**
2. **Itemized analysis** (`taskforce-purple-itemized-analysis`, cron */20):
   518 analyses stored, 23 queued. Was stalled from ~Sep 9 until 2026-09-26
   by its own D1 budget reserve (fixed, see below). Collects each member's
   **campaign committee only** — joint funds and leadership PACs are not
   collected yet (#32).
3. **D1 write budget**: metered, 85k/day self-cap, ledger tracks Cloudflare's
   own count to within ~10 rows. `donor_aggregates` frozen (unread).
4. **Frontend** (taskforce-purple.pages.dev): auto-deploys on push to main.
   List rows show the FEC small-donor share; ringfenced members show "?".
5. **Open question**: `processing_status` was not written between 10:21 and
   20:00 UTC on 2026-09-26 (old code). Writing normally since the 20:02
   deploy; cause unknown — `wrangler tail` only shows live logs.

---

## 2026-09-28: `/analyze` requires the admin token (ROADMAP D3)

The itemized worker's `/analyze` endpoint ran a collection pass for anyone
who called it. Each call spends requests on the shared api.data.gov key
(60/min) and D1 row-writes from the 85k/day budget, so a stranger calling
it in a loop could starve the cron. It now needs
`Authorization: Bearer $UPDATE_SECRET`, the same token as the pipeline's
admin endpoints, and refuses every request if the worker has no
`UPDATE_SECRET` secret set. `/status` and `/health` stay public. The cron
is unaffected; it never went through `/analyze`.

The itemized worker now needs `UPDATE_SECRET` as a secret too.
`scripts/rotate-secrets.sh` sets it on both workers. Phase D item 3 was
done on its own, ahead of the rest of Phase D, with the owner's approval.

---

## 2026-09-28: the main worker is killed by Cloudflare for hours most days (#46, open)

The alert's "main data worker last ran 99 min ago" wasn't a one-off.
Cloudflare's analytics show that the pipeline's successful runs use about
400 ms of CPU on a plan that allows about 10 ms. Cloudflare tolerates it,
then kills every invocation (`exceededResources`) for hours at a time.
The site's `/api/members` requests die with it, so the site's data has
been intermittently unavailable. Every day in the retrievable four weeks
has kills; on some days more than half of invocations were killed. The
2026-09-26 `processing_status` gap was this too.

Measured causes: `members:all` is 3.5 MB (88% PAC donation lists that
only the detail popup shows). Every pipeline run re-grades all 528
members (added 2026-07-17; it changed 0 grades when measured), and every
page view parses and re-serialises the whole blob. The fix plan is in
#46. It changes no scoring, and grades must come out identical.

---

## 2026-09-28: first alert (#45) — the FEC times out deep into big committees

The first automatic alert (#45) reported Yakym failing with "FEC 504 on 3
runs in a row". The collection was at row 44,000 of 54,880 for C00822767,
and the FEC timed out (504 after 30 s) on the next-page query at any page
size. Reproduced by hand. The same query with `max_date` set to the
cursor's date returns in ~1 s, with 10,919 rows remaining. Pages run
newest first, so every row after the cursor is already on or before that
date; the filter only helps the FEC's database find them. Collection
queries now always send it.

Risk: if any row has no receipt date, the date filter could skip it. The
FEC ignores `sort_null_only`, so this couldn't be ruled out. The per-committee
count check at completion would catch it, so a collection that doesn't
match the FEC now raises an alert (`collection-mismatch`) as well as being
kept off the grade.

Same alert, second item ("main data worker last ran 99 min ago"): see #46
above.

---

## 2026-09-27: automatic alerts (itemized `dbe93b21`)

Until now, failures showed up only in live logs nobody was watching; AOC
sat stuck for three months unnoticed. Now `/health` on the itemized worker
checks the things that have actually gone wrong: workers not running, the
donor queue stuck, members failing or being dropped (with the reason), and
D1 writes escaping the meter. An hourly GitHub Action opens an issue that
@mentions the owner when anything fails, comments only when the problems
change, and closes the issue on recovery. RUNBOOK §10 has the details.

Zero-cost heartbeats: the itemized worker's heartbeat is metadata on a
write it already made. Progress records now carry `lastAdvancedAt` and
`lastFecStop`, saved on the write that already happens every run. The
only new KV write is `itemized_dropped`, and that happens only when a
member is dropped.

The alert script's issue-open, no-repeat, comment-on-change and
close-on-recovery paths were tested locally with a stand-in `gh`. The
live workflow's first scheduled run is at the next :25 after deploy.

---

## 2026-09-27: large campaigns never finished — one FEC hiccup threw away the run (#44)

**What was wrong.** When the FEC returned a temporary error (rate limit,
timeout, server error) on any page, the itemized worker threw. That
discarded every page already fetched in that run (their D1 rows were
written, but the progress record wasn't saved) and counted a strike
against the member; three strikes and they were dropped from the queue.
Big campaigns need hundreds of pages, so they hit one sooner or later and
never finished. The code has been like this since the worker was written.

**AOC, the evidence.** Her progress record last saved on 2026-06-24
(55 runs, 26,436 of the FEC's 100,899 rows). D1 holds 29,570 of her rows,
the last written 2026-06-29. The 3,134 rows beyond the saved progress are
the signature of this bug: pages written, then the run threw before
saving. She has not advanced since. The exact FEC status codes weren't
recorded anywhere, because the worker never stored a failure reason.
Nothing changed on 2026-09-26/27 caused it; the queue was then paused on
the D1 budget, and she wasn't attempted.

**Her S tier.** It comes from the FEC totals: 66% small donors, $28k PAC,
32.6% itemized. With no completed donor analysis, the concentration check
uses the default anchor of 40, so the itemized share draws no penalty. The
grade is consistent with the settled model, but it has not yet been tested
against her donor concentration.

**Fix.** A temporary FEC error now keeps the pages already processed and
ends the run cleanly, with no strike. Only a run that gets nothing at all
counts, and three such runs in a row is a failure, so a member the FEC
refuses on every run still can't hold the queue head. Any other error (a
4xx) still fails at once. Queue entries now carry `lastError` and
`lastFailedAt` (no extra KV writes; the queue is written anyway), with the
API key redacted. Tests: `workers/itemized-fec-errors.test.js`. 3 of its 4
tests fail on the previous code.

---

## 2026-09-27 18:09 UTC: hardcoded credentials removed and rotated (pipeline `6433b25b`, itemized `8d78343d`)

An api.data.gov key (the Congress.gov key, also used for every FEC call)
and the admin `UPDATE_SECRET` had been hardcoded in the public worker code
since 2025-09-29/30 — written by Claude, flagged in July, left in place, and
a further copy added on 2026-09-26. Anyone reading the repo could call the
admin endpoints (recalculate, reprocess, clear FEC mappings, reset PAC data).

- Owner issued a new api.data.gov key; `scripts/rotate-secrets.sh` set it and
  a newly generated `UPDATE_SECRET` as Cloudflare Worker secrets (neither
  worker had any secrets before — both ran on the hardcoded values).
- All 10 hardcoded keys and 6 password copies removed; `requireSecret()`.
- Verified: the old public `UPDATE_SECRET` is rejected (HTTP 401); the
  itemized worker's 18:10 discovery sweep ran on the new key.
- The old key could not be self-revoked; it remains in git history, unused.
- CI: the gitleaks step had been failing with "scanned ~0 bytes" on every
  multi-commit push (shallow checkout, exit 1 = scan error, not a leak) —
  fixed with `fetch-depth: 0` and confirmed scanning.

## Recent deploy — 2026-09-27 15:23 UTC (pipeline `a1ec8b8d`, itemized `2985cb40`, frontend `7e1d662`)

**Live now:**

- **Step 4 fix (#42):** members at exactly 0% went 145 → 4 (the 4 are on the
  small-donor-only fallback path — see Known issues). Live tiers after the
  15:40 recalc: S 10 · A 15 · B 29 · C 40 · D 85 · E 139 · F 205, matching the
  simulation (F higher because 14 re-fetched identity members are now graded).
  Reference members unchanged: AOC S 98, Sanders S 95, Pelosi A 90, Jeffries B 73.
- **Every committee a member runs (#32):** the itemized worker discovers a
  member's campaign(s), joint funds and leadership PAC, then collects donors
  from all of them into one pool. The :10 run each hour is a discovery sweep
  (one member, publishes their money trail ahead of collection); :30 and :50
  collect. Cron offset from the pipeline because the FEC key allows 60
  requests per minute.
- **Reconciliation gate:** a member moves to the all-committee grade only
  when every committee's records match the FEC's exact count and its itemized
  money matches the FEC's total to the dollar. Otherwise the card says the
  figures are being re-checked (`gradeBasis: campaign-committee-rechecking`).
- **Itemized money counted as the FEC does:** non-memo line 11AI whatever the
  entity type (tribal nations included), refunds netted — one classifier
  shared by the worker and `scripts/trials/pool-donors.mjs`.
- **Money-trail panel** on every profile, fed by `/api/member-detail`.

**Follow-up, same day (itemized `96d37c94`):** the D1 meter charged every
transaction at the new-row price (5), but re-collections are mostly ignored
duplicates (1, measured) — it over-stated spend ~5x and would have stopped
collection each day after a fifth of the safe work. It now charges from D1's
own per-statement `meta.changes`. Verified after deploy: grades match the
simulation; a discovery run (Yakym, 3 committees) and the first hourly sweep
(Aderholt: campaign, leadership PAC, joint fund) both published correctly.
Collection paused for the rest of 2026-09-27 on that day's (over-stated)
budget; resumes 00:00 UTC.

**Rolling out over weeks, not instantly:** money trails appear as the sweep
reaches each member (~24/day); grades switch to all-committees member by
member as each pooled collection completes and reconciles. Very large
campaigns may take a long time (AOC's collection has never completed).

**Verified on the Pelosi trial (read-only):** every count exact, every
dollar reconciled; all-committee grade B 74 vs A 90 campaign-only.

### Discarded on 2026-09-26 — do not revive

A "three bucket" rule (small / large / PAC, worst-of-three) that scored all
itemized money as bad. Simulated: no S tier, AOC and Sanders S→B. It threw
away the settled ballroom principle. See CLAUDE.md "Settled decisions".

---

## Recent Major Updates

### 2026-09-26: Itemized queue stalled by its own budget reserve (fixed, `fe22b95`)

**Symptom**: D1 ledger frozen all day at 70,435 rows; itemized queue stuck
at 23 with the same member at its head. **Cause**: the 2026-09-09 budget
guard reserved room to write a D1 row per donor at completion. A member
with 7,169 donors needed 14,338 rows with 14,565 left, so every run paused
at zero pages _without deferring_ — holding the queue head. For the largest
members the reserve exceeds the whole daily budget: they could never finish.
**Fix**: `donor_aggregates` is no longer written — nothing ever read it (the
grade uses the KV analysis) and it cost ~⅓ of the daily budget. Verified:
the stalled member paged immediately after deploy.

### 2026-09-26: "0% Grassroots" was false for 145 members (label fixed, `aab3589`)

The list row printed the penalised score under the word "Grassroots" — one
senator read "0% Grassroots" against an FEC small-donor share of 4%. The row
now shows the FEC figure, labelled "Small donors". The flattening itself is
the Step 4 fix under In flight.

### 2026-09-26: 35 members were showing another person's money (post-mortem, #41)

**Status**: ✅ DEPLOYED (pipeline `c1e32360`, itemized `ac74d6a3`, frontend `de9a6d9`); refetch of affected members in progress

**Symptom**: 6 members "stuck" on 2022/2024 data for months. Checking their
cached `fec_mapping_*` found other people: a House member mapped to a sitting
senator, another to his father's Senate committee, a senator to her father, one
to a 1982 namesake. An audit of all 531 cached mappings against the
[congress-legislators](https://github.com/unitedstates/congress-legislators)
crosswalk: **489 correct, 35 wrong person, 6 right person / other office.** 25 of
the 35 carried a published letter grade (18 of them F).

**Root cause**: identity by surname search, cached forever. The matcher searched
FEC by surname only, trusted `incumbent_challenge` (describes each candidate's
_last_ race), and matched on `office_sought` — a field the API does not return,
so the primary match never fired. Re-running it live on 10 bad cases fixed 5
and re-broke 5; purging the cache would not have worked. The itemized worker
inherited the wrong committee (so its bundler/FARA/concentration analyses were
also someone else's) and had its own surname-search fallback.

**Fix**:

- `scripts/build-fec-crosswalk.mjs` → `workers/fec-crosswalk.js` (bioguide →
  FEC IDs, 21 KB, regenerate when membership changes). `workers/fec-identity.js`
  resolves/validates; one FEC call per member. Name search deleted everywhere.
- Every member write stamps `fecCandidateId` + `fecIdentityVerified`. The scorer
  returns tier **UNVERIFIED** unless `fecIdentityVerified === true` (fails closed).
- An itemized analysis counts only if fresh **and** from the member's current
  committee; mismatches are rejected and cleared from the card; completion
  deletes the member's other-committee D1 rows (same indexed scan as the legacy
  cleanup) and resets `donor_aggregates` when replacing another committee.
- Frontend: UNVERIFIED hides every funding section; word tiers render a short
  badge mark (fixes #36) with a test that every badge label fits the circle.
- Migration `scripts/migrations/2026-09-26-stamp-fec-identity.mjs` (applied
  20:01 UTC): 495 verified, 27 members' figures and analyses **removed from the
  public API** (not just hidden), 4 mismatched analyses cleared, 43 re-queued.

**Verified**: all 539 records stamped; no UNVERIFIED member carries money,
committee or analysis fields; first recalculation on new code changed 0 of 495
verified members; mismatch rejection fired for the 2 expected members.

**Known limits**: the crosswalk lags FEC for brand-new registrations (Hinson,
Downing, Haridopolos had their _own_ Senate IDs cached, which the crosswalk
does not yet list — they are refetched under their House ID). Person-level
aggregation across a member's House + Senate campaigns (agreed rule on #41) is
the next build.

**Also found, not fixed**: 145 members score exactly 0% because a flat 40-point
penalty is floored at zero, and the row labels that score "Grassroots" (#42).

### 2026-09-09: D1 write cap breached three days running (post-mortem)

**Status**: ✅ METERED AND ENFORCED (analysis worker `c27def85`)

**Symptom**: `rows_written_24h` of 138,740 → 109,214 → 117,205 against a
100,000/day free-tier cap that Cloudflare began hard-enforcing ~2026-09-01.
Past the cap, D1 writes error until 00:00 UTC. Successive fixes cut the cost
per row and writes still went **up**, because the same fixes made collection
faster (13 → 18 members/day) and nothing was counting.

**Root cause**: there was no D1 write budget anywhere in the codebase. KV was
budgeted deliberately — one member per run, 20-minute cron — and D1 rode along
on that throughput knob under a limit that was never previously enforced. No
counter, no threshold, no check.

**Second finding — the arithmetic was wrong too.** Per-row costs had been
_derived_ (1 table row + 1 per index). Measured against production D1:

| operation                         | derived | measured |
| --------------------------------- | ------- | -------- |
| new transaction                   | 4       | **5**    |
| duplicate transaction (OR IGNORE) | 0       | **1**    |
| new aggregate                     | 2       | 2        |
| aggregate, amount changed         | 4       | **1**    |
| aggregate, amount unchanged       | 4       | **0**    |

The fifth write per transaction is `sqlite_sequence`, maintained because
`itemized_transactions.id` is `AUTOINCREMENT` — ~16,000 row-writes/day of
bookkeeping this schema never reads. Dropping it needs a 1.5M-row table
rebuild costing ~15 days of budget, so it is documented, not done.

`16,491 × 5 + 14,424 × 2 + 16 = 111,319`, plus ignored duplicates at 1 each,
accounts for the observed 117,205.

**Fixes**:

1. `workers/d1-write-budget.js` — a daily ledger (`d1_write_budget` table, one
   row per UTC day) with a self-imposed 85,000 budget. Checked at run start
   and before every page; the run stands down rather than spending FEC calls
   on data it cannot store. **Fails closed**: an unreadable ledger reports
   zero remaining. 16 unit tests.
2. `donor_aggregates` moved from `INSERT OR REPLACE` to
   `ON CONFLICT DO UPDATE ... WHERE total_amount IS NOT excluded.total_amount`.
   A donor whose total has not changed since the last collection now costs
   **0** row-writes instead of 2 — most donors, most collections.

**Verified**: with today's actual usage seeded into the ledger, a live
`/analyze` returned `budgetExhausted: true` and did no work. Upsert costs
were measured on production D1, not assumed.

**Residual**: a budget-exhausted day means collection pauses until 00:00 UTC.
That is the intended trade — freshness yields to staying inside the free tier.
If pauses become routine rather than occasional, the lever is
`ANALYSIS_STALENESS_DAYS` (currently 30), not a paid plan.

### 2026-07-18: Cross-Cycle Financial Corruption (post-mortem)

**Status**: ✅ FIXED, REPAIRED, VERIFIED (pipeline 13d4b0ae)

**Symptom**: 9 members at tier S with individualFundingPercent over 100%
(Cramer 170%, Gallego 747%) — the S showcase was populated by the most
corrupted records on the site.

**Causal chain** (three contributing failures, months apart):

1. **Latent** (January): `updateMemberWithPhase1Data` wrote
   totalRaised/grassroots/PAC from fresh financials but never wrote
   `largeDonorDonations`. Other write paths populated it, so records
   stayed accidentally consistent — as long as nothing ever refreshed.
2. **Trigger** (2026-07-17): the financial-staleness refresh re-fetched
   2024-class senators for cycle 2026 → fresh small totals + retained
   huge 2024 itemized = arithmetically impossible records.
3. **Mask** (July hardening): the penalty cap + score floor converted
   impossible inputs (IFP 210–787 pre-cap) into plausible-looking S
   tiers instead of failing loudly. Fixing symptoms (negative scores)
   without an input invariant hid the next corruption class.

**Fixes**: Phase 1 writer now always writes `largeDonorDonations` from
the fetch (null if absent, never cross-cycle carryover);
tier-calculation gained a sanity guard — individual funding exceeding
totalRaised is impossible, so such records refuse enhanced scoring and
fall back to grassroots-only with an `inconsistent-financials` detail
flag (unit-tested with the literal Cramer numbers). The 15 corrupted
members were re-fetched through the fixed path.

**Verified after repair + recalc**: 0 impossible records, 0 members over
100%. Cramer: S/170% → **D/39%** on real 2026 numbers. S tier now: AOC,
Warren, Ossoff, Kelly, Vindman, Sanders.

**Lesson recorded**: every "impossible" state deserves an invariant
check that fails loudly, not a clamp that makes it presentable. Related
open design question: the Nakamoto <50 absolute rule fires before the
density rule, giving small-state members with proportionally wide donor
bases (Cramer: 49 of 403 = 12%) the harshest anchor — owner's call
whether to reorder.

---

### 2026-07-17: FARA Cross-Reference + Donor Network Quicklook (issues #34, #33)

**Status**: ✅ DEPLOYED (itemized 9125ac90, pipeline c373a5fa, frontend)

**FARA (first slice)**: donations from employees of DOJ-registered
foreign-agent firms, matched by donor-reported employer.

- `fara_registrants` (D1): 533 active registrants from
  `efile.fara.gov/api/v1/Registrants/json/Active` (the only working
  endpoint — DOJ's ShortFormRegistrants and ForeignPrincipals endpoints
  404 in every format; individual-agent matching and foreign-principal
  attribution get added when DOJ fixes them)
- `fara_employer_matches` (D1): 225 exact contributor_employer strings
  mapped to registrants via precision-first normalized matching (built
  locally; refresh by re-running the match when registrants update)
- Itemized worker computes `faraFirms`/`faraEmployerTotal` per member at
  collection completion; pipeline merges to members:all; the 29 analyses
  fresh at deploy time were backfilled directly (one-time, 29 KV writes)
- Top findings at deploy: Pappas $82k/18 firms, Husted $62.5k/19,
  Moody $62k/17 — bipartisan by construction

**Presentation (the "make shady legible" pass)**:

- `src/lib/donor-taxonomy.js` (tested): display-only sector
  classification of bundlers (platform / pro-Israel lobby /
  party-machine / advocacy / industry / tribal / foreign-agent) with
  lucide icons; unknown names degrade to neutral; tier scoring still
  never touches name patterns
- Member cards: red "Foreign-agent connected money" section with DOJ
  citation + per-firm FARA registration numbers; bundled-money headline
  ("$X — Y% — didn't arrive on its own"); sector icons/labels on conduits
- Tier list rows: quicklook icons for flag-worthy networks without
  opening the card

---

### 2026-07-14: Analysis Refresh Policy + sub_id Storage (ROADMAP Phase A)

**Status**: ✅ DEPLOYED (itemized worker b52c9f79); D1 migration applied

- **Refresh policy**: when the itemized queue drains, it rebuilds itself
  from members whose analysis is missing or **>30 days old** (oldest
  first; requires `committeeInfo.id`). Staleness scans are throttled to
  one per 6h when everything is fresh. A stale analysis keeps serving
  tiers until its replacement lands (atomic swap at completion).
- **Delete-before-recollect**: a fresh collection first clears the
  member's `itemized_transactions` + `donor_aggregates` rows — makes
  re-collection idempotent and heals the 28 January-duplicated members
  as they come up for refresh.
- **Cron runs take 20 pages** (15-minute scheduled-run limit), HTTP
  `/analyze` keeps 5 (30s limit). Full-Congress pass: ~2 weeks.
- **Itemized failures get a 3-try budget** (were cycling forever, which
  would have blocked queue drain and thus rebuild).
- **`sub_id`** (FEC unique transaction id) now stored with a unique
  index; inserts are INSERT OR IGNORE. Enables incremental top-ups later.
- `/status` reports real counts (was hardcoded 537 + fake examples).

**Budget note**: at maximum sustained throughput, 20-page runs could
exceed D1's nominal 100k rows-written/day (index writes multiply row
counts). Empirically this has not been enforced as a hard block (the
2026-07-12 backfill wrote 705k rows in a day), D1 writes are non-fatal
to collection, and delete-before-recollect makes any gap self-healing on
the next refresh pass. Watch `wrangler d1 info` during the first full
pass; drop `PAGES_PER_RUN_CRON` if write errors appear in logs.

**Verified live**: honest `/status` (536 members / 499 analyses / real
queue), 5-page HTTP run processed the queue head under the new code,
`sub_id` landing in D1 (250 rows, 250 distinct). Expected trajectory:
current queue drains, first rebuild enqueues ~500 stale analyses, full
conduit coverage arrives over ~2 weeks.

---

### 2026-07-13 (functional check): Three More Intermittent-Failure Fixes

**Status**: ✅ DEPLOYED (pipeline d39ff7b1, itemized 592f831c); stale
mapping cache fully purged (18 keys, owner-approved)

Found while verifying the backfill end-to-end (worker log tails):

1. **NTP time-fetching removed**: `getCurrentYear()` queried up to 4
   external time APIs per call under the false belief that Workers' `Date`
   is broken (it only freezes within synchronous execution). When all four
   flaked — regularly — the entire financial lookup threw and the member
   deferred. Now just `new Date().getFullYear()`. Also saves ~8
   subrequests + up to 8s per lookup.
2. **`/totals/by_entity/` fallback fabricated $0**: that endpoint ignores
   `candidate_id` and returns marketwide aggregate rows with no `receipts`
   field; `.receipts || 0` turned that into a $0 "success" that overwrote
   members with zeros. Now requires candidate-level fields or fails
   properly (null → retry budget).
3. **Itemized worker had its own wrong-twin bug**: it re-searched
   candidates by last name and took the first result. Now it uses the
   `committeeInfo.id` Phase 1 already discovered (search + incumbent sort
   as fallback only).

**Verified live**: Perry, Scott $4.4M → tier E; Durbin $80k → tier F
(both N/A since Oct 2025). N/A count 111 → 96 in ~16 hours and falling.

**Known wrinkle**: members mid-collection at deploy time (J000294) resume
with a pagination cursor from the filtered fetch, so their conduit data
will be partial until re-collected under a future refresh policy.

---

### 2026-07-13 (later): Wrong-Candidate FEC Matching — the Real N/A Root Cause

**Status**: ✅ FIX DEPLOYED (pipeline d9b62a39); cache purge partially done

The Phase 1 backfill was "processing" members but writing zeros. Worker
logs revealed why: `fec_mapping_H001089` mapped Josh Hawley to
**S4MO00045 — James Gregory Hawley, a 1993 perennial candidate** (committee
cycles: 1994, 1996). Two stacked bugs:

1. Candidate matching relied on `office_sought`, which is always null in
   the FEC search response, so it always fell through to committee-type
   matching, where same-name candidates win by list order
2. The wrong candidate's $0 totals count as "found data": zeros were
   written, the member left the queue as processed, and the wrong mapping
   stayed **cached** in `fec_mapping_{bioguideId}` — so every retry
   repeated the mistake

**Fix**: sort FEC search results to prefer `incumbent_challenge === 'I'`
(we only ever look up sitting members). Verified end-to-end: after
clearing his cached mapping, Hawley resolves with $1,518,950.76 raised
(matches direct FEC query), tier F, after 9 months of N/A.

**Resolved 2026-07-13**: all remaining stale mappings (18 keys) purged with
owner approval; fresh lookups re-search through the incumbent-preferring
matcher and cache correct candidates.

---

### 2026-07-13: Pages Builds Silently Broken Since January — Fixed

**Status**: ✅ FIXED

Every Cloudflare Pages production build since commit c198808 (mid-January)
had **failed**: `npm ci` on the build image rejected a package-lock.json
that was out of sync with package.json. The live site served a stale
January bundle for ~6 months; nobody noticed because member data comes from
the API at runtime. Discovered while verifying the donor-concentration card
deploy. Fix: regenerated the lock file (verified `npm ci` passes clean).

Also corrected: docs pointed to `taskforcepurple.pages.dev`, which does not
exist (NXDOMAIN) — the real domains are **taskforce-purple.pages.dev** and
**taskforcepurple.com** (live, not "coming soon" as README claimed).

**Lesson recorded**: "auto-deploys on push" is only true when builds pass —
check `npx wrangler pages deployment list --project-name=taskforce-purple`
after frontend pushes.

---

### 2026-07-12 (evening): Conduit/Earmark Network Attribution (issue #33, first slice)

**Status**: ✅ DEPLOYED (itemized worker 4f4b2171, pipeline e4e46bec)

**What it does**: captures which networks bundle a member's individual money.
FEC earmark mechanics (verified empirically): donors appear as normal
individual rows marked "EARMARKED CONTRIBUTION" with NULL conduit fields; the
conduit's identity arrives as a separate MEMO row (entity PAC/ORG, line 11AI)
naming it, with the attributed total. We previously skipped all memo rows —
correct for money totals, but it discarded the network's name.

**Changes**:

- `workers/schedule-a-classify.js` (new, unit-tested): pure row classifier —
  invalid / conduit-memo / memo / committee / individual-earmarked / individual
- Itemized worker: dropped `contributor_type=individual` from the Schedule A
  fetch (that filter excluded the PAC-entity memo rows naming conduits);
  classifier now separates rows. Aggregates `conduitTotals` (by normalized
  name) and `earmarkedTotal` during collection; analysis output gains
  `conduits` (top 10), `earmarkedTotal`, `earmarkedCount`
- Row-count validation now compares FEC's pagination count against all rows
  seen (`rawRowCount`), since the unfiltered fetch includes memo/committee rows
- Pipeline merge: `topConduits` + `earmarkedIndividualTotal` flow into
  members:all (and thus the API) for analyses that have them
- Money totals unchanged: conduit lumps stay excluded from donor/amount math

**Validation** (live FEC data, one member committee, 800 rows): ActBlue
$63,304/365 lumps; American Israel Public Affairs Committee PAC $25,700/27
lumps; JStreetPAC $250/1 — generically-named and fully-named networks caught
by the same machinery.

**Coverage note**: only analyses collected from now on carry conduit data —
the 497 existing snapshots predate it. Full coverage arrives with the
analysis refresh policy (known limitation #1) or targeted re-collection.

---

### 2026-07-12 (later): D1 Mirror Fixed and Backfilled

**Status**: ✅ FIXED, DEPLOYED, BACKFILLED

**Root cause**: the `donor_aggregates` INSERT in `itemized-analysis.js`
packed 100 rows × 8 bound params = 800 parameters into one statement, over
D1's per-statement limit. Any member with more than ~12 donors threw on the
first chunk, and the shared try/catch silently skipped the
`collection_metadata` write too. Evidence: all 89 pre-fix metadata rows
belonged to members with 0 donors (85) or ≤12 (4); writes ceased entirely
after March 2026 once completions had real donor bases.

**Fix (deployed, worker version da4074f9)**: aggregates now use the D1 batch
API (100 single-row statements per batch, same pattern as the transactions
insert), and the metadata write has its own try/catch so an aggregates
failure can never block the completion record.

**Backfill (one-time, 2026-07-12)**:

- `donor_aggregates` rebuilt from `itemized_transactions` via GROUP BY using
  the worker's donor-key semantics: 326,136 rows across 425 members (8s)
- `collection_metadata` backfilled from the 497 KV analyses via
  `wrangler kv bulk get` (100-key chunks) → 499 total rows
- Validation against KV found 28 members whose raw transactions are inflated
  (January collection restarts re-wrote pages; no dedup key stored). Their
  52,126 aggregate rows were deleted — no row beats a wrong row. Final state:
  **397 members with verified aggregates (274,010 rows), 499 metadata rows**
- Spot-check: A000148 matches KV exactly (740 donors, $1,477,988)

---

### 2026-07-12: Tier Calculation Hardening + Phase 1 Silent-Skip Fix

**Status**: ✅ DEPLOYED

**Tier math** (was producing negative scores for 292 members; 330/537 in tier F):

- Extracted all tier math into `workers/tier-calculation.js` (pure functions,
  24 unit tests including the documented Bernie/Pelosi reference cases)
- Itemization penalty capped at 40 points (was unbounded, observed up to 390)
- `individualFundingPercent` floored at 0 (was as low as -167% in the API)
- Reliability check on concentration snapshots: <10 unique donors or <50%
  coverage of reported itemized total → neutral 40% anchor instead of the
  harshest 10% anchor (zero-donor snapshots previously read as maximum risk)
- Election-cycle math unified in one place; data-pipeline previously mapped
  odd years DOWN (2025→2024) while itemized-analysis mapped UP (2025→2026).
  FEC names cycles by the even end-year, so up is correct.
- Simulated impact across live data: tier F 330→227, negative scores 292→0,
  115 members move up, none down, reference cases unchanged

**Phase 1 silent skip** (root cause of issue #29's 112 N/A members):

- `fetchMemberFinancials` returning null previously overwrote the member with
  zeros and dequeued them as processed. Now: defer to end of queue with a
  3-attempt budget, then mark `fecLookupExhausted` (retried after 90 days)
- `initializeProcessingQueues` re-queues `totalRaised: 0` members when the
  Phase 1 queue is empty (previously early-returned because the empty queue
  key existed, stranding them forever)
- Thrown Phase 1 errors defer-and-persist so a permanently failing member
  can't stall the queue head; rate-limit errors still retry the same member

**Also fixed**: frontend truthiness bugs hiding 0% scores and rendering
negative ones; D1 reconciliation field-name mismatch (`fecItemizedTotal` /
`percentDiff` vs the actual `fecReportedTotal` / `percentDifference`) that
left those columns always null; README tier thresholds synced with code;
`npm test` now runs vitest instead of a no-op echo.

---

### 2026-01-16: Dynamic Trust Anchor System

**Status**: ✅ DEPLOYED AND WORKING

**What Changed**:

- Fixed critical denominator bug in itemized percentage calculation
- Changed from `largeDonorDonations / totalRaised` to `largeDonorDonations / (grassrootsDonations + largeDonorDonations)`
- This isolates the "human element" - of the people who gave, how reliant are you on big checks?

**Impact**:

- Bernie Sanders: 20% itemized (S-tier maintained)
- Nancy Pelosi: 35% itemized (drops to A-tier with 5% penalty)
- Correctly differentiates movement-scale funding from elite capture risk

**Files Modified**:

- `workers/data-pipeline.js` - calculateEnhancedTier() function
- `README.md` - Updated with real examples
- `DONOR_CONCENTRATION_ANALYSIS.md` - Technical documentation
- `src/App.jsx` - Frontend explanation with generic examples

### 2026-01-17: Automatic Congress Member Sync

**Status**: ✅ DEPLOYED

**What It Does**:

- Runs once per day (24-hour check in scheduled() function)
- Fetches current members from Congress.gov (2-3 API calls)
- Adds new members to dataset with empty financial data
- Removes departed members from dataset, queues, and KV storage
- Sanity check: aborts if < 400 members returned

**Impact**:

- No manual intervention needed for member list changes
- 3 departed members will be removed on first run
- Future Congress changes handled automatically

**Files Modified**:

- `workers/data-pipeline.js` - Added syncCongressMembers() and removeFromQueue()

### 2026-01-17: Itemized Analysis Scaling

**Status**: ✅ DEPLOYED (code changes)

**What Changed**:

- Replaced hardcoded Bernie/Pelosi with queue-based processing
- Updated worker to process from itemized_processing_queue
- Dynamic member lookup from members:all dataset
- Auto-removes completed members from queue

**Files Modified**:

- `workers/itemized-analysis.js` - Queue processing logic

---

### 2026-01-23: System Verification and Gap Resolution

**Status**: ✅ COMPLETED

**What Was Found**:

System verification revealed gaps between Jan 17 status report claims and actual deployed state:

1. **itemized_processing_queue** did not exist in KV storage
   - Code to process queue existed but queue was never initialized
   - Worker immediately returned "No processing queue found"
   - Only 2 members processed (Bernie & Pelosi from proof-of-concept phase)

2. **Nakamoto data not exposed in API**
   - Data existed in separate `itemized_analysis_v2:*` KV keys
   - Used internally for tier calculations but not visible to frontend
   - `/api/members` showed `nakamotoCoefficient: null` for all members

3. **Worker UI contained stale POC references**
   - Homepage still said "Sanders + Pelosi" and "every 2 minutes"
   - `/status` endpoint hardcoded to only check Bernie & Pelosi
   - Console logs referenced specific bioguide IDs

**What Was Fixed**:

1. **Initialized Processing Queue** (535 members)
   - Queried all 537 current bioguide IDs from `/api/members`
   - Excluded S000033 (Bernie) and P000197 (Pelosi) - already complete
   - Created queue as JSON array and stored in KV storage
   - Result: Worker immediately began processing at 1 member/20 minutes

2. **Exposed Nakamoto Data in API**
   - Modified `handleMembers()` in `workers/data-pipeline.js`
   - Added async loading of `itemized_analysis_v2:${bioguideId}` for each member
   - Merged concentration data into API response: `nakamotoCoefficient`, `nakamotoPercent`, `uniqueDonors`, `top10Concentration`
   - Deployed updated worker - verified Bernie shows Nakamoto: 1534 (11.7%)

3. **Updated Worker UI** (removed all POC references)
   - Homepage: Changed to "queue-based processing" and "every 20 minutes"
   - Console logs: Now show queue status instead of hardcoded names
   - `/status` endpoint: Completely rewritten to show queue progress, completion ETA, and real-time stats

**Current Verified State** (as of 2026-01-23 02:35 UTC):

- **Queue**: 502 members remaining, 35 complete (6.5%)
- **Processing Rate**: ~3 members/hour (verified working correctly)
- **Next Member**: Blackburn, Marsha (B001243)
- **ETA**: 7 days (Jan 30, 2026)
- **Nakamoto Data**: Exposed in API for all 35 completed members

**Files Modified**:

- `workers/data-pipeline.js` - handleMembers() function (lines 1740-1769)
- `workers/itemized-analysis.js` - Homepage text, scheduled() logs, getStatus() function
- `IMPLEMENTATION_STATUS.md` - This update

**KV Operations**:

- Created `itemized_processing_queue` with 535 member bioguide IDs

---

### 2026-02-21: Itemized Queue Stall Bug Fix

**Status**: ✅ FIXED AND DEPLOYED

**Bug Description**:

Itemized analysis processed only 10 members in 29 days (Jan 23 → Feb 21) despite the cron running every 20 minutes. Investigation revealed Perry, Scott (P000605) was permanently stuck at position 0 of the queue with error "No principal committee found". Every cron run hit Perry, failed, and left him in place — the queue never advanced.

**Root Cause**:

Two compounding issues:

1. The Jan 23 queue initialization added all 535 members indiscriminately, including ~115 members with `totalRaised: 0` who had been added by the Congress sync but not yet processed by the data pipeline's Phase 1 (so they have no FEC committee ID).

2. The error path in `analyzeMembers()` (lines 196–207) caught the error and recorded it, but the queue update logic (lines 220–232) only removed a member if `itemized_analysis_v2:{bioguideId}` existed after the run. Failed members were left at position 0 indefinitely.

**Fix**:

Changed queue update logic in `analyzeMembers()` in `workers/itemized-analysis.js` to distinguish three outcomes:

- **Complete** (`analysisData` exists): remove from front of queue
- **Failed** (`results[bioguideId].success === false`): defer to end of queue so others can proceed
- **In progress** (multi-run member, no result yet): keep at front

Members with no FEC committee (still awaiting Phase 1 data) will now cycle to the back and be retried automatically once the data pipeline has caught up to them.

**Current State** (as of 2026-02-21):

- 45/538 members complete (8.4%)
- 494 members in queue
- Fix deployed — queue now draining

**Files Modified**:

- `workers/itemized-analysis.js` — queue update logic in `analyzeMembers()` (lines 220–235)

---

### 2026-01-23: nakamotoCoefficient Bug Fix

**Status**: ✅ FIXED AND DEPLOYED

**Bug Description**:

API was showing only 32 of 35 completed members with Nakamoto data. Investigation revealed:

- **Affected members**: B001236 (Boozman), D000563 (Durbin), H001089 (Hawley)
- **Root cause**: Used `||` operator for nullish coalescing in `workers/data-pipeline.js` line 1769
- **Impact**: Members with `nakamotoCoefficient: 0` (valid data for zero itemized donations) were converted to `null`

**Technical Details**:

```javascript
// BEFORE (broken):
nakamotoCoefficient: concentrationData?.nakamotoCoefficient || null,

// AFTER (fixed):
nakamotoCoefficient: concentrationData?.nakamotoCoefficient ?? null,
```

The `||` operator treats `0` as falsy and returns `null`. The `??` (nullish coalescing) operator only returns `null` for `null`/`undefined`, preserving `0` as valid.

**What Was Fixed**:

- Changed three fields in `workers/data-pipeline.js` lines 1769, 1778, 1779:
  - `nakamotoCoefficient`: Now uses `??` instead of `||`
  - `uniqueDonors`: Same fix applied
  - `top10Concentration`: Same fix applied

**Verification**:

- Before: 32 members showing Nakamoto data in API
- After: 35 members showing Nakamoto data in API (matches KV count)
- Affected members now correctly show `nakamotoCoefficient: 0` instead of `null`

**Files Modified**:

- `workers/data-pipeline.js` - Lines 1769, 1778, 1779
- Deployed successfully at 2026-01-23 03:00 UTC

---

## Active Processing Queues

### Priority Queue (Missing largeDonorDonations)

- **Status**: ✅ COMPLETED
- **Members**: 0 remaining (all members have financial data)
- **Purpose**: Backfilled missing largeDonorDonations field for accurate tier calculation

### Itemized Processing Queue

- **Status**: ✅ Processing automatically
- **Members**: 502 remaining (35 complete as of 2026-01-23 02:35 UTC)
- **Rate**: ~3 members per hour (1 member every 20 minutes)
- **Progress**: 6.5% complete (35/537 members analyzed)
- **Completion**: ~7 days (estimated Jan 30, 2026)
- **Purpose**: Collect donor concentration data (Nakamoto coefficients) for all members
- **Next**: Blackburn, Marsha (B001243)

---

## Architecture Overview

### Data Pipeline Flow

```
Congress.gov API (daily sync)
    ↓
members:all dataset (540 members in KV)
    ↓
Smart Batch Processing (every 15 minutes)
    ├── Priority Queue → Fix missing largeDonorDonations
    ├── Phase 1 → Fetch financial data (grassroots, total raised)
    └── Phase 2 → Enhance with PAC details and metadata
    ↓
Tier Calculation
    ├── Base calculation (grassroots %)
    ├── Dynamic trust anchor (if concentration data available)
    └── Enhanced PAC weighting (if metadata available)
    ↓
Frontend Display (tier list)
```

### Itemized Analysis Flow

```
FEC API (Schedule A itemized contributions)
    ↓
Stream-and-Aggregate (no raw storage)
    ├── Donor deduplication (first|last|state|zip)
    ├── Amount aggregation per donor
    └── Progress tracking in KV
    ↓
Final Analysis
    ├── Unique donor count
    ├── Nakamoto coefficient (donors to control 50%)
    ├── Nakamoto % (coordination risk metric)
    └── Top-10 concentration
    ↓
Dynamic Trust Anchor Application
    └── Sliding itemization threshold (10-50%)
```

---

## Free Tier Compliance (recalculated 2026-07-12)

Both crons run every 20 minutes = 72 runs/day per worker.

### Cloudflare KV — the binding constraint (1,000 writes/day)

- data-pipeline per run: processing status + queue + members:all + tier
  recalc ≈ 4-5 writes → ~290-360/day
- itemized worker per run: progress + queue = 2 writes → ~144/day
  (+2 on a completion: analysis write + progress delete)
- **Total ≈ 450-550/day ≈ 50-55% of budget** ✅
- The July 2026 queue fixes add ~1 write per failure-defer (replaces a
  formerly skipped write) and one queue rebuild per drain cycle — noise
- KV reads: tier recalculation after each batch reads per-member
  concentration keys (~537 × 72 runs ≈ 39k/day, pre-existing);
  `/api/members` costs 3 reads per request (merged at write time,
  2026-07-12) → ~20k requests/day ceiling on the 100k read budget ✅

### Cloudflare D1

- Steady state: transaction inserts only while actively collecting
  (≤36k raw rows/day at full throughput; observed average ~7k/day),
  aggregates+metadata only on member completion. Well under 100k rows/day ✅
- **2026-07-12 one-time backfill spiked usage** (~705k rows written /
  13.6M read in 24h) — deliberate, not recurring; back to baseline next day

### External fetches per invocation (50 limit)

- data-pipeline ≤15 FEC calls; itemized ≤7 (5 pages + search + reconcile) ✅
- KV/D1 operations count against the separate 1,000 internal-ops limit;
  worst case (huge-member completion: ~130 D1 batch calls + KV ops) ≈ 15% ✅

### API rate limits

- FEC (1,000/hr): both workers combined ~66/hr ≈ 7% ✅
- Congress.gov (5,000/hr): 2-3 calls/day (daily sync) ✅

---

## Known Issues & Limitations

- **Fallback path grades on small donors only.** Members with no PAC details
  and no usable donor analysis (e.g. just re-fetched under a corrected
  identity) are scored on their small-donor share alone, ignoring itemized
  money — 4 members read exactly 0% on 2026-09-27 this way. They move to the
  full calculation as Phase 2 and the itemized collection reach them.
- **D1 is missing transactions (#43).** A failed D1 write is logged and
  skipped, so collections can complete over holes; one member's 23,087
  campaign transactions are absent. Grades don't use D1; the FARA join does.
  Fix planned in the issue: fail the page on write failure, add D1 counts to
  the completion check, backfill via the person-level re-collection.
- **Large campaigns never finish collecting (#44).** AOC's runs are
  _failing_ (`failCount: 2` on 2026-09-27; dropped at 3). Cause not yet
  confirmed — capture the error first; likely progress-record size and D1
  write volume.

### Non-Issues (Previously Reported, Now Resolved)

1. **Phase 2 PAC Enhancement**: Working correctly, processes members incrementally
2. **Tier Calculation**: Enhanced algorithm working with dynamic trust anchor
3. **Bernie/Pelosi Missing**: Added to dataset, concentration analysis complete

### Actual Limitations

1. **Itemized analysis freshness**: snapshots are collected once and never
   refreshed within a cycle. Early-cycle collections understate donor counts.
   The July 2026 reliability check stops junk snapshots from distorting tiers,
   but a periodic re-analysis policy is still an open TODO.
2. **Raw `itemized_transactions` are duplicated for 28 early-collection
   members** (incl. Sanders, Pelosi): January 2026 collection restarts
   re-wrote pages and the table has no dedup key (FEC transaction IDs were
   not stored). Their `donor_aggregates` rows were deliberately deleted —
   KV analyses remain authoritative for them. Fix requires storing the FEC
   `sub_id` per transaction and re-collecting. (The broader D1 mirror
   failure was fixed and backfilled 2026-07-12, see below.)
3. ~~`/api/members` performs ~537 KV reads per request~~ **Resolved
   2026-07-12**: concentration metrics are merged into `members:all` by
   `performTierRecalculation` (runs after every cron batch), so the endpoint
   costs 3 KV reads and sends `Cache-Control: public, max-age=300`. Edge
   caching would additionally require a custom domain (Cache API is inert on
   workers.dev). N/A members merge automatically once Phase 1 gives them
   financial data.

---

## Deployment Information

### Active Workers

1. **taskforce-purple-api** (data-pipeline.js)
   - URL: https://taskforce-purple-api.dev-a4b.workers.dev
   - Version: b1ed848c (2026-01-17)
   - Cron: _/20 _ \* \* \* (every 20 minutes)

2. **taskforce-purple-itemized-analysis** (itemized-analysis.js)
   - URL: https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev
   - Version: 5e9c05e2 (2026-01-17)
   - Cron: _/20 _ \* \* \* (every 20 minutes)

3. **taskforce-purple (frontend)**
   - URL: https://taskforce-purple.pages.dev
   - Deployment: Automatic via GitHub integration

### Environment Variables

Required secrets (set via `wrangler secret put`):

- `CONGRESS_API_KEY`: Congress.gov API key
- `FEC_API_KEY`: OpenFEC API key
- `UPDATE_SECRET`: Authorization for manual API endpoints

---

## Future Enhancements (Not Scheduled)

### Potential Improvements

1. **Increase itemized processing speed**
   - Current: 1 member per 20 minutes
   - Possible: Process 2-3 members per run (requires paid KV tier)
   - Benefit: Reduce 7 days to ~2-3 days (if budget allows)

2. **Real-time voting data integration**
   - Add bipartisan overlap tracker with actual votes
   - Currently just tier rankings based on funding

3. **Historical trend analysis**
   - Track tier changes over multiple election cycles
   - Show funding pattern evolution

4. **State/district filtering**
   - Allow users to filter by geography
   - "Show me my representatives"

---

## Maintenance

### Regular Monitoring

- Check worker logs for errors: `wrangler tail taskforce-purple-api`
- Monitor queue progress: `wrangler kv key get "priority_missing_queue" --namespace-id=... --remote`
- Verify frontend updates: Check https://taskforce-purple.pages.dev

### Expected Behavior

- Priority queue: ✅ Completed (all members have financial data)
- Congress sync: ✅ Ran successfully, removed 3 departed members (537 total now)
- Itemized queue: Should decrease by ~1 member every 20 minutes (518 remaining as of 2026-01-17)

### Error Recovery

All processing is idempotent:

- Failed member updates → retry on next run
- Corrupted progress data → delete and restart from scratch
- API rate limits → worker stops gracefully, resumes next run

---

## Documentation

### Key Files

- `.CLAUDE_CONTEXT.md`: Session log and technical deep-dives
- `README.md`: Public-facing overview with examples
- `DONOR_CONCENTRATION_ANALYSIS.md`: Technical spec for concentration metrics
- `SMART_BATCHING_STRATEGY.md`: Rate limiting and queue design
- `API_STRUCTURES.md`: API endpoint documentation

### Code References

- Tier calculation: `workers/data-pipeline.js:1200-1450`
- Dynamic trust anchor: `workers/data-pipeline.js:1330-1380`
- Congress sync: `workers/data-pipeline.js:4133-4295`
- Itemized analysis: `workers/itemized-analysis.js:220-580`
- Shared constants: `workers/shared-constants.js`

---

---

## Recent Schedule Optimization (2026-01-17)

**Issue**: Hit 50% of KV daily write limit (1,000/day) at 15-minute intervals

**Solution**:

- Adjusted cron schedule from 15 minutes to 20 minutes
- Reduced daily KV writes from 1,000+ to ~790-1,010 (79-101% of limit)
- Improved timeline: 518 members × 20 min = 7 days (vs 11 days at 30-min)
- Deleted 116 orphaned transaction chunk keys from early testing

**Trade-off**: Slightly slower processing but stays within free tier limits

---

_This document reflects the current production state as of 2026-01-17 18:00 UTC. All systems operational._
