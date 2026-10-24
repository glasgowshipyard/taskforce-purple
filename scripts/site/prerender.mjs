#!/usr/bin/env node
/**
 * After `vite build`: real HTML for the pages search engines and AI tools
 * should read (owner, 2026-10-16), written into dist/. Every member's page,
 * the home page, /how and /congress get their own title, description,
 * canonical address, structured data, link-preview picture and a readable
 * version of their content; the site's own script then draws the live page
 * over it. Also: sitemap.xml, llms.txt and llms-full.txt.
 *
 * Cloudflare Pages serves dist/member/S001150.html at /member/S001150; any
 * other path still gets index.html (Pages' single-page-app fallback).
 *
 * Data: members:list from the API worker, read once. If it can't be read the
 * build fails, and Pages keeps serving the last good build.
 *
 * Changes: each page's last change date carries over from the live site's
 * prerender-state.json while the page shows the same thing. On a production
 * build, pages that changed are announced to IndexNow (Bing, and through it
 * ChatGPT search, Copilot and DuckDuckGo). The refresh job starts a build only
 * when it changed the published grades (.github/workflows/refresh.yml).
 *
 *   node scripts/site/prerender.mjs [--no-images]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cardPng } from './og-card.mjs';
import {
  SITE,
  congressPage,
  fillTemplate,
  homePage,
  howPage,
  racesPage,
  correctionsPage,
  gradesCsv,
  llmsTxt,
  memberPage,
  sitemapXml,
} from './pages.mjs';

const API = 'https://taskforce-purple-api.dev-a4b.workers.dev/api';
const DIST = 'dist';
/** IndexNow's key: not a secret, it's published at /<key>.txt to prove the site is ours */
export const INDEXNOW_KEY = 'd7a4e05294d3e39e0649b9c0b0916778';
const images = !process.argv.includes('--no-images');
// Raise when the pages' wording changes, so every page counts as changed
// (sitemap dates, IndexNow) even though the facts on it didn't
const WORDING = 3;
const production = process.env.CF_PAGES === '1' && process.env.CF_PAGES_BRANCH === 'main';

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};

async function getJson(url) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

const started = Date.now();
const list = await getJson(`${API}/members`);
const members = list.members || [];
if (members.length < 500) {
  throw new Error(`members:list has ${members.length} members; refusing to build pages from it`);
}
// The lists the site reads, as plain files (owner, 2026-10-23): Pages serves
// them from its cache with no daily limit, where every call to the API
// worker counts against the free plan's 100,000 a day. The API stays the
// fallback (src/lib/api.js); the jobs rebuild the site when they publish
write(join(DIST, 'data', 'members.json'), JSON.stringify(list));
const racesList = await getJson(`${API}/races`).catch(() => null);
if (racesList) {
  write(join(DIST, 'data', 'races.json'), JSON.stringify(racesList));
}
// The live site's record of when each page last changed (empty the first time)
const before = await getJson(`${SITE}/prerender-state.json`).catch(() => ({ pages: {} }));
const today = new Date().toISOString().slice(0, 10);

const scores = members
  .filter(m => /^[SABCDEF]$/.test(m.tier) && Number.isFinite(m.individualFundingPercent))
  .map(m => m.individualFundingPercent);
const pages = [
  homePage(members),
  howPage(),
  racesPage(),
  correctionsPage(),
  congressPage(members),
  ...members.map(m => memberPage(m, scores)),
];

const template = readFileSync(join(DIST, 'index.html'), 'utf8');
const state = { builtAt: new Date().toISOString(), pages: {} };
const changed = [];
for (const page of pages) {
  const member = page.path.startsWith('/member/');
  page.image = member ? `/og${page.path}.png` : `/og${page.path === '/' ? '/home' : page.path}.png`;
  const html = fillTemplate(template, page);
  write(join(DIST, page.path === '/' ? 'index.html' : `${page.path}.html`), html);
  if (images) {
    write(join(DIST, page.image), cardPng(page.card));
  }
  const sig = createHash('sha1').update(`${WORDING}|${page.signature}`).digest('hex').slice(0, 16);
  const old = before.pages?.[page.path];
  const lastmod = old && old.sig === sig ? old.lastmod : today;
  if (!old || old.sig !== sig) {
    changed.push(page.path);
  }
  state.pages[page.path] = { sig, lastmod };
}

write(
  join(DIST, 'sitemap.xml'),
  sitemapXml(pages.map(p => ({ path: p.path, lastmod: state.pages[p.path].lastmod })))
);
write(join(DIST, 'prerender-state.json'), JSON.stringify(state));
const llms = llmsTxt(members, list.lastUpdated);
write(join(DIST, 'llms.txt'), llms.brief);
write(join(DIST, 'llms-full.txt'), llms.full);
write(join(DIST, 'grades.csv'), gradesCsv(members, list.lastUpdated));
write(join(DIST, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);

console.log(
  `prerender: ${pages.length} pages${images ? ' and preview pictures' : ''}, ${changed.length} changed since the live build, in ${((Date.now() - started) / 1000).toFixed(1)}s`
);

// Tell IndexNow what changed, on a production build only. A refusal is
// logged; it never fails the build (the sitemap still lists everything)
if (production && changed.length) {
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList: changed.slice(0, 10000).map(path => `${SITE}${path}`),
      }),
    });
    console.log(`IndexNow: told about ${changed.length} page(s), HTTP ${response.status}`);
  } catch (error) {
    console.warn(`IndexNow unreachable: ${error.message}`);
  }
}
