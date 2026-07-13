# CLAUDE.md

Task Force Purple: rates all 537 members of Congress (S–F tiers) by campaign
funding integrity, using Congress.gov and OpenFEC data. **This repo is
public** — never commit keys, tokens, or the update secret. Local secrets
live in `API_KEYS.md` and `.claude-reference.md` (both gitignored).

## Start here

1. `IMPLEMENTATION_STATUS.md` — current system state, dated change log,
   known limitations. Read this first; it is kept accurate.
2. `GRASSROOTS_CALCULATION_GUIDE.md` — the tier algorithm as deployed.
3. `DATABASE_REFERENCE.md` — every KV key and D1 table, with query commands.
4. `API_STRUCTURES.md` — worker endpoints (secrets shown as `$PLACEHOLDER`).

Docs marked "historical" or "superseded" (`taskforce-purple.md` spec,
prototype warnings in `DONOR_CONCENTRATION_ANALYSIS.md`) describe abandoned
designs — don't code against them.

## Architecture

```
Congress.gov API ──> data-pipeline worker ──> KV members:all ──> React frontend
OpenFEC API ───────> (cron */20, phase queues)      ^            (Cloudflare Pages,
                                                    |             auto-deploys on
OpenFEC Schedule A ─> itemized-analysis worker ─────┘             push to main)
                      (cron */20, one member/run,
                       KV itemized_analysis_v2:* + D1 mirror)
```

- **KV is the source of truth** for tiers. D1 (`taskforce-purple-donors`) is
  an analytical mirror of raw transactions/aggregates — currently incomplete
  (see IMPLEMENTATION_STATUS known limitations).
- All tier math lives in `workers/tier-calculation.js` as pure functions with
  unit tests. Never reimplement tier logic inline in the pipeline.
- FEC election cycles are named by the even END year (2025 → cycle 2026).
  Use `cycleForYear()` from tier-calculation.js; don't hand-roll it.

## Commands

```bash
npm test          # vitest - tier math unit tests; run before touching tier logic
npm run lint      # eslint (husky + lint-staged also runs on commit)
npm run build     # vite frontend build

# Deploy workers (needs wrangler auth: `npx wrangler login` or CLOUDFLARE_API_TOKEN)
npx wrangler deploy                                            # data-pipeline
cd workers && npx wrangler deploy --config wrangler-itemized-analysis.toml

# Trigger tier recalculation after deploying tier-math changes
curl -X POST "https://taskforce-purple-api.dev-a4b.workers.dev/api/recalculate-tiers" \
  -H "Authorization: Bearer $UPDATE_SECRET"
```

Frontend deploys automatically when main is pushed to GitHub (Pages
integration) — there is no manual frontend deploy step.

## Constraints and gotchas

- **Cloudflare free tier**: ~1,000 KV writes/day total across both workers is
  the binding constraint; that's why crons are 20-minute and process one
  member per run. Don't add per-run KV writes casually.
- **D1 bound-parameter limit**: batch inserts at ~10 rows/statement (see the
  transactions insert in itemized-analysis.js). Larger batches fail silently
  if wrapped in catch blocks — this already bit us once.
- Worker secrets (`CONGRESS_API_KEY`, `FEC_API_KEY`, `UPDATE_SECRET`) are set
  via `wrangler secret put`. Hardcoded fallbacks still exist in the workers;
  removing them plus rotating keys is deliberately deferred until the project
  goes public-facing (owner's call — don't re-litigate, don't add new ones).
- Queue processing is designed to never let one failing member block a queue
  head: failures defer to the end with a retry budget. Preserve this pattern.
- `fec_mapping_{bioguideId}` KV keys cache FEC candidate matches and are
  trusted forever. A wrong cached match pins a member to the wrong candidate
  (and their zeros) until cleared via `/api/clear-fec-mapping?bioguideId=X`.
  If a member has implausible zeros, suspect this cache first.
- `.claude/settings.local.json` is local-only and gitignored — never commit.

## Conventions

- Public-facing text: extremely plain English ("explain like talking to your
  neighbor"), apolitical, no politician names in UI examples.
- Update `IMPLEMENTATION_STATUS.md` with a dated entry for any significant
  fix or behavior change — it is the project's memory.
