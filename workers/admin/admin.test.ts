import { describe, expect, it } from 'vitest';
import { COOKIE, isAdmin, loginCookie, readCookie, rightKey, safeEqual } from './auth';
import type { Env } from './env';
import { FLAG_REASONS, issueUrl, readItem, type Row } from './feedback';
import { handleAdmin, handleFeedback } from './routes';

const env = { ADMIN_SECRET: 'a-long-test-key', MEMBER_DATA: { get: async () => null } } as Env;
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://taskforcepurple.com${path}`, init);

describe('admin login', () => {
  it('compares keys without leaking how much matched', async () => {
    expect(await safeEqual('abc', 'abc')).toBe(true);
    expect(await safeEqual('abc', 'abd')).toBe(false);
    expect(await rightKey('a-long-test-key', env)).toBe(true);
    expect(await rightKey('wrong', env)).toBe(false);
    expect(await rightKey(undefined, env)).toBe(false);
    expect(await rightKey('a-long-test-key', { ...env, ADMIN_SECRET: undefined })).toBe(false);
  });

  it('the cookie holds a hash of the key, never the key, and opens /admin', async () => {
    const cookie = await loginCookie(env);
    expect(cookie).not.toContain('a-long-test-key');
    expect(cookie).toMatch(/Path=\/admin; HttpOnly; Secure; SameSite=Strict/);
    const value = cookie.split(';')[0];
    const request = req('/admin', { headers: { Cookie: `other=1; ${value}` } });
    expect(readCookie(request, COOKIE)).toBe(value.split('=')[1]);
    expect(await isAdmin(request, env)).toBe(true);
    expect(await isAdmin(req('/admin', { headers: { Cookie: `${COOKIE}=forged` } }), env)).toBe(
      false
    );
    expect(
      await isAdmin(req('/admin', { headers: { Authorization: 'Bearer a-long-test-key' } }), env)
    ).toBe(true);
  });

  it('a right key logs in; a wrong one is refused', async () => {
    const good = await handleAdmin(
      req('/admin/login', {
        method: 'POST',
        body: new URLSearchParams({ key: 'a-long-test-key' }),
      }),
      env,
      new URL('https://taskforcepurple.com/admin/login')
    );
    expect(good.status).toBe(303);
    expect(good.headers.get('Location')).toBe('/admin');
    expect(good.headers.get('Set-Cookie')).toContain(`${COOKIE}=`);
    const bad = await handleAdmin(
      req('/admin/login', { method: 'POST', body: new URLSearchParams({ key: 'nope' }) }),
      env,
      new URL('https://taskforcepurple.com/admin/login')
    );
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain('That key isn’t right.');
  });

  it('without the cookie: the login form, and no changes', async () => {
    const page = await handleAdmin(
      req('/admin'),
      env,
      new URL('https://taskforcepurple.com/admin')
    );
    expect(await page.text()).toContain('Admin key');
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    const change = await handleAdmin(
      req('/admin/item/1/done', { method: 'POST' }),
      env,
      new URL('https://taskforcepurple.com/admin/item/1/done')
    );
    expect(change.status).toBe(401);
  });
});

describe('feedback', () => {
  it('checks what a flag says', () => {
    expect(readItem('flag', { memberId: 'A000370', reason: 'figures' })).toMatchObject({
      kind: 'flag',
      memberId: 'A000370',
      reason: 'figures',
      text: null,
    });
    expect(
      readItem('flag', { memberId: 'H6CA12345', reason: 'person', page: '/candidate/H6CA12345' })
    ).toMatchObject({
      memberId: 'H6CA12345',
      page: '/candidate/H6CA12345',
    });
    expect(readItem('flag', { memberId: 'nope', reason: 'figures' })).toMatch(/Which member/);
    expect(readItem('flag', { memberId: 'A000370', reason: 'toString' })).toBe(
      'Pick what looks wrong.'
    );
    expect(readItem('flag', { memberId: 'A000370', reason: 'other' })).toBe(
      'Tell us what looks wrong.'
    );
    expect(
      readItem('flag', { memberId: 'A000370', reason: 'other', text: 'The PAC total' })
    ).toMatchObject({
      text: 'The PAC total',
    });
  });

  it('keeps a race report as its own kind', () => {
    expect(
      readItem('suggestion', {
        text: 'Race H-TX-23 (House · Texas 23). Someone on the ballot is missing: Ben Mendoza',
        reason: 'race',
        page: '/race/2026/H-TX-23',
      })
    ).toMatchObject({ kind: 'suggestion', reason: 'race' });
  });

  it('checks a suggestion, and keeps pages to our own paths', () => {
    expect(readItem('suggestion', { text: 'hi' })).toBe('Write a few words first.');
    expect(
      readItem('suggestion', {
        text: 'Add state pages',
        reason: 'idea',
        page: 'https://evil.example',
      })
    ).toEqual({
      kind: 'suggestion',
      reason: 'idea',
      text: 'Add state pages',
      page: null,
    });
    expect(readItem('suggestion', { text: 'Something', reason: 'weird' })).toMatchObject({
      reason: 'other',
    });
  });

  it('turns an item into a filled-in GitHub issue', () => {
    const flag: Row = {
      id: 1,
      kind: 'flag',
      at: '2026-10-17T10:00:00.000Z',
      member_id: 'A000370',
      reason: 'figures',
      text: 'PAC total looks low',
      page: '/member/A000370',
      status: 'open',
    };
    const url = new URL(issueUrl(flag, 'Alma Adams'));
    expect(url.searchParams.get('title')).toBe(`Grade flag: Alma Adams: ${FLAG_REASONS.figures}`);
    expect(url.searchParams.get('body')).toContain('PAC total looks low');
    const idea = new URL(
      issueUrl({ ...flag, kind: 'suggestion', reason: 'idea', text: 'State pages\nplease' })
    );
    expect(idea.searchParams.get('title')).toBe('State pages');
    expect(idea.searchParams.get('labels')).toBe('enhancement');
  });

  const post = (kind: string, body: object) =>
    handleFeedback(
      req(`/api/feedback/${kind}`, { method: 'POST', body: JSON.stringify(body) }),
      env,
      new URL(`https://taskforcepurple.com/api/feedback/${kind}`),
      {}
    );

  it('drops a bot that filled in the hidden field, quietly', async () => {
    const response = await post('suggestion', { text: 'Buy now', website: 'spam.example' });
    expect(await response.json()).toEqual({ ok: true });
  });

  it('says what is missing before any check or write', async () => {
    const response = await post('flag', { memberId: 'A000370' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Pick what looks wrong.' });
    expect((await post('nonsense', {})).status).toBe(404);
  });
});
