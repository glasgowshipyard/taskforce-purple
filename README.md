# Task Force Purple

**Who's paying your representatives?** Every member of Congress is graded,
S to F, on where their campaign money comes from: lots of different
people, a few wealthy donors, or PACs, politicians and parties. Straight
from public FEC filings, checked record by record. Live at
**https://taskforcepurple.com**.

It doesn't matter who wins if everyone loses. Task Force Purple is
one person and a cat; friends and family test it and send feedback. No ads,
no money taken, not connected to a party, campaign or PAC, and the same
rules for everyone.

## What the site does

- **Your representatives.** Enter a ZIP code or use your location to see
  your House member and senators, each as an itemized receipt with a grade
  stamped on it. The lookup runs in the browser against the Census
  Bureau's district files: a ZIP code or location is never sent anywhere.
- **A page for every member:** the receipt (every kind of money, adding up
  exactly to the total), a graph of the three sources, a numbered
  explanation of the grade, every committee raising money in their name
  (each linked to its FEC filings), PAC by PAC, where the big donors live,
  money passed on by other committees, and money from people at registered
  foreign-agent firms. Big donors are never named.
- **All of Congress**, searchable by name, state or party and filterable by
  grade and chamber, and every grade as a spreadsheet
  ([grades.csv](https://taskforcepurple.com/grades.csv)).
- **Your ballot** (from 23 October 2026): everyone running for Congress
  where you live, graded the same way, side by side.
- **Why it matters:** what research says about who pays for Congress, every
  claim linked to its source.
- **Share cards** and link previews for any member, and a way to flag a
  grade that looks wrong.

## How a grade works

1. **All their money.** Everything given to the member counts once: their
   campaigns, their leadership PAC and their own joint fundraising
   committees. Their own money, loans and transfers are left out.
2. **Three sources.** _People_: money from many different people, whether
   a check is for $5 or $5,000. _Power_: big money from only a few wealthy
   donors (the fewer donors gave half the big money, the more of it is
   Power). _Influence_: money from PACs, politicians and parties. A PAC's
   money counts as People only when the group behind it is run by its
   members (a union, for example), and only the part traced to many people.
3. **The grade is the People share.** 90% or more is an S; under 15% is an
   F. Grades come from the FEC's bulk files first, then every donation is
   checked against the FEC's own records; until then the site says the
   grade is still being checked. A grade is only about where the money
   comes from, not how a member votes, their character or the law.

The exact method: [GRASSROOTS_CALCULATION_GUIDE.md](./GRASSROOTS_CALCULATION_GUIDE.md)
and [taskforcepurple.com/how](https://taskforcepurple.com/how).

## How it's built

```
FEC bulk files + OpenFEC API ─> refresh job (GitHub Actions, scripts/refresh/)
  daily filing-calendar check     │  grades into D1, publishes to KV
  starts it after each deadline   ▼
            API worker (workers/data-pipeline.js, read-only)
                                   │
                                   ▼
        React site (src/, Cloudflare Pages, deploys on push to main)
```

- **Site:** React and Vite, no UI framework. `src/pages/` (home, member,
  all of Congress, ballot, method), `src/components/`, `src/lib/`.
  Self-hosted fonts (Archivo, IBM Plex Mono, Public Sans). Every member
  also gets a pre-built page, link-preview picture and line in llms.txt
  for search engines and AI tools (`scripts/site/`).
- **Jobs:** GitHub Actions only. A daily check of the FEC's filing calendar
  starts a refresh a few days after each deadline and keeps the member list
  in step with Congress; nothing else runs on a clock.
- **District lookup:** `public/geo/`, built by `scripts/geo/build-geo.mjs`
  from the Census Bureau's 119th Congress files.
- **Everything runs on free tiers** (Cloudflare Workers, KV, D1, Pages;
  GitHub Actions).

Start with [CLAUDE.md](./CLAUDE.md) and [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)
for the current system, and [RUNBOOK.md](./RUNBOOK.md) to check its health.

## Local development

```bash
git clone https://github.com/glasgowshipyard/taskforce-purple.git
cd taskforce-purple
npm install
npm run dev      # the site on http://localhost:3000, reading the live API
npm test         # unit tests, including the grading reference cases
npm run lint
npm run build    # the site plus its pre-built pages, from the live list
```

To see the ballot pages before the races are published, point
`VITE_RACES_URL` (in a gitignored `.env.local`) at a races file written by
`node scripts/refresh/races.mjs --field test --out <file>`.

## Data sources

- **OpenFEC API and FEC bulk files:** campaign money and donor records.
- **unitedstates/congress-legislators:** who's in Congress, and each
  member's FEC candidate IDs (identity is looked up, never guessed).
- **IRS exempt-organization files and Form 990s:** who runs each PAC's
  sponsor.
- **Justice Department FARA register:** foreign-agent firms.
- **Census Bureau:** congressional district boundaries and ZIP code areas.

## Writing

Extremely plain English, the way you'd say it to a neighbor. Apolitical,
no politician names in examples, and no "we": the site describes the data,
not itself.

## License

MIT
