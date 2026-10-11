#!/usr/bin/env node
/**
 * Capture a frozen snapshot for the simplification simulation (owner's
 * brief, 2026-10-11): the FEC's bulk files as they are now, and every FEC API
 * answer the simulation needs, recorded once, so every run grades the same
 * data. Reads KV and D1; writes nothing to either.
 *
 *   node scripts/simulate/snapshot.mjs --dir DIR [--cycle 2026]
 *
 * Writes into DIR:
 *   the bulk zips (indiv, oth, cm, ccl, weball, webk)
 *   manifest.json       when, and each file's FEC date and size
 *   api-cache.json      every API answer discovery got (replayed later)
 *   pac-totals.json     the FEC's totals for every PAC that gave to a member,
 *                       and every committee that gave to those PACs (F8)
 *   flags.json          committees whose FEC totals include a report our
 *                       itemized records don't have yet, with how much
 *   members-list.json, members.json   the published list and KV records
 *   committees.json     the record check's status per committee (D1)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEC_CROSSWALK } from '../../workers/fec-crosswalk.js';
import { crosswalkIdsFor } from '../../workers/fec-identity.js';
import { LIST_KEY, memberKey } from '../../workers/member-store.js';
import { cycleForYear } from '../../workers/tier-calculation.js';
import { ensureBulkFile } from '../refresh/lib/bulk.mjs';
import { RESULTS_DB, createCloudflare } from '../refresh/lib/cloudflare.mjs';
import { discoverPeople, loadDiscoveryFiles, totalsType } from '../refresh/lib/discovery.mjs';
import { createFecClient, recordingFec } from '../refresh/lib/fec.mjs';
import { loadStored } from '../refresh/lib/gap-store.mjs';
import { pacGifts, upstreamGifts } from '../refresh/lib/pacs.mjs';
import { ITEMIZED_TYPES } from '../refresh/lib/reconcile.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const IDS = /^C\d{8}$/;
const IMAGE = /^\d{18}$/;

/** The FEC's Last-Modified and size for a bulk file (follows the redirect). */
function remoteInfo(url) {
  const head = execFileSync('curl', ['-sIL', '--max-time', '60', url], { encoding: 'utf8' });
  const last = head
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .pop();
  return {
    lastModified: last.match(/^last-modified:\s*(.+)$/im)?.[1]?.trim() || null,
    size: Number(last.match(/^content-length:\s*(\d+)/im)?.[1] || 0),
  };
}

async function main() {
  const dir = arg('--dir');
  if (!dir) {
    throw new Error('--dir is required');
  }
  mkdirSync(dir, { recursive: true });
  const cycle = Number(arg('--cycle', cycleForYear(new Date().getUTCFullYear())));
  const yy = String(cycle).slice(2);
  const capturedAt = new Date().toISOString();
  const cf = createCloudflare();
  const d1 = (sql, params) => cf.d1(RESULTS_DB, sql, params);
  const cache = {};
  const fec = recordingFec(createFecClient(process.env.FEC_API_KEY), cache);
  const save = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data));
  log(`snapshot for cycle ${cycle}, started ${capturedAt}`);

  // 1. The members as published now, and their stored records
  const list = JSON.parse(await cf.kvGet(LIST_KEY));
  const records = {};
  for (const m of list.members) {
    records[m.bioguideId] = JSON.parse((await cf.kvGet(memberKey(m.bioguideId))) || 'null');
  }
  save('members-list.json', list);
  save('members.json', records);
  log(`${list.members.length} members and their records`);

  // 2. The bulk files, with the FEC's date for each as downloaded
  const files = {};
  const names = ['indiv', 'oth', 'cm', 'ccl', 'weball', 'webk'];
  for (const name of names) {
    files[`${name}${yy}`] = remoteInfo(
      `https://www.fec.gov/files/bulk-downloads/${cycle}/${name}${yy}.zip`
    );
  }
  const itcont = ensureBulkFile(cycle, dir, log);
  const db = await loadDiscoveryFiles(cycle, dir, log);
  for (const [key, info] of Object.entries(files)) {
    const size = statSync(join(dir, `${key}.zip`)).size;
    if (size !== info.size) {
      // The FEC replaced it between the check and the download
      files[key] = {
        ...remoteInfo(`https://www.fec.gov/files/bulk-downloads/${cycle}/${key}.zip`),
        changedDuringCapture: true,
      };
    }
    files[key].downloadedSize = size;
  }
  log(
    `bulk files: ${Object.entries(files)
      .map(([k, v]) => `${k} ${v.lastModified}`)
      .join('; ')}`
  );

  // 3. Each member's committees and money, every API answer recorded
  const people = list.members
    .map(m => ({ id: m.bioguideId, ids: crosswalkIdsFor(m.bioguideId, FEC_CROSSWALK) }))
    .filter(p => p.ids.length);
  const discovered = await discoverPeople({ fec, db, people, cycle, log });
  log(`discovery: ${discovered.size} members, ${fec.calls} FEC calls`);

  // 4. Every PAC that gave to a member's campaign or leadership PAC, and the
  // committees that gave to those PACs (as the refresh job finds them)
  const givers = new Set();
  const poolIds = new Set();
  for (const pf of discovered.values()) {
    const vehicles = (pf.committees || [])
      .filter(c => c.role === 'campaign' || c.role === 'leadership')
      .map(c => c.committeeId);
    for (const g of await pacGifts(db, vehicles)) {
      givers.add(g.id);
    }
    for (const id of [...(pf.donorCommitteeIds || []), ...vehicles]) {
      poolIds.add(id);
    }
  }
  const upstream = await upstreamGifts(db, [...givers]);
  const pacIds = new Set([...givers, ...[...upstream.values()].flatMap(u => u.map(x => x.id))]);
  log(`${givers.size} giving PACs, ${pacIds.size - givers.size} more committees funding them`);

  // 5. The FEC's own totals for every one of them, 100 a call (F8)
  const types = new Map((await db.read('SELECT id, type FROM cm')).map(c => [c.id, c.type]));
  const byType = new Map();
  for (const id of pacIds) {
    const t = totalsType(types.get(id));
    byType.set(t, [...(byType.get(t) || []), id]);
  }
  const pacTotals = {};
  for (const [type, ids] of byType) {
    for (let i = 0; i < ids.length; i += 100) {
      const d = await fec(`/totals/${type}/`, {
        committee_id: ids.slice(i, i + 100),
        cycle,
        per_page: 100,
      });
      for (const t of d.results || []) {
        pacTotals[t.committee_id] = t;
      }
    }
  }
  save('pac-totals.json', pacTotals);
  log(`FEC totals for ${Object.keys(pacTotals).length} of ${pacIds.size} PACs and committees`);

  // 6. Committees whose FEC totals include a report our itemized records
  // don't have: the newest record's page number is before the first page of
  // the FEC's latest report
  const totals = new Map(Object.entries(pacTotals));
  for (const [key, body] of Object.entries(cache)) {
    if (key.startsWith('/totals/')) {
      for (const t of body.results || []) {
        totals.set(t.committee_id, t);
      }
    }
  }
  const check = [...new Set([...poolIds, ...pacIds])].filter(id => IDS.test(id));
  const types15 = [...ITEMIZED_TYPES].map(t => `'${t}'`).join(',');
  const maxImage = new Map(
    (
      await db.read(`
        WITH ids(id) AS (VALUES ${check.map(id => `('${id}')`).join(',')})
        SELECT CMTE_ID AS id, max(IMAGE_NUM) AS image
        FROM read_csv('${itcont.path}', delim='|', header=false, quote='', escape='', ignore_errors=true,
          columns={'CMTE_ID':'VARCHAR','AMNDT_IND':'VARCHAR','RPT_TP':'VARCHAR','TRANSACTION_PGI':'VARCHAR',
            'IMAGE_NUM':'VARCHAR','TRANSACTION_TP':'VARCHAR','ENTITY_TP':'VARCHAR','NAME':'VARCHAR','CITY':'VARCHAR',
            'STATE':'VARCHAR','ZIP_CODE':'VARCHAR','EMPLOYER':'VARCHAR','OCCUPATION':'VARCHAR','TRANSACTION_DT':'VARCHAR',
            'TRANSACTION_AMT':'VARCHAR','OTHER_ID':'VARCHAR','TRAN_ID':'VARCHAR','FILE_NUM':'VARCHAR','MEMO_CD':'VARCHAR',
            'MEMO_TEXT':'VARCHAR','SUB_ID':'VARCHAR'})
        WHERE CMTE_ID IN (SELECT id FROM ids) AND TRANSACTION_TP IN (${types15})
          AND coalesce(MEMO_CD, '') <> 'X' AND regexp_matches(IMAGE_NUM, '^[0-9]{18}$')
        GROUP BY 1`)
    ).map(r => [r.id, r.image])
  );
  const flags = [];
  for (const id of check) {
    const t = totals.get(id);
    const latest = t?.last_beginning_image_number;
    if (!t || !IMAGE.test(latest || '') || !(Number(t.individual_itemized_contributions) > 0)) {
      continue;
    }
    let image = maxImage.get(id) || '';
    if (image >= latest) {
      continue;
    }
    // A member's committee: the record check may have fetched the report
    if (poolIds.has(id)) {
      const stored = await loadStored(d1, id, cycle);
      for (const r of [...stored.gap, ...stored.earmarked]) {
        if (IMAGE.test(String(r.image_number || '')) && String(r.image_number) > image) {
          image = String(r.image_number);
        }
      }
      if (image >= latest) {
        continue;
      }
    }
    const reports =
      (await fec(`/committee/${id}/reports/`, { cycle, per_page: 100 })).results || [];
    const missing = reports.filter(
      r =>
        r.most_recent !== false &&
        IMAGE.test(r.beginning_image_number || '') &&
        r.beginning_image_number > image
    );
    const missingItemized = missing.reduce(
      (s, r) => s + (Number(r.individual_itemized_contributions_period) || 0),
      0
    );
    if (missingItemized > 0) {
      flags.push({
        id,
        member: poolIds.has(id),
        pac: pacIds.has(id),
        newestRecordImage: image || null,
        latestReportImage: latest,
        latestReport: t.last_report_type_full || null,
        coverageEnd: t.coverage_end_date || null,
        reportsMissing: missing.map(r => r.report_type),
        missingItemized: Math.round(missingItemized * 100) / 100,
        itemizedTotal: Number(t.individual_itemized_contributions) || 0,
      });
    }
  }
  save('flags.json', flags);
  log(`${flags.length} committees whose FEC totals include a report our records lack`);

  // 7. The record check's state, as the simulation will read it
  save(
    'committees.json',
    await d1('SELECT committee_id, status, checked_at FROM committees WHERE cycle = ?', [cycle])
  );

  save('api-cache.json', cache);
  save('manifest.json', {
    capturedAt,
    finishedAt: new Date().toISOString(),
    cycle,
    files,
    fecCalls: fec.calls,
    counts: {
      members: list.members.length,
      withIdentity: people.length,
      discovered: discovered.size,
      givingPacs: givers.size,
      committees: pacIds.size,
      pacTotals: Object.keys(pacTotals).length,
      flagged: flags.length,
      apiAnswers: Object.keys(cache).length,
    },
    cloudflare: cf.stats,
  });
  log(`done: ${fec.calls} FEC calls, ${Object.keys(cache).length} answers recorded`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
