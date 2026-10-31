import { describe, expect, it } from 'vitest';
import { parseRawFiling, unprocessedReports } from './raw-filings.mjs';

const FS = '\x1c';
const line = cells => cells.join(FS);
// A Form 3 summary line with the coverage dates (15, 16) and line 11(a)(i) (32)
const f3 = itemized => {
  const s = Array(40).fill('');
  s[0] = 'F3N';
  s[1] = 'C00000001';
  s[15] = '20260701';
  s[16] = '20260930';
  s[32] = itemized;
  return line(s);
};
const sa = ({
  tx,
  back = '',
  entity = 'IND',
  org = '',
  last = '',
  first = '',
  amount,
  memo = '',
  text = '',
  committee = '',
}) => {
  const r = Array(45).fill('');
  Object.assign(r, {
    0: 'SA11AI',
    1: 'C00000001',
    2: tx,
    3: back,
    5: entity,
    6: `"${org}"`,
    7: `"${last}"`,
    8: `"${first}"`,
    15: 'TX',
    16: '787011234',
    19: '20260815',
    20: amount,
    25: committee,
    42: memo,
    43: `"${text}"`,
  });
  return line(r);
};
const file = (itemized, rows) =>
  ['HDR' + FS + 'FEC' + FS + '8.5', f3(itemized), ...rows].join('\n');

describe('parseRawFiling', () => {
  const rows = [
    sa({ tx: 'A1', last: 'DOE', first: 'JANE', amount: '3500.00' }),
    sa({ tx: 'A2', last: 'ROE', first: 'RICHARD', amount: '25.50', text: 'EARMARKED FROM WINRED' }),
    // The platform's own line: a memo, not counted, names the conduit
    sa({
      tx: 'C1',
      entity: 'PAC',
      org: 'WINRED',
      amount: '25.50',
      memo: 'X',
      committee: 'C00694323',
    }),
  ];

  it('takes the records when they add up to the report to the cent', () => {
    const p = parseRawFiling(file('3525.50', rows), 123);
    expect(p.ok).toBe(true);
    expect(p.report).toMatchObject({
      committeeId: 'C00000001',
      from: '2026-07-01',
      to: '2026-09-30',
    });
    const counted = p.rows.filter(r => r.counts);
    expect(counted.map(r => r.name)).toEqual(['DOE, JANE', 'ROE, RICHARD']);
    expect(counted[0]).toMatchObject({
      tx_type: '15',
      date: '2026-08-15',
      zip5: '78701',
      source: 'raw',
      file_num: '123',
    });
    expect(counted[1]).toMatchObject({ tx_type: '15E', other_id: 'C00694323' });
    expect(p.rows.find(r => r.memo).counts).toBe(false);
  });

  it('refuses a report whose records do not add up', () => {
    const p = parseRawFiling(file('3600.00', rows), 123);
    expect(p.ok).toBe(false);
    expect(p.rows).toEqual([]);
    expect(p.why).toMatch(/3525\.50.*3600\.00/);
  });

  it('refuses a file that is not a report', () => {
    expect(parseRawFiling(['HDR', line(['F6N', 'C00000001'])].join('\n'), 1).ok).toBe(false);
  });
});

describe('unprocessedReports', () => {
  const f = (file_number, start, end, receipt, form = 'F3N', committee_id = 'C00000001') => ({
    committee_id,
    file_number,
    form_type: form,
    coverage_start_date: start,
    coverage_end_date: end,
    receipt_date: receipt,
  });
  const filings = [
    f(1, '2026-04-01', '2026-06-30', '2026-07-15'),
    f(2, '2026-07-01', '2026-09-30', '2026-10-15'),
    f(3, '2026-07-01', '2026-09-30', '2026-10-20', 'F3A'),
    f(4, '2026-10-01', '2026-10-14', '2026-10-22'),
    f(5, null, null, '2026-10-25', 'F6N'),
  ];

  it('picks the newest filing of each period not yet processed', () => {
    const processed = new Map([['C00000001', { files: new Set(['1']), newest: '2026-06-30' }]]);
    expect(unprocessedReports(filings, processed).map(r => r.fileNumber)).toEqual(['3', '4']);
  });

  it('skips a period once any of its filings is processed', () => {
    const processed = new Map([
      ['C00000001', { files: new Set(['1', '2']), newest: '2026-09-30' }],
    ]);
    expect(unprocessedReports(filings, processed).map(r => r.fileNumber)).toEqual(['4']);
  });

  it('never takes a period that starts before the newest processed record', () => {
    const processed = new Map([['C00000001', { files: new Set(), newest: '2026-07-02' }]]);
    expect(unprocessedReports(filings, processed).map(r => r.fileNumber)).toEqual(['4']);
  });
});
