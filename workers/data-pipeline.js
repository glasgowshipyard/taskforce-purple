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
        case '/api/status':
          return await handleStatus(env, corsHeaders);
        default:
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

  // Scheduled task to update data daily
  async scheduled(event, env, ctx) {
    console.log('🔄 Starting scheduled data update...');
    try {
      await updateCongressionalData(env);
      console.log('✅ Data update completed successfully');
    } catch (error) {
      console.error('❌ Scheduled data update failed:', error);
    }
  }
};

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

// Fetch financial data from OpenFEC API using correct endpoints
async function fetchMemberFinancials(member, env) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';  // Temporary fallback

  try {
    console.log(`🔍 Looking up financial data for: ${member.name} (${member.state})`);

    // Convert state name to abbreviation for FEC API
    const stateAbbr = STATE_ABBREVIATIONS[member.state] || member.state;

    // First, search for the candidate by name since bioguideId != FEC candidate_id
    const chamberType = member.terms?.item?.[0]?.chamber;
    const office = chamberType === 'House of Representatives' ? 'H' : 'S';
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
      return null;
    }

    const searchData = await searchResponse.json();
    if (!searchData.results || searchData.results.length === 0) {
      console.warn(`No FEC candidate record found for ${member.name}`);
      return null;
    }

    // Get the most recent/active candidate record
    const candidate = searchData.results[0];
    console.log(`✅ Found FEC candidate: ${candidate.name} (ID: ${candidate.candidate_id})`);

    // Use the committee data directly from search results (more reliable than /candidates/ endpoint)
    if (candidate.principal_committees && candidate.principal_committees.length > 0) {
      const committeeId = candidate.principal_committees[0].committee_id;
      console.log(`📊 Getting committee totals for ${committeeId}`);

      const committeeTotalsResponse = await fetch(
        `https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${apiKey}&cycle=2024`,
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
          const grassrootsPercent = totalRaised > 0 ? Math.round((grassrootsDonations / totalRaised) * 100) : 0;

          return {
            totalRaised,
            grassrootsDonations,
            grassrootsPercent,
            pacMoney: latestTotal.other_political_committee_contributions || 0,
            partyMoney: latestTotal.political_party_committee_contributions || 0,
            committeeId: committeeId,
            committeeName: candidate.name
          };
        }
      }
    }

    // Fallback: try the totals by entity endpoint
    const totalsResponse = await fetch(
      `https://api.open.fec.gov/v1/totals/by_entity/?api_key=${apiKey}&candidate_id=${candidate.candidate_id}&election_year=2024&cycle=2024`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!totalsResponse.ok) {
      console.warn(`FEC totals API error for ${candidate.candidate_id}: ${totalsResponse.status}`);
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
      committeeId: candidate.principal_committees?.[0]?.committee_id || candidate.candidate_id,
      committeeName: candidate.name
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
    const response = await fetch(
      `https://api.open.fec.gov/v1/schedules/schedule_a/?api_key=${apiKey}&committee_id=${committeeId}&contributor_type=committee&per_page=100&sort=-contribution_receipt_amount&cycle=2024`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!response.ok) {
      console.warn(`FEC Schedule A API error for ${committeeId}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const contributions = data.results || [];

    console.log(`💰 Found ${contributions.length} PAC contributions for ${committeeId}`);

    // Process and clean the contributions
    const pacContributions = contributions
      .filter(contrib => contrib.contributor_name && contrib.contribution_receipt_amount > 0)
      .map(contrib => ({
        pacName: contrib.contributor_name,
        amount: contrib.contribution_receipt_amount,
        date: contrib.contribution_receipt_date,
        contributorType: contrib.contributor_type,
        employerName: contrib.contributor_employer,
        contributorOccupation: contrib.contributor_occupation,
        contributorState: contrib.contributor_state,
        receiptDescription: contrib.receipt_description
      }))
      .slice(0, 20); // Top 20 PAC contributors

    return pacContributions;

  } catch (error) {
    console.warn(`Error fetching PAC details for ${committeeId}:`, error.message);
    return [];
  }
}

// Calculate tier based on grassroots percentage
function calculateTier(grassrootsPercent, totalRaised) {
  // No financial data = no tier assignment
  if (totalRaised === 0) return 'N/A';

  if (grassrootsPercent >= 85) return 'S';
  if (grassrootsPercent >= 70) return 'A';
  if (grassrootsPercent >= 50) return 'B';
  if (grassrootsPercent >= 30) return 'C';
  return 'D';
}

// Process and enrich member data with TWO-CALL STRATEGY
// First call: Basic tier data (fast), Second call: Detailed PAC data (slower)
async function processMembers(congressMembers, env) {
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
  const BASIC_BATCH_SIZE = 25;

  for (const member of congressMembers) {
    try {
      // Get basic financial data only (no PAC details)
      const financials = await fetchMemberFinancials(member, env);

      const basicMember = {
        bioguideId: member.bioguideId,
        name: member.name,
        party: member.partyName,
        state: member.state,
        district: member.district,
        chamber: (member.terms?.item?.[0]?.chamber === 'House of Representatives') ? 'House' :
                 (member.terms?.item?.[0]?.chamber === 'Senate') ? 'Senate' : 'Unknown',

        // Basic financial data
        totalRaised: financials?.totalRaised || 0,
        grassrootsDonations: financials?.grassrootsDonations || 0,
        grassrootsPercent: financials?.grassrootsPercent || 0,
        pacMoney: financials?.pacMoney || 0,
        partyMoney: financials?.partyMoney || 0,

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
        console.log(`📊 Basic processing: ${basicProcessed}/${congressMembers.length} members`);
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
  const PAC_BATCH_SIZE = 10; // Smaller batches for PAC details

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
async function updateCongressionalData(env) {
  console.log('🚀 Starting full data pipeline update with two-call strategy...');

  // Fetch current Congress members
  const congressMembers = await fetchCongressMembers(env);

  // Process financial data with two-call strategy (handles storage internally)
  const processedMembers = await processMembers(congressMembers, env);

  // Get final processed data from storage (includes both basic and PAC data)
  const finalData = await env.MEMBER_DATA.get('members:all');
  const finalMembers = finalData ? JSON.parse(finalData) : processedMembers;

  // Update final timestamp
  await env.MEMBER_DATA.put('last_updated', new Date().toISOString());

  // Create tier-specific lists from final data
  const tierLists = {
    S: finalMembers.filter(m => m.tier === 'S'),
    A: finalMembers.filter(m => m.tier === 'A'),
    B: finalMembers.filter(m => m.tier === 'B'),
    C: finalMembers.filter(m => m.tier === 'C'),
    D: finalMembers.filter(m => m.tier === 'D')
  };

  for (const [tier, members] of Object.entries(tierLists)) {
    await env.MEMBER_DATA.put(`tier:${tier}`, JSON.stringify(members));
  }

  console.log('💾 Two-call strategy complete - data stored successfully in KV');

  // Count members with PAC details for reporting
  const membersWithPACDetails = finalMembers.filter(m => m.pacDetailsStatus === 'complete').length;

  return {
    total: finalMembers.length,
    membersWithPACDetails,
    tiers: Object.fromEntries(
      Object.entries(tierLists).map(([tier, members]) => [tier, members.length])
    ),
    lastUpdated: new Date().toISOString()
  };
}

// API handlers
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

    return new Response(JSON.stringify({
      members,
      lastUpdated,
      total: members.length
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
    const result = await updateCongressionalData(env);

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