// Task Force Purple Data Pipeline
// Cloudflare Worker to fetch and process congressional data

import { evaluateHealth } from './health.js';
import {
  LIST_KEY,
  MemberWriter,
  getListBody,
  getMember,
  publishedMember,
  servedMember,
} from './member-store.js';

// Endpoints of the old batch engine, retired in Stage 1 (REBUILD_SPEC §7-8):
// each one rewrote the whole member list. The refresh job (Stage 2) replaces
// them. They answer 410 so a script calling one fails visibly.
function retiredEndpoint(
  corsHeaders,
  path,
  why = 'it rewrote every member to change one. The refresh job replaces it (REBUILD_SPEC.md Stage 2).'
) {
  return new Response(JSON.stringify({ error: `${path} is retired: ${why}` }), {
    status: 410,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const STAGE3_RETIRED =
  'grades come from the refresh job since Stage 3 (REBUILD_SPEC.md). To re-grade members: gh workflow run refresh.yml -f grade_only=true -f dry_run=false [-f members=ID,ID]';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS for frontend requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      switch (url.pathname) {
        case '/api/members':
          return await handleMembers(env, corsHeaders);
        case '/api/member-detail':
          return await handleMemberDetail(env, corsHeaders, url);
        case '/api/update-data':
          return retiredEndpoint(corsHeaders, '/api/update-data');
        case '/api/update-fec-batch':
          return retiredEndpoint(corsHeaders, '/api/update-fec-batch');
        case '/api/status':
          return await handleStatus(env, corsHeaders);
        case '/api/test-member':
          return retiredEndpoint(corsHeaders, '/api/test-member');
        // Stage 3: these re-graded through the old engine and would put
        // old-basis grades back over the published ones
        case '/api/recalculate-tiers':
        case '/api/process-candidate':
          return retiredEndpoint(corsHeaders, url.pathname, STAGE3_RETIRED);
        case '/api/social-handles':
          return await handleSocialHandles(env, corsHeaders);
        case '/api/refresh-social-handles':
          return await handleRefreshSocialHandles(env, corsHeaders, request);
        case '/api/smart-batch':
          return retiredEndpoint(corsHeaders, '/api/smart-batch');
        case '/api/clear-fec-mapping':
          return await handleClearFECMapping(env, corsHeaders, request);
        case '/api/reset-pac-data':
          return retiredEndpoint(corsHeaders, '/api/reset-pac-data');
        case '/api/refresh-congress-metadata':
          return retiredEndpoint(corsHeaders, '/api/refresh-congress-metadata');
        case '/api/debug-kv':
          return retiredEndpoint(corsHeaders, '/api/debug-kv');
        case '/api/health':
          return await handleHealth(env, corsHeaders);
        default:
          // Check for individual member lookup pattern: /api/members/{bioguideId}
          if (url.pathname.startsWith('/api/members/')) {
            return await handleSingleMember(env, corsHeaders, url);
          }
          // Check for individual member update pattern: /api/update-member/@username
          if (url.pathname.startsWith('/api/update-member/@')) {
            return retiredEndpoint(corsHeaders, '/api/update-member', STAGE3_RETIRED);
          }
          // Check for remove member pattern: /api/remove-member/{bioguideId}
          if (url.pathname.startsWith('/api/remove-member/')) {
            return await handleRemoveMember(env, corsHeaders, request);
          }
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },

  // Smart batch processing - rate-limited progressive updates
  // Retired in Stage 1 (REBUILD_SPEC §8): the old batch engine rewrote the
  // whole member list on every run. Cron triggers are removed; if one is ever
  // re-added, this does nothing. The refresh job (Stage 2) replaces it.
  async scheduled() {
    console.log('Scheduled run ignored: the batch engine is retired (REBUILD_SPEC Stage 1)');
  },
};

// NEW: Calculate transparency weight for PAC contributions
// getPACTransparencyWeight, getCommitteeCategory, and calculateTier now live
// in tier-calculation.js (imported at top of file)

// Compute adaptive itemization threshold based on percentile distribution
// Returns the 70th percentile of large donor concentrations for a specific chamber
// Per-chamber calculation accounts for different fundraising patterns (Senate vs House)
function computeAdaptiveThreshold(members, chamber, percentile = 0.7) {
  // Filter members by chamber for per-chamber threshold calculation
  const chamberMembers = chamber ? members.filter(m => m.chamber === chamber) : members;

  const largeDonorPercents = chamberMembers
    .filter(
      m =>
        m.totalRaised > 0 && m.largeDonorDonations !== undefined && m.largeDonorDonations !== null
    )
    .map(m => (m.largeDonorDonations / m.totalRaised) * 100)
    .filter(v => typeof v === 'number' && !isNaN(v))
    .sort((a, b) => a - b);

  if (largeDonorPercents.length === 0) {
    return 30;
  } // fallback to fixed threshold

  const index = Math.floor(largeDonorPercents.length * percentile);
  const threshold = largeDonorPercents[Math.min(index, largeDonorPercents.length - 1)];

  // Clamp to avoid volatility while allowing adaptive range (20-60% bounds)
  // Lower bound (20%): Prevents under-penalization if sample has unusually low itemization
  // Upper bound (60%): Prevents runaway penalties from outliers or data anomalies
  // With 400+ members, empirical threshold is reliable, but clamp ensures stability
  // across election cycles as fundraising patterns shift
  return Math.min(Math.max(threshold, 20), 60);
}

// Get or refresh cached adaptive thresholds with quarterly recalculation
// Returns { houseThreshold, senateThreshold, lastCalculated } for API responses
async function getAdaptiveThresholds(env, members) {
  const cacheKey = 'adaptive_thresholds';
  const cacheMaxAge = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

  try {
    // Try to get cached thresholds
    const cachedData = await env.MEMBER_DATA.get(cacheKey);

    if (cachedData) {
      const cache = JSON.parse(cachedData);
      const cacheAge = Date.now() - new Date(cache.lastCalculated).getTime();

      // If cache is fresh (< 90 days), return it
      if (cacheAge < cacheMaxAge) {
        return cache;
      }
    }
  } catch (error) {
    console.warn('Failed to read threshold cache:', error);
  }

  // Cache is stale or missing - recalculate both chambers
  const houseThreshold = computeAdaptiveThreshold(members, 'House');
  const senateThreshold = computeAdaptiveThreshold(members, 'Senate');

  const newCache = {
    houseThreshold: Math.round(houseThreshold * 10) / 10, // Round to 1 decimal
    senateThreshold: Math.round(senateThreshold * 10) / 10,
    lastCalculated: new Date().toISOString(),
  };

  try {
    await env.MEMBER_DATA.put(cacheKey, JSON.stringify(newCache));
    console.log(
      `✅ Cached adaptive thresholds: House=${newCache.houseThreshold}%, Senate=${newCache.senateThreshold}%`
    );
  } catch (error) {
    console.warn('Failed to write threshold cache:', error);
  }

  return newCache;
}

// Calculate enhanced grassroots percentage for display

// Get grassroots-friendly PAC types summary for display

// API handlers
async function handleSingleMember(env, corsHeaders, url) {
  try {
    const bioguideId = url.pathname.split('/').pop();
    const member = await getMember(env, bioguideId);
    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(servedMember(member)), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// One member's money trail (#32): every committee they run, what each
// raised, where joint-fund money went, and the largest donors across all of
// them. Served per profile view (one KV read) rather than inside
// /api/members, which every visitor downloads - that payload is already
// ~3.5 MB and would grow by a megabyte for data only a profile needs.
async function handleMemberDetail(env, corsHeaders, url) {
  const bioguideId = url.searchParams.get('bioguideId') || '';
  if (!/^[A-Z][0-9]{6}$/.test(bioguideId)) {
    return new Response(JSON.stringify({ error: 'bioguideId required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  // Stage 3: the refresh job's latest graded result, from D1 tfp-results
  const [result, record] = await Promise.all([
    latestResult(env, bioguideId),
    getMember(env, bioguideId),
  ]);
  const body = result?.grade?.tier
    ? publishedDetail(bioguideId, record, result)
    : await legacyDetail(env, bioguideId, record);
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=900',
    },
  });
}

// The member's newest result in D1 tfp-results, JSON columns parsed; null if
// there is none or D1 can't be read (the page then shows the stored record)
async function latestResult(env, bioguideId) {
  if (!env.RESULTS_DB) {
    return null;
  }
  try {
    const row = await env.RESULTS_DB.prepare(
      'SELECT bioguide_id, cycle, computed_at, status, pool, analysis, reconciliation, grade FROM results WHERE bioguide_id = ? ORDER BY cycle DESC LIMIT 1'
    )
      .bind(bioguideId)
      .first();
    if (!row) {
      return null;
    }
    const parse = s => (s ? JSON.parse(s) : null);
    return {
      ...row,
      pool: parse(row.pool),
      analysis: parse(row.analysis),
      reconciliation: parse(row.reconciliation),
      grade: parse(row.grade),
    };
  } catch (error) {
    console.error(`member-detail: results for ${bioguideId} unreadable: ${error.message}`);
    return null;
  }
}

// The detail of a member graded by the refresh job (Stage 3)
function publishedDetail(bioguideId, record, result) {
  const a = result.analysis || {};
  const pf = result.grade.personFigures;
  const pool = result.pool || {};
  return {
    bioguideId,
    member: record ? servedMember(publishedMember(record, result)) : null,
    donorPoolCommitteeIds: pool.donorCommitteeIds || [],
    personLevel: true,
    collectedAt: result.computed_at,
    topDonors: a.topDonors || [],
    uniqueDonors: a.uniqueDonors ?? null,
    nakamotoCoefficient: a.nakamotoCoefficient ?? null,
    // true: every record checked against the FEC's; false: from the FEC's
    // bulk files, check still running. Notes: where the FEC's own figures
    // disagree with each other (REBUILD_SPEC §6, D3)
    evidence: {
      checked: result.grade.evidenceChecked ?? null,
      notes: result.reconciliation?.notes || [],
    },
    moneyTrail: pf
      ? {
          fetchedAt: result.computed_at,
          cycle: result.cycle,
          received: pf.totalRaised,
          raisedInName: pool.totals?.raisedInName ?? pf.totalRaised,
          smallDonors: pf.grassrootsDonations,
          itemized: pf.largeDonorDonations,
          pac: pf.pacMoney,
          party: pf.partyMoney,
          committees: pool.committees || [],
        }
      : null,
  };
}

// The detail from the old KV analysis, for a member the refresh job hasn't
// graded (no FEC identity, or pending)
async function legacyDetail(env, bioguideId, record) {
  const raw = await env.MEMBER_DATA.get(`itemized_analysis_v2:${bioguideId}`);
  const a = raw ? JSON.parse(raw) : null;
  const pf = a?.personFunding && !a.personFunding.failed ? a.personFunding : null;
  return {
    bioguideId,
    // The member's full served record: the profile's heavy fields (PAC
    // donations, FARA firms, conduits) live here, not in the list (Stage 1)
    member: record ? servedMember(record) : null,
    // Donor-level figures come from the committees this analysis pooled
    donorPoolCommitteeIds: a?.committeeIds || (a?.committeeId ? [a.committeeId] : []),
    personLevel: Boolean(a?.personLevel),
    collectedAt: a?.collectionCompletedAt || null,
    topDonors: a?.topDonors || [],
    uniqueDonors: a?.uniqueDonors ?? null,
    nakamotoCoefficient: a?.nakamotoCoefficient ?? null,
    evidence: null,
    moneyTrail: pf
      ? {
          fetchedAt: pf.fetchedAt,
          cycle: pf.cycle,
          received: pf.totalRaised,
          raisedInName: pf.raisedInName,
          smallDonors: pf.grassrootsDonations,
          itemized: pf.largeDonorDonations,
          pac: pf.pacMoney,
          party: pf.partyMoney,
          committees: pf.committees,
        }
      : null,
  };
}

async function handleMembers(env, corsHeaders) {
  const headers = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };
  // Stage 1 (REBUILD_SPEC §7): the response body is stored as members:list and
  // served exactly as stored - no parse, no transform, one KV read
  const stored = await env.MEMBER_DATA.get(LIST_KEY);
  if (stored) {
    return new Response(stored, { headers: { ...headers, 'X-TFP-Source': 'members:list' } });
  }

  // Before the migration: the old path, through the same transform
  try {
    const membersData = await env.MEMBER_DATA.get('members:all');
    const lastUpdated = await env.MEMBER_DATA.get('last_updated');
    if (!membersData) {
      return new Response(
        JSON.stringify({ error: 'No data available. Run data update first.', members: [] }),
        { headers }
      );
    }
    const members = JSON.parse(membersData);
    const adaptiveThresholds = await getAdaptiveThresholds(env, members);
    return new Response(
      JSON.stringify({
        members: members.map(servedMember),
        lastUpdated,
        total: members.length,
        adaptiveThresholds,
      }),
      { headers: { ...headers, 'X-TFP-Source': 'members:all' } }
    );
  } catch (error) {
    throw new Error(`Failed to retrieve members: ${error.message}`);
  }
}

// Status endpoint for monitoring Worker progress
// System health (REBUILD_SPEC §8): the site's data in KV, and the refresh
// job's record in D1 tfp-results. Read-only; checked hourly by
// .github/workflows/health-alert.yml, which opens an issue on a problem.
async function handleHealth(env, corsHeaders) {
  const body = await getListBody(env);
  const snapshot = {
    listMembers: body?.members?.length ?? null,
    listLastUpdated: body?.lastUpdated ?? null,
    lastRun: null,
    failingMembers: [],
    mismatchedCommittees: [],
    d1RowsToday: null,
    d1RowsReadToday: null,
    resultsDbError: null,
  };
  try {
    if (!env.RESULTS_DB) {
      throw new Error('the RESULTS_DB binding is missing from wrangler.toml');
    }
    const today = new Date().toISOString().slice(0, 10);
    const [run, failing, mismatched, ledger] = await env.RESULTS_DB.batch([
      env.RESULTS_DB.prepare(
        'SELECT run_id, status, started_at, finished_at FROM runs ORDER BY started_at DESC LIMIT 1'
      ),
      env.RESULTS_DB.prepare(
        "SELECT bioguide_id, attempts, last_error FROM member_progress WHERE status = 'failed' ORDER BY updated_at DESC"
      ),
      env.RESULTS_DB.prepare("SELECT committee_id, name FROM committees WHERE status = 'mismatch'"),
      env.RESULTS_DB.prepare('SELECT * FROM d1_write_budget WHERE day = ?').bind(today),
    ]);
    snapshot.lastRun = run.results[0] ?? null;
    snapshot.failingMembers = failing.results;
    snapshot.mismatchedCommittees = mismatched.results;
    snapshot.d1RowsToday = ledger.results[0]?.rows_written ?? 0;
    snapshot.d1RowsReadToday = ledger.results[0]?.rows_read ?? 0;
  } catch (error) {
    snapshot.resultsDbError = error.message;
  }
  const verdict = evaluateHealth(snapshot);
  return new Response(
    JSON.stringify({ checkedAt: new Date().toISOString(), ...verdict }, null, 2),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}

async function handleStatus(env, corsHeaders) {
  try {
    // Reads the slim list (Stage 1); before the migration, the old blob
    const body = await getListBody(env);
    let members = body?.members;
    let lastUpdated = body?.lastUpdated ?? null;
    if (!members) {
      const membersData = await env.MEMBER_DATA.get('members:all');
      lastUpdated = await env.MEMBER_DATA.get('last_updated');
      members = membersData ? JSON.parse(membersData) : null;
    }
    if (!members) {
      return new Response(
        JSON.stringify({
          status: 'no_data',
          message: 'No data available. Run data update first.',
          lastUpdated: null,
          progress: { total: 0, withFinancialData: 0, withPACDetails: 0 },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // List entries carry the served grassrootsPercent; status always reported
    // the stored FEC figure, kept on the entry as rawFECGrassrootsPercent
    const fecGrassroots = m => (body ? m.rawFECGrassrootsPercent : m.grassrootsPercent);
    const withFinancialData = members.filter(m => m.totalRaised > 0);
    const withPACDetails = members.filter(m => m.pacDetailsStatus === 'complete');
    const tierCounts = {
      S: members.filter(m => m.tier === 'S').length,
      A: members.filter(m => m.tier === 'A').length,
      B: members.filter(m => m.tier === 'B').length,
      C: members.filter(m => m.tier === 'C').length,
      D: members.filter(m => m.tier === 'D').length,
      'N/A': members.filter(m => m.tier === 'N/A').length,
    };
    const recentUpdates = withFinancialData
      .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
      .slice(0, 10)
      .map(m => ({
        name: m.name,
        tier: m.tier,
        grassrootsPercent: fecGrassroots(m),
        lastUpdated: m.lastUpdated,
      }));

    return new Response(
      JSON.stringify({
        status: 'active',
        lastUpdated,
        progress: {
          total: members.length,
          withFinancialData: withFinancialData.length,
          withPACDetails: withPACDetails.length,
          pendingPACDetails: withFinancialData.length - withPACDetails.length,
        },
        tierCounts,
        recentUpdates,
        twoCallStrategy: {
          phase1Complete: withFinancialData.length > 0,
          phase2Progress: `${withPACDetails.length}/${withFinancialData.length} complete`,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    throw new Error(`Failed to get status: ${error.message}`);
  }
}

// Function to get or create social handle mapping from congress-legislators repo
async function getOrCreateSocialHandleMapping(env) {
  try {
    // Check if we have cached mapping
    const cachedMapping = await env.MEMBER_DATA.get('social_handle_mapping');

    if (cachedMapping) {
      const mapping = JSON.parse(cachedMapping);
      const cacheAge = Date.now() - new Date(mapping.lastUpdated).getTime();

      // Use cached data if less than 24 hours old
      if (cacheAge < 24 * 60 * 60 * 1000) {
        console.log('📱 Using cached social handle mapping');
        return mapping.handles;
      }
    }

    console.log('📱 Fetching fresh social media data from congress-legislators...');

    // Fetch social media YAML
    const response = await fetch(
      'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-social-media.yaml'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch social media data: ${response.status}`);
    }

    const yamlText = await response.text();

    // Parse YAML manually (simple parsing for our specific use case)
    const socialData = parseCongressSocialYAML(yamlText);

    // Create handle mapping according to priority strategy
    const handleMapping = {};
    let mappedCount = 0;

    for (const entry of socialData) {
      if (entry.id?.bioguide && entry.social) {
        const bioguide = entry.id.bioguide;
        const social = entry.social;

        // Priority: Twitter > Instagram > Generated from name
        let selectedHandle = null;

        if (social.twitter) {
          selectedHandle = social.twitter.toLowerCase();
        } else if (social.instagram) {
          selectedHandle = social.instagram.toLowerCase();
        }

        if (selectedHandle) {
          handleMapping[selectedHandle] = bioguide;
          mappedCount++;
        }
      }
    }

    console.log(`✅ Created social handle mapping: ${mappedCount} handles mapped`);

    // Add user-friendly aliases for popular handles
    const aliases = {
      aoc: 'O000172', // Alexandria Ocasio-Cortez -> @repaoc
      bernie: 'S000033', // Bernie Sanders
      warren: 'W000817', // Elizabeth Warren
      ted: 'C001098', // Ted Cruz
      marco: 'R000595', // Marco Rubio
    };

    let aliasCount = 0;
    for (const [alias, bioguide] of Object.entries(aliases)) {
      if (!handleMapping[alias]) {
        // Don't overwrite existing handles
        handleMapping[alias] = bioguide;
        aliasCount++;
      }
    }

    if (aliasCount > 0) {
      console.log(`✅ Added ${aliasCount} user-friendly aliases`);
    }

    // Cache the mapping
    const mappingData = {
      handles: handleMapping,
      lastUpdated: new Date().toISOString(),
      totalMapped: mappedCount,
    };

    await env.MEMBER_DATA.put('social_handle_mapping', JSON.stringify(mappingData));

    return handleMapping;
  } catch (error) {
    console.error('Error creating social handle mapping:', error);

    // Fallback to cached data if available
    const cachedMapping = await env.MEMBER_DATA.get('social_handle_mapping');
    if (cachedMapping) {
      console.log('⚠️ Using stale cached mapping due to error');
      return JSON.parse(cachedMapping).handles;
    }

    throw error;
  }
}

// Handle social handles endpoint - return available handles for individual member updates
async function handleSocialHandles(env, corsHeaders) {
  try {
    // Get the social handle mapping (same as used by individual member updates)
    const handleMap = await getOrCreateSocialHandleMapping(env);

    const handleCount = Object.keys(handleMap).length;

    return new Response(
      JSON.stringify({
        handles: handleMap,
        count: handleCount,
        description:
          'Available social handles for individual member updates via /api/update-member/@handle',
        examples: [
          '/api/update-member/@aoc',
          '/api/update-member/@repjasmine',
          '/api/update-member/@senatorhassan',
        ],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error fetching social handles:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch social handles',
        message: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

// Force refresh social handle mapping (requires authorization)
async function handleRefreshSocialHandles(env, corsHeaders, request) {
  try {
    // Check authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !env.UPDATE_SECRET || authHeader !== `Bearer ${env.UPDATE_SECRET}`) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('🔄 Force refreshing social handle mapping...');

    // Delete existing cache to force refresh
    await env.MEMBER_DATA.delete('social_handle_mapping');

    // Get fresh mapping (this will rebuild with aliases)
    const handles = await getOrCreateSocialHandleMapping(env);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Social handle mapping refreshed',
        count: Object.keys(handles).length,
        aliases: {
          aoc: handles.aoc || null,
          bernie: handles.bernie || null,
          warren: handles.warren || null,
          ted: handles.ted || null,
          marco: handles.marco || null,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error refreshing social handles:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to refresh social handles',
        message: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

// Simple YAML parser for congress social media data
function parseCongressSocialYAML(yamlText) {
  const entries = [];
  const lines = yamlText.split('\n');

  let currentEntry = null;
  let indentLevel = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    const currentIndent = line.length - line.trimLeft().length;

    // New entry starts
    if (trimmed === '- id:') {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = { id: {}, social: {} };
      indentLevel = currentIndent;
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    // Parse ID fields
    if (currentIndent === indentLevel + 4 && trimmed.includes(':')) {
      const [key, value] = trimmed.split(':', 2);
      const cleanKey = key.trim();
      const cleanValue = value ? value.trim().replace(/['"]/g, '') : '';

      if (['bioguide', 'thomas', 'govtrack'].includes(cleanKey)) {
        currentEntry.id[cleanKey] = cleanValue;
      }
    }

    // Parse social fields
    if (trimmed === 'social:') {
      // Continue to next line for social fields
      continue;
    }

    if (
      currentIndent === indentLevel + 4 &&
      trimmed.includes(':') &&
      !['bioguide', 'thomas', 'govtrack'].includes(trimmed.split(':')[0].trim())
    ) {
      const [key, value] = trimmed.split(':', 2);
      const cleanKey = key.trim();
      const cleanValue = value ? value.trim().replace(/['"]/g, '') : '';

      if (['twitter', 'instagram', 'facebook', 'youtube'].includes(cleanKey)) {
        currentEntry.social[cleanKey] = cleanValue;
      }
    }
  }

  // Add the last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

// =============================================================================
// SMART BATCH PROCESSING SYSTEM - Rate-Limited Progressive Updates
// =============================================================================

// =============================================================================
// FEC MISMATCH DETECTION AND RECONCILIATION SYSTEM
// =============================================================================

// Handle clearing bad FEC candidate mappings
async function handleClearFECMapping(env, corsHeaders, request) {
  try {
    // Check for authorization
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = env.UPDATE_SECRET ? `Bearer ${env.UPDATE_SECRET}` : null;

    if (!authHeader || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const bioguideId = url.searchParams.get('bioguideId');

    if (!bioguideId) {
      return new Response(
        JSON.stringify({
          error: 'bioguideId parameter required',
          example: '/api/clear-fec-mapping?bioguideId=G000359',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Clear the cached FEC mapping
    const cacheKey = `fec_mapping_${bioguideId}`;
    await env.MEMBER_DATA.delete(cacheKey);

    console.log(`🗑️ Cleared FEC mapping for ${bioguideId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Cleared FEC mapping for ${bioguideId}`,
        bioguideId: bioguideId,
        action: 'Next lookup will search FEC API fresh and cache new result',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error clearing FEC mapping:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to clear FEC mapping',
        message: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

// Handle removing a member from KV storage
async function handleRemoveMember(env, corsHeaders, request) {
  try {
    // Check for authentication
    const url = new URL(request.url);
    const authKey =
      url.searchParams.get('key') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = env.UPDATE_SECRET;

    if (!expectedKey) {
      throw new Error('UPDATE_SECRET not configured');
    }

    if (!authKey || authKey !== expectedKey) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized - valid API key required',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract bioguideId from URL path
    const bioguideId = url.pathname.replace('/api/remove-member/', '');

    if (!bioguideId) {
      return new Response(
        JSON.stringify({
          error: 'bioguideId required - use format /api/remove-member/{bioguideId}',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`🗑️ Member removal requested for bioguideId: ${bioguideId}`);

    const removedMember = await getMember(env, bioguideId);
    if (!removedMember) {
      return new Response(
        JSON.stringify({ error: `Member with bioguideId ${bioguideId} not found`, bioguideId }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const writer = new MemberWriter(env);
    await writer.remove(bioguideId);
    await writer.flush();
    // Issue #14: removal also clears the member's cached FEC candidate match,
    // so a later re-add can't inherit a wrong one
    await env.MEMBER_DATA.delete(`fec_mapping_${bioguideId}`);
    console.log(`✅ Removed ${removedMember.name} (${bioguideId}) and its FEC mapping`);

    const remaining = (await getListBody(env))?.members.length ?? null;
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully removed member from storage`,
        removedMember: {
          bioguideId: removedMember.bioguideId,
          name: removedMember.name,
          state: removedMember.state,
          party: removedMember.party,
        },
        remainingMembers: remaining,
        lastUpdated: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Member removal failed:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        success: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
