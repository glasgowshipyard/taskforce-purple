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
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{withConduits: ([.members[] | select(.topConduits != null and (.topConduits|length) > 0)] | length), withFara: ([.members[] | select(.faraEmployerTotal != null and .faraEmployerTotal > 0)] | length), withNakamoto: ([.members[] | select(.nakamotoCoefficient != null)] | length)}'
```

```bash
# Financial-refresh queue (Phase 1): members awaiting (re-)fetch
npx wrangler kv key get "processing_queue_phase1" --namespace-id=8318226115e2423ab5d141adfa5419f9 --remote | jq 'length'
```

```bash
# Any one member's full record
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '.members[] | select(.name | test("Cramer"))'
```

## 5. Data-quality invariants (the Cramer check)

Individual donations are a subset of total receipts, so these must be 0:

```bash
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members" | jq '{impossibleMoney: ([.members[] | select(.totalRaised > 0 and .largeDonorDonations != null and (.grassrootsDonations + .largeDonorDonations) > (.totalRaised * 1.02))] | length), scoresOver100: ([.members[] | select(.individualFundingPercent > 100)] | length), negativeScores: ([.members[] | select(.individualFundingPercent < 0)] | length)}'
```

Nonzero = data corruption (see IMPLEMENTATION_STATUS 2026-07-18 post-mortem
for the last occurrence and the repair procedure: re-fetch affected members
via `/api/process-candidate`, then recalculate).

## 6. Budgets (free-tier meters)

```bash
# D1 last-24h usage (nominal free caps: 5M rows read, 100k written - not
# currently hard-enforced; KV is the one that actually bites)
npx wrangler d1 info taskforce-purple-donors
```

KV daily ops (1,000 writes/day is the binding cap; steady state ~350–600):
the Cloudflare dashboard → Workers & Pages → KV → namespace → Metrics.
Cloudflare emails at 50% of writes — at our cruising altitude that email
is normal background noise, not an incident.

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
# Force full tier recalculation (safe, idempotent)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/recalculate-tiers" -H "Authorization: Bearer $UPDATE_SECRET"
```

```bash
# Re-fetch one member end-to-end (use after fixing bad data)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/process-candidate?bioguideId=C001096" -H "Authorization: Bearer $UPDATE_SECRET"
```

```bash
# Clear a member's cached FEC candidate match (wrong-twin fix; the member
# re-searches on next processing)
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/clear-fec-mapping?bioguideId=C001096" -H "Authorization: Bearer $UPDATE_SECRET"
```

## 9. Known failure signatures

| Symptom                                 | Likely cause                      | First move                                                            |
| --------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Member with implausible zeros           | Stale/wrong `fec_mapping_*` cache | Clear mapping (§8), reprocess                                         |
| Score >100% or itemized > total         | Cross-cycle record corruption     | §5 check, reprocess affected, recalc                                  |
| Card data much older than analysis data | Financial refresh stalled         | §4 queue length; tail the api worker                                  |
| Queue frozen on same member for hours   | Failure-defer not advancing       | Tail the worker; see the queue-stall pattern in IMPLEMENTATION_STATUS |
| Frontend changes not visible            | Pages build failed                | §7 deployment list; check the build log link it prints                |
| Everything frozen, no logs at all       | Cloudflare incident               | `curl -s https://www.cloudflarestatus.com/api/v2/status.json`         |

## Related docs

- `IMPLEMENTATION_STATUS.md` — what's true now + dated history of every fix
- `DATABASE_REFERENCE.md` — every KV key and D1 table with query commands
- `ROADMAP.md` — what's next and why
- `API_STRUCTURES.md` — all worker endpoints
