// Sending a flag or a suggestion to the API worker (workers/admin/routes.ts),
// with the Turnstile bot check's token. Listed on /admin only.

import { API_BASE_URL } from './api.js';

// Turnstile's public site key for taskforcepurple.com. In development,
// Cloudflare's test key, which always passes (the live server then refuses
// the token, so nothing from development is ever saved)
export const TURNSTILE_SITE_KEY = import.meta.env.DEV
  ? '1x00000000000000000000AA'
  : '0x4AAAAAAFZA0Ghudg4AM8T2';

export const FLAG_REASONS = [
  { value: 'figures', label: 'The figures look wrong' },
  { value: 'person', label: 'Wrong person' },
  { value: 'outdated', label: 'Out of date' },
  { value: 'other', label: 'Something else' },
];

export const SUGGESTION_KINDS = [
  { value: 'idea', label: 'Idea' },
  { value: 'bug', label: 'Bug' },
  { value: 'other', label: 'Something else' },
];

/** Resolves on success; throws an Error with words for the visitor otherwise */
export async function sendFeedback(kind, body) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/feedback/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("That didn't send. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Something went wrong sending that. Try again.');
  }
}
