# Roadmap

**Created**: 2026-07-14. Maintained alongside `IMPLEMENTATION_STATUS.md`
(which records what HAS happened; this records what SHOULD happen next and
why). Ordering reflects dependencies — Phase A unblocks most of Phase C.

---

## Phase A — Data freshness and integrity

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
- **C2. Leadership PAC / JFC visibility (#32)** — funding-side, goes INTO
  tier math. Gate any threshold change behind a full-Congress before/after
  simulation (pattern from the July 2026 tier fix).
- **C3. STOCK Act trading composite (#31)** — needs committee data (#18)
  and **historical tier tracking** (new: store tier snapshots per recalc;
  design the KV/D1 shape against write budget before starting).
- **C4. FARA cross-reference (#34)** — cheap once A1/A2 give clean
  per-member transactions; FARA registry is a small dataset, matching is
  SQL joins in D1.
- **C5. Supporting enhancements**: #18 bio/committee data (prerequisite
  for C3's sector-overlap stat), #21 PAC color coding, #1 voting data.

---

## Phase D — Before public consumption (deliberately parked; owner's call)

Do these together in one sitting when the project is ready for an
audience. Do not do piecemeal (see CLAUDE.md gotchas — don't re-litigate).

1. Rotate both api.data.gov keys and `UPDATE_SECRET`
2. Remove hardcoded fallbacks in the workers (#16) — keys AND the
   `UPDATE_SECRET ||` fallbacks on five admin endpoints
3. **Add auth to the itemized worker's `/analyze` endpoint** (currently
   unauthenticated — anyone can burn cron budget)
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
