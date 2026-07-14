import { describe, expect, it } from 'vitest';
import { ANALYSIS_STALENESS_DAYS, isAnalysisFresh } from './itemized-analysis.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-15T00:00:00Z');

describe('isAnalysisFresh (refresh policy gate)', () => {
  it('missing or undated analyses are stale', () => {
    expect(isAnalysisFresh(null, NOW)).toBe(false);
    expect(isAnalysisFresh(undefined, NOW)).toBe(false);
    expect(isAnalysisFresh({}, NOW)).toBe(false);
  });

  it('recent analyses are fresh', () => {
    const analysis = { collectionCompletedAt: new Date(NOW - 1 * DAY).toISOString() };
    expect(isAnalysisFresh(analysis, NOW)).toBe(true);
  });

  it('analyses older than the staleness window are stale', () => {
    const analysis = {
      collectionCompletedAt: new Date(NOW - (ANALYSIS_STALENESS_DAYS + 1) * DAY).toISOString(),
    };
    expect(isAnalysisFresh(analysis, NOW)).toBe(false);
  });

  it('boundary: exactly at the window edge counts as stale', () => {
    const analysis = {
      collectionCompletedAt: new Date(NOW - ANALYSIS_STALENESS_DAYS * DAY).toISOString(),
    };
    expect(isAnalysisFresh(analysis, NOW)).toBe(false);
  });

  it('falls back to lastUpdated when collectionCompletedAt is absent (old snapshots)', () => {
    expect(isAnalysisFresh({ lastUpdated: new Date(NOW - 2 * DAY).toISOString() }, NOW)).toBe(true);
    expect(isAnalysisFresh({ lastUpdated: '2026-01-16T16:00:00Z' }, NOW)).toBe(false);
  });

  it('January-era production snapshots read as stale (the whole point)', () => {
    expect(isAnalysisFresh({ collectionCompletedAt: '2026-01-16T16:00:00.000Z' }, NOW)).toBe(false);
  });
});
