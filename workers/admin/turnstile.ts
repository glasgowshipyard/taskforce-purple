// The bot check on the feedback forms: Cloudflare Turnstile, which is free
// (lifted from Let's Find Out). The widget on the page puts a token in the
// form, and a flag or suggestion is only saved once Cloudflare confirms it,
// for one of our own pages.

import type { Env } from './env';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
// The pages the widget may be on (Turnstile reports which one passed)
const HOSTS = new Set(['taskforcepurple.com', 'www.taskforcepurple.com']);

function looksLikeToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH;
}

/** True only when Cloudflare confirms the token; anything else is a failed check */
export async function verifyHuman(token: unknown, request: Request, env: Env): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    throw new Error('TURNSTILE_SECRET is not set; refusing feedback without the bot check');
  }
  if (!looksLikeToken(token)) {
    return false;
  }
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET);
  form.set('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) {
    form.set('remoteip', ip);
  }
  try {
    const response = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const data = (await response.json()) as { success?: unknown; hostname?: unknown };
    if (data.success === true && typeof data.hostname === 'string' && HOSTS.has(data.hostname)) {
      return true;
    }
    console.warn('Bot check failed:', JSON.stringify(data));
  } catch (error) {
    console.warn('Bot check unreachable:', (error as Error).message);
  }
  return false;
}
