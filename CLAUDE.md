# CLAUDE.md

Task Force Purple: rates all 537 members of Congress (S–F tiers) by campaign
funding integrity, using Congress.gov and OpenFEC data. **This repo is
public** — never commit keys, tokens, or the update secret. Local secrets
live in `API_KEYS.md` and `.claude-reference.md` (both gitignored).

## Start here

**The old Worker crons and the hourly health workflow stay off (owner's
decision, 2026-10-03).** Work runs in GitHub Actions: the refresh job
(started by hand or by its own previous run of a pass), and the races job
(23 and 27 October 2026, then it switches itself off). Don't add clocks.

0. `REBUILD_SPEC.md` — the APPROVED (2026-10-03) rebuild: all FEC work in
   a filing-calendar-triggered GitHub Actions job; Workers only serve. Where
   it differs from the description below of the current system, the spec
   is the target. Don't patch the old collection/storage paths.
1. `IMPLEMENTATION_STATUS.md` — current system state, dated change log,
   known limitations. Read this first; it is kept accurate.
2. `RUNBOOK.md` — self-serve health/log/progress checks from a terminal.
   The owner uses this to verify the system without an AI in the loop;
   keep its commands working when changing endpoints or keys.
3. `ROADMAP.md` — what should happen next, with designs, costs, and
   dependencies. Phase D (security) is deliberately parked — owner's call.
4. `GRASSROOTS_CALCULATION_GUIDE.md` — the tier algorithm as deployed.
5. `DATABASE_REFERENCE.md` — every KV key and D1 table, with query commands.
6. `API_STRUCTURES.md` — worker endpoints (secrets shown as `$PLACEHOLDER`).

Docs marked "historical" or "superseded" (`taskforce-purple.md` spec,
prototype warnings in `DONOR_CONCENTRATION_ANALYSIS.md`) describe abandoned
designs — don't code against them.

## Architecture

```
FEC bulk file + OpenFEC API ─> refresh job (GitHub Actions,     ─> D1 tfp-results
                               scripts/refresh/, Node + DuckDB)     (results, history,
                                                                    gap-fill records)
KV member:{id} + members:list ─> API worker (workers/data-pipeline.js,
                                 read-only serving + admin)  ─> React frontend
                                                                (Cloudflare Pages,
                                                                 auto-deploys on
                                                                 push to main)
```

Since 2026-10-05 (Stage 3) the refresh job publishes grades: it rewrites
`members:list` once per batch, only on change, and member pages read their
detail from D1 `tfp-results`. The itemized worker is retired: a stub
answering 410 (`workers/itemized-retired.js`).

- **Storage:** KV holds `members:list` (the published grades), `member:{id}`
  (each member's stored record) and `races:list`. D1 `tfp-results` holds
  results, history, the record check, fetched FEC records (Brotli-packed)
  and race candidates. The FEC bulk file is the full donation record. The
  old `members:all`, `itemized_*` keys and `taskforce-purple-donors` are
  legacy and no longer written.
- All tier math lives in `workers/tier-calculation.js` as pure functions with
  unit tests. Never reimplement tier logic inline in the pipeline.
- FEC election cycles are named by the even END year (2025 → cycle 2026).
  Use `cycleForYear()` from tier-calculation.js; don't hand-roll it.

## Commands

```bash
npm test          # vitest - tier math unit tests; run before touching tier logic
npm run lint      # eslint (husky + lint-staged also runs on commit)
npm run build     # vite frontend build

# Deploy the API worker (needs wrangler auth: `npx wrangler login`).
# wrangler.toml is gitignored (local only): KV MEMBER_DATA + D1 RESULTS_DB
npx wrangler deploy

# Refresh job: GitHub Actions → Refresh (workflow_dispatch), or locally
node scripts/refresh/run.mjs --members W000788 --dry-run

# Re-grade everyone after changing tier maths (simulate first: CLAUDE.md
# settled decisions); grades publish to the site at the end of each batch
gh workflow run refresh.yml -f grade_only=true -f dry_run=false
node scripts/refresh/publish.mjs --dry-run      # what publishing would change
```

Frontend deploys automatically when main is pushed to GitHub (Pages
integration) — there is no manual frontend deploy step. The site (`src/`,
redesigned 2026-10-07) has no UI framework: `src/styles/app.css` holds the
design tokens, `src/lib/grades.js` everything said about a grade. The
district lookup files in `public/geo/` are built once from the Census
Bureau's (`node scripts/geo/build-geo.mjs <folder>`, inputs listed in the
script); rebuild only when district lines change.

## Settled decisions — do not re-derive

The owner has spent months settling these. Sessions that "rediscovered" and
redesigned them wasted days and, twice, proposed breaking them. Build on them.

- **Ballroom principle (settled Jan 2026).** Itemized (>$200) money counts as
  _individual support_. It is penalised only when the donor base is
  _concentrated_ (trust anchor from donor concentration). Never redesign
  scoring as "itemized = bad" — that drops AOC from S (simulated 2026-09-26).
- **The person is the unit (agreed 2026-09-26, #41/#32).** A member's money
  is everything raised across their campaign(s), joint fundraising funds and
  leadership PACs, counted once. Scoring only the campaign committee grades
  some members on under a third of their money.
- **Joint-fund owners (agreed 2026-09-26, kept 2026-10-04).** A joint fund's
  donors count in full toward the concentration test of the member it
  mainly exists for: registered under them, or the member its payments
  mostly went to, adding up all of a member's committees as one person
  (party committees left out). An even split (top two within 1%) is shared:
  nobody's own. The owner chose owners over sharing donors out pro rata: a
  six-figure cheque to a fund with a politician's name on it buys access to
  that politician wherever the money ends up. `fundOwner` in
  `workers/person-funding.js`.
- **Grade first, confirm after (owner, 2026-10-04).** Every member is graded
  from the FEC's bulk files straight away (refresh `--grade-only`). The
  record-by-record check runs behind it and confirms each grade or shifts
  it, with the change kept in history. A grade not yet checked carries
  `evidenceChecked: false` and a plain note on the site. This replaced
  "Grade pending", which was decided before the bulk file was found.
- **Identity is looked up, never inferred** (`workers/fec-crosswalk.js`). No
  surname search anywhere — it tied 35 members to other people.
- **No grade on figures we can't reconcile to source** — ringfence instead
  (DISPUTED / UNVERIFIED). Simulate every scoring change across all members,
  with named reference members, before deploying.
- **Free tier only.** Never propose paid plans.
- **Work only when the data can have changed.** Campaign money changes
  only when committees file FEC reports, mostly quarterly. Refreshes of totals,
  donors and grades are triggered by the FEC filing calendar or by an
  explicit event (new member, corrected identity, scoring change, failed
  slice). Never by a clock: no weekly, monthly, hourly or "rolling" re-checks
  of stored statistics, and no crons left running for finished work.
  Monitoring the system itself (`/health`) is the exception. See
  REBUILD_SPEC.md §4.13.
- **Lean, targeted updates — always.** Change only the record that changed,
  and only if its value actually differs. Never read-modify-write a whole
  dataset to update one member, and never redo work (re-grading, re-writing)
  for members whose inputs did not change. `members:all` as one 3.5 MB KV
  value, rewritten every run and re-graded in full every run, got the workers
  killed by Cloudflare for hours most days (#46); it was never flagged to the
  owner, who would not have allowed it. If a design needs a whole-dataset
  write, say so and get the owner's approval first.

## Constraints and gotchas

- **Cloudflare free tier**: 1,000 KV writes/day per account (REST API writes
  count too) is the binding constraint. Write only on a diff
  (`MemberWriter`, `kvPut` after comparing). Don't add KV writes casually.
- **D1 read limit: 5M rows read a day, per account.** Over it, D1 refuses
  reads on every database, the owner's other projects included, until
  midnight UTC. On 2026-10-05 an unindexed lookup I wrote read 18.8M rows and
  did exactly that. **Every D1 lookup must use an index** (check with
  `EXPLAIN QUERY PLAN`); the refresh job meters rows read and stops at 3M.
  `node scripts/verify/d1-usage.mjs` shows usage by database.
- **D1 database size: 500 MB each.** Over it, D1 refuses every write to that
  database. On 2026-10-05 `gap_records` (one uncompressed FEC record per
  row) reached it and the job wrote 275k rows in a day doing so. Fetched
  records are now stored full but Brotli-packed per committee
  (`gap_packs`, `scripts/refresh/lib/gap-store.mjs`): 438 MB became 7.6 MB.
  Never store one row per donation in D1. Health alerts at 400 MB.
- **D1 write budget**: the free tier's 100k rows-written/day is hard-enforced
  and shared with the owner's other projects on the account. The refresh job
  charges D1's own `rows_written` figures to `d1_write_budget` in
  `tfp-results` and won't start above its cap. **Every D1 write must go
  through `cf.d1()` in `scripts/refresh/lib/cloudflare.mjs`**, which counts
  them; an uncounted path silently reopens the hole.
- **FEC rate limit: 120 calls a minute** for our key, upgraded by the FEC on
  2026-10-07 (its `X-RateLimit-Limit` header reads 120). Before that it was
  1,000 an hour. The jobs pace themselves (`FEC_MIN_INTERVAL_MS`): the check
  at about 86 a minute, grading and races at 30, so together they stay
  under 120.
- **D1 bound-parameter limit**: batch inserts at ~10 rows/statement (100
  bound parameters per statement). Larger batches fail, silently if wrapped
  in catch blocks — this already bit us once.
- Prefer `INSERT ... ON CONFLICT DO UPDATE ... WHERE <changed>` over
  `INSERT OR REPLACE`: an unchanged row then costs zero row-writes instead of
  two. Never write a row just to restate its current value.
- **Credentials live only in Cloudflare Worker secrets and GitHub secrets** —
  `FEC_API_KEY`, `CONGRESS_API_KEY`, `UPDATE_SECRET` on the API worker;
  `FEC_API_KEY` and `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets for the
  refresh job. The retired itemized worker holds none. Code reads them with
  `requireSecret()` (or the job's env) and fails loudly if one is missing.
  **Never write a key, token or password into code** — the repo is public.
  Until 2026-09-27 an api.data.gov key and the admin `UPDATE_SECRET` sat
  hardcoded in the workers for a year (written by Claude);
  both were replaced and the fallbacks removed. To rotate again:
  `bash scripts/rotate-secrets.sh` (the owner pastes the key; Claude does not
  handle credential values). Current values are in the gitignored API_KEYS.md.
- No queues and no strikes in the target design: a failing member never
  blocks others, is never dropped, and retries on the daily calendar check
  with an alert (REBUILD_SPEC §5, §8).
- `fec_mapping_{bioguideId}` KV keys are legacy: the old pipeline's cached
  FEC matches. Grading no longer reads them; identity comes only from the
  crosswalk. A member with implausible figures: check their crosswalk entry
  (`workers/fec-crosswalk.js`), then re-grade them (RUNBOOK §8).
- **Alerts:** `workers/health.js` (served at the API worker's `/api/health`).
  `scripts/health-alert.sh` turns it into a `system-alert` GitHub issue for
  the owner, each problem with a proposed fix; it runs at the end of every
  refresh job (the hourly `health-alert.yml` stays off, REBUILD_SPEC §8).
  When you add a way for the system to fail quietly, add a check there — a
  failure nobody is told about is how AOC sat stuck for three months.
- `.claude/settings.local.json` is local-only and gitignored — never commit.

## Conventions

- Public-facing text: extremely plain English ("explain like talking to your
  neighbor"), apolitical, no politician names in UI examples.
- Update `IMPLEMENTATION_STATUS.md` with a dated entry for any significant
  fix or behavior change — it is the project's memory.
