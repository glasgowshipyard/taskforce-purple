import { describe, expect, it } from 'vitest';
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

  it('gives up after three tries, with the error', async () => {
    const { fetchImpl, calls } = api(refused);
    const cf = createCloudflare({ token: 't', fetchImpl, wait: async () => {} });
    await expect(cf.d1(RESULTS_DB, 'SELECT 1')).rejects.toThrow(/7403/);
    expect(calls).toHaveLength(4);
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
