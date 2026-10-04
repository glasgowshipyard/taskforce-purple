import { describe, expect, it } from 'vitest';
import { scheduleAPages } from './fec.mjs';

describe('scheduleAPages', () => {
  it('keeps the caller date range when the cursor has no date', async () => {
    const calls = [];
    const pages = [
      {
        results: [{ sub_id: 1 }],
        pagination: {
          last_indexes: { last_index: 'a', last_contribution_receipt_date: '2026-03-02' },
        },
      },
      {
        results: [{ sub_id: 2 }],
        pagination: { last_indexes: { last_index: 'b', last_contribution_receipt_date: null } },
      },
      { results: [], pagination: {} },
    ];
    const fec = async (_path, params) => {
      calls.push(params);
      return pages.shift();
    };
    const seen = [];
    await scheduleAPages(
      fec,
      { committee_id: 'C1', min_date: '2026-03-01', max_date: '2026-03-31' },
      rows => seen.push(...rows)
    );
    expect(seen.map(r => r.sub_id)).toEqual([1, 2]);
    expect(calls[1]).toMatchObject({
      min_date: '2026-03-01',
      max_date: '2026-03-02',
      last_index: 'a',
    });
    // no date on the cursor: the caller's range stays
    expect(calls[2]).toMatchObject({
      min_date: '2026-03-01',
      max_date: '2026-03-31',
      last_index: 'b',
    });
    expect(calls[2].last_contribution_receipt_date).toBeUndefined();
  });

  it('stops with an error instead of looping when the cursor does not advance', async () => {
    const page = {
      results: [{ sub_id: 1 }],
      pagination: {
        last_indexes: { last_index: 'same', last_contribution_receipt_date: '2026-01-01' },
      },
    };
    const fec = async () => page;
    await expect(scheduleAPages(fec, {}, () => {})).rejects.toThrow(/did not advance/);
  });
});
