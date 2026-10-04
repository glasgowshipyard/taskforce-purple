# Runbook — check everything yourself from a terminal

Every command here is copy-pasteable from the repo root. Secrets are shown
as `$UPDATE_SECRET` etc. — real values live in `API_KEYS.md` (gitignored).
Prereq for the `wrangler`/`gh` commands: `npx wrangler login` once, and the
GitHub CLI authenticated. The `curl`/`jq` ones need nothing.

The point of this doc: nothing about this system's health should require
asking an AI. If a command here can't answer your question, that's a gap —
add the command that can.

---

## 1. The 30-second health check

```bash
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{members: (.members|length), tiers: (.members | group_by(.tier) | map({(.[0].tier): length}) | add), noData: ([.members[] | select(.totalRaised == 0)] | length), lastUpdated}'
```

Healthy looks like: 537 members, single-digit-to-~15 `noData` (non-filing
delegates), a `lastUpdated` within the last day, and a tier spread that
isn't 60%+ in one bucket. If `S` contains names that make you squint, see §5.

## 2. Live worker status

```bash
curl -s "https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev/status" | jq .
```

Shows the donor-analysis refresh: total members, analyses stored, queue
remaining, who's next. Queue shrinks by ~3/hour while a pass is running;
an empty queue means everything is fresher than 30 days (scans re-check
every 6h).

```bash
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/status" | jq '{status, progress, tierCounts}'
```

## 3. Watch the workers actually work (live logs)

```bash
npx wrangler tail taskforce-purple-api --format=pretty
```

```bash
npx wrangler tail taskforce-purple-itemized-analysis --format=pretty
```

Leave one running in a terminal; the crons fire every 20 minutes (both
workers). You'll see member-by-member processing, FEC calls, D1 writes,
FARA matches. Ctrl-C to stop. Nothing appearing for 25+ minutes = a cron
is not firing → check deploy status (§7).

## 4. Progress and coverage

```bash
# How much of Congress has conduit (bundling) data and FARA data
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{withConduits: ([.members[] | select((.conduitCount // 0) > 0)] | length), withFara: ([.members[] | select(.faraEmployerTotal != null and .faraEmployerTotal > 0)] | length), withNakamoto: ([.members[] | select(.nakamotoCoefficient != null)] | length)}'
```

```bash
# Financial-refresh queue (Phase 1): members awaiting (re-)fetch
npx wrangler kv key get "processing_queue_phase1" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'length'
```

```bash
# Donor-analysis queue: who is waiting, how many strikes, and why/when the
# last one failed (dropped at 3 strikes; lastError/lastFailedAt recorded
# from 2026-09-27 on - older strikes have no reason on record)
npx wrangler kv key get "itemized_processing_queue" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq -r '.[] | [.name, (.failCount // 0), (.lastFailedAt // "-"), (.lastError // "-")] | @tsv'
```

```bash
# Any one member's full record (the list carries only what its rows show;
# the full record is per member since Stage 1). Find the ID, then fetch it:
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq -r '.members[] | select(.name | test("Cramer")) | .bioguideId'
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/member-detail?bioguideId=C001096" | jq '.member'
```

## 5. Data-quality invariants (the Cramer check)

Individual donations are a subset of total receipts, so these must be 0:

```bash
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{impossibleMoney: ([.members[] | select(.totalRaised > 0 and .largeDonorDonations != null and (.grassrootsDonations + .largeDonorDonations) > (.totalRaised * 1.02))] | length), scoresOver100: ([.members[] | select(.individualFundingPercent > 100)] | length), negativeScores: ([.members[] | select(.individualFundingPercent < 0)] | length)}'
```

Nonzero = data corruption (see IMPLEMENTATION_STATUS 2026-07-18 post-mortem
for the last occurrence and the repair procedure: re-fetch affected members
via `/api/process-candidate`, then recalculate).

### Identity: is every member's money actually theirs? (added 2026-09-26)

```bash
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{verified: ([.members[] | select(.fecIdentityVerified == true)] | length), unverified: ([.members[] | select(.fecIdentityVerified == false)] | length), unstamped: ([.members[] | select(has("fecIdentityVerified") | not)] | length), shownAsChecking: ([.members[] | select(.tier == "UNVERIFIED")] | length)}'
```

`unstamped` must be 0. `shownAsChecking` should shrink toward 0 as the
pipeline refetches members under their correct FEC identity (one per Phase 1
run). A member stuck there for days has no FEC record under their crosswalk IDs
— check `workers/fec-crosswalk.js` and regenerate it
(`node scripts/build-fec-crosswalk.mjs`) if Congress membership changed. See
IMPLEMENTATION_STATUS 2026-09-26 for why identity is never inferred from names.

### Money trail and grade basis (added 2026-09-27, #32)

```bash
# How many members are graded on all their committees vs campaign only
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '[.members[].gradeBasis] | group_by(.) | map({(.[0] // "none"): length}) | add'
```

`all-committees` grows as pooled collections complete and reconcile.
`campaign-committee-rechecking` = collected but did not match the FEC to the
dollar; a few is normal (a filing landed mid-collection), a lot is a defect.

```bash
# One member's committees, what each raised, and where joint-fund money went
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/member-detail?bioguideId=P000197" | jq '{personLevel, moneyTrail: (.moneyTrail | if . then {raisedInName, committees: [.committees[] | {name, role, raised}]} else null end)}'
```

`moneyTrail: null` = the hourly discovery sweep hasn't reached them yet.

**Check any member's figures against the FEC yourself** (read-only, ~1 h for
a big member, resumable):

```bash
caffeinate -i npm run trial:pool -- P000197
```

Result: `scripts/trials/output/<id>/summary.md` — says first whether every
count and dollar reconciles.

## 6. Budgets (free-tier meters)

```bash
# D1 last-24h usage. Free caps: 5M rows read, 100k rows written per day.
# HARD-ENFORCED since ~2026-09-01 - exceeding either returns errors until
# 00:00 UTC. Treat any reading over cap as a defect, not a warning.
npx wrangler d1 info taskforce-purple-donors
```

**The write budget (added 2026-09-09).** The pipeline now meters itself and
stands down rather than breaching the write cap. What it thinks it has spent:

```bash
npx wrangler d1 execute taskforce-purple-donors --remote \
  --command "SELECT * FROM d1_write_budget;"
```

One row, today's UTC date, against a self-imposed budget of 85,000 (15% under
Cloudflare's 100k). At 00:00 UTC the day rolls and the row is replaced.

```bash
# What the worker itself reports - the same number, from its own mouth.
# This runs one real collection pass (FEC requests + D1 writes), so it needs
# the admin token; without it you get 401 and nothing runs.
curl -s "https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev/analyze" \
  -H "Authorization: Bearer $UPDATE_SECRET" | jq '.d1Budget // {budgetExhausted, budget}'
```

Reading `"budgetExhausted": true` is the system **working**, not failing: it
means collection paused itself and resumes at midnight UTC. The member stays
at the queue head and loses nothing but a day of freshness.

Two numbers that should stay close: `rows_written_24h` from `d1 info` and
`rows_written` from the ledger. If the ledger reads much _lower_, something is
writing to D1 outside the metered path — find it, because that is exactly how
the cap got breached three days running in September 2026. The per-row costs
the meter uses are measured, not derived (see `workers/d1-write-budget.js`);
re-measure with `--file=` on a scratch statement, which prints `rows_written`.

If `rows_read` spikes, suspect a query using the wrong index. `EXPLAIN QUERY
PLAN` in front of any statement shows which one it picked, and costs nothing:

```bash
npx wrangler d1 execute taskforce-purple-donors --remote \
  --command "EXPLAIN QUERY PLAN DELETE FROM itemized_transactions WHERE bioguide_id='S000033' AND cycle=2026;"
```

Wanted: `USING INDEX idx_bioguide`. An index on a low-cardinality column
(`cycle` has two values) means a full scan — that cost 18.8M reads a day
until it was dropped on 2026-09-02.

KV daily ops (1,000 writes/day is the binding cap; steady state ~350–600):
the Cloudflare dashboard → Workers & Pages → KV → namespace → Metrics.
Cloudflare emails at 50% of writes — at our cruising altitude that email
is normal background noise, not an incident.

### Storage health since Stage 1 (CPU kills and KV writes)

```bash
# Cloudflare's own figures since the Stage 1 migration: CPU-limit kills on
# the API worker (must be 0) and KV writes per day (must stay below the
# pre-pause 290-500). Read-only; uses your wrangler login.
node scripts/verify/stage1-exit-check.mjs
```

## 7. Deploys and CI

```bash
# Did the Pages (frontend) build actually succeed? (It failed silently for
# 6 months once - never trust "auto-deploys" without checking)
npx wrangler pages deployment list --project-name=taskforce-purple | head -8
```

```bash
# Which worker versions are live
npx wrangler deployments list 2>/dev/null | head -8
```

```bash
# CI on recent pushes
gh run list --limit 5
```

```bash
# Is the live site serving the newest bundle? (compare hash to dist/ after a local build)
curl -s "https://taskforce-purple.pages.dev" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

## 8. Manual interventions (auth required)

```bash
# Re-grade every member (safe, idempotent; writes only members that change).
# The API does 10 members per call to stay inside Cloudflare's 10 ms CPU
# limit; this script walks every slice. UPDATE_SECRET is in API_KEYS.md.
UPDATE_SECRET=... bash scripts/recalculate-all.sh
```

```bash
# Re-fetch one member end-to-end (use after fixing bad data). Needs the
# secret: until 2026-10-03 this endpoint wrongly accepted anyone.
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/process-candidate?bioguideId=C001096" -H "Authorization: Bearer $UPDATE_SECRET"
```

```bash
# Clear a member's cached FEC candidate match (wrong-twin fix; the member
# re-searches on next processing)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/clear-fec-mapping?bioguideId=C001096" -H "Authorization: Bearer $UPDATE_SECRET"
```

## 9. Known failure signatures

| Symptom                                   | Likely cause                                                       | First move                                                    |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Member with implausible zeros             | Stale/wrong `fec_mapping_*` cache                                  | Clear mapping (§8), reprocess                                 |
| Score >100% or itemized > total           | Cross-cycle record corruption                                      | §5 check, reprocess affected, recalc                          |
| Card data much older than analysis data   | Financial refresh stalled                                          | §4 queue length; tail the api worker                          |
| Queue frozen on same member for hours     | Usually the daily D1 budget (§6); else failure-defer not advancing | §6 ledger; queue command in §4 (strikes + last error)         |
| Frontend changes not visible              | Pages build failed                                                 | §7 deployment list; check the build log link it prints        |
| Everything frozen, no logs at all         | Cloudflare incident                                                | `curl -s https://www.cloudflarestatus.com/api/v2/status.json` |
| Collection stopped mid-day, no errors     | D1 write budget spent (by design)                                  | §6 ledger; resumes 00:00 UTC                                  |
| `d1 info` writes >> ledger `rows_written` | An unmetered D1 write path                                         | §6; every D1 write must charge the meter                      |

## 10. Alerts (automatic — you get a GitHub notification)

Every hour (at :25) the **Health alert** GitHub Action reads the live
verdict and, if anything is wrong, opens an issue labelled `system-alert`
that @mentions you. It comments again only if the set of problems changes,
and closes the issue itself once every check passes. Delivery is by
GitHub's own notifications (email and/or the mobile app, depending on
your GitHub notification settings).

What it checks (`workers/health.js`, with tests):

| Alert                  | Means                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `pipeline-not-running` | Main data worker hasn't run for 60+ min (should be every 20)                                 |
| `itemized-not-running` | Donor-analysis worker hasn't run for 90+ min (should be hourly)                              |
| `collection-stuck`     | The member at the head of the donor queue hasn't gained a page in 30 h; shows last FEC error |
| `members-failing`      | A member got a strike in the last 24 h, with the reason (3 strikes = dropped)                |
| `members-dropped`      | A member was dropped from donor analysis in the last 48 h, with the reason                   |
| `collection-mismatch`  | A finished donor collection doesn't match the FEC's own count, so it's kept off the grade    |
| `d1-over-budget`       | 95k+ D1 row-writes today — something is writing without charging the meter                   |
| `d1-unreadable`        | The D1 write ledger can't be read                                                            |
| `health-unreachable`   | The health page itself didn't answer — the worker may be down                                |

```bash
# The raw verdict, any time
curl -s "https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev/health" | jq .
```

```bash
# Run the check now instead of waiting for :25
gh workflow run health-alert.yml
```

```bash
# See what it would do without touching GitHub
DRY_RUN=1 bash scripts/health-alert.sh
```

Caveats: GitHub can start scheduled jobs late at busy times, and it
pauses scheduled workflows after 60 days without a commit to the repo (it
emails a warning first; re-enable in the Actions tab).

## Related docs

- `IMPLEMENTATION_STATUS.md` — what's true now + dated history of every fix
- `DATABASE_REFERENCE.md` — every KV key and D1 table with query commands
- `ROADMAP.md` — what's next and why
- `API_STRUCTURES.md` — all worker endpoints
