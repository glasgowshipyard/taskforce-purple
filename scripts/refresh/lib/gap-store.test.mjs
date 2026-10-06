import { describe, expect, it } from 'vitest';
import { PACK_SIZE, loadStored, packRecords, saveStored, unpackRecords } from './gap-store.mjs';

const record = i => ({
  sub_id: `40${String(i).padStart(17, '0')}`,
  committee_id: 'C00000001',
  contributor_name: `DONOR, NUMBER ${i}`,
  contributor_state: 'CA',
  contribution_receipt_amount: 25 + (i % 7),
  contribution_receipt_date: '2026-04-07T00:00:00',
  memo_code: i % 3 ? null : 'X',
  committee: { name: 'TEST FOR CONGRESS', cycles: [2024, 2026] },
});

// A tiny in-memory D1: just enough SQL for gap-store's statements
function fakeD1() {
  const rows = new Map();
  const key = (c, y, k, p) => `${c}|${y}|${k}|${p}`;
  const calls = { writes: 0 };
  const d1 = async (sql, params) => {
    if (sql.startsWith('SELECT')) {
      const [c, y] = params;
      return [...rows.values()]
        .filter(r => r.committee_id === c && r.cycle === y)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.pack - b.pack);
    }
    calls.writes++;
    if (sql.startsWith('INSERT')) {
      const [committee_id, cycle, kind, pack, records, data] = params;
      rows.set(key(committee_id, cycle, kind, pack), {
        committee_id,
        cycle,
        kind,
        pack,
        records,
        data,
      });
    } else if (sql.startsWith('DELETE')) {
      rows.delete(key(...params));
    }
    return [];
  };
  return { d1, rows, calls };
}

describe('gap-store', () => {
  it('packs full records and unpacks them exactly', () => {
    const records = Array.from({ length: 12 }, (_, i) => record(i));
    const [p] = packRecords(records);
    expect(p.records).toBe(12);
    expect(unpackRecords(p.data)).toEqual(records);
    // far smaller than the records as JSON
    expect(p.data.length).toBeLessThan(JSON.stringify(records).length);
  });

  it('splits a big committee into packs of PACK_SIZE', () => {
    const records = Array.from({ length: PACK_SIZE + 3 }, (_, i) => record(i));
    const packs = packRecords(records);
    expect(packs.map(p => p.records)).toEqual([PACK_SIZE, 3]);
    expect(packs.flatMap(p => unpackRecords(p.data))).toEqual(records);
  });

  it('saves, loads back, and rewrites only what changed', async () => {
    const { d1, rows, calls } = fakeD1();
    const gap = Array.from({ length: 10 }, (_, i) => record(i));
    const earmarked = [record(100)];
    await saveStored(d1, 'C00000001', 2026, { gap, earmarked });
    expect(rows.size).toBe(2);
    const back = await loadStored(d1, 'C00000001', 2026);
    expect(back.gap).toEqual(gap);
    expect(back.earmarked).toEqual(earmarked);

    // the same records again, in another order: nothing written
    calls.writes = 0;
    await saveStored(d1, 'C00000001', 2026, { gap: [...gap].reverse(), earmarked });
    expect(calls.writes).toBe(0);

    // a record gone: that pack rewritten; no earmarked any more: pack removed
    await saveStored(d1, 'C00000001', 2026, { gap: gap.slice(1), earmarked: [] });
    const after = await loadStored(d1, 'C00000001', 2026);
    expect(after.gap).toEqual(gap.slice(1));
    expect(after.earmarked).toEqual([]);
    expect(rows.size).toBe(1);
  });
});
