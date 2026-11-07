import { describe, expect, it, vi } from 'vitest';
import { RESULTS_DB, createCloudflare } from './cloudflare.mjs';

// Answers in turn, as Cloudflare's API would give them
function api(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { status: a.status ?? 200, ok: (a.status ?? 200) < 400, json: async () => a.body };
  };
  return { fetchImpl, calls };
}
const ok = { body: { success: true, result: [{ results: [{ n: 1 }], meta: {} }] } };
const refused = {
  status: 403,
  body: {
    success: false,
    errors: [{ code: 7403, message: 'The given account is not valid or is not authorized' }],
  },
};

describe('the Cloudflare client (#64)', () => {
  it('sends a D1 query again when Cloudflare refuses it with 7403', async () => {
    const { fetchImpl, calls } = api(refused, ok);
    const cf = createCloudflare({ token: 't', fetchImpl, wait: async () => {} });
    expect(await cf.d1(RESULTS_DB, 'SELECT 1 AS n')).toEqual([{ n: 1 }]);
    expect(calls).toHaveLength(2);
  });

  it('waits 30 seconds, a minute, 5, 10 and 30 minutes, an hour and 2 hours, then gives up', async () => {
    const { fetchImpl, calls } = api(refused);
    const waits = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cf = createCloudflare({ token: 't', fetchImpl, wait: async ms => waits.push(ms) });
    await expect(cf.d1(RESULTS_DB, 'SELECT 1')).rejects.toThrow(/7403.*refused on every try/);
    expect(waits).toEqual([30, 60, 300, 600, 1800, 3600, 7200].map(s => s * 1000));
    expect(calls).toHaveLength(8);
    const said = log.mock.calls.map(c => c[0]);
    expect(said[0]).toMatch(/^::warning::Cloudflare POST .*7403.*trying again in 30 seconds \(#64\)$/);
    expect(said[1]).toMatch(/trying again in 1 minute \(#64\)$/);
    expect(said[6]).toMatch(/trying again in 2 hours \(#64\)$/);
    log.mockRestore();
  });

  it("never waits past the job's own time limit", async () => {
    const { fetchImpl, calls } = api(refused);
    const waits = [];
    let t = 0;
    const cf = createCloudflare({
      token: 't',
      fetchImpl,
      now: () => t,
      wait: async ms => {
        waits.push(ms);
        t += ms;
      },
      deadline: 10 * 60000,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // 30 s, 1 and 5 minutes fit in ten; the 10-minute wait doesn't
    await expect(cf.d1(RESULTS_DB, 'SELECT 1')).rejects.toThrow(/no time left in this job/);
    expect(waits).toEqual([30000, 60000, 300000]);
    expect(calls).toHaveLength(4);
    vi.restoreAllMocks();
  });

  it("a busy Cloudflare doesn't use up the tries for a refusal", async () => {
    const busy = { status: 503, body: {} };
    const { fetchImpl, calls } = api(busy, busy, busy, busy, refused, ok);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cf = createCloudflare({ token: 't', fetchImpl, wait: async () => {} });
    expect(await cf.d1(RESULTS_DB, 'SELECT 1 AS n')).toEqual([{ n: 1 }]);
    expect(calls).toHaveLength(6);
    vi.restoreAllMocks();
  });

  it('does not retry other refusals', async () => {
    const { fetchImpl, calls } = api({
      status: 400,
      body: { success: false, errors: [{ code: 7500, message: 'syntax error' }] },
    });
    const cf = createCloudflare({ token: 't', fetchImpl, wait: async () => {} });
    await expect(cf.d1(RESULTS_DB, 'SELEC 1')).rejects.toThrow(/7500/);
    expect(calls).toHaveLength(1);
  });
});
