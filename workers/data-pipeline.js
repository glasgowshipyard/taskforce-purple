// Task Force Purple Data Pipeline
// Cloudflare Worker to fetch and process congressional data

import { STATE_ABBREVIATIONS } from './shared-constants.js';
import { crosswalkIdsFor, isVerifiedIdentity, selectPrimaryCandidate } from './fec-identity.js';
import {
  cycleForYear,
  getCommitteeCategory,
  getPACTransparencyWeight,
} from './tier-calculation.js';
import { gradeMember } from './grading.js';
import { LIST_KEY, MemberWriter, getListBody, getMember, servedMember } from './member-store.js';

// Endpoints of the old batch engine, retired in Stage 1 (REBUILD_SPEC §7-8):
// each one rewrote the whole member list. The refresh job (Stage 2) replaces
// them. They answer 410 so a script calling one fails visibly.
function retiredEndpoint(corsHeaders, path) {
  return new Response(
    JSON.stringify({
      error: `${path} is retired: it rewrote every member to change one. The refresh job replaces it (REBUILD_SPEC.md Stage 2).`,
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Admin endpoints accept the UPDATE_SECRET as a Bearer header (or ?key=, as
// they always have). Returns a 401 response, or null when authorised.
function requireAdmin(request, env, corsHeaders) {
  const url = new URL(request.url);
  const supplied =
    request.headers.get('Authorization')?.replace('Bearer ', '') || url.searchParams.get('key');
  if (env.UPDATE_SECRET && supplied === env.UPDATE_SECRET) {
    return null;
  }
  return new Response(JSON.stringify({ error: 'Unauthorized - valid API key required' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * One member's re-grade: exactly what the old every-run recalculation did for
 * each member, as a function of that member alone. Returns a new record; the
 * input is not modified. Members without financial data come back unchanged.
 */
async function regradeMember(input, env) {
  const member = structuredClone(input);
  if (!member.totalRaised || member.totalRaised === 0) {
    return member;
  }
  const oldTier = member.tier;
  const {
    tier: newTier,
    individualFundingPercent,
    concentration,
    concentrationRejected,
    gradeBasis,
    personFigures,
  } = await calculateEnhancedTier(member, [], env);
  member.gradeBasis = gradeBasis;
  // The figures the grade was computed on, when that is all committees
  member.personFigures = personFigures;
  member.individualFundingPercent = individualFundingPercent;

  if (concentrationRejected) {
    // Merged from another committee's records (issue #41): wipe deliberately
    member.nakamotoCoefficient = null;
    member.uniqueDonors = null;
    member.top10Concentration = null;
    member.nakamotoPercent = null;
    member.topConduits = null;
    member.earmarkedIndividualTotal = null;
    member.faraFirms = null;
    member.faraEmployerTotal = null;
  }
  if (concentration) {
    member.nakamotoCoefficient = concentration.nakamotoCoefficient ?? null;
    member.uniqueDonors = concentration.uniqueDonors ?? null;
    member.top10Concentration = concentration.top10Concentration ?? null;
    member.nakamotoPercent =
      concentration.uniqueDonors > 0
        ? parseFloat(
            ((concentration.nakamotoCoefficient / concentration.uniqueDonors) * 100).toFixed(1)
          )
        : null;
    // Network attribution (#33), present only on analyses after 2026-07-12
    if (concentration.conduits !== undefined) {
      member.topConduits = concentration.conduits;
      member.earmarkedIndividualTotal = concentration.earmarkedTotal ?? null;
    }
    // FARA cross-reference (#34), analyses after 2026-07-17
    if (concentration.faraFirms !== undefined) {
      member.faraFirms = concentration.faraFirms;
      member.faraEmployerTotal = concentration.faraEmployerTotal ?? null;
    }
  }

  const newGrassrootsPercent =
    member.grassrootsDonations !== undefined && member.totalRaised > 0
      ? Math.round((member.grassrootsDonations / member.totalRaised) * 100)
      : member.grassrootsPercent || 0;
  const staleCycle = member.dataCycle === 1970 || !member.dataCycle;

  if (oldTier !== newTier || member.grassrootsPercent !== newGrassrootsPercent) {
    return {
      ...member,
      tier: newTier,
      grassrootsPercent: newGrassrootsPercent,
      // Issue #15: never leave a stale 1970 cycle
      dataCycle: staleCycle ? await getElectionCycle() : member.dataCycle,
      lastTierRecalculated: new Date().toISOString(),
    };
  }
  if (staleCycle) {
    return {
      ...member,
      dataCycle: await getElectionCycle(),
      lastTierRecalculated: new Date().toISOString(),
    };
  }
  return member;
}

/**
 * Re-grade a slice of members, in list order. One call handles `limit`
 * members (default 10): reading every member and analysis in one call would
 * exceed the 1,000-calls-per-invocation limit and the 10 ms CPU limit.
 * Only members whose record actually changes are written.
 */
async function recalculateTierChunk(env, offset, limit) {
  const body = await getListBody(env);
  if (!body) {
    throw new Error('members:list does not exist yet: run the Stage 1 migration first');
  }
  const ids = body.members.map(e => e.bioguideId);
  const slice = ids.slice(offset, offset + limit);
  const writer = new MemberWriter(env);
  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  for (const id of slice) {
    try {
      const before = await getMember(env, id);
      if (!before) {
        errors++;
        continue;
      }
      const after = await regradeMember(before, env);
      if (await writer.save(before, after)) {
        changed++;
      } else {
        unchanged++;
      }
    } catch (error) {
      console.error(`Re-grade failed for ${id}:`, error);
      errors++;
    }
  }
  await writer.flush();
  const next = offset + slice.length;
  return {
    totalMembers: ids.length,
    offset,
    processed: slice.length,
    changed,
    unchanged,
    errors,
    listWritten: writer.stats.listWrites > 0,
    nextOffset: next < ids.length ? next : null,
  };
}

/** Resolve a member from ?bioguideId= or ?name= (name matched on the list). */
async function findMemberId(env, { bioguideId, name }) {
  if (bioguideId) {
    return bioguideId;
  }
  const body = await getListBody(env);
  const list = body ? body.members : JSON.parse((await env.MEMBER_DATA.get('members:all')) || '[]');
  const q = name.toLowerCase();
  const hit = list.find(
    m =>
      m.name.toLowerCase() === q ||
      m.name.toLowerCase().includes(q) ||
      q.includes(m.name.toLowerCase().split(',')[0])
  );
  return hit ? hit.bioguideId : null;
}

// Credentials come ONLY from Cloudflare Worker secrets (wrangler secret put).
// There are no hardcoded fallbacks: the repo is public, and a fallback both
// leaks the key and hides a missing secret. A missing secret fails loudly.
function requireSecret(env, name) {
  const value = env?.[name];
  if (!value) {
    throw new Error(`Worker secret ${name} is not set (wrangler secret put ${name})`);
  }
  return value;
}

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
        case '/api/recalculate-tiers':
          return await handleRecalculateTiers(env, corsHeaders, request);
        case '/api/process-candidate':
          return await handleProcessCandidate(env, corsHeaders, request);
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
        case '/api/debug-kv': {
          const queueData = await env.MEMBER_DATA.get('priority_missing_queue');
          const allKeys = await env.MEMBER_DATA.list();
          return new Response(
            JSON.stringify({
              queueExists: !!queueData,
              queueLength: queueData ? JSON.parse(queueData).length : 0,
              allKeysCount: allKeys.keys.length,
              priorityKeys: allKeys.keys.filter(k => k.name.includes('priority')),
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        default:
          // Check for individual member lookup pattern: /api/members/{bioguideId}
          if (url.pathname.startsWith('/api/members/')) {
            return await handleSingleMember(env, corsHeaders, url);
          }
          // Check for individual member update pattern: /api/update-member/@username
          if (url.pathname.startsWith('/api/update-member/@')) {
            return await handleIndividualMemberUpdate(env, corsHeaders, request);
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

// Get current year. Historical note: this used to query 4 external NTP/time
// APIs under the belief that Workers' Date is broken. It isn't - Date is
// frozen only within synchronous execution and advances after I/O, which is
// more than accurate enough to determine the YEAR. The external calls burned
// up to 8 subrequests + 8s of 2s-timeouts per member lookup, and when all
// four flaked (regularly), the entire financial lookup threw and the member
// was deferred - a major source of intermittent Phase 1 failures.
async function getCurrentYear() {
  return new Date().getFullYear();
}

// Calculate election cycle from current year.
// FEC cycles are named by the even END year (2025 belongs to cycle 2026).
async function getElectionCycle() {
  const currentYear = await getCurrentYear();
  return cycleForYear(currentYear);
}

// Fetch financial data from OpenFEC API using correct endpoints
async function fetchMemberFinancials(member, env) {
  const apiKey = requireSecret(env, 'FEC_API_KEY');

  try {
    console.log(`🔍 Looking up financial data for: ${member.name} (${member.state})`);

    // FEC API Rate Limiting: 3.6+ second delay to stay under 16.67 calls/minute
    await new Promise(resolve => setTimeout(resolve, 3600));

    // Convert state name to abbreviation for FEC API
    const stateAbbr = STATE_ABBREVIATIONS[member.state] || member.state;

    // Determine chamber/office early (needed throughout)
    // Queue members have 'district' (House) or not (Senate), full members have chamber/terms
    const chamberType = (() => {
      // If member already has chamber field, use it
      if (member.chamber) {
        return member.chamber;
      }
      // Otherwise get most recent term from Congress.gov data
      const terms = member.terms?.item;
      if (!terms || terms.length === 0) {
        return null;
      }
      return terms[terms.length - 1].chamber;
    })();
    const office =
      chamberType === 'House of Representatives' || chamberType === 'House'
        ? 'H'
        : member.district
          ? 'H' // If member has district, they're House
          : 'S'; // Otherwise Senate

    // FEC identity comes from the congress-legislators crosswalk, never a
    // name search (issue #41). A cached mapping is trusted only if its
    // candidate ID is one of this member's recorded IDs - the 2026-09-26 audit
    // found 35 cached mappings pointing at other people, cached "forever" by
    // earlier name-matching code. Those are discarded and re-resolved here.
    const cacheKey = `fec_mapping_${member.bioguideId}`;
    const cachedMapping = await env.MEMBER_DATA.get(cacheKey);
    const crosswalkIds = crosswalkIdsFor(member.bioguideId);

    let candidate = null;

    if (cachedMapping) {
      const mapping = JSON.parse(cachedMapping);
      if (isVerifiedIdentity(member.bioguideId, mapping.candidate_id)) {
        candidate = {
          candidate_id: mapping.candidate_id,
          name: mapping.candidate_name,
          principal_committees: mapping.principal_committees,
        };
      } else {
        console.warn(
          `🚫 Discarding cached FEC mapping for ${member.name}: ${mapping.candidate_id} (${mapping.candidate_name}) is not one of their recorded FEC IDs [${crosswalkIds.join(', ')}]`
        );
      }
    }

    if (!candidate) {
      if (crosswalkIds.length === 0) {
        // Non-filers (e.g. some delegates). Never guess.
        console.warn(`No recorded FEC identity for ${member.name}; not guessing`);
        return null;
      }

      // One call returns every candidate record the member holds, each with
      // its office, active years and principal committees
      const params = new URLSearchParams({ api_key: apiKey });
      crosswalkIds.forEach(id => params.append('candidate_id', id));
      const searchResponse = await fetch(
        `https://api.open.fec.gov/v1/candidates/search/?${params}`,
        {
          headers: {
            'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
          },
        }
      );

      if (!searchResponse.ok) {
        console.warn(`FEC candidate lookup error for ${member.name}: ${searchResponse.status}`);
        try {
          await searchResponse.json();
        } catch {}
        // Surface rate limits to the queue's retry logic
        if (searchResponse.status === 429) {
          throw new Error('429 Too Many Requests');
        }
        return null;
      }

      const searchData = await searchResponse.json();
      // Belt and braces: keep only records whose ID is on the member's list
      const records = (searchData.results || []).filter(c => crosswalkIds.includes(c.candidate_id));
      candidate = selectPrimaryCandidate(records, office);

      if (!candidate) {
        console.warn(
          `❌ FEC returned no records for ${member.name}'s recorded IDs [${crosswalkIds.join(', ')}]`
        );
        return null;
      }

      console.log(
        `✅ FEC identity for ${member.name}: ${candidate.name} (${candidate.candidate_id}) via crosswalk`
      );

      const mappingToCache = {
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.name,
        principal_committees: candidate.principal_committees,
        // Every campaign the person has run, for person-level aggregation
        candidates: records.map(c => ({
          candidate_id: c.candidate_id,
          candidate_name: c.name,
          office: c.office,
          active_through: c.active_through,
          principal_committees: c.principal_committees,
        })),
        verified_date: new Date().toISOString(),
        verification_method: 'crosswalk',
        member_state: stateAbbr,
        member_office: office,
      };

      await env.MEMBER_DATA.put(cacheKey, JSON.stringify(mappingToCache));
      console.log(`💾 Cached FEC mapping for ${member.name}: ${candidate.candidate_id}`);
    }

    // Track if we successfully retrieved financial data
    let hasFinancialData = false;

    // Use proper committee selection with cycle and designation filtering
    if (candidate.principal_committees && candidate.principal_committees.length > 0) {
      // Use the principal_committees we already have (no redundant API call)
      // Chamber-aware cycle priority: House tries [2024, 2022], Senate tries [2024, 2022, 2020, 2018, 2016]
      const runtimeCycle = await getElectionCycle();
      const cyclesToTry =
        office === 'H'
          ? [runtimeCycle, runtimeCycle - 2]
          : [runtimeCycle, runtimeCycle - 2, runtimeCycle - 4, runtimeCycle - 6, runtimeCycle - 8];

      // Find committee with most recent cycle from priority list
      let selectedCommittee = null;
      let usedCycle = null;

      for (const cycle of cyclesToTry) {
        // Find P or A committee that has this cycle
        const committee = candidate.principal_committees.find(
          c =>
            (c.designation === 'P' || c.designation === 'A') && c.cycles && c.cycles.includes(cycle)
        );
        if (committee) {
          selectedCommittee = committee;
          usedCycle = cycle;
          if (cycle !== runtimeCycle) {
            console.log(`🔄 Using committee from previous cycle ${cycle} for ${member.name}`);
          }
          break;
        }
      }

      if (selectedCommittee) {
        // Successfully found committee in principal_committees with matching cycle
        const committeeId = selectedCommittee.committee_id;
        console.log(`📊 Getting committee totals for ${committeeId} (cycle ${usedCycle})`);

        const committeeTotalsResponse = await fetch(
          `https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${apiKey}&cycle=${usedCycle}`,
          {
            headers: {
              'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
            },
          }
        );

        if (committeeTotalsResponse.ok) {
          const committeeTotalsData = await committeeTotalsResponse.json();
          const latestTotal = committeeTotalsData.results?.[0];

          if (latestTotal) {
            console.log(
              `💰 Found committee financial data for ${member.name}: $${latestTotal.receipts || 0}`
            );

            const totalRaised = latestTotal.receipts || 0;
            const grassrootsDonations = latestTotal.individual_unitemized_contributions || 0;
            const largeDonorDonations = latestTotal.individual_itemized_contributions || 0;
            const grassrootsPercent =
              totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

            hasFinancialData = true;
            return {
              totalRaised,
              grassrootsDonations,
              largeDonorDonations,
              grassrootsPercent,
              pacMoney: latestTotal.other_political_committee_contributions || 0,
              partyMoney: latestTotal.political_party_committee_contributions || 0,
              committeeId: committeeId,
              committeeName: candidate.name,
              fecCandidateId: candidate.candidate_id,
              dataCycle: usedCycle, // Track which cycle the data is from
            };
          }
        } else {
          // Consume the response body to prevent deadlock
          try {
            await committeeTotalsResponse.json();
          } catch {}
        }
      }
    }

    // COMMITTEE DISCOVERY: If we still don't have financial data, try explicit committee lookup
    // This runs when principal_committees was missing OR when none matched our cycle criteria
    if (!hasFinancialData) {
      console.log(`🔍 Attempting committee discovery for ${member.name}...`);
      try {
        // Fetch all committees (without cycle filter to get cycles[] array)
        const committeesResponse = await fetch(
          `https://api.open.fec.gov/v1/candidate/${candidate.candidate_id}/committees/?api_key=${apiKey}`,
          {
            headers: {
              'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
            },
          }
        );

        if (!committeesResponse.ok) {
          try {
            await committeesResponse.json();
          } catch {}
          console.log(`❌ Committee discovery failed for ${member.name}`);
        } else {
          const committeesData = await committeesResponse.json();

          if (committeesData.results && committeesData.results.length > 0) {
            console.log(
              `🔎 Found ${committeesData.results.length} total committees for ${member.name}`
            );

            // Log all available cycles for debugging
            const allCycles = [
              ...new Set(committeesData.results.flatMap(c => c.cycles || [])),
            ].sort((a, b) => b - a);
            console.log(`📅 Available committee cycles: ${allCycles.join(', ')}`);

            // Chamber-aware cycle fallback: House tries 2 cycles, Senate tries 5 cycles (10 years)
            // Get cycle from external time source (Cloudflare Date is unreliable)
            const runtimeCycle = await getElectionCycle();
            console.log(`🔍 DEBUG: office='${office}', runtime=${runtimeCycle}`);
            const cyclesToTry =
              office === 'H'
                ? [runtimeCycle, runtimeCycle - 2]
                : [
                    runtimeCycle,
                    runtimeCycle - 2,
                    runtimeCycle - 4,
                    runtimeCycle - 6,
                    runtimeCycle - 8,
                  ];

            // Find most recent cycle from our priority list
            let usedCycle = null;
            console.log(
              `🔍 Checking cycles for ${office === 'H' ? 'House' : 'Senate'}: ${cyclesToTry.join(', ')}`
            );
            for (const cycle of cyclesToTry) {
              const committeesInCycle = committeesData.results.filter(
                c => c.cycles && c.cycles.includes(cycle)
              );
              console.log(`  Cycle ${cycle}: ${committeesInCycle.length} committees found`);
              if (committeesInCycle.length > 0) {
                usedCycle = cycle;
                const currentCycle = await getElectionCycle();
                if (cycle !== currentCycle) {
                  console.log(`🔄 Using committee data from cycle ${cycle} for ${member.name}`);
                }
                break;
              }
            }

            if (usedCycle) {
              console.log(
                `🔍 Found ${committeesData.results?.length || 0} committees for ${member.name} (cycle ${usedCycle})`
              );

              // Log committee designations for debugging
              const designations = committeesData.results
                .map(c => `${c.designation || 'N/A'}:${c.committee_id}`)
                .join(', ');
              console.log(`📋 Committee designations: ${designations}`);

              // Filter for principal campaign committees (designation P or A) in the target cycle
              const principalCommittees =
                committeesData.results?.filter(
                  committee =>
                    ['P', 'A'].includes(committee.designation) &&
                    committee.cycles &&
                    committee.cycles.includes(usedCycle)
                ) || [];

              console.log(
                `✅ Found ${principalCommittees.length} P/A committees in cycle ${usedCycle}`
              );

              if (principalCommittees.length > 0) {
                const primaryCommittee = principalCommittees[0];
                console.log(
                  `✅ Discovered principal committee for ${member.name} (${office}): ${primaryCommittee.committee_id} (${primaryCommittee.name})`
                );

                // Get financial data using the discovered committee (use the cycle we found)
                const committeeTotalsResponse = await fetch(
                  `https://api.open.fec.gov/v1/committee/${primaryCommittee.committee_id}/totals/?api_key=${apiKey}&cycle=${usedCycle}`,
                  {
                    headers: {
                      'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
                    },
                  }
                );

                if (committeeTotalsResponse.ok) {
                  const committeeTotalsData = await committeeTotalsResponse.json();
                  const latestTotal = committeeTotalsData.results?.[0];

                  if (latestTotal) {
                    console.log(
                      `💰 Committee discovery success for ${member.name}: $${latestTotal.receipts || 0}`
                    );

                    const totalRaised = latestTotal.receipts || 0;
                    const grassrootsDonations =
                      latestTotal.individual_unitemized_contributions || 0;
                    const largeDonorDonations = latestTotal.individual_itemized_contributions || 0;
                    const grassrootsPercent =
                      totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

                    hasFinancialData = true;
                    return {
                      totalRaised,
                      grassrootsDonations,
                      largeDonorDonations,
                      grassrootsPercent,
                      pacMoney: latestTotal.other_political_committee_contributions || 0,
                      partyMoney: latestTotal.political_party_committee_contributions || 0,
                      committeeId: primaryCommittee.committee_id,
                      committeeName: primaryCommittee.name,
                      fecCandidateId: candidate.candidate_id,
                      dataCycle: usedCycle, // Track which cycle the data is from
                    };
                  }
                } else {
                  try {
                    await committeeTotalsResponse.json();
                  } catch {}
                }
              } else {
                console.log(`⚠️ No principal committees found for ${member.name} (${office})`);
              }
            } else {
              console.log(`⚠️ No committees found in recent cycles for ${member.name}`);
            }
          } else {
            console.log(`⚠️ No committees found at all for ${member.name}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error during committee discovery for ${member.name}:`, error);
      }

      // Add delay after committee discovery API calls to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 15000));
    }

    // Fallback: try the totals by entity endpoint
    const currentCycle = await getElectionCycle();
    const totalsResponse = await fetch(
      `https://api.open.fec.gov/v1/totals/by_entity/?api_key=${apiKey}&candidate_id=${candidate.candidate_id}&election_year=${currentCycle}&cycle=${currentCycle}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
        },
      }
    );

    if (!totalsResponse.ok) {
      console.warn(`FEC totals API error for ${candidate.candidate_id}: ${totalsResponse.status}`);
      // Consume the response body to prevent deadlock
      try {
        await totalsResponse.json();
      } catch {}
      return null;
    }

    const totalsData = await totalsResponse.json();
    const latestTotal = totalsData.results?.[0];

    // NOTE: /totals/by_entity/ ignores candidate_id entirely - it returns
    // marketwide aggregate rows (cumulative_* fields, no `receipts`). The
    // old code read `latestTotal.receipts || 0` and fabricated a $0
    // "success", overwriting members with zeros. Only accept a row that
    // actually has candidate-level fields.
    if (!latestTotal || latestTotal.receipts === undefined || latestTotal.receipts === null) {
      console.warn(
        `No usable candidate-level totals for ${candidate.candidate_id} - treating as lookup failure`
      );
      return null;
    }

    console.log(`💰 Found financial data for ${member.name}: $${latestTotal.receipts || 0}`);

    // Calculate grassroots percentage (donations under $200)
    const totalRaised = latestTotal.receipts || 0;
    const grassrootsDonations = latestTotal.individual_unitemized_contributions || 0;
    const grassrootsPercent =
      totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

    return {
      totalRaised,
      grassrootsDonations,
      grassrootsPercent,
      pacMoney: latestTotal.other_political_committee_contributions || 0,
      partyMoney: latestTotal.political_party_committee_contributions || 0,
      committeeId: latestTotal.committee_id || null, // Fallback path: use committee_id from totals response if available
      committeeName: candidate.name,
      fecCandidateId: candidate.candidate_id,
      dataCycle: await getElectionCycle(), // Generic fallback uses current cycle
    };
  } catch (error) {
    console.warn(`Error fetching financials for ${member.name}:`, error.message);
    return null;
  }
}

// Fetch detailed PAC contributions using Schedule A endpoint
async function fetchPACDetails(committeeId, env) {
  const apiKey = requireSecret(env, 'FEC_API_KEY');

  try {
    console.log(`📊 Fetching PAC details for committee: ${committeeId}`);

    // Fetch Schedule A receipts (itemized contributions) filtered for PACs
    const currentCycle = await getElectionCycle();
    const response = await fetch(
      `https://api.open.fec.gov/v1/schedules/schedule_a/?api_key=${apiKey}&committee_id=${committeeId}&contributor_type=committee&per_page=100&sort=-contribution_receipt_amount&two_year_transaction_period=${currentCycle}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
        },
      }
    );

    if (!response.ok) {
      console.warn(`FEC Schedule A API error for ${committeeId}: ${response.status}`);
      // Consume the response body to prevent deadlock
      try {
        await response.json();
      } catch {}
      return [];
    }

    const data = await response.json();
    const contributions = data.results || [];

    console.log(
      `💰 Found ${contributions.length} total committee contributions for ${committeeId}`
    );

    // Process and clean the contributions using FEC line numbers and entity types
    const pacContributions = contributions
      .filter(contrib => {
        if (!contrib.contributor_name || contrib.contribution_receipt_amount <= 0) {
          return false;
        }

        // Exclude conduit/earmarked contributions (FEC Line 11AI)
        if (contrib.line_number === '11AI') {
          return false;
        }

        // Exclude other receipts: interest, dividends, refunds (FEC Line 15)
        if (contrib.line_number === '15') {
          return false;
        }

        // Exclude transfers between committees (FEC Line 12/16/17/18)
        if (['12', '16', '17', '18'].includes(contrib.line_number)) {
          return false;
        }

        // Exclude if this has a conduit committee ID (earmarked pass-through)
        if (contrib.conduit_committee_id) {
          return false;
        }

        // Only include actual PAC contributions (entity_type should be PAC)
        // But don't hard-require it since some valid PACs might have different entity types
        return true;
      })
      .map(contrib => ({
        pacName: contrib.contributor_name,
        amount: contrib.contribution_receipt_amount,
        date: contrib.contribution_receipt_date,
        contributorType: contrib.contributor_type,
        contributorId: contrib.contributor_id,
        employerName: contrib.contributor_employer,
        contributorOccupation: contrib.contributor_occupation,
        contributorState: contrib.contributor_state,
        receiptDescription: contrib.receipt_description,
      }))
      .slice(0, 20); // Top 20 PAC contributors

    console.log(`💰 After filtering conduits/processors: ${pacContributions.length} actual PACs`);

    // NEW: Enhance with committee metadata for transparency weighting
    console.log(`🔍 Enhancing PAC data with committee metadata...`);
    const enhancedContributions = [];
    const uniqueCommittees = new Set();

    for (const contrib of pacContributions) {
      let metadata = null;
      let lookupKey = null;

      // Try contributorId first (for new data)
      if (contrib.contributorId && !uniqueCommittees.has(contrib.contributorId)) {
        lookupKey = contrib.contributorId;
        uniqueCommittees.add(contrib.contributorId);

        // Add delay to respect FEC rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

        metadata = await fetchCommitteeMetadata(contrib.contributorId, env);
      }
      // Try pacName search (for existing data)
      else if (contrib.pacName && !uniqueCommittees.has(contrib.pacName)) {
        lookupKey = contrib.pacName;
        uniqueCommittees.add(contrib.pacName);

        // Add delay to respect FEC rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

        metadata = await searchCommitteeByName(contrib.pacName, env);
      }

      if (metadata && lookupKey) {
        const enhancedContrib = {
          ...contrib,
          committee_type: metadata.committee_type,
          designation: metadata.designation,
          transparency_weight: getPACTransparencyWeight(
            metadata.committee_type,
            metadata.designation
          ),
          committee_category: getCommitteeCategory(metadata.committee_type, metadata.designation),
          weighted_amount:
            contrib.amount *
            getPACTransparencyWeight(metadata.committee_type, metadata.designation),
        };

        enhancedContributions.push(enhancedContrib);

        console.log(
          `✅ Enhanced ${contrib.pacName}: ${enhancedContrib.committee_category} (weight: ${enhancedContrib.transparency_weight})`
        );
      } else {
        // Find existing metadata for this committee (by contributorId or pacName)
        const existing = enhancedContributions.find(
          c =>
            (contrib.contributorId && c.contributorId === contrib.contributorId) ||
            (contrib.pacName && c.pacName === contrib.pacName)
        );

        if (existing) {
          enhancedContributions.push({
            ...contrib,
            committee_type: existing.committee_type,
            designation: existing.designation,
            transparency_weight: existing.transparency_weight,
            committee_category: existing.committee_category,
            weighted_amount: contrib.amount * existing.transparency_weight,
          });
        } else {
          // Fallback without metadata
          enhancedContributions.push({
            ...contrib,
            committee_type: null,
            designation: null,
            transparency_weight: 1.0,
            committee_category: 'Unknown',
            weighted_amount: contrib.amount,
          });
        }
      }
    }

    return enhancedContributions;
  } catch (error) {
    console.warn(`Error fetching PAC details for ${committeeId}:`, error.message);
    return [];
  }
}

// NEW: Fetch committee metadata for transparency weighting
async function fetchCommitteeMetadata(committeeId, env) {
  const apiKey = requireSecret(env, 'FEC_API_KEY');

  try {
    const response = await fetch(
      `https://api.open.fec.gov/v1/committee/${committeeId}/?api_key=${apiKey}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
        },
      }
    );

    if (!response.ok) {
      console.warn(`Committee API error for ${committeeId}: ${response.status}`);
      try {
        await response.json();
      } catch {} // Consume response body
      return { committee_type: null, designation: null };
    }

    const data = await response.json();
    const committee = data.results?.[0];

    if (!committee) {
      return { committee_type: null, designation: null };
    }

    return {
      committee_type: committee.committee_type,
      designation: committee.designation,
      name: committee.name,
    };
  } catch (error) {
    console.warn(`Error fetching committee metadata for ${committeeId}:`, error.message);
    return { committee_type: null, designation: null };
  }
}

// NEW: Search for committee by name to get ID and metadata
async function searchCommitteeByName(committeeName, env) {
  const apiKey = requireSecret(env, 'FEC_API_KEY');
  try {
    console.log(`🔍 Searching for committee by name: ${committeeName}`);

    // Clean the committee name for search
    const searchName = committeeName.trim().toUpperCase();

    const response = await fetch(
      `https://api.open.fec.gov/v1/committees/?api_key=${apiKey}&name=${encodeURIComponent(searchName)}&per_page=10`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)',
        },
      }
    );

    if (!response.ok) {
      console.warn(`FEC Committee search error for "${searchName}": ${response.status}`);
      try {
        await response.json();
      } catch {}
      return { committee_type: null, designation: null };
    }

    const data = await response.json();
    const committees = data.results || [];

    if (committees.length === 0) {
      console.warn(`No committees found for name: ${searchName}`);
      return { committee_type: null, designation: null };
    }

    // Find exact match first, then partial match
    let committee = committees.find(c => c.name?.toUpperCase() === searchName);
    if (!committee) {
      committee = committees.find(c => c.name?.toUpperCase().includes(searchName.split(' ')[0]));
    }
    if (!committee) {
      committee = committees[0]; // Fallback to first result
    }

    console.log(
      `✅ Found committee: ${committee.name} (${committee.committee_type}/${committee.designation})`
    );
    return {
      committee_type: committee.committee_type,
      designation: committee.designation,
      committee_id: committee.committee_id,
      name: committee.name,
    };
  } catch (error) {
    console.warn(`Error searching for committee "${committeeName}":`, error.message);
    return { committee_type: null, designation: null };
  }
}

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

// Enhanced tier calculation: loads donor-concentration data from KV, then
// delegates the math to the pure functions in tier-calculation.js.
// Signature kept from the original so call sites are unchanged.
async function calculateEnhancedTier(member, _allMembers = [], env = null) {
  let concentration = null;
  if (env && member.bioguideId) {
    try {
      const concentrationData = await env.MEMBER_DATA.get(
        `itemized_analysis_v2:${member.bioguideId}`
      );
      if (concentrationData) {
        concentration = JSON.parse(concentrationData);
      }
    } catch (error) {
      // Concentration data not available
    }
  }

  // An analysis describes the committee it was collected from. If that is no
  // longer the member's committee - their FEC identity was corrected (issue
  // #41) - the analysis is someone else's donors, bundlers and foreign-agent
  // matches. Reject it and tell the caller to clear what it previously merged.
  let concentrationRejected = false;
  // A member with no committee on record cannot vouch for any analysis: the
  // itemized worker used to name-search its own committee in that case, which
  // is the same defect again.
  if (concentration && concentration.committeeId !== member.committeeInfo?.id) {
    console.warn(
      `🚫 ${member.bioguideId}: ignoring itemized analysis from ${concentration.committeeId}; member's committee is ${member.committeeInfo?.id ?? 'unknown'}`
    );
    concentration = null;
    concentrationRejected = true;
  }

  const result = gradeMember(member, concentration);

  if (result.detail?.path === 'enhanced') {
    console.log(
      `${member.bioguideId} tier=${result.tier} anchor=${result.detail.trustAnchor}% ` +
        `(${result.detail.trustAnchorBasis}) itemized=${result.detail.itemizedPercent}% ` +
        `penalty=${result.detail.itemizationPenalty} pacPenalty=${result.detail.transparencyPenalty}`
    );
  }

  // Expose the loaded concentration so callers (tier recalculation) can merge
  // it into members:all - the API serves from there instead of doing a
  // per-member KV lookup on every request
  return { ...result, concentration, concentrationRejected };
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
  const [raw, record] = await Promise.all([
    env.MEMBER_DATA.get(`itemized_analysis_v2:${bioguideId}`),
    getMember(env, bioguideId),
  ]);
  const a = raw ? JSON.parse(raw) : null;
  const pf = a?.personFunding && !a.personFunding.failed ? a.personFunding : null;
  const body = {
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
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=900',
    },
  });
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

// NEW: Handler for recalculating tiers for all members with existing data
async function handleRecalculateTiers(env, corsHeaders, request) {
  const denied = requireAdmin(request, env, corsHeaders);
  if (denied) {
    return denied;
  }
  try {
    const url = new URL(request.url);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    // 10 per call keeps each call inside the 10 ms CPU limit (measured
    // 2026-10-03: 9.6 ms for the slowest, cold call of 10; 15.8 ms at 50)
    const limit = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10)
    );
    const stats = await recalculateTierChunk(env, offset, limit);
    return new Response(
      JSON.stringify({
        success: true,
        message:
          stats.nextOffset === null
            ? 'Last slice re-graded'
            : `Slice re-graded; call again with ?offset=${stats.nextOffset} (scripts/recalculate-all.sh does this)`,
        stats,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Tier recalculation failed:', error);
    return new Response(JSON.stringify({ error: error.message, success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Process specific candidate by name or bioguideId
async function handleProcessCandidate(env, corsHeaders, request) {
  // This endpoint fetches FEC data and writes a member: it was open to anyone
  // until 2026-10-03. The RUNBOOK always sent the secret; now it is checked.
  const denied = requireAdmin(request, env, corsHeaders);
  if (denied) {
    return denied;
  }
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    const requested = url.searchParams.get('bioguideId');
    if (!name && !requested) {
      return json({ error: 'Either name or bioguideId parameter required' }, 400);
    }
    const bioguideId = await findMemberId(env, { bioguideId: requested, name });
    const before = bioguideId ? await getMember(env, bioguideId) : null;
    if (!before) {
      return json(
        {
          error: `Member not found: ${name || requested}`,
          suggestion:
            'Try searching with full name format: "LastName, FirstName" or exact bioguideId',
        },
        404
      );
    }
    console.log(`🎯 Re-fetching ${before.name} (${before.bioguideId}) end to end`);

    // The full single-member path (financials, then PAC details by committee
    // ID - issue #5 passed the member object here and discarded the PACs),
    // then the same re-grade the recalculation applies
    const updated = await updateSingleMember(structuredClone(before), env);
    if (!updated) {
      return json(
        {
          error: `Processing failed for ${before.name}: no FEC financial data found`,
          member: {
            name: before.name,
            bioguideId: before.bioguideId,
            state: before.state,
            chamber: before.chamber,
          },
        },
        500
      );
    }
    const after = await regradeMember(updated, env);
    after.lastProcessed = new Date().toISOString();
    after.processingStatus = 'complete';
    const writer = new MemberWriter(env);
    await writer.save(before, after);
    await writer.flush();

    return json({
      success: true,
      member: {
        name: after.name,
        bioguideId: after.bioguideId,
        state: after.state,
        chamber: after.chamber,
        tier: after.tier,
        grassrootsPercent: after.grassrootsPercent,
        totalRaised: after.totalRaised,
        pacCount: after.pacContributions?.length || 0,
        processingStatus: after.processingStatus,
        lastProcessed: after.lastProcessed,
      },
      changes: {
        tierChanged: before.tier !== after.tier,
        financialDataAdded: !before.totalRaised && after.totalRaised > 0,
        oldTier: before.tier,
        newTier: after.tier,
      },
    });
  } catch (error) {
    console.error('Process candidate failed:', error);
    return json({ error: error.message, success: false }, 500);
  }
}

// Individual Member Update Endpoint: /api/update-member/@username
async function handleIndividualMemberUpdate(env, corsHeaders, request) {
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

    // Extract username from URL path
    const username = url.pathname.replace('/api/update-member/@', '');

    if (!username) {
      return new Response(
        JSON.stringify({
          error: 'Username required - use format /api/update-member/@username',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`🎯 Individual member update requested for: @${username}`);

    // Get or create social handle mapping
    const handleMap = await getOrCreateSocialHandleMapping(env);

    // Look up bioguide ID from handle, or use directly if it looks like a bioguide ID
    let bioguideId = handleMap[username.toLowerCase()];

    // If not found in handle mapping, check if it's already a bioguide ID pattern (letter followed by 6 digits)
    if (!bioguideId && /^[A-Z]\d{6}$/.test(username.toUpperCase())) {
      bioguideId = username.toUpperCase();
      console.log(
        `🔧 Using ${username} as direct bioguide ID (not found in social handle mapping)`
      );
    }

    if (!bioguideId) {
      return new Response(
        JSON.stringify({
          error: `No member found for handle @${username}`,
          suggestion:
            'Try updating social handle mapping first, or use bioguide ID format (e.g., G000386)',
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`✅ Found bioguide ID ${bioguideId} for @${username}`);

    const member = await getMember(env, bioguideId);
    if (!member) {
      return new Response(
        JSON.stringify({
          error: `Member with bioguide ID ${bioguideId} not found in current data`,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log(`🔄 Updating ${member.name} (${member.chamber} - ${member.state})`);

    // Full single-member path, then the recalculation's re-grade
    const fetched = await updateSingleMember(structuredClone(member), env);
    if (!fetched) {
      throw new Error(`Failed to update member data for ${member.name}`);
    }
    const updatedMember = await regradeMember(fetched, env);
    const writer = new MemberWriter(env);
    await writer.save(member, updatedMember);
    await writer.flush();
    console.log(`✅ Successfully updated ${updatedMember.name}`);

    return new Response(
      JSON.stringify({
        success: true,
        member: updatedMember,
        message: `Successfully updated ${updatedMember.name}`,
        tier: updatedMember.tier,
        totalRaised: updatedMember.totalRaised,
        grassrootsPercent: updatedMember.grassrootsPercent,
        pacContributions: updatedMember.pacContributions?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Individual member update failed:', error);
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

// Function to update a single member through the full pipeline
async function updateSingleMember(member, env) {
  try {
    // Phase 1: Update financial data
    console.log(`💰 Phase 1: Updating financial data for ${member.name}...`);

    const financialData = await fetchMemberFinancials(member, env);
    if (!financialData) {
      throw new Error(
        `Failed to fetch FEC financial data for ${member.name}. Member may not have an active FEC committee or name matching failed.`
      );
    }

    member.totalRaised = financialData.totalRaised;
    member.grassrootsDonations = financialData.grassrootsDonations;
    member.largeDonorDonations = financialData.largeDonorDonations;
    member.grassrootsPercent = financialData.grassrootsPercent;
    member.pacMoney = financialData.pacMoney;
    member.partyMoney = financialData.partyMoney;
    member.committeeId = financialData.committeeId;
    member.lastUpdated = new Date().toISOString();
    // BUGFIX: Always refresh dataCycle to prevent stale 1970 values (Issue #15)
    member.dataCycle = financialData.dataCycle || (await getElectionCycle());

    console.log(
      `✅ Financial data updated: $${member.totalRaised.toLocaleString()} raised, ${member.grassrootsPercent}% grassroots`
    );

    // Phase 2: Update PAC details if we have committee info
    if (member.committeeId) {
      console.log(`🏛️ Phase 2: Updating PAC details for ${member.name}...`);

      const pacDetails = await fetchPACDetails(member.committeeId, env);
      if (pacDetails && pacDetails.length > 0) {
        member.pacContributions = pacDetails;
        member.pacDetailsStatus = 'complete';

        // Recalculate pacMoney from actual contributions (FEC totals can be wrong)
        member.pacMoney = pacDetails.reduce((sum, pac) => sum + pac.amount, 0);

        // Keep original grassrootsDonations from Phase 1 (FEC individual_unitemized_contributions)
        // Don't recalculate - totalRaised includes PACs, large individual donations, party money, etc.
        // Only individual_unitemized_contributions (<$200) count as true grassroots

        console.log(
          `✅ PAC data updated: ${pacDetails.length} contributions, $${member.pacMoney.toLocaleString()} total`
        );
      }
    }

    // Recalculate tier with enhanced algorithm
    const { tier, individualFundingPercent } = await calculateEnhancedTier(member, [], env);
    member.tier = tier;
    member.individualFundingPercent = individualFundingPercent;

    // Recalculate grassrootsPercent to match tier calculation
    if (member.totalRaised > 0) {
      member.grassrootsPercent = Math.round(
        (member.grassrootsDonations / member.totalRaised) * 100
      );
    }

    console.log(`🎯 Final tier: ${member.tier} (${member.grassrootsPercent}% grassroots)`);

    return member;
  } catch (error) {
    console.error(`Error updating single member ${member.name}:`, error);
    return null;
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
