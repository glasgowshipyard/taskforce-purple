import { describe, expect, it } from 'vitest';
import {
  bulkDate,
  addDays,
  bulkRowCounts,
  dayCount,
  halves,
  committeeVerdict,
  cycleMonths,
  daysIn,
  itemizedLine,
  moneyCheck,
} from './reconcile.mjs';

describe('reconcile rules', () => {
  it('counts direct, earmarked and organisation gifts, not memos, refunds or candidate money', () => {
    expect(bulkRowCounts({ TRANSACTION_TP: '15', MEMO_CD: null })).toBe(true);
    expect(bulkRowCounts({ TRANSACTION_TP: '15E', MEMO_CD: '' })).toBe(true);
    expect(bulkRowCounts({ TRANSACTION_TP: '11', MEMO_CD: null })).toBe(true);
    expect(bulkRowCounts({ TRANSACTION_TP: '15', MEMO_CD: 'X' })).toBe(false);
    expect(bulkRowCounts({ TRANSACTION_TP: '22Y', MEMO_CD: null })).toBe(false);
    expect(bulkRowCounts({ TRANSACTION_TP: '15C', MEMO_CD: null })).toBe(false);
  });

  it('uses the right form line for candidate committees and PACs', () => {
    expect(itemizedLine('H')).toBe('F3-11AI');
    expect(itemizedLine('S')).toBe('F3-11AI');
    expect(itemizedLine('Q')).toBe('F3X-11AI');
    expect(itemizedLine('N')).toBe('F3X-11AI');
  });

  it('covers a cycle in 24 calendar months, leap years included', () => {
    const m = cycleMonths(2024);
    expect(m).toHaveLength(24);
    expect(m[0]).toEqual({ min: '2023-01-01', max: '2023-01-31' });
    expect(m[13]).toEqual({ min: '2024-02-01', max: '2024-02-29' });
    expect(m[23]).toEqual({ min: '2024-12-01', max: '2024-12-31' });
    expect(daysIn({ min: '2026-02-27', max: '2026-03-01' }).map(d => d.min)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('splits date ranges in half for the binary search', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(dayCount('2025-01-01', '2026-12-31')).toBe(730);
    expect(halves({ min: '2025-01-01', max: '2026-12-31' })).toEqual([
      { min: '2025-01-01', max: '2025-12-31' },
      { min: '2026-01-01', max: '2026-12-31' },
    ]);
    expect(halves({ min: '2026-07-01', max: '2026-07-03' })).toEqual([
      { min: '2026-07-01', max: '2026-07-01' },
      { min: '2026-07-02', max: '2026-07-03' },
    ]);
  });

  it('reads bulk-file dates', () => {
    expect(bulkDate('07152026')).toBe('2026-07-15');
    expect(bulkDate('')).toBeNull();
    expect(bulkDate(null)).toBeNull();
  });

  it('allows only whole-dollar rounding, and names the delta otherwise', () => {
    expect(moneyCheck({ ourTotal: 1000, fecTotal: 1000.4, bulkRecordsCounted: 1 }).ok).toBe(true);
    const m = moneyCheck({ ourTotal: 147007, fecTotal: 154007, bulkRecordsCounted: 352 });
    expect(m.ok).toBe(false);
    expect(m.delta).toBe(-7000);
    expect(committeeVerdict({ recordsComplete: false, money: m }).status).toBe('mismatch');
    const note = committeeVerdict({ recordsComplete: true, money: m });
    expect(note.status).toBe('reconciled-with-note');
    expect(note.note).toMatch(/\$7,000/);
  });
});
