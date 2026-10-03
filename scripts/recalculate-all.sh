#!/usr/bin/env bash
# Re-grade every member (REBUILD_SPEC Stage 1). The API re-grades a slice per
# call (10 members by default) to stay inside Cloudflare's 10 ms CPU limit,
# and writes only members whose record changes. This walks every slice.
#
#   UPDATE_SECRET=... bash scripts/recalculate-all.sh
# (the current UPDATE_SECRET is in API_KEYS.md)
set -euo pipefail
: "${UPDATE_SECRET:?set UPDATE_SECRET (see API_KEYS.md)}"
API="https://taskforce-purple-api.dev-a4b.workers.dev/api/recalculate-tiers"
offset=0; limit=10; changed=0; errors=0
while [ "$offset" != "null" ]; do
  r=$(curl -s -X POST "$API?offset=$offset&limit=$limit" -H "Authorization: Bearer $UPDATE_SECRET")
  if ! jq -e '.success == true' >/dev/null 2>&1 <<<"$r"; then
    if [ "$limit" -gt 2 ]; then
      limit=$((limit / 2)); echo "  slice at $offset failed; retrying with $limit"; continue
    fi
    echo "Stopped at offset $offset: $(head -c 300 <<<"$r")"; exit 1
  fi
  changed=$((changed + $(jq '.stats.changed' <<<"$r"))); errors=$((errors + $(jq '.stats.errors' <<<"$r")))
  offset=$(jq -r '.stats.nextOffset' <<<"$r")
  printf '.'
done
echo; echo "Done: $changed member(s) changed, $errors error(s)."
