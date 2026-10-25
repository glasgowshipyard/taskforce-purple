// The corrections and updates page (owner, 2026-10-23: "a changelog on any
// corrections"; 2026-10-25: and major updates, as a changelog). Kept by
// hand: real corrections and new features only, never the routine changes
// after each FEC filing or small wording changes. Newest first. Plain
// words, no "we" (CLAUDE.md). Also published as an RSS feed,
// /corrections.xml (scripts/site/pages.mjs).

// A promise kept by the admin panel: a grade flag open longer than this
// becomes an alert (workers/admin, workers/health.js)
export const REVIEW_DAYS = 3;

/** What each entry is, as its label says it */
export const KINDS = { correction: 'Correction', new: 'New' };

// { id (its address on the page and its RSS id: never change one), date,
// kind ('correction' or 'new'), what, detail }
export const CORRECTIONS = [
  {
    id: '2026-10-25-race-totals',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Race pages showed too little raised for 57 candidates',
    detail:
      "On race pages, 57 candidates who aren't in Congress showed a smaller \u201craised\u201d figure than on their own page, because money raised through their own joint fundraising committees was left out. It was a problem with this site's data. Race pages now show the same total as each candidate's own page. No grade changed.",
  },
  {
    id: '2026-10-25-boosted-hinson-alme',
    date: '2026-10-25',
    kind: 'correction',
    what: 'BOOSTED taken off Ashley Hinson and Kurt Alme',
    detail:
      'For a few hours, both carried the BOOSTED stamp, measured against too small a figure for what their campaigns raised. Against their full totals, external groups spent less to help them than their campaigns raised: $15,626,053 against $21,147,469 for Ashley Hinson, and $3,353,482 against $4,047,265 for Kurt Alme.',
  },
  {
    id: '2026-10-25-everton-blair',
    date: '2026-10-25',
    kind: 'correction',
    what: 'Everton Blair now has a grade: S',
    detail:
      "He showed no grade. His campaign committee ended its campaign in September and became a PAC, and this site's data stopped counting it as his campaign. It's counted now, for the money it raised as a campaign: he's graded S on $942,075.",
  },
  {
    id: '2026-10-25-julie-johnson',
    date: '2026-10-25',
    kind: 'correction',
    what: "Julie Johnson's grade changed from E to B",
    detail:
      "Her grade had been worked out on $60,555, her leadership PAC alone. Her campaign committee re-registered as a PAC in September, and this site's data stopped counting it as her campaign. It's counted now, for the money it raised as a campaign: she's graded B on $2,394,655.",
  },
  {
    id: '2026-10-25-super-pac-spending',
    date: '2026-10-25',
    kind: 'new',
    what: 'Super PAC spending and the BOOSTED stamp',
    detail:
      "Every member's and candidate's page now shows what super PACs and other external groups reported spending to help them win or to beat them, from the FEC's own files. A red BOOSTED stamp marks anyone those groups spent more to help than their own campaign raised. None of this money is in the grade.",
  },
];
