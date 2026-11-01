import { describe, expect, it } from 'vitest';
import {
  campaignPacGifts,
  committeeByName,
  parseRawFiling,
  unprocessedReports,
} from './raw-filings.mjs';

const FS = '\x1c';
const line = cells => cells.join(FS);
// A Form 3 summary line with the coverage dates (15, 16) and line 11(a)(i) (32)
const f3 = (itemized, pacs = '0.00') => {
  const s = Array(40).fill('');
  s[0] = 'F3N';
  s[1] = 'C00000001';
  s[15] = '20260701';
  s[16] = '20260930';
  s[32] = itemized;
  s[36] = pacs;
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
const file = (itemized, rows, pacs) =>
  ['HDR' + FS + 'FEC' + FS + '8.5', f3(itemized, pacs), ...rows].join('\n');
const pac = (tx, committee, amount, memo = '') =>
  sa({ tx, entity: 'PAC', org: 'A PAC', amount, memo, committee }).replace(/^SA11AI/, 'SA11C');

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

  it('reads a lower-case line code and lines cut short', () => {
    const short = line(['SA11Ai', 'C00000001', 'A3', '', '', 'IND', '', 'POE', 'ANN']).concat(
      FS.repeat(11),
      '20260815',
      FS,
      '100.00'
    );
    const p = parseRawFiling(file('3625.50', [...rows, short]), 123);
    expect(p.ok).toBe(true);
    expect(p.rows.filter(r => r.counts).map(r => r.name)).toContain('POE, ANN');
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

  it("reads an earlier report the FEC hasn't processed when its figures show money", () => {
    // The October report is processed, the July-September one isn't
    const processed = new Map([
      ['C00000001', { files: new Set(['1', '4']), newest: '2026-10-14' }],
    ]);
    const figures = new Map([['C00000001|2026-07-01|2026-09-30', { itemized: 0, pacs: 14000 }]]);
    expect(unprocessedReports(filings, processed, figures, 'pacs').map(r => r.fileNumber)).toEqual([
      '3',
    ]);
    expect(unprocessedReports(filings, processed, figures, 'itemized')).toEqual([]);
  });

  it('reads a report whose figure is negative: refunds', () => {
    const processed = new Map([
      ['C00000001', { files: new Set(['1', '4']), newest: '2026-10-14' }],
    ]);
    const figures = new Map([
      ['C00000001|2026-07-01|2026-09-30', { itemized: -373393.99, pacs: 0 }],
    ]);
    expect(
      unprocessedReports(filings, processed, figures, 'itemized').map(r => r.fileNumber)
    ).toEqual(['3']);
  });
});

describe('PAC gifts in raw reports', () => {
  const donors = [sa({ tx: 'A1', last: 'DOE', first: 'JANE', amount: '100.00' })];
  const gifts = [pac('C1', 'C00000009', '5000.00'), pac('C2', '', '1000.00')];

  it('keeps the named gifts when the lines add up to line 11(c)', () => {
    const p = parseRawFiling(file('100.00', [...donors, ...gifts], '6000.00'), 7);
    expect(p.pacs.ok).toBe(true);
    expect(p.pacs.gifts).toEqual([
      { giver: 'C00000009', recipient: 'C00000001', amount: 5000, date: '2026-08-15' },
    ]);
    expect(p.pacs.unnamed).toBe(1);
    expect(p.pacs.byName).toEqual([
      { giver: null, recipient: 'C00000001', amount: 1000, date: '2026-08-15', name: 'A PAC' },
    ]);
  });

  it('finds a PAC by its exact name only when one committee has it', () => {
    const idFor = committeeByName([
      { id: 'C00000007', name: 'A  pac' },
      { id: 'C00000005', name: 'TWIN PAC' },
      { id: 'C00000006', name: 'Twin PAC' },
    ]);
    expect(idFor(' A PAC ')).toBe('C00000007');
    expect(idFor('TWIN PAC')).toBe(null);
    expect(idFor('A PAC INC')).toBe(null);
  });

  it('refuses them when they do not', () => {
    const p = parseRawFiling(file('100.00', [...donors, ...gifts], '5000.00'), 7);
    expect(p.pacs.ok).toBe(false);
    expect(p.ok).toBe(true);
  });
});

describe('campaignPacGifts', () => {
  // A stand-in FEC that, like the real one, answers for the first line
  // number only. A PAC-registered committee filing campaign reports
  // (C00000001) and a leadership PAC filing PAC reports (C00000002)
  const records = [
    { committee_id: 'C00000001', line: 'F3-11C', contributor_id: 'C00000009', amount: 5000 },
    { committee_id: 'C00000002', line: 'F3X-11C', contributor_id: 'C00000008', amount: 2500 },
  ];
  const fec = async (path, params) => {
    if (path === '/efile/filings/') {
      return { results: [] };
    }
    if (params.last_index) {
      return { results: [] };
    }
    const line = [params.line_number].flat()[0];
    return {
      results: records
        .filter(r => r.line === line && params.committee_id.includes(r.committee_id))
        .map((r, i) => ({
          committee_id: r.committee_id,
          contributor_id: r.contributor_id,
          contribution_receipt_amount: r.amount,
          contribution_receipt_date: '2026-08-01',
          file_number: 100 + i,
        })),
      pagination: { last_indexes: { last_index: 'x' } },
    };
  };
  it('reads both report forms for every committee', async () => {
    const side = await campaignPacGifts({
      fec,
      committeeIds: ['C00000001', 'C00000002'],
      cycle: 2026,
    });
    expect(side.byRecipient.get('C00000001').map(g => g.amount)).toEqual([5000]);
    expect(side.byRecipient.get('C00000002').map(g => g.amount)).toEqual([2500]);
    expect(side.missing.size).toBe(0);
  });
});
