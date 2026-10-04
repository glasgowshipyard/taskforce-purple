// FEC API client for the refresh job (REBUILD_SPEC.md §5).
//
// - Paced under the key's real limit. A personal api.data.gov key allows
//   1,000 calls an hour (the FEC's 429 message, 2026-10-03), so the default is
//   one call every 3.7 s (~970 an hour). An upgraded key (120 a minute, free
//   from apiinfo@fec.gov) can set FEC_MIN_INTERVAL_MS=550.
// - A 429 waits for the hourly window to free up (up to an hour); 5xx and
//   network failures retry with shorter waits. The FEC also fails
//   transiently on good queries (seen 2026-10-03).
// - Never logs the key: errors carry the path and status only.

const BASE = 'https://api.open.fec.gov/v1';
const RETRY_WAITS_MS = [2000, 5000, 15000, 30000, 60000];
const RATE_LIMIT_WAITS_MS = [60000, 300000, 600000, 900000, 1200000];
const DEFAULT_INTERVAL_MS = Number(process.env.FEC_MIN_INTERVAL_MS) || 3700;
const REQUEST_TIMEOUT_MS = 90000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class FecError extends Error {
  constructor(path, status, message) {
    super(`FEC ${status} on ${path}: ${message}`);
    this.status = status;
  }
}

/**
 * fec(path, params) -> parsed JSON. `fec.calls` counts requests made.
 * Options are for tests: fetchImpl, minIntervalMs, waits.
 */
export function createFecClient(
  apiKey,
  {
    fetchImpl = fetch,
    minIntervalMs = DEFAULT_INTERVAL_MS,
    waits = RETRY_WAITS_MS,
    rateLimitWaits = RATE_LIMIT_WAITS_MS,
  } = {}
) {
  if (!apiKey) {
    throw new Error('FEC_API_KEY is not set');
  }
  let last = 0;
  const fec = async (path, params = {}) => {
    const qs = new URLSearchParams({ api_key: apiKey });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        qs.set(k, String(v));
      }
    }
    for (let attempt = 0; ; attempt++) {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      last = Date.now();
      fec.calls++;
      let status = 0;
      let detail = '';
      try {
        const started = Date.now();
        if (process.env.FEC_DEBUG) {
          console.log(
            `  -> FEC ${path} attempt ${attempt + 1} at ${new Date().toISOString().slice(11, 19)}`
          );
        }
        // A hung request must become a retry, not a silent stall: without a
        // limit, each attempt waited ~5 minutes (Node's default) - found
        // 2026-10-04 when a dry run sat on one committee for 3 hours
        const res = await fetchImpl(`${BASE}${path}?${qs}`, {
          headers: { 'User-Agent': 'TaskForcePurple/1.0 (refresh job)' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (process.env.FEC_DEBUG) {
          const shown = Object.entries(params)
            .map(([k, v]) => `${k}=${v}`)
            .join('&');
          console.log(`  FEC ${res.status} ${Date.now() - started}ms ${path}?${shown}`);
        }
        status = res.status;
        if (res.ok) {
          const body = await res.json();
          return body;
        }
        detail = (await res.text()).slice(0, 200);
      } catch (error) {
        detail = error.message;
        if (process.env.FEC_DEBUG) {
          console.log(`  !! FEC ${path} failed: ${error.name} ${error.message}`);
        }
      }
      const temporary = status === 0 || status === 429 || status >= 500;
      const schedule = status === 429 ? rateLimitWaits : waits;
      if (!temporary || attempt >= schedule.length) {
        throw new FecError(path, status, detail.replace(apiKey, 'REDACTED'));
      }
      if (status === 429) {
        console.log(`FEC hourly limit reached; waiting ${schedule[attempt] / 60000} min`);
      }
      await sleep(schedule[attempt]);
    }
  };
  fec.calls = 0;
  return fec;
}

/**
 * Every page of a Schedule A query, using keyset pagination. `max_date` is
 * set to the cursor's date: deep cursors without it time out (504) on big
 * committees (found 2026-09-28). Calls onPage(rows) per page.
 */
export async function scheduleAPages(fec, params, onPage) {
  let last = {};
  let previous = null;
  for (;;) {
    const d = await fec('/schedules/schedule_a/', { per_page: 100, ...params, ...last });
    const rows = d.results || [];
    if (rows.length === 0) {
      return;
    }
    await onPage(rows, d.pagination);
    const li = d.pagination?.last_indexes;
    if (!li || !li.last_index) {
      return;
    }
    if (li.last_index === previous) {
      throw new Error(`Schedule A cursor did not advance (${li.last_index})`);
    }
    previous = li.last_index;
    // The cursor's date narrows the query (and keeps deep pages fast). A
    // record with no date gives a cursor with no date: then the caller's own
    // date range must stay in force, never be dropped (a dropped range turned
    // one small slice into paging a whole 600k-record committee, 2026-10-04)
    last = { last_index: li.last_index };
    if (li.last_contribution_receipt_date) {
      last.last_contribution_receipt_date = li.last_contribution_receipt_date;
      last.max_date = li.last_contribution_receipt_date;
    }
  }
}

/** The FEC's count for a Schedule A query, and whether it is exact. */
export async function scheduleACount(fec, params) {
  const d = await fec('/schedules/schedule_a/', { per_page: 1, ...params });
  return { count: d.pagination?.count ?? 0, exact: d.pagination?.is_count_exact === true };
}
