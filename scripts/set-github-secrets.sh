#!/usr/bin/env bash
# Store the refresh job's credentials as GitHub Actions secrets (REBUILD_SPEC §5).
#
# Asks for two things, typed or pasted, never shown:
#   1. the api.data.gov key the workers use (current value in API_KEYS.md)
#   2. a Cloudflare API token you create first:
#        dash.cloudflare.com -> My Profile -> API Tokens -> Create Token
#        -> "Create Custom Token"
#        Permissions:  Account | Workers KV Storage | Edit
#                      Account | D1                 | Edit
#        Account Resources: Include | <this account>
#        (nothing else: no zone, Workers-script or user permissions)
#
# Checks each value before storing it, and never writes them anywhere else.
#
#   bash scripts/set-github-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT_ID=a4bc6c41d0c4b6b1bb25dcacf9d4d55f   # not a secret; in wrangler output and the API URL
KV_NAMESPACE=8318226115e2423ab5d141adfa5419f9

gh auth status >/dev/null 2>&1 || { echo "GitHub CLI is not logged in (run: gh auth login). Nothing was changed."; exit 1; }
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

printf 'Paste the api.data.gov key (FEC_API_KEY), then press Enter (input hidden): '
read -rs FEC_KEY; echo
if ! [[ "$FEC_KEY" =~ ^[A-Za-z0-9]{40}$ ]]; then
  echo "That doesn't look like an api.data.gov key (40 letters/digits). Nothing was changed."; exit 1
fi
code=$(curl -s -o /dev/null -w '%{http_code}' "https://api.open.fec.gov/v1/committee/C00411330/?api_key=$FEC_KEY")
if [ "$code" != "200" ]; then
  echo "The FEC rejected that key (HTTP $code). Nothing was changed."; exit 1
fi

printf 'Paste the Cloudflare API token, then press Enter (input hidden): '
read -rs CF_TOKEN; echo
auth=(-H "Authorization: Bearer $CF_TOKEN")
kv=$(curl -s "${auth[@]}" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_NAMESPACE/keys?limit=1" | grep -c '"success":true' || true)
d1=$(curl -s "${auth[@]}" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database?per_page=1" | grep -c '"success":true' || true)
if [ "$kv" != "1" ] || [ "$d1" != "1" ]; then
  echo "That token can't reach KV ($kv) and/or D1 ($d1) on this account. Check its permissions. Nothing was changed."; exit 1
fi

printf '%s' "$FEC_KEY" | gh secret set FEC_API_KEY --repo "$REPO" >/dev/null
printf '%s' "$CF_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPO" >/dev/null
gh variable set CLOUDFLARE_ACCOUNT_ID --repo "$REPO" --body "$ACCOUNT_ID" >/dev/null
unset FEC_KEY CF_TOKEN

echo "Checking..."
gh secret list --repo "$REPO" | awk '{print "  secret:", $1}' | grep -E "FEC_API_KEY|CLOUDFLARE_API_TOKEN" || true
gh variable list --repo "$REPO" | awk '{print "  variable:", $1}' | grep CLOUDFLARE_ACCOUNT_ID || true
echo "Done. Tell Claude 'GitHub secrets are in'."
