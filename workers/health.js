// System health checks behind the itemized worker's /health endpoint.
//
// A GitHub Actions job (.github/workflows/health-alert.yml) reads /health
// every hour and opens an issue - which notifies the owner - when `ok` is
// false, then closes it when things recover. Anything worth waking someone
// for belongs here as a problem; everything else is a note.
//
// Pure: takes a snapshot of what the workers recorded, returns a verdict.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Pipeline cron is */20; three missed runs is a problem
export const PIPELINE_STALE_MS = 60 * MIN;
// The itemized discovery sweep runs hourly at :10 and never stands down
export const SWEEP_STALE_MS = 90 * MIN;
// A day paused on the D1 budget is normal; longer without a single new
// page means the head member is stuck
export const HEAD_STUCK_MS = 30 * HOUR;
export const RECENT_FAILURE_MS = 24 * HOUR;
export const RECENT_DROP_MS = 48 * HOUR;
// The meter stands the workers down at 85k; D1 hard-fails at 100k.
// Anything past 95k means writes are escaping the meter.
export const D1_ALARM_ROWS = 95000;

const ago = (nowMs, iso) => {
  const mins = Math.round((nowMs - Date.parse(iso)) / MIN);
  return mins < 120 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
};
const olderThan = (nowMs, iso, ms) => !iso || !(nowMs - Date.parse(iso) < ms);

/**
 * @param {object} s snapshot
 * @param {string|null} s.pipelineLastRun   processing_status.lastRun
 * @param {string|null} s.sweepRanAt        discovery_sweep_cursor metadata
 * @param {Array} s.queue                   itemized_processing_queue
 * @param {object|null} s.headProgress      progress record of queue[0]
 * @param {number|null} s.d1RowsToday       d1_write_budget row for today
 * @param {string|null} s.d1Error           set if the ledger could not be read
 * @param {Array} s.dropped                 itemized_dropped entries
 */
export function evaluateHealth(s, nowMs = Date.now()) {
  const problems = [];
  const notes = [];
  const problem = (id, message) => problems.push({ id, message });

  if (olderThan(nowMs, s.pipelineLastRun, PIPELINE_STALE_MS)) {
    problem(
      'pipeline-not-running',
      s.pipelineLastRun
        ? `The main data worker last ran ${ago(nowMs, s.pipelineLastRun)} (it should run every 20 minutes).`
        : 'The main data worker has no record of ever running.'
    );
  }

  if (olderThan(nowMs, s.sweepRanAt, SWEEP_STALE_MS)) {
    problem(
      'itemized-not-running',
      s.sweepRanAt
        ? `The donor-analysis worker last ran ${ago(nowMs, s.sweepRanAt)} (it should run every hour).`
        : 'The donor-analysis worker has no record of running.'
    );
  }

  const queue = s.queue || [];
  const head = queue[0];
  if (head && s.headProgress) {
    const advancedAt = s.headProgress.lastAdvancedAt || s.headProgress.startedAt;
    if (olderThan(nowMs, advancedAt, HEAD_STUCK_MS)) {
      const fec = s.headProgress.lastFecStop
        ? ` Last FEC error: ${s.headProgress.lastFecStop.status} (${ago(nowMs, s.headProgress.lastFecStop.at)}).`
        : '';
      problem(
        'collection-stuck',
        `${head.name}'s donor collection has not moved forward since ${advancedAt ? ago(nowMs, advancedAt) : 'it started'}, and everyone else in the queue is waiting behind them.${fec}`
      );
    }
  }

  const recentFailures = queue.filter(
    m => m.lastFailedAt && nowMs - Date.parse(m.lastFailedAt) < RECENT_FAILURE_MS
  );
  if (recentFailures.length > 0) {
    problem(
      'members-failing',
      `${recentFailures.length} member(s) failed in the last 24 h (3 failures and they are dropped): ` +
        recentFailures
          .map(m => `${m.name} - strike ${m.failCount}/3: ${m.lastError || 'no reason recorded'}`)
          .join('; ')
    );
  }
  const unexplained = queue.filter(m => (m.failCount || 0) > 0 && !m.lastFailedAt);
  if (unexplained.length > 0) {
    notes.push(
      `${unexplained.length} queued member(s) carry strikes from before failure reasons were recorded (2026-09-27).`
    );
  }

  const recentDrops = (s.dropped || []).filter(
    d => d.droppedAt && nowMs - Date.parse(d.droppedAt) < RECENT_DROP_MS
  );
  if (recentDrops.length > 0) {
    problem(
      'members-dropped',
      `${recentDrops.length} member(s) dropped from donor analysis after 3 failures: ` +
        recentDrops.map(d => `${d.name}: ${d.lastError || 'no reason recorded'}`).join('; ')
    );
  }

  if (s.d1Error) {
    problem('d1-unreadable', `The D1 write ledger could not be read: ${s.d1Error}`);
  } else if ((s.d1RowsToday || 0) >= D1_ALARM_ROWS) {
    problem(
      'd1-over-budget',
      `D1 has recorded ${s.d1RowsToday.toLocaleString()} row-writes today. The meter should stop at 85,000 and D1 refuses writes at 100,000 - something is writing without being counted.`
    );
  }

  return { ok: problems.length === 0, problems, notes };
}
