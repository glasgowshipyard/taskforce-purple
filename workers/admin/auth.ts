// Who may open /admin (lifted from Let's Find Out, owner 2026-10-16): the
// admin key, a wrangler secret, typed once at /admin/login. That sets a cookie
// holding a hash of the key, never the key itself. The key also works as a
// Bearer header, for scripts.

import type { Env } from './env';

export const COOKIE = 'tfp_admin';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Compares two strings in the same time whatever they hold: both are hashed to
 * the same length and every byte is compared, so timing can't reveal how much
 * matched.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) {
    difference |= x[i] ^ y[i];
  }
  return difference === 0;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

// What the cookie holds: a hash of the key, so a leaked cookie isn't the key
const sessionValue = (secret: string) => sha256Hex(`tfp-admin-session|${secret}`);

/** The admin key as a Bearer header, or the cookie set by logging in */
export async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_SECRET) {
    return false;
  }
  const bearer = request.headers.get('Authorization');
  if (bearer !== null && (await safeEqual(bearer, `Bearer ${env.ADMIN_SECRET}`))) {
    return true;
  }
  const cookie = readCookie(request, COOKIE);
  return cookie !== null && safeEqual(cookie, await sessionValue(env.ADMIN_SECRET));
}

/** True when `key` is the admin key */
export async function rightKey(key: unknown, env: Env): Promise<boolean> {
  return Boolean(env.ADMIN_SECRET) && typeof key === 'string' && safeEqual(key, env.ADMIN_SECRET!);
}

/**
 * The cookie for a logged-in admin: only sent back to /admin pages, never
 * readable by scripts, and never on a request from another site.
 */
export async function loginCookie(env: Env): Promise<string> {
  return `${COOKIE}=${await sessionValue(env.ADMIN_SECRET!)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
}

export const logoutCookie = `${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
