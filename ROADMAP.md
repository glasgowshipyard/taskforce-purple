# Roadmap

**Created**: 2026-07-14. Maintained alongside `IMPLEMENTATION_STATUS.md`
(which records what HAS happened; this records what SHOULD happen next and
why). Ordering reflects dependencies — Phase A unblocks most of Phase C.

---

## Phase A — Data freshness and integrity

> **✅ SHIPPED 2026-07-14** (both A1 and A2; see IMPLEMENTATION_STATUS for
> the as-built record, including one deviation: staleness scans throttled
> to one per 6h, and a D1 write-volume watch item for the first full pass).

### A1. Analysis refresh policy (next up — detailed design)

**Problem**: itemized analyses are collected once and frozen. Consequences:
early-cycle snapshots distort trust anchors, only post-2026-07-12
collections carry conduit data (3/537 at time of writing), one member
(J000294) has a partial collection from a mid-deploy cursor, and 28 members
have duplicated raw transactions in D1 from January restarts.

**Design**:

1. **Queue rebuild** (mirrors the Phase 1 re-queue pattern): when
   `itemized_processing_queue` is empty at the start of a run, rebuild it
   from members that have `committeeInfo.id` and whose
   `itemized_analysis_v2:{id}` is missing OR older than **30 days**
   (`collectionCompletedAt`), sorted oldest-first. If nothing qualifies,
   leave the queue empty (idle run costs 1 KV read).
2. **Delete-before-recollect**: when a fresh collection starts for member X
   cycle Y, first `DELETE FROM itemized_transactions WHERE bioguide_id=X
AND cycle=Y` and the same for `donor_aggregates`. This prevents raw-row
   duplication (the January bug) and **automatically heals the 28
   currently-duplicated members** as they come up for refresh. Largest
   member ≈ 30k row-deletes — inside D1's daily budget at one member a time.
3. **Faster cron runs**: `PAGES_PER_RUN` was sized for the 30-second HTTP
   limit, but **cron-triggered runs get 15 minutes**. Pass pages-per-run
   from the handler: 20 for `scheduled()`, 5 for HTTP `/analyze`. Full-
   Congress pass drops from ~50 days to **~2 weeks**.
4. Preserve the failure-defer queue pattern and the existing completion
   flow (aggregates → metadata → KV analysis → progress cleanup).
5. While in the worker: make `/status` honest (compute totals from the
   member list, drop the hardcoded 537 and the fake Bernie/Pelosi
   "recently completed" list).

**Budget** (verified against current usage):

- KV writes: unchanged — working runs cost the same 2 writes/run already
  counted in the ~50% budget headroom; refresh converts idle runs to
  working runs, spending nothing new
- FEC: 20 pages + reconcile ≈ 22 calls/run × 3 runs/hr ≈ 66/hr itemized
  - ~45/hr pipeline ≈ **11% of the 1,000/hr limit**
- D1: delete+reinsert of one member per collection start, well under
  100k rows/day
- Dev effort: ~half a day (all patterns already proven in production)

**Acceptance**: full pass completes in ≤3 weeks; every analysis carries
conduit fields; J000294 partial replaced; 28-member D1 caveat retired
(verify with the KV-vs-D1 reconciliation query from IMPLEMENTATION_STATUS
2026-07-12); no budget alarms in `wrangler d1 info` / KV metrics.

### A2. Store FEC `sub_id` per transaction (after A1)

Add a `sub_id` column + unique index to `itemized_transactions`, insert
with upsert. Not required once A1's delete-before-recollect exists, but
enables **incremental top-ups** (fetch only transactions newer than the
last collected date) instead of full re-collections — a large FEC-budget
saving for a future faster refresh cadence. Small schema migration.

---

## Phase B — Small correctness and hygiene items

- **B1. Issue #5 one-liner**: `handleProcessCandidate` passes the member
  object where `fetchPACDetails(committeeId, env)` expects a committee ID
  string (logs show `[object Object]` → FEC 422). Diagnosed 2026-07-13.
- **B2. Issue hygiene**: close #19 (tier fixed, documented), #20 (shipped),
  #29 (once N/A count stabilizes at the delegate floor), #12 (Workers
  crons are config-time; close with explanation or re-scope).
- **B3. Dependabot queue**: close #26 (vite — superseded 2026-07-14);
  merge #22/#23 (actions bumps; also silences Node-20 deprecation
  warnings); schedule #25/#27 (React 19), #30 (eslint 9), #28
  (lucide 0.263→0.562 — check icon renames against the member-card icons)
  as one tested batch.

---

## Phase C — Feature roadmap (scoped in issues)

Owner's direction: the tier is a purity test — composite score, all
funding routes visible, behavior included. Same rules for all 537.

- **C1. Network attribution completion (#33)** — depends on A1 for full
  conduit coverage. Remaining slices: `connected_organization_name`
  lookups for generically-named PACs, sector taxonomy, lucide sector
  icons on member cards (design note on the issue).
- **C2. Leadership PAC / JFC visibility (#32)** — **IN PROGRESS, top
  priority** (opened 2026-07-12; trial 2026-08-07; stalled until
  2026-09-26). Attribution built and trialled on branch `person-funding`
  (see IMPLEMENTATION_STATUS "In flight"). Remaining, in order: owner
  decision on joint-fund attribution → itemized worker collects donors from
  all of a member's committees → full-Congress simulation together with the
  Step 4 fix (#42) → one deploy.
- **C3. STOCK Act trading composite (#31)** — needs committee data (#18)
  and **historical tier tracking** (new: store tier snapshots per recalc;
  design the KV/D1 shape against write budget before starting).
- **C4. FARA cross-reference (#34)** — cheap once A1/A2 give clean
  per-member transactions; FARA registry is a small dataset, matching is
  SQL joins in D1.
- **C5. Supporting enhancements**: #18 bio/committee data (prerequisite
  for C3's sector-overlap stat), #21 PAC color coding, #1 voting data.

---

## Phase E — 2026 races: grade the challengers too (owner's go 2026-10-07; built, live 23 October)

> **Built 2026-10-07** with the four recommendations: the November ballot
> (FEC pre-general filers), provisional grades with the note, a Races tab,
> and third parties if they filed. `scripts/refresh/races.mjs` with
> `.github/workflows/races.yml`, which runs 23 and 27 October and then
> switches itself off. The tab appears once the real field is published.
> Still to come: the record-by-record check for challengers, after the
> members' check finishes.

**Today** the site grades the 539 sitting members only, on the 2026 cycle.
Challengers and open-seat candidates aren't graded, so a voter can't compare
a seat's candidates. Election Day is 3 November 2026.

**The field** (FEC `weball26`, 2026-10-07): about 4,200 House and Senate
candidates have filed. Excluding incumbents:

- about 1,070 have raised $100,000 or more;
- about 500 have raised $500,000 or more;
- 360 races have two or more candidates over $100,000.

Many of these lost primaries.

**Who's on the November ballot.** The FEC's data has no ballot list, but
only general-election candidates file the pre-general report (type 12G,
due 22 October, covering through 14 October). After the 22nd, "filed a
12G" picks out the November field from FEC data alone, with no outside
source.

**How it would work.** Mostly what exists already:

- **Identity:** a challenger has an FEC candidate ID and no Congress
  ID. The identity is the FEC's own, so nothing is inferred (settled
  rule).
- **Grading:** zip discovery and grade-only work from candidate IDs. Each
  candidate is graded exactly as members are: all their committees, the
  same tiers, the same evidence notes.
- **Storage:** a `candidates` results table in `tfp-results`, keyed by FEC
  candidate ID, about 5 MB. One extra KV value (`races:list`), written once
  per publish.
- **Site:** a "Races" view: pick a state and seat and see its candidates
  side by side, grade and money mix, with sitting members linking to their
  profiles. Plain English, no names in UI examples.

**Cost:**

- Grading from the zips: about 150-250 FEC calls and minutes of runtime for
  about 1,000 candidates.
- The record-by-record check for challengers: about 1-2 more days of FEC
  calls: a few hours at our key's 120 calls a minute.
- D1 and KV stay far under the free limits.

**Timing.** Built in a few days. Graded from the zips straight after the 22
October filings, it's live about 10 days before the election. After the
election (post-general reports due 3 December), winners become members in
January, through the crosswalk rebuild and the New Year rule (Stage 3).

**Decisions for the owner:**

1. **Which candidates:** everyone on the November ballot (filed a 12G),
   or everyone over a money threshold (includes primary losers)?
2. **Checked or provisional:** grade challengers from the zips and show
   them as "being double-checked", or also run the record check (1-2
   days)?
3. **Where:** a Races view, or challengers mixed into the main list?
4. **Third-party and independent candidates:** in, if they filed a 12G?

**Depends on:** nothing new, it reuses Stage 2-3 code. It competes for time
with Stage 3's rollover, which must be live before 1 January.

---

## Options on hold (owner's call, not scheduled)

- **Upgraded FEC key: DONE 2026-10-07.** The owner asked and the FEC
  upgraded the same key to 120 calls a minute (was 1,000 an hour). The jobs'
  pacing is raised to match (CLAUDE.md, FEC rate limit).

---

## Phase D — Before public consumption (deliberately parked; owner's call)

Do these together in one sitting when the project is ready for an
audience. Do not do piecemeal (see CLAUDE.md gotchas — don't re-litigate).

1. ~~Rotate api.data.gov key and `UPDATE_SECRET`~~ — **done 2026-09-27**
   (`scripts/rotate-secrets.sh`); the old api.data.gov key could not be
   self-revoked and remains public in history, unused
2. ~~Remove hardcoded fallbacks in the workers (#16)~~ — **done 2026-09-27**
3. ~~Add auth to the itemized worker's `/analyze` endpoint~~ — **done
   2026-09-28** (owner approved doing it ahead of the rest of Phase D)
4. Untrack remaining internal docs; decide whether git history scrubbing
   is worth it post-rotation
5. Route the API through the custom domain (taskforcepurple.com) to get
   edge caching (Cache API is inert on workers.dev)
6. Re-check `.gitleaks.toml` allowlist against reality

---

## Standing habits (from hard experience)

- `npm test` before touching tier math; simulate before/after across all
  537 before deploying scoring changes
- Check `npx wrangler pages deployment list --project-name=taskforce-purple`
  after frontend pushes (builds failed silently for 6 months once)
- If a member has implausible zeros: suspect the `fec_mapping_*` cache
- Dated entry in `IMPLEMENTATION_STATUS.md` for every significant change
