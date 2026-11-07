#!/usr/bin/env bash
# Turn the API worker's /api/health verdict into a GitHub issue alert.
#
#   unhealthy, no alert open  -> open an issue that @mentions the owner
#   unhealthy, problems changed -> comment on it (mentions again)
#   unhealthy, same problems  -> nothing (you've already been told)
#   healthy, alert open       -> comment "recovered" and close it
#
# Run at the end of every refresh job (.github/workflows/refresh.yml), which
# sets JOB_FAILED_URL when the job itself failed, and of every daily
# calendar check; no clock of its own (the hourly health-alert.yml was
# removed on 2026-10-24, owner). Locally:
#   DRY_RUN=1 bash scripts/health-alert.sh     # shows what it would do
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://taskforce-purple-api.dev-a4b.workers.dev/api/health}"
OWNER="${ALERT_MENTION:-glasgowshipyard}"
LABEL="system-alert"
run() { if [ -n "${DRY_RUN:-}" ]; then echo "[dry run] $*"; else "$@"; fi; }

if ! health=$(curl -sf --max-time 60 "$HEALTH_URL") || ! jq -e 'has("ok")' >/dev/null 2>&1 <<<"$health"; then
  health='{"ok":false,"problems":[{"id":"health-unreachable","message":"The health check page did not answer, so nothing else could be checked. The API worker may be down.","fix":"Check the worker in the Cloudflare dashboard (Workers → taskforce-purple-api → Logs) and redeploy it with npx wrangler deploy."}],"notes":[]}'
fi

# The refresh job itself failed (its log has the error)
if [ -n "${JOB_FAILED_URL:-}" ]; then
  health=$(jq --arg url "$JOB_FAILED_URL" '.ok = false | .problems = [{
    id: "refresh-job-failed",
    message: ("The refresh job failed. Log: " + $url),
    fix: "Read the error at the end of the log, fix the cause, then run Refresh again: it carries on the round where it stopped."
  }] + .problems' <<<"$health")
fi

# The site's outside-spending figures stuck (the daily check's
# outside-check.mjs: the build couldn't read the FEC's files for two days)
if [ -n "${OUTSIDE_STALE:-}" ]; then
  health=$(jq --arg msg "$OUTSIDE_STALE" '.ok = false | .problems += [{
    id: "outside-spending-stale",
    message: $msg,
    fix: "Open the latest Cloudflare Pages build log and look for the outside spending line. If the FEC was down it clears itself on the next build; otherwise fix scripts/site/outside.mjs and push."
  }]' <<<"$health")
fi

# The refresh job held its publishing: more grades would change than a
# filing refresh moves (run.mjs HOLD_SHARE)
if [ -n "${REFRESH_HELD:-}" ]; then
  health=$(jq --arg msg "Publishing was held: $REFRESH_HELD. The site keeps its current grades." --arg url "${RUN_URL:-}" '.ok = false | .problems += [{
    id: "refresh-held",
    message: $msg,
    fix: ("Read the changes listed in the run log (" + $url + "). If they come from new filings or a change you meant, run the refresh again with allow_big_changes on; if not, find what moved them before publishing.")
  }]' <<<"$health")
fi

# The totals check at the end of a refresh run found a member whose money
# doesn't match the FEC's own totals (scripts/verify/lib/totals.mjs)
if [ -n "${REFRESH_TOTALS:-}" ]; then
  health=$(jq --arg msg "$REFRESH_TOTALS" '.ok = false | .problems += [{
    id: "totals",
    message: $msg,
    fix: "Run node scripts/verify/totals-check.mjs for the full list (RUNBOOK §5), then check each member'"'"'s committees against the FEC: a committee missing from their pool, or counted from the wrong date."
  }]' <<<"$health")
fi

# Who won (the daily check's results.mjs): the check failed, or a called
# race's winner fits no candidate in it, so that race shows no winner
if [ -n "${RESULTS_PROBLEM:-}" ]; then
  health=$(jq --arg msg "$RESULTS_PROBLEM" '.ok = false | .problems += [{
    id: "results",
    message: $msg,
    fix: "If the check failed, read the daily check'"'"'s log: Wikipedia down clears itself the next day. If a winner fits no candidate, compare the name Wikipedia ticks with the race'"'"'s candidates: a spelling difference goes in winnerIn (scripts/refresh/lib/results.mjs); a wrong tick clears itself when the page is corrected."
  }]' <<<"$health")
fi

ok=$(jq -r '.ok' <<<"$health")
sig=$(jq -r '[.problems[].id] | sort | join(",")' <<<"$health")
open=$(gh issue list --label "$LABEL" --state open --json number -q '.[0].number // empty' 2>/dev/null || true)

if [ "$ok" = "true" ]; then
  echo "Healthy."
  if [ -n "$open" ]; then
    run gh issue close "$open" --comment "Recovered: every check passes as of $(date -u '+%Y-%m-%d %H:%M UTC')."
  fi
  exit 0
fi

problems=$(jq -r '.problems[] | "- " + .message + (if .fix then "\n  Proposed fix: " + .fix else "" end)' <<<"$health")
notes=$(jq -r '(.notes // [])[] | "- " + .' <<<"$health")
body="@${OWNER} something needs attention (checked $(date -u '+%Y-%m-%d %H:%M UTC')):

${problems}
${notes:+
Also noted:
${notes}
}
How to look into it: RUNBOOK.md §10 (Alerts). Raw verdict: ${HEALTH_URL}
This issue closes itself when every check passes again.

<!-- alert-sig: ${sig} -->"
echo "$body"

if [ -z "$open" ]; then
  run gh label create "$LABEL" --color B60205 --description "Automatic health alert" 2>/dev/null || true
  count=$(jq '.problems | length' <<<"$health")
  title="System alert: $(jq -r '.problems[0].id' <<<"$health")"
  if [ "$count" -gt 1 ]; then title="$title (+$((count - 1)) more)"; fi
  run gh issue create --label "$LABEL" --title "$title" --body "$body"
  exit 0
fi

last=$(gh issue view "$open" --json body,comments -q '([.body] + [.comments[].body]) | last')
if grep -q "alert-sig: ${sig} -->" <<<"$last"; then
  echo "Alert #$open already open with the same problems; not repeating."
else
  run gh issue comment "$open" --body "$body"
fi
