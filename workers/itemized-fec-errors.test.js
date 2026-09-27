import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndAggregateChunk, donorPool } from './itemized-analysis.js';
import { committeeSignature } from './person-funding.js';

// A temporary FEC error mid-run must keep the pages already fetched and must
// not count as a failure; only repeated runs that get nothing do (#44)

const BIO = 'X000001';
const CMTE = 'C00000001';

function kv(initial) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async k => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async k => void store.delete(k),
  };
}

function setup(progressExtra = {}) {
  const personFunding = {
    fetchedAt: new Date().toISOString(),
    donorCommitteeIds: [CMTE],
    committees: [],
  };
  const pool = donorPool(personFunding, CMTE);
  const progress = {
    bioguideId: BIO,
    committeeId: CMTE,
    committeeIds: pool,
    committeeSignature: committeeSignature(pool),
    committeeIndex: 0,
    personFunding,
    cycle: 2026,
    totalTransactions: 0,
    totalAmount: 0,
    rawRowCount: 0,
    fecTotalCount: 0,
    countedCommittees: [],
    perCommittee: {},
    runsCompleted: 0,
    lastIndex: null,
    lastContributionReceiptDate: null,
    donorTotals: {},
    allAmounts: [],
    conduitTotals: {},
    earmarkedTotal: 0,
    earmarkedCount: 0,
    ...progressExtra,
  };
  const members = [
    {
      bioguideId: BIO,
      name: 'Test Member',
      fecIdentityVerified: true,
      committeeInfo: { id: CMTE },
    },
  ];
  const MEMBER_DATA = kv({
    'members:all': JSON.stringify(members),
    [`itemized_progress_v2:${BIO}`]: JSON.stringify(progress),
  });
  return { env: { MEMBER_DATA, FEC_API_KEY: 'test' }, MEMBER_DATA };
}

const page = n => ({
  ok: true,
  status: 200,
  json: async () => ({
    results: [
      {
        line_number: '11AI',
        entity_type: 'IND',
        contribution_receipt_amount: 250,
        contributor_first_name: `DONOR${n}`,
        contributor_last_name: 'SMITH',
        contributor_state: 'NY',
        contributor_zip: '10001',
        sub_id: `SUB${n}`,
      },
    ],
    pagination: {
      count: 50,
      is_count_exact: true,
      last_indexes: { last_index: `L${n}`, last_contribution_receipt_date: '2026-01-01' },
    },
  }),
});
const failure = status => ({ ok: false, status, statusText: 'Gateway Timeout' });

const progressOf = MEMBER_DATA => JSON.parse(MEMBER_DATA.store.get(`itemized_progress_v2:${BIO}`));
const run = env => fetchAndAggregateChunk(BIO, env, () => {}, 5);

afterEach(() => vi.unstubAllGlobals());

describe('FEC errors during collection', () => {
  it('keeps pages fetched before a 504 and does not throw', async () => {
    const { env, MEMBER_DATA } = setup();
    const replies = [page(1), page(2), failure(504)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => replies.shift())
    );

    const result = await run(env);

    expect(result.complete).toBe(false);
    const p = progressOf(MEMBER_DATA);
    expect(p.rawRowCount).toBe(2);
    expect(p.totalTransactions).toBe(2);
    expect(p.lastIndex).toBe('L2'); // next run resumes after page 2
    expect(p.stalledRuns).toBe(0);
  });

  it('a run that gets nothing is not a failure until the third in a row', async () => {
    const { env, MEMBER_DATA } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => failure(504))
    );

    await expect(run(env)).resolves.toMatchObject({ complete: false });
    await expect(run(env)).resolves.toMatchObject({ complete: false });
    await expect(run(env)).rejects.toThrow(/504.*3 runs in a row/);
    expect(progressOf(MEMBER_DATA).stalledRuns).toBe(3);
  });

  it('one good page resets the stall count', async () => {
    const { env, MEMBER_DATA } = setup({ stalledRuns: 2 });
    const replies = [page(1), failure(429)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => replies.shift())
    );

    await run(env);
    expect(progressOf(MEMBER_DATA).stalledRuns).toBe(0);
  });

  it('a non-temporary FEC error still fails the run', async () => {
    const { env } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request' }))
    );
    await expect(run(env)).rejects.toThrow(/FEC API error: 400/);
  });
});
