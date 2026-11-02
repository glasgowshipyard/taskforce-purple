// What each pre-built page says to search engines, AI tools and link
// previews: its title, description, preview card, structured data and a
// readable version of its content (prerender.mjs writes them into dist/).
// Pure: everything comes from members:list (and races:list), worded with the
// site's own helpers, so a pre-built page says what the live page says.

import { DEFAULT_CYCLE, cycleLabel } from '../../src/lib/election.js';
import { LEFT_OUT, peopleSentence, placementLine } from '../../src/lib/explain.js';
import {
  GRADES,
  GRADE_SCOPE,
  LETTERS,
  PARTS,
  gradeInfo,
  isLetter,
  withArticle,
  withheldReasonOf,
} from '../../src/lib/grades.js';
import {
  ballotPartyName,
  displayName,
  gradedFigures,
  partyName,
  raceSeat,
  roleTitle,
  seatLabel,
  usd,
} from '../../src/lib/people.js';
import { FINDINGS, LEAD, MOTTO, STUDIES, WISHES } from '../../src/lib/research.js';
import { CORRECTIONS, KINDS, REVIEW_DAYS, inOrder } from '../../src/lib/corrections.js';
import { candidatePath, memberPath, racePath } from '../../src/lib/paths.js';
import { BOOSTED_MEANING, boostedSentence } from '../../src/lib/outside.js';

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
  'Task Force Purple grades every member of Congress, S to F, on where their campaign money comes from: many people, a few wealthy donors, or PACs and politicians. All figures from public FEC filings.';

/** A member's three parts and sentence, or null for a withheld grade */
function figures(m) {
  const ppi = m.peoplePowerInfluence;
  const graded = isLetter(m.tier) && ppi;
  return graded ? { ppi, sentence: peopleSentence(ppi.people) } : null;
}

// The cycle the list's grades are on: the newest any member is graded on
const listCycle = members =>
  members.reduce((c, m) => Math.max(c, Number(m.gradeCycle) || 0), 0) || DEFAULT_CYCLE;

// A member's own gifts and loans to their campaign (shown, never graded)
const ownOf = m =>
  (m.personFigures?.ownMoney?.contributions || 0) + (m.personFigures?.ownMoney?.loans || 0);

const HOW_LINK = '<p><a href="/how">How grades work</a></p>';

/**
 * BOOSTED (src/lib/outside.js) on a person's pre-built page, as the live
 * page shows it: the sentence in the text and the description, the stamp
 * on the preview card. Unchanged when they aren't boosted
 */
function withBoost(page, outside, raised, personId) {
  const sentence = boostedSentence(outside, raised, personId);
  if (!sentence) {
    return page;
  }
  return {
    ...page,
    description: `${page.description} ${sentence}`,
    body: page.body.replace(
      HOW_LINK,
      `<p>${esc(sentence)} ${esc(BOOSTED_MEANING)}</p>\n${HOW_LINK}`
    ),
    card: { ...page.card, boosted: true },
    signature: JSON.stringify([page.signature, sentence]),
  };
}

/** One member's page: the live page's facts, for crawlers and previews */
export const memberPage = (m, scores, outside = null) =>
  withBoost(
    memberBase(m, scores),
    outside,
    outside?.raised ?? gradedFigures(m).totalRaised,
    m.bioguideId
  );

function memberBase(m, scores) {
  const name = displayName(m.name);
  const g = gradeInfo(m.tier, m.withheldReason);
  const f = figures(m);
  const role = roleTitle(m);
  const seat = seatLabel(m);
  const party = partyName(m.party);
  const placement = f ? placementLine(m.individualFundingPercent, scores) : null;
  const path = memberPath(m.bioguideId, m.name);
  const title = f
    ? `Who funds ${name}? ${m.tier}: ${f.ppi.people}% from people${TITLE_SUFFIX}`
    : `Who funds ${name}?${TITLE_SUFFIX}`;
  const description = f
    ? `${name} (${party}, ${seat.replace(' · ', ', ')}) gets ${withArticle(m.tier)}, ${g.name}. ${f.sentence} ${f.ppi.power}% was big money from a few wealthy donors and ${f.ppi.influence}% came from PACs, politicians and parties. From public FEC filings.`
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
<p>Of all the money given to ${esc(name)}: ${f.ppi.people}% from people (many different donors), ${f.ppi.power}% from power (big money from a few wealthy donors) and ${f.ppi.influence}% from influence (PACs, politicians and parties).</p>
${raised > 0 ? `<p>Raised ${esc(usd(raised))} in the ${cycleLabel(m.gradeCycle ?? undefined)} election cycle, from public FEC filings.${m.evidenceChecked === true ? ' Every donation checked against the FEC’s records.' : m.evidenceChecked === false ? ' Still being checked against the FEC’s records.' : ''}</p>` : ''}`
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
          note: GRADE_SCOPE,
          cycle: m.gradeCycle ?? null,
        }
      : m.tier === 'SELF-FUNDED' && ownOf(m) > 0 && raised > 0
        ? {
            eyebrow: `${SHORT_TITLE[role] || role} ${name}`,
            headline: 'Self-funded',
            sub: `${name} put in ${usd(ownOf(m))} of their own: ${Math.round((ownOf(m) / raised) * 100)}% of everything the campaign raised. A campaign that's mostly the candidate's own money isn't graded.`,
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
    // Own money only where the card shows it, so no other member's page
    // counts as changed
    signature: JSON.stringify([
      m.tier,
      f?.ppi,
      placement,
      raised,
      m.evidenceChecked,
      name,
      seat,
      ...(m.tier === 'SELF-FUNDED' ? [ownOf(m)] : []),
    ]),
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
<p><strong>${esc(MOTTO)}</strong></p>
<p>${esc(LEAD.replace(/\[\d+\]/g, ''))}</p>
<h3>How wealth influences policy</h3>
<p>When the middle class wanted a policy, it had about a ${WISHES.average.few}% chance of becoming law, whether they strongly opposed or strongly supported it. When the wealthy wanted it, the chance rose from about ${WISHES.richest.few}% to ${WISHES.richest.most}% (${esc(STUDIES[0].cite)}).</p>
${FINDINGS.map(f => `<h3>${esc(f.head)}</h3>\n<p>${esc(f.text)}</p>`).join('\n')}
<ol>${STUDIES.map(st => `<li>${esc(st.cite)}, <a href="${esc(st.url)}">${esc(st.title)}</a>. ${esc(st.detail)}${st.note ? ` <a href="${esc(st.note.url)}">${esc(st.note.text)}</a>` : ''}</li>`).join('')}</ol>
</main>`,
    signature: JSON.stringify([counts, 'why-7']),
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
<p id="boosted"><strong>What does BOOSTED mean?</strong> ${esc(BOOSTED_MEANING.replace(/^BOOSTED means /, 'It means '))}</p>
<h2>The grade</h2>
<ul>${scale}</ul>
<p>Every figure comes from campaign finance reports filed with the Federal Election Commission (FEC).</p>
</main>`,
    signature: 'how-4',
  };
}

/**
 * A candidate who isn't a sitting member (races:list): their own page and
 * preview card, as a member's (owner, 2026-10-23: links shared during the
 * race showed the home page's card)
 */
export const candidatePage = (c, race, cycle, outside = null) =>
  withBoost(
    candidateBase(c, race, cycle),
    outside,
    outside?.raised ?? gradedFigures(c).totalRaised,
    c.bioguideId || c.candidateId
  );

function candidateBase(c, race, cycle) {
  const name = displayName(c.name);
  const g = gradeInfo(c.tier, withheldReasonOf(c), !c.bioguideId);
  const ppi = isLetter(c.tier) ? c.peoplePowerInfluence : null;
  const sentence = ppi ? peopleSentence(ppi.people) : null;
  const party = ballotPartyName(c);
  const seat = raceSeat(race);
  const where = seat.split(' · ').slice(1).join(' · ') || seat;
  // "Mary Peltola · Senate candidate · Alaska", as a member's card names the seat
  const eyebrow = `${name} · ${race.office === 'S' ? 'Senate' : 'House'} candidate · ${where}`;
  const path = candidatePath(c.candidateId, c.name);
  const title = ppi
    ? `Who funds ${name}? ${c.tier}: ${ppi.people}% from people${TITLE_SUFFIX}`
    : `Who funds ${name}?${TITLE_SUFFIX}`;
  const own =
    c.ownMoney > 0 && c.totalRaised > 0 ? ` They put in ${usd(c.ownMoney)} of their own.` : '';
  const description = ppi
    ? `${name} (${party}, candidate for ${seat.replace(' · ', ', ')}) gets ${withArticle(c.tier)}, ${g.name}. ${sentence} ${ppi.power}% was big money from a few wealthy donors and ${ppi.influence}% came from PACs, politicians and parties.${own} From public FEC filings.`
    : `${name} (${party}, candidate for ${seat.replace(' · ', ', ')}): ${g.meaning}`;
  return {
    path,
    title,
    description,
    card: ppi
      ? {
          eyebrow,
          headline: sentence,
          sub: `Grade ${c.tier}: ${g.name}.`,
          tier: c.tier,
          ppi,
          note: GRADE_SCOPE,
          cycle,
        }
      : c.tier === 'SELF-FUNDED' && c.ownMoney > 0 && c.totalRaised > 0
        ? {
            eyebrow,
            headline: 'Self-funded',
            sub: `${name} put in ${usd(c.ownMoney)} of their own: ${Math.round((c.ownMoney / c.totalRaised) * 100)}% of everything the campaign raised. A campaign that's mostly the candidate's own money isn't graded.`,
          }
        : { eyebrow, headline: `Who funds ${name}?`, sub: g.meaning },
    cardAlt: ppi ? `${name}: grade ${c.tier}, ${g.name}. ${sentence}` : `Who funds ${name}?`,
    jsonLd: {
      '@type': 'WebPage',
      name: title.replace(TITLE_SUFFIX, ''),
      description,
      url: `${SITE}${path}`,
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE}/` },
      about: { '@type': 'Person', name },
    },
    body: `<main class="wrap section" data-prerendered>
<p class="eyebrow"><a href="${racePath(race.key, cycle)}">${esc(seat)}</a></p>
<h1 class="display display-xl">${esc(name)}</h1>
<p class="lede">${esc(party)} · Candidate · ${esc(seat)}</p>
<h2>${ppi ? `Grade ${esc(c.tier)}: ${esc(g.name)}` : esc(g.name)}</h2>
<p>${esc(ppi ? `${sentence}${own}` : g.meaning)}</p>
${c.totalRaised > 0 ? `<p>Raised ${esc(usd(c.totalRaised))} in the ${cycleLabel(cycle)} election cycle, from public FEC filings.</p>` : ''}
<p><a href="/how">How grades work</a></p>
</main>`,
    signature: JSON.stringify([
      'candidate-1',
      c.tier,
      ppi,
      c.totalRaised,
      c.ownMoney,
      name,
      party,
      seat,
    ]),
  };
}

/** A race: its own page and preview card, the candidates by name */
export function racePage(race, cycle) {
  const seat = raceSeat(race);
  const path = racePath(race.key, cycle);
  const named = race.candidates.map(c => {
    const g = gradeInfo(c.tier, withheldReasonOf(c));
    const ppi = isLetter(c.tier) ? c.peoplePowerInfluence : null;
    return {
      name: displayName(c.name),
      party: ballotPartyName(c),
      words: ppi ? `${c.tier}, ${ppi.people}% from people` : g.name,
    };
  });
  const top = named.slice(0, 3);
  const description = `Who's paying the candidates for ${seat.replace(' · ', ', ')}: ${named
    .map(n => `${n.name} (${n.party}): ${n.words}`)
    .join('; ')}. From public FEC filings.`;
  return {
    path,
    title: `${seat}: who's paying the candidates?${TITLE_SUFFIX}`,
    description,
    card: {
      eyebrow: `${seat} · ${cycleLabel(cycle)}`,
      headline: "Who's paying the candidates?",
      sub: top.map(n => `${n.name}: ${n.words}`).join(' · '),
      note: GRADE_SCOPE,
    },
    cardAlt: `${seat}: ${top.map(n => `${n.name}, ${n.words}`).join('; ')}`,
    jsonLd: {
      '@type': 'WebPage',
      name: `${seat}: who's paying the candidates?`,
      url: `${SITE}${path}`,
    },
    body: `<main class="wrap section" data-prerendered>
<p class="eyebrow"><a href="/races">Every race for Congress</a></p>
<h1 class="display display-xl">${esc(seat)}</h1>
<p class="lede">Who's paying the candidates? ${cycleLabel(cycle)} election cycle, from public FEC filings.</p>
<ul>
${named.map(n => `<li>${esc(n.name)}, ${esc(n.party)}: ${esc(n.words)}</li>`).join('\n')}
</ul>
<p><a href="/how">How grades work</a></p>
</main>`,
    signature: JSON.stringify(['race-1', seat, named]),
  };
}

// Updates and corrections, whole (lib/corrections.js), at /updates
export function correctionsPage() {
  const items = inOrder()
    .map(
      c =>
        `<li id="${esc(c.id)}"><p><strong>${esc(KINDS[c.kind])}, ${esc(c.date)}: ${esc(c.what)}</strong></p><p>${esc(c.detail)}</p></li>`
    )
    .join('\n');
  return {
    path: '/updates',
    title: `Updates and corrections${TITLE_SUFFIX}`,
    description: "New features and fixed mistakes on this site's grades and pages, newest first.",
    card: {
      eyebrow: 'Updates and corrections',
      headline: "What's changed",
      sub: 'New features and fixed mistakes, newest first.',
    },
    cardAlt: 'Task Force Purple: updates and corrections',
    jsonLd: { '@type': 'WebPage', name: 'Updates and corrections', url: `${SITE}/updates` },
    body: `<main class="wrap section" data-prerendered>
<h1 class="display display-l">Updates and corrections</h1>
<p>New features and fixed mistakes are listed here, newest first. <a href="/updates.xml">Follow by RSS</a>.</p>
${items ? `<ol>\n${items}\n</ol>` : '<p>None so far.</p>'}
<p>Every page has a "Something wrong?" link, and reports are read within ${REVIEW_DAYS} days.</p>
</main>`,
    signature: JSON.stringify(['updates-1', CORRECTIONS]),
  };
}

/**
 * Updates and corrections as an RSS feed, /updates.xml (owner,
 * 2026-10-25), built with the site from the same list, in the page's
 * order, each item linking to its place on the page
 */
export function correctionsRss(entries = CORRECTIONS) {
  const rfc822 = iso => new Date(`${iso}T12:00:00Z`).toUTCString();
  const ordered = inOrder(entries);
  const items = ordered
    .map(
      c => `    <item>
      <title>${esc(`${KINDS[c.kind]}: ${c.what}`)}</title>
      <link>${SITE}/updates#${esc(c.id)}</link>
      <guid isPermaLink="false">${esc(`taskforcepurple-${c.id}`)}</guid>
      <pubDate>${rfc822(c.date)}</pubDate>
      <category>${esc(KINDS[c.kind])}</category>
      <description>${esc(c.detail)}</description>
    </item>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Task Force Purple: updates and corrections</title>
    <link>${SITE}/updates</link>
    <description>New features and fixed mistakes, newest first.</description>
    <language>en-us</language>
${ordered.length ? `    <lastBuildDate>${rfc822(ordered[0].date)}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`;
}

// The Races page: its words only (the races are drawn in the browser from
// races:list, which changes after the site is built)
export function racesPage() {
  const description =
    'The candidates for the House and Senate in the 2026 election, graded S to F on where their campaign money comes from, the same way as the members already there: a map of the country and every race side by side.';
  return {
    path: '/races',
    title: `Every race for Congress${TITLE_SUFFIX}`,
    description,
    card: {
      eyebrow: 'Every race for Congress',
      headline: "Who's paying the candidates?",
      sub: 'The candidates on the 2026 ballot, graded S to F.',
    },
    cardAlt: 'Task Force Purple: every race for Congress, graded',
    jsonLd: { '@type': 'WebPage', name: 'Every race for Congress', url: `${SITE}/races` },
    body: `<main class="wrap section" data-prerendered>
<h1 class="display display-xl">Every race for Congress</h1>
<p class="lede">${esc(description)}</p>
<p><a href="/ballot">Find the races where you vote</a> · <a href="/how">How grades work</a></p>
</main>`,
    signature: 'races-3',
  };
}

export function congressPage(members) {
  const rows = [...members]
    .sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)))
    .map(m => {
      const f = figures(m);
      const g = gradeInfo(m.tier, m.withheldReason);
      return `<li><a href="${memberPath(m.bioguideId, m.name)}">${esc(displayName(m.name))}</a>, ${esc(partyName(m.party))}, ${esc(seatLabel(m))}: ${f ? `${esc(m.tier)} (${esc(g.name)}), ${f.ppi.people}% from people` : esc(g.name)}</li>`;
    })
    .join('\n');
  const description = `Campaign funding grades for all ${members.length} members of Congress, S to F, from public FEC filings: how much of each member's money came from many people, a few wealthy donors, or PACs and politicians.`;
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
      name: `Campaign funding grades for every member of Congress, ${cycleLabel(listCycle(members))}`,
      description,
      url: `${SITE}/congress`,
      creator: { '@type': 'Organization', name: SITE_NAME, url: `${SITE}/` },
      temporalCoverage: `${listCycle(members) - 1}-01-01/${listCycle(members)}-12-31`,
      isAccessibleForFree: true,
      // The grades may be reused with credit (owner, 2026-10-20)
      license: 'https://creativecommons.org/licenses/by/4.0/',
      distribution: {
        '@type': 'DataDownload',
        encodingFormat: 'text/csv',
        contentUrl: `${SITE}/grades.csv`,
      },
      variableMeasured: ['Grade (S to F)', ...PARTS.map(p => `${p.label} share of money given`)],
    },
    body: `<main class="wrap section" data-prerendered>
<h1 class="display display-xl">All of Congress</h1>
<p class="lede">${esc(description)}</p>
<ul>
${rows}
</ul>
</main>`,
    signature: JSON.stringify([
      'dataset-2',
      members.map(m => [m.bioguideId, m.tier, m.peoplePowerInfluence?.people]),
    ]),
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

/**
 * Every grade as a spreadsheet (grades.csv, #67): one row per member, the
 * figures the site shows. A withheld grade has its word and no percentages.
 */
export function gradesCsv(members, lastUpdated) {
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    'bioguide_id',
    'name',
    'chamber',
    'state',
    'district',
    'party',
    'grade',
    'grade_name',
    'people_pct',
    'power_pct',
    'influence_pct',
    'total_raised',
    'records_checked',
    'cycle',
    'data_as_of',
    'page',
  ];
  const rows = [...members]
    .sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)))
    .map(m => {
      const f = figures(m);
      const g = gradeInfo(m.tier, m.withheldReason);
      const raised = m.personFigures?.totalRaised ?? m.totalRaised;
      return [
        m.bioguideId,
        displayName(m.name),
        m.chamber,
        m.state,
        m.district ?? '',
        partyName(m.party),
        isLetter(m.tier) ? m.tier : g.name,
        isLetter(m.tier) ? g.name : '',
        f ? f.ppi.people : '',
        f ? f.ppi.power : '',
        f ? f.ppi.influence : '',
        Number.isFinite(raised) ? Math.round(raised) : '',
        m.evidenceChecked === true ? 'yes' : m.evidenceChecked === false ? 'not yet' : '',
        cycleLabel(m.gradeCycle ?? undefined),
        String(lastUpdated ?? '').slice(0, 10),
        `${SITE}${memberPath(m.bioguideId, m.name)}`,
      ]
        .map(cell)
        .join(',');
    });
  return `${head.join(',')}\n${rows.join('\n')}\n`;
}

/** llms.txt: the site in brief for AI tools; llms-full.txt adds every grade */
export function llmsTxt(members, lastUpdated) {
  const graded = members.filter(m => figures(m));
  const brief = `# ${SITE_NAME}

> Task Force Purple grades all members of the U.S. Congress, S to F, on where their campaign money comes from, using public Federal Election Commission (FEC) filings. It is not connected to any party or campaign.

Every dollar given to a member (their campaigns, leadership PAC and own joint fundraising committees; their own money, loans and transfers left out) is sorted into three parts: People (money from many different people), Power (big money from a few wealthy donors) and Influence (money from PACs, including companies' PACs, politicians and parties). The grade is the People share: S is 90% or more, A 75% to 89%, B 60% to 74%, C 45% to 59%, D 30% to 44%, E 15% to 29%, F under 15%. Grades are updated after each FEC filing deadline.

## Pages

- [How grades work](${SITE}/how): the method in plain English, with the exact formula
- [All of Congress](${SITE}/congress): every member's grade
- [Every grade as text](${SITE}/llms-full.txt): one line per member, for AI tools
- [Every grade as a spreadsheet](${SITE}/grades.csv): one row per member (CSV)
- Each member has a page at ${SITE}/member/{name}-{Bioguide ID}, for example ${SITE}/member/adam-b-schiff-S001150 (the Bioguide ID alone also works)
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
      }. ${SITE}${memberPath(m.bioguideId, m.name)}`;
    });
  const full = `${brief}
## Every member's grade (${cycleLabel(listCycle(members))} election cycle, data as of ${String(lastUpdated ?? '').slice(0, 10)})

${graded.length} of ${members.length} members graded.

${lines.join('\n')}
`;
  return { brief, full };
}
