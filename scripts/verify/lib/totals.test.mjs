import { describe, expect, it } from 'vitest';
import { compareTotals, describeTotals, parseSummary, totalsVerdict } from './totals.mjs';

const CSV = [
  'CMTE_ID,INDV_CONTB,INDV_UNITEM_CONTB,OTH_CMTE_CONTB,PTY_CMTE_CONTB,TTL_RECEIPTS,CVG_END_DT',
  '"C00000001","100000","40000","20000","0","130000","20261014"',
].join('\n');

const detail = (extra = {}) => ({
  small: 50000,
  smallItemized: 10000,
  big: 50000,
  directed: 0,
  pac: 20000,
  party: 0,
  given: 130000,
  otherPoliticiansFunds: 0,
  ...extra,
});
const committees = [{ committeeId: 'C00000001', role: 'campaign' }];

describe('the totals check (2026-11-06)', () => {
  const fec = parseSummary(CSV);

  it("matches when the grade's money is the FEC's", () => {
    const r = compareTotals(detail(), committees, fec);
    expect(r.off).toEqual({});
    expect(r.fecThrough).toEqual(['20261014']);
    expect(totalsVerdict(r, '2026-10-14')).toBe('match');
  });

  it('names a difference, and tells waiting for the FEC from wrong', () => {
    const r = compareTotals(detail({ big: 70000 }), committees, fec);
    expect(describeTotals(r)).toBe('people site 120000 FEC 100000 (+20000)');
    expect(totalsVerdict(r, '2026-10-14')).toBe('differs');
    // The site's figures a report ahead of the FEC's file: wait for it
    expect(totalsVerdict(r, '2026-11-23')).toBe('waiting');
    // Eighteen months apart: not waiting, wrong
    expect(totalsVerdict(r, '2025-04-21')).toBe('differs');
  });

  it('knows a campaign that became a PAC is counted to its last campaign report', () => {
    const pac = parseSummary(
      [
        'CMTE_ID,CMTE_TP,INDV_CONTB,INDV_UNITEM_CONTB,OTH_CMTE_CONTB,PTY_CMTE_CONTB,TTL_RECEIPTS,CVG_END_DT',
        '"C00000001","W","300000","40000","20000","0","330000","20261014"',
      ].join('\n')
    );
    const r = compareTotals(detail(), committees, pac);
    expect(r.since).toEqual([
      'C00000001, a campaign that became a PAC, to its last campaign report',
    ]);
    expect(totalsVerdict(r, '2025-04-21')).toBe('since');
  });

  it('lists a committee counted from a date apart', () => {
    const r = compareTotals(detail({ big: 70000 }), committees, fec, {
      C00000001: { from: '2026-07-01' },
    });
    expect(totalsVerdict(r, '2026-10-14')).toBe('since');
  });
});
