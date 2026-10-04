// System health checks behind the API worker's /api/health (REBUILD_SPEC §8).
//
// Rewritten for the rebuild (2026-10-04): the refresh job (GitHub Actions)
// does the FEC work and records each run in D1 `tfp-results`; the API worker
// serves the site from KV. Anything worth telling the owner about is a
// problem, with the reason and a proposed fix; everything else is a note.
//
// Pure: takes a snapshot, returns a verdict.

const HOUR = 3600 * 1000;
// A GitHub job can't run longer than 6 hours: a run still "running" after 7
// died without recording its end
export const RUN_STUCK_MS = 7 * HOUR;
// The meter stops the job at 85k; D1 refuses writes at 100k (account-wide)
export const D1_ALARM_ROWS = 95000;
export const MIN_MEMBERS = 530;

// The proposed fix for each problem, shown in the alert
export const FIXES = {
  'site-data-missing':
    'Rebuild members:list from the member:{id} records (one KV write), then check the site loads.',
  'site-data-short':
    'Compare the list with Congress.gov, then add each missing member with /api/process-candidate.',
  'results-db-unreadable':
    'Check the RESULTS_DB binding in the API worker’s wrangler.toml and redeploy it.',
  'refresh-failed':
    'Read the error in the run’s log (Actions → Refresh), fix the cause, then run Refresh again: it carries on the round where it stopped.',
  'refresh-stuck':
    'The job was killed before it could record its end (GitHub’s 6-hour limit or a runner fault). Run Refresh again: it skips members already done.',
  'members-failing':
    'They retry on the next run. The same reason twice in a row means a code fault to fix; an FEC outage clears itself.',
  'committee-mismatch':
    'Compare the committee’s records with the FEC’s month by month to find the missing ones; until then its members stay pending, not graded.',
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
 * @param {number|null} s.d1RowsToday       tfp-results d1_write_budget for today
 * @param {string|null} s.resultsDbError    set when tfp-results can't be read
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
    if ((s.d1RowsToday || 0) >= D1_ALARM_ROWS) {
      problem(
        'd1-over-budget',
        `The refresh job has written ${s.d1RowsToday.toLocaleString()} D1 rows today. Its own cap is 85,000 and D1 refuses writes at 100,000 for the whole account.`
      );
    }
  }

  return { ok: problems.length === 0, problems, notes };
}
