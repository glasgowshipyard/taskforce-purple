/**
 * PROTOTYPE: Itemized Donor Analysis for Bernie Sanders & Nancy Pelosi
 *
 * This worker fetches ALL Schedule A transactions to understand:
 * - How many unique donors each has
 * - Transaction counts
 * - Distribution of donation amounts
 * - Real data to prove concentration differences
 *
 * No fancy math. Just raw data.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/analyze') {
      return analyzeMembers(env);
    }

    return new Response('Itemized Analysis Prototype\n\nEndpoints:\n  /analyze - Fetch and analyze Sanders + Pelosi', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function analyzeMembers(env) {
  const startTime = Date.now();
  const results = {};

  console.log('🚀 Starting itemized analysis prototype');
  console.log(`⏰ Start time: ${new Date().toISOString()}`);

  // Hardcoded for prototype
  const members = [
    { name: 'Bernie Sanders', bioguideId: 'S000033' },
    { name: 'Nancy Pelosi', bioguideId: 'P000197' }
  ];

  for (const member of members) {
    console.log(`\n📊 Processing ${member.name} (${member.bioguideId})`);
    const memberStartTime = Date.now();

    try {
      const analysis = await fetchItemizedTransactions(member.bioguideId, env);
      results[member.bioguideId] = {
        name: member.name,
        ...analysis,
        processingTimeMs: Date.now() - memberStartTime
      };

      console.log(`✅ ${member.name} complete in ${Date.now() - memberStartTime}ms`);
    } catch (error) {
      console.error(`❌ ${member.name} failed:`, error.message);
      results[member.bioguideId] = {
        name: member.name,
        error: error.message,
        processingTimeMs: Date.now() - memberStartTime
      };
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n🏁 Total processing time: ${totalTime}ms`);

  return new Response(JSON.stringify({
    results,
    totalProcessingTimeMs: totalTime,
    timestamp: new Date().toISOString()
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function fetchItemizedTransactions(bioguideId, env) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';

  // Map bioguide ID to searchable info
  const memberInfo = {
    'S000033': { name: 'Sanders', office: 'S', state: 'VT' },
    'P000197': { name: 'Pelosi', office: 'H', state: 'CA' }
  };

  const info = memberInfo[bioguideId];
  if (!info) {
    throw new Error(`Unknown bioguide ID: ${bioguideId}`);
  }

  // First, search for their committee ID using FEC search API
  console.log(`  🔍 Searching FEC for ${info.name} (${info.office}-${info.state})...`);
  const committeeId = await searchCommitteeId(info.name, info.office, info.state, apiKey);

  if (!committeeId) {
    throw new Error(`No committee found for ${info.name}`);
  }

  console.log(`  💼 Committee ID: ${committeeId}`);

  // Get current election cycle
  const currentYear = new Date().getFullYear();
  const cycle = currentYear % 2 === 0 ? currentYear : currentYear + 1;
  console.log(`  📅 Election cycle: ${cycle}`);

  // Fetch all itemized individual contributions (Schedule A)
  let allTransactions = [];
  let page = 1;
  let totalPages = 1;
  let apiCallCount = 0;
  const perPage = 100; // Max allowed by FEC API

  console.log(`  📥 Fetching Schedule A transactions (itemized individual contributions)...`);

  while (page <= totalPages) {
    const fetchStartTime = Date.now();

    const response = await fetch(
      `https://api.open.fec.gov/v1/schedules/schedule_a/?` +
      `api_key=${apiKey}` +
      `&committee_id=${committeeId}` +
      `&contributor_type=individual` + // Only individual donors, not committees
      `&per_page=${perPage}` +
      `&page=${page}` +
      `&two_year_transaction_period=${cycle}` +
      `&sort=-contribution_receipt_date`, // Newest first
      {
        headers: {
          'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
        }
      }
    );

    apiCallCount++;
    const fetchTime = Date.now() - fetchStartTime;

    console.log(`  📄 Page ${page}: HTTP ${response.status} (${fetchTime}ms)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  ❌ FEC API error: ${errorText}`);
      throw new Error(`FEC API returned ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    // Update total pages from pagination
    if (data.pagination) {
      totalPages = data.pagination.pages || 1;
      console.log(`  📊 Pagination: page ${page}/${totalPages}, ${data.pagination.count} total transactions`);
    }

    const transactions = data.results || [];
    allTransactions.push(...transactions);

    console.log(`  ➕ Added ${transactions.length} transactions (total so far: ${allTransactions.length})`);

    page++;

    // Rate limit safety: small delay between requests
    if (page <= totalPages) {
      await sleep(100); // 100ms delay = max 600 req/min = well under 1000/hr standard limit
    }
  }

  console.log(`  ✅ Fetched ${allTransactions.length} total transactions in ${apiCallCount} API calls`);

  // Analyze the data
  const analysis = analyzeTransactions(allTransactions);

  // Store raw data in KV for inspection
  const kvKey = `itemized:${bioguideId}`;
  console.log(`  💾 Storing raw data in KV: ${kvKey}`);

  await env.MEMBER_DATA.put(kvKey, JSON.stringify({
    bioguideId,
    cycle,
    transactions: allTransactions,
    analysis,
    fetchedAt: new Date().toISOString(),
    apiCallCount
  }));

  console.log(`  💾 Stored ${JSON.stringify({ bioguideId, cycle, transactions: allTransactions, analysis }).length} bytes`);

  return {
    committeeId,
    cycle,
    transactionCount: allTransactions.length,
    apiCallCount,
    analysis
  };
}

async function searchCommitteeId(name, office, state, apiKey) {
  const response = await fetch(
    `https://api.open.fec.gov/v1/candidates/search/?api_key=${apiKey}&q=${encodeURIComponent(name)}&office=${office}&state=${state}`,
    {
      headers: {
        'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`FEC search failed: ${response.status}`);
  }

  const data = await response.json();
  const candidates = data.results || [];

  if (candidates.length === 0) {
    throw new Error('No candidates found in search');
  }

  // Get the first candidate (should be most relevant)
  const candidate = candidates[0];

  // Get their principal committee (most recent cycle)
  const committees = candidate.principal_committees || [];

  if (committees.length === 0) {
    throw new Error('No principal committee found');
  }

  // Get current cycle
  const currentYear = new Date().getFullYear();
  const cycle = currentYear % 2 === 0 ? currentYear : currentYear + 1;

  // Find committee with current or recent cycle
  const recentCommittee = committees.find(c =>
    c.cycles && c.cycles.includes(cycle)
  ) || committees[0];

  return recentCommittee.committee_id;
}

function analyzeTransactions(transactions) {
  if (transactions.length === 0) {
    return {
      uniqueDonors: 0,
      totalAmount: 0,
      avgDonation: 0,
      medianDonation: 0,
      minDonation: 0,
      maxDonation: 0
    };
  }

  // Deduplicate donors by name (simple normalization)
  const donorNames = new Set();
  const amounts = [];
  let totalAmount = 0;

  for (const tx of transactions) {
    if (tx.contributor_name && tx.contribution_receipt_amount > 0) {
      // Normalize name: uppercase, trim whitespace
      const normalizedName = tx.contributor_name.toUpperCase().trim();
      donorNames.add(normalizedName);

      const amount = tx.contribution_receipt_amount;
      amounts.push(amount);
      totalAmount += amount;
    }
  }

  // Sort amounts for median calculation
  amounts.sort((a, b) => a - b);

  const uniqueDonors = donorNames.size;
  const avgDonation = totalAmount / amounts.length;
  const medianDonation = amounts[Math.floor(amounts.length / 2)];
  const minDonation = amounts[0] || 0;
  const maxDonation = amounts[amounts.length - 1] || 0;

  // Find top donors by summing all donations per person
  const donorTotals = {};
  for (const tx of transactions) {
    if (tx.contributor_name && tx.contribution_receipt_amount > 0) {
      const normalizedName = tx.contributor_name.toUpperCase().trim();
      donorTotals[normalizedName] = (donorTotals[normalizedName] || 0) + tx.contribution_receipt_amount;
    }
  }

  // Sort donors by total contribution
  const topDonors = Object.entries(donorTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, amount]) => ({ name, amount }));

  const top10Total = topDonors.reduce((sum, d) => sum + d.amount, 0);
  const top10Percent = (top10Total / totalAmount) * 100;

  console.log(`  📈 Analysis: ${uniqueDonors} unique donors, $${totalAmount.toLocaleString()} total`);
  console.log(`  💰 Avg: $${avgDonation.toFixed(2)}, Median: $${medianDonation}, Top 10: ${top10Percent.toFixed(1)}%`);

  return {
    uniqueDonors,
    totalAmount,
    avgDonation: Math.round(avgDonation * 100) / 100,
    medianDonation,
    minDonation,
    maxDonation,
    top10Donors: topDonors,
    top10Percent: Math.round(top10Percent * 10) / 10
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
