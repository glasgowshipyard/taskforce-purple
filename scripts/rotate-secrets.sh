#!/usr/bin/env bash
# Rotate Task Force Purple's credentials into Cloudflare Worker secrets.
#
# Asks for ONE thing: the new api.data.gov key (typed/pasted, not shown).
# Everything else is automatic:
#   - generates a new random UPDATE_SECRET (the token that guards the API's
#     admin endpoints; the old one is public in the repo's history)
#   - sets FEC_API_KEY, CONGRESS_API_KEY and UPDATE_SECRET on the pipeline
#     worker, and FEC_API_KEY and UPDATE_SECRET on the itemized worker (its
#     /analyze endpoint refuses every request without UPDATE_SECRET)
#   - sets FEC_API_KEY in GitHub Actions for the refresh job
#     (REBUILD_SPEC §5), if the GitHub CLI is logged in
#   - records the new values in your local, gitignored API_KEYS.md
#   - checks both workers now list the secrets
#
# Values never appear on screen and are never written anywhere tracked.
#
#   bash scripts/rotate-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git check-ignore -q API_KEYS.md || { echo "API_KEYS.md is not gitignored - stopping."; exit 1; }

printf 'Paste the NEW api.data.gov key, then press Enter (input hidden): '
read -rs NEW_KEY
echo
if ! [[ "$NEW_KEY" =~ ^[A-Za-z0-9]{40}$ ]]; then
  echo "That doesn't look like an api.data.gov key (40 letters/digits). Nothing was changed."
  exit 1
fi
NEW_UPDATE_SECRET=$(openssl rand -hex 32)

put() { # worker-config-flag secret-name value
  local cfg=$1 name=$2 value=$3
  if [ -n "$cfg" ]; then
    printf '%s' "$value" | (cd workers && npx wrangler secret put "$name" --config wrangler-itemized-analysis.toml >/dev/null)
  else
    printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
  fi
  echo "  set $name on ${cfg:+itemized worker}${cfg:-pipeline worker}"
}

echo "Setting secrets..."
put "" FEC_API_KEY "$NEW_KEY"
put "" CONGRESS_API_KEY "$NEW_KEY"
put "" UPDATE_SECRET "$NEW_UPDATE_SECRET"
put itemized FEC_API_KEY "$NEW_KEY"
if gh auth status >/dev/null 2>&1; then
  # The refresh job (REBUILD_SPEC §5) uses the same key from GitHub Actions
  printf '%s' "$NEW_KEY" | gh secret set FEC_API_KEY >/dev/null && echo "  set FEC_API_KEY in GitHub Actions"
else
  echo "  GitHub CLI not logged in: GitHub's FEC_API_KEY NOT updated (run scripts/set-github-secrets.sh)"
fi
put itemized UPDATE_SECRET "$NEW_UPDATE_SECRET"

{
  echo
  echo "## Rotated $(date -u +%Y-%m-%d) - CURRENT (set as Cloudflare Worker secrets)"
  echo
  echo "- api.data.gov key (FEC_API_KEY and CONGRESS_API_KEY): \`$NEW_KEY\`"
  echo "- UPDATE_SECRET (admin endpoints; use as \$UPDATE_SECRET in RUNBOOK): \`$NEW_UPDATE_SECRET\`"
  echo "- Everything above this section is RETIRED - those values are public in the repo's history."
} >> API_KEYS.md
echo "Recorded the new values at the end of API_KEYS.md (gitignored)."

echo "Checking both workers..."
p=$(npx wrangler secret list 2>/dev/null)
i=$(cd workers && npx wrangler secret list --config wrangler-itemized-analysis.toml 2>/dev/null)
ok=1
for n in FEC_API_KEY CONGRESS_API_KEY UPDATE_SECRET; do
  if grep -q "\"$n\"" <<<"$p"; then echo "  pipeline: $n present"; else echo "  pipeline: $n MISSING"; ok=0; fi
done
for n in FEC_API_KEY UPDATE_SECRET; do
  if grep -q "\"$n\"" <<<"$i"; then echo "  itemized: $n present"; else echo "  itemized: $n MISSING"; ok=0; fi
done

unset NEW_KEY NEW_UPDATE_SECRET
if [ "$ok" = 1 ]; then
  echo "Done. Tell Claude 'secrets are in' and it will deploy the code with no hardcoded credentials."
else
  echo "Some secrets did not show up - tell Claude, nothing has been deployed."
fi
