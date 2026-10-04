// Reconcile one committee's records with the FEC (REBUILD_SPEC.md §5 step 5,
// §6). Needs a `bulk` table loaded with the committee's rows (bulk.mjs).
//
// 1. Missing individual records: the bulk file is a subset of the FEC's
//    `is_individual=true` set, so compare counts - whole committee first
//    (one call), then by month (and day, where a month's count is only an
//    estimate) - and fetch only the slices that differ.
// 2. Earmarked gifts the FEC doesn't flag individual (a person's gift through
//    a PAC conduit): one call per committee.
// 3. The money check against the FEC's itemized total.

import {
  classifyScheduleARow,
  countsAsItemizedIndividual,
} from '../../../workers/schedule-a-classify.js';
import { apiRowToBulkShape, insertApiRows } from './bulk.mjs';
import { scheduleACount, scheduleAPages } from './fec.mjs';
import {
  addDays,
  committeeVerdict,
  dayCount,
  halves,
  itemizedLine,
  moneyCheck,
} from './reconcile.mjs';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const countsApi = r => countsAsItemizedIndividual(classifyScheduleARow(r));

export async function reconcileCommittee({ fec, bulk, committeeId, cycle, log = () => {} }) {
  const { conn, read } = bulk;
  const totals = (await fec(`/committee/${committeeId}/totals/`, { cycle })).results?.[0] || null;
  const fecTotal = num(totals?.individual_itemized_contributions);
  const line = itemizedLine(totals?.committee_type);
  const base = { committee_id: committeeId, two_year_transaction_period: cycle };

  const bulkIds = new Set(
    (await read('SELECT sub_id FROM bulk WHERE committee_id = ?', committeeId)).map(r => r.sub_id)
  );
  const bulkInRange = async ({ min, max }) =>
    (
      await read(
        'SELECT count(*)::INTEGER n FROM bulk WHERE committee_id = ? AND date BETWEEN ? AND ?',
        committeeId,
        min,
        max
      )
    )[0].n;

  // 1. Missing individual records
  const gap = new Map();
  let recordsComplete = true;
  let fetchedSlices = 0;
  const whole = await scheduleACount(fec, { ...base, is_individual: true });

  // Binary search on dates: a range whose count differs is split in half
  // (one count call each) until it is small enough to fetch. Each missing
  // record costs a handful of count calls, not whole months of pages.
  const FETCH_AT_MOST = 1000;
  let rangesCounted = 0;
  async function fetchRange(range) {
    fetchedSlices++;
    let fetched = 0;
    await scheduleAPages(
      fec,
      {
        ...base,
        is_individual: true,
        ...(range.min ? { min_date: range.min } : {}),
        ...(range.max ? { max_date: range.max } : {}),
      },
      rows => {
        fetched += rows.length;
        for (const r of rows) {
          if (!bulkIds.has(String(r.sub_id))) {
            gap.set(String(r.sub_id), r);
          }
        }
      }
    );
    return fetched;
  }
  async function checkRange(range) {
    const api = await scheduleACount(fec, {
      ...base,
      is_individual: true,
      ...(range.min ? { min_date: range.min } : {}),
      ...(range.max ? { max_date: range.max } : {}),
    });
    rangesCounted++;
    if (api.count === 0) {
      return 0;
    }
    const ours = await bulkInRange({
      min: range.min || '0000-01-01',
      max: range.max || '9999-12-31',
    });
    if (api.exact && api.count === ours) {
      return api.count;
    }
    const open = !range.min || !range.max;
    const oneDay = !open && dayCount(range.min, range.max) === 1;
    if (open || oneDay || (api.exact && api.count <= FETCH_AT_MOST)) {
      const fetched = await fetchRange(range);
      if (api.exact && fetched !== api.count) {
        recordsComplete = false;
        log(
          `  ${committeeId} ${range.min || '…'}..${range.max || '…'}: FEC count ${api.count}, fetched ${fetched}`
        );
      }
      return fetched;
    }
    let sum = 0;
    for (const half of halves(range)) {
      sum += await checkRange(half);
    }
    return sum;
  }

  if (!(whole.exact && whole.count === bulkIds.size)) {
    const start = `${cycle - 1}-01-01`;
    const end = `${cycle}-12-31`;
    // Records dated before or after the cycle's two years, then the years
    const found =
      (await checkRange({ min: null, max: addDays(start, -1) })) +
      (await checkRange({ min: start, max: end })) +
      (await checkRange({ min: addDays(end, 1), max: null }));
    if (whole.exact && found !== whole.count) {
      // e.g. records with no date at all, which no date range can find
      recordsComplete = false;
      log(`  ${committeeId}: ranges account for ${found} of the FEC's ${whole.count} records`);
    }
  }

  // 2. Earmarked gifts not flagged individual (one call; usually none)
  const earmarked = [];
  await scheduleAPages(
    fec,
    { ...base, line_number: line, is_individual: false, contributor_type: 'individual' },
    rows => {
      for (const r of rows) {
        if (!bulkIds.has(String(r.sub_id)) && !gap.has(String(r.sub_id))) {
          earmarked.push(r);
        }
      }
    }
  );

  const gapRows = [...gap.values()];
  await insertApiRows(conn, [
    ...gapRows.map(r => apiRowToBulkShape(r, countsApi(r))),
    ...earmarked.map(r => apiRowToBulkShape(r, countsApi(r))),
  ]);

  // 3. Money
  const [b] = await read(
    'SELECT coalesce(sum(amount) FILTER (WHERE counts), 0) total, count(*) FILTER (WHERE counts)::INTEGER n FROM bulk WHERE committee_id = ?',
    committeeId
  );
  const apiCounted = [...gapRows, ...earmarked].filter(countsApi);
  const ourTotal =
    num(b.total) + apiCounted.reduce((s, r) => s + num(r.contribution_receipt_amount), 0);
  const money = moneyCheck({ ourTotal, fecTotal, bulkRecordsCounted: b.n });
  const verdict = committeeVerdict({ recordsComplete, money });

  return {
    committeeId,
    name: totals?.committee_name || null,
    committeeType: totals?.committee_type || null,
    fecItemizedTotal: fecTotal,
    fecIndividualCount: whole.count,
    fecCountExact: whole.exact,
    bulkCount: bulkIds.size,
    gapFilled: gapRows.length,
    earmarkedExtra: earmarked.length,
    fetchedSlices,
    rangesCounted,
    ourItemizedTotal: Math.round(ourTotal * 100) / 100,
    money,
    ...verdict,
    gapRows,
    earmarkedRows: earmarked,
  };
}
