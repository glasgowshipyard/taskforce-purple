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

Healthy looks like: 539 members, a handful of `noData` (non-filing
delegates), and a tier spread that isn't 60%+ in one bucket. `lastUpdated`
moves only when a refresh changes grades (after FEC filing deadlines), not
daily. If `S` contains names that make you squint, see §5.

```bash
# How many grades are checked record by record vs still provisional
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '[.members[].evidenceChecked] | group_by(.) | map({(tostring): length}) | add'
```

## 2. Health and the refresh job

```bash
# The health verdict: problems (each with a proposed fix) and notes
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/health" | jq .
```

`"ok": true` with no problems is healthy. The same verdict raises the
`system-alert` issue (§10).

```bash
# Refresh job runs (GitHub Actions, newest first), then one run's log
gh run list --workflow refresh.yml --limit 5
gh run view RUN_ID --log | tail -40
```

A full pass takes several runs: each stops before GitHub's 6-hour limit
and starts the next run of the same pass itself, until every member is
done. To start a pass, or to continue one whose chain stopped (a D1-budget
stop, or a run that finished nobody):

```bash
gh workflow run refresh.yml -f dry_run=false                    # continue the open pass
gh workflow run refresh.yml -f dry_run=false -f new_round="why"  # start a new pass
```

```bash
# Where the refresh stands: members done/failed this cycle, the reasons for
# failures, and the latest rounds (one round = one full pass)
npx wrangler d1 execute tfp-results --remote --command "SELECT status, COUNT(*) AS n FROM member_progress WHERE cycle = 2026 GROUP BY status"
npx wrangler d1 execute tfp-results --remote --command "SELECT bioguide_id, attempts, last_error FROM member_progress WHERE status = 'failed'"
npx wrangler d1 execute tfp-results --remote --command "SELECT round_id, reason, started_at, finished_at FROM rounds ORDER BY started_at DESC LIMIT 3"
```

```bash
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/status" | jq '{status, progress, tierCounts}'
```

## 3. Watch the workers actually work (live logs)

```bash
npx wrangler tail taskforce-purple-api --format=pretty
```

The API worker only serves the site now (no crons), so the tail shows
requests. The refresh job's work (FEC calls, reconciliation, grades) is in
its GitHub Actions log (§2). The itemized worker is retired: every URL
answers 410.

## 4. Progress and coverage

```bash
# How much of Congress has conduit (bundling) data and FARA data
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{withConduits: ([.members[] | select((.conduitCount // 0) > 0)] | length), withFara: ([.members[] | select(.faraEmployerTotal != null and .faraEmployerTotal > 0)] | length), withNakamoto: ([.members[] | select(.nakamotoCoefficient != null)] | length)}'
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
with a grade-only refresh for them, §8).

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

**D1 by database, from Cloudflare's own figures.** D1's free limits are per
account per day (UTC), shared with the owner's other projects: 5,000,000 rows
read and 100,000 written. Over either, D1 refuses that kind of query on
every database until midnight UTC (5 pm PDT). That happened on 2026-10-05
(an unindexed lookup read 18.8M rows).

```bash
node scripts/verify/d1-usage.mjs        # today and yesterday, by database
```

Each database is also capped at 500 MB, past which D1 refuses its writes
(health: `d1-size-high` at 400 MB). Records fetched from the FEC are stored
Brotli-packed per committee in `gap_packs`. To look at one committee's:

```bash
node scripts/refresh/gap-records.mjs C00857615      # writes C00857615-2026.jsonl
```

**The write budget.** D1's 100k rows-written/day is per account, shared
with the owner's other projects. The refresh job charges D1's own
`rows_written` figures to a ledger and won't start within 20,000 of its
85,000 cap:

```bash
npx wrangler d1 execute tfp-results --remote \
  --command "SELECT * FROM d1_write_budget ORDER BY day DESC LIMIT 3;"
npx wrangler d1 info tfp-results
```

If `d1 info` shows many more writes than the ledger, something wrote to D1
without going through the job's `cf.d1()` — find it, because that is how
the cap was breached three days running in September 2026. The legacy
`taskforce-purple-donors` database is no longer written (the itemized worker
that wrote it is retired).

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

## 8. Manual interventions

Grades come from the refresh job (Stage 3). The old re-grading endpoints
(`/api/recalculate-tiers`, `/api/process-candidate`, `/api/update-member`)
are retired: they re-graded through the old engine.

```bash
# Re-grade members from the FEC's bulk files now (minutes), and publish
gh workflow run refresh.yml -f grade_only=true -f dry_run=false
gh workflow run refresh.yml -f grade_only=true -f dry_run=false -f members=C001096,P000197
```

```bash
# What publishing would change on the site, without writing anything
node scripts/refresh/publish.mjs --dry-run
```

```bash
# Clear a member's cached FEC candidate match (wrong-twin fix)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/clear-fec-mapping?bioguideId=C001096" -H "Authorization: Bearer $UPDATE_SECRET"
```

### The 2026 races

```bash
# What the site's Races tab serves (404 until published)
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/races" | jq '{field, updatedAt, races: (.races | length)}'
# Grade and publish now (normally automatic on 23 and 27 October)
gh workflow run races.yml
gh workflow run races.yml -f dry_run=true -f states=ME
```

## 9. Known failure signatures

| Symptom                                   | Likely cause                                         | First move                                                    |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Member with implausible zeros             | Wrong or missing FEC identity in the crosswalk       | Check `workers/fec-crosswalk.js`; re-grade the member (§8)    |
| Score >100% or itemized > total           | Cross-cycle record corruption                        | §5 check, reprocess affected, recalc                          |
| A refresh run failed or a member failed   | The reason is in the run's log and `member_progress` | §2; the alert issue carries the proposed fix                  |
| Frontend changes not visible              | Pages build failed                                   | §7 deployment list; check the build log link it prints        |
| Everything frozen, no logs at all         | Cloudflare incident                                  | `curl -s https://www.cloudflarestatus.com/api/v2/status.json` |
| Refresh job won't start: "D1 budget"      | D1 write budget nearly spent (by design)             | §6 ledger; run again after 00:00 UTC (17:00 PDT)              |
| `d1 info` writes >> ledger `rows_written` | An uncounted D1 write path                           | §6; every D1 write must go through `cf.d1()`                  |

## 10. Alerts (automatic — you get a GitHub notification)

At the end of every refresh job, `scripts/health-alert.sh` reads the live
verdict (`/api/health`) and, if anything is wrong, opens an issue labelled
`system-alert` that @mentions you. Each problem comes with a proposed fix.
It comments again only if the set of problems changes, and closes the issue
itself once every check passes. Delivery is by GitHub's own notifications
(email and/or the mobile app, depending on your GitHub notification
settings). The hourly Health alert workflow stays off (REBUILD_SPEC §8): the
system only does work when a refresh runs.

What it checks (`workers/health.js`, with tests):

| Alert                   | Means                                                                          |
| ----------------------- | ------------------------------------------------------------------------------ |
| `site-data-missing`     | The site has no member list to serve                                           |
| `site-data-short`       | The member list has fewer than 530 members                                     |
| `refresh-job-failed`    | The refresh job itself failed; the issue links its log                         |
| `refresh-failed`        | The last recorded refresh run failed                                           |
| `refresh-stuck`         | A run started 7+ hours ago and never recorded its end (killed)                 |
| `members-failing`       | Members failed in the refresh, with the reason (they retry; nobody is dropped) |
| `committee-mismatch`    | A committee's records couldn't all be found, so its members stay pending       |
| `d1-over-budget`        | 95k+ D1 row-writes today (the account-wide limit is 100k)                      |
| `d1-size-high`          | The results database is 400 MB+ (D1 refuses its writes at 500 MB)              |
| `d1-reads-high`         | 4M+ D1 rows read today (the account-wide limit is 5M; the job stops at 3M)     |
| `results-db-unreadable` | The refresh job's database can't be read                                       |
| `health-unreachable`    | The health page itself didn't answer — the API worker may be down              |

```bash
# The raw verdict, any time
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/health" | jq .
```

```bash
# See what the alert would do without touching GitHub
DRY_RUN=1 bash scripts/health-alert.sh
```

## Related docs

- `IMPLEMENTATION_STATUS.md` — what's true now + dated history of every fix
- `DATABASE_REFERENCE.md` — every KV key and D1 table with query commands
- `ROADMAP.md` — what's next and why
- `API_STRUCTURES.md` — all worker endpoints
