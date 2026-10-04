// Pure reconciliation rules for the refresh job (REBUILD_SPEC.md §5 step 5, §6).

/** FEC bulk-file transaction types that are itemized individual money. */
export const ITEMIZED_TYPES = new Set(['15', '15E', '11']);

/** True when a bulk row counts towards the FEC's itemized individual total. */
export function bulkRowCounts(row) {
  return ITEMIZED_TYPES.has(row.TRANSACTION_TP) && row.MEMO_CD !== 'X';
}

/** Form 3 (candidate committees) vs Form 3X (PACs, joint funds) line code. */
export function itemizedLine(committeeType) {
  return ['H', 'S', 'P'].includes(committeeType) ? 'F3-11AI' : 'F3X-11AI';
}

/** Calendar-month date ranges covering a two-year cycle (24 slices). */
export function cycleMonths(cycle) {
  const months = [];
  for (const year of [cycle - 1, cycle]) {
    for (let m = 1; m <= 12; m++) {
      const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const mm = String(m).padStart(2, '0');
      months.push({ min: `${year}-${mm}-01`, max: `${year}-${mm}-${last}` });
    }
  }
  return months;
}

/** ISO date plus n days. */
export function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

/** Days in an inclusive ISO date range. */
export function dayCount(min, max) {
  return Math.round((Date.parse(`${max}T00:00:00Z`) - Date.parse(`${min}T00:00:00Z`)) / 864e5) + 1;
}

/** Split an inclusive date range into two halves (by days). */
export function halves({ min, max }) {
  const mid = addDays(min, Math.floor(dayCount(min, max) / 2) - 1);
  return [
    { min, max: mid },
    { min: addDays(mid, 1), max },
  ];
}

/** Split a date range into days, for slices whose month count is inexact. */
export function daysIn({ min, max }) {
  const out = [];
  for (let t = Date.parse(`${min}T00:00:00Z`); t <= Date.parse(`${max}T00:00:00Z`); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push({ min: d, max: d });
  }
  return out;
}

/** Bulk-file date (MMDDYYYY) to ISO (YYYY-MM-DD), or null. */
export function bulkDate(mmddyyyy) {
  return /^\d{8}$/.test(mmddyyyy || '')
    ? `${mmddyyyy.slice(4, 8)}-${mmddyyyy.slice(0, 2)}-${mmddyyyy.slice(2, 4)}`
    : null;
}

/**
 * The money check (§6, owner decision D6b). The bulk file carries whole
 * dollars, so our total may differ from the FEC's by rounding: under $0.50
 * per record from the bulk file. Records fetched from the API carry cents.
 */
export function moneyCheck({ ourTotal, fecTotal, bulkRecordsCounted }) {
  const delta = Math.round((ourTotal - fecTotal) * 100) / 100;
  const allowance = 0.5 * bulkRecordsCounted;
  return { delta, allowance, ok: Math.abs(delta) <= allowance };
}

/**
 * A committee's verdict.
 *   reconciled            every record present, money within rounding
 *   reconciled-with-note  every record present, but the FEC's reported total
 *                         differs from its own records: published with a note (D3)
 *   mismatch              records missing that couldn't be filled: pending
 */
export function committeeVerdict({ recordsComplete, money }) {
  if (!recordsComplete) {
    return { status: 'mismatch', note: 'records missing' };
  }
  if (money.ok) {
    return { status: 'reconciled', note: null };
  }
  return {
    status: 'reconciled-with-note',
    note: `The FEC's reported itemized total differs from the sum of its own records by $${Math.abs(money.delta).toLocaleString('en-US')}`,
  };
}
