// The corrections page (owner, 2026-10-23: "a changelog on any corrections").
// Kept by hand: only real corrections, never the routine changes after each
// FEC filing. Newest first. Plain words, no "we" (CLAUDE.md).

// A promise kept by the admin panel: a grade flag open longer than this
// becomes an alert (workers/admin, workers/health.js)
export const REVIEW_DAYS = 3;

export const CORRECTIONS = [
  {
    date: '2026-10-23',
    what: "For about an hour on the morning of October 23, the ballot pages listed some people who aren't on the ballot. The pages were taken down and put back up that evening.",
    detail:
      "The first version took its list of candidates from the reports campaigns file just before the election. Some campaigns still file that report after losing a primary or when their member is retiring, so the pages listed people who aren't on the ballot. Who's running now comes from published lists of candidates, each matched to the candidate's own registration with the FEC and checked against those reports.",
  },
  {
    date: '2026-10-18',
    what: "Two members' details were corrected: Kevin Kiley (California 3) is an Independent, not a Republican, and Matt Van Epps represents Tennessee 7, not Tennessee 8.",
    detail:
      "Both were checked against the House Clerk's list of members. Neither grade changed. Before the fix, ZIP codes in Tennessee 7 didn't find Matt Van Epps.",
  },
  {
    date: '2026-10-17',
    what: "David Schweikert's grade moved from F to E.",
    detail:
      "His campaign reported $145,852 that came through other politicians' joint fundraising committees twice: once as transfers and again as the individual donations behind them. It was counted twice in his grade. Money from other politicians' joint funds now counts no more than the campaign reports receiving.",
  },
];
