// Discovery from the FEC's bulk files (2026-10-04): each member's committees,
// joint funds, transfers and money totals, for every member at once.
//
// The API version (workers/person-funding.js fetchPersonFunding) costs about
// 24 FEC calls per member - 13 hours for Congress at 1,000 calls an hour.
// Here the same answers come from three zips plus a few batched API calls:
//
//   ccl{yy}.zip  candidate-committee linkages: campaigns and registered joint
//                funds per candidate, for this cycle
//   cm{yy}.zip   committee master: name, designation (P/A/J/D), type
//   oth{yy}.zip  transactions between committees: transfers in (18G) and a
//                fund's transfers out (24G/24K)
//   API          leadership PACs with their sponsors (/committees/,
//                designation D: about 10 calls), totals for up to 100
//                committees per call (/totals/{type}/), and the FEC's size
//                bands for 20 committees per call (/schedules/schedule_a/
//                by_size/: the "$2,000+" figure in the money trail, display
//                only; the FEC's band doesn't match any count of the zip's
//                cheques, so it isn't derived). About 125 calls for Congress.
//
// The decisions (which committees are the member's, which funds are their
// own, how the money combines) are the shared pure functions in
// person-funding.js, so both versions answer the same questions the same way.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  classifyTransfers,
  combineVehicleTotals,
  donorCommitteeIds,
  largestCandidateRecipient,
  selectVehicles,
} from '../../../workers/person-funding.js';

const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const yy = cycle => String(cycle).slice(2);
const zipUrl = (name, cycle) =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/${name}${yy(cycle)}.zip`;

function zipSize(url) {
  const head = execFileSync('curl', ['-sIL', '--max-time', '60', url], { encoding: 'utf8' });
  const last = head
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .pop();
  return Number(last.match(/^content-length:\s*(\d+)/im)?.[1] || 0);
}

/** Download {name}{yy}.zip if missing or changed, and extract `inner`. */
export function ensureZip(name, inner, cycle, dir, log = console.log) {
  const url = zipUrl(name, cycle);
  const zip = join(dir, `${name}${yy(cycle)}.zip`);
  const txt = join(dir, inner);
  if (!existsSync(zip) || statSync(zip).size !== zipSize(url)) {
    log(`downloading ${url}`);
    execFileSync('curl', ['-sL', '--fail', '--max-time', '1800', '-o', zip, url]);
  }
  if (!existsSync(txt) || statSync(txt).mtimeMs < statSync(zip).mtimeMs) {
    execFileSync('sh', ['-c', `unzip -p '${zip}' '${inner}' > '${txt}'`]);
  }
  return txt;
}

const csv = (path, columns) =>
  `read_csv('${path}', delim='|', header=false, quote='', ignore_errors=true, columns={${columns
    .map(c => `'${c}':'VARCHAR'`)
    .join(',')}})`;

/** Load the three zips into DuckDB. Returns { read }. */
export async function loadDiscoveryFiles(cycle, dir, log = console.log) {
  const cm = ensureZip('cm', 'cm.txt', cycle, dir, log);
  const ccl = ensureZip('ccl', 'ccl.txt', cycle, dir, log);
  const oth = ensureZip('oth', 'itoth.txt', cycle, dir, log);
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await conn.run(`CREATE TABLE cm AS SELECT CMTE_ID AS id, CMTE_NM AS name, CMTE_DSGN AS designation,
      CMTE_TP AS type FROM ${csv(cm, 'CMTE_ID,CMTE_NM,TRES_NM,CMTE_ST1,CMTE_ST2,CMTE_CITY,CMTE_ST,CMTE_ZIP,CMTE_DSGN,CMTE_TP,CMTE_PTY_AFFILIATION,CMTE_FILING_FREQ,ORG_TP,CONNECTED_ORG_NM,CAND_ID'.split(','))}`);
  await conn.run(`CREATE TABLE ccl AS SELECT CAND_ID AS candidate_id, CMTE_ID AS committee_id,
      CMTE_DSGN AS designation, FEC_ELECTION_YR AS cycle
      FROM ${csv(ccl, 'CAND_ID,CAND_ELECTION_YR,FEC_ELECTION_YR,CMTE_ID,CMTE_TP,CMTE_DSGN,LINKAGE_ID'.split(','))}`);
  // Only what discovery reads: transfers in (18G, and the rare non-memo 18J)
  // and transfers out (24G, 24K), between committees, memos dropped
  await conn.run(`CREATE TABLE oth AS SELECT CMTE_ID AS committee_id, OTHER_ID AS other_id,
      TRANSACTION_TP AS tx_type, TRY_CAST(TRANSACTION_AMT AS DOUBLE) AS amount
      FROM ${csv(oth, 'CMTE_ID,AMNDT_IND,RPT_TP,TRANSACTION_PGI,IMAGE_NUM,TRANSACTION_TP,ENTITY_TP,NAME,CITY,STATE,ZIP_CODE,EMPLOYER,OCCUPATION,TRANSACTION_DT,TRANSACTION_AMT,OTHER_ID,TRAN_ID,FILE_NUM,MEMO_CD,MEMO_TEXT,SUB_ID'.split(','))}
      WHERE TRANSACTION_TP IN ('18G', '18J', '24G', '24K') AND coalesce(MEMO_CD, '') <> 'X'
        AND OTHER_ID LIKE 'C%'`);
  const read = async (sql, ...params) => {
    const reader = await conn.runAndReadAll(sql, params);
    return reader.getRowObjectsJS();
  };
  return { read };
}

// Committee type -> the /totals/{entity_type}/ endpoint that holds it
const totalsType = type =>
  ['H', 'S'].includes(type) ? 'house-senate' : type === 'P' ? 'presidential' : 'pac-party';

async function totalsFor(fec, ids, types, cycle) {
  const out = new Map();
  const byType = new Map();
  for (const id of ids) {
    const t = totalsType(types.get(id));
    byType.set(t, [...(byType.get(t) || []), id]);
  }
  for (const [type, list] of byType) {
    for (let i = 0; i < list.length; i += 100) {
      const d = await fec(`/totals/${type}/`, {
        committee_id: list.slice(i, i + 100),
        cycle,
        per_page: 100,
      });
      for (const t of d.results || []) {
        out.set(t.committee_id, t);
      }
    }
  }
  return out;
}

// The FEC's size breakdown, $2,000-and-over band, as fetchPersonFunding uses it
async function bigChequesFor(fec, ids, cycle) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 20) {
    let page = 1;
    for (;;) {
      const d = await fec('/schedules/schedule_a/by_size/', {
        committee_id: ids.slice(i, i + 20),
        cycle,
        per_page: 100,
        page,
      });
      for (const b of d.results || []) {
        if (!out.has(b.committee_id)) {
          out.set(b.committee_id, 0);
        }
        if (b.size >= 2000) {
          out.set(b.committee_id, out.get(b.committee_id) + num(b.total));
        }
      }
      if (page >= (d.pagination?.pages || 1)) {
        break;
      }
      page++;
    }
  }
  return out;
}

// Leadership PACs and their sponsors, for the cycle: sponsor -> [committee]
async function leadershipPacs(fec, cycle) {
  const bySponsor = new Map();
  let page = 1;
  for (;;) {
    const d = await fec('/committees/', { designation: 'D', cycle, per_page: 100, page });
    for (const c of d.results || []) {
      for (const s of c.sponsor_candidate_ids || []) {
        bySponsor.set(s, [...(bySponsor.get(s) || []), c]);
      }
    }
    if (page >= (d.pagination?.pages || 1)) {
      break;
    }
    page++;
  }
  return bySponsor;
}

// Same rule as fetchPersonFunding: a big-cheque figure above the committee's
// receipts doesn't reconcile and isn't published
const reconciledBigCheques = (big, totals) =>
  big !== undefined && big !== null && totals && big <= num(totals.receipts) * 1.02 ? big : null;

/**
 * Person-level funding for many members at once, from the zips.
 * @param people [{ id, ids }]  bioguide ID and crosswalk candidate IDs
 * @returns Map bioguide ID -> fetchPersonFunding-shaped result
 */
export async function discoverPeople({ fec, db, people, cycle, log = () => {} }) {
  const { read } = db;
  const sponsored = await leadershipPacs(fec, cycle);
  const cm = new Map(
    (await read('SELECT id, name, designation, type FROM cm')).map(c => [c.id, c])
  );
  const types = new Map([...cm].map(([id, c]) => [id, c.type]));

  // 1. Each member's committees: linkages for the cycle, plus leadership PACs
  const candidateIds = [...new Set(people.flatMap(p => p.ids))];
  const links = await read(
    `SELECT candidate_id, committee_id, designation FROM ccl WHERE cycle = ? AND candidate_id IN (${candidateIds.map(() => '?').join(',') || "''"})`,
    String(cycle),
    ...candidateIds
  );
  const plans = people.map(p => {
    const found = [
      ...links
        .filter(l => p.ids.includes(l.candidate_id))
        .map(l => ({
          committee_id: l.committee_id,
          name: cm.get(l.committee_id)?.name || '',
          designation: l.designation,
          cycles: [cycle],
        })),
      ...p.ids.flatMap(id =>
        (sponsored.get(id) || []).map(c => ({
          committee_id: c.committee_id,
          name: c.name,
          designation: c.designation,
          cycles: c.cycles || [],
        }))
      ),
    ];
    for (const c of found) {
      if (!types.has(c.committee_id)) {
        types.set(c.committee_id, cm.get(c.committee_id)?.type);
      }
    }
    const vehicles = selectVehicles(found, cycle);
    return {
      ...p,
      vehicles,
      registeredJfcIds: new Set(vehicles.filter(v => v.role === 'joint').map(v => v.committeeId)),
      moneyVehicles: vehicles.filter(v => v.role !== 'joint'),
    };
  });

  // 2. Totals for every money vehicle, in batches
  const vehicleIds = [...new Set(plans.flatMap(p => p.moneyVehicles.map(v => v.committeeId)))];
  const totals = await totalsFor(fec, vehicleIds, types, cycle);
  log(`discovery: ${people.length} members, ${vehicleIds.length} campaigns and PACs`);

  // 3. Transfers in, from the zip (only vehicles with totals, as the API path)
  const withTotals = [...new Set(vehicleIds.filter(id => totals.has(id)))];
  const transfersIn = withTotals.length
    ? await read(
        `SELECT committee_id, other_id, amount FROM oth WHERE tx_type IN ('18G', '18J') AND committee_id IN (${withTotals.map(() => '?').join(',')})`,
        ...withTotals
      )
    : [];
  for (const p of plans) {
    for (const v of p.moneyVehicles) {
      v.totals = totals.get(v.committeeId) || null;
    }
    const mine = new Set(p.moneyVehicles.filter(v => v.totals).map(v => v.committeeId));
    const rows = transfersIn
      .filter(r => mine.has(r.committee_id))
      .map(r => ({
        memo_code: null,
        contribution_receipt_amount: r.amount,
        contributor_id: r.other_id,
        contributor: {
          designation: cm.get(r.other_id)?.designation,
          name: cm.get(r.other_id)?.name || '',
        },
      }));
    p.transfers = classifyTransfers(p.moneyVehicles, rows);
    for (const id of p.registeredJfcIds) {
      if (!p.transfers.jfcs.some(j => j.committeeId === id)) {
        const v = p.vehicles.find(x => x.committeeId === id);
        p.transfers.jfcs.push({ committeeId: id, name: v.name, received: 0 });
      }
    }
  }

  // 4. Funds: totals, and each unregistered fund's largest candidate recipient
  const jfcIds = [...new Set(plans.flatMap(p => p.transfers.jfcs.map(j => j.committeeId)))];
  for (const id of jfcIds) {
    if (!types.has(id)) {
      types.set(id, cm.get(id)?.type);
    }
  }
  const jfcTotals = await totalsFor(fec, jfcIds, types, cycle);
  const out = jfcIds.length
    ? await read(
        `SELECT committee_id, other_id, sum(amount) AS amount FROM oth WHERE tx_type IN ('24G', '24K')
         AND committee_id IN (${jfcIds.map(() => '?').join(',')}) GROUP BY ALL ORDER BY other_id`,
        ...jfcIds
      )
    : [];
  const big = await bigChequesFor(fec, [...new Set([...withTotals, ...jfcIds])], cycle);

  const results = new Map();
  for (const p of plans) {
    for (const v of p.moneyVehicles) {
      v.bigCheques = v.totals ? reconciledBigCheques(big.get(v.committeeId), v.totals) : null;
    }
    for (const j of p.transfers.jfcs) {
      j.registered = p.registeredJfcIds.has(j.committeeId);
      j.totals = jfcTotals.get(j.committeeId) || null;
      j.bigCheques = j.totals ? reconciledBigCheques(big.get(j.committeeId), j.totals) : null;
      if (!j.registered) {
        j.largestCandidateRecipient = largestCandidateRecipient(
          out
            .filter(r => r.committee_id === j.committeeId)
            .map(r => ({
              memo_code: null,
              recipient_committee_id: r.other_id,
              recipient_committee: {
                committee_type: types.get(r.other_id) ?? cm.get(r.other_id)?.type,
              },
              disbursement_amount: r.amount,
            }))
        );
      }
    }
    const result = combineVehicleTotals(p.moneyVehicles, p.transfers);
    results.set(p.id, { ...result, donorCommitteeIds: donorCommitteeIds(result) });
  }
  return results;
}
