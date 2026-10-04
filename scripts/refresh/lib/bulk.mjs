// The FEC bulk file of itemized individual contributions (REBUILD_SPEC §4.11,
// §5 step 4). One file per cycle (indiv26.zip for 2026, 2.2 GB zipped). It
// unpacks to 12 GB because it holds the data twice (itcont.txt plus by_date/
// copies); only itcont.txt (5.6 GB) is extracted, which fits a standard
// GitHub runner's 14 GB disk.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { ITEMIZED_TYPES } from './reconcile.mjs';

const COLUMNS =
  'CMTE_ID,AMNDT_IND,RPT_TP,TRANSACTION_PGI,IMAGE_NUM,TRANSACTION_TP,ENTITY_TP,NAME,CITY,STATE,ZIP_CODE,EMPLOYER,OCCUPATION,TRANSACTION_DT,TRANSACTION_AMT,OTHER_ID,TRAN_ID,FILE_NUM,MEMO_CD,MEMO_TEXT,SUB_ID'.split(
    ','
  );
const COMMITTEE_ID = /^C\d{8}$/;

export const bulkUrl = cycle =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/indiv${String(cycle).slice(2)}.zip`;

/** Last-Modified and size of the FEC's current file (follows the redirect). */
export function bulkFileInfo(cycle) {
  const head = execFileSync('curl', ['-sIL', '--max-time', '60', bulkUrl(cycle)], {
    encoding: 'utf8',
  });
  const last = head
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .pop();
  return {
    lastModified: last.match(/^last-modified:\s*(.+)$/im)?.[1]?.trim() || null,
    size: Number(last.match(/^content-length:\s*(\d+)/im)?.[1] || 0),
  };
}

/**
 * Make sure dir/itcont.txt is this cycle's current file. Downloads the zip
 * only if missing or a different size from the FEC's, and extracts only
 * itcont.txt.
 */
export function ensureBulkFile(cycle, dir, log = console.log) {
  const info = bulkFileInfo(cycle);
  const zip = join(dir, `indiv${String(cycle).slice(2)}.zip`);
  const txt = join(dir, 'itcont.txt');
  if (!existsSync(zip) || statSync(zip).size !== info.size) {
    log(`downloading ${bulkUrl(cycle)} (${(info.size / 1e9).toFixed(1)} GB)`);
    execFileSync('curl', ['-sL', '--fail', '--max-time', '3600', '-o', zip, bulkUrl(cycle)]);
  }
  if (!existsSync(txt) || statSync(txt).mtimeMs < statSync(zip).mtimeMs) {
    log('extracting itcont.txt');
    execFileSync('sh', ['-c', `unzip -p '${zip}' itcont.txt > '${txt}'`]);
  }
  return { path: txt, lastModified: info.lastModified };
}

/**
 * Open DuckDB with a `bulk` table holding only the given committees' rows,
 * normalised. `counts` marks rows that are itemized individual money.
 */
export async function loadBulk(itcontPath, committeeIds) {
  const ids = [...new Set(committeeIds)];
  if (!ids.every(id => COMMITTEE_ID.test(id))) {
    throw new Error('loadBulk: invalid committee ID');
  }
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const spec = `{${COLUMNS.map(c => `'${c}':'VARCHAR'`).join(',')}}`;
  const types = [...ITEMIZED_TYPES].map(t => `'${t}'`).join(',');
  await conn.run(`
    CREATE TABLE bulk AS
    SELECT
      CMTE_ID AS committee_id,
      SUB_ID AS sub_id,
      TRANSACTION_TP AS tx_type,
      ENTITY_TP AS entity,
      NAME AS name,
      STATE AS state,
      substr(ZIP_CODE, 1, 5) AS zip5,
      EMPLOYER AS employer,
      OCCUPATION AS occupation,
      CASE WHEN regexp_matches(TRANSACTION_DT, '^[0-9]{8}$')
        THEN substr(TRANSACTION_DT,5,4)||'-'||substr(TRANSACTION_DT,1,2)||'-'||substr(TRANSACTION_DT,3,2)
      END AS date,
      CAST(TRANSACTION_AMT AS DOUBLE) AS amount,
      coalesce(MEMO_CD, '') = 'X' AS memo,
      OTHER_ID AS other_id,
      MEMO_TEXT AS memo_text,
      'bulk' AS source,
      TRANSACTION_TP IN (${types}) AND coalesce(MEMO_CD, '') <> 'X' AS counts
    FROM read_csv('${itcontPath}', delim='|', header=false, quote='', escape='',
                  columns=${spec}, ignore_errors=true)
    WHERE CMTE_ID IN (${ids.map(i => `'${i}'`).join(',')})
  `);
  // Records fetched from the API (gap fills, earmarked gifts) go here, in the
  // same shape, and replace bulk rows with the same sub_id
  await conn.run('CREATE TABLE api AS SELECT * FROM bulk LIMIT 0');
  const read = async (sql, ...params) => (await conn.runAndReadAll(sql, params)).getRowObjects();
  return { conn, read };
}

/** An API Schedule A row in the bulk table's shape. */
export function apiRowToBulkShape(r, counts) {
  const zip = String(r.contributor_zip || '').slice(0, 5);
  return {
    committee_id: r.committee_id,
    sub_id: String(r.sub_id),
    tx_type: r.receipt_type || null,
    entity: r.entity_type || null,
    name: r.contributor_name || null,
    state: r.contributor_state || null,
    zip5: zip || null,
    employer: r.contributor_employer || null,
    occupation: r.contributor_occupation || null,
    date: r.contribution_receipt_date ? r.contribution_receipt_date.slice(0, 10) : null,
    amount: r.contribution_receipt_amount,
    memo: r.memo_code === 'X',
    other_id: r.conduit_committee_id || null,
    memo_text: r.memo_text || null,
    source: 'api',
    counts,
  };
}

/** Insert API rows (bulk shape) into the `api` table, 50 at a time. */
export async function insertApiRows(conn, rows) {
  const cols = Object.keys(apiRowToBulkShape({}, false));
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    await conn.run(
      `INSERT INTO api (${cols.join(',')}) VALUES ${placeholders}`,
      batch.flatMap(r => cols.map(c => r[c] ?? null))
    );
  }
}
