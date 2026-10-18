# Database reference

Every KV key and D1 table the system uses, and how to read them. Last
checked against the code on 2026-10-18. The writing rules (write only on a
diff, every D1 write counted, every D1 lookup on an index) are in
CLAUDE.md.

## KV namespace `MEMBER_DATA`

| Key                   | What it holds                                                                                      | Written by                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `members:list`        | The site's member list: each member's seat, published grade and list figures (`/api/members`)      | The refresh job's publish step (once per batch, only on change) and the roster update |
| `member:{bioguideId}` | Each member's stored record (name, seat, PAC list, social handles). The page's grade comes from D1 | The roster update (new members, changed seats or parties); admin endpoints            |
| `races:list`          | The 2026 races: everyone on November's ballot, by seat (`/api/races`)                              | The races job (only on change)                                                        |

Legacy keys, frozen and never read for grades: `members:all`,
`itemized_analysis_v2:*`, the old queue and tracking keys, and
`fec_mapping_*` (identity now comes only from `workers/fec-crosswalk.js`).
What they held is in `docs/history/log-2025-26.md`.

```bash
# Read a key (wrangler.toml is local only; needs `npx wrangler login`)
npx wrangler kv key get --binding=MEMBER_DATA --remote "members:list" | jq '.members | length'
npx wrangler kv key get --binding=MEMBER_DATA --remote "member:V000139" | jq '{name, party, state, district}'
# Or through the API, with no login
curl -s "https://taskforce-purple-api.dev-a4b.workers.dev/api/members/V000139" | jq '{name, tier, district}'
```

## D1 database `tfp-results`

ID `f4ad9245-769d-4bb2-b772-c552907e1692`. Schema: `scripts/refresh/schema.sql`
(and `scripts/refresh/migrations/`). Written only by the jobs in GitHub
Actions, through `cf.d1()` in `scripts/refresh/lib/cloudflare.mjs`, which
counts rows; read by the API worker (binding `RESULTS_DB`).

| Table                   | What it holds                                                                                                                                                                                                          | Key                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `results`               | Each member's current result per cycle: pool (committees and money trail), analysis (donors, concentration, conduits, FARA, PACs, donors by state), reconciliation, grade (with FINAL-3's working in `detail`), status | (`bioguide_id`, `cycle`)                       |
| `snapshots`             | Every result that was ever current (history)                                                                                                                                                                           | `id`; index (`bioguide_id`, `cycle`)           |
| `grade_history`         | One row per published grade change                                                                                                                                                                                     | `id`                                           |
| `committees`            | Each committee's record check against the FEC: counts, money, status (`reconciled`, `reconciled-with-note`, `mismatch`), the round that checked it (`races-check` for candidates' committees)                          | (`committee_id`, `cycle`)                      |
| `gap_packs`             | Records fetched from the FEC because the bulk file lacks them: in full, Brotli-packed per committee, up to 5,000 records a pack (`lib/gap-store.mjs`)                                                                  | (`committee_id`, `cycle`, `kind`, `pack`)      |
| `race_candidates`       | General-election candidates who aren't sitting members, graded (pool, analysis, grade, status)                                                                                                                         | (`candidate_id`, `cycle`)                      |
| `member_progress`       | Where each member got to in the current round of the check, and why it failed                                                                                                                                          | (`bioguide_id`, `cycle`)                       |
| `rounds`, `runs`        | The record check's rounds (one full pass each) and every job run                                                                                                                                                       | `round_id`; `run_id`                           |
| `calendar_marks`        | The filing deadlines the daily calendar check has refreshed for (`'2026-10-22 12G'`)                                                                                                                                   | `deadline`                                     |
| `d1_write_budget`       | The jobs' D1 rows written and read per UTC day                                                                                                                                                                         | `day`                                          |
| `fara_employer_matches` | Employers matched to FARA-registered firms                                                                                                                                                                             | `employer`                                     |
| `feedback`              | Visitors' grade flags and suggestions: kind, time, daily hashed sender (never an IP), member, reason, text, page, status (`open`, `done`, `binned`)                                                                    | `id`; indexes (`day`, `who`), (`status`, `at`) |

Every query below uses a key or an index (check a new one with `EXPLAIN
QUERY PLAN` first: an unindexed lookup once read 18.8M rows and locked the
whole account out of D1 until midnight UTC).

```bash
d1() { npx wrangler d1 execute tfp-results --remote --command "$1"; }
# One member's result
d1 "SELECT computed_at, status, json_extract(grade, '$.tier') AS tier FROM results WHERE bioguide_id = 'C001132' AND cycle = 2026"
# One committee's check
d1 "SELECT name, status, bulk_count, fec_individual_count, gap_filled, note FROM committees WHERE committee_id = 'C00540617' AND cycle = 2026"
# A member's grade history
d1 "SELECT changed_at, old_tier, new_tier FROM grade_history WHERE bioguide_id = 'S001183' ORDER BY changed_at"
# Today's D1 use by the jobs, and the deadlines refreshed for
d1 "SELECT * FROM d1_write_budget WHERE day = date('now')"
d1 "SELECT * FROM calendar_marks ORDER BY deadline DESC LIMIT 5"
# Open visitor flags (also on /admin)
d1 "SELECT at, member_id, reason, text FROM feedback WHERE status = 'open' ORDER BY at DESC LIMIT 20"
```

`taskforce-purple-donors` is the old donor database: no longer written
since 2026-10-04 (`fara_employer_matches` was copied from it).

## Limits (free tier)

- **KV:** 1,000 writes a day per account (REST writes count too). The
  refresh writes `members:list` once per batch; the roster update one
  record per changed member plus the list.
- **D1:** 5M rows read and 100k written a day for the whole account
  (shared with the owner's other projects; over the read limit, every
  database refuses reads until midnight UTC, 5 pm PDT); 500 MB per database
  (health alerts at 400 MB). The refresh job stops at 3M rows read and
  85,000 written. `node scripts/verify/d1-usage.mjs` shows use by database.
