import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_STALENESS_DAYS,
  isAnalysisFresh,
  isAnalysisCurrent,
  donorPool,
  reconcileCommittees,
} from './itemized-analysis.js';

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

describe('isAnalysisCurrent (issue #41)', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const fresh = {
    committeeId: 'C00000001',
    personLevel: true,
    collectionCompletedAt: '2026-09-20T00:00:00Z',
  };

  it("accepts a fresh analysis of the member's own committee", () => {
    expect(isAnalysisCurrent(fresh, 'C00000001', now)).toBe(true);
  });

  it("rejects a fresh analysis of a different committee - someone else's donors", () => {
    expect(isAnalysisCurrent(fresh, 'C00000002', now)).toBe(false);
  });

  it('rejects everything when the member has no committee on record', () => {
    expect(isAnalysisCurrent(fresh, null, now)).toBe(false);
    expect(isAnalysisCurrent(fresh, undefined, now)).toBe(false);
  });

  it('still requires freshness', () => {
    const old = { ...fresh, collectionCompletedAt: '2026-06-01T00:00:00Z' };
    expect(isAnalysisCurrent(old, 'C00000001', now)).toBe(false);
  });
});

describe('person-level analyses (#32)', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const campaignOnly = { committeeId: 'C1', collectionCompletedAt: '2026-09-20T00:00:00Z' };

  it('a fresh campaign-only analysis is no longer current - it is re-collected person-level', () => {
    expect(isAnalysisCurrent(campaignOnly, 'C1', now)).toBe(false);
    expect(isAnalysisCurrent({ ...campaignOnly, personLevel: true }, 'C1', now)).toBe(true);
  });

  it('the donor pool is the discovered committees plus the campaign on record', () => {
    expect(donorPool({ donorCommitteeIds: ['C3', 'C2'] }, 'C1')).toEqual(['C1', 'C2', 'C3']);
    expect(donorPool(null, 'C1')).toEqual(['C1']);
    expect(donorPool({ failed: true, donorCommitteeIds: [] }, 'C1')).toEqual(['C1']);
  });
});

describe('reconcileCommittees - the gate for the all-committee grade', () => {
  // Figures from the Pelosi trial that reconciled to the dollar, 2026-09-27
  const perCommittee = {
    C00213512: { rows: 46389, fecCount: 46389, countExact: true, counted: 808796.43 },
    C00492421: { rows: 346, fecCount: 346, countExact: true, counted: 2582517 },
  };
  const totals = {
    C00213512: { individual_itemized_contributions: 808796.43 },
    C00492421: { individual_itemized_contributions: 2582517 },
  };

  it('passes when every committee matches the FEC exactly', () => {
    expect(reconcileCommittees(perCommittee, ['C00213512', 'C00492421'], totals).ok).toBe(true);
  });

  it('fails on a $4,500 gap - there is no percentage tolerance', () => {
    const short = { ...perCommittee, C00213512: { ...perCommittee.C00213512, counted: 804296.43 } };
    const r = reconcileCommittees(short, ['C00213512', 'C00492421'], totals);
    expect(r.ok).toBe(false);
    expect(r.committees[0].moneyOk).toBe(false);
  });

  it('fails when the FEC count is only an estimate, even if the numbers agree', () => {
    const est = { ...perCommittee, C00492421: { ...perCommittee.C00492421, countExact: false } };
    expect(reconcileCommittees(est, ['C00213512', 'C00492421'], totals).ok).toBe(false);
  });

  it('fails when a committee was never collected or its FEC totals are missing', () => {
    expect(reconcileCommittees(perCommittee, ['C00213512', 'C99999999'], totals).ok).toBe(false);
    expect(reconcileCommittees(perCommittee, ['C00213512'], {}).ok).toBe(false);
    expect(reconcileCommittees({}, [], {}).ok).toBe(false);
  });
});
