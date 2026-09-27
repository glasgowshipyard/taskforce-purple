#!/usr/bin/env bash
# Turn the itemized worker's /health verdict into a GitHub issue alert.
#
#   unhealthy, no alert open  -> open an issue that @mentions the owner
#   unhealthy, problems changed -> comment on it (mentions again)
#   unhealthy, same problems  -> nothing (you've already been told)
#   healthy, alert open       -> comment "recovered" and close it
#
# Run hourly by .github/workflows/health-alert.yml. Locally:
#   DRY_RUN=1 bash scripts/health-alert.sh     # shows what it would do
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://taskforce-purple-itemized-analysis.dev-a4b.workers.dev/health}"
OWNER="${ALERT_MENTION:-glasgowshipyard}"
LABEL="system-alert"
run() { if [ -n "${DRY_RUN:-}" ]; then echo "[dry run] $*"; else "$@"; fi; }

if ! health=$(curl -sf --max-time 60 "$HEALTH_URL") || ! jq -e 'has("ok")' >/dev/null 2>&1 <<<"$health"; then
  health='{"ok":false,"problems":[{"id":"health-unreachable","message":"The health check page did not answer, so nothing else could be checked. The worker may be down."}],"notes":[]}'
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

problems=$(jq -r '.problems[] | "- " + .message' <<<"$health")
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
