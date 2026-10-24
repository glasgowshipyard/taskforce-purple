# Roadmap

What should happen next, and when. `IMPLEMENTATION_STATUS.md` records what
has happened; GitHub issues hold the detail. Updated 2026-10-18. The July
roadmap (the pre-rebuild phases) is in `docs/history/roadmap-2026-07.md`.

## Dates that run themselves

| When            | What happens                                                                                                                                                                          | Watch for                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 22 October 2026 | Candidates' pre-general reports due (12G)                                                                                                                                             |                                                                          |
| 23 October      | The races job grades everyone on November's ballot (Wikipedia's lists matched to the FEC) and publishes the ballot pages; then the candidates' record check runs and re-grades them   | The ballot pages appear; candidates move from "being checked" to checked |
| 25 October      | The daily calendar check starts the members' refresh for the pre-general reports (grade-only, then the check)                                                                         | Grades published; a `system-alert` issue if anything fails               |
| 27 October      | The races job's second run (late filings), then it switches itself off                                                                                                                |                                                                          |
| 3 November      | Election day                                                                                                                                                                          |                                                                          |
| 3 December      | Post-general reports (30G) due; the calendar check refreshes on the 6th                                                                                                               |                                                                          |
| 3 January 2027  | About 60 new members sworn in: the calendar check's roster update adds them (graded on the campaign that won their seat) and takes off those who left, once the public roster updates | Arrivals graded within a day or two of the roster updating               |
| 31 January 2027 | Year-end reports (the last of the 2026 cycle)                                                                                                                                         |                                                                          |
| 1 May 2027      | Grades move to the 2028 cycle (`gradingCycle`, after the Q1 2027 reports)                                                                                                             | Cycle labels change to 2027–28 on the next publish                       |

## Next, by hand

0. **The Races page after 3 November** (owner, 2026-10-24: planned for
   after the 3rd). (a) Once a race is decided, a plain "Won" tag on the
   winner's card and "Won by …" under the race's name: no trophy (beside
   a grade it reads as the site celebrating, or mocking, the winner). A
   winner is marked only from the state's certified result, linked; until
   then "Results not yet certified". Louisiana's December runoffs, and any
   in Georgia, stay current until decided. (b) With no race current: "No
   races right now", and the 2026 races below as they stood on election
   day (the money voters saw), the first page of the Flux Capacitor (#73).
1. **TypeScript conversion (#72)**, after the election: Workers first, then
   the refresh job (code the job's Node runs stays JavaScript until then).
2. **PACs.csv download (#67)**: grades.csv is live; add each PAC's group,
   the FEC's sponsor field's group and the fact that decides it (also the
   list of PACs sorted differently from the FEC that #65 asked for).
3. **PAC data clean-up**: #68 (American Kennel Club PAC: BUSINESS), #69
   (the 24 sponsors not yet tested), #70 (PACs that name a sponsor but give
   the FEC no sponsor type). Each changes grades: simulate first.
4. **The "current trajectory" view** (REBUILD_SPEC §9): before 1 May 2027,
   show the 2028 cycle's money so far beside the 2026 grade.
5. **Retries with growing gaps** (REBUILD_SPEC §8): a member whose refresh
   fails retries on the next refresh; §8 asks for 1, 3 and 7 days.
6. **The intermittent D1 error 7403 (#64)**: log the full error when it
   happens; retry once.

## Ideas, not scheduled

- **Flux Capacitor (#73), after the election:** sitting members' past
  cycles (from 2016 or 2018) behind the graph's cycle badge, then former
  members; graded once from the bulk files, with the caveats on #73.

- **Outside spending (#71):** super PACs for and against each member, shown
  beside the grade, not in it.
- **Connected organisations (#33):** the conduit and earmarked parts are
  live; connected-organisation lookups are left.
- **Member biography and re-election (#18).**

## Parked (owner's call)

**Phase D, before a big audience** (do it in one sitting):

1. Route the API through taskforcepurple.com for edge caching (the Cache API
   does nothing on workers.dev).
2. Untrack remaining internal docs; decide whether scrubbing git history is
   worth it (the old keys were rotated on 2026-09-27).
3. Re-check `.gitleaks.toml`'s allowlist.

**Dropped:** stock trading (too subjective to grade, owner 2026-10-17).

## Standing habits

- `npm test` before touching grading; simulate every grading change across
  all members, with named reference members, before it goes live.
- After every push, check each CI job for that commit.
- A member with implausible figures: check their crosswalk entry
  (`workers/fec-crosswalk.js`), then re-grade them (RUNBOOK §8).
- A dated entry in `IMPLEMENTATION_STATUS.md` for every significant change.
