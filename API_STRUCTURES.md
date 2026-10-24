# API reference

The API worker (`workers/data-pipeline.js`) serves the site. It only reads:
grades are written by the refresh job in GitHub Actions (`scripts/refresh/`,
RUNBOOK §8). Base URL: `https://taskforce-purple-api.dev-a4b.workers.dev`.
Secrets are shown as `$PLACEHOLDER`; their values live only in Cloudflare
Worker secrets and GitHub secrets (CLAUDE.md). Last checked against the
code on 2026-10-18.

## Endpoints

| Endpoint                                                                                | What it does                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/members`                                                                      | The member list as stored (KV `members:list`)                                                               |
| `GET /api/members/{bioguideId}`                                                         | One member's list entry                                                                                     |
| `GET /api/member-detail?bioguideId=`                                                    | One member's page: record, grade and its working, money trail, donors by state, evidence (D1 `tfp-results`) |
| `GET /api/races`                                                                        | The 2026 races (KV `races:list`; 404 until published)                                                       |
| `GET /api/candidate-detail?id=`                                                         | A race candidate who isn't a sitting member (D1 `race_candidates`)                                          |
| `GET /api/status`                                                                       | Counts from the list                                                                                        |
| `GET /api/health`                                                                       | The health verdict: problems, each with a proposed fix                                                      |
| `POST /api/feedback/flag`, `/api/feedback/suggestion`                                   | Visitors' grade flags and suggestions (D1 `feedback`)                                                       |
| `/admin` (on taskforcepurple.com)                                                       | The admin panel (Pages Function `functions/admin` hands it on)                                              |
| `GET /api/social-handles`                                                               | Members' social handles                                                                                     |
| `POST /api/refresh-social-handles`, `/api/remove-member/{id}`, `/api/clear-fec-mapping` | Admin; need `Authorization: Bearer $UPDATE_SECRET`                                                          |

Retired, answering HTTP 410: `/api/update-data`, `/api/update-fec-batch`,
`/api/smart-batch`, `/api/test-member`, `/api/reset-pac-data`,
`/api/refresh-congress-metadata`, `/api/debug-kv`, `/api/recalculate-tiers`,
`/api/process-candidate`, `/api/update-member/@…`, and every URL on the old
itemized worker (`taskforce-purple-itemized-analysis`). They belonged to the
pre-rebuild pipeline (`docs/history/log-2025-26.md`).

### `GET /api/members`

The stored `members:list` body as-is (header `X-TFP-Source: members:list`):
`{ members, lastUpdated, total, adaptiveThresholds }`. `lastUpdated` is when
the list's data last changed. Each entry has only list fields
(`LIST_FIELDS` in `workers/member-store.js`):

- identity and seat: `bioguideId`, `name` ("Last, First M."), `party`
  (`Democratic`, `Republican`, `Independent`), `state` (full name),
  `district` (House: a number, 0 at-large; Senate: null), `chamber`
  (`House`, `Senate`);
- the grade: `tier` (`S`–`F`, or a withheld word: `DISPUTED`,
  `UNVERIFIED`, `N/A`), `individualFundingPercent` (the score),
  `peoplePowerInfluence: { people, power, influence }` (whole percentages
  adding up to 100, `people` being the score; absent on withheld grades),
  `withheldReason` (withheld grades only: `identity-not-confirmed`,
  `no-campaign-committee`, `not-graded`), `gradeCycle` (the cycle the grade
  is on, e.g. 2026), `gradeBasis`, `evidenceChecked` (true: every record
  checked against the FEC; false: graded from the bulk files, check still
  to come);
- money: `personFigures` (all the member's committees counted once:
  `totalRaised`, `grassrootsDonations`, `largeDonorDonations`, `pacMoney`,
  `partyMoney`, `ownMoney` when non-zero, `filedThrough`: the date the FEC
  filings behind the figures run to), and the older campaign-committee
  figures (`totalRaised`, `grassrootsPercent`, `pacMoney`, ...);
- `nakamotoCoefficient`, `faraEmployerTotal`, `faraAgentTotal`,
  `fecIdentityVerified`, `pacDetailsStatus`, `lastUpdated`, plus
  `quicklook` (the row's warning-icon sectors) and `conduitCount`.

### `GET /api/member-detail?bioguideId=`

For a member graded by the refresh job, everything comes from their newest
row in D1 `tfp-results` (one read):

- `member`: their record with the result laid over it, including
  `pacSummary` (every PAC gift to their campaigns and leadership PAC, the
  30 largest with each PAC's group, sponsor, people test and traced people
  share), `topConduits`, `faraFirms` (with registered agents and foreign
  clients) and the list fields above;
- `grade: { score, detail }` (letter grades only): FINAL-3's working in
  dollars (`workers/grading.js` `gradeMemberFinal3`): `small`, `big`, `pac`,
  `party`, `otherPoliticiansFunds`, `directed`, `given` (their sum),
  `donors`, `fewestHoldingHalf`, `allowance`, `reliable`, `bigCounted`,
  `fromPeople`, `pacCounted`, `directedCounted`, `score`. The member page's
  receipt, graph and "Why" are built from it;
- `moneyTrail`: each committee (`committeeId`, `name`, `role`, `raised`,
  and for joint funds `ownFund`, `toMember`, `toMemberCounted`,
  `passedElsewhere`);
- `bigByState: [{ state, amount }]`: big-donor money by the donors' states;
- `uniqueDonors`, `nakamotoCoefficient` (from the grade's donor test);
- `evidence: { checked, notes }`: `notes` lists where the FEC's own figures
  disagree.

Big donors are never named. A member the job couldn't grade gets their
stored record with `evidence: null`, and never an old letter grade.

### `GET /api/races` and `GET /api/candidate-detail?id=`

`races:list` as stored: `{ cycle, field, sources, races: [{ key, office,
state, district, label, candidates: [{ candidateId, bioguideId, name, party,
ici, tier, evidenceChecked, totalRaised, smallDonors, largeDonors, pac,
uniqueDonors, nakamoto, peoplePowerInfluence, registered }] }], updatedAt }`.
`sources` names the Wikipedia revisions the field came from; a candidate on
the ballot who never registered with the FEC has `candidateId: null` and
`registered: false`. HTTP 404 until the races job publishes; the site shows
the ballot only when `field` is `ballot` (November's ballot). Sitting members keep their published grade.
`candidate-detail` serves a non-member candidate from `race_candidates` in
the same shape as `member-detail`.

### `GET /api/health`

Public, read-only, never cached: `{ checkedAt, ok, problems: [{ id,
message, fix }], notes: [] }` from `workers/health.js`. It checks the
member list, the refresh job's last run, failing members, unreconciled
committees, D1 reads, writes and size, waiting visitor flags and whether
the pre-built pages are stale. `scripts/health-alert.sh` turns it into a
`system-alert` GitHub issue at the end of every refresh and calendar run.
One KV read and one batch of small D1 reads per call.

### Feedback and `/admin`

- `POST /api/feedback/flag`: `{ memberId, reason, text?, page, token,
website }`; `reason` is `figures`, `person`, `outdated` or `other`
  (`other` needs `text`). `POST /api/feedback/suggestion`: `{ reason (idea,
bug, other), text, page, token, website }`. `token` is Cloudflare
  Turnstile's (secret `TURNSTILE_SECRET`); `website` is a hidden field only
  bots fill in. Answers `{ ok: true }` or `{ error }` in words (400, 403
  failed bot check, 429 over the daily limit: 10 a person, 300 for the
  site). Stored in D1 `feedback` with the sender as a daily hash, never an
  IP address.
- `/admin` on taskforcepurple.com: the login form, then the panel. The key
  (secret `ADMIN_SECRET`) sets a cookie `tfp_admin` (a hash of the key, Path
  `/admin`, HttpOnly, SameSite=Strict); `Authorization: Bearer
$ADMIN_SECRET` works too. `POST /admin/login`, `/admin/logout`,
  `/admin/item/{id}/{open|done|binned}`. Code: `workers/admin/`
  (TypeScript).

## Outside APIs the jobs use

- **FEC** (`api.open.fec.gov/v1`, key `$FEC_API_KEY`; ours allows 120 calls
  a minute since 2026-10-07, header `X-RateLimit-Limit: 120`; the jobs pace
  themselves with `FEC_MIN_INTERVAL_MS`): `/totals/{house-senate|pac-party}/`
  (a campaign's transfers in are `transfers_from_other_authorized_committee`,
  a PAC's `transfers_from_affiliated_party`), `/committee/{id}/totals/`,
  `/schedules/schedule_a/` (the record check), `/filings/` and
  `/efile/filings/` (who filed the pre-general report: the races job's
  check), `/reporting-dates/` (the calendar check). Plus the
  FEC's bulk files (`fec.gov/files/bulk-downloads/{cycle}/`: indiv, oth, cm,
  ccl, weball, webk, cn). Wikipedia's 2026 House and Senate election pages
  (MediaWiki API, `action=parse`, pinned by revision): who's on November's
  ballot.
- **The roster**: `unitedstates.github.io/congress-legislators/legislators-current.json`
  (no key): who's in Congress and their FEC candidate IDs, for the identity
  crosswalk and the roster update.
- **IRS** exempt-organization files and Form 990s (the PAC sponsor test),
  **DOJ FARA** register (foreign agents), **Census** district files (built
  once into `public/geo/`).

Election cycles are named by the even end year (2025 and 2026 are cycle
2026); the jobs grade on `gradingCycle()` (`workers/tier-calculation.js`).
