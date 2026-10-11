import { describe, expect, it } from 'vitest';
import { fecCacheKey, recordingFec, replayFec, scheduleAPages } from './fec.mjs';

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

describe('frozen snapshots: record and replay', () => {
  it('keys a call by path and sorted parameters, never the API key', () => {
    expect(
      fecCacheKey('/totals/pac-party/', {
        per_page: 100,
        committee_id: ['C2', 'C1'],
        cycle: 2026,
        api_key: 'x',
      })
    ).toBe('/totals/pac-party/?committee_id=C1,C2&cycle=2026&per_page=100');
  });

  it('replays exactly what was recorded, and reports anything it was never asked', async () => {
    const cache = {};
    const live = async (path, params) => ({ path, n: params.n });
    live.calls = 0;
    const rec = recordingFec(live, cache);
    await rec('/a/', { n: 1 });
    const replay = replayFec(cache);
    expect(await replay('/a/', { n: 1 })).toEqual({ path: '/a/', n: 1 });
    await expect(replay('/a/', { n: 2 })).rejects.toThrow(/no recorded answer/);
    expect(replay.missing).toEqual(['/a/?n=2']);
    const lenient = replayFec(cache, { onMissing: () => ({ results: [] }) });
    expect(await lenient('/b/', {})).toEqual({ results: [] });
  });
});
