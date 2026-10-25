import { describe, expect, it } from 'vitest';
import {
  correctionsRss,
  fillTemplate,
  gradesCsv,
  llmsTxt,
  memberPage,
  sitemapXml,
} from './pages.mjs';
import { CORRECTIONS } from '../../src/lib/corrections.js';

const member = {
  bioguideId: 'S001150',
  name: 'Schiff, Adam B.',
  party: 'Democratic',
  state: 'California',
  chamber: 'Senate',
  tier: 'A',
  individualFundingPercent: 85,
  peoplePowerInfluence: { people: 85, power: 9, influence: 6 },
  totalRaised: 1000,
  evidenceChecked: true,
};
const scores = Array.from({ length: 100 }, (_, i) => i);

describe('pre-built pages', () => {
  it("a member's page says what the live page says", () => {
    const p = memberPage(member, scores);
    // The readable address (2026-10-24); /member/S001150 forwards to it
    expect(p.path).toBe('/member/adam-b-schiff-S001150');
    expect(p.title).toBe('Who funds Adam Schiff? A: 85% from people · Task Force Purple');
    expect(p.description).toMatch(
      /^Adam Schiff \(Democratic, Senate, California\) gets an A, Supported\. 85% of the money came from people\./
    );
    expect(p.body).toContain('Top 15% for grassroots funding.');
    expect(p.card).toMatchObject({ tier: 'A', headline: '85% of the money came from people.' });
    expect(p.jsonLd.about).toMatchObject({ '@type': 'Person', name: 'Adam Schiff' });
  });

  it('a withheld grade gets its meaning, no figures and no graph', () => {
    const p = memberPage({ ...member, tier: 'UNVERIFIED', peoplePowerInfluence: null }, scores);
    expect(p.title).toBe('Who funds Adam Schiff? · Task Force Purple');
    expect(p.card.tier).toBeUndefined();
    expect(p.body).not.toMatch(/\$\d/);
  });

  it('fills the template and escapes what it puts in', () => {
    const template =
      '<head><!--page-meta--><title>x</title><!--/page-meta--></head><body><div id="root"></div></body>';
    const p = { ...memberPage({ ...member, name: 'Doe, <Jane>' }, scores), image: '/og/x.png' };
    const html = fillTemplate(template, p);
    expect(html).toContain(
      '<title>Who funds &lt;Jane&gt; Doe? A: 85% from people · Task Force Purple</title>'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://taskforcepurple.com/member/jane-doe-S001150" />'
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://taskforcepurple.com/og/x.png" />'
    );
    expect(html).not.toContain('<Jane>');
    expect(html).toContain('<div id="root"><main');
    expect(() => fillTemplate('<html></html>', p)).toThrow(/page-meta/);
  });

  it('the sitemap and the AI summary list every member', () => {
    expect(sitemapXml([{ path: '/member/S001150', lastmod: '2026-10-17' }])).toContain(
      '<url><loc>https://taskforcepurple.com/member/S001150</loc><lastmod>2026-10-17</lastmod></url>'
    );
    const { brief, full } = llmsTxt([member], '2026-10-17T02:00:00Z');
    expect(brief).toMatch(/^# Task Force Purple/);
    expect(full).toContain(
      '- Adam Schiff (Democratic, Senate · California): grade A (Supported); People 85%, Power 9%, Influence 6%. https://taskforcepurple.com/member/adam-b-schiff-S001150'
    );
  });
});

describe('grades.csv (#67)', () => {
  it('one row per member, withheld grades by their word, commas quoted', () => {
    const csv = gradesCsv(
      [
        {
          bioguideId: 'X1',
          name: 'Doe, Jane',
          chamber: 'House',
          state: 'Ohio',
          district: 3,
          party: 'Democratic',
          tier: 'B',
          peoplePowerInfluence: { people: 61, power: 9, influence: 30 },
          personFigures: { totalRaised: 1234.6 },
          evidenceChecked: true,
        },
        {
          bioguideId: 'X2',
          name: 'Roe, Rich, Jr.',
          chamber: 'Senate',
          state: 'Utah',
          party: 'Republican',
          tier: 'DISPUTED',
          totalRaised: 50,
        },
      ],
      '2026-10-17T02:40:00Z'
    );
    const [head, a, b] = csv.trim().split('\n');
    expect(head.split(',')).toContain('people_pct');
    expect(a).toMatch(/^X1,Jane Doe,House,Ohio,3,Democrat\w*,B,[^,]+,61,9,30,1235,yes,/);
    expect(a).toMatch(/,2026-10-17,https:\/\/taskforcepurple\.com\/member\/jane-doe-X1$/);
    expect(b.startsWith('X2,')).toBe(true);
    expect(b).toMatch(/,,,,50,/);
  });
});

describe('corrections and updates (2026-10-25)', () => {
  it('publishes the list as an RSS feed, each item linking to its place on the page', () => {
    const xml = correctionsRss([
      { id: 'x-1', date: '2026-10-25', kind: 'correction', what: 'A & B', detail: 'Fixed <it>.' },
    ]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0">/);
    expect(xml).toContain('<title>Correction: A &amp; B</title>');
    expect(xml).toContain('<link>https://taskforcepurple.com/corrections#x-1</link>');
    expect(xml).toContain('<pubDate>Sun, 25 Oct 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<description>Fixed &lt;it&gt;.</description>');
  });

  it('every entry has a unique id, a known kind and a date', () => {
    const ids = CORRECTIONS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CORRECTIONS) {
      expect(['correction', 'new']).toContain(c.kind);
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.what && c.detail).toBeTruthy();
    }
  });
});
