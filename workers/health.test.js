import { describe, expect, it } from 'vitest';
import { evaluateHealth } from './health.js';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const minsAgo = m => new Date(NOW - m * 60 * 1000).toISOString();
const hoursAgo = h => minsAgo(h * 60);

const healthy = () => ({
  pipelineLastRun: minsAgo(10),
  sweepRanAt: minsAgo(40),
  queue: [{ bioguideId: 'A1', name: 'Member A' }],
  headProgress: { startedAt: hoursAgo(50), lastAdvancedAt: hoursAgo(2) },
  d1RowsToday: 84000,
  d1Error: null,
  dropped: [],
});
const ids = s => evaluateHealth(s, NOW).problems.map(p => p.id);

describe('evaluateHealth', () => {
  it('a normal day is healthy', () => {
    expect(evaluateHealth(healthy(), NOW)).toMatchObject({ ok: true, problems: [] });
  });

  it('flags a pipeline that stopped running', () => {
    expect(ids({ ...healthy(), pipelineLastRun: minsAgo(75) })).toEqual(['pipeline-not-running']);
    expect(ids({ ...healthy(), pipelineLastRun: null })).toEqual(['pipeline-not-running']);
  });

  it('flags an itemized worker that stopped running', () => {
    expect(ids({ ...healthy(), sweepRanAt: minsAgo(100) })).toEqual(['itemized-not-running']);
    expect(ids({ ...healthy(), sweepRanAt: null })).toEqual(['itemized-not-running']);
  });

  it('a day paused on the D1 budget is not stuck; 30 h without progress is', () => {
    const paused = { ...healthy(), headProgress: { lastAdvancedAt: hoursAgo(24) } };
    expect(ids(paused)).toEqual([]);
    const stuck = {
      ...healthy(),
      headProgress: {
        lastAdvancedAt: hoursAgo(31),
        lastFecStop: { status: 'FEC 504 Gateway Timeout', at: minsAgo(20) },
      },
    };
    const result = evaluateHealth(stuck, NOW);
    expect(result.problems.map(p => p.id)).toEqual(['collection-stuck']);
    expect(result.problems[0].message).toMatch(/Member A.*FEC 504/);
  });

  it('falls back to the start time when a collection has never advanced', () => {
    expect(ids({ ...healthy(), headProgress: { startedAt: hoursAgo(40) } })).toEqual([
      'collection-stuck',
    ]);
  });

  it('flags recent failures with their reason, not old unexplained strikes', () => {
    const s = {
      ...healthy(),
      queue: [
        ...healthy().queue,
        {
          name: 'Member B',
          failCount: 1,
          lastError: 'FEC API error: 400',
          lastFailedAt: minsAgo(30),
        },
        { name: 'Member C', failCount: 2 },
        { name: 'Member D', failCount: 1, lastError: 'old', lastFailedAt: hoursAgo(30) },
      ],
    };
    const result = evaluateHealth(s, NOW);
    expect(result.problems.map(p => p.id)).toEqual(['members-failing']);
    expect(result.problems[0].message).toMatch(/Member B - strike 1\/3: FEC API error: 400/);
    expect(result.problems[0].message).not.toMatch(/Member D/);
    expect(result.notes[0]).toMatch(/1 queued member/);
  });

  it('flags members dropped in the last 48 h', () => {
    const s = {
      ...healthy(),
      dropped: [
        { name: 'Member E', lastError: 'x', droppedAt: hoursAgo(5) },
        { name: 'Member F', lastError: 'y', droppedAt: hoursAgo(72) },
      ],
    };
    const result = evaluateHealth(s, NOW);
    expect(result.problems.map(p => p.id)).toEqual(['members-dropped']);
    expect(result.problems[0].message).toMatch(/1 member.*Member E/);
  });

  it('flags D1 writes escaping the meter, and an unreadable ledger', () => {
    expect(ids({ ...healthy(), d1RowsToday: 96000 })).toEqual(['d1-over-budget']);
    expect(ids({ ...healthy(), d1Error: 'ledger unreadable' })).toEqual(['d1-unreadable']);
  });

  it('an empty queue is healthy', () => {
    expect(ids({ ...healthy(), queue: [], headProgress: null })).toEqual([]);
  });
});
