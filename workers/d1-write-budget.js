/**
 * D1 DAILY WRITE BUDGET
 *
 * Cloudflare's free tier caps D1 at 100,000 rows written per UTC day, and
 * has hard-enforced it since ~2026-09-01: past the cap, writes error until
 * midnight. Until this module existed nothing in the codebase counted D1
 * writes at all - the 20-minute cron was a throughput knob that happened to
 * stay under an unenforced limit, and when collection got faster it didn't.
 * That is the gap this closes: the pipeline now stops itself.
 *
 * The ledger lives in D1 rather than KV because KV writes are the other
 * scarce resource (1,000/day) and a per-run KV write would spend 7% of that
 * budget to protect this one. One row per UTC day, ~72 updates/day, which
 * costs about 144 row-writes - 0.14% of the thing it is protecting.
 *
 * Every estimate here rounds UP. Stopping early costs a member a day of
 * freshness; stopping late costs the whole database its writes.
 */

// Cloudflare's hard cap.
export const D1_FREE_TIER_ROW_WRITES = 100000;

// What we allow ourselves. The 15% headroom absorbs estimate error (we
// count intended writes, not what SQLite actually did) and leaves room for
// manual repair work - backfills, corrections - to run without waiting for
// midnight.
export const DAILY_ROW_WRITE_BUDGET = 85000;

/**
 * Row-write cost per logical row.
 *
 * These are MEASURED against production D1 on 2026-09-09, not derived. The
 * derivation (1 table row + 1 per index) undercounts, and the difference is
 * what let the cap be breached while the arithmetic looked fine:
 *
 *   new transaction                      5   (predicted 4)
 *   duplicate transaction, OR IGNORE     1   (predicted 0)
 *   new aggregate                        2
 *   aggregate, amount changed            1
 *   aggregate, amount unchanged          0
 *
 * A transaction costs 5 rather than 4 because `itemized_transactions.id` is
 * INTEGER PRIMARY KEY AUTOINCREMENT, and AUTOINCREMENT makes SQLite update
 * the `sqlite_sequence` table on every insert - a fifth write per row, about
 * 16,000/day at current volume, buying nothing this schema uses. Plain
 * INTEGER PRIMARY KEY would drop it, but changing that means rebuilding a
 * 1.5M-row table, which would itself cost ~15 days of write budget. Worth
 * doing only if the table is ever rebuilt for another reason.
 *
 * Keep these in step with schema.sql, and re-measure rather than re-derive:
 *   npx wrangler d1 execute taskforce-purple-donors --remote --file=X.sql
 * prints rows_written for the statement.
 */
export const WRITE_COST = {
  // row + idx_bioguide + idx_sub_id + idx_tx_employer + sqlite_sequence
  transaction: 5,
  // Charged at the insert price: we cannot know in advance which rows will
  // conflict, and an upsert that conflicts is cheaper (1, or 0 unchanged).
  aggregate: 2,
  // collection_metadata: row + PK index.
  metadataReplace: 2,
  // A deleted row also clears its index entries (no sqlite_sequence update).
  transactionDelete: 4,
};

/** The UTC day the cap resets on. */
export function budgetDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * @param {{transactions?: number, aggregates?: number, metadataReplaces?: number, transactionDeletes?: number}} counts
 * @returns {number} estimated row-writes, rounded up
 */
export function estimateRowWrites(counts = {}) {
  const { transactions = 0, aggregates = 0, metadataReplaces = 0, transactionDeletes = 0 } = counts;
  return (
    transactions * WRITE_COST.transaction +
    aggregates * WRITE_COST.aggregate +
    metadataReplaces * WRITE_COST.metadataReplace +
    transactionDeletes * WRITE_COST.transactionDelete
  );
}

/**
 * Rows already spent today. A missing ledger row means nothing has been
 * written yet today; a failed read means we cannot prove there is budget
 * left, so we report the budget as fully spent and let the caller stand
 * down. Failing closed is the whole point of this module.
 *
 * @returns {Promise<{spent: number, remaining: number, day: string, degraded: boolean}>}
 */
export async function readBudget(db, now = new Date()) {
  const day = budgetDay(now);
  if (!db) {
    return { spent: DAILY_ROW_WRITE_BUDGET, remaining: 0, day, degraded: true };
  }
  try {
    const row = await db
      .prepare('SELECT rows_written FROM d1_write_budget WHERE day = ?')
      .bind(day)
      .first();
    const spent = row?.rows_written ?? 0;
    return { spent, remaining: Math.max(0, DAILY_ROW_WRITE_BUDGET - spent), day, degraded: false };
  } catch {
    return { spent: DAILY_ROW_WRITE_BUDGET, remaining: 0, day, degraded: true };
  }
}

/**
 * Add this run's spend to today's ledger. Called once per run, not per
 * write: the ledger update is itself a D1 write, and charging per batch
 * would make the meter a meaningful fraction of what it meters.
 *
 * Old days are deleted opportunistically so the table stays at one row.
 */
export async function chargeBudget(db, rows, now = new Date()) {
  if (!db || rows <= 0) {
    return;
  }
  const day = budgetDay(now);
  try {
    await db
      .prepare(
        `INSERT INTO d1_write_budget (day, rows_written) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET rows_written = rows_written + excluded.rows_written`
      )
      .bind(day, rows)
      .run();
    await db.prepare('DELETE FROM d1_write_budget WHERE day < ?').bind(day).run();
  } catch {
    // A ledger that cannot be written is not worth failing a run over; the
    // next successful read will still see the previous total and the run
    // that could not charge will simply have been free.
  }
}

/**
 * Can we afford `cost` more row-writes in this run?
 *
 * @param {{remaining: number}} budget snapshot from readBudget
 * @param {number} spentThisRun accumulated so far in this invocation
 * @param {number} cost the write about to be attempted
 */
export function canAfford(budget, spentThisRun, cost) {
  return spentThisRun + cost <= budget.remaining;
}
