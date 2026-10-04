#!/usr/bin/env bash
# Rotate Task Force Purple's credentials into Cloudflare Worker secrets.
#
# Asks for ONE thing: the new api.data.gov key (typed/pasted, not shown).
# Everything else is automatic:
#   - generates a new random UPDATE_SECRET (the token that guards the API's
#     admin endpoints; the old one is public in the repo's history)
#   - sets FEC_API_KEY, CONGRESS_API_KEY and UPDATE_SECRET on the API
#     (pipeline) worker. The itemized worker is retired (2026-10-04) and holds
#     no secrets
#   - sets FEC_API_KEY in GitHub Actions for the refresh job
#     (REBUILD_SPEC §5), if the GitHub CLI is logged in
#   - rewrites your local, gitignored API_KEYS.md to hold only the new values
#   - checks the worker now lists the secrets
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

put() { # secret-name value
  printf '%s' "$2" | npx wrangler secret put "$1" >/dev/null
  echo "  set $1 on the API worker"
}

echo "Setting secrets..."
put FEC_API_KEY "$NEW_KEY"
put CONGRESS_API_KEY "$NEW_KEY"
put UPDATE_SECRET "$NEW_UPDATE_SECRET"
if gh auth status >/dev/null 2>&1; then
  # The refresh job (REBUILD_SPEC §5) uses the same key from GitHub Actions
  printf '%s' "$NEW_KEY" | gh secret set FEC_API_KEY >/dev/null && echo "  set FEC_API_KEY in GitHub Actions"
else
  echo "  GitHub CLI not logged in: GitHub's FEC_API_KEY NOT updated (run scripts/set-github-secrets.sh)"
fi

# Rewrite the whole file: it holds ONLY current values, so there is never an
# old key sitting above the new one under an official-looking label
cat > API_KEYS.md <<EOF
# Task Force Purple: current credentials

**Gitignored. Never commit, paste into chat, or put in code.** Every value
here is CURRENT (last rotated $(date -u +%Y-%m-%d)). Retired values are deliberately
not kept here.

## api.data.gov key (one key, used for both the FEC and Congress.gov)

\`$NEW_KEY\`

Set as:
- Cloudflare Worker secrets \`FEC_API_KEY\` and \`CONGRESS_API_KEY\` (API
  worker, taskforce-purple-api);
- GitHub Actions secret \`FEC_API_KEY\` (refresh job, REBUILD_SPEC §5).

## UPDATE_SECRET (admin endpoints; \`\$UPDATE_SECRET\` in RUNBOOK)

\`$NEW_UPDATE_SECRET\`

Set as Cloudflare Worker secret \`UPDATE_SECRET\` on the API worker.

## Cloudflare API token for the refresh job

Not stored here. It lives only as the GitHub Actions secret
\`CLOUDFLARE_API_TOKEN\` (\`taskforce-purple-github-actions-kv-d1\`, KV and D1
read/write on this account). To replace it, create a new one in the
Cloudflare dashboard and run \`bash scripts/set-github-secrets.sh\`.

## Rotating

\`bash scripts/rotate-secrets.sh\` rewrites this file with the new values.
EOF
echo "Rewrote API_KEYS.md (gitignored) with only the new values."

echo "Checking the worker..."
p=$(npx wrangler secret list 2>/dev/null)
ok=1
for n in FEC_API_KEY CONGRESS_API_KEY UPDATE_SECRET; do
  if grep -q "\"$n\"" <<<"$p"; then echo "  $n present"; else echo "  $n MISSING"; ok=0; fi
done

unset NEW_KEY NEW_UPDATE_SECRET
if [ "$ok" = 1 ]; then
  echo "Done. Tell Claude 'secrets are in' and it will deploy the code with no hardcoded credentials."
else
  echo "Some secrets did not show up - tell Claude, nothing has been deployed."
fi
