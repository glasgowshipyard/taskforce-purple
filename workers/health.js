// System health checks behind the API worker's /api/health (REBUILD_SPEC §8).
//
// Rewritten for the rebuild (2026-10-04): the refresh job (GitHub Actions)
// does the FEC work and records each run in D1 `tfp-results`; the API worker
// serves the site from KV. Anything worth telling the owner about is a
// problem, with the reason and a proposed fix; everything else is a note.
//
// evaluateHealth is pure: takes a snapshot, returns a verdict. loadHealth
// reads the snapshot (KV and D1, every lookup on an index); /api/health and
// /admin both use it.

import { getListBody } from './member-store.js';

const HOUR = 3600 * 1000;
// A GitHub job can't run longer than 6 hours: a run still "running" after 7
// died without recording its end
export const RUN_STUCK_MS = 7 * HOUR;
// The meter stops the job at 85k; D1 refuses writes at 100k (account-wide)
export const D1_ALARM_ROWS = 95000;
// D1 refuses every read on the account at 5M rows a day; the job stops at 3M
export const D1_READ_ALARM_ROWS = 4000000;
// D1 refuses writes to a database over 500 MB (2026-10-05: it happened)
export const D1_SIZE_ALARM_BYTES = 400 * 1000 * 1000;
export const MIN_MEMBERS = 530;
// A grade flag or race report nobody has dealt with after this many days is
// a problem (the corrections page promises reports are read within it)
export const FLAG_WAIT_DAYS = 3;
// The site's pre-built pages should be rebuilt within this long of the
// published grades changing (refresh.yml starts the build)
export const PAGES_STALE_MS = 6 * HOUR;
const SITE = 'https://taskforcepurple.com';

// The proposed fix for each problem, shown in the alert
export const FIXES = {
  'site-data-missing':
    'Rebuild members:list from the member:{id} records (one KV write), then check the site loads.',
  'site-data-short':
    'Run the Filing calendar workflow (calendar.yml): its roster step adds missing members and grades them. Check the roster first with node scripts/refresh/roster.mjs --dry-run.',
  'results-db-unreadable':
    'If the error says a daily limit was exceeded, D1 refuses reads on the whole account until midnight UTC (5 pm PDT): find what read so much (RUNBOOK §6) before running anything else. Otherwise check the RESULTS_DB binding in the API worker’s wrangler.toml and redeploy it.',
  'd1-reads-high':
    'Something read far more than the refresh job should (it stops at 3M). Check reads by database (RUNBOOK §6) and stop whatever is reading; at 5M D1 refuses reads on the whole account until midnight UTC.',
  'refresh-failed':
    'Read the error in the run’s log (Actions → Refresh), fix the cause, then run Refresh again: it carries on the round where it stopped.',
  'refresh-stuck':
    'The job was killed before it could record its end (GitHub’s 6-hour limit or a runner fault). Run Refresh again: it skips members already done.',
  'members-failing':
    'They retry on the next run. The same reason twice in a row means a code fault to fix; an FEC outage clears itself.',
  'committee-mismatch':
    'Compare the committee’s records with the FEC’s month by month to find the missing ones; until then its members stay pending, not graded.',
  'd1-size-high':
    'The results database is near D1’s 500 MB limit, past which it refuses every write. Find the biggest table (RUNBOOK §6) and pack or remove what isn’t needed before the next refresh.',
  'pages-stale':
    'The site still works (its pages load the live grades), but search engines and link previews see old ones. Start a build: Cloudflare dashboard → Workers & Pages → the site → Deployments → retry the latest. If the refresh job’s “Rebuild the site’s pages” step warned that PAGES_DEPLOY_HOOK is missing, add the deploy hook as that GitHub secret.',
  'flags-waiting':
    'Open taskforcepurple.com/admin and deal with each one: check a grade flag against the member’s figures, or a race report against the state’s list of candidates, then mark it done, or bin it if it’s not a real problem.',
  'd1-over-budget':
    'The job stops itself at 85,000. Find which of the account’s other projects wrote the rest before running it again today.',
};

/**
 * @param {object} s
 * @param {number|null} s.listMembers       members in members:list (null = missing)
 * @param {string|null} s.listLastUpdated   members:list lastUpdated
 * @param {object|null} s.lastRun           latest row of tfp-results `runs`
 * @param {Array} s.failingMembers          member_progress rows with status 'failed'
 * @param {Array} s.mismatchedCommittees    committees rows with status 'mismatch'
 * @param {number|null} s.d1RowsToday       tfp-results d1_write_budget rows written today
 * @param {number|null} s.d1RowsReadToday   tfp-results d1_write_budget rows read today
 * @param {number|null} s.d1SizeBytes       tfp-results size, from D1's own figure
 * @param {string|null} s.resultsDbError    set when tfp-results can't be read
 * @param {object|null} s.staleFlags        { count, oldest }: grade flags open longer than FLAG_WAIT_DAYS
 * @param {string|null} s.pagesBuiltAt      when the site's pre-built pages were last built
 */
export function evaluateHealth(s, nowMs = Date.now()) {
  const problems = [];
  const notes = [];
  const problem = (id, message) => problems.push({ id, message, fix: FIXES[id] });

  if (s.listMembers === null) {
    problem('site-data-missing', 'The site has no member list to serve (members:list is missing).');
  } else if (s.listMembers < MIN_MEMBERS) {
    problem(
      'site-data-short',
      `The site's member list has ${s.listMembers} members; expected at least ${MIN_MEMBERS}.`
    );
  }
  if (s.listLastUpdated) {
    notes.push(`The site's data last changed ${s.listLastUpdated}.`);
  }

  if (s.resultsDbError) {
    problem(
      'results-db-unreadable',
      `The refresh job's database can't be read: ${s.resultsDbError}`
    );
  } else {
    const run = s.lastRun;
    if (!run) {
      notes.push('The refresh job has not recorded a run yet.');
    } else if (run.status === 'failed') {
      problem('refresh-failed', `The last refresh run (${run.run_id}) failed.`);
    } else if (run.status === 'running' && nowMs - Date.parse(run.started_at) > RUN_STUCK_MS) {
      problem(
        'refresh-stuck',
        `The refresh run ${run.run_id} started ${run.started_at} and never recorded its end.`
      );
    } else {
      notes.push(
        `Last refresh run: ${run.run_id}, ${run.status}${run.finished_at ? `, finished ${run.finished_at}` : ''}.`
      );
    }

    const failing = s.failingMembers || [];
    if (failing.length) {
      problem(
        'members-failing',
        `${failing.length} member(s) failed in the refresh job (they retry; nobody is dropped): ` +
          failing
            .slice(0, 10)
            .map(
              m =>
                `${m.bioguide_id} (attempt ${m.attempts}): ${m.last_error || 'no reason recorded'}`
            )
            .join('; ')
      );
    }
    const mismatched = s.mismatchedCommittees || [];
    if (mismatched.length) {
      problem(
        'committee-mismatch',
        `${mismatched.length} committee(s) have records missing that couldn't be filled from the FEC, so their members stay pending: ` +
          mismatched
            .slice(0, 10)
            .map(c => `${c.committee_id}${c.name ? ` ${c.name}` : ''}`)
            .join('; ')
      );
    }
    if ((s.d1RowsReadToday || 0) >= D1_READ_ALARM_ROWS) {
      problem(
        'd1-reads-high',
        `The refresh job has read ${s.d1RowsReadToday.toLocaleString()} D1 rows today. D1 refuses reads on the whole account at 5,000,000.`
      );
    }
    if (s.d1SizeBytes) {
      notes.push(
        `The refresh job's database is ${Math.round(s.d1SizeBytes / 1e6)} MB of D1's 500.`
      );
    }
    if ((s.d1SizeBytes || 0) >= D1_SIZE_ALARM_BYTES) {
      problem(
        'd1-size-high',
        `The refresh job's database is ${Math.round(s.d1SizeBytes / 1e6)} MB; D1 refuses writes at 500 MB.`
      );
    }
    if ((s.d1RowsToday || 0) >= D1_ALARM_ROWS) {
      problem(
        'd1-over-budget',
        `The refresh job has written ${s.d1RowsToday.toLocaleString()} D1 rows today. Its own cap is 85,000 and D1 refuses writes at 100,000 for the whole account.`
      );
    }
  }

  const listAt = Date.parse(s.listLastUpdated || '');
  const builtAt = Date.parse(s.pagesBuiltAt || '');
  if (listAt > builtAt && nowMs - listAt > PAGES_STALE_MS) {
    problem(
      'pages-stale',
      `The grades changed ${s.listLastUpdated}, but the site's pre-built pages were last built ${s.pagesBuiltAt}.`
    );
  }

  if (s.staleFlags?.count > 0) {
    problem(
      'flags-waiting',
      `${s.staleFlags.count} grade flag(s) or race report(s) from visitors have waited more than ${FLAG_WAIT_DAYS} days on /admin; the oldest was sent ${String(s.staleFlags.oldest ?? '').slice(0, 10)}.`
    );
  }

  return { ok: problems.length === 0, problems, notes };
}

/** The snapshot evaluateHealth judges: KV's member list, and tfp-results */
export async function loadHealth(env, now = new Date()) {
  const body = await getListBody(env);
  const snapshot = {
    listMembers: body?.members?.length ?? null,
    listLastUpdated: body?.lastUpdated ?? null,
    lastRun: null,
    failingMembers: [],
    mismatchedCommittees: [],
    d1RowsToday: null,
    d1RowsReadToday: null,
    d1SizeBytes: null,
    resultsDbError: null,
    staleFlags: null,
    pagesBuiltAt: null,
  };
  // When the site's pages were last built (scripts/site/prerender.mjs)
  try {
    const response = await fetch(`${SITE}/prerender-state.json`, {
      signal: AbortSignal.timeout(3000),
    });
    snapshot.pagesBuiltAt = response.ok ? ((await response.json()).builtAt ?? null) : null;
  } catch {
    // Unknown: no verdict on it
  }
  try {
    if (!env.RESULTS_DB) {
      throw new Error('the RESULTS_DB binding is missing from wrangler.toml');
    }
    const today = now.toISOString().slice(0, 10);
    const [run, failing, mismatched, ledger] = await env.RESULTS_DB.batch([
      env.RESULTS_DB.prepare(
        'SELECT run_id, status, started_at, finished_at FROM runs ORDER BY started_at DESC LIMIT 1'
      ),
      env.RESULTS_DB.prepare(
        "SELECT bioguide_id, attempts, last_error FROM member_progress WHERE status = 'failed' ORDER BY updated_at DESC"
      ),
      env.RESULTS_DB.prepare("SELECT committee_id, name FROM committees WHERE status = 'mismatch'"),
      env.RESULTS_DB.prepare('SELECT * FROM d1_write_budget WHERE day = ?').bind(today),
    ]);
    snapshot.lastRun = run.results[0] ?? null;
    snapshot.failingMembers = failing.results;
    snapshot.mismatchedCommittees = mismatched.results;
    snapshot.d1RowsToday = ledger.results[0]?.rows_written ?? 0;
    snapshot.d1RowsReadToday = ledger.results[0]?.rows_read ?? 0;
    // D1 reports the database's size with every query
    snapshot.d1SizeBytes =
      [run, failing, mismatched, ledger].map(r => r?.meta?.size_after).find(Boolean) ?? null;
  } catch (error) {
    snapshot.resultsDbError = error.message;
  }
  // On its own, so the feedback table can't hide the checks above
  if (env.RESULTS_DB && !snapshot.resultsDbError) {
    try {
      const before = new Date(now.getTime() - FLAG_WAIT_DAYS * 86400000).toISOString();
      const row = await env.RESULTS_DB.prepare(
        "SELECT COUNT(*) AS count, MIN(at) AS oldest FROM feedback WHERE status = 'open' AND at < ? AND (kind = 'flag' OR (kind = 'suggestion' AND reason = 'race'))"
      )
        .bind(before)
        .first();
      snapshot.staleFlags = { count: row?.count ?? 0, oldest: row?.oldest ?? null };
    } catch (error) {
      snapshot.resultsDbError = `the feedback table: ${error.message}`;
    }
  }
  return snapshot;
}
