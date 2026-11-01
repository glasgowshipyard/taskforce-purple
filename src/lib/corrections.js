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
    id: '2026-11-01-pac-gifts-reports',
    date: '2026-11-01',
    kind: 'correction',
    what: "Four candidates' grades were too low",
    detail:
      "Some campaigns list a PAC's gift without the PAC's FEC number, and from 31 October those gifts were left out. They're now matched to the PACs' own reports. A fault in reading the FEC's lists of reports also skipped some campaigns' reports, so their donors weren't counted. Jim Desmond went from A to S, Ray Pooley from D to B, Missi Hesketh from B to A and Martin Zamora from C to B.",
  },
  {
    id: '2026-10-31-donor-records',
    date: '2026-10-31',
    kind: 'correction',
    what: 'Grades count every donor on the October reports',
    detail:
      'Grades only used donor records as far as the FEC had processed them, weeks behind the totals. They now count every donor on reports filed through 14 October. Ken Paxton went from C to E.',
  },
  {
    id: '2026-10-31-ballot-lines',
    date: '2026-10-31',
    kind: 'correction',
    what: 'Your ballot: new district lines in nine states',
    detail:
      'Alabama, California, Florida, Louisiana, North Carolina, Ohio, Tennessee, Texas and Utah redrew their districts for this election, but finding your ballot by ZIP code still used the old lines. It now uses the new ones, from the Census Bureau.',
  },
  {
    id: '2026-10-31-texas-26',
    date: '2026-10-31',
    kind: 'correction',
    what: 'Texas 26 was missing for four days',
    detail:
      "Texas's 26th district was left off the races list from 27 October while a campaign not on the ballot was checked. It's back, and so is New Jersey's 7th, which was missing for about an hour.",
  },
  {
    id: '2026-10-31-darline-graham',
    date: '2026-10-31',
    kind: 'correction',
    what: 'Darline Graham: no grade to D',
    detail:
      "This site's data didn't have Darline Graham's FEC registration, so the senator's page showed no grade. It's now graded D. Fund for America's Future counts only from July, when it became Darline Graham's PAC.",
  },
  {
    id: '2026-10-31-pac-lists',
    date: '2026-10-31',
    kind: 'correction',
    what: "PAC lists match each campaign's own reports",
    detail:
      "PAC lists came from the PACs' own reports, which don't always match the campaigns', so some added up to more than the PAC total. They now come from each campaign's own reports, including the ones the FEC hasn't processed yet. Six members' grades moved a letter: three up and three down.",
  },
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
      "Julie Johnson's campaign became a PAC in September, and this site's data left it out. It's now counted and graded B on $2,394,655.",
  },
  {
    id: '2026-10-25-everton-blair',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Everton Blair: no grade to S',
    detail:
      "Everton Blair's campaign became a PAC in September, and this site's data left it out. It's now counted and graded S on $942,075.",
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
