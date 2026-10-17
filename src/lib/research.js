// "Why this matters" on the home page: what research says about who pays for
// Congress. Every figure was read in the study itself before it went in. A
// finding goes in only with a link where a reader can check it, a
// correlation is worded as "linked to", never as a cause, and where serious
// work disagrees the source note says so. Used by the home page and its
// pre-built version (scripts/site/pages.mjs).

// Gilens and Page (2014): the chance a proposed policy change became law,
// with everyone else's wishes held steady, when one in five ("few") or four
// in five ("most") of a group wanted it. Middle class (median income): about
// 0.3 either way. Wealthy (90th percentile of income): about 18% and 45%
export const WISHES = {
  average: { few: 30, most: 30 },
  richest: { few: 18, most: 45 },
};

// Opening line. [n] marks a source
export const LEAD =
  "Money doesn't have to buy a vote to matter. Studies link it to whose wishes become law, who gets a meeting and what members spend their time on. Whether it changes votes is still argued over.[3]";

/** The sources, numbered as the page numbers them */
export const STUDIES = [
  {
    n: 1,
    cite: 'Gilens and Page (2014)',
    title: 'Testing Theories of American Politics: Elites, Interest Groups, and Average Citizens',
    detail: 'Perspectives on Politics 12(3). 1,779 policy questions, 1981 to 2002.',
    note: {
      text: 'Enns (2015) points out that the richest and everyone else usually want the same things.',
      url: 'https://doi.org/10.1017/S1537592715002315',
    },
    url: 'https://doi.org/10.1017/S1537592714001595',
  },
  {
    n: 2,
    cite: 'Kalla and Broockman (2016)',
    title:
      'Campaign Contributions Facilitate Access to Congressional Officials: A Randomized Field Experiment',
    detail: 'American Journal of Political Science 60(3). Real meeting requests to 191 offices.',
    note: {
      text: 'A 2023 survey asking congressional staff about made-up requests found no difference (Furnas and others).',
      url: 'https://doi.org/10.1177/10659129221098743',
    },
    url: 'https://doi.org/10.1111/ajps.12180',
  },
  {
    n: 3,
    cite: 'Goel, Malkin, Gaynor, Jojic, Miler and Resnik (2023)',
    title: "Donor activity is associated with US legislators' attention to political issues",
    detail: 'PLOS ONE 18(9). Every member of the House, 1995 to 2018.',
    url: 'https://doi.org/10.1371/journal.pone.0291169',
  },
  {
    n: 4,
    cite: 'Parmigiani (2025)',
    title: 'Campaign contributions and legislative behavior: Evidence from U.S. Congress',
    detail: 'Journal of Public Economics 243. Congress, 1980 to 2014.',
    url: 'https://doi.org/10.1016/j.jpubeco.2025.105319',
  },
];

/** What the studies found: each with the source it comes from */
export const FINDINGS = [
  {
    head: 'Donors get the meetings',
    text: 'A political group asked 191 congressional offices for meetings. When the office was told the visitors were donors, the member or a top aide was three to four times as likely to meet them.',
    source: 2,
  },
  {
    head: 'Donors are linked to what members talk about',
    text: 'Over 24 years in the House, the groups that paid a member were a better guide to what that member talked about than their party, home state or committees.',
    source: 3,
  },
  {
    head: 'Money from a few big donors is linked to less work',
    text: "Members who relied more on their biggest donors put forward fewer bills, gave fewer speeches and spoke at fewer hearings, especially on health and welfare. That's why our grade checks how few donors gave half the big money.",
    source: 4,
  },
];

/** Text with [n] source marks, as [{ text }, { source: n }, ...] */
export function withSources(text) {
  return text
    .split(/\[(\d+)\]/)
    .map((part, i) => (i % 2 ? { source: Number(part) } : { text: part }))
    .filter(p => p.source || p.text);
}
