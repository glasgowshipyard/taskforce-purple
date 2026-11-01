// The Justice Department's foreign-agent register (FARA), from its bulk
// files (#60): each registered firm's foreign clients and the individuals
// registered to do the work for them ("short-form" registrants). Small files
// (under 1 MB zipped each), fetched again only when they change.
//
// Matching donors to them (lib/analysis.mjs): a donor who works at a
// registered firm is a weak signal (a 2,000-lawyer firm may have six foreign
// clients and 14 people doing that work); a donor whose own name is on the
// firm's short-form list is personally registered as a foreign agent.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = ['FARA_All_ShortForms', 'FARA_All_ForeignPrincipals'];
const url = name => `https://efile.fara.gov/bulk/zip/${name}.csv.zip`;

function remoteSize(u) {
  const head = execFileSync('curl', ['-sIL', '--max-time', '60', u], { encoding: 'utf8' });
  const last = head
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .pop();
  return Number(last.match(/^content-length:\s*(\d+)/im)?.[1] || 0);
}

/** The text with every byte that isn't valid UTF-8 left out (what `iconv -c` does) */
export const dropInvalidUtf8 = buf =>
  new TextDecoder('utf-8').decode(buf).replaceAll('\uFFFD', '');

/** Download the register's files if missing or changed. Returns their CSV paths. */
export function ensureFara(dir, log = console.log) {
  const out = {};
  for (const name of FILES) {
    const zip = join(dir, `${name}.zip`);
    const csv = join(dir, `${name}.csv`);
    if (!existsSync(zip) || statSync(zip).size !== remoteSize(url(name))) {
      log(`downloading ${url(name)}`);
      execFileSync('curl', ['-sL', '--fail', '--max-time', '300', '-o', zip, url(name)]);
    }
    if (!existsSync(csv) || statSync(csv).mtimeMs < statSync(zip).mtimeMs) {
      // The DOJ's files carry the odd byte that isn't valid UTF-8 (an
      // address in line 174 of the short forms, 2026-10-09), which DuckDB
      // refuses: drop such bytes. Not with `iconv -c`, which on Linux exits
      // 1 whenever it drops one, so every run from 31 October went without
      // the register
      const raw = execFileSync('unzip', ['-p', zip, `${name}.csv`], { maxBuffer: 1 << 28 });
      writeFileSync(csv, dropInvalidUtf8(raw));
    }
    out[name] = csv;
  }
  return { shortForms: out.FARA_All_ShortForms, principals: out.FARA_All_ForeignPrincipals };
}

// Governments, ministries, embassies and the like, as named in the filings.
// Anything else is shown as a company or organisation, never guessed further.
const GOVERNMENT =
  /\b(government|ministry|embassy|consulate|republic|kingdom|state of|office of the president|prime minister|presidency|parliament|central bank|armed forces|department of|federal|royal|sultanate|emirate)\b/i;

export const isGovernment = name => GOVERNMENT.test(name || '');
