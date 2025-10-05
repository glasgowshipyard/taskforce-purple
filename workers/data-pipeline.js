// Task Force Purple Data Pipeline
// Cloudflare Worker to fetch and process congressional data

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
        case '/api/update-data':
          return await handleDataUpdate(env, corsHeaders, request);
        case '/api/update-fec-batch':
          return await handleFECBatchUpdate(env, corsHeaders, request);
        case '/api/status':
          return await handleStatus(env, corsHeaders);
        case '/api/test-member':
          return await handleTestMember(env, corsHeaders, request);
        case '/api/recalculate-tiers':
          return await handleRecalculateTiers(env, corsHeaders, request);
        case '/api/process-candidate':
          return await handleProcessCandidate(env, corsHeaders, request);
        case '/api/social-handles':
          return await handleSocialHandles(env, corsHeaders);
        case '/api/refresh-social-handles':
          return await handleRefreshSocialHandles(env, corsHeaders, request);
        case '/api/smart-batch':
          return await handleSmartBatch(env, corsHeaders, request);
        case '/api/clear-fec-mapping':
          return await handleClearFECMapping(env, corsHeaders, request);
        case '/api/reset-pac-data':
          return await handleResetPACData(env, corsHeaders, request);
        case '/api/refresh-congress-metadata':
          return await handleRefreshCongressMetadata(env, corsHeaders, request);
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  // Smart batch processing - rate-limited progressive updates
  async scheduled(event, env, ctx) {
    console.log('🔄 Starting smart batch processing...');
    try {
      const result = await processSmartBatch(env);
      console.log(`✅ Smart batch completed: ${result.callsUsed}/15 API calls, ${result.membersProcessed} members`);
    } catch (error) {
      console.error('❌ Smart batch processing failed:', error);
    }
  }
};

// Get current year from reliable external NTP/time sources (Cloudflare Workers Date is broken)
async function getCurrentYear() {
  // Primary + 3 fallback NTP/time APIs (1+3 = 4 total)
  const timeSources = [
    {
      name: 'time.gov (NIST)',
      url: 'https://time.gov/currenttime',
      parse: (data) => new Date(data.datetime).getFullYear()
    },
    {
      name: 'worldtimeapi.org',
      url: 'https://worldtimeapi.org/api/timezone/America/New_York',
      parse: (data) => new Date(data.datetime).getFullYear()
    },
    {
      name: 'timeapi.io',
      url: 'https://timeapi.io/api/Time/current/zone?timeZone=America/New_York',
      parse: (data) => new Date(data.dateTime).getFullYear()
    },
    {
      name: 'worldclockapi.com',
      url: 'http://worldclockapi.com/api/json/est/now',
      parse: (data) => new Date(data.currentDateTime).getFullYear()
    }
  ];

  // Try each source in order
  for (const source of timeSources) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(2000) // 2 second timeout per source
      });
      if (response.ok) {
        const data = await response.json();
        const year = source.parse(data);
        console.log(`📅 Got year from ${source.name}: ${year}`);
        return year;
      }
    } catch (error) {
      console.warn(`⚠️ ${source.name} failed: ${error.message}`);
      // Continue to next source
    }
  }

  // All sources failed - this is a critical error, cannot proceed
  throw new Error('All 4 NTP time sources failed - cannot determine current year');
}

// Calculate election cycle from current year
async function getElectionCycle() {
  const currentYear = await getCurrentYear();
  const cycle = currentYear % 2 === 0 ? currentYear : currentYear - 1;
  return cycle;
}

// Fetch current Congress members from Congress.gov API (with pagination)
async function fetchCongressMembers(env) {
  const apiKey = env.CONGRESS_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';  // Temporary fallback

  console.log('📊 Fetching current 119th Congress members...');

  let allMembers = [];
  let offset = 0;
  const limit = 250;

  // First, get total count to determine pagination strategy
  const firstResponse = await fetch(
    `https://api.congress.gov/v3/member/congress/119?currentMember=true&offset=0&limit=1&api_key=${apiKey}`,
    {
      headers: {
        'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
      }
    }
  );

  if (!firstResponse.ok) {
    throw new Error(`Congress API error: ${firstResponse.status} ${firstResponse.statusText}`);
  }

  const firstData = await firstResponse.json();
  const totalCount = firstData.pagination?.count || 0;
  console.log(`📊 Total members available: ${totalCount}`);

  // Calculate pages to fetch in reverse order (oldest first)
  const totalPages = Math.ceil(totalCount / limit);

  for (let page = totalPages - 1; page >= 0; page--) {
    const currentOffset = page * limit;

    console.log(`📥 Fetching page ${page + 1}/${totalPages} (offset ${currentOffset}) - ${page === totalPages - 1 ? 'ESTABLISHED' : page === 0 ? 'NEWEST' : 'MID-TENURE'} members`);

    const response = await fetch(
      `https://api.congress.gov/v3/member/congress/119?currentMember=true&offset=${currentOffset}&limit=${limit}&api_key=${apiKey}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Congress API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const members = data.members || [];
    allMembers = allMembers.concat(members);

    console.log(`📈 Fetched ${members.length} members, total so far: ${allMembers.length}`);

    // Small delay between paginated requests (except for last page)
    if (page > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`✅ Total members fetched: ${allMembers.length}`);
  return allMembers;
}

// State name to abbreviation mapping
const STATE_ABBREVIATIONS = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

// Select current committee using proper cycle and designation filtering
// Returns: { committee, usedCycle }
async function selectCurrentCommittee(candidateId, env, office = null) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';

  try {
    // Fetch all committees for this candidate (without cycle filter)
    // We'll filter by cycle in code since FEC returns committees with cycles[] array
    const response = await fetch(
      `https://api.open.fec.gov/v1/candidate/${candidateId}/committees/?api_key=${apiKey}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Committee lookup failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      throw new Error(`No committees found for candidate ${candidateId}`);
    }

    // Chamber-aware fallback strategy:
    // House (2-year terms): Try current cycle, then -2 (one cycle back)
    // Senate (6-year terms): Try current cycle, then -2, -4, -6, -8 (four cycles back = 10 years)
    const runtimeCycle = await getElectionCycle();
    const cyclesToTry = office === 'H'
      ? [runtimeCycle, runtimeCycle - 2]
      : [runtimeCycle, runtimeCycle - 2, runtimeCycle - 4, runtimeCycle - 6, runtimeCycle - 8];

    // Find committee with the most recent cycle from our priority list
    let usedCycle = null;
    for (const cycle of cyclesToTry) {
      // Check if any committee has this cycle
      const hasCommitteeInCycle = data.results.some(c =>
        c.cycles && c.cycles.includes(cycle)
      );
      if (hasCommitteeInCycle) {
        usedCycle = cycle;
        const currentCycle = await getElectionCycle();
        if (cycle !== currentCycle) {
          console.log(`🔄 Using committee data from previous cycle ${cycle} for ${candidateId} (${office || 'unknown chamber'})`);
        }
        break;
      }
    }

    if (!usedCycle) {
      throw new Error(`No committees found for candidate ${candidateId} in any recent cycle`);
    }

    // Filter by designation (P = Principal, A = Authorized) AND cycle availability
    const campaignCommittees = data.results.filter(c =>
      (c.designation === 'P' || c.designation === 'A') &&
      c.cycles && c.cycles.includes(usedCycle)
    );

    if (campaignCommittees.length === 0) {
      // Fallback: use most recent committee
      console.log(`⚠️ No P/A committees found for ${candidateId}, using most recent committee`);
      return data.results.sort((a, b) =>
        new Date(b.last_file_date || '1900-01-01') - new Date(a.last_file_date || '1900-01-01')
      )[0];
    }

    // Prefer Principal (P), fallback to most recent Authorized (A)
    const principal = campaignCommittees.find(c => c.designation === 'P');
    if (principal) {
      console.log(`✅ Selected Principal committee: ${principal.name} (${principal.committee_id}) - cycle ${usedCycle}`);
      return { committee: principal, usedCycle };
    }

    const mostRecentAuthorized = campaignCommittees.sort((a, b) =>
      new Date(b.last_file_date || '1900-01-01') - new Date(a.last_file_date || '1900-01-01')
    )[0];

    console.log(`✅ Selected Authorized committee: ${mostRecentAuthorized.name} (${mostRecentAuthorized.committee_id}) - cycle ${usedCycle}`);
    return { committee: mostRecentAuthorized, usedCycle };

  } catch (error) {
    console.error(`❌ Committee selection failed for ${candidateId}:`, error.message);
    throw error;
  }
}

// Fetch financial data from OpenFEC API using correct endpoints
async function fetchMemberFinancials(member, env) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';  // Temporary fallback

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
      if (member.chamber) return member.chamber;
      // Otherwise get most recent term from Congress.gov data
      const terms = member.terms?.item;
      if (!terms || terms.length === 0) return null;
      return terms[terms.length - 1].chamber;
    })();
    const office = chamberType === 'House of Representatives' || chamberType === 'House' ? 'H'
                 : member.district ? 'H'  // If member has district, they're House
                 : 'S';  // Otherwise Senate

    // Check for cached FEC candidate mapping first
    const cacheKey = `fec_mapping_${member.bioguideId}`;
    const cachedMapping = await env.MEMBER_DATA.get(cacheKey);

    let candidate = null;

    if (cachedMapping) {
      const mapping = JSON.parse(cachedMapping);
      console.log(`🔄 Using cached FEC mapping: ${member.name} → ${mapping.candidate_id}`);
      candidate = {
        candidate_id: mapping.candidate_id,
        name: mapping.candidate_name,
        principal_committees: mapping.principal_committees
      };
    } else {
      // First time lookup - search for the candidate by name with validation
      const searchResponse = await fetch(
        `https://api.open.fec.gov/v1/candidates/search/?api_key=${apiKey}&q=${encodeURIComponent(member.name.split(',')[0])}&office=${office}&state=${stateAbbr}`,
        {
          headers: {
            'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
          }
        }
      );

      if (!searchResponse.ok) {
        console.warn(`FEC search API error for ${member.name}: ${searchResponse.status}`);
        try { await searchResponse.json(); } catch {}
        return null;
      }

      const searchData = await searchResponse.json();
      if (!searchData.results || searchData.results.length === 0) {
        console.warn(`No FEC candidate record found for ${member.name}`);
        return null;
      }

      // CRITICAL FIX: Find candidate that actually matches our member's state and office
      candidate = searchData.results.find(c => {
        const candidateState = c.state?.toUpperCase();
        const candidateOffice = c.office_sought?.toUpperCase();
        const expectedState = stateAbbr?.toUpperCase();
        const expectedOffice = office?.toUpperCase();

        return candidateState === expectedState && candidateOffice === expectedOffice;
      });

      // FALLBACK: If office_sought is undefined, use committee ID pattern matching
      if (!candidate) {
        console.log(`🔄 Primary matching failed, trying committee ID pattern fallback for ${member.name}`);

        candidate = searchData.results.find(c => {
          const candidateState = c.state?.toUpperCase();
          const expectedState = stateAbbr?.toUpperCase();

          if (candidateState !== expectedState) return false;

          // Check if candidate has committees that match expected chamber
          if (c.principal_committees && c.principal_committees.length > 0) {
            return c.principal_committees.some(committee => {
              const committeeType = committee.committee_type;
              const committeeId = committee.committee_id;
              if (office === 'S' && committeeType === 'S') {
                console.log(`✅ Committee type match: ${committeeId} (Senate) for ${member.name}`);
                return true;
              }
              if (office === 'H' && committeeType === 'H') {
                console.log(`✅ Committee type match: ${committeeId} (House) for ${member.name}`);
                return true;
              }
              return false;
            });
          }
          return false;
        });
      }

      if (!candidate) {
        console.warn(`❌ No matching FEC candidate for ${member.name} (${stateAbbr}-${office}). Found candidates: ${searchData.results.map(c => `${c.name} (${c.state}-${c.office_sought})`).join(', ')}`);
        return null;
      }

      console.log(`✅ Found validated FEC candidate: ${candidate.name} (ID: ${candidate.candidate_id}) for ${member.name} (${stateAbbr}-${office})`);

      // Cache the validated mapping for future use
      const mappingToCache = {
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.name,
        principal_committees: candidate.principal_committees,
        verified_date: new Date().toISOString(),
        verification_method: 'auto_validated',
        member_state: stateAbbr,
        member_office: office
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
      const cyclesToTry = office === 'H'
        ? [runtimeCycle, runtimeCycle - 2]
        : [runtimeCycle, runtimeCycle - 2, runtimeCycle - 4, runtimeCycle - 6, runtimeCycle - 8];

      // Find committee with most recent cycle from priority list
      let selectedCommittee = null;
      let usedCycle = null;

      for (const cycle of cyclesToTry) {
        // Find P or A committee that has this cycle
        const committee = candidate.principal_committees.find(c =>
          (c.designation === 'P' || c.designation === 'A') &&
          c.cycles && c.cycles.includes(cycle)
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
            'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
          }
        }
      );

      if (committeeTotalsResponse.ok) {
        const committeeTotalsData = await committeeTotalsResponse.json();
        const latestTotal = committeeTotalsData.results?.[0];

        if (latestTotal) {
          console.log(`💰 Found committee financial data for ${member.name}: $${latestTotal.receipts || 0}`);

          const totalRaised = latestTotal.receipts || 0;
          const grassrootsDonations = latestTotal.individual_unitemized_contributions || 0;
          const largeDonorDonations = latestTotal.individual_itemized_contributions || 0;
          const grassrootsPercent = totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

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
            dataCycle: usedCycle // Track which cycle the data is from
          };
        }
      } else {
        // Consume the response body to prevent deadlock
        try { await committeeTotalsResponse.json(); } catch {}
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
                'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
              }
            }
          );

          if (!committeesResponse.ok) {
            try { await committeesResponse.json(); } catch {}
            console.log(`❌ Committee discovery failed for ${member.name}`);
          } else {
            const committeesData = await committeesResponse.json();

            if (committeesData.results && committeesData.results.length > 0) {
              console.log(`🔎 Found ${committeesData.results.length} total committees for ${member.name}`);

              // Log all available cycles for debugging
              const allCycles = [...new Set(committeesData.results.flatMap(c => c.cycles || []))].sort((a,b) => b-a);
              console.log(`📅 Available committee cycles: ${allCycles.join(', ')}`);

              // Chamber-aware cycle fallback: House tries 2 cycles, Senate tries 5 cycles (10 years)
              // Get cycle from external time source (Cloudflare Date is unreliable)
              const runtimeCycle = await getElectionCycle();
              console.log(`🔍 DEBUG: office='${office}', runtime=${runtimeCycle}`);
              const cyclesToTry = office === 'H'
                ? [runtimeCycle, runtimeCycle - 2]
                : [runtimeCycle, runtimeCycle - 2, runtimeCycle - 4, runtimeCycle - 6, runtimeCycle - 8];

              // Find most recent cycle from our priority list
              let usedCycle = null;
              console.log(`🔍 Checking cycles for ${office === 'H' ? 'House' : 'Senate'}: ${cyclesToTry.join(', ')}`);
              for (const cycle of cyclesToTry) {
                const committeesInCycle = committeesData.results.filter(c =>
                  c.cycles && c.cycles.includes(cycle)
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
                console.log(`🔍 Found ${committeesData.results?.length || 0} committees for ${member.name} (cycle ${usedCycle})`);

                // Log committee designations for debugging
                const designations = committeesData.results.map(c => `${c.designation || 'N/A'}:${c.committee_id}`).join(', ');
                console.log(`📋 Committee designations: ${designations}`);

                // Filter for principal campaign committees (designation P or A) in the target cycle
                const principalCommittees = committeesData.results?.filter(committee =>
                  ['P', 'A'].includes(committee.designation) &&
                  committee.cycles && committee.cycles.includes(usedCycle)
                ) || [];

                console.log(`✅ Found ${principalCommittees.length} P/A committees in cycle ${usedCycle}`);

            if (principalCommittees.length > 0) {
              const primaryCommittee = principalCommittees[0];
              console.log(`✅ Discovered principal committee for ${member.name} (${office}): ${primaryCommittee.committee_id} (${primaryCommittee.name})`);

              // Get financial data using the discovered committee (use the cycle we found)
              const committeeTotalsResponse = await fetch(
                `https://api.open.fec.gov/v1/committee/${primaryCommittee.committee_id}/totals/?api_key=${apiKey}&cycle=${usedCycle}`,
                {
                  headers: {
                    'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
                  }
                }
              );

              if (committeeTotalsResponse.ok) {
                const committeeTotalsData = await committeeTotalsResponse.json();
                const latestTotal = committeeTotalsData.results?.[0];

                if (latestTotal) {
                  console.log(`💰 Committee discovery success for ${member.name}: $${latestTotal.receipts || 0}`);

                  const totalRaised = latestTotal.receipts || 0;
                  const grassrootsDonations = latestTotal.individual_unitemized_contributions || 0;
                  const largeDonorDonations = latestTotal.individual_itemized_contributions || 0;
                  const grassrootsPercent = totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

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
                    dataCycle: usedCycle // Track which cycle the data is from
                  };
                }
              } else {
                try { await committeeTotalsResponse.json(); } catch {}
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
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!totalsResponse.ok) {
      console.warn(`FEC totals API error for ${candidate.candidate_id}: ${totalsResponse.status}`);
      // Consume the response body to prevent deadlock
      try { await totalsResponse.json(); } catch {}
      return null;
    }

    const totalsData = await totalsResponse.json();
    const latestTotal = totalsData.results?.[0];

    if (!latestTotal) {
      console.warn(`No financial totals found for ${candidate.candidate_id}`);
      return null;
    }

    console.log(`💰 Found financial data for ${member.name}: $${latestTotal.receipts || 0}`);

    // Calculate grassroots percentage (donations under $200)
    const totalRaised = latestTotal.receipts || 0;
    const grassrootsDonations = latestTotal.individual_unitemized_contributions || 0;
    const grassrootsPercent = totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

    return {
      totalRaised,
      grassrootsDonations,
      grassrootsPercent,
      pacMoney: latestTotal.other_political_committee_contributions || 0,
      partyMoney: latestTotal.political_party_committee_contributions || 0,
      committeeId: committee.committee_id,
      committeeName: candidate.name,
      dataCycle: await getElectionCycle() // Generic fallback uses current cycle
    };

  } catch (error) {
    console.warn(`Error fetching financials for ${member.name}:`, error.message);
    return null;
  }
}

// Fetch detailed PAC contributions using Schedule A endpoint
async function fetchPACDetails(committeeId, env) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';

  try {
    console.log(`📊 Fetching PAC details for committee: ${committeeId}`);

    // Fetch Schedule A receipts (itemized contributions) filtered for PACs
    const currentCycle = await getElectionCycle();
    const response = await fetch(
      `https://api.open.fec.gov/v1/schedules/schedule_a/?api_key=${apiKey}&committee_id=${committeeId}&contributor_type=committee&per_page=100&sort=-contribution_receipt_amount&two_year_transaction_period=${currentCycle}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!response.ok) {
      console.warn(`FEC Schedule A API error for ${committeeId}: ${response.status}`);
      // Consume the response body to prevent deadlock
      try { await response.json(); } catch {}
      return [];
    }

    const data = await response.json();
    const contributions = data.results || [];

    console.log(`💰 Found ${contributions.length} total committee contributions for ${committeeId}`);

    // Process and clean the contributions using FEC line numbers and entity types
    const pacContributions = contributions
      .filter(contrib => {
        if (!contrib.contributor_name || contrib.contribution_receipt_amount <= 0) return false;

        // Exclude conduit/earmarked contributions (FEC Line 11AI)
        if (contrib.line_number === '11AI') return false;

        // Exclude other receipts: interest, dividends, refunds (FEC Line 15)
        if (contrib.line_number === '15') return false;

        // Exclude transfers between committees (FEC Line 12/16/17/18)
        if (['12', '16', '17', '18'].includes(contrib.line_number)) return false;

        // Exclude if this has a conduit committee ID (earmarked pass-through)
        if (contrib.conduit_committee_id) return false;

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
        receiptDescription: contrib.receipt_description
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
          transparency_weight: getPACTransparencyWeight(metadata.committee_type, metadata.designation),
          committee_category: getCommitteeCategory(metadata.committee_type, metadata.designation),
          weighted_amount: contrib.amount * getPACTransparencyWeight(metadata.committee_type, metadata.designation)
        };

        enhancedContributions.push(enhancedContrib);

        console.log(`✅ Enhanced ${contrib.pacName}: ${enhancedContrib.committee_category} (weight: ${enhancedContrib.transparency_weight})`);
      } else {
        // Find existing metadata for this committee (by contributorId or pacName)
        const existing = enhancedContributions.find(c =>
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
            weighted_amount: contrib.amount * existing.transparency_weight
          });
        } else {
          // Fallback without metadata
          enhancedContributions.push({
            ...contrib,
            committee_type: null,
            designation: null,
            transparency_weight: 1.0,
            committee_category: 'Unknown',
            weighted_amount: contrib.amount
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
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';

  try {
    const response = await fetch(
      `https://api.open.fec.gov/v1/committee/${committeeId}/?api_key=${apiKey}`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!response.ok) {
      console.warn(`Committee API error for ${committeeId}: ${response.status}`);
      try { await response.json(); } catch {} // Consume response body
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
      name: committee.name
    };

  } catch (error) {
    console.warn(`Error fetching committee metadata for ${committeeId}:`, error.message);
    return { committee_type: null, designation: null };
  }
}

// NEW: Search for committee by name to get ID and metadata
async function searchCommitteeByName(committeeName, env) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';
  try {
    console.log(`🔍 Searching for committee by name: ${committeeName}`);

    // Clean the committee name for search
    const searchName = committeeName.trim().toUpperCase();

    const response = await fetch(
      `https://api.open.fec.gov/v1/committees/?api_key=${apiKey}&name=${encodeURIComponent(searchName)}&per_page=10`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!response.ok) {
      console.warn(`FEC Committee search error for "${searchName}": ${response.status}`);
      try { await response.json(); } catch {}
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

    console.log(`✅ Found committee: ${committee.name} (${committee.committee_type}/${committee.designation})`);
    return {
      committee_type: committee.committee_type,
      designation: committee.designation,
      committee_id: committee.committee_id,
      name: committee.name
    };

  } catch (error) {
    console.warn(`Error searching for committee "${committeeName}":`, error.message);
    return { committee_type: null, designation: null };
  }
}

// NEW: Calculate transparency weight for PAC contributions
function getPACTransparencyWeight(committee_type, designation) {
  // Base weight: 1.0 (normal PAC concern)
  let weight = 1.0;

  // Committee Type adjustments
  if (committee_type === 'O') {
    weight *= 2.0; // Super PACs are 2x more concerning
  } else if (committee_type === 'P') {
    weight *= 0.3; // Candidate committees are 70% less concerning
  }

  // Designation adjustments
  if (designation === 'D' || designation === 'B') {
    weight *= 1.5; // Leadership/Lobbyist PACs 50% more concerning
  } else if (designation === 'P' || designation === 'A') {
    weight *= 0.15; // Candidate/Authorized committees 85% less concerning (personal PACs)
  }

  return weight;
}

// NEW: Get committee category for display
function getCommitteeCategory(committee_type, designation) {
  if (committee_type === 'O') return 'Super PAC';
  if (designation === 'D') return 'Leadership PAC';
  if (designation === 'B') return 'Lobbyist PAC';
  if (committee_type === 'P' || designation === 'P' || designation === 'A') return 'Candidate Committee';
  if (committee_type === 'Q') return 'Qualified PAC';
  if (committee_type === 'N') return 'Nonqualified PAC';
  if (designation === 'U') return 'Unauthorized PAC';
  return 'Other PAC';
}

// Calculate tier based on grassroots percentage
function calculateTier(grassrootsPercent, totalRaised) {
  // No financial data = no tier assignment
  if (totalRaised === 0) return 'N/A';

  if (grassrootsPercent >= 90) return 'S';
  if (grassrootsPercent >= 75) return 'A';
  if (grassrootsPercent >= 60) return 'B';
  if (grassrootsPercent >= 45) return 'C';
  if (grassrootsPercent >= 30) return 'D';
  if (grassrootsPercent >= 15) return 'E';
  return 'F';
}

// NEW: Calculate enhanced tier using transparency penalty system
function calculateEnhancedTier(member) {
  if (!member.totalRaised || member.totalRaised === 0) return 'N/A';

  // Check if we have enhanced PAC data with actual committee metadata
  const hasEnhancedData = member.pacContributions && member.pacContributions.length > 0
    && member.pacContributions.some(pac => pac.committee_type || pac.designation);

  if (hasEnhancedData) {
    // Use stored grassrootsDonations (FEC individual_unitemized_contributions <$200)
    // Don't calculate from totalRaised - pacMoney as that ignores large individual donations
    const actualGrassrootsPercent = member.totalRaised > 0
      ? (member.grassrootsDonations / member.totalRaised) * 100
      : 0;

    // Apply transparency penalty based on concerning PAC relationships
    const transparencyPenalty = calculateTransparencyPenalty(member);
    const adjustedThresholds = getAdjustedThresholds(transparencyPenalty);

    // Use stricter thresholds if they have concerning PAC relationships
    if (actualGrassrootsPercent >= adjustedThresholds.S) return 'S';
    if (actualGrassrootsPercent >= adjustedThresholds.A) return 'A';
    if (actualGrassrootsPercent >= adjustedThresholds.B) return 'B';
    if (actualGrassrootsPercent >= adjustedThresholds.C) return 'C';
    if (actualGrassrootsPercent >= adjustedThresholds.D) return 'D';
    if (actualGrassrootsPercent >= adjustedThresholds.E) return 'E';
    return 'F';
  }

  // Fallback to standard calculation when enhanced data not available
  return calculateTier(member.grassrootsPercent, member.totalRaised);
}

// Calculate transparency penalty based on proportion of concerning PAC funding
function calculateTransparencyPenalty(member) {
  if (!member.pacContributions?.length || !member.totalRaised) return 0;

  let totalWeightedPACMoney = 0;

  for (const pac of member.pacContributions) {
    // Use transparency weight when committee metadata is available, default to 1.0 when missing
    const weight = (pac.committee_type || pac.designation)
      ? getPACTransparencyWeight(pac.committee_type, pac.designation)
      : 1.0; // Neutral weight for PACs without committee metadata
    const weightedAmount = pac.amount * weight;

    // Only count weighted amounts above baseline (1.0x means neutral)
    if (weight > 1.0) {
      totalWeightedPACMoney += weightedAmount;
    }
    // Candidate committees and good PACs (weight < 1.0) don't contribute to penalty
  }

  // Calculate what % of their total funding is from weighted concerning sources
  const concerningPercent = (totalWeightedPACMoney / member.totalRaised) * 100;

  // Apply penalty: 1 point per 1% of concerning funding, max 15 points
  return Math.min(Math.floor(concerningPercent), 15);
}

// Get adjusted tier thresholds based on transparency penalty
function getAdjustedThresholds(penaltyPoints) {
  return {
    S: 90 + penaltyPoints,  // Need higher grassroots % if you have concerning PACs
    A: 75 + penaltyPoints,
    B: 60 + penaltyPoints,
    C: 45 + penaltyPoints,
    D: 30 + penaltyPoints,
    E: 15 + penaltyPoints
  };
}

// Process and enrich member data with TWO-CALL STRATEGY
// First call: Basic tier data (fast), Second call: Detailed PAC data (slower)
//
// TESTING PARAMETER: Add ?limit=N to process only first N members for testing
// Example: POST /api/update-data?limit=5 processes only 5 members
// Default: undefined (processes all members)
async function processMembers(congressMembers, env, testLimit = undefined) {
  console.log('🔄 Processing member data with two-call strategy...');

  // Load existing data to append to
  let existingMembers = [];
  try {
    const existingData = await env.MEMBER_DATA.get('members:all');
    if (existingData) {
      existingMembers = JSON.parse(existingData);
      console.log(`📊 Found ${existingMembers.length} existing members in storage`);
    }
  } catch (error) {
    console.log('No existing data found, starting fresh');
  }

  // PHASE 1: Basic tier data (fast population)
  console.log('🚀 PHASE 1: Fetching basic tier data for all members...');
  const basicProcessedMembers = [];
  let basicProcessed = 0;
  const BASIC_BATCH_SIZE = 50;

  // Apply test limit if specified (for testing small batches)
  const membersToProcess = testLimit ? congressMembers.slice(0, testLimit) : congressMembers;
  if (testLimit) {
    console.log(`🧪 TEST MODE: Processing only first ${testLimit} members (of ${congressMembers.length} total)`);
  }

  for (const member of membersToProcess) {
    try {
      // Get basic financial data only (no PAC details)
      const financials = await fetchMemberFinancials(member, env);
      const currentCycle = await getElectionCycle();

      const basicMember = {
        bioguideId: member.bioguideId,
        name: member.name,
        party: member.partyName,
        state: member.state,
        district: member.district,
        chamber: (() => {
          // Get most recent term (last item in array, since Congress.gov sorts oldest-first)
          const terms = member.terms?.item;
          if (!terms || terms.length === 0) return 'Unknown';
          const currentTerm = terms[terms.length - 1];
          return currentTerm.chamber === 'House of Representatives' ? 'House' :
                 currentTerm.chamber === 'Senate' ? 'Senate' : 'Unknown';
        })(),

        // Basic financial data
        totalRaised: financials?.totalRaised || 0,
        grassrootsDonations: financials?.grassrootsDonations || 0,
        grassrootsPercent: financials?.grassrootsPercent || 0,
        pacMoney: financials?.pacMoney || 0,
        partyMoney: financials?.partyMoney || 0,
        dataCycle: financials?.dataCycle || currentCycle,

        // Empty PAC details initially (will be filled in Phase 2)
        pacContributions: [],

        // Calculated tier (available immediately)
        tier: calculateTier(financials?.grassrootsPercent || 0, financials?.totalRaised || 0),

        // Metadata
        lastUpdated: new Date().toISOString(),
        pacDetailsStatus: 'pending', // Track PAC detail status
        committeeInfo: financials ? {
          id: financials.committeeId,
          name: financials.committeeName
        } : null
      };

      basicProcessedMembers.push(basicMember);
      basicProcessed++;

      // Incremental update every BASIC_BATCH_SIZE members
      if (basicProcessed % BASIC_BATCH_SIZE === 0) {
        console.log(`📊 Basic batch update: ${basicProcessed}/${congressMembers.length} members`);

        // Merge with existing data (remove duplicates by bioguideId)
        const existingIds = new Set(existingMembers.map(m => m.bioguideId));
        const newMembers = basicProcessedMembers.filter(m => !existingIds.has(m.bioguideId));
        const updatedMembers = [...existingMembers, ...newMembers];

        // Store incremental basic update
        await env.MEMBER_DATA.put('members:all', JSON.stringify(updatedMembers));
        // Update existing for next batch
        existingMembers = updatedMembers;
        console.log(`💾 Basic data saved: ${updatedMembers.length} total members`);
      }

      if (basicProcessed % 5 === 0) {
        console.log(`📊 Basic processing: ${basicProcessed}/${membersToProcess.length} members`);
      }

      // Rate limiting - 4 second delay to stay under FEC 16.67/minute limit (target 15/minute)
      await new Promise(resolve => setTimeout(resolve, 4000));

    } catch (error) {
      console.warn(`Error processing basic data for ${member.name}:`, error.message);
    }
  }

  // Final basic update with any remaining members
  if (basicProcessed % BASIC_BATCH_SIZE !== 0) {
    const existingIds = new Set(existingMembers.map(m => m.bioguideId));
    const newMembers = basicProcessedMembers.filter(m => !existingIds.has(m.bioguideId));
    const finalBasicMembers = [...existingMembers, ...newMembers];
    await env.MEMBER_DATA.put('members:all', JSON.stringify(finalBasicMembers));
    console.log(`💾 Final basic data saved: ${finalBasicMembers.length} total members`);
    existingMembers = finalBasicMembers;
  }

  console.log(`✅ PHASE 1 COMPLETE: Basic tier data for ${basicProcessedMembers.length} members`);

  // PHASE 2: Detailed PAC data (progressive enhancement)
  console.log('🔍 PHASE 2: Fetching detailed PAC data progressively...');
  let pacDetailsProcessed = 0;
  const PAC_BATCH_SIZE = 25; // Increased batch size for PAC details

  for (const basicMember of basicProcessedMembers) {
    try {
      // Only fetch PAC details for members with committee info
      if (basicMember.committeeInfo?.id) {
        console.log(`🔍 Fetching PAC details for ${basicMember.name}...`);
        const pacDetails = await fetchPACDetails(basicMember.committeeInfo.id, env);

        // Update the member in storage with PAC details
        const currentData = await env.MEMBER_DATA.get('members:all');
        if (currentData) {
          const currentMembers = JSON.parse(currentData);
          const memberIndex = currentMembers.findIndex(m => m.bioguideId === basicMember.bioguideId);

          if (memberIndex !== -1) {
            currentMembers[memberIndex].pacContributions = pacDetails;
            currentMembers[memberIndex].pacDetailsStatus = 'complete';
            currentMembers[memberIndex].lastUpdated = new Date().toISOString();
            // NEW: Recalculate tier with enhanced transparency weighting
            currentMembers[memberIndex].tier = calculateEnhancedTier(currentMembers[memberIndex]);

            await env.MEMBER_DATA.put('members:all', JSON.stringify(currentMembers));
            console.log(`✅ PAC details updated for ${basicMember.name}: ${pacDetails.length} contributions`);
          }
        }
      } else {
        console.log(`⚠️ No committee info for ${basicMember.name}, skipping PAC details`);
      }

      pacDetailsProcessed++;

      // Progress update every few members
      if (pacDetailsProcessed % PAC_BATCH_SIZE === 0) {
        console.log(`📊 PAC details: ${pacDetailsProcessed}/${basicProcessedMembers.length} members processed`);
      }

      // Rate limiting - same 4 second delay for PAC API calls
      await new Promise(resolve => setTimeout(resolve, 4000));

    } catch (error) {
      console.warn(`Error fetching PAC details for ${basicMember.name}:`, error.message);
    }
  }

  console.log(`✅ PHASE 2 COMPLETE: PAC details for ${pacDetailsProcessed} members`);
  console.log(`🎉 TWO-CALL STRATEGY COMPLETE: ${basicProcessedMembers.length} members with basic data, ${pacDetailsProcessed} with detailed PAC data`);

  return basicProcessedMembers;
}

// Main data update function
async function updateCongressionalData(env, testLimit = undefined) {
  console.log('🚀 Starting smart batch processing update...');

  // Use smart batch processing instead of bulk processing
  const result = await processSmartBatch(env);

  // Update final timestamp
  await env.MEMBER_DATA.put('last_updated', new Date().toISOString());

  return {
    smartBatch: true,
    callsUsed: result.callsUsed,
    membersProcessed: result.membersProcessed,
    executionTime: result.executionTime,
    lastUpdated: new Date().toISOString()
  };
}

// Calculate enhanced grassroots percentage for display
function calculateEnhancedGrassrootsPercent(member) {
  if (!member.totalRaised || member.totalRaised === 0) return member.grassrootsPercent || 0;

  // Check if we have enhanced PAC data with actual committee metadata
  const hasEnhancedData = member.pacContributions && member.pacContributions.length > 0
    && member.pacContributions.some(pac => pac.committee_type || pac.designation);

  if (hasEnhancedData) {
    // Use enhanced calculation with actual PAC totals
    const actualPACTotal = member.pacContributions.reduce((sum, pac) => sum + pac.amount, 0);
    const actualGrassrootsPercent = Math.round(((member.totalRaised - actualPACTotal) / member.totalRaised) * 100);
    return Math.max(0, actualGrassrootsPercent); // Ensure never negative
  }

  // Fallback to stored FEC grassroots percentage
  return member.grassrootsPercent || 0;
}

// Get grassroots-friendly PAC types summary for display
function getGrassrootsPACTypesSummary(member) {
  if (!member.pacContributions?.length) return null;

  const grassrootsFriendlyTypes = new Set();

  for (const pac of member.pacContributions) {
    const weight = (pac.committee_type || pac.designation)
      ? getPACTransparencyWeight(pac.committee_type, pac.designation)
      : 1.0;

    // Only include PAC types that are grassroots-friendly (weight < 1.0)
    if (weight < 1.0) {
      const category = getCommitteeCategory(pac.committee_type, pac.designation);
      grassrootsFriendlyTypes.add(category);
    }
  }

  return grassrootsFriendlyTypes.size > 0 ? Array.from(grassrootsFriendlyTypes) : null;
}

// API handlers
async function handleSingleMember(env, corsHeaders, url) {
  try {
    const bioguideId = url.pathname.split('/').pop();
    const membersData = await env.MEMBER_DATA.get('members:all');

    if (!membersData) {
      return new Response(JSON.stringify({ error: 'No data available' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(membersData);
    const member = members.find(m => m.bioguideId === bioguideId);

    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Enhance grassroots data for this member
    const grassrootsPACTypes = getGrassrootsPACTypesSummary(member);
    const enhancedMember = {
      ...member,
      grassrootsPercent: calculateEnhancedGrassrootsPercent(member),
      rawFECGrassrootsPercent: member.grassrootsPercent,
      hasEnhancedData: member.pacContributions && member.pacContributions.length > 0
        && member.pacContributions.some(pac => pac.committee_type || pac.designation),
      grassrootsPACTypes: grassrootsPACTypes
    };

    return new Response(JSON.stringify(enhancedMember), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleMembers(env, corsHeaders) {
  try {
    const membersData = await env.MEMBER_DATA.get('members:all');
    const lastUpdated = await env.MEMBER_DATA.get('last_updated');

    if (!membersData) {
      return new Response(JSON.stringify({
        error: 'No data available. Run data update first.',
        members: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(membersData);

    // Enhance grassroots percentage display for members with PAC data
    const enhancedMembers = members.map(member => {
      const grassrootsPACTypes = getGrassrootsPACTypesSummary(member);
      return {
        ...member,
        grassrootsPercent: calculateEnhancedGrassrootsPercent(member),
        rawFECGrassrootsPercent: member.grassrootsPercent, // Keep original for reference
        hasEnhancedData: member.pacContributions && member.pacContributions.length > 0
          && member.pacContributions.some(pac => pac.committee_type || pac.designation),
        grassrootsPACTypes: grassrootsPACTypes // Array of grassroots-friendly PAC types
      };
    });

    return new Response(JSON.stringify({
      members: enhancedMembers,
      lastUpdated,
      total: enhancedMembers.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    throw new Error(`Failed to retrieve members: ${error.message}`);
  }
}

async function handleDataUpdate(env, corsHeaders, request) {
  try {
    // Check for authentication
    const url = new URL(request.url);
    const authKey = url.searchParams.get('key') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = env.UPDATE_SECRET;

    if (!expectedKey) {
      throw new Error('UPDATE_SECRET not configured');
    }

    if (!authKey || authKey !== expectedKey) {
      return new Response(JSON.stringify({
        error: 'Unauthorized - valid API key required'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔄 Manual data update triggered via API');

    // Parse optional limit parameter for testing small batches
    const limitParam = url.searchParams.get('limit');
    const testLimit = limitParam ? parseInt(limitParam, 10) : undefined;

    const result = await updateCongressionalData(env, testLimit);

    return new Response(JSON.stringify({
      success: true,
      message: 'Data update completed',
      ...result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    throw new Error(`Data update failed: ${error.message}`);
  }
}

// Status endpoint for monitoring Worker progress
async function handleStatus(env, corsHeaders) {
  try {
    const membersData = await env.MEMBER_DATA.get('members:all');
    const lastUpdated = await env.MEMBER_DATA.get('last_updated');

    if (!membersData) {
      return new Response(JSON.stringify({
        status: 'no_data',
        message: 'No data available. Run data update first.',
        lastUpdated: null,
        progress: { total: 0, withFinancialData: 0, withPACDetails: 0 }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(membersData);
    const withFinancialData = members.filter(m => m.totalRaised > 0);
    const withPACDetails = members.filter(m => m.pacDetailsStatus === 'complete');

    // Tier breakdown
    const tierCounts = {
      S: members.filter(m => m.tier === 'S').length,
      A: members.filter(m => m.tier === 'A').length,
      B: members.filter(m => m.tier === 'B').length,
      C: members.filter(m => m.tier === 'C').length,
      D: members.filter(m => m.tier === 'D').length,
      'N/A': members.filter(m => m.tier === 'N/A').length
    };

    // Recent updates (last 10 members with financial data by lastUpdated)
    const recentUpdates = withFinancialData
      .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
      .slice(0, 10)
      .map(m => ({
        name: m.name,
        tier: m.tier,
        grassrootsPercent: m.grassrootsPercent,
        lastUpdated: m.lastUpdated
      }));

    return new Response(JSON.stringify({
      status: 'active',
      lastUpdated,
      progress: {
        total: members.length,
        withFinancialData: withFinancialData.length,
        withPACDetails: withPACDetails.length,
        pendingPACDetails: withFinancialData.length - withPACDetails.length
      },
      tierCounts,
      recentUpdates,
      twoCallStrategy: {
        phase1Complete: withFinancialData.length > 0,
        phase2Progress: `${withPACDetails.length}/${withFinancialData.length} complete`
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    throw new Error(`Failed to get status: ${error.message}`);
  }
}

// NEW: Batch FEC Update Handler - processes small batches without Congress.gov calls
async function handleFECBatchUpdate(env, corsHeaders, request) {
  try {
    // Check for authentication
    const url = new URL(request.url);
    const authKey = url.searchParams.get('key') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = env.UPDATE_SECRET;

    if (!authKey || authKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔄 FEC Batch update triggered via API');

    // Get batch size parameter (default: 3, max: 10 for safety)
    const batchSize = Math.min(parseInt(url.searchParams.get('batch') || '3'), 10);

    // Load existing members from storage
    const existingData = await env.MEMBER_DATA.get('members:all');
    if (!existingData) {
      return new Response(JSON.stringify({
        error: 'No existing member data found. Run full update first.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const allMembers = JSON.parse(existingData);
    console.log(`📊 Found ${allMembers.length} existing members`);

    // Get or initialize progress tracking
    let progressData = { lastProcessedIndex: -1, phase: 'financial' };
    try {
      const progressString = await env.MEMBER_DATA.get('batch_progress');
      if (progressString) {
        progressData = JSON.parse(progressString);
      }
    } catch (error) {
      console.log('No progress data found, starting from beginning');
    }

    const { lastProcessedIndex, phase } = progressData;
    let processed = 0;
    let updated = 0;

    console.log(`🔄 Resuming from index ${lastProcessedIndex + 1}, phase: ${phase}`);

    if (phase === 'financial') {
      // Phase 1: Process members without financial data
      const membersNeedingFinancials = allMembers
        .map((member, index) => ({ ...member, originalIndex: index }))
        .filter((member, index) =>
          index > lastProcessedIndex &&
          (!member.totalRaised || member.totalRaised === 0)
        )
        .slice(0, batchSize);

      console.log(`💰 Processing ${membersNeedingFinancials.length} members for financial data`);

      for (const member of membersNeedingFinancials) {
        try {
          console.log(`🔍 Updating financial data for: ${member.name}`);

          // Get fresh financial data
          const financials = await fetchMemberFinancials(member, env);
          const currentCycle = await getElectionCycle();

          if (financials && financials.totalRaised > 0) {
            // Update member with new financial data
            allMembers[member.originalIndex] = {
              ...allMembers[member.originalIndex],
              totalRaised: financials.totalRaised,
              grassrootsDonations: financials.grassrootsDonations,
              grassrootsPercent: financials.grassrootsPercent,
              pacMoney: financials.pacMoney,
              partyMoney: financials.partyMoney,
              committeeId: financials.committeeId, // NEW: Save committee ID for Phase 2
              dataCycle: financials.dataCycle || currentCycle,
              tier: calculateTier(financials.grassrootsPercent, financials.totalRaised),
              lastUpdated: new Date().toISOString()
            };
            updated++;
            console.log(`✅ Updated financial data for ${member.name}: $${financials.totalRaised.toLocaleString()}`);
          }

          processed++;
          progressData.lastProcessedIndex = member.originalIndex;

          // Save progress incrementally
          await env.MEMBER_DATA.put('batch_progress', JSON.stringify(progressData));
          await env.MEMBER_DATA.put('members:all', JSON.stringify(allMembers));

        } catch (error) {
          console.warn(`Error updating ${member.name}:`, error.message);
        }
      }

      // Check if we need to move to PAC phase
      const remainingFinancial = allMembers.filter((member, index) =>
        index > progressData.lastProcessedIndex &&
        (!member.totalRaised || member.totalRaised === 0)
      );

      // Cycle to PAC phase either when:
      // 1. All financial data complete, OR
      // 2. We've processed our batch (cycle phases to respect rate limits)
      if (remainingFinancial.length === 0 || processed >= batchSize) {
        console.log(`🔄 Cycling from financial to PAC phase (${processed} processed, ${remainingFinancial.length} remaining financial)`);
        progressData.phase = 'pac';
        progressData.lastProcessedIndex = -1;
        await env.MEMBER_DATA.put('batch_progress', JSON.stringify(progressData));
      }

    } else if (phase === 'pac') {
      // Phase 2: Process members needing PAC details
      const membersNeedingPAC = allMembers
        .map((member, index) => ({ ...member, originalIndex: index }))
        .filter((member, index) =>
          index > lastProcessedIndex &&
          member.totalRaised > 0 &&
          (!member.pacDetailsStatus || member.pacDetailsStatus !== 'complete')
        )
        .slice(0, batchSize);

      console.log(`🏛️ Processing ${membersNeedingPAC.length} members for PAC details`);

      for (const member of membersNeedingPAC) {
        try {
          console.log(`🔍 Updating PAC details for: ${member.name}`);

          // Get PAC details if member has financial data
          if (member.committeeId) {
            const pacDetails = await fetchPACDetails(member.committeeId, env);

            if (pacDetails && pacDetails.length > 0) {
              // Update member with PAC details
              allMembers[member.originalIndex] = {
                ...allMembers[member.originalIndex],
                pacContributions: pacDetails,
                pacDetailsStatus: 'complete',
                lastUpdated: new Date().toISOString()
              };
              // NEW: Recalculate tier with enhanced transparency weighting
              allMembers[member.originalIndex].tier = calculateEnhancedTier(allMembers[member.originalIndex]);
              updated++;
              console.log(`✅ Updated PAC details for ${member.name}: ${pacDetails.length} contributions`);
            }
          }

          processed++;
          progressData.lastProcessedIndex = member.originalIndex;

          // Save progress incrementally
          await env.MEMBER_DATA.put('batch_progress', JSON.stringify(progressData));
          await env.MEMBER_DATA.put('members:all', JSON.stringify(allMembers));

        } catch (error) {
          console.warn(`Error updating PAC details for ${member.name}:`, error.message);
        }
      }

      // Check if PAC phase is complete
      const remainingPAC = allMembers.filter((member, index) =>
        index > progressData.lastProcessedIndex &&
        member.totalRaised > 0 &&
        (!member.pacDetailsStatus || member.pacDetailsStatus !== 'complete')
      );

      // Cycle back to financial phase either when:
      // 1. All PAC processing complete, OR
      // 2. We've processed our batch (cycle phases to respect rate limits)
      if (remainingPAC.length === 0 || processed >= batchSize) {
        console.log(`🔄 Cycling from PAC to financial phase (${processed} processed, ${remainingPAC.length} remaining PAC)`);
        progressData.phase = 'financial';
        progressData.lastProcessedIndex = -1;
        await env.MEMBER_DATA.put('batch_progress', JSON.stringify(progressData));
      }
    }

    // Update last updated timestamp
    await env.MEMBER_DATA.put('last_updated', new Date().toISOString());

    const response = {
      success: true,
      message: `FEC batch update completed`,
      batchSize,
      processed,
      updated,
      phase: progressData.phase,
      nextIndex: progressData.lastProcessedIndex + 1,
      totalMembers: allMembers.length,
      lastUpdated: new Date().toISOString()
    };

    console.log(`✅ Batch complete: ${processed} processed, ${updated} updated`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('FEC batch update failed:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Test endpoint to force enhanced PAC processing on specific member
async function handleTestMember(env, corsHeaders, request) {
  try {
    const url = new URL(request.url);
    const bioguideId = url.searchParams.get('bioguideId');

    if (!bioguideId) {
      return new Response(JSON.stringify({ error: 'bioguideId parameter required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get current member data
    const currentData = await env.MEMBER_DATA.get('members:all');
    if (!currentData) {
      return new Response(JSON.stringify({ error: 'No member data found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(currentData);
    const member = members.find(m => m.bioguideId === bioguideId);

    if (!member) {
      return new Response(JSON.stringify({ error: `Member ${bioguideId} not found` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!member.candidateId) {
      return new Response(JSON.stringify({ error: `Member ${bioguideId} has no candidateId` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🧪 Testing enhanced PAC processing for ${member.name} (${bioguideId})`);

    // Force enhanced PAC details processing
    const enhancedPACDetails = await fetchPACDetails(member.candidateId, env);

    // Update member with enhanced data
    const memberIndex = members.findIndex(m => m.bioguideId === bioguideId);
    members[memberIndex] = {
      ...members[memberIndex],
      pacContributions: enhancedPACDetails,
      pacDetailsStatus: 'complete',
      lastUpdated: new Date().toISOString(),
      tier: calculateEnhancedTier({ ...members[memberIndex], pacContributions: enhancedPACDetails })
    };

    // Save updated data
    await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

    return new Response(JSON.stringify({
      success: true,
      member: members[memberIndex],
      enhancedPACCount: enhancedPACDetails.filter(p => p.committee_type).length,
      message: `Enhanced PAC processing completed for ${member.name}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Test member processing failed:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// NEW: HTTP handler for manual smart batch testing
async function handleSmartBatch(env, corsHeaders, request) {
  try {
    // Check for authorization
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = `Bearer ${env.UPDATE_SECRET || 'taskforce_purple_2025_update'}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔄 Manual smart batch processing triggered...');
    const result = await processSmartBatch(env);

    return new Response(JSON.stringify({
      success: true,
      message: 'Smart batch processing completed',
      result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Smart batch processing failed:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Helper function to perform tier recalculation (without HTTP handling)
async function performTierRecalculation(env) {
  // Get all member data from storage
  const currentData = await env.MEMBER_DATA.get('members:all');
  if (!currentData) {
    throw new Error('No member data found');
  }

  const members = JSON.parse(currentData);
  let recalculated = 0;
  let unchanged = 0;
  let errors = 0;

  // Process each member
  for (let i = 0; i < members.length; i++) {
    const member = members[i];

    try {
      // Only recalculate if member has financial data
      if (!member.totalRaised || member.totalRaised === 0) {
        continue;
      }

      // Calculate new tier using enhanced logic
      const oldTier = member.tier;
      const newTier = calculateEnhancedTier(member);

      // Recalculate grassrootsPercent to match tier calculation
      const newGrassrootsPercent = member.totalRaised > 0
        ? Math.round((member.grassrootsDonations / member.totalRaised) * 100)
        : 0;

      // Update tier if it changed
      if (oldTier !== newTier) {
        members[i] = {
          ...member,
          tier: newTier,
          grassrootsPercent: newGrassrootsPercent,
          lastTierRecalculated: new Date().toISOString()
        };
        recalculated++;
      } else {
        unchanged++;
      }

    } catch (error) {
      console.error(`❌ Error processing ${member.name} (${member.bioguideId}):`, error);
      errors++;
    }
  }

  // Save updated data back to storage
  await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

  return {
    totalMembers: members.length,
    recalculated,
    unchanged,
    errors,
    completedAt: new Date().toISOString()
  };
}

// NEW: Handler for recalculating tiers for all members with existing data
async function handleRecalculateTiers(env, corsHeaders, request) {
  try {
    // Check for authorization
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = `Bearer ${env.UPDATE_SECRET || 'taskforce_purple_2025_update'}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔄 Starting tier recalculation for all members...');

    const stats = await performTierRecalculation(env);

    const response = {
      success: true,
      message: 'Tier recalculation completed',
      stats
    };

    console.log('🎯 Tier recalculation completed:', response.stats);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Tier recalculation failed:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Process specific candidate by name or bioguideId
async function handleProcessCandidate(env, corsHeaders, request) {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    const bioguideId = url.searchParams.get('bioguideId');

    if (!name && !bioguideId) {
      return new Response(JSON.stringify({
        error: 'Either name or bioguideId parameter required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🎯 Processing specific candidate: ${name || bioguideId}`);

    // Get current member data
    const currentData = await env.MEMBER_DATA.get('members:all');
    if (!currentData) {
      return new Response(JSON.stringify({
        error: 'No member data found in storage'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(currentData);
    let targetMember = null;

    // Find the member by name or bioguideId
    if (bioguideId) {
      targetMember = members.find(m => m.bioguideId === bioguideId);
    } else if (name) {
      // Try exact match first, then partial match
      targetMember = members.find(m =>
        m.name.toLowerCase() === name.toLowerCase() ||
        m.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(m.name.toLowerCase().split(',')[0])
      );
    }

    if (!targetMember) {
      return new Response(JSON.stringify({
        error: `Member not found: ${name || bioguideId}`,
        suggestion: 'Try searching with full name format: "LastName, FirstName" or exact bioguideId'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`✅ Found member: ${targetMember.name} (${targetMember.bioguideId})`);

    // Get member's chamber info for FEC processing
    const chamberType = targetMember.chamber === 'House' ? 'House of Representatives' : 'Senate';

    // Process the member through the full FEC pipeline
    const memberIndex = members.findIndex(m => m.bioguideId === targetMember.bioguideId);
    const originalMember = { ...targetMember };

    try {
      // Step 1: Get financial data from FEC
      console.log(`💰 Fetching FEC financial data for ${targetMember.name}...`);
      const financials = await fetchMemberFinancials(targetMember, env);
      // Apply financial data to target member
      Object.assign(targetMember, financials);

      // Step 2: Get PAC details if they have financial data
      if (targetMember.totalRaised > 0) {
        console.log(`🏛️ Fetching PAC details for ${targetMember.name}...`);
        await fetchPACDetails(targetMember, env);

        // Step 3: Calculate enhanced tier
        const newTier = calculateEnhancedTier(targetMember);
        targetMember.tier = newTier;
        targetMember.lastProcessed = new Date().toISOString();
        targetMember.processingStatus = 'complete';

        console.log(`🎯 Updated tier for ${targetMember.name}: ${newTier}`);
      }

      // Update the member in the array
      members[memberIndex] = targetMember;

      // Save updated data
      await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

      const response = {
        success: true,
        member: {
          name: targetMember.name,
          bioguideId: targetMember.bioguideId,
          state: targetMember.state,
          chamber: targetMember.chamber,
          tier: targetMember.tier,
          grassrootsPercent: targetMember.grassrootsPercent,
          totalRaised: targetMember.totalRaised,
          pacCount: targetMember.pacContributions?.length || 0,
          processingStatus: targetMember.processingStatus,
          lastProcessed: targetMember.lastProcessed
        },
        changes: {
          tierChanged: originalMember.tier !== targetMember.tier,
          financialDataAdded: originalMember.totalRaised === 0 && targetMember.totalRaised > 0,
          oldTier: originalMember.tier,
          newTier: targetMember.tier
        }
      };

      console.log(`✅ Successfully processed ${targetMember.name}`);

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (processingError) {
      console.error(`❌ Error processing ${targetMember.name}:`, processingError);

      return new Response(JSON.stringify({
        error: `Processing failed for ${targetMember.name}: ${processingError.message}`,
        member: {
          name: targetMember.name,
          bioguideId: targetMember.bioguideId,
          state: targetMember.state,
          chamber: targetMember.chamber
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Process candidate failed:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Individual Member Update Endpoint: /api/update-member/@username
async function handleIndividualMemberUpdate(env, corsHeaders, request) {
  try {
    // Check for authentication
    const url = new URL(request.url);
    const authKey = url.searchParams.get('key') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = env.UPDATE_SECRET;

    if (!expectedKey) {
      throw new Error('UPDATE_SECRET not configured');
    }

    if (!authKey || authKey !== expectedKey) {
      return new Response(JSON.stringify({
        error: 'Unauthorized - valid API key required'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract username from URL path
    const username = url.pathname.replace('/api/update-member/@', '');

    if (!username) {
      return new Response(JSON.stringify({
        error: 'Username required - use format /api/update-member/@username'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🎯 Individual member update requested for: @${username}`);

    // Get or create social handle mapping
    const handleMap = await getOrCreateSocialHandleMapping(env);

    // Look up bioguide ID from handle, or use directly if it looks like a bioguide ID
    let bioguideId = handleMap[username.toLowerCase()];

    // If not found in handle mapping, check if it's already a bioguide ID pattern (letter followed by 6 digits)
    if (!bioguideId && /^[A-Z]\d{6}$/.test(username.toUpperCase())) {
      bioguideId = username.toUpperCase();
      console.log(`🔧 Using ${username} as direct bioguide ID (not found in social handle mapping)`);
    }

    if (!bioguideId) {
      return new Response(JSON.stringify({
        error: `No member found for handle @${username}`,
        suggestion: 'Try updating social handle mapping first, or use bioguide ID format (e.g., G000386)'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`✅ Found bioguide ID ${bioguideId} for @${username}`);

    // Get current members data
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) {
      throw new Error('No members data found. Run full update first.');
    }

    const members = JSON.parse(membersData);
    const memberIndex = members.findIndex(m => m.bioguideId === bioguideId);

    if (memberIndex === -1) {
      return new Response(JSON.stringify({
        error: `Member with bioguide ID ${bioguideId} not found in current data`
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const member = members[memberIndex];
    console.log(`🔄 Updating ${member.name} (${member.chamber} - ${member.state})`);

    // Run full pipeline on this specific member
    const updatedMember = await updateSingleMember(member, env);

    if (updatedMember) {
      // Update the member in storage
      members[memberIndex] = updatedMember;
      await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

      console.log(`✅ Successfully updated ${updatedMember.name}`);

      return new Response(JSON.stringify({
        success: true,
        member: updatedMember,
        message: `Successfully updated ${updatedMember.name}`,
        tier: updatedMember.tier,
        totalRaised: updatedMember.totalRaised,
        grassrootsPercent: updatedMember.grassrootsPercent,
        pacContributions: updatedMember.pacContributions?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      throw new Error(`Failed to update member data for ${member.name}`);
    }

  } catch (error) {
    console.error('Individual member update failed:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Function to update a single member through the full pipeline
async function updateSingleMember(member, env) {
  try {
    // Phase 1: Update financial data
    console.log(`💰 Phase 1: Updating financial data for ${member.name}...`);

    const financialData = await fetchMemberFinancials(member, env);
    if (!financialData) {
      throw new Error(`Failed to fetch FEC financial data for ${member.name}. Member may not have an active FEC committee or name matching failed.`);
    }

    member.totalRaised = financialData.totalRaised;
    member.grassrootsDonations = financialData.grassrootsDonations;
    member.largeDonorDonations = financialData.largeDonorDonations;
    member.grassrootsPercent = financialData.grassrootsPercent;
    member.pacMoney = financialData.pacMoney;
    member.partyMoney = financialData.partyMoney;
    member.committeeId = financialData.committeeId;
    member.lastUpdated = new Date().toISOString();

    console.log(`✅ Financial data updated: $${member.totalRaised.toLocaleString()} raised, ${member.grassrootsPercent}% grassroots`);

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

        console.log(`✅ PAC data updated: ${pacDetails.length} contributions, $${member.pacMoney.toLocaleString()} total`);
      }
    }

    // Recalculate tier with enhanced algorithm
    member.tier = calculateEnhancedTier(member);

    // Recalculate grassrootsPercent to match tier calculation
    if (member.totalRaised > 0) {
      member.grassrootsPercent = Math.round((member.grassrootsDonations / member.totalRaised) * 100);
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
    const response = await fetch('https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-social-media.yaml');

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
      'aoc': 'O000172',        // Alexandria Ocasio-Cortez -> @repaoc
      'bernie': 'S000033',     // Bernie Sanders
      'warren': 'W000817',     // Elizabeth Warren
      'ted': 'C001098',        // Ted Cruz
      'marco': 'R000595'       // Marco Rubio
    };

    let aliasCount = 0;
    for (const [alias, bioguide] of Object.entries(aliases)) {
      if (!handleMapping[alias]) {  // Don't overwrite existing handles
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
      totalMapped: mappedCount
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

    return new Response(JSON.stringify({
      handles: handleMap,
      count: handleCount,
      description: "Available social handles for individual member updates via /api/update-member/@handle",
      examples: [
        "/api/update-member/@aoc",
        "/api/update-member/@repjasmine",
        "/api/update-member/@senatorhassan"
      ]
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching social handles:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch social handles',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Force refresh social handle mapping (requires authorization)
async function handleRefreshSocialHandles(env, corsHeaders, request) {
  try {
    // Check authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== 'taskforce_purple_2025_update') {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔄 Force refreshing social handle mapping...');

    // Delete existing cache to force refresh
    await env.MEMBER_DATA.delete('social_handle_mapping');

    // Get fresh mapping (this will rebuild with aliases)
    const handles = await getOrCreateSocialHandleMapping(env);

    return new Response(JSON.stringify({
      success: true,
      message: 'Social handle mapping refreshed',
      count: Object.keys(handles).length,
      aliases: {
        aoc: handles.aoc || null,
        bernie: handles.bernie || null,
        warren: handles.warren || null,
        ted: handles.ted || null,
        marco: handles.marco || null
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error refreshing social handles:', error);
    return new Response(JSON.stringify({
      error: 'Failed to refresh social handles',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
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
    if (trimmed.startsWith('#') || trimmed === '') continue;

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

    if (!currentEntry) continue;

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

    if (currentIndent === indentLevel + 4 && trimmed.includes(':') && !['bioguide', 'thomas', 'govtrack'].includes(trimmed.split(':')[0].trim())) {
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

// Main smart batch processing function
async function processSmartBatch(env) {
  const startTime = Date.now();
  const callBudget = 15; // FEC limit: 1,000/hour. Our usage: 60/hour (94% under limit)
  const maxMembersPerRun = 1; // CRITICAL: Cloudflare has ~50 subrequest limit. 1 member = ~10-15 subrequests
  let callsUsed = 0;
  let membersProcessed = [];

  try {
    console.log('📊 Starting smart batch processing...');

    // Initialize or get existing processing queues
    await initializeProcessingQueues(env);

    // Get run counter for round-robin scheduling (define at function scope)
    const statusData = await env.MEMBER_DATA.get('processing_status');
    const status = statusData ? JSON.parse(statusData) : {};
    const runCount = status.runCount || 0;

    // PRIORITY: Phase 0 - Reconcile FEC mapping mismatches FIRST
    const mismatchQueue = await getMismatchQueue(env);
    console.log(`🔧 FEC Mismatch queue: ${mismatchQueue.length} members to reconcile`);

    // Mixed batch processing: prioritize mismatches, then alternate between Phase 1 and Phase 2
    const phase1Queue = await getPhase1Queue(env);
    const phase2Queue = await getPhase2Queue(env);
    console.log(`📋 Phase 1 queue: ${phase1Queue.length} members remaining`);
    console.log(`📋 Phase 2 queue: ${phase2Queue.length} members remaining`);

    // PRIORITY PROCESSING: Mismatches first, then regular phases
    while ((mismatchQueue.length > 0 || phase1Queue.length > 0 || phase2Queue.length > 0) &&
           callsUsed < callBudget && membersProcessed.length < maxMembersPerRun) {

      // FIRST PRIORITY: Process mismatch reconciliation (highest priority)
      if (mismatchQueue.length > 0 && callsUsed + 3 <= callBudget) {
        const member = mismatchQueue.shift();
        try {
          console.log(`🔧 Reconciling FEC mismatch: ${member.name}`);
          await reconcileFECMismatch(member, env);
          callsUsed += 3; // FEC lookup uses ~3 calls
          membersProcessed.push({name: member.name, phase: 'mismatch', status: 'reconciled'});
          await updateMismatchQueue(env, mismatchQueue);
        } catch (error) {
          console.warn(`⚠️ Mismatch reconciliation failed for ${member.name}:`, error.message);
          membersProcessed.push({name: member.name, phase: 'mismatch', status: 'failed'});
        }
        continue; // Process another mismatch if budget allows
      }

      // CPU LIMIT PROTECTION: Process only ONE member per run
      // Use round-robin: 3 Phase 1, then 1 Phase 2 (75% Phase 1, 25% Phase 2)
      // This keeps Phase 2 progressing while prioritizing Phase 1 backlog
      const shouldProcessPhase2 = (runCount % 4 === 3) && phase2Queue.length > 0;

      if (!shouldProcessPhase2 && phase1Queue.length > 0 && callsUsed + 3 <= callBudget) {
        // PHASE 1 processing (3 out of 4 runs)
        const member = phase1Queue.shift();
        try {
          console.log(`💰 Processing Phase 1: ${member.name}`);
          const financials = await fetchMemberFinancials(member, env);
          await updateMemberWithPhase1Data(member, financials, env);

          callsUsed += 3;
          membersProcessed.push({name: member.name, phase: 1, status: 'success'});

          // Update queue after successful processing
          await updatePhase1Queue(env, phase1Queue);

        } catch (error) {
          console.warn(`⚠️ Phase 1 failed for ${member.name}:`, error.message);
          membersProcessed.push({name: member.name, phase: 1, status: 'failed', error: error.message});

          // Check for rate limiting scenarios
          if (error.message.includes('Too many subrequests')) {
            console.log('🛑 Cloudflare subrequest limit detected, stopping batch processing');
            break;
          }

          // Check for 503 Service Unavailable (API rate limiting)
          if (error.message.includes('503') || error.message.includes('Service Unavailable') ||
              error.message.includes('rate limit') || error.message.includes('Rate limit')) {
            console.log('🛑 API rate limit (503) detected, stopping batch processing');
            break;
          }

          // Check for 429 Too Many Requests
          if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
            console.log('🛑 HTTP 429 rate limit detected, stopping batch processing');
            break;
          }
        }

      } else if (phase2Queue.length > 0 && callsUsed + 4 <= callBudget) {
        // PHASE 2 processing (1 out of 4 runs, or when Phase 1 is empty)
        const member = phase2Queue.shift();
        try {
          console.log(`🏛️ Processing Phase 2: ${member.name}`);
          await enhanceMemberWithPACData(member, env);

          callsUsed += 4; // Average PAC enhancement calls
          membersProcessed.push({name: member.name, phase: 2, status: 'success'});

          // Update queue after successful processing
          await updatePhase2Queue(env, phase2Queue);

        } catch (error) {
          console.warn(`⚠️ Phase 2 failed for ${member.name}:`, error.message);
          membersProcessed.push({name: member.name, phase: 2, status: 'failed', error: error.message});

          // Check for rate limiting scenarios
          if (error.message.includes('Too many subrequests')) {
            console.log('🛑 Cloudflare subrequest limit detected, stopping batch processing');
            break;
          }

          // Check for 503 Service Unavailable (API rate limiting)
          if (error.message.includes('503') || error.message.includes('Service Unavailable') ||
              error.message.includes('rate limit') || error.message.includes('Rate limit')) {
            console.log('🛑 API rate limit (503) detected, stopping batch processing');
            break;
          }

          // Check for 429 Too Many Requests
          if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
            console.log('🛑 HTTP 429 rate limit detected, stopping batch processing');
            break;
          }
        }
      }
    }

    // Update processing status (increment run counter for round-robin)
    await updateProcessingStatus(env, {
      callsUsed,
      membersProcessed: membersProcessed.length,
      lastRun: new Date().toISOString(),
      executionTime: Date.now() - startTime,
      runCount: runCount + 1
    });

    // Auto-recalculate tiers if any members were processed to keep frontend updated
    let tierRecalcStats = null;
    if (membersProcessed.length > 0) {
      try {
        console.log('🔄 Auto-triggering tier recalculation after batch processing...');
        tierRecalcStats = await performTierRecalculation(env);
        console.log(`✅ Tier recalculation complete: ${tierRecalcStats.recalculated} updated, ${tierRecalcStats.unchanged} unchanged`);
      } catch (error) {
        console.warn('⚠️ Tier recalculation failed after batch processing:', error.message);
      }
    }

    console.log(`📊 Smart batch summary: ${callsUsed}/${callBudget} API calls, ${membersProcessed.length} members processed`);

    return {
      callsUsed,
      membersProcessed: membersProcessed.length,
      members: membersProcessed,
      remainingBudget: callBudget - callsUsed,
      executionTime: Date.now() - startTime,
      tierRecalculation: tierRecalcStats
    };

  } catch (error) {
    console.error('❌ Smart batch processing error:', error);
    throw error;
  }
}

// Initialize processing queues from current member data
async function initializeProcessingQueues(env) {
  try {
    // Check if queues already exist
    const existingPhase1 = await env.MEMBER_DATA.get('processing_queue_phase1');
    const existingPhase2 = await env.MEMBER_DATA.get('processing_queue_phase2');

    if (existingPhase1 && existingPhase2) {
      console.log('📋 Processing queues already initialized');
      return;
    }

    console.log('🔄 Initializing processing queues from current data...');

    // Get all current members
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) {
      console.log('⚠️ No member data found, fetching from Congress API...');
      const congressMembers = await fetchCongressMembers(env);

      // Create Phase 1 queue with all members
      const phase1Queue = congressMembers.map(member => ({
        bioguideId: member.bioguideId,
        name: member.name,
        state: member.state,
        district: member.district,
        party: member.partyName
      }));

      await env.MEMBER_DATA.put('processing_queue_phase1', JSON.stringify(phase1Queue));
      await env.MEMBER_DATA.put('processing_queue_phase2', JSON.stringify([]));

      console.log(`✅ Initialized queues: ${phase1Queue.length} members in Phase 1, 0 in Phase 2`);
      return;
    }

    const members = JSON.parse(membersData);
    const phase1Queue = [];
    const phase2Queue = [];

    for (const member of members) {
      if (member.totalRaised === 0 || member.totalRaised === null) {
        // Needs Phase 1 (financial data)
        phase1Queue.push({
          bioguideId: member.bioguideId,
          name: member.name,
          state: member.state,
          district: member.district,
          party: member.party
        });
      } else if (member.pacContributions.length === 0 ||
                 !member.pacContributions.some(pac => pac.committee_type)) {
        // Has financial data but needs Phase 2 (PAC enhancement)
        phase2Queue.push({
          bioguideId: member.bioguideId,
          name: member.name,
          state: member.state,
          district: member.district,
          party: member.party,
          committeeId: member.committeeInfo?.id
        });
      }
    }

    await env.MEMBER_DATA.put('processing_queue_phase1', JSON.stringify(phase1Queue));
    await env.MEMBER_DATA.put('processing_queue_phase2', JSON.stringify(phase2Queue));

    console.log(`✅ Initialized queues: ${phase1Queue.length} members in Phase 1, ${phase2Queue.length} in Phase 2`);

  } catch (error) {
    console.error('❌ Error initializing processing queues:', error);
    throw error;
  }
}

// Get Phase 1 processing queue
async function getPhase1Queue(env) {
  try {
    const queueData = await env.MEMBER_DATA.get('processing_queue_phase1');
    return queueData ? JSON.parse(queueData) : [];
  } catch (error) {
    console.error('Error getting Phase 1 queue:', error);
    return [];
  }
}

// Get Phase 2 processing queue
async function getPhase2Queue(env) {
  try {
    const queueData = await env.MEMBER_DATA.get('processing_queue_phase2');
    return queueData ? JSON.parse(queueData) : [];
  } catch (error) {
    console.error('Error getting Phase 2 queue:', error);
    return [];
  }
}

// Update Phase 1 queue after processing
async function updatePhase1Queue(env, updatedQueue) {
  try {
    await env.MEMBER_DATA.put('processing_queue_phase1', JSON.stringify(updatedQueue));
  } catch (error) {
    console.error('Error updating Phase 1 queue:', error);
  }
}

// Update Phase 2 queue after processing
async function updatePhase2Queue(env, updatedQueue) {
  try {
    await env.MEMBER_DATA.put('processing_queue_phase2', JSON.stringify(updatedQueue));
  } catch (error) {
    console.error('Error updating Phase 2 queue:', error);
  }
}

// =============================================================================
// FEC MISMATCH DETECTION AND RECONCILIATION SYSTEM
// =============================================================================

// Get FEC mismatch queue - identifies members with potential mapping issues
async function getMismatchQueue(env) {
  try {
    const queueData = await env.MEMBER_DATA.get('processing_queue_mismatch');
    if (queueData) {
      return JSON.parse(queueData);
    }

    // First time - scan for potential mismatches
    console.log('🔍 Scanning for FEC mapping mismatches...');
    const mismatchQueue = await scanForFECMismatches(env);
    await env.MEMBER_DATA.put('processing_queue_mismatch', JSON.stringify(mismatchQueue));
    return mismatchQueue;
  } catch (error) {
    console.error('Error getting mismatch queue:', error);
    return [];
  }
}

// Update mismatch queue after processing
async function updateMismatchQueue(env, updatedQueue) {
  try {
    await env.MEMBER_DATA.put('processing_queue_mismatch', JSON.stringify(updatedQueue));
  } catch (error) {
    console.error('Error updating mismatch queue:', error);
  }
}

// Scan current members for potential FEC mapping mismatches
async function scanForFECMismatches(env) {
  const mismatchQueue = [];

  try {
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) return mismatchQueue;

    const members = JSON.parse(membersData);

    for (const member of members) {
      // Check for potential mismatches:
      // 1. Members with $0 raised despite being well-known senators
      // 2. Committee IDs that don't match chamber (House vs Senate)
      // 3. Common names that might be mixed up

      const isHighProfileSenator = member.chamber === 'Senate' && member.totalRaised === 0;
      const hasWrongCommitteePattern = (
        (member.chamber === 'Senate' && member.committeeInfo?.id && !member.committeeInfo.id.startsWith('S')) ||
        (member.chamber === 'House' && member.committeeInfo?.id && !member.committeeInfo.id.startsWith('H'))
      );
      const hasCommonName = ['Graham', 'Johnson', 'Smith', 'Brown', 'Miller', 'Wilson', 'Davis', 'Garcia'].some(name =>
        member.name.includes(name)
      );

      if (isHighProfileSenator || hasWrongCommitteePattern || (hasCommonName && member.totalRaised === 0)) {
        mismatchQueue.push({
          bioguideId: member.bioguideId,
          name: member.name,
          state: member.state,
          chamber: member.chamber,
          party: member.party,
          currentCommitteeId: member.committeeInfo?.id,
          reason: isHighProfileSenator ? 'high-profile-zero' :
                  hasWrongCommitteePattern ? 'wrong-committee-pattern' : 'common-name-zero'
        });
      }
    }

    console.log(`🔍 Found ${mismatchQueue.length} potential FEC mismatches to reconcile`);
    return mismatchQueue;

  } catch (error) {
    console.error('Error scanning for mismatches:', error);
    return mismatchQueue;
  }
}

// Reconcile a specific FEC mapping mismatch
async function reconcileFECMismatch(member, env) {
  try {
    console.log(`🔧 Reconciling FEC mapping for ${member.name} (${member.reason})`);

    // Clear existing cached mapping to force fresh lookup
    const cacheKey = `fec_mapping_${member.bioguideId}`;
    await env.MEMBER_DATA.delete(cacheKey);

    // Force fresh FEC lookup with improved validation
    const financials = await fetchMemberFinancials(member, env);

    // DEBUG: Log detailed financials response
    console.log(`🔍 DEBUG: fetchMemberFinancials returned for ${member.name}:`, JSON.stringify(financials, null, 2));

    if (financials && financials.totalRaised > 0) {
      console.log(`✅ Reconciled ${member.name}: Found correct FEC data with $${financials.totalRaised}`);

      // Update the member data immediately
      await updateMemberWithPhase1Data(member, financials, env);

      return true;
    } else {
      console.warn(`⚠️ Still no FEC data found for ${member.name} after reconciliation`);
      console.log(`🔍 DEBUG: Financials was ${financials ? 'truthy' : 'falsy'}, totalRaised: ${financials?.totalRaised}`);
      return false;
    }

  } catch (error) {
    console.error(`❌ Failed to reconcile FEC mapping for ${member.name}:`, error);
    throw error;
  }
}

// Update member with Phase 1 data and move to Phase 2 queue if successful
async function updateMemberWithPhase1Data(member, financials, env) {
  try {
    // Get existing members data
    const membersData = await env.MEMBER_DATA.get('members:all');
    const members = membersData ? JSON.parse(membersData) : [];
    const currentCycle = await getElectionCycle();

    // Find and update the member
    const memberIndex = members.findIndex(m => m.bioguideId === member.bioguideId);
    if (memberIndex === -1) {
      // Add new member
      const newMember = {
        bioguideId: member.bioguideId,
        name: member.name,
        party: member.party,
        state: member.state,
        district: member.district,
        chamber: member.chamber || 'Unknown',
        totalRaised: financials?.totalRaised || 0,
        grassrootsDonations: financials?.grassrootsDonations || 0,
        grassrootsPercent: financials?.grassrootsPercent || 0,
        pacMoney: financials?.pacMoney || 0,
        partyMoney: financials?.partyMoney || 0,
        dataCycle: financials?.dataCycle || currentCycle,
        pacContributions: [],
        tier: calculateTier(financials?.grassrootsPercent || 0, financials?.totalRaised || 0),
        lastUpdated: new Date().toISOString(),
        committeeInfo: financials?.committeeId ? { id: financials.committeeId } : null
      };
      members.push(newMember);
    } else {
      // Update existing member
      members[memberIndex] = {
        ...members[memberIndex],
        totalRaised: financials?.totalRaised || 0,
        grassrootsDonations: financials?.grassrootsDonations || 0,
        grassrootsPercent: financials?.grassrootsPercent || 0,
        pacMoney: financials?.pacMoney || 0,
        partyMoney: financials?.partyMoney || 0,
        dataCycle: financials?.dataCycle || currentCycle,
        tier: calculateTier(financials?.grassrootsPercent || 0, financials?.totalRaised || 0),
        lastUpdated: new Date().toISOString(),
        committeeInfo: financials?.committeeId ? { id: financials.committeeId } : null
      };
    }

    // Save updated members data
    await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

    // If successful and has committee ID, add to Phase 2 queue
    if (financials?.committeeId) {
      const phase2Queue = await getPhase2Queue(env);
      phase2Queue.push({
        bioguideId: member.bioguideId,
        name: member.name,
        state: member.state,
        district: member.district,
        party: member.party,
        committeeId: financials.committeeId
      });
      await updatePhase2Queue(env, phase2Queue);
      console.log(`➡️ Moved ${member.name} to Phase 2 queue`);
    }

  } catch (error) {
    console.error(`Error updating member ${member.name} with Phase 1 data:`, error);
    throw error;
  }
}

// Enhance member with PAC data (existing function integration)
async function enhanceMemberWithPACData(member, env) {
  try {
    // Get existing members data
    const membersData = await env.MEMBER_DATA.get('members:all');
    const members = membersData ? JSON.parse(membersData) : [];

    // Find the member
    const memberIndex = members.findIndex(m => m.bioguideId === member.bioguideId);
    if (memberIndex === -1) {
      throw new Error(`Member ${member.name} not found for Phase 2 processing`);
    }

    const targetMember = members[memberIndex];

    // Use existing PAC enhancement logic
    if (targetMember.committeeInfo?.id || member.committeeId) {
      const committeeId = targetMember.committeeInfo?.id || member.committeeId;
      console.log(`📊 Fetching PAC details for committee: ${committeeId}`);

      const pacContributions = await fetchPACDetails(committeeId, env);
      targetMember.pacContributions = pacContributions;

      // Recalculate tier with enhanced data
      targetMember.tier = calculateEnhancedTier(targetMember);
      targetMember.lastUpdated = new Date().toISOString();

      // Save updated data
      members[memberIndex] = targetMember;
      await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

      console.log(`✅ Enhanced ${member.name} with ${pacContributions.length} PAC contributions`);
    }

  } catch (error) {
    console.error(`Error enhancing member ${member.name} with PAC data:`, error);
    throw error;
  }
}

// Update processing status for monitoring
async function updateProcessingStatus(env, stats) {
  try {
    const status = {
      lastRun: stats.lastRun,
      callsUsed: stats.callsUsed,
      membersProcessed: stats.membersProcessed,
      executionTime: stats.executionTime,
      runCount: stats.runCount || 0,
      phase1Remaining: (await getPhase1Queue(env)).length,
      phase2Remaining: (await getPhase2Queue(env)).length
    };

    await env.MEMBER_DATA.put('processing_status', JSON.stringify(status));
    console.log(`📊 Processing status updated: ${status.phase1Remaining} Phase 1, ${status.phase2Remaining} Phase 2 remaining`);

  } catch (error) {
    console.error('Error updating processing status:', error);
  }
}
// Handle resetting all PAC data and re-queuing Phase 2
async function handleResetPACData(env, corsHeaders, request) {
  try {
    // Check for authorization
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = `Bearer ${env.UPDATE_SECRET || 'taskforce_purple_2025_update'}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🔄 Resetting all PAC data and rebuilding Phase 2 queue...');

    // Get all members
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) {
      return new Response(JSON.stringify({ error: 'No member data found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(membersData);
    const phase2Queue = [];
    let clearedCount = 0;

    // Clear PAC data from all members and rebuild Phase 2 queue
    for (const member of members) {
      if (member.pacContributions && member.pacContributions.length > 0) {
        member.pacContributions = [];
        clearedCount++;
      }

      // Add to Phase 2 queue if they have financial data
      if (member.totalRaised > 0 && member.committeeId) {
        phase2Queue.push({
          bioguideId: member.bioguideId,
          name: member.name,
          committeeId: member.committeeId
        });
      }
    }

    // Save updated members (PAC data cleared)
    await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

    // Rebuild Phase 2 queue
    await env.MEMBER_DATA.put('processing_queue_phase2', JSON.stringify(phase2Queue));

    console.log(`✅ Reset complete: Cleared ${clearedCount} members, queued ${phase2Queue.length} for Phase 2`);

    return new Response(JSON.stringify({
      success: true,
      message: 'PAC data reset complete',
      membersCleared: clearedCount,
      phase2QueueSize: phase2Queue.length,
      nextStep: 'Phase 2 will re-process with corrected conduit filtering'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error resetting PAC data:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle clearing bad FEC candidate mappings
async function handleClearFECMapping(env, corsHeaders, request) {
  try {
    // Check for authorization
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = `Bearer ${env.UPDATE_SECRET || 'taskforce_purple_2025_update'}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const bioguideId = url.searchParams.get('bioguideId');

    if (!bioguideId) {
      return new Response(JSON.stringify({
        error: 'bioguideId parameter required',
        example: '/api/clear-fec-mapping?bioguideId=G000359'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Clear the cached FEC mapping
    const cacheKey = `fec_mapping_${bioguideId}`;
    await env.MEMBER_DATA.delete(cacheKey);

    console.log(`🗑️ Cleared FEC mapping for ${bioguideId}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Cleared FEC mapping for ${bioguideId}`,
      bioguideId: bioguideId,
      action: 'Next lookup will search FEC API fresh and cache new result'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error clearing FEC mapping:', error);
    return new Response(JSON.stringify({
      error: 'Failed to clear FEC mapping',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Handle removing a member from KV storage
async function handleRemoveMember(env, corsHeaders, request) {
  try {
    // Check for authentication
    const url = new URL(request.url);
    const authKey = url.searchParams.get('key') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const expectedKey = env.UPDATE_SECRET;

    if (!expectedKey) {
      throw new Error('UPDATE_SECRET not configured');
    }

    if (!authKey || authKey !== expectedKey) {
      return new Response(JSON.stringify({
        error: 'Unauthorized - valid API key required'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract bioguideId from URL path
    const bioguideId = url.pathname.replace('/api/remove-member/', '');

    if (!bioguideId) {
      return new Response(JSON.stringify({
        error: 'bioguideId required - use format /api/remove-member/{bioguideId}'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🗑️ Member removal requested for bioguideId: ${bioguideId}`);

    // Get current members data from KV
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) {
      return new Response(JSON.stringify({
        error: 'No member data found in storage',
        bioguideId: bioguideId
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(membersData);

    // Find the member to remove
    const memberIndex = members.findIndex(member => member.bioguideId === bioguideId);
    if (memberIndex === -1) {
      return new Response(JSON.stringify({
        error: `Member with bioguideId ${bioguideId} not found`,
        bioguideId: bioguideId,
        totalMembers: members.length
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get member info before removal for response
    const removedMember = members[memberIndex];

    // Remove the member from the array
    members.splice(memberIndex, 1);

    // Save updated array back to KV
    await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

    console.log(`✅ Removed ${removedMember.name} (${bioguideId}) from storage`);

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully removed member from storage`,
      removedMember: {
        bioguideId: removedMember.bioguideId,
        name: removedMember.name,
        state: removedMember.state,
        party: removedMember.party
      },
      remainingMembers: members.length,
      lastUpdated: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Member removal failed:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Refresh Congress.gov metadata for all members (chamber, party, state, district)
async function handleRefreshCongressMetadata(env, corsHeaders, request) {
  try {
    // Check for authorization
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = `Bearer ${env.UPDATE_SECRET || 'taskforce_purple_2025_update'}`;

    if (!authHeader || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('🏛️ Refreshing Congress.gov metadata for all members...');

    const apiKey = env.CONGRESS_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';

    // Fetch all current members from Congress.gov
    let allCongressMembers = [];
    let offset = 0;
    const limit = 250;

    while (true) {
      const response = await fetch(
        `https://api.congress.gov/v3/member/congress/119?currentMember=true&offset=${offset}&limit=${limit}&api_key=${apiKey}`,
        {
          headers: {
            'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Congress.gov API error: ${response.status}`);
      }

      const data = await response.json();
      allCongressMembers = allCongressMembers.concat(data.members || []);

      if (!data.members || data.members.length < limit) break;
      offset += limit;
    }

    console.log(`📥 Fetched ${allCongressMembers.length} members from Congress.gov`);

    // Get existing member data
    const membersData = await env.MEMBER_DATA.get('members:all');
    if (!membersData) {
      return new Response(JSON.stringify({ error: 'No member data found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const members = JSON.parse(membersData);
    let updatedCount = 0;

    // Update metadata for each member
    for (const congressMember of allCongressMembers) {
      const memberIndex = members.findIndex(m => m.bioguideId === congressMember.bioguideId);

      if (memberIndex >= 0) {
        const member = members[memberIndex];

        // Get most recent term (last item in array)
        const terms = congressMember.terms?.item;
        const currentTerm = terms && terms.length > 0 ? terms[terms.length - 1] : null;
        const newChamber = currentTerm?.chamber === 'House of Representatives' ? 'House' :
                          currentTerm?.chamber === 'Senate' ? 'Senate' : 'Unknown';

        // Only update if something changed
        if (member.chamber !== newChamber ||
            member.party !== congressMember.partyName ||
            member.state !== congressMember.state ||
            member.district !== congressMember.district) {

          member.chamber = newChamber;
          member.party = congressMember.partyName;
          member.state = congressMember.state;
          member.district = congressMember.district;
          updatedCount++;

          console.log(`✅ Updated ${member.name}: chamber=${newChamber}`);
        }
      }
    }

    // Save updated members
    await env.MEMBER_DATA.put('members:all', JSON.stringify(members));

    console.log(`✅ Refresh complete: Updated ${updatedCount} members`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Congress.gov metadata refresh complete',
      totalMembers: allCongressMembers.length,
      updatedCount: updatedCount,
      lastUpdated: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error refreshing Congress metadata:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
