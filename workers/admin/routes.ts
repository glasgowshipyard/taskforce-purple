// The API worker's /admin pages and the public feedback endpoints.
//
//   GET  /admin                       the panel (or the login form)
//   POST /admin/login, /admin/logout
//   POST /admin/item/{id}/{status}    mark a flag or suggestion done, binned or open
//   POST /api/feedback/flag           "Something wrong with this grade?"
//   POST /api/feedback/suggestion     "Suggest something"
//
// /admin is served on taskforcepurple.com through a Pages Function
// (functions/admin), so its cookie belongs to the site's own address.

import { evaluateHealth, loadHealth } from '../health.js';
import { getListBody } from '../member-store.js';
import { isAdmin, loginCookie, logoutCookie, rightKey } from './auth';
import type { Env } from './env';
import {
  STATUSES,
  handledItems,
  openItems,
  readItem,
  saveItem,
  setStatus,
  whoFor,
  type Status,
} from './feedback';
import { dashboardPage, loginPage, type Dashboard, type GradeChange } from './page';
import { verifyHuman } from './turnstile';

const ADMIN_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...ADMIN_HEADERS, ...extra } });

// After a form post, back to the panel (303: the browser follows with a GET)
const backTo = (where: string, extra: Record<string, string> = {}) =>
  new Response(null, {
    status: 303,
    headers: { Location: where, 'Cache-Control': 'no-store', ...extra },
  });

async function dashboard(env: Env): Promise<Dashboard> {
  const [snapshot, list, open, handled, changes] = await Promise.all([
    loadHealth(env),
    getListBody(env),
    openItems(env).catch(() => []),
    handledItems(env).catch(() => []),
    // The last 15 changes, by row ID (the primary key): no table scan
    env.RESULTS_DB?.prepare(
      'SELECT bioguide_id, changed_at, old_tier, new_tier FROM grade_history WHERE id > (SELECT max(id) FROM grade_history) - 15 ORDER BY id DESC'
    )
      .all<GradeChange>()
      .then(r => r.results)
      .catch(() => []) ?? [],
  ]);
  return {
    health: evaluateHealth(snapshot),
    open,
    handled,
    members: list?.members ?? [],
    listLastUpdated: snapshot.listLastUpdated,
    lastRun: snapshot.lastRun,
    d1RowsToday: snapshot.d1RowsToday,
    d1RowsReadToday: snapshot.d1RowsReadToday,
    d1SizeBytes: snapshot.d1SizeBytes,
    changes,
  };
}

export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/admin';
  if (!env.ADMIN_SECRET) {
    return html(
      '<p>The admin key isn’t set on the API worker (wrangler secret put ADMIN_SECRET).</p>',
      503
    );
  }
  if (request.method === 'POST' && path === '/admin/login') {
    const form = await request.formData().catch(() => null);
    if (await rightKey(form?.get('key'), env)) {
      return backTo('/admin', { 'Set-Cookie': await loginCookie(env) });
    }
    return html(loginPage('That key isn’t right.'), 401);
  }
  if (request.method === 'POST' && path === '/admin/logout') {
    return backTo('/admin', { 'Set-Cookie': logoutCookie });
  }
  if (!(await isAdmin(request, env))) {
    return request.method === 'GET' && path === '/admin'
      ? html(loginPage())
      : html(loginPage('Log in first.'), 401);
  }
  if (request.method === 'GET' && path === '/admin') {
    return html(dashboardPage(await dashboard(env)));
  }
  const item = /^\/admin\/item\/([1-9][0-9]*)\/(open|done|binned)$/.exec(path);
  if (request.method === 'POST' && item && STATUSES.includes(item[2] as Status)) {
    await setStatus(env, Number(item[1]), item[2] as Status);
    return backTo('/admin');
  }
  return html('<p>Not found.</p>', 404);
}

export async function handleFeedback(
  request: Request,
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  const kind = url.pathname.slice('/api/feedback/'.length);
  if (request.method !== 'POST' || (kind !== 'flag' && kind !== 'suggestion')) {
    return json({ error: 'Not found.' }, 404);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return json({ error: 'Something went wrong sending that. Try again.' }, 400);
  }
  // A field people never see: a form that comes back with it filled in is a
  // bot's, dropped quietly so it learns nothing
  if (typeof body.website === 'string' && body.website !== '') {
    return json({ ok: true });
  }
  const item = readItem(kind, body);
  if (typeof item === 'string') {
    return json({ error: item }, 400);
  }
  if (!(await verifyHuman(body.token, request, env))) {
    return json({ error: 'We couldn’t confirm you’re a person. Try again.' }, 403);
  }
  const at = new Date().toISOString();
  const saved = await saveItem(env, item, await whoFor(request, env, at.slice(0, 10)), at);
  if (!saved) {
    return json({ error: 'That’s as many as we can take today. Try again tomorrow.' }, 429);
  }
  return json({ ok: true });
}
