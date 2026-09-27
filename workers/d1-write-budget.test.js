import { describe, it, expect } from 'vitest';
import {
  DAILY_ROW_WRITE_BUDGET,
  D1_FREE_TIER_ROW_WRITES,
  WRITE_COST,
  budgetDay,
  estimateRowWrites,
  readBudget,
  chargeBudget,
  canAfford,
  transactionBatchCost,
} from './d1-write-budget.js';

describe('budget constants', () => {
  it('leaves headroom below the enforced cap', () => {
    expect(DAILY_ROW_WRITE_BUDGET).toBeLessThan(D1_FREE_TIER_ROW_WRITES);
  });

  it('charges the MEASURED cost of a transaction insert, not the derived one', () => {
    // row + idx_bioguide + idx_sub_id + idx_tx_employer = 4 by derivation,
    // but AUTOINCREMENT's sqlite_sequence update makes it 5 in practice.
    // Measured against production D1 on 2026-09-09.
    expect(WRITE_COST.transaction).toBe(5);
  });
});

describe('budgetDay', () => {
  it('is the UTC date, because that is when the cap resets', () => {
    expect(budgetDay(new Date('2026-09-09T23:59:59Z'))).toBe('2026-09-09');
    expect(budgetDay(new Date('2026-09-10T00:00:01Z'))).toBe('2026-09-10');
  });
});

describe('estimateRowWrites', () => {
  it('is zero for an empty run', () => {
    expect(estimateRowWrites()).toBe(0);
  });

  it('reproduces the 2026-09-09 breach: 117,205 rows against a 100k cap', () => {
    // Measured that day: 16,491 transactions + 14,424 aggregates + 8
    // metadata rows. The estimate must land close to the 117,205 D1
    // actually reported, or the meter cannot protect anything.
    const rows = estimateRowWrites({
      transactions: 16491,
      aggregates: 14424,
      metadataReplaces: 8,
    });
    expect(rows).toBe(111319);
    expect(rows).toBeGreaterThan(DAILY_ROW_WRITE_BUDGET);
    // Within 6% of observed. The 5,886-row residual is ignored duplicate
    // inserts (1 row-write each, not counted here because the meter charges
    // them at the full insert price up front). The estimate is deliberately
    // allowed to run low here and high at the call site - never the reverse.
    expect(Math.abs(rows - 117205) / 117205).toBeLessThan(0.06);
  });
});

describe('readBudget', () => {
  const db = rowsWritten => ({
    prepare: () => ({
      bind: () => ({
        first: async () => (rowsWritten === null ? null : { rows_written: rowsWritten }),
      }),
    }),
  });

  it('reports a full budget when nothing is written today', async () => {
    const b = await readBudget(db(null));
    expect(b.spent).toBe(0);
    expect(b.remaining).toBe(DAILY_ROW_WRITE_BUDGET);
    expect(b.degraded).toBe(false);
  });

  it('subtracts what today already spent', async () => {
    const b = await readBudget(db(60000));
    expect(b.remaining).toBe(DAILY_ROW_WRITE_BUDGET - 60000);
  });

  it('never reports negative headroom when the budget is overshot', async () => {
    const b = await readBudget(db(117205));
    expect(b.remaining).toBe(0);
  });

  it('fails CLOSED when the ledger cannot be read', async () => {
    const broken = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw new Error('D1 unavailable');
          },
        }),
      }),
    };
    const b = await readBudget(broken);
    expect(b.remaining).toBe(0);
    expect(b.degraded).toBe(true);
  });

  it('fails closed with no database binding at all', async () => {
    const b = await readBudget(undefined);
    expect(b.remaining).toBe(0);
    expect(b.degraded).toBe(true);
  });
});

describe('chargeBudget', () => {
  it('accumulates rather than overwriting, and prunes old days', async () => {
    const calls = [];
    const db = {
      prepare: sql => ({
        bind: (...args) => ({
          run: async () => {
            calls.push({ sql, args });
          },
        }),
      }),
    };
    await chargeBudget(db, 1200, new Date('2026-09-09T10:00:00Z'));
    expect(calls[0].sql).toContain('rows_written + excluded.rows_written');
    expect(calls[0].args).toEqual(['2026-09-09', 1200]);
    expect(calls[1].sql).toContain('DELETE FROM d1_write_budget WHERE day <');
  });

  it('does not write a ledger row for a run that wrote nothing', async () => {
    let called = false;
    const db = {
      prepare: () => ({ bind: () => ({ run: async () => (called = true) }) }),
    };
    await chargeBudget(db, 0);
    expect(called).toBe(false);
  });

  it('swallows ledger failures - a run must not die over its own meter', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error('write cap exceeded');
          },
        }),
      }),
    };
    await expect(chargeBudget(db, 500)).resolves.toBeUndefined();
  });
});

describe('canAfford', () => {
  const budget = { remaining: 1000 };

  it('allows a write that exactly fits', () => {
    expect(canAfford(budget, 600, 400)).toBe(true);
  });

  it('refuses a write that would overshoot by one row', () => {
    expect(canAfford(budget, 600, 401)).toBe(false);
  });

  it('refuses everything once the budget is exhausted', () => {
    expect(canAfford({ remaining: 0 }, 0, 1)).toBe(false);
  });
});

describe('aggregate deletes', () => {
  it('charges the measured cost of 1 per deleted aggregate', () => {
    // Measured on production D1 2026-09-26: deleting 3 rows wrote 3
    expect(WRITE_COST.aggregateDelete).toBe(1);
    expect(estimateRowWrites({ aggregateDeletes: 3 })).toBe(3);
  });
});

describe('transactionBatchCost - charge what D1 actually did', () => {
  const inserted = { meta: { changes: 1 } };
  const ignored = { meta: { changes: 0 } };

  it('charges new rows at 5 and ignored duplicates at 1 (both measured)', () => {
    expect(transactionBatchCost([inserted, inserted, ignored], 3)).toBe(5 + 5 + 1);
  });

  it('a re-collection of rows already held costs a fifth of the old estimate', () => {
    const tenDuplicates = Array(10).fill(ignored);
    expect(transactionBatchCost(tenDuplicates, 10)).toBe(10);
    expect(estimateRowWrites({ transactions: 10 })).toBe(50);
  });

  it('charges any statement without a result as an insert - never under-counts', () => {
    expect(transactionBatchCost([inserted], 3)).toBe(15);
    expect(transactionBatchCost(undefined, 2)).toBe(10);
    expect(transactionBatchCost([{ meta: {} }, ignored], 2)).toBe(5 + 1);
  });
});
