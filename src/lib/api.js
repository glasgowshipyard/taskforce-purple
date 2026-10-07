// The site's data, from the API worker (workers/data-pipeline.js). Read only.

const API_BASE_URL = 'https://taskforce-purple-api.dev-a4b.workers.dev/api';

const cache = new Map();

// One request per resource per page load; a failed one is forgotten so it
// can be retried
function once(key, load) {
  if (!cache.has(key)) {
    const request = load();
    request.catch(() => cache.delete(key));
    cache.set(key, request);
  }
  return cache.get(key);
}

async function getJson(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  /** Every member with their published grade (KV members:list). */
  members: () =>
    once('members', async () => {
      const data = await getJson(`${API_BASE_URL}/members`);
      if (!data?.members?.length) {
        throw new Error('No members published');
      }
      return data;
    }),

  /** One member's money trail, donors and evidence (D1 results). */
  memberDetail: id =>
    once(`member:${id}`, () =>
      getJson(`${API_BASE_URL}/member-detail?bioguideId=${encodeURIComponent(id)}`)
    ),

  /** A candidate who isn't a sitting member: the same detail as a member's. */
  candidateDetail: id =>
    once(`candidate:${id}`, () =>
      getJson(`${API_BASE_URL}/candidate-detail?id=${encodeURIComponent(id)}`)
    ),

  /**
   * The 2026 races (ROADMAP Phase E). Null until November's field is
   * published (FEC pre-general reports). VITE_RACES_URL: a local file
   * instead, for checking the pages in development.
   */
  races: () =>
    once('races', async () => {
      const data = await getJson(import.meta.env.VITE_RACES_URL || `${API_BASE_URL}/races`);
      const live = data?.field === '12g' || (import.meta.env.DEV && data?.field === 'test');
      return live && data.races?.length ? data : null;
    }),
};

// Static files built from the Census Bureau's (scripts/geo/build-geo.mjs)
export const geoFiles = {
  zips: () => once('geo:zip', () => getJson('/geo/zip.json')),
  index: () => once('geo:index', () => getJson('/geo/index.json')),
  state: code => once(`geo:${code}`, () => getJson(`/geo/cd/${code}.json`)),
};
