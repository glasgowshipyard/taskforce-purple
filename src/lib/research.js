// "Why this matters" on the home page: what research says about who pays for
// Congress. Recent work only (owner, 2026-10-17), and every figure was read
// in the study or survey itself before it went in. A finding goes in only
// with a link where a reader can check it, and a correlation is worded as
// "linked to", never as a cause. Used by the home page and its pre-built
// version (scripts/site/pages.mjs).

// Pew Research Center, American Trends Panel, 10 to 16 July 2023: the share
// of U.S. adults who say each group has too much influence over the
// decisions members of Congress make
export const SAY = {
  people: 9, // the people who live in their districts
  donors: 80, // people who donate a lot of money to political campaigns
  donorsByParty: { republicans: 83, democrats: 80 },
  asked: 8480,
  when: 'July 2023',
};

/** The sources, numbered as the page numbers them */
export const STUDIES = [
  {
    n: 1,
    cite: 'Pew Research Center (2023)',
    title: 'Money, power and the influence of ordinary people in American politics',
    detail: 'Survey of 8,480 U.S. adults, July 10 to 16, 2023.',
    url: 'https://www.pewresearch.org/politics/2023/09/19/money-power-and-the-influence-of-ordinary-people-in-american-politics/',
  },
  {
    n: 2,
    cite: 'Goel, Malkin, Gaynor, Jojic, Miler and Resnik (2023)',
    title: "Donor activity is associated with US legislators' attention to political issues",
    detail: 'PLOS ONE 18(9). Every member of the House, 1995 to 2018.',
    url: 'https://doi.org/10.1371/journal.pone.0291169',
  },
  {
    n: 3,
    cite: 'Parmigiani (2025)',
    title: 'Campaign contributions and legislative behavior: Evidence from U.S. Congress',
    detail: 'Journal of Public Economics 243. Congress, 1980 to 2014.',
    url: 'https://doi.org/10.1016/j.jpubeco.2025.105319',
  },
  {
    n: 4,
    cite: 'Fowler, Garro and Spenkuch (2020)',
    title: 'Quid Pro Quo? Corporate Returns to Campaign Contributions',
    detail: 'Journal of Politics 82(3).',
    url: 'https://doi.org/10.1086/707307',
  },
  {
    n: 5,
    cite: 'Furnas, LaPira, Hertel-Fernandez, Drutman and Kosar (2023)',
    title:
      'More than Mere Access: An Experiment on Moneyed Interests, Information Provision, and Legislative Action in Congress',
    detail: 'Political Research Quarterly 76(1). A survey of 436 congressional staff.',
    url: 'https://doi.org/10.1177/10659129221098743',
  },
];

/** What the studies found: each with the source it comes from */
export const FINDINGS = [
  {
    head: 'Donors are linked to what members talk about',
    text: 'Across 24 years of the House, the groups that gave a member money were more closely linked to the issues the member spoke about than their party, home state or committees were.',
    source: 2,
  },
  {
    head: 'Money from a few big donors is linked to less work',
    text: "Members who got more of their money from their biggest donors sponsored fewer bills, spoke less on the floor and testified before fewer committees, most of all on bills about health and social welfare. It's why our grade looks at how few donors gave half the big money.",
    source: 3,
  },
];

// Not every study agrees, and the page says so. [n] marks a source
export const CAVEAT =
  "Not every study agrees. One found no sign that a company is worth more when the candidates its PAC backs win close races.[4] A survey of congressional staff found donors were no more likely than constituents to get a meeting.[5] Whether money changes how members vote is still argued over. What these studies do find is that it's linked to what members spend their time and attention on.";

/** Text with [n] source marks, as [{ text }, { source: n }, ...] */
export function withSources(text) {
  return text
    .split(/\[(\d+)\]/)
    .map((part, i) => (i % 2 ? { source: Number(part) } : { text: part }))
    .filter(p => p.source || p.text);
}
