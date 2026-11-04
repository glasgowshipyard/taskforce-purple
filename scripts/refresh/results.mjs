#!/usr/bin/env node
/**
 * Who won (owner, 2026-11-04: "If they've been called they get marked").
 * Part of the daily check (calendar.yml) until every race has a result, or
 * 31 January 2027, then it stops itself. Two requests to Wikipedia (its
 * House and Senate results pages) and one read of the published races;
 * marks each called race's winner (lib/results.mjs) and writes races:list
 * once, only when there's a new result.
 * Outputs for the workflow: changed (true/false), problem (a message for
 * the alert, or empty). A failure here is alerted, never fails the daily
 * check: the rest of it still runs.
 *
 *   node scripts/refresh/results.mjs [--dry-run]
 */
import { appendFileSync } from 'node:fs';
import { sameValue } from '../../workers/member-store.js';
import { stateByName } from '../../src/lib/states.js';
import { WIKI_PAGES, wikiSeats } from './lib/ballot.mjs';
import { createCloudflare } from './lib/cloudflare.mjs';
import { applyResults } from './lib/results.mjs';
import { wikiPage } from './lib/wiki.mjs';

// As in races.mjs (importing that would run the races job)
const RACES_KEY = 'races:list';
const UNTIL = '2027-01-31';
const dryRun = process.argv.includes('--dry-run');
const log = (...a) => console.log('Results:', ...a);

async function check() {
  const today = new Date().toISOString().slice(0, 10);
  const cf = createCloudflare();
  const current = JSON.parse((await cf.kvGet(RACES_KEY)) || 'null');
  const open = (current?.races || []).filter(r => !r.result);
  if (!current || today > UNTIL || open.length === 0) {
    log(
      !current
        ? 'no races published'
        : open.length === 0
          ? 'every race has a result'
          : `stopped: past ${UNTIL}`
    );
    return { changed: false, problems: [] };
  }
  const pages = [];
  for (const office of ['H', 'S']) {
    const p = await wikiPage(WIKI_PAGES[office](current.cycle));
    pages.push({ office, title: p.title, revid: p.revid, seats: wikiSeats(p.html, office) });
  }
  const r = applyResults(current.races, pages, stateByName, current.cycle);
  log(
    `${r.marked.length} new, ${r.replaced.length} with a different winner; ` +
      `${r.races.filter(x => x.result).length} of ${r.races.length} races have a result`
  );
  for (const x of r.replaced) {
    console.log(`::warning::${x.key}: Wikipedia now has ${x.winner} winning, not ${x.before}`);
  }
  const problems = [
    ...r.unmatched.map(x => `${x.key}: ${x.name} is ticked but fits no candidate in the race`),
    ...r.unknown.map(x => `${x.label}: ${x.name} is ticked but the site has no such race`),
  ];
  problems.forEach(p => console.log(`::warning::${p}`));
  // The versions read, linked from the Races page; updated only with a new
  // result, so the list isn't rewritten for every edit to the pages
  const body = {
    ...current,
    results: Object.fromEntries(pages.map(p => [p.office, { title: p.title, revid: p.revid }])),
    races: r.races,
    updatedAt: undefined,
  };
  const changed =
    r.marked.length + r.replaced.length > 0 &&
    !sameValue({ ...current, updatedAt: undefined }, body);
  if (changed && !dryRun) {
    await cf.kvPut(RACES_KEY, JSON.stringify({ ...body, updatedAt: new Date().toISOString() }));
    log('published');
  } else if (changed) {
    log('dry run: not published');
  }
  return { changed: changed && !dryRun, problems };
}

let out;
try {
  out = await check();
} catch (error) {
  console.log(`::warning::Results check failed: ${error.message}`);
  out = { changed: false, problems: [`The results check failed: ${error.message}`] };
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${out.changed}\nproblem=${out.problems.join('; ').replace(/\n/g, ' ')}\n`
  );
}
