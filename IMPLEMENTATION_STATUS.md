# Task Force Purple: implementation status

**Last updated**: 2026-10-23. Current state first, then a dated change log
(newest first, from the rebuild on 2026-10-03). The log before the rebuild
is in `docs/history/log-2025-26.md`.

---

## Current state

**What it is.** taskforcepurple.com grades every member of Congress, S to
F, on where their campaign money comes from: People (many different
people), Power (big money from a few wealthy donors) and Influence (PACs,
politicians and parties). The grade is the People share, worked out by
FINAL-3 (live since 2026-10-13; `GRASSROOTS_CALCULATION_GUIDE.md`, `/how`).

**How it runs.**

| Piece                                         | What it does                                                                                                                                                                                                                                                                                                    | When                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `refresh.yml` (`scripts/refresh/run.mjs`)     | Grades members from the FEC's bulk files (grade-only lane, minutes), and checks every committee's records against the FEC's (check lane, hours; chains its own runs); publishes `members:list` once per batch, only on change; rebuilds the pre-built pages when grades changed                                 | Started by the calendar check, by hand, or by its own previous run |
| `calendar.yml` (`calendar.mjs`, `roster.mjs`) | One FEC request for the reporting dates: 3 days after a deadline members file for (Q1, Q2, Q3, year-end, pre- and post-general) it starts the refresh; keeps the member list in step with Congress (new members, departures, party and seat changes, the identity crosswalk); turns `/api/health` into an alert | Daily, 9 am Pacific: the one clock (owner's yes, 2026-10-18)       |
| `races.yml` (`races.mjs`)                     | Grades everyone on November's ballot for Congress and publishes `races:list`                                                                                                                                                                                                                                    | 23 and 27 October 2026, then it switches itself off                |
| `races-check.yml` (`check-candidates.mjs`)    | The record check for race candidates; re-grades the races when it finishes                                                                                                                                                                                                                                      | Started by the races job                                           |
| `code-quality.yml`                            | Tests, lint, type check, audit on every push                                                                                                                                                                                                                                                                    | Every push                                                         |
| Cloudflare Pages                              | The site (`src/`), plus pre-built pages, link-preview pictures, sitemap, llms.txt and grades.csv (`scripts/site/prerender.mjs`)                                                                                                                                                                                 | Every push to main, and the refresh's deploy hook                  |
| API worker (`workers/data-pipeline.js`)       | Serves the list, member detail (from D1), races, `/api/health` and `/admin`                                                                                                                                                                                                                                     | Always; deployed by the owner (`npx wrangler deploy`)              |

Off: the old Worker crons, the hourly `health-alert.yml`, `d1-repack.yml`
(a one-off). `simulate.yml` is by hand, for grading-change simulations.

**Storage.** KV: `members:list`, `member:{id}`, `races:list`. D1
`tfp-results`: results, history, committee checks, packed fetched records,
race candidates, the calendar's marks, visitor feedback
(`DATABASE_REFERENCE.md`).

**Limits that bind** (free tier only): 1,000 KV writes a day; D1 5M rows
read and 100k written a day (shared with the owner's other projects);
500 MB per D1 database; FEC 120 calls a minute (check 86, grading and races
30). `CLAUDE.md` has the rules.

**Known limitations.**

- The New Year rollover is one date for everyone: grades stay on the 2026
  cycle until 1 May 2027. The "current trajectory" view of the new cycle's
  money before then isn't built (REBUILD_SPEC §9).
- A member whose refresh fails retries on the next refresh; the growing
  gaps between retries in REBUILD_SPEC §8 aren't built.
- Race candidates are graded from the bulk files first and shown as still
  being checked until `races-check.yml` has checked their committees.
- The Why list's shares are rounded to add up to the grade, so one can be a
  point off its own dollars (owner's choice).
- An intermittent D1 error 7403 on the job's own database (#64).

**Open issues** (GitHub): #18 member biography, #33 connected
organisations, #64 the D1 error, #67 PACs.csv download, #68 to #70 PAC data
clean-up, #71 outside spending, #72 TypeScript (after the election).

---

## Change log

## 2026-10-23 (late night): corrections page; own money on race cards

- `/corrections` (src/pages/Corrections.jsx, list in src/lib/corrections.js,
  kept by hand, newest first; pre-built for previews): how to report a
  mistake, "read within 3 days" (`REVIEW_DAYS`, the admin panel's alert
  for grade flags), and every real correction since 17 October, dated.
  Routine changes after a filing deadline aren't corrections and aren't
  listed. In the footer. Race reports go in as suggestions, which don't
  raise the 3-day alert yet (a health.js change, the owner's deploy).
- Race cards show what a candidate put in of their own, in gold with a bar
  that fills in with the card, from a tenth of what they raised (owner:
  "make it clear, to the point of maybe even slightly animating it"). The
  races list carries `ownMoney` (gifts and loans) from the next races run.

## 2026-10-23 (night): fixes from an outside review

- A campaign with money but none from anyone else read "raised $523" beside
  "No money yet": it's "Nothing from others" now (`withheldReasonOf`, the
  stamp included).
- The PAC panel's "own reports" figure was the one before other
  politicians' joint funds come out ($959,447 for Peltola, the receipt
  $957,059): it quotes the receipt's PAC line now, to the dollar.
- "Country-focused" has an (i) that says what Form 990 is, that one test
  covers every country, and that it can only check PACs set up by a group
  that files one (in practice only Israel-related groups carry the label:
  most diaspora PACs have no such sponsor). The label changes no grade.
- Race addresses drop the Senate's trailing hyphen (/race/S-AK); the old
  ones still work. The Races footer reads as a sentence.
- Small campaigns keep their grades (owner: "Why change the grade?").

## 2026-10-23 (night): the lists as plain files with the site

Owner: "this shouldn't be expensive". Every visit fetched `members:list`
(and `races:list`) from the API worker on workers.dev, where nothing caches
in front of a worker: each new visitor was a worker request and a KV read,
against the free plan's 100,000 of each a day. The build now writes
`dist/data/members.json` and `dist/data/races.json` (scripts/site/
prerender.mjs), which Pages serves from its cache with no daily limit; the
site reads those first and the API only when a file isn't there
(src/lib/api.js). The refresh job already rebuilds the site when grades
change; races.yml and races-check.yml now do too when they publish
(`list_changed`). Member and candidate pages still read their detail from
the API, one request each. Taking the ballot down now needs a rebuild after
the KV write (RUNBOOK §8).

## 2026-10-23 (night): the field pinned; "Something wrong with this race?"

Owner's yes. The races job reads Wikipedia at the revisions pinned in
`scripts/refresh/data/ballot.json` (`pinned`: House 1381568365, Senate
1381667211, the versions checked on the 23rd), not the latest: anyone can
edit Wikipedia, and an added name would otherwise reach the ballot as "not
registered with the FEC". Each run also reads the latest versions and lists
every seat whose names changed (`seatChanges`); on a real run that's a
`system-alert` issue, and the site keeps the checked lists until each
change is checked against the state's list and the pin is moved. Race pages
carry "Something wrong with this race?" (FeedbackDialog `kind="race"`): it
goes through the suggestion route as a bug, the race named in the text, so
it lands on /admin with no worker change.

## 2026-10-23 (night): the Races page, after review

From the site appraisal (owner: "an active race and possibly could
influence elections"). The "Biggest gaps" view is gone, and was the page's
opening view: it ranked races by their figures, so a data problem or a
$2,000 campaign beside a $5 million one led the page (owner). The page
opens on every race, by state; no view ranks by the figures. A search box
finds races by a candidate's name or the state. Race cards show what each
candidate raised and "still being checked" on grades not yet checked
(grade first, confirm after applies here too), and a withheld grade's own
name (Under review, No money yet). Candidate pages show the name as the
ballot gives it, not the FEC's capitals, and the ballot's party. "Everyone
running ... is graded" became "The candidates ... are graded" (69 aren't
registered, 216 have reported no money). The map's fourth shade had white
text at 3.1:1; it's dark ink now.

## 2026-10-23 (evening): the Races page

Owner's go: `/races` (src/pages/Races.jsx), in the menu as "Races" in place
of "Your ballot" (/ballot and /race/:key stay, reached from it). Counters
that count up (races, candidates, how many of the graded candidates get
over half their money from people), a ZIP lookup into /ballot, a tile map
of the states (lib/tilemap.js; one hue, shaded by the share of a state's
graded candidates mostly funded by people; tap one to see its races), and
the races as cards whose People, Power and Influence bars fill in as they
scroll into view: biggest gaps first, or Senate, open seats, every race.
Figures and orders in `src/lib/races.js` (tested). Motion stops for
visitors who turn it down. Candidates show their party as the ballot prints
it (`ballotParty`, from Wikipedia's list; the FEC says OTH for most small
parties). A pre-built /races page for search engines (words only).

## 2026-10-23: who's on the ballot, from Wikipedia matched to the FEC

The races job's first two runs (started by hand, 39983291535 and 39987805327) published the wrong field, and I wrote the rule that caused
it: "only general-election candidates file the pre-general report". It's
false. Campaigns that lost a primary or are retiring still file it (Cornyn
after losing the runoff, Schakowsky retiring, Abughazaleh after losing
to Biss in Illinois 9); joint funds linked to several candidates brought in people
not running (Tipton); and people with two FEC IDs showed twice. The second
run also read only the FEC's processed filings list, which had 689 of
1,181 pre-general filers the day after the deadline (the first run showed
213 one-candidate races; Alaska's Senate race had Sullivan alone). The
owner disabled races.yml and races-check.yml, cancelled both record
checks and emptied `races:list` (`field: "withdrawn"`) at about 10 am PDT.

The field now (owner's design): Wikipedia's 2026 House and Senate election
pages list who's running for each seat (read through its API, the revision
kept in `sources`); each listed candidate is matched to their own FEC
registration for that seat (`scripts/refresh/lib/ballot.mjs`, cn file).
A match needs exactly one person in the seat to fit the name (either order,
short forms, middle initials telling two Dan Sullivans apart); one person
with two IDs is one person (same principal committee, or the same name
registered twice). A House candidate registered for another district of
the same state (lines redrawn) matches only on a full name. Candidates on
the ballot who never registered (under $5,000) show without a grade.

The check: everyone whose campaign filed the pre-general report (processed
and electronic lists) but isn't listed. A seat with one is held back, with
a `system-alert` issue, until `scripts/refresh/data/ballot.json` records
why they're off the ballot, with a source. On 23 October: 72 people in 66
seats, all checked (and on the dry run, Tony Gonzales in Texas 23, who
resigned in April but whose campaign still filed) (retiring, running for other office, lost the primary,
withdrew, write-in; members' reasons from news reports, others from the
state election pages' cited sources, California's from its certified list).
California's certified list (52 districts) and Indiana's official list (9)
match Wikipedia exactly. Three hand matches where Wikipedia's spelling
differs from the FEC's are in the same file.

First pass on the 23rd: 475 seats, 1,296 candidates; 1,166 matched by full
name, 58 by family name (people who go by a short name: Ro Khanna is
ROHIT), 3 by hand, 69 not registered with the FEC, none unclear.
Published at 7 pm PDT (run 40050893071, owner's go): 475 races, 1,296
candidates, 0 seats held; races.yml and races-check.yml back on, the
record check running behind it.

## 2026-10-20: the grades' licence

Google Search Console asked for a `license` on the Dataset structured data
(/congress). The grades are CC BY 4.0 (owner): free to reuse with credit.
The Dataset now carries the licence, the grades.csv download and a date
range that follows the graded cycle; /congress says it beside the link.

## 2026-10-18: the owner's line, shorter

"It doesn't matter who wins if everyone loses." (was "which side wins";
owner). `MOTTO` in `src/lib/research.js`: "Why this matters" and the footer.

## 2026-10-18: the docs cleaned up

- Deleted six docs about the abandoned 2025 system (the 2025 spec,
  DONOR_CONCENTRATION_ANALYSIS, SMART_BATCHING_STRATEGY, the January bug
  write-up, deploy-instructions, the legislative-alignment idea). Moved to
  `docs/history/`: this file's log before the rebuild, the July roadmap and
  the version A method.
- Rewritten to match what's live: this file's current state (above),
  API_STRUCTURES (by endpoint), DATABASE_REFERENCE (KV keys and D1 tables,
  indexed queries), ROADMAP (the dates that run themselves, what's next by
  hand), README, CLAUDE.md (the site's copy rules and one source for the
  numbers as conventions), the method guide; REBUILD_SPEC's status says
  what's built.
- RUNBOOK checked command by command. Its §5 data check counted members
  with no score as negative and used campaign-only figures, so it flagged
  a withheld member: fixed. `/api/status` counted only S to D: fixed in the
  worker, live at the next deploy (with health.js's new `site-data-short`
  advice).

## 2026-10-18 (early): the record check for race candidates (#55)

- **Candidates are checked like members:** `scripts/refresh/check-candidates.mjs`
  checks each challenger's and open-seat candidate's committees against
  the FEC's own records with the refresh job's own `reconcileCommittee`,
  into the same tables (`committees`, packed records in `gap_packs`;
  round `races-check`). Candidates come from the published `races:list`,
  their committees from `race_candidates` by primary key; committees
  already checked this cycle (a member's too) are skipped.
- **The races job reuses the checks** (races.mjs): a checked committee's
  fetched records join the bulk file's, and a candidate whose committees
  all reconcile is graded as checked (`status` complete), as members are.
- **Workflows:** races.yml starts `races-check.yml` after grading when
  candidates are still unchecked; the check runs at 30 FEC calls a minute
  (beside the members' check's 86), starts its own next run when a pass
  outlasts one, and the run that finishes it re-grades and republishes the
  races itself (races.yml switches itself off after 27 October). No clock.

## 2026-10-18 (early): the roster update and the filing calendar (#53, #54)

- **The roster update** (#53): `scripts/refresh/roster.mjs` (logic in
  `lib/roster.mjs`, tested) keeps `members:list` in step with the public
  roster the identity crosswalk is built from (unitedstates/
  congress-legislators). New members get a record and a list entry
  (ungraded until graded on the campaign that won their seat); members who
  left come off the list (records kept); a changed party or seat is
  updated; `workers/fec-crosswalk.js` is regenerated when the FEC IDs
  change. KV writes only for members who changed, plus one list write.
  Refuses a roster under 530 legislators, or over 120 arrivals or
  departures at once without `--allow-big` (a new Congress). Its first
  look found two real errors on the site, both confirmed by the House
  Clerk's list (1 October 2026): Kevin Kiley (CA-3) is an Independent, not
  a Republican, and Matt Van Epps holds TN-7, not TN-8 (so TN-7's ZIP
  codes didn't find him).
- **The filing-calendar check** (#54): `scripts/refresh/calendar.mjs`
  (rule in `lib/calendar.mjs`, tested) asks the FEC for its reporting
  dates (one request) and, 3 days after a deadline members file for (Q1,
  Q2, Q3, year-end, pre- and post-general) that hasn't been refreshed for,
  starts the refresh: grade-only, then the record check. Deadlines handled
  are kept in D1 `calendar_marks` (by primary key). The workflow,
  `.github/workflows/calendar.yml`, also runs the roster update (and grades
  any new member) and `health-alert.sh`. **Daily at 9 am Pacific** (the
  owner's yes, 2026-10-18: the one clock, REBUILD_SPEC §8). Retries with growing gaps
  (§8) aren't built: a failed member retries on the next refresh.

## 2026-10-17 (late): the New Year rollover guard (#53)

- **1 January 2027 no longer empties every grade.** Every job's default
  cycle was `cycleForYear(this year)`, which turns to 2028 on 1 January:
  a cycle with almost no money in it yet. `gradingCycle()` in
  tier-calculation.js keeps the finished cycle graded until 1 May of the
  odd year (the new cycle's first quarterly report is due 15 April), then
  moves on (REBUILD_SPEC §9, simplified to one date for everyone). Used by
  run.mjs, races.mjs, publish.mjs and gap-records.mjs.
- **Cycle labels follow the grade:** "2025–26" and "’26" were fixed text;
  they now come from each member's `gradeCycle` (`cycleLabel`,
  `cycleShort` in election.js; `gradeCycle` added to `members:list`, so
  the next publish rewrites the list once). The "current trajectory" part
  of §9 (showing the new cycle's money so far before the switch) isn't
  built.

## 2026-10-17 (late): issues tidied; stock trading dropped

- **Stock trading is dropped** (owner: too subjective to grade). #31
  closed as not planned; REBUILD_SPEC.md §13 and ROADMAP.md say so. The
  site grades only where campaign money comes from.
- Closed as done: #65 (/how in plain English; its PAC list moves to #67,
  whose PACs.csv carries the FEC's group and TFP's) and #66 (the graph,
  the Why steps and the PAC section show the working). 13 issues open.

## 2026-10-17 (late): no "we"; who runs it, in the footer

- **"We" is gone from the site** (owner: one person runs it; without "we"
  the copy reads more data-driven and less like an actor with motives).
  About 45 lines rewritten as ordinary sentences: "Their money is added
  up", "Grades come from the FEC's bulk data first, then each donation is
  checked...", "How grades work" (was "How we grade"), "Thanks, got it.
  Every one gets read.", "Read the studies yourself". Withheld grades keep
  their ownership: "It's a problem with this site's data, not something
  found about this member." "Why this matters to all of us" keeps its
  "us" (everyone). Write new copy the same way.
- **Footer:** "Task Force Purple is one person, with friends and family
  who test it and send feedback. It isn't connected to any party or
  campaign, has no ads and takes no money from campaigns or PACs..." and a
  privacy line: the ZIP code and location stay on the device; feedback is
  checked by Cloudflare Turnstile and only what's written is kept, with a
  daily-changing code to stop spam (owner confirmed both).
- The dots headline's "D" wears the D grade's colour.

## 2026-10-17 (night): "FEC filings to" on receipts

- **How recent the money is** (both outside reviews; owner's yes): each
  member's figures now carry `filedThrough`, the oldest of the latest FEC
  reports behind them (each committee's coverage end date, so it's never
  overstated; `combineVehicleTotals` in person-funding.js, kept in
  `personFigures`). The receipt reads "FEC filings to Sep 30, 2026 ·
  Graded Oct 17, 2026" and the share card's header "FEC FILINGS TO ...".
  It fills in when members are next graded; until then the receipt shows
  the grading date alone, as before.
- The method spec's "money from businesses ... counts 0" now reads
  "companies' PACs" (GRASSROOTS_CALCULATION_GUIDE.md and /how), as
  elsewhere: wording only.

## 2026-10-17 (evening): fixes from two outside reviews

The owner had two outside reviews of the site appraised; most of the
second one read old GitHub issues as current. Six resolved issues were
closed (#1, #16, #39, #47, #57, #61). Done from the reviews:

- **Search finds what people type** (`src/lib/search.js`): every word must
  match the start of a word in the name, the initials ("AOC"), a common
  short form of a first name ("Bernie", "Chuck"), the state or its postal
  code ("NM"), or the party; accents and punctuation ignored. With no full
  match it shows the closest, and says so. The "no matches" line says
  what to try and offers "Clear filters" only when there are filters.
- **"Not graded" filter** on /congress, and member pages lead back to the
  directory with the visitor's search and filters (`tfp:last-directory`).
- **"Businesses" was wrong:** companies can't give to federal campaigns;
  their money comes through their PACs. Influence is now "Money from PACs
  (including companies' PACs), politicians and parties" everywhere,
  pre-built pages included (prerender `WORDING` 3: every page re-listed).
- **What a grade is and isn't**, beside every grade: member pages ("The
  grade is only about where the money comes from, not how they vote, their
  character or the law."), the share card and link previews (`GRADE_SCOPE`
  in grades.js).
- **The receipt's subtotal reads GRADED ON**, so the percentage's base is
  named.
- **Every grade as a spreadsheet**: `/grades.csv` (#67), built with the
  pre-built pages, linked from /congress and llms.txt.
- Accessibility: the PAC section's headings no longer skip a level; chart
  axis text 12px; the curve-or-bars switch 34px tall.
- **Schweikert re-graded live** (F 14 to E 16, run 39079214252) after the
  joint-fund fix was merged; one KV write.

## 2026-10-17 (later still): receipts from the grade's own figures

- **One source of truth for a member's money** (owner: "the numbers HAVE
  to be perfect"). The receipt was built from the FEC bucket figures
  (`personFigures`) while the "Why" used the grade's working
  (`grade.detail`): same dollars, sorted differently. Money passed on by
  other politicians' joint funds sat inside "Big donations" on the
  receipt but under "Parties and other politicians" in the Why; gifts a
  committee directed were spread across small, big and PAC lines. The
  receipt now comes from the grade's working (`receiptLines` in
  `src/lib/people.js`): the five kinds the Why lists, a SUBTOTAL (what the
  grade is on), then own money and other money under "Not in the grade",
  then the TOTAL. Whole dollars that add up exactly to the subtotal and the
  total (largest remainder; each line within a dollar of the exact
  figure). Lines are never hidden for being small: before, party, own and
  other money under 1% were dropped, so some receipts didn't add up. The
  share card shows small, big and PAC money and "Everything else".
- **Joint-fund money counted twice, fixed** (owner's yes after a
  simulation). For 2 members the grade's money came to more than their
  total raised. Sheehy (S001232): the stored campaign total was from an
  older report than the rest; the next run's fresh totals fixed it on
  their own. Schweikert (S001183): a real double count. His campaign
  re-reported $145,852 of other politicians' joint-fund transfers as the
  individual donations behind them, so its FEC totals show $421,839 of
  transfers in against the funds' $568,683, and the grade counted that
  money twice. Other politicians' funds now count, all together, no more
  than the member's committees report receiving as transfers, less what
  came from their own committees and funds (`otherFundsCounted` in
  `workers/person-funding.js`; a PAC's totals call the field
  `transfers_from_affiliated_party`). Simulated with two dry runs on the
  same day's data (39063594700 current code, 39066782543 the fix): of 536
  members only Schweikert changes, F 14 to E 16; no graded member's money
  is left above their total raised. The first fix run showed no change
  at all because I had the PAC field name wrong, so every member with a
  leadership PAC was skipped; caught by the result, fixed and re-run.
- **No rounding to a fraction it isn't:** the home page's dots headline
  said "Half get a D or worse" for 254 of 534 (47.6%); fractionWords now
  says "Nearly half" or "Just over" unless the share is within half a
  point (an outside review's catch). "Whether it changes votes is still
  argued over" left the "Why this matters" opening (owner: redundant).
- **The owner's line**, "It doesn't matter which side wins if everyone
  loses.", opens "Why this matters" in big type and signs off every page in
  the footer (`MOTTO` in `src/lib/research.js`).
- **Rounding (owner's choice):** the Why list's shares are rounded so they
  add up to the grade's People share, so one can be a point off its own
  dollars (35.4% shown as 36%). Whole numbers can't do both; the list
  adding up won.
- **"Why this matters", in plainer words** (owner: "a plain English
  thesis, not a paper"): the chart is "How wealth influences policy",
  Wealthy and Middle class, "Few want it" to "Most want it", "45% chance";
  the caption is just the source. The opening line and the three findings
  were reworded the same way.

---

## 2026-10-17 (late night): "Why this matters", flag pictures, graph polish

Owner's list:

- **"Why this matters to all of us"** on the home page, after "How we
  grade" (owner's mock-up). Opens on the point: money doesn't have to buy
  votes to matter; research links it to whose wishes become law, who
  members make time for and what they work on. The chart is Gilens and
  Page (2014), drawn from the figures the paper gives: a policy average
  Americans wanted became law about 30% of the time whether 1 in 5 or 4 in
  5 of them wanted it; for the richest tenth, about 18% rising to 45% (the
  gap filled with the graphs' gradient). Then three findings: donors get
  the meetings (Kalla and Broockman 2016, a field experiment), donors are
  linked to what members talk about (Goel et al. 2023) and money from a few
  big donors is linked to less work (Parmigiani 2025). Where serious work
  disagrees, the source note says so (Enns 2015; Furnas et al. 2023). Every
  figure was read in the source; each is linked by DOI. Content in
  `src/lib/research.js`, also in the pre-built home page. The mock-up's
  figures were checked and dropped: its Gilens and Page values (80% and
  55%) weren't the paper's, its access study wasn't lobbyists, and its
  third study had the wrong journal and years. A first version led on a
  2023 Pew opinion poll; the owner dropped it ("it proves nothing, that's
  the site's job").
- **The "Why" on member pages** (owner): the heading is the grade's own
  line ("Grade S: 91% of the money came from people"), then the numbered
  kinds of money. The summary box ("People 91%, Power 0%, Influence 9%.
  That's an S...") and the "shares of all the money" sentence are gone: the
  graph already shows the three parts. Why own money, loans, transfers and
  refunds are left out is said once, on /how ("What's left out?",
  `LEFT_OUT` in explain.js); each receipt still lists the amounts.
- **Colour for People, Power and Influence** only where the three are
  being explained (owner): "How we grade" on the home page, "Three sources"
  on /how and the key under the member graph.
- **Home page words:** the hero says "Every member of Congress is graded
  on where their money comes from. Look up your representative to see
  who's funding them." (owner). "How we grade" lists People, Power and
  Influence one per line, each word in its colour (`--people`, `--power`,
  `--influence` in app.css: the grade colours darkened to pass as text).
- **Flags are pictures, not emoji**, 22px wide in the "Country-focused"
  chips: small PNGs in `public/flags/` made from the flag-icons set (MIT,
  licence beside them), 96 KB for all 104 countries.
- **The graph:** the line stops exactly at the shape's sides (it poked out
  past them); the "Why" summary leads, then the steps; strips breathe only
  while pointed at or while their step is open; the cycle ('26) is bolder,
  above the 100% line, on the page, the cards, the share card and link
  previews. (A circle round it was tried and dropped the same night: it
  fought the circled grade letter. The curve-or-bars switch moved left to
  give the '26 the corner.)
- **Ballot table:** "Half the big money came from" reads "52 of 343 big
  donors", as member pages say it, not a percentage.

---

## 2026-10-17 (night): the graph's strips, linked to the "Why" steps

Owner's design, worked out over mock-ups:

- **One gradient for every graph**, fill and line: green (people) on the
  left to red (corporate) on the right, the grades' own colours
  (`GRAPH_GRADIENT` in `src/lib/grades.js`); the page, the cards, the share
  card and the link previews. The grade keeps its colour in the stamp and
  the circled letter.
- **Strips on the member page:** the shape is cut into darker strips, one
  per kind of money in each part, people to corporate (`moneyStrips` in
  `src/lib/explain.js`). A strip and its "Why" step light each other up
  (`src/lib/light.js`); the lit strip breathes only while someone's looking
  (pointer on it, or five seconds after a tap), and the biggest kind of
  money breathes three times the first time the graph is in view. Still for
  "reduce motion".
- **The "Why" steps** lead with where each kind of money went ("20% People ·
  17% Power"), so they visibly add up to the graph. Big donations give the
  real reason for any Power share: the count ("just 52 people") when fewer
  than 100 people gave half the big money, else the share
  (`final3AllowanceLimits` in tier-calculation.js, the same maths the grade
  uses; no grade changes).
- **Curve or bars** (owner, for readers who want plain bars since the
  three parts are separate): a switch on the member page's graph draws every
  graph on the site as bars, remembered on that device
  (`src/lib/graph-shape.js`). On the member page each bar is stacked from
  its strips, people at the bottom, with the same linking and breathing.
  Pre-built pages and link previews keep the curve.
- **The "Why" steps are an accordion** (owner): every headline in view,
  one step open at a time, opening smoothly (instantly for "reduce
  motion"), so the explanation stays beside the graph. Opening a step lights
  its strips (still); pointing breathes them; clicking or tapping a strip
  opens its step. Headlines are buttons that say whether they're open.
- "Piles" became "sources" (People, Power and Influence) on /how, the home
  page and the pre-built /how page.

---

## 2026-10-17 (evening): percentages, the graph's half-way changes, flags

Owner's call ("do the lot"):

- **One unit: percentages.** Every "$X of every $100" became a percentage:
  grade meanings and ranges ("75% to 89% of the money came from people"),
  the "Why" steps ("Here 39% of the money is People and 7% is Power"), the
  home page, /how, the ballot comparison and the pre-built pages. The $200
  small/big line stays in dollars.
- **The graph:** open at the sides again (pinned to zero, it drew slopes
  that aren't in the data); no dots, pointing at or tapping a part shows it
  with what it means; "’26" in the corner for the election cycle. The share
  card and the link-preview pictures match. Whether the curve is the right
  form (or columns) stays open.
- **Flags** back on the "Country-focused" chips (🇮🇱), drawn from the
  country's code (`src/lib/flags.js`, every country the refresh job can
  name).
- **Stamps:** long grade names ("Heavily influenced") on two tight lines
  inside the ring on the small card stamps.

---

## 2026-10-17 (later): findable by search engines, AI tools and link previews

- **Pre-built pages** (`scripts/site/prerender.mjs`, part of `npm run
build`): each member's page, the home page, /how and /congress get a real
  HTML page with its own title ("Who funds Adam Schiff? A: 85% from
  people"), description, canonical address, schema.org data (Person on
  member pages, Dataset on /congress) and a readable version of the page;
  the app then draws the live page over it. Pages serves them by path; every
  other path still gets the app (Pages' single-page fallback; the redundant
  `_redirects` rule is gone).
- **Link previews:** a 1200×630 picture per member (stamp, the People /
  Power / Influence graph, the one sentence), drawn at build time with resvg
  and the site's fonts (`scripts/site/og-card.mjs`), about 65 KB each.
- **sitemap.xml** (each page's date changes only when what it shows
  changes, carried over through `prerender-state.json`), **robots.txt**
  (everything open but /admin and /api), **llms.txt** and **llms-full.txt**
  (every member's grade as one line), and **IndexNow** on production builds
  for the pages that changed.
- **Rebuilds:** the refresh job reports `list_changed`; refresh.yml then
  calls the Pages deploy hook (secret `PAGES_DEPLOY_HOOK`). Health check
  `pages-stale` if the pages fall 6 hours behind the grades.
- The app's page titles match the pre-built ones.

---

## 2026-10-17: the admin panel, flags and suggestions

- **taskforcepurple.com/admin** (owner's choices, 2026-10-16): logged in
  with the admin key (`ADMIN_SECRET`, lifted from Let's Find Out); one page
  with what needs you (the `/api/health` checks and fixes, now shared through
  `loadHealth` in `workers/health.js`), open grade flags and suggestions,
  the grade counts, the last refresh run, recent grade changes and today's D1
  budgets. Served by the API worker (`workers/admin/`, TypeScript, the first
  converted files of #72) through a Pages Function (`functions/admin`) so
  the cookie belongs to the site.
- **Flags:** "Something wrong with this grade?" on every member and
  candidate page: The figures look wrong / Wrong person / Out of date /
  Something else (needs a note), with an optional note. **Suggestions:**
  "Suggest something" in the footer: Idea / Bug / Something else. Both:
  Cloudflare Turnstile (free; `TURNSTILE_SECRET`), a hidden field for form
  bots, 10 a day per person and 300 for the site, one row each in D1
  `feedback` (indexed; checked with EXPLAIN QUERY PLAN). Shown on /admin
  only, each with a one-click GitHub issue.
- **Health:** a grade flag open more than 3 days is the problem
  `flags-waiting`, so the end-of-refresh alert opens a `system-alert` issue.
- Also (2026-10-16): graphs start and end at zero; the ZIP lookup is one box.

---

## 2026-10-16: two leftover Workers deleted (owner)

- `taskforce-purple-itemized-prototype` still had a cron every 2 minutes
  (set 2026-01-07): about 720 runs a day at about 14 ms CPU each, doing
  nothing anyone used. Deleted by the owner.
- `taskforce-purple-recalc-gini` (no cron, no traffic since January)
  deleted too.
- Left: `taskforce-purple-api` (serves the site) and
  `taskforce-purple-itemized-analysis` (the stub answering 410). Neither has
  a cron.
- The account's "free tier CPU time limit" alert that day came from another
  project's Worker (`craig-zielinski`, a cron every minute), not from TFP:
  the API worker had no failures and its slowest requests used under 10 ms.
- Same day: the member page's receipt went back beside the breakdown and
  every section is open again (2c0f2de, 13 Oct). Closing them was my
  over-reading of the brief.

---

## 2026-10-13 (later): the site says it one way (Craig's brief)

Presentation only: no score, cutoff or calculation changed.

- **The money graph** (`src/components/MoneyGraph.jsx`): every member page,
  every receipt card and /how plot the member's own money as People, Power
  and Influence (`peoplePowerInfluence` in tier-calculation.js: People is
  the score; Power the big money the allowance leaves out; Influence the
  rest of the PAC and directed money, parties and other politicians' joint
  funds). A curve through the three points that never overshoots them
  (`src/lib/curve.js`), with the grade letters under it and the member's
  circled. Members list entries and race candidates carry the three
  figures; pages work them out from the grade's detail until then.
- **Grade names:** S Grassroots, A Supported, B Backed, C Mixed, D
  Influenced, E Heavily influenced, F Beholden.
- **Member page:** name, party and seat; the stamp; one sentence ("85% of
  the money came from people", the only "from people" figure on the page);
  a placement line (top or bottom third gets a number, else "Pretty mid");
  the graph. Everything else is in sections closed by default. The
  explanation goes kind by kind: where each $100 of it went.
- **Wording:** no "counts" anywhere; PAC panel grouped under People and
  Influence; "Half the big money came from only 5% of big donors";
  politicians' PACs say so instead of "Run by <surname>"; the PAC figure
  from the member's own reports is the headline, with the PACs' own
  reports' total beside it when the two differ (Cantwell $0 vs $6,500).
- **Donors aren't named.** `topDonors` is gone from the API; the big money
  is shown by donor state (`bigByState`, from the FINAL-3 donor test), the
  member's own state called out. Organizations are still named.
- **Country-focused:** a committee whose sponsor's own Form 990 mission says
  it exists for a country's interests or its relationship with the US
  (`scripts/refresh/lib/country-focus.mjs`, one test for every country,
  IRS data only; `form990.mjs` now keeps the mission, with the Schedule O
  fallback). Of 721 sponsors' missions: AIPAC, J Street and DMFI (Israel).
  Replaces the name-list "Israel interest" tag on bundled donations.
- **/how** is a short plain explanation: the three piles, the grade scale,
  four real members' graphs (unnamed, the middle member of S, B, D and F),
  and the spec as written behind "Show the exact math".
- Also: the Congress list rows show the grade's word and the one figure
  (sorted by it within a grade); the ballot comparison uses the same
  figure; the share card draws the graph and shows dollars on its receipt.

---

## 2026-10-13: FINAL-3 live (owner's "ship it")

- **Grading.** `gradeFinal3` in workers/tier-calculation.js, a port of the
  simulation's FINAL-3 settings, checked member by member against it
  (`scripts/simulate/check-final3.mjs`: 536 identical). The refresh job now
  gathers FINAL-3's inputs on every run (`scripts/refresh/lib/final3.mjs`:
  gifts to own joint funds, committees that direct earmarked gifts, FEC
  totals per committee, sponsor sorting and the people test; FEC committee
  records cached in `data/committee-records.json`, asked for only when
  missing). The races job grades challengers the same way.
- **Checked before going live**: production run on the frozen 11 Oct
  snapshot (run 38405887229) gave every member FINAL-3's grade and score.
- **Live**: merged (93082f7); API worker deployed; grade-only refresh run
  38408321218 (37 min, 6 list writes, 1,963 D1 rows) published 353 grade
  changes: S36 A74 B72 C96 D113 E101 F42, 2 disputed, 3 without an FEC
  identity. 535 of 536 match the frozen FINAL-3 letter; Barragán F to E
  (14 to 15) on FEC data filed since the snapshot. No previous-grade line.
- **Site**: /how shows the one-page spec as written (`src/lib/spec.js`);
  member pages explain the FINAL-3 working per $100 given; the PAC panel
  shows who each PAC answers to, what counts, and committees that steered
  gifts; the home page's first step and the joint-fund wording updated.
- **Hold dropped** (owner): the 15 and 22 Oct refreshes run under FINAL-3.
  The filing-calendar trigger isn't built (#54), so they are started by
  hand (a scheduled workflow change needs the owner's say-so).
- Follow-ups, none blocking: #65 /how plain-English rewrite, #66
  show-the-math panel, #67 CSV downloads, #68 American Kennel Club BUSINESS,
  #69 the 24 not-tested sponsors, #70 FEC gaps list, #71 outside spending.

---

## 2026-10-12 (later): FINAL-3, the freeze candidate (nothing published, branch final-grading)

FINAL-2 with four changes (owner's brief), on the same snapshot and export:

1. the people test's stricter reading: members must elect most of the
   voting board (line 7a Yes is not enough where Schedule O shows a minority
   or a self-electing board, or line 6 says no members), `_minority` in
   `people-test.json`;
2. unions covered by the LMRDA pass on the law (`lmrda` in
   `people-test.json`, 102 private-sector and postal union PACs);
   public-sector and federal unions take the Form 990 test;
3. rule 6 for FEC types C and T only; W goes by its IRS status, co-ops (V)
   stay BUSINESS; the postal supervisors take the people test;
4. a sponsor whose members are businesses is BUSINESS (the Center for
   Sportfishing Policy; Henry Ford Health's affiliate).
   `scripts/simulate/report-final3.mjs` reproduces FINAL-2 from the same code
   (each change switched off; every member's grade and score and every PAC's
   group match) and adds the four in order. S36 A74 B72 C96 D113 E100 F43;
   22 grades change from FINAL-2 (20 by rule 1, 2 by rule 2), none
   unexplained. AIPAC, J Street and LCV fail rule 1, so no directed gift
   counts.

---

## 2026-10-12: FINAL-2 simulated (owner's brief; nothing published, branch final-grading)

Same snapshot; inputs re-exported (run 38328698299) with the donor test
less gifts a committee directed, each joint fund's mix, the directing
committees traced, and sponsors that are themselves committees.
`scripts/simulate/report-final2.mjs`. Final (11 Oct, run 38189054123) gave
S57 A92 B79 C83 D100 E91 F32; FINAL-2 gives S37 A74 B75 C100 D107 E101 F40.

- The people test: a PEOPLE PAC counts only if its sponsor's members elect
  its governing body, read from the sponsor's latest Form 990 (Part VI
  line 7a) in the IRS e-file archive (`scripts/refresh/form990.mjs`, which
  reads single returns out of the IRS zips by byte range; the newer zips
  use Deflate64, read through Info-ZIP's unzip). Answers in
  `scripts/refresh/data/form990.json`; hand-identified sponsors and stated
  facts (union locals: the LMRDA's election rule) in `people-test.json`.
  NO SPONSOR counts 0.
- Line 7a says "one or more" of the board: AIPAC, J Street, LCV and nine
  others answer Yes while members elect one director. Reported as a
  stricter reading (23 grades change); the run uses 7a as written.
- Earmarks through directing committees ($49.4M) leave big-donor money and
  the donor test and count as that committee's gift, outside the PAC cap.
- Other politicians' joint-fund transfers ($61M) come out of each bucket by
  the fund's mix and count 0.
- Sorting rules 6-12 in `scripts/refresh/lib/sponsors.mjs`: the FEC filing
  a sponsor as a company holds against the IRS; insurers, health plans,
  credit unions, chambers and producers' groups are BUSINESS by name;
  sponsors that are committees resolved against the FEC committee list
  (organizations' own "C9" spending IDs ignored); 128 stated facts.
- I wrote "her"/"his" for members on the Final page and typed its party
  figures by hand from an earlier run (149 for 150, 5/154 for 6/151): both
  fixed on the page; FINAL-2's summary figures are computed.

---

## 2026-10-11 (later): simulation round 2, PACs by who they answer to (nothing published)

Same frozen snapshot; inputs re-exported (run 38176064307) to add the donor
test with joint-fund gifts scaled to what reached the member, and each
committee's transfers from the member's own committees.
`scripts/simulate/report-sponsors.mjs`; `sponsorGroup` in lib/grid.mjs.

- PAC money to members: PEOPLE $76.6M, MONEY $272.5M, ONE POLITICIAN
  $49.7M, NO SPONSOR $29.6M, UNCLEAR $21.2M. Many FEC sponsor fields are
  blank or loose (the Big Four's PACs land in NO SPONSOR).
- E-S against E: Democrats 28 up, 48 down; Republicans 0 up, 100 down.
- Transfer check fixed: Krishnamoorthi, Robin Kelly and Hoyer gradable.
  Hinson isn't: the Senate candidate ID (S6IA00314) is missing from the
  crosswalk, so campaign committee C00706267 isn't counted.
- Scaling joint-fund gifts (would reverse the 26 Sept rule) shrinks the
  weak-spot list 19 to 5 but lifts leaders whose big donors gave through
  joint funds (Collins E to A, Cornyn E to A, Pelosi A to S).

---

## 2026-10-11: simplification simulation (owner's brief; nothing published)

One frozen snapshot for every run: FEC bulk files dated 11 Oct and every
FEC API answer recorded once (`scripts/simulate/snapshot.mjs`, workflow
`simulate.yml`, run 38163902277, artifact kept to 10 Nov). The refresh job
gained `--frozen DIR` (dry, grade-only runs on a snapshot: frozen files,
replayed API answers) and `--report` now exports each member's and PAC's
inputs (run 38165965485). `scripts/simulate/lib/grid.mjs` grades any
setting; under the live rules it equals the production grade for every
member. `scripts/simulate/report.mjs` builds the ladder (R0 live, R1a/R1b
fixes, R2 no bar, R3 money-given denominator), variants A-E and the credit
and tracing grid.

- R0 reproduces live: 44 differ, all with changed FEC inputs; 2 grades.
- Leading candidate E (allowance = lower of the spread test and the
  number test): S58 A118 B85 C108 D120 E40 F1. A fails on scale (Clyde E to
  A), B on concentration (Mike Johnson S 90), D cuts big donors however many.
- Live grades held 15-22 Oct (owner); the owner chooses by 19 Oct, then one
  refresh after 22 Oct under the chosen rules, before the 23 Oct races.
- Two of my bugs on the way, fixed: replay batches (discovery reads FEC
  linkages in no fixed order) and the snapshot-flag test.

---

## 2026-10-09 (night): PAC version A live; one rule for withheld grades (#57)

Owner's decision: version A, half credit, traced one level deeper, shipped
straight away. Simulated across all 536 gradable members first (dry run
38006203182), re-graded live (38007363337), then simulated again with the
dry-run fix below (38010301349): it matches the live grades for all 536.

- **The rule.** Every PAC gift to a member's campaigns and leadership PAC
  (FEC bulk files) is graded. Each PAC is looked through to its own donors
  with the members' rules, and one level further to the donors of the
  committees that fund it; half of what traces back to people counts as
  people money (`PAC_TRACING`, `tracePacs`, `pacPeopleCredit` in
  tier-calculation.js). Lobbyist/registrant PACs (FEC designation B, 77%
  of PAC money) no longer count extra; super PACs (2.0x) and other
  politicians' PACs (1.5x) still raise the bar.
- **Effect (live).** F grades 163 to 45; S12 A21 B36 C113 D183 E124 F45,
  plus 5 withheld. 286 grades change: 159 Democrats and 121 Republicans up,
  1 and 4 down. Sanders, AOC and Cantwell stay S, Pelosi B. Sensitivity:
  counting a quarter gives 104 F grades, all of it 7, none of it 152.
- **Politicians' PAC weight (owner to choose).** 1.5 (live): F45. 1.25:
  F42 (S13 A20 B37 C121 D187 E114), 27 grades differ from 1.5 (14 D, 13 R),
  all one step. 1.0: F9 (S14 A21 B41 C155 D170 E124), 129 differ from 1.5
  (81 R, 48 D). Any weight above 1 counts the whole amount toward the bar,
  so the real choice is whether this money raises the bar at all.
- **Dry-run fix (mine).** A grade-only dry run didn't load the records the
  check fetched from the FEC to fill gaps in the bulk file, so simulations
  graded 9 members on the bulk file alone and differed from production for
  them (e.g. Sheldon Whitehouse D 37 simulated, E 25 live). It now reads
  them, as production does. Earlier simulations carry the same small error.
- **Withheld reason in the list (mine).** The publish step didn't read why a
  member wasn't graded, and never renewed a reason it already held; fixed,
  and the list republished by hand (one KV write).
- **Radewagen's 0% fixed.** A complete PAC list is data even when empty
  (`pacListComplete`), so no member graded by the job takes the old
  small-donors-only fallback any more. Radewagen, Norton, James and Hinson
  were on it. Radewagen is now F at 26 (her bar is 30: other politicians'
  PACs are 31% of her money).
- **Withheld grades, one rule** (`publishedMember`): a letter grade only
  when worked out from this cycle's FEC records, matched to the member and
  reconciled. Everton Blair kept an old B from the old pipeline: the FEC
  lists no campaign committee for him, only a non-qualified PAC
  (C00901157). He now shows "?" with the reason (`withheldReason:
no-campaign-committee`).
- **Site.** The grade explanation gains a PAC step ("Some PAC money
  counts"), shown only for grades worked out this way. The PAC panel shows
  what counts, per PAC. /how explains the rule with two diagrams, the 25%
  and 100% sensitivity, why it affects parties differently (by law company
  PACs may only ask managers and shareholders; 86% of union PAC money goes
  to Democrats), and that outside spending isn't graded.
- Previous-grade line held until the owner confirms the calculations.

---

## 2026-10-09 (evening): PAC tracing simulated; owner to choose (#57)

Owner's framing: PACs aren't the problem, who fills them is. The grade
should trace PAC money to the people behind it, with the members' rules.
Built as simulation options only (`pacPeopleShare` and `options.pacWeights`
in tier-calculation.js; `--report` in the refresh job runs every version).
Production grades are unchanged. Full results on #57 (run 37998209219):

- F grades: 163 now. The full PAC list with today's weights gives 367.
  Dropping the extra weight on FEC designation B gives 151. Tracing at 25%,
  50% and 100% credit gives 114, 56 and 12, keeping the extra weight on
  super PACs and other politicians' PACs (A). With no extra weights (B) it
  gives 89, 15 and 1.
- Reference members hold everywhere (Sanders, AOC, Cantwell S; Pelosi B).
- Union PAC money traces 88% to people, company PACs 49%, trade groups 42%,
  other politicians' PACs 9% (40% one level further).
- Tracing lifts Democrats more often (A 50%: 154 of 262 up, against 108 of
  275 Republicans): the data, not a judgement.
- /how now says outside spending (super PAC ads) isn't in the grade.

---

## 2026-10-09 (later): self-funding out of the grade; every PAC; foreign agents split (#57, #59, #60, #62)

Owner: "smash out the rest". Simulated across all 536 graded members first
(GitHub Actions dry run with `--report`, run 37971367095).

- **Self-funding (#59), graded.** A candidate's own gifts and loans (FEC
  `weball`) are set aside before grading and shown on the receipt as
  "Their own money", with a plain "Self-funded" note when it's 5% or more.
  Simulation: 19 grades change; 14 self-funders move up (e.g. April
  McClain Delaney F to D, Rick Scott D to B, Sara Jacobs F to E, Doris
  Matsui F to E), 9 Democrats and 7 Republicans up. Five of the 19 aren't
  self-funders: newer FEC data since the last grading.
- **Figures that don't add up (#62).** Own money larger than fits inside
  the FEC's receipts withholds the grade (`?`): Shri Thanedar (was B) and
  Buddy Carter (was E).
- **Every PAC gift (#57), shown, not graded.** The refresh job collects
  every PAC gift to a member's campaigns and leadership PAC from the bulk
  files (the PACs' own reports, `oth` 24K/24Z): $445M across members,
  against $76M in the old top-20 lists. Each PAC's FEC type, organisation
  type (company, union, trade group, membership) and sponsor, and its own
  donors (how much from people, how much in small donations, how few gave
  half): "looking through" the PAC. Member pages show the split by kind and
  the biggest PACs with their own donors.
- **PAC weighting on the full list: NOT switched on, owner to decide.**
  Simulated: 321 grades change, 316 down (160 Democrats, 156 Republicans);
  F grades would go from 167 to 367. Most company, union and trade-group
  PACs carry FEC designation B (lobbyist/registrant), which the grade
  weighs 1.5x, so on full data the PAC bar averages 25 points (363 members
  at the 30 maximum) against 5 on the old lists. The weighting needs
  redesigning with the look-through, not switching on as it stands.
  `--pac-weights stored` stays the default.
- **Foreign agents (#60).** The DOJ's FARA register (bulk CSVs, read
  leniently: odd bytes and unescaped quotes) tells donors personally
  registered as agents (on their firm's short-form list) from colleagues
  at the same firm, and names each firm's foreign clients and countries.
  402 members have at least one donor personally registered ($2.7M in
  all). The foreign-agent flag now needs a registered agent.
- **Reference members** unchanged under both versions: Sanders S, AOC S,
  Pelosi B.

---

## 2026-10-09: grade names, what decided the grade, and PAC types (#56, #57, #58)

Presentation only: no grade changed.

- **Grade names describe the money, not the member** (#56): S People-funded,
  A Mostly people, B Leans people, C Mixed, D Leans big money, E Mostly big
  money, F Big money. "Above/Below average" were wrong (a B is about the top
  11%), and "Captured"/"Owned" accused members of something we don't
  measure. "Big money" is defined on /how as PACs and small groups of
  wealthy donors.
- **Member pages lead with what decided the grade.** S/A/B lead with what
  helped; C to F with what hurt most, whichever of PAC money, money that
  didn't come from donors, or big donations from few people cost the most.
  A rank line under the name: "Less people-funded than 77 in 100 members of
  Congress." (`headlineFor`, `rankLine` in `src/lib/explain.js`.)
- **PACs labelled by type** (#57) from the FEC codes we hold: super PAC,
  hybrid PAC, another politician's PAC, lobbyist PAC, another candidate's
  campaign, company/union/group PAC. The kinds that count more against the
  grade (super, politicians', lobbyists') are marked, with a key, and /how
  explains what a PAC is. Rows that came from a person rather than a
  committee are no longer listed as PACs: Sara Jacobs' own $925,760 was
  showing as her biggest PAC.
- **Found, not yet fixed** (#57): the PAC list, and the PAC weighting in the
  grade, come from the old pipeline's top-20 donations to the campaign
  committee only (Martin Heinrich: 20 rows, $100,000 of $1.1M). The page now
  says it's partial. The fix is the refresh job collecting every PAC
  donation from the FEC bulk files, with company/union/trade types; it
  changes the grade's PAC weighting, so it's simulated and decided by the
  owner, together with self-funding (#59) and the foreign-agent split (#60):
  one re-grade for all three.
- **Small fixes** (#58): "NATION" no longer matches "NATIONAL" (the
  National Association of Realtors was labelled a tribal nation); the home
  page counts graded members (537), not all members (539); the FEC-summary
  note says both figures are the FEC's own, so it no longer reads as
  contradicting "Checked".

---

## 2026-10-08: grade explanations rewritten so anyone can follow them

The owner read Sara Jacobs' page and found the steps unreadable
("allowance", "points", "the bar"). They now count in dollars out of every
$100 and say which line the member missed: "$8 from small donations, $28
from big donations, $13 from PACs and $51 from other places… so we start
with $36", "Of the $28 in big donations, we count $4. That leaves $12",
"Sara Jacobs would need $18 to get an E". One set of words everywhere:
small donations, big donations, PACs. Grade meanings use dollars too. The
tests check the actual sentences.

---

## 2026-10-07 (evening): every member page explains its grade

The owner's test: why does Sara Jacobs get an F? The page said "34 people
gave half the large-donor money" for an F and "4,609 people gave half"
for an S, with nothing to say which was good or bad, or why.

- **The API serves each grade's working.** `/api/member-detail` (and
  candidate detail) now carries `grade: { score, detail }`: the share from
  people, the large-donor allowance and why, points lost, and how far PAC
  money raised the bar, exactly as `workers/tier-calculation.js` computed
  it. It comes from the D1 row the endpoint already reads: no extra reads
  or writes. Letter grades only. Worker deployed.
- **"Why an F" on every member page**: a 0 to 100 scale with the grade
  bands (moved up by the PAC bar), the share from people and the share that
  counts, then numbered steps in plain words, marked good or bad.
  `src/lib/explain.js` only words the stored working; nothing is
  recalculated. Tested on Sara Jacobs, AOC and Martin Heinrich's real
  working.
- **The large-donor card says what the number means**: very concentrated,
  concentrated, typical spread, or broad base.
- **Home:** the headline sizes to its column, so "REPRESENTATIVES?" fits on
  one line at any width (on wide screens the earlier fix broke it
  mid-word). The stamps sit beside it and scale down with the window rather
  than disappearing, and the lookup is one row: ZIP, or use my location,
  then find my representatives.

**Sara Jacobs' F, from the FEC's own totals:** $929,347 of her $1.87M
(half) is her own money (candidate contributions). The method counts only
money from donors as people-funded, so her own money counts the same as PAC
money. Of the money from people, 78% is large donations, and 34 people gave
half of it (under 50, so a 10% allowance). 37% from people becomes 12%,
and the PAC bar is 3 points higher: F. **Open question for the owner:**
should a candidate's own money count against them like PAC money, or be
left out of the grade and shown on its own line? A change to the tier
maths: simulate across all members first, and the owner decides.

---

## 2026-10-07 (later): the TFP mark, red into blue, and plainer words

Owner's notes on the redesign, the same day:

- **The mark is now "TFP"** in a small round stamp. "TP" read as toilet
  paper.
- **Red into blue is back**, done quietly. Deep red and blue meet in the
  site's purple. It shows in the stamp mark, a thin rule under the header,
  a faint red and blue glow in the dark hero, the bands that used to be
  flat purple, the share card and the favicon. The grade colours are
  unchanged.
- **The words are rewritten** in plain, complete sentences. Out: slogan
  fragments ("Your ballot, side by side."), "X, not Y" lines ("We grade
  money, not views"), colon reveals, and lines like "Your neighbors don't
  know this yet." The grade meanings now state their ranges, and the
  buttons say what they do ("Find my representatives", "Share").
- **Fixed while checking:**
  - "REPRESENTATIVES?" in the home headline didn't fit a 375 px phone, and
    was being cut off. It also caused the page widening I put down to the
    stamp animation earlier today. The headline now scales down further,
    and an overlong word wraps instead of being cut.
  - A long button label ran past the edge on phones; buttons now wrap.
  - The share card dropped the end of a long headline; it now shrinks the
    text and never drops words.

---

## 2026-10-07: the site redesigned ("Receipts", owner approved)

The whole frontend was rebuilt from the owner-approved design canvas.
Every member's money is an itemized receipt and the grade is a rubber
stamp.

- **Find your representatives.** The home page starts with a ZIP code box
  and "use my location". Both are looked up in the browser against static
  files built from the Census Bureau's 119th Congress files
  (`scripts/geo/build-geo.mjs` → `public/geo/`, 3.4 MB in all; a lookup
  loads at most about 100 KB compressed). Nothing is sent anywhere; only
  the district (for example `OH-3`) is remembered, in the visitor's
  browser. A ZIP that crosses a district line offers each district, and so
  does a location within 250 m of a line. ZIPs that aren't Census ZIP areas
  (PO boxes, single buildings) fall back to location or a state picker.
- **Pages:** home (your receipts, all of Congress as one dot per member,
  how a grade is made), member (the full receipt, "N people gave half the
  big-check money", why the grade, every committee linked to its FEC
  filings, biggest donors, bundlers, foreign-agent money, biggest PACs,
  notes on the numbers), all of Congress (search, chamber, grade, sort;
  filters in the address), your ballot and each race (receipts side by
  side, a comparison table, a countdown, vote.gov), candidate receipts, and
  the method in plain English. Deep links work (`/member/{id}`,
  `/race/{key}`, `/candidate/{id}`).
- **Share cards** are drawn in the visitor's browser (1200×630) and handed
  to the phone's share sheet, or saved, with the link copied. No server
  work.
- **No pronouns.** The site doesn't know members' pronouns, so its wording
  uses names.
- **Same rules as before:** UNVERIFIED shows no figures or analyses,
  DISPUTED hides the breakdown but keeps concentration and bundlers (#40,
  #41), and every figure goes through `gradedFigures` so a page never
  contradicts its grade (#32).
- **Removed:** the old leaderboard, the Tailwind CDN script, and the
  "Overlap Tracker", which showed sample data rather than real votes.
- **Tests:** `src/lib/geo.test.js` (real places land in their districts,
  using the built files), `people.test.js` (names, seats, receipt lines,
  places), and `tier-display.test.js`, moved to the new grade module with
  the same guarantees.
- **Checked** in the browser on desktop and at phone width (375 px): no
  sideways scrolling, every control named, one h1 a page, and the ballot
  pages against a test race file.

**Known limits:** link previews on social sites show a text card, not a
picture (a static `og:image` is a follow-up). House race numbers on the
ballot come from the current district map; some states redrew their lines
for 2026, and the race page says so. Until 23 October `/api/races` answers
404, which browsers log as a console error; it's harmless.

---

## 2026-10-07: site and docs checked against the current system

**Member pages** (checked live on four kinds of member: checked,
provisional, unconfirmed identity, one-committee):

- The small-donor figure showed "*includes Candidate Committee" and the
  explainer said "+ Candidate Committee (85% discount applied)". That's
  wrong: the figure is gifts under $200 only. Other candidates'
  committees only weigh 85% less in the PAC penalty, and the PAC
  explainer now says so in plain words.
- "Data last updated" showed the old record's date. It now shows when the
  grade was computed ("Graded: …").
- The foreign-agent line said "This campaign took …" when it counts all
  committees: now "Their committees took …".
- Dates followed the visitor's browser format ("07/10/2026" reads as July
  10 to an American); now "October 7, 2026".
- Two messages still described the old collection ("still being
  collected"); reworded for members graded on one committee.

**Docs:**

- DATABASE_REFERENCE and API_STRUCTURES start with a current summary; the
  old pipeline's sections are marked historical. The free-plan limits and
  the October incidents are recorded, and the enhanced FEC limit is noted
  as ours.
- CLAUDE.md: what runs and what stays off; storage; the legacy
  `fec_mapping_*` keys.
- RUNBOOK §1: 539 members, the date moving only with refreshes, and an
  evidence-count check.
- The health alert for a short member list no longer points at a retired
  endpoint.

---

## 2026-10-07: reference members locked in tests

`workers/reference-cases.test.js` grades four reference members from their
real inputs, frozen today (`workers/fixtures/reference-members.json`: only
the fields the grade reads, no donor names). It runs in CI on every push:

- Sanders S, as a movement donor base;
- AOC S, itemized money counted as support;
- Pelosi B, on all her committees ($5.9M), never her campaign alone ($2.5M),
  the same when provisional;
- no letter grade on an unconfirmed FEC identity (Armstrong).

Regenerate the fixture only after a scoring change has been simulated and
agreed (`scripts/verify/make-reference-fixtures.mjs`).

---

## 2026-10-07: the FEC upgraded our key to 120 calls a minute

The owner asked; the FEC upgraded the same key in place. Its
`X-RateLimit-Limit` header now reads 120 (60 before; the real limit before
was 1,000 an hour). Pacing raised: the record check from 900 an hour to
about 86 a minute (5,100 an hour), and grading and races to 30 a minute.
Together they stay under 120. The rest of the first full check (about 230
members) should take hours instead of a day and a half.

---

## 2026-10-07: the 2026 races, built (ROADMAP Phase E)

Owner's go, with the four recommendations: November's ballot, provisional
grades, a Races tab, and third-party candidates who file.

- **Who's on the ballot:** campaigns that filed the FEC's pre-general report
  (12G, due 22 October), mapped to candidates through the committee links
  (wrong, replaced 2026-10-23: losers file it too).
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
