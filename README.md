# Task Force Purple

**Who's paying your representatives?** Every member of Congress, graded S
to F on where their campaign money really comes from: lots of regular
people, or PACs and a few big donors. Straight from public FEC filings,
checked record by record. Live at **https://taskforcepurple.com**.

We grade money, not views. No party, no ads, the same rules for everyone.

## What the site does

- **Your receipts.** Enter a ZIP code or tap "use my location" to see your
  House member and senators, each as an itemized receipt with a grade
  stamped on it. The lookup runs in the browser against the Census
  Bureau's district files: a ZIP code or location is never sent anywhere.
- **The full receipt** for every member: where the money came from, every
  committee raising money in their name (each linked to its FEC filings),
  their biggest donors, who bundled the money, money from people at
  registered foreign-agent firms, and how few donors gave half the big
  money.
- **All of Congress**, searchable and filterable by grade and chamber.
- **Your ballot** (from 23 October 2026): everyone running for Congress
  where you live, graded the same way, side by side.
- **Share cards**, drawn in the visitor's browser, for any receipt.

## How a grade works

1. **Who paid?** Everything raised in the person's name counts: campaign,
   leadership PAC and joint funds, with money moved between them counted
   once. Money from people counts in their favor, whatever the check size.
   PAC money doesn't.
2. **How few people?** Big checks are fine when thousands of people write
   them. When a handful of donors supply half the big-check money, the part
   above an allowance stops counting.
3. **Checked.** Grades are computed from the FEC's bulk files, then every
   donation is checked against the FEC's own records. Until that's done
   the site says the grade is being double-checked.

The exact method, with thresholds: [GRASSROOTS_CALCULATION_GUIDE.md](./GRASSROOTS_CALCULATION_GUIDE.md).

## How it's built

```
FEC bulk files + OpenFEC API ─> refresh job (GitHub Actions, scripts/refresh/)
                                   │  grades into D1, publishes to KV
                                   ▼
            API worker (workers/data-pipeline.js, read-only)
                                   │
                                   ▼
        React site (src/, Cloudflare Pages, deploys on push to main)
```

- **Site:** React and Vite, no UI framework. `src/pages/` (home, member,
  all of Congress, ballot, method), `src/components/`, `src/lib/`.
  Self-hosted fonts (Archivo, IBM Plex Mono, Public Sans).
- **District lookup:** `public/geo/`, built by `scripts/geo/build-geo.mjs`
  from the Census Bureau's 119th Congress files. Rebuild only when district
  lines change.
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
```

To see the ballot pages before the races are published, point
`VITE_RACES_URL` (in a gitignored `.env.local`) at a races file written by
`node scripts/refresh/races.mjs --field test --out <file>`.

## Data sources

- **OpenFEC API and FEC bulk files:** campaign money and donor records.
- **Congress.gov:** the member list.
- **Justice Department FARA registry:** foreign-agent firms.
- **Census Bureau:** congressional district boundaries and ZIP code areas.

## Writing

Extremely plain English: explain it like talking to your neighbor.
Apolitical, and no politician names in examples on the site.

## License

MIT
