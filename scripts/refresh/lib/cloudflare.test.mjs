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

  // A clock the waits move on, and the waits written down
  const clock = () => {
    const waits = [];
    let t = 0;
    return { waits, now: () => t, wait: async ms => waits.push(ms) && (t += ms) };
  };

  it("builds up to 5 minutes, then tries every 5 minutes until the job's time limit", async () => {
    const { fetchImpl, calls } = api(refused);
    const { waits, now, wait } = clock();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cf = createCloudflare({ token: 't', fetchImpl, now, wait, deadline: 30 * 60000 });
    await expect(cf.d1(RESULTS_DB, 'SELECT 1')).rejects.toThrow(/7403.*no time left in this job/);
    // 8.5 minutes of building up, then 5-minute waits while they fit in 30
    expect(waits).toEqual([30, 60, 120, 300, 300, 300, 300, 300].map(s => s * 1000));
    expect(calls).toHaveLength(9);
    const said = log.mock.calls.map(c => c[0]);
    expect(said[0]).toMatch(
      /^::warning::Cloudflare POST .*7403.*trying again in 30 seconds \(#64\)$/
    );
    expect(said[1]).toMatch(/trying again in 1 minute \(#64\)$/);
    expect(said[2]).toMatch(/trying again in 2 minutes \(#64\)$/);
    expect(said[7]).toMatch(/trying again in 5 minutes \(#64\)$/);
    log.mockRestore();
  });

  it('run by hand, with no job limit, gives up after an hour of refusals', async () => {
    const { fetchImpl, calls } = api(refused);
    const { waits, now, wait } = clock();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cf = createCloudflare({ token: 't', fetchImpl, now, wait, deadline: Infinity });
    await expect(cf.d1(RESULTS_DB, 'SELECT 1')).rejects.toThrow(/7403.*refused for an hour/);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3600000);
    expect(waits).toHaveLength(14);
    expect(calls).toHaveLength(15);
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
