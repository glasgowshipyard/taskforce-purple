// Updates and corrections, at /updates (owner, 2026-10-23: "a changelog on
// any corrections"; 2026-10-25: major updates too, first, at /updates). Kept by
// hand: real corrections and new features only, never the routine changes
// after each FEC filing or small wording changes. Newest first. Plain
// words, no "we" (CLAUDE.md). Also published as an RSS feed,
// /updates.xml (scripts/site/pages.mjs).

// A promise kept by the admin panel: a grade flag open longer than this
// becomes an alert (workers/admin, workers/health.js)
export const REVIEW_DAYS = 3;

/** What each entry is, as its label says it */
export const KINDS = { correction: 'Correction', new: 'New' };

// { id (its address on the page and its RSS id: never change one), date,
// kind ('new' or 'correction'), what, detail }. Shown newest day first,
// new features above corrections within a day (inOrder)
export const CORRECTIONS = [
  {
    id: '2026-10-25-super-pac-spending',
    date: '2026-10-25',
    kind: 'new',
    what: 'Super PAC spending and BOOSTED',
    detail:
      'Pages now show what super PACs and other external groups spent to help or beat each candidate. BOOSTED marks anyone they spent more to help than their own campaign raised. None of it is in the grade.',
  },
  {
    id: '2026-10-25-missing-races',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Two races were missing for about an hour',
    detail:
      "Indiana's 4th and Michigan's 10th districts were left off while two campaigns not on the ballot were checked. Both races are back.",
  },
  {
    id: '2026-10-25-julie-johnson',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Julie Johnson: E to B',
    detail:
      "Julie Johnson's campaign became a PAC in September, and this site's data left it out. It's now counted, and graded B on $2,394,655.",
  },
  {
    id: '2026-10-25-everton-blair',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Everton Blair: no grade to S',
    detail:
      "Everton Blair's campaign became a PAC in September, and this site's data left it out. It's now counted, and graded S on $942,075.",
  },
  {
    id: '2026-10-25-boosted-hinson-alme',
    date: '2026-10-25',
    kind: 'correction',
    what: 'BOOSTED removed from Ashley Hinson and Kurt Alme',
    detail:
      'Their stamps were measured against too small a total. Against their full totals, external groups spent less to help them than their campaigns raised.',
  },
  {
    id: '2026-10-25-race-totals',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Race pages: totals for 57 candidates',
    detail:
      "Race pages left out money from these candidates' own joint fundraising committees. They now match each candidate's own page. No grade changed.",
  },
];

/** Newest day first; on the same day, new features above corrections */
export const inOrder = (entries = CORRECTIONS) =>
  [...entries].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || (a.kind === 'new' ? 0 : 1) - (b.kind === 'new' ? 0 : 1)
  );
