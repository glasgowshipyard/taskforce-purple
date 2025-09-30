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

    // FEC API Rate Limiting: 3.6+ second delay to stay under 16.67 calls/minute
    await new Promise(resolve => setTimeout(resolve, 3600));

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
      // Consume the response body to prevent deadlock
      try { await searchResponse.json(); } catch {}
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
      } else {
        // Consume the response body to prevent deadlock
        try { await committeeTotalsResponse.json(); } catch {}
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
      // Consume the response body to prevent deadlock
      try { await response.json(); } catch {}
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
        contributorId: contrib.contributor_id, // NEW: Store for metadata lookup
        employerName: contrib.contributor_employer,
        contributorOccupation: contrib.contributor_occupation,
        contributorState: contrib.contributor_state,
        receiptDescription: contrib.receipt_description
      }))
      .slice(0, 20); // Top 20 PAC contributors

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
    weight *= 0.5; // Authorized committees 50% less concerning
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

  if (grassrootsPercent >= 85) return 'S';
  if (grassrootsPercent >= 70) return 'A';
  if (grassrootsPercent >= 50) return 'B';
  if (grassrootsPercent >= 30) return 'C';
  return 'D';
}

// NEW: Calculate enhanced tier using weighted PAC transparency scores
function calculateEnhancedTier(member) {
  if (!member.totalRaised || member.totalRaised === 0) return 'N/A';

  // If we have PAC contributions with transparency weights, use enhanced calculation
  if (member.pacContributions && member.pacContributions.length > 0) {
    const totalWeightedPAC = member.pacContributions.reduce((sum, pac) =>
      sum + (pac.weighted_amount || pac.amount), 0);

    // Recalculate grassroots percentage using weighted PAC amounts
    const enhancedGrassrootsDonations = member.totalRaised - totalWeightedPAC;
    const enhancedGrassrootsPercent = (enhancedGrassrootsDonations / member.totalRaised) * 100;

    // Apply tier calculation with enhanced percentage
    if (enhancedGrassrootsPercent >= 85) return 'S';
    if (enhancedGrassrootsPercent >= 70) return 'A';
    if (enhancedGrassrootsPercent >= 50) return 'B';
    if (enhancedGrassrootsPercent >= 30) return 'C';
    return 'D';
  }

  // Fallback to standard calculation
  return calculateTier(member.grassrootsPercent, member.totalRaised);
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
  const BASIC_BATCH_SIZE = 25;

  // Apply test limit if specified (for testing small batches)
  const membersToProcess = testLimit ? congressMembers.slice(0, testLimit) : congressMembers;
  if (testLimit) {
    console.log(`🧪 TEST MODE: Processing only first ${testLimit} members (of ${congressMembers.length} total)`);
  }

  for (const member of membersToProcess) {
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
  console.log('🚀 Starting full data pipeline update with two-call strategy...');

  // Fetch current Congress members
  const congressMembers = await fetchCongressMembers(env);

  // Process financial data with two-call strategy (handles storage internally)
  const processedMembers = await processMembers(congressMembers, env, testLimit);

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

          if (financials && financials.totalRaised > 0) {
            // Update member with new financial data
            allMembers[member.originalIndex] = {
              ...allMembers[member.originalIndex],
              totalRaised: financials.totalRaised,
              grassrootsDonations: financials.grassrootsDonations,
              grassrootsPercent: financials.grassrootsPercent,
              pacMoney: financials.pacMoney,
              partyMoney: financials.partyMoney,
              tier: calculateTier(financials.grassrootsPercent),
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

      if (remainingFinancial.length === 0) {
        console.log('🔄 Financial phase complete, moving to PAC phase');
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
          if (member.candidateId) {
            const pacDetails = await fetchPACDetails(member.candidateId, env);

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

      if (remainingPAC.length === 0) {
        console.log('🎉 All phases complete! Resetting progress.');
        progressData = { lastProcessedIndex: -1, phase: 'financial' };
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