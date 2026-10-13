#!/usr/bin/env node
/**
 * The people test's evidence (owner, FINAL-2, 2026-10-12): for each
 * sponsor's EIN, its latest Form 990 and the answers in Part VI:
 *   line 6   did the organization have members or stockholders?
 *   line 7a  did members, stockholders or other persons have the power to
 *            elect or appoint one or more members of the governing body?
 *   line 7b  are any governance decisions reserved to them?
 * with Schedule O's explanation of 6 and 7a where the return gives one.
 *
 * Read from the IRS's own e-file archive (Form 990 Series Downloads): its
 * yearly index says which zip holds a return; only that return is read out
 * of the zip, by byte range, so nothing large is downloaded but the index.
 *
 *   node scripts/refresh/form990.mjs --eins FILE.json --cache DIR --out FILE.json
 *
 * FILE.json (eins): an array of nine-digit EINs. Out: { [ein]: answer }.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';

const BASE = 'https://apps.irs.gov/pub/epostcard/990/xml';
const YEARS = [2023, 2024, 2025, 2026];
const LIST_PAGE = 'https://www.irs.gov/charities-non-profits/form-990-series-downloads';

/** Download a year's index if missing. */
function ensureIndex(dir, year) {
  const path = join(dir, `index_${year}.csv`);
  if (!existsSync(path) || statSync(path).size === 0) {
    console.log(`downloading the ${year} index`);
    execFileSync('curl', [
      '-sL',
      '--fail',
      '--max-time',
      '900',
      '-o',
      path,
      `${BASE}/${year}/index_${year}.csv`,
    ]);
  }
  return path;
}

async function range(url, start, end) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.status === 206) {
      return Buffer.from(await res.arrayBuffer());
    }
    if (attempt >= 4) {
      throw new Error(`${url}: HTTP ${res.status} for a byte range`);
    }
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
}

async function size(url) {
  const res = await fetch(url, { method: 'HEAD' });
  const n = Number(res.headers.get('content-length'));
  if (!res.ok || !n) {
    throw new Error(`${url}: HTTP ${res.status}, no length`);
  }
  return n;
}

/** A zip's central directory: Map(file name -> { offset, method, compressed }). */
export async function centralDirectory(url) {
  const total = await size(url);
  const tailLen = Math.min(total, 65557);
  const tail = await range(url, total - tailLen, total - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error(`${url}: no end of central directory`);
  }
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || tail.readUInt16LE(eocd + 10) === 0xffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) {
      throw new Error(`${url}: zip64 locator missing`);
    }
    const at = Number(tail.readBigUInt64LE(loc + 8));
    const rec = await range(url, at, at + 55);
    if (rec.readUInt32LE(0) !== 0x06064b50) {
      throw new Error(`${url}: zip64 record missing`);
    }
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
  }
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const files = new Map();
  for (let i = 0; i + 46 <= cd.length && cd.readUInt32LE(i) === 0x02014b50;) {
    const method = cd.readUInt16LE(i + 10);
    const crc = cd.readUInt32LE(i + 16);
    const stamp = cd.readUInt32LE(i + 12); // time and date
    let compressed = cd.readUInt32LE(i + 20);
    let uncompressed = cd.readUInt32LE(i + 24);
    const nameLen = cd.readUInt16LE(i + 28);
    const extraLen = cd.readUInt16LE(i + 30);
    const commentLen = cd.readUInt16LE(i + 32);
    let offset = cd.readUInt32LE(i + 42);
    const name = cd.toString('utf8', i + 46, i + 46 + nameLen);
    // Zip64 sizes and offset, in that order, where the 32-bit field is full
    let e = i + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let p = e + 4;
        if (uncompressed === 0xffffffff) {
          uncompressed = Number(cd.readBigUInt64LE(p));
          p += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = Number(cd.readBigUInt64LE(p));
          p += 8;
        }
        if (offset === 0xffffffff) {
          offset = Number(cd.readBigUInt64LE(p));
        }
      }
      e += 4 + len;
    }
    files.set(name.split('/').pop(), { offset, method, compressed, uncompressed, crc, stamp });
    i += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export async function readEntry(url, entry) {
  const head = await range(url, entry.offset, entry.offset + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${url}: bad local header`);
  }
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const data = await range(url, start, start + entry.compressed - 1);
  if (entry.method === 8) {
    return inflateRawSync(data).toString('utf8');
  }
  if (entry.method === 0) {
    return data.toString('utf8');
  }
  return viaUnzip(entry, data);
}

/**
 * Methods Node can't inflate (the IRS's newer zips use Deflate64, method 9):
 * the one entry rebuilt as a zip of its own and read with Info-ZIP's unzip,
 * which has Deflate64.
 */
function viaUnzip(entry, data) {
  const name = Buffer.from('return.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(21, 4); // version needed
  local.writeUInt16LE(entry.method, 8);
  local.writeUInt32LE(entry.stamp, 10);
  local.writeUInt32LE(entry.crc, 14);
  local.writeUInt32LE(entry.compressed, 18);
  local.writeUInt32LE(entry.uncompressed, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(21, 4);
  central.writeUInt16LE(21, 6);
  central.writeUInt16LE(entry.method, 10);
  central.writeUInt32LE(entry.stamp, 12);
  central.writeUInt32LE(entry.crc, 16);
  central.writeUInt32LE(entry.compressed, 20);
  central.writeUInt32LE(entry.uncompressed, 24);
  central.writeUInt16LE(name.length, 28);
  const cdOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  const dir = mkdtempSync(join(tmpdir(), 'form990-'));
  const path = join(dir, 'one.zip');
  try {
    writeFileSync(path, Buffer.concat([local, name, data, central, name, end]));
    return execFileSync('unzip', ['-p', path, 'return.xml'], { maxBuffer: 1 << 28 }).toString(
      'utf8'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const flag = (xml, tag) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*)<`));
  if (!m) {
    return null;
  }
  const v = m[1].trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'x' ? true : v === 'false' || v === '0' ? false : null;
};
const text = (xml, tag) =>
  xml.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*)<`))?.[1]?.trim() || null;

/** Part VI lines 6, 7a and 7b, and Schedule O's word on them. */
const clip = (s, max = 600) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? `${t.slice(0, max)}…` : t) : null;
};

// Part III line 1, or its Schedule O entry where the line says "see Schedule O"
function missionOf(xml) {
  const line = text(xml, 'MissionDesc');
  if (line && !/schedule\s*o/i.test(line)) {
    return line;
  }
  for (const m of xml.matchAll(
    /<(?:\w+:)?SupplementalInformationDetail>([\s\S]*?)<\/(?:\w+:)?SupplementalInformationDetail>/g
  )) {
    const ref = text(m[1], 'FormAndLineReferenceDesc') || '';
    if (/PART\s*III\b/i.test(ref) && /(LINE|LN)?\s*1\b/i.test(ref.replace(/PART\s*III/i, ''))) {
      return text(m[1], 'ExplanationTxt') || line;
    }
  }
  return line;
}

export function partSix(xml) {
  const notes = [];
  for (const m of xml.matchAll(
    /<(?:\w+:)?SupplementalInformationDetail>([\s\S]*?)<\/(?:\w+:)?SupplementalInformationDetail>/g
  )) {
    const ref = text(m[1], 'FormAndLineReferenceDesc') || '';
    if (/PART\s*VI.*(LINE|LN)?\s*(6|7\s*A|7A|7)\b/i.test(ref)) {
      const said = (text(m[1], 'ExplanationTxt') || '').replace(/\s+/g, ' ');
      notes.push(`${ref}: ${said.slice(0, 400)}${said.length > 400 ? '…' : ''}`);
    }
  }
  return {
    members: flag(xml, 'MembersOrStockholdersInd'),
    elect: flag(xml, 'ElectionOfBoardMembersInd'),
    approve: flag(xml, 'DecisionsSubjectToApprovaInd'),
    votingMembers: Number(text(xml, 'GoverningBodyVotingMembersCnt')) || null,
    revenue: Number(text(xml, 'CYTotalRevenueAmt')) || null,
    // Part III, line 1: the organization's mission, in its own words (the
    // country label's test reads it)
    mission: clip(missionOf(xml)),
    filer: text(
      xml.match(/<(?:\w+:)?Filer>([\s\S]*?)<\/(?:\w+:)?Filer>/)?.[1] || '',
      'BusinessNameLine1Txt'
    ),
    taxYear: Number(text(xml, 'TaxYr')) || null,
    notes,
  };
}

async function zipsFor(year) {
  const page = await (await fetch(LIST_PAGE)).text();
  const re = new RegExp(`${BASE}/${year}/(${year}_TEOS_XML_[0-9A-Z]+)\\.zip`, 'g');
  return [...new Set([...page.matchAll(re)].map(m => m[1]))].sort();
}

async function main() {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  const eins = [...new Set(JSON.parse(readFileSync(arg('--eins'), 'utf8')))].filter(e =>
    /^\d{9}$/.test(e)
  );
  const cache = arg('--cache', 'form990-cache');
  const outPath = arg('--out');
  mkdirSync(cache, { recursive: true });
  const indexes = YEARS.map(y => ensureIndex(cache, y));
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  await conn.run(`CREATE TABLE want(ein VARCHAR)`);
  for (let i = 0; i < eins.length; i += 500) {
    await conn.run(
      `INSERT INTO want VALUES ${eins
        .slice(i, i + 500)
        .map(e => `('${e}')`)
        .join(',')}`
    );
  }
  const rows = (
    await conn.runAndReadAll(`
    SELECT EIN AS ein, TAX_PERIOD AS period, RETURN_TYPE AS type, OBJECT_ID AS object,
      TAXPAYER_NAME AS name, XML_BATCH_ID AS batch,
      regexp_extract(filename, 'index_([0-9]{4})', 1) AS year
    FROM read_csv([${indexes.map(f => `'${f}'`).join(',')}], header=true, all_varchar=true,
      union_by_name=true, filename=true, ignore_errors=true)
    WHERE lpad(EIN, 9, '0') IN (SELECT ein FROM want)`)
  ).getRowObjects();
  const forms = new Map(); // ein -> its Forms 990, latest first
  const any = new Map(); // ein -> latest return of any kind
  const later = (a, b) =>
    !b || a.period > b.period || (a.period === b.period && a.object > b.object);
  for (const r of rows) {
    r.ein = r.ein.padStart(9, '0');
    if (later(r, any.get(r.ein))) {
      any.set(r.ein, r);
    }
    if (r.type === '990') {
      forms.set(r.ein, [...(forms.get(r.ein) || []), r]);
    }
  }
  for (const list of forms.values()) {
    list.sort((a, b) => (later(a, b) ? -1 : 1));
  }
  // Each zip's directory, read once
  const directories = new Map();
  const dirOf = async batch => {
    if (!directories.has(batch)) {
      const year = batch.slice(0, 4);
      directories.set(batch, await centralDirectory(`${BASE}/${year}/${batch}.zip`));
    }
    return directories.get(batch);
  };
  const yearZips = new Map();
  const zipsOf = async year => {
    if (!yearZips.has(year)) {
      yearZips.set(year, await zipsFor(year));
    }
    return yearZips.get(year);
  };
  // Where a return is: the batch the index names, else (2023 has no batch
  // column, and a few returns sit in a sister zip) any of that year's zips
  const locate = async r => {
    const file = `${r.object}_public.xml`;
    const all = await zipsOf(r.year);
    // The index writes some batch names in lower case ("..._04a")
    const named = r.batch && all.includes(r.batch.toUpperCase()) ? [r.batch.toUpperCase()] : [];
    for (const b of [...named, ...all.filter(z => !named.includes(z))]) {
      const entry = (await dirOf(b)).get(file);
      if (entry) {
        return { batch: b, entry };
      }
    }
    return null;
  };
  const out = {};
  let done = 0;
  for (const [ein, list] of forms) {
    // The latest return the archive holds
    let found = null;
    const missing = [];
    for (const r of list) {
      found = await locate(r);
      if (found) {
        found.r = r;
        break;
      }
      missing.push(r.object);
    }
    if (!found) {
      out[ein] = { found: false, why: `returns ${missing.join(', ')} not in the archive's zips` };
      continue;
    }
    const { batch, entry, r } = found;
    const xml = await readEntry(`${BASE}/${batch.slice(0, 4)}/${batch}.zip`, entry);
    out[ein] = {
      found: true,
      name: r.name,
      taxPeriod: r.period,
      objectId: r.object,
      ...(missing.length
        ? { later: `newer return(s) ${missing.join(', ')} not yet in the archive` }
        : {}),
      ...partSix(xml),
    };
    if (++done % 25 === 0) {
      console.log(`${done} of ${forms.size} returns read`);
    }
  }
  for (const e of eins) {
    if (!out[e]) {
      const a = any.get(e);
      out[e] = {
        found: false,
        why: a
          ? `no Form 990 in the e-file archive since 2023; latest return: Form ${a.type}, period ${a.period}`
          : 'no return in the e-file archive since 2023',
      };
    }
  }
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(
    `${Object.values(out).filter(o => o.found).length} of ${eins.length} EINs: Form 990 found`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
