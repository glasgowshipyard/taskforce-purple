/**
 * PROTOTYPE: Itemized Donor Analysis for Bernie Sanders & Nancy Pelosi
 *
 * This worker fetches ALL Schedule A transactions to understand:
 * - How many unique donors each has
 * - Transaction counts
 * - Distribution of donation amounts
 * - Real data to prove concentration differences
 *
 * Handles Cloudflare's 50 subrequest limit by processing in chunks.
 * Run /analyze multiple times to resume and complete all members.
 *
 * No fancy math. Just raw data.
 */

const PAGES_PER_RUN = 5; // 5 pages × 2.5s = 12.5s + overhead, fits in 30s wall-clock limit

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/analyze') {
      return analyzeMembers(env);
    }

    if (url.pathname === '/status') {
      return getStatus(env);
    }

    return new Response('Itemized Analysis Prototype\n\nEndpoints:\n  /analyze - Process next chunk for Sanders + Pelosi\n  /status - Check progress', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function getStatus(env) {
  const members = [
    { name: 'Bernie Sanders', bioguideId: 'S000033' },
    { name: 'Nancy Pelosi', bioguideId: 'P000197' }
  ];

  const status = {};

  for (const member of members) {
    const progressKey = `itemized_progress:${member.bioguideId}`;
    const progressData = await env.MEMBER_DATA.get(progressKey);

    if (progressData) {
      const progress = JSON.parse(progressData);
      status[member.bioguideId] = {
        name: member.name,
        status: progress.complete ? 'complete' : 'in_progress',
        ...progress
      };
    } else {
      status[member.bioguideId] = {
        name: member.name,
        status: 'not_started'
      };
    }
  }

  return new Response(JSON.stringify(status, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function analyzeMembers(env) {
  const startTime = Date.now();
  const results = {};
  const executionLog = [];

  const log = (msg) => {
    console.log(msg);
    executionLog.push(`${new Date().toISOString()} - ${msg}`);
  };

  log('🚀 Starting itemized analysis chunk');
  log(`⏰ Start time: ${new Date().toISOString()}`);
  log(`📦 Pages per run: ${PAGES_PER_RUN} (50 subrequest limit)`);

  // Hardcoded for prototype
  const members = [
    { name: 'Bernie Sanders', bioguideId: 'S000033' },
    { name: 'Nancy Pelosi', bioguideId: 'P000197' }
  ];

  let totalPagesProcessed = 0;

  for (const member of members) {
    log(`\n📊 Processing ${member.name} (${member.bioguideId})`);
    const memberStartTime = Date.now();

    try {
      const result = await fetchItemizedTransactionsChunk(member.bioguideId, env, log);
      const processingTime = Date.now() - memberStartTime;

      results[member.bioguideId] = {
        name: member.name,
        success: true,
        ...result,
        processingTimeMs: processingTime,
        processingTimeSeconds: Math.round(processingTime / 1000)
      };

      totalPagesProcessed += result.pagesProcessedThisRun || 0;

      if (result.complete) {
        log(`✅ ${member.name} COMPLETE: ${result.totalTransactions} transactions, ${result.analysis?.uniqueDonors || 'N/A'} unique donors`);
      } else {
        log(`⏸️ ${member.name} in progress: ${result.currentPage}/${result.totalPages} pages (${Math.round(result.currentPage/result.totalPages*100)}%)`);
      }

    } catch (error) {
      const processingTime = Date.now() - memberStartTime;
      console.error(`❌ ${member.name} failed:`, error);
      log(`❌ ${member.name} failed after ${processingTime}ms: ${error.message}`);

      results[member.bioguideId] = {
        name: member.name,
        success: false,
        error: error.message,
        processingTimeMs: processingTime
      };
    }

    // Check if we're approaching subrequest limit
    if (totalPagesProcessed >= PAGES_PER_RUN - 5) {
      log(`\n⚠️ Approaching subrequest limit (${totalPagesProcessed} pages processed), stopping this run`);
      break;
    }
  }

  const totalTime = Date.now() - startTime;
  log(`\n🏁 Chunk complete: ${totalTime}ms (${Math.round(totalTime/1000)}s)`);
  log(`📄 Pages processed this run: ${totalPagesProcessed}`);

  // Check overall status
  const allComplete = await checkAllComplete(env, members);

  return new Response(JSON.stringify({
    allComplete,
    results,
    summary: {
      totalProcessingTimeMs: totalTime,
      totalProcessingTimeSeconds: Math.round(totalTime / 1000),
      pagesProcessedThisRun: totalPagesProcessed,
      allMembersComplete: allComplete
    },
    executionLog,
    timestamp: new Date().toISOString(),
    nextAction: allComplete ? '✅ All members complete!' : '▶️ Run /analyze again to continue'
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function checkAllComplete(env, members) {
  for (const member of members) {
    const progressKey = `itemized_progress:${member.bioguideId}`;
    const progressData = await env.MEMBER_DATA.get(progressKey);

    if (!progressData) return false;

    const progress = JSON.parse(progressData);
    if (!progress.complete) return false;
  }
  return true;
}

async function fetchItemizedTransactionsChunk(bioguideId, env, log) {
  const apiKey = env.FEC_API_KEY || 'zVpKDAacmPcazWQxhl5fhodhB9wNUH0urLCLkkV9';
  const progressKey = `itemized_progress:${bioguideId}`;

  // Check for existing progress
  const existingProgressData = await env.MEMBER_DATA.get(progressKey);
  let progress;

  if (existingProgressData) {
    progress = JSON.parse(existingProgressData);
    log(`  📂 Resuming from page ${progress.currentPage}/${progress.totalPages}`);

    if (progress.complete) {
      log(`  ✅ Already complete`);
      return {
        complete: true,
        totalTransactions: progress.transactions.length,
        analysis: progress.analysis,
        pagesProcessedThisRun: 0
      };
    }
  } else {
    // Starting fresh - need to get committee ID
    const memberInfo = {
      'S000033': { name: 'Sanders', office: 'S', state: 'VT' },
      'P000197': { name: 'Pelosi', office: 'H', state: 'CA' }
    };

    const info = memberInfo[bioguideId];
    if (!info) {
      throw new Error(`Unknown bioguide ID: ${bioguideId}`);
    }

    log(`  🔍 Searching FEC for ${info.name} (${info.office}-${info.state})...`);
    const committeeId = await searchCommitteeId(info.name, info.office, info.state, apiKey);

    if (!committeeId) {
      throw new Error(`No committee found for ${info.name}`);
    }

    log(`  💼 Committee ID: ${committeeId}`);

    const currentYear = new Date().getFullYear();
    const cycle = currentYear % 2 === 0 ? currentYear : currentYear + 1;
    log(`  📅 Election cycle: ${cycle}`);

    progress = {
      bioguideId,
      committeeId,
      cycle,
      currentPage: 1,
      totalPages: null,
      transactions: [],
      startedAt: new Date().toISOString(),
      complete: false
    };
  }

  const committeeId = progress.committeeId;
  const cycle = progress.cycle;

  // Fetch transactions in chunks
  const perPage = 100; // Max allowed by FEC API
  const startPage = progress.currentPage;
  const maxPagesToFetch = PAGES_PER_RUN;

  log(`  📥 Fetching Schedule A transactions (chunk of ${maxPagesToFetch} pages)...`);

  const fetchStartTime = Date.now();
  let pagesProcessed = 0;
  let page = startPage;

  while (pagesProcessed < maxPagesToFetch) {
    const pageStartTime = Date.now();

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

    const fetchTime = Date.now() - pageStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      log(`  ❌ FEC API error on page ${page}: ${errorText.substring(0, 200)}`);
      throw new Error(`FEC API returned ${response.status} on page ${page}`);
    }

    const data = await response.json();

    // Update total pages from pagination
    if (data.pagination) {
      progress.totalPages = data.pagination.pages || 1;
      if (page === startPage) {
        log(`  📊 Total pages: ${progress.totalPages}, ${data.pagination.count} total transactions`);
      }
    }

    const transactions = data.results || [];
    progress.transactions.push(...transactions);

    log(`  📄 Page ${page}/${progress.totalPages || '?'}: ${transactions.length} transactions (${fetchTime}ms)`);

    pagesProcessed++;
    page++;

    // Check if we've reached the end
    if (progress.totalPages && page > progress.totalPages) {
      log(`  ✅ Reached end of pages`);
      break;
    }

    // Rate limit safety: small delay between requests
    await sleep(100); // 100ms delay
  }

  const totalFetchTime = Date.now() - fetchStartTime;
  log(`  ⏱️ Fetched ${pagesProcessed} pages in ${Math.round(totalFetchTime/1000)}s`);

  // Update progress
  progress.currentPage = page;
  progress.lastUpdated = new Date().toISOString();

  // Check if complete
  const isComplete = progress.totalPages && page > progress.totalPages;

  if (isComplete) {
    progress.complete = true;
    progress.completedAt = new Date().toISOString();

    // Analyze all transactions
    log(`  📊 Analyzing ${progress.transactions.length} transactions...`);
    const analysis = analyzeTransactions(progress.transactions);
    progress.analysis = analysis;

    log(`  ✅ Analysis complete: ${analysis.uniqueDonors} unique donors, avg $${analysis.avgDonation}`);

    // Store final complete data
    const kvKey = `itemized:${bioguideId}`;
    const kvData = {
      bioguideId,
      committeeId,
      cycle,
      transactions: progress.transactions,
      analysis,
      fetchedAt: progress.startedAt,
      completedAt: progress.completedAt
    };

    const kvDataString = JSON.stringify(kvData);
    const kvDataSizeMB = Math.round(kvDataString.length / 1024 / 1024 * 100) / 100;
    log(`  💾 Storing complete data (${kvDataSizeMB} MB)...`);

    await env.MEMBER_DATA.put(kvKey, kvDataString);
    log(`  💾 Stored complete data in KV: ${kvKey}`);
  }

  // Save progress
  await env.MEMBER_DATA.put(progressKey, JSON.stringify(progress));
  log(`  💾 Saved progress: page ${progress.currentPage}/${progress.totalPages}`);

  return {
    complete: isComplete,
    currentPage: progress.currentPage,
    totalPages: progress.totalPages,
    totalTransactions: progress.transactions.length,
    pagesProcessedThisRun: pagesProcessed,
    analysis: progress.analysis || null
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
