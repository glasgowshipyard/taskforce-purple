// taskforcepurple.com/admin: the admin panel lives in the API worker
// (workers/admin); this hands every /admin request to it and its answer back,
// so the login cookie belongs to the site's own address.
const API = 'https://taskforce-purple-api.dev-a4b.workers.dev';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  return fetch(new Request(`${API}${url.pathname}${url.search}`, request), { redirect: 'manual' });
}
