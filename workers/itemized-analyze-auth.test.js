import { describe, expect, it } from 'vitest';
import worker from './itemized-analysis.js';

// /analyze spends shared FEC requests and D1 row-writes, so it must refuse
// anyone without the owner's UPDATE_SECRET - and everyone if it isn't set

const URL_ANALYZE = 'https://itemized.example/analyze';

// Any binding access means the handler got past the auth check
function trapEnv(extra = {}) {
  return new Proxy(extra, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      throw new Error(`auth check let the request through (read env.${String(prop)})`);
    },
    has: (target, prop) => prop in target,
  });
}

async function call(env, headers = {}) {
  return worker.fetch(new Request(URL_ANALYZE, { headers }), env);
}

describe('/analyze auth', () => {
  it('refuses a request with no Authorization header', async () => {
    const res = await call(trapEnv({ UPDATE_SECRET: 's3cret' }));
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token', async () => {
    const res = await call(trapEnv({ UPDATE_SECRET: 's3cret' }), {
      Authorization: 'Bearer wrong',
    });
    expect(res.status).toBe(401);
  });

  it('refuses the bare secret without the Bearer prefix', async () => {
    const res = await call(trapEnv({ UPDATE_SECRET: 's3cret' }), { Authorization: 's3cret' });
    expect(res.status).toBe(401);
  });

  it('refuses everything while UPDATE_SECRET is unset', async () => {
    const env = trapEnv({ UPDATE_SECRET: undefined });
    expect((await call(env)).status).toBe(401);
    expect((await call(env, { Authorization: 'Bearer ' })).status).toBe(401);
    expect((await call(env, { Authorization: 'Bearer undefined' })).status).toBe(401);
    expect((await call(env, { Authorization: 'Bearer null' })).status).toBe(401);
  });

  it('lets the correct token through to the analysis run', async () => {
    const env = trapEnv({ UPDATE_SECRET: 's3cret' });
    // Past the check, the run touches bindings this env doesn't have
    await expect(call(env, { Authorization: 'Bearer s3cret' })).rejects.toThrow(
      /auth check let the request through/
    );
  });
});
