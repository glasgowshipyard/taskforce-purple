// The itemized worker, retired at Stage 2's cut-over (REBUILD_SPEC §3).
// Donor collection moved to the refresh job in GitHub Actions
// (scripts/refresh/), and health to the API worker's /api/health. This stub
// keeps the old URLs answering, so anything still calling one fails visibly
// instead of silently. The old code is in git history (last: 04d44c4).
const API = 'https://taskforce-purple-api.dev-a4b.workers.dev';

export default {
  async fetch() {
    return new Response(
      JSON.stringify({
        error:
          'This worker is retired. Donor collection runs in GitHub Actions (the Refresh workflow); health is at the API worker.',
        health: `${API}/api/health`,
      }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    );
  },
};
