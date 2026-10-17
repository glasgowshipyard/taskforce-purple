// What each pre-built page says to search engines, AI tools and link
// previews: its title, description, preview card, structured data and a
// readable version of its content (prerender.mjs writes them into dist/).
// Pure: everything comes from members:list (and races:list), worded with the
// site's own helpers, so a pre-built page says what the live page says.

import { CYCLE_LABEL } from '../../src/lib/election.js';
import { LEFT_OUT, peopleSentence, placementLine } from '../../src/lib/explain.js';
import { GRADES, LETTERS, PARTS, gradeInfo, isLetter, withArticle } from '../../src/lib/grades.js';
import { displayName, partyName, roleTitle, seatLabel, usd } from '../../src/lib/people.js';
import { FINDINGS, LEAD, STUDIES, WISHES } from '../../src/lib/research.js';

export const SITE = 'https://taskforcepurple.com';
export const SITE_NAME = 'Task Force Purple';
const TITLE_SUFFIX = ` · ${SITE_NAME}`;

export const esc = text =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SHORT_TITLE = { Senator: 'Sen.', Representative: 'Rep.', Delegate: 'Del.' };

const HOME_DESCRIPTION =
  'Task Force Purple grades every member of Congress, S to F, on where their campaign money comes from: many people, a few wealthy donors, or PACs, businesses and politicians. All figures from public FEC filings.';

/** A member's three parts and sentence, or null for a withheld grade */
function figures(m) {
  const ppi = m.peoplePowerInfluence;
  const graded = isLetter(m.tier) && ppi;
  return graded ? { ppi, sentence: peopleSentence(ppi.people) } : null;
}

/** One member's page: the live page's facts, for crawlers and previews */
export function memberPage(m, scores) {
  const name = displayName(m.name);
  const g = gradeInfo(m.tier, m.withheldReason);
  const f = figures(m);
  const role = roleTitle(m);
  const seat = seatLabel(m);
  const party = partyName(m.party);
  const placement = f ? placementLine(m.individualFundingPercent, scores) : null;
  const path = `/member/${encodeURIComponent(m.bioguideId)}`;
  const title = f
    ? `Who funds ${name}? ${m.tier}: ${f.ppi.people}% from people${TITLE_SUFFIX}`
    : `Who funds ${name}?${TITLE_SUFFIX}`;
  const description = f
    ? `${name} (${party}, ${seat.replace(' · ', ', ')}) gets ${withArticle(m.tier)}, ${g.name}. ${f.sentence} ${f.ppi.power}% was big money from a few wealthy donors and ${f.ppi.influence}% came from PACs, businesses, politicians and parties. From public FEC filings.`
    : `${name} (${party}, ${seat.replace(' · ', ', ')}): ${g.meaning}`;
  const raised = m.personFigures?.totalRaised ?? m.totalRaised;
  const body = `<main class="wrap section" data-prerendered>
<p class="eyebrow"><a href="/congress">All of Congress</a></p>
<h1 class="display display-xl">${esc(name)}</h1>
<p class="lede">${esc(party)} · ${esc(seat)}</p>
<h2>${f ? `Grade ${esc(m.tier)}: ${esc(g.name)}` : esc(g.name)}</h2>
${
  f
    ? `<p>${esc(f.sentence)}${placement ? ` ${esc(placement)}.` : ''}</p>
<p>Of all the money given to ${esc(name)}: ${f.ppi.people}% from people (many different donors), ${f.ppi.power}% from power (big money from a few wealthy donors) and ${f.ppi.influence}% from influence (PACs, businesses, politicians and parties).</p>
${raised > 0 ? `<p>Raised ${esc(usd(raised))} in the ${CYCLE_LABEL} election cycle, from public FEC filings.${m.evidenceChecked === true ? ' Every donation checked against the FEC’s records.' : m.evidenceChecked === false ? ' Still being checked against the FEC’s records.' : ''}</p>` : ''}`
    : `<p>${esc(g.meaning)}</p>`
}
<p><a href="/how">How grades work</a></p>
</main>`;
  return {
    path,
    title,
    description,
    card: f
      ? {
          eyebrow: `${SHORT_TITLE[role] || role} ${name} · ${seat.split(' · ')[1] ?? seat}`,
          headline: f.sentence,
          sub: `Grade ${m.tier}: ${g.name}.${placement ? ` ${placement}.` : ''}`,
          tier: m.tier,
          ppi: f.ppi,
        }
      : {
          eyebrow: `${SHORT_TITLE[role] || role} ${name}`,
          headline: `Who funds ${name}?`,
          sub: g.meaning,
        },
    cardAlt: f ? `${name}: grade ${m.tier}, ${g.name}. ${f.sentence}` : `Who funds ${name}?`,
    jsonLd: {
      '@type': 'WebPage',
      name: title.replace(TITLE_SUFFIX, ''),
      description,
      url: `${SITE}${path}`,
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE}/` },
      about: {
        '@type': 'Person',
        name,
        jobTitle: `${role === 'Representative' ? 'U.S. Representative' : `U.S. ${role}`}, ${seat.split(' · ')[1] ?? seat}`,
        affiliation: { '@type': 'Organization', name: `${party} Party` },
      },
    },
    body,
    // What the page shows: when this changes, the page has changed
    signature: JSON.stringify([m.tier, f?.ppi, placement, raised, m.evidenceChecked, name, seat]),
  };
}

export function homePage(members) {
  const graded = members.filter(m => isLetter(m.tier));
  const counts = LETTERS.map(l => `${l} ${graded.filter(m => m.tier === l).length}`).join(', ');
  return {
    path: '/',
    title: `${SITE_NAME}: who's paying your representatives?`,
    description: HOME_DESCRIPTION,
    card: {
      eyebrow: 'Every member of Congress, graded',
      headline: "Who's paying your representatives?",
      sub: 'Grades from S to F on where their campaign money comes from. From public FEC filings.',
    },
    cardAlt: "Task Force Purple: who's paying your representatives?",
    jsonLd: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${SITE}/`,
      description: HOME_DESCRIPTION,
    },
    body: `<main class="wrap section" data-prerendered>
<h1 class="display display-xl">Who's paying your representatives?</h1>
<p class="lede">Every member of Congress is graded on where their money comes from. Look up your representative to see who's funding them.</p>
<p>${graded.length} members graded: ${esc(counts)}.</p>
<p><a href="/congress">See every member of Congress</a> · <a href="/how">How grades work</a></p>
<h2>Why this matters to all of us</h2>
<p>${esc(LEAD.replace(/\[\d+\]/g, ''))}</p>
<h3>How wealth influences policy</h3>
<p>When the middle class wanted a policy, it had about a ${WISHES.average.few}% chance of becoming law, whether few or most of them wanted it. When the wealthy wanted it, the chance rose from about ${WISHES.richest.few}% to ${WISHES.richest.most}% (${esc(STUDIES[0].cite)}).</p>
${FINDINGS.map(f => `<h3>${esc(f.head)}</h3>\n<p>${esc(f.text)}</p>`).join('\n')}
<ol>${STUDIES.map(st => `<li>${esc(st.cite)}, <a href="${esc(st.url)}">${esc(st.title)}</a>. ${esc(st.detail)}${st.note ? ` <a href="${esc(st.note.url)}">${esc(st.note.text)}</a>` : ''}</li>`).join('')}</ol>
</main>`,
    signature: JSON.stringify([counts, 'why-3']),
  };
}

export function howPage() {
  const scale = LETTERS.map(
    l => `<li>${l}: ${esc(GRADES[l].name)}, ${esc(GRADES[l].range)} of the money from people</li>`
  ).join('');
  const parts = PARTS.map(p => `<li><strong>${p.label}:</strong> ${esc(p.about)}</li>`).join('');
  return {
    path: '/how',
    title: `How grades work${TITLE_SUFFIX}`,
    description:
      'Every dollar given to a member of Congress comes from one of three sources: People, Power and Influence. The grade is the share that comes from People, from S (90% or more) to F (under 15%).',
    card: {
      eyebrow: 'How grades work',
      headline: 'People, Power and Influence',
      sub: 'The grade is the share that comes from People.',
    },
    cardAlt: 'How Task Force Purple grades work: People, Power and Influence',
    jsonLd: { '@type': 'WebPage', name: 'How grades work', url: `${SITE}/how` },
    body: `<main class="wrap section" data-prerendered>
<h1 class="display display-xl">How grades work</h1>
<p class="lede">Every dollar given to a member of Congress comes from one of three sources: People, Power and Influence. The grade is the share that comes from People.</p>
<ul>${parts}</ul>
<p><strong>What's left out?</strong> ${esc(LEFT_OUT)}</p>
<h2>The grade</h2>
<ul>${scale}</ul>
<p>Every figure comes from campaign finance reports filed with the Federal Election Commission (FEC).</p>
</main>`,
    signature: 'how-3',
  };
}

export function congressPage(members) {
  const rows = [...members]
    .sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)))
    .map(m => {
      const f = figures(m);
      const g = gradeInfo(m.tier, m.withheldReason);
      return `<li><a href="/member/${encodeURIComponent(m.bioguideId)}">${esc(displayName(m.name))}</a>, ${esc(partyName(m.party))}, ${esc(seatLabel(m))}: ${f ? `${esc(m.tier)} (${esc(g.name)}), ${f.ppi.people}% from people` : esc(g.name)}</li>`;
    })
    .join('\n');
  const description = `Campaign funding grades for all ${members.length} members of Congress, S to F, from public FEC filings: how much of each member's money came from many people, a few wealthy donors, or PACs, businesses and politicians.`;
  return {
    path: '/congress',
    title: `All of Congress: who funds every member${TITLE_SUFFIX}`,
    description,
    card: {
      eyebrow: 'All of Congress',
      headline: 'Who funds every member of Congress?',
      sub: 'Every member graded S to F on where their campaign money comes from.',
    },
    cardAlt: 'Task Force Purple: every member of Congress graded',
    jsonLd: {
      '@type': 'Dataset',
      name: `Campaign funding grades for every member of Congress, ${CYCLE_LABEL}`,
      description,
      url: `${SITE}/congress`,
      creator: { '@type': 'Organization', name: SITE_NAME, url: `${SITE}/` },
      temporalCoverage: '2025-01-01/2026-12-31',
      isAccessibleForFree: true,
      variableMeasured: ['Grade (S to F)', ...PARTS.map(p => `${p.label} share of money given`)],
    },
    body: `<main class="wrap section" data-prerendered>
<h1 class="display display-xl">All of Congress</h1>
<p class="lede">${esc(description)}</p>
<ul>
${rows}
</ul>
</main>`,
    signature: JSON.stringify(
      members.map(m => [m.bioguideId, m.tier, m.peoplePowerInfluence?.people])
    ),
  };
}

/** The page's <head> tags and readable body, filled into the built index.html */
export function fillTemplate(template, page) {
  const url = `${SITE}${page.path}`;
  const image = `${SITE}${page.image}`;
  const json = JSON.stringify({ '@context': 'https://schema.org', ...page.jsonLd }).replace(
    /</g,
    '\\u003c'
  );
  const head = `<title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(page.cardAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${json}</script>
    <script>if(location.pathname!==${JSON.stringify(page.path).replace(/</g, '\\u003c')})document.documentElement.setAttribute('data-fallback','')</script>`;
  const start = template.indexOf('<!--page-meta-->');
  const end = template.indexOf('<!--/page-meta-->');
  if (start < 0 || end < 0 || !template.includes('<div id="root"></div>')) {
    throw new Error(
      "dist/index.html lacks the <!--page-meta--> markers or the empty #root: run 'npm run build' (vite build first)"
    );
  }
  return (
    template.slice(0, start) +
    head +
    template.slice(end + '<!--/page-meta-->'.length)
  ).replace('<div id="root"></div>', `<div id="root">${page.body}</div>`);
}

export function sitemapXml(entries) {
  const urls = entries.map(
    e => `<url><loc>${esc(`${SITE}${e.path}`)}</loc><lastmod>${e.lastmod}</lastmod></url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/** llms.txt: the site in brief for AI tools; llms-full.txt adds every grade */
export function llmsTxt(members, lastUpdated) {
  const graded = members.filter(m => figures(m));
  const brief = `# ${SITE_NAME}

> Task Force Purple grades all members of the U.S. Congress, S to F, on where their campaign money comes from, using public Federal Election Commission (FEC) filings. It is not connected to any party or campaign.

Every dollar given to a member (their campaigns, leadership PAC and own joint fundraising committees; their own money, loans and transfers left out) is sorted into three parts: People (money from many different people), Power (big money from a few wealthy donors) and Influence (money from PACs, businesses, politicians and parties). The grade is the People share: S is 90% or more, A 75% to 89%, B 60% to 74%, C 45% to 59%, D 30% to 44%, E 15% to 29%, F under 15%. Grades are updated after each FEC filing deadline.

## Pages

- [How grades work](${SITE}/how): the method in plain English, with the exact formula
- [All of Congress](${SITE}/congress): every member's grade
- [Every grade as text](${SITE}/llms-full.txt): one line per member, for AI tools
- Each member has a page at ${SITE}/member/{Bioguide ID}, for example ${SITE}/member/S001150
`;
  const lines = [...members]
    .sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)))
    .map(m => {
      const f = figures(m);
      const g = gradeInfo(m.tier, m.withheldReason);
      return `- ${displayName(m.name)} (${partyName(m.party)}, ${seatLabel(m)}): ${
        f
          ? `grade ${m.tier} (${g.name}); People ${f.ppi.people}%, Power ${f.ppi.power}%, Influence ${f.ppi.influence}%`
          : g.name
      }. ${SITE}/member/${encodeURIComponent(m.bioguideId)}`;
    });
  const full = `${brief}
## Every member's grade (${CYCLE_LABEL} election cycle, data as of ${String(lastUpdated ?? '').slice(0, 10)})

${graded.length} of ${members.length} members graded.

${lines.join('\n')}
`;
  return { brief, full };
}
