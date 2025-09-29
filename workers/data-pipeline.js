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
          return await handleDataUpdate(env, corsHeaders);
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
  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) {
    throw new Error('CONGRESS_API_KEY not configured');
  }

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

// Fetch financial data from OpenFEC API
async function fetchMemberFinancials(candidateId, env) {
  const apiKey = env.FEC_API_KEY;
  if (!apiKey) {
    throw new Error('FEC_API_KEY not configured');
  }

  try {
    // Get candidate committees
    const committeesResponse = await fetch(
      `https://api.open.fec.gov/v1/candidates/${candidateId}/committees/?api_key=${apiKey}&election_year=2024`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!committeesResponse.ok) {
      console.warn(`FEC committees API error for ${candidateId}: ${committeesResponse.status}`);
      return null;
    }

    const committeesData = await committeesResponse.json();
    const principalCommittee = committeesData.results?.find(c => c.designation === 'P') || committeesData.results?.[0];

    if (!principalCommittee) {
      console.warn(`No committee found for candidate ${candidateId}`);
      return null;
    }

    // Get committee financial totals
    const totalsResponse = await fetch(
      `https://api.open.fec.gov/v1/committees/${principalCommittee.committee_id}/totals/?api_key=${apiKey}&election_year=2024`,
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    if (!totalsResponse.ok) {
      console.warn(`FEC totals API error for ${principalCommittee.committee_id}: ${totalsResponse.status}`);
      return null;
    }

    const totalsData = await totalsResponse.json();
    const latestTotal = totalsData.results?.[0];

    if (!latestTotal) {
      return null;
    }

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
      committeeId: principalCommittee.committee_id,
      committeeName: principalCommittee.name
    };

  } catch (error) {
    console.warn(`Error fetching financials for ${candidateId}:`, error.message);
    return null;
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

// Process and enrich member data
async function processMembers(congressMembers, env) {
  console.log('🔄 Processing member financial data...');

  const processedMembers = [];
  let processed = 0;

  for (const member of congressMembers.slice(0, 10)) { // Limited test - first 10 established members
    try {
      // Get FEC candidate ID (usually bioguideId works, but may need mapping)
      const candidateId = member.bioguideId;

      const financials = await fetchMemberFinancials(candidateId, env);

      const processedMember = {
        bioguideId: member.bioguideId,
        name: member.name,
        party: member.partyName,
        state: member.state,
        district: member.district,
        chamber: member.terms?.[0]?.chamber || 'Unknown',

        // Financial data
        totalRaised: financials?.totalRaised || 0,
        grassrootsDonations: financials?.grassrootsDonations || 0,
        grassrootsPercent: financials?.grassrootsPercent || 0,
        pacMoney: financials?.pacMoney || 0,
        partyMoney: financials?.partyMoney || 0,

        // Calculated tier
        tier: calculateTier(financials?.grassrootsPercent || 0, financials?.totalRaised || 0),

        // Metadata
        lastUpdated: new Date().toISOString(),
        committeeInfo: financials ? {
          id: financials.committeeId,
          name: financials.committeeName
        } : null
      };

      processedMembers.push(processedMember);
      processed++;

      if (processed % 5 === 0) {
        console.log(`📊 Processed ${processed}/${congressMembers.length} members`);
      }

      // Rate limiting - 5 second delay for testing (faster for limited run)
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      console.warn(`Error processing member ${member.name}:`, error.message);
    }
  }

  console.log(`✅ Successfully processed ${processedMembers.length} members`);
  return processedMembers;
}

// Main data update function
async function updateCongressionalData(env) {
  console.log('🚀 Starting full data pipeline update...');

  // Fetch current Congress members
  const congressMembers = await fetchCongressMembers(env);

  // Process financial data for each member
  const processedMembers = await processMembers(congressMembers, env);

  // Store in KV storage
  await env.MEMBER_DATA.put('members:all', JSON.stringify(processedMembers));
  await env.MEMBER_DATA.put('last_updated', new Date().toISOString());

  // Create tier-specific lists
  const tierLists = {
    S: processedMembers.filter(m => m.tier === 'S'),
    A: processedMembers.filter(m => m.tier === 'A'),
    B: processedMembers.filter(m => m.tier === 'B'),
    C: processedMembers.filter(m => m.tier === 'C'),
    D: processedMembers.filter(m => m.tier === 'D')
  };

  for (const [tier, members] of Object.entries(tierLists)) {
    await env.MEMBER_DATA.put(`tier:${tier}`, JSON.stringify(members));
  }

  console.log('💾 Data stored successfully in KV');

  return {
    total: processedMembers.length,
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

async function handleDataUpdate(env, corsHeaders) {
  try {
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