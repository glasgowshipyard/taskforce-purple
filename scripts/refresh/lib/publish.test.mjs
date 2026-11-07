import { describe, expect, it } from 'vitest';
import { LIST_KEY, memberKey } from '../../../workers/member-store.js';
import { publishGrades } from './publish.mjs';

// A list of two members and their stored records, and results that change
// both their grades
function fakes() {
  const kv = new Map([
    [
      LIST_KEY,
      JSON.stringify({
        members: [
          { bioguideId: 'A000001', name: 'One, Member', tier: 'C' },
          { bioguideId: 'B000002', name: 'Two, Member', tier: 'D' },
        ],
      }),
    ],
    [
      memberKey('A000001'),
      JSON.stringify({ bioguideId: 'A000001', name: 'One, Member', tier: 'C' }),
    ],
    [
      memberKey('B000002'),
      JSON.stringify({ bioguideId: 'B000002', name: 'Two, Member', tier: 'D' }),
    ],
  ]);
  const writes = [];
  const cf = {
    kvGet: async k => kv.get(k) ?? null,
    kvPut: async (k, v) => {
      writes.push(k);
      kv.set(k, v);
    },
  };
  const row = (id, tier) => ({
    bioguide_id: id,
    cycle: 2026,
    computed_at: '2026-12-06T00:00:00Z',
    status: 'complete',
    grade: JSON.stringify({ tier, individualFundingPercent: 50, evidenceChecked: true }),
    analysis: null,
    reconciliation: JSON.stringify({ ok: true }),
  });
  const d1 = async sql =>
    sql.startsWith('SELECT') ? [row('A000001', 'A'), row('B000002', 'B')] : [];
  return { cf, d1, writes };
}

describe('publishing, and the hold on big changes (2026-11-06)', () => {
  it('publishes when nothing holds it', async () => {
    const { cf, d1, writes } = fakes();
    const r = await publishGrades({ cf, d1, cycle: 2026 });
    expect(r.changed).toBe(true);
    expect(r.gradeChanges.map(c => `${c.from}->${c.to}`)).toEqual(['C->A', 'D->B']);
    expect(writes).toEqual([LIST_KEY]);
  });

  it('writes nothing when held, and says why', async () => {
    const { cf, d1, writes } = fakes();
    const r = await publishGrades({
      cf,
      d1,
      cycle: 2026,
      hold: changes => (changes.length > 1 ? 'too many' : null),
    });
    expect(r).toMatchObject({ changed: false, held: 'too many' });
    expect(r.gradeChanges).toHaveLength(2);
    expect(writes).toEqual([]);
  });
});
