// Cloudflare REST client for the refresh job: KV and D1 only (REBUILD_SPEC §5).
//
// In GitHub Actions it uses the CLOUDFLARE_API_TOKEN secret (KV and D1 edit on
// this account, nothing else). Run locally, it falls back to this machine's
// wrangler login. It never logs a token. Writes through the API count against
// the same daily KV and D1 limits as Workers, so it counts them.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'a4bc6c41d0c4b6b1bb25dcacf9d4d55f';
export const KV_NAMESPACE = '8318226115e2423ab5d141adfa5419f9';
export const RESULTS_DB = 'f4ad9245-769d-4bb2-b772-c552907e1692'; // D1 tfp-results
const API = 'https://api.cloudflare.com/client/v4';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function localWranglerToken() {
  const file = join(homedir(), 'Library/Preferences/.wrangler/config/default.toml');
  if (!existsSync(file)) {
    return null;
  }
  // Any wrangler command refreshes the OAuth token if it has expired
  execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' });
  return readFileSync(file, 'utf8').match(/^oauth_token = "([^"]+)"/m)?.[1] || null;
}

export function createCloudflare({
  token = process.env.CLOUDFLARE_API_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const tok = token || localWranglerToken();
  if (!tok) {
    throw new Error('No CLOUDFLARE_API_TOKEN and no local wrangler login');
  }
  const stats = { kvReads: 0, kvWrites: 0, d1Queries: 0, d1RowsWritten: 0, d1RowsRead: 0 };

  async function call(method, path, { body, contentType = 'application/json', raw = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': contentType },
        body,
      });
      if (raw && res.status === 404) {
        return null;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 4) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
      }
      if (raw) {
        if (!res.ok) {
          throw new Error(`Cloudflare ${method} ${path.replace(/\?.*/, '')}: HTTP ${res.status}`);
        }
        return res.text();
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(
          `Cloudflare ${method} ${path.replace(/\?.*/, '')}: ${JSON.stringify(json.errors).slice(0, 300)}`
        );
      }
      return json;
    }
  }

  const kvPath = key =>
    `/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE}/values/${encodeURIComponent(key)}`;

  return {
    stats,
    async kvGet(key) {
      stats.kvReads++;
      return call('GET', kvPath(key), { raw: true });
    },
    async kvPut(key, value) {
      stats.kvWrites++;
      await call('PUT', kvPath(key), { body: value, contentType: 'text/plain' });
    },
    async kvList(prefix) {
      const names = [];
      let cursor = '';
      for (;;) {
        const qs = new URLSearchParams({ prefix, limit: '1000', ...(cursor ? { cursor } : {}) });
        const j = await call(
          'GET',
          `/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE}/keys?${qs}`
        );
        names.push(...j.result.map(k => k.name));
        cursor = j.result_info?.cursor;
        if (!cursor) {
          return names;
        }
      }
    },
    /** One SQL statement against a D1 database; returns the result rows. */
    async d1(databaseId, sql, params = []) {
      stats.d1Queries++;
      const j = await call('POST', `/accounts/${ACCOUNT_ID}/d1/database/${databaseId}/query`, {
        body: JSON.stringify({ sql, params }),
      });
      const r = j.result?.[0];
      stats.d1RowsWritten += r?.meta?.rows_written || 0;
      stats.d1RowsRead += r?.meta?.rows_read || 0;
      return r?.results || [];
    },
    async d1Databases() {
      const j = await call('GET', `/accounts/${ACCOUNT_ID}/d1/database?per_page=100`);
      return j.result;
    },
  };
}
