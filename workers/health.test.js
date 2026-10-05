import { describe, expect, it } from 'vitest';
import { evaluateHealth } from './health.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3600 * 1000).toISOString();

const healthy = () => ({
  listMembers: 539,
  listLastUpdated: '2026-10-18T18:00:00Z',
  lastRun: { run_id: 'r1', status: 'done', started_at: hoursAgo(30), finished_at: hoursAgo(26) },
  failingMembers: [],
  mismatchedCommittees: [],
  d1RowsToday: 1200,
  resultsDbError: null,
});
const ids = s => evaluateHealth(s, NOW).problems.map(p => p.id);

describe('evaluateHealth', () => {
  it('a normal state is healthy, with notes', () => {
    const v = evaluateHealth(healthy(), NOW);
    expect(v.ok).toBe(true);
    expect(v.notes.join(' ')).toMatch(/last changed/);
  });

  it('flags a missing or short member list', () => {
    expect(ids({ ...healthy(), listMembers: null })).toEqual(['site-data-missing']);
    expect(ids({ ...healthy(), listMembers: 400 })).toEqual(['site-data-short']);
  });

  it('flags a failed run and a run that never recorded its end', () => {
    expect(
      ids({ ...healthy(), lastRun: { run_id: 'r2', status: 'failed', started_at: hoursAgo(2) } })
    ).toEqual(['refresh-failed']);
    expect(
      ids({ ...healthy(), lastRun: { run_id: 'r3', status: 'running', started_at: hoursAgo(8) } })
    ).toEqual(['refresh-stuck']);
    // a run in progress for under 7 hours is fine
    expect(
      ids({ ...healthy(), lastRun: { run_id: 'r4', status: 'running', started_at: hoursAgo(3) } })
    ).toEqual([]);
  });

  it('flags failing members with their reasons, and unfillable committees', () => {
    const s = {
      ...healthy(),
      failingMembers: [{ bioguide_id: 'A000001', attempts: 2, last_error: 'discovery: FEC 500' }],
      mismatchedCommittees: [{ committee_id: 'C00000001', name: 'X FOR CONGRESS' }],
    };
    const v = evaluateHealth(s, NOW);
    expect(v.problems.map(p => p.id)).toEqual(['members-failing', 'committee-mismatch']);
    expect(v.problems[0].message).toMatch(/A000001 \(attempt 2\): discovery: FEC 500/);
    expect(v.problems[1].message).toMatch(/C00000001 X FOR CONGRESS/);
  });

  it('every problem carries a proposed fix', () => {
    const v = evaluateHealth(
      {
        ...healthy(),
        listMembers: 400,
        lastRun: { run_id: 'r2', status: 'failed', started_at: hoursAgo(2) },
        failingMembers: [{ bioguide_id: 'A000001', attempts: 1, last_error: 'x' }],
        mismatchedCommittees: [{ committee_id: 'C00000001' }],
        d1RowsToday: 99000,
      },
      NOW
    );
    expect(v.problems).toHaveLength(5);
    for (const p of v.problems) {
      expect(p.fix, p.id).toBeTruthy();
    }
  });

  it('flags D1 reads near the account-wide limit', () => {
    expect(ids({ ...healthy(), d1RowsReadToday: 4200000 })).toEqual(['d1-reads-high']);
    expect(ids({ ...healthy(), d1RowsReadToday: 900000 })).toEqual([]);
  });

  it('flags D1 writes near the limit and an unreadable results database', () => {
    expect(ids({ ...healthy(), d1RowsToday: 96000 })).toEqual(['d1-over-budget']);
    expect(ids({ ...healthy(), resultsDbError: 'no binding' })).toEqual(['results-db-unreadable']);
  });
});
