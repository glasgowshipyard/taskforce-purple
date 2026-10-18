import { describe, expect, it } from 'vitest';
import { dueDeadline, lookupWindow } from './calendar.mjs';

const dates = [
  { report_type: 'Q3', due_date: '2026-10-15T00:00:00' },
  { report_type: 'M10', due_date: '2026-10-20T00:00:00' },
  { report_type: '12G', due_date: '2026-10-22T00:00:00' },
  { report_type: '12P', due_date: '2026-10-08T00:00:00' },
];

describe('the filing calendar (#54)', () => {
  it('waits a few days after a deadline for the FEC to process the reports', () => {
    expect(dueDeadline(dates, '2026-10-24')?.key).toBe('2026-10-15 Q3');
    expect(dueDeadline(dates, '2026-10-25')?.key).toBe('2026-10-22 12G');
  });

  it('counts only the reports members file, not monthlies or pre-primaries', () => {
    expect(dueDeadline([dates[1], dates[3]], '2026-10-25')).toBeNull();
  });

  it('refreshes once per deadline', () => {
    const handled = new Set(['2026-10-22 12G']);
    expect(dueDeadline(dates, '2026-10-26', handled)).toBeNull();
    expect(dueDeadline(dates, '2026-10-25')?.reason).toBe('calendar: 12G reports due 2026-10-22');
  });

  it('leaves deadlines over a month old alone', () => {
    expect(dueDeadline(dates, '2026-12-01')).toBeNull();
    expect(lookupWindow('2026-10-25')).toEqual({
      min_due_date: '2026-09-25',
      max_due_date: '2026-10-22',
    });
  });
});
