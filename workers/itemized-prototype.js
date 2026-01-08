/**
 * PROTOTYPE: Itemized Donor Analysis for Bernie Sanders & Nancy Pelosi
 *
 * This worker fetches ALL Schedule A transactions to understand:
 * - How many unique donors each has
 * - Transaction counts
 * - Distribution of donation amounts
 * - Real data to prove concentration differences
 *
 * Handles Cloudflare's 50 subrequest limit AND 25 MB KV value limit:
 * - Processes 5 FEC API pages per run (subrequest limit)
 * - Stores transactions in chunked KV keys (1000 transactions each)
 * - Metadata-only progress tracking
 *
 * No fancy math. Just raw data.
 */

const PAGES_PER_RUN = 5; // 5 pages × 2.5s = 12.5s + overhead, fits in 30s wall-clock limit
const TRANSACTIONS_PER_CHUNK = 1000; // ~1.5 MB per chunk, well under 25 MB KV limit

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/analyze') {
      return analyzeMembers(env);
    }

    if (url.pathname === '/status') {
      return getStatus(env);
    }

    return new Response('Itemized Analysis Prototype\n\nEndpoints:\n  /analyze - Process next chunk for Sanders + Pelosi\n  /status - Check progress\n\nCron: Running every 2 minutes automatically', {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  async scheduled(event, env, ctx) {
    // Cron trigger - process next chunk automatically
    console.log('🕐 Cron trigger fired:', new Date().toISOString());

    try {
      const result = await analyzeMembers(env);
      const data = await result.json();

      console.log('✅ Cron processing complete');
      console.log(`   Bernie: ${data.results?.S000033?.totalTransactions || 'N/A'} transactions`);
      console.log(`   Pelosi: ${data.results?.P000197?.totalTransactions || 'N/A'} transactions`);
      console.log(`   All complete: ${data.allComplete}`);
    } catch (error) {
      console.error('❌ Cron processing failed:', error.message);
    }
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
      // Don't include transaction data (old: transactions array, new: transactionBuffer)
      const { transactions, transactionBuffer, ...statusInfo } = progress;
      status[member.bioguideId] = {
        name: member.name,
        status: progress.complete ? 'complete' : 'in_progress',
        ...statusInfo
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
        log(`⏸️ ${member.name} in progress: ${result.totalTransactions} transactions collected, ${result.runsCompleted} runs completed`);
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

    // Check if we're at subrequest limit (don't start next member if we just did a full run)
    if (totalPagesProcessed >= PAGES_PER_RUN) {
      log(`\n⚠️ Reached page limit (${totalPagesProcessed} pages processed), stopping this run`);
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
    log(`  📂 Resuming: ${progress.totalTransactions} transactions collected so far`);

    // Initialize fields that may not exist in old progress data
    if (progress.totalTransactions === undefined) progress.totalTransactions = 0;
    if (progress.totalChunks === undefined) progress.totalChunks = 0;
    if (progress.runsCompleted === undefined) progress.runsCompleted = 0;
    if (progress.lastIndex === undefined) progress.lastIndex = null;
    if (progress.lastContributionReceiptDate === undefined) progress.lastContributionReceiptDate = null;

    if (progress.complete) {
      log(`  ✅ Already complete`);
      return {
        complete: true,
        totalTransactions: progress.totalTransactions,
        totalChunks: progress.totalChunks,
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
      totalTransactions: 0,
      totalChunks: 0,
      runsCompleted: 0,
      lastIndex: null, // Cursor for pagination
      lastContributionReceiptDate: null, // Cursor for pagination
      transactionBuffer: [], // Temporary buffer for current chunk
      startedAt: new Date().toISOString(),
      complete: false
    };
  }

  const committeeId = progress.committeeId;
  const cycle = progress.cycle;

  // Fetch transactions using cursor-based pagination
  const perPage = 100; // Max allowed by FEC API
  const maxPagesToFetch = PAGES_PER_RUN;

  log(`  📥 Fetching Schedule A transactions (up to ${maxPagesToFetch} API calls)...`);

  const fetchStartTime = Date.now();
  let pagesProcessed = 0;
  let reachedEnd = false; // Track if we got empty results (true end of data)

  // Initialize transaction buffer if not present
  if (!progress.transactionBuffer) {
    progress.transactionBuffer = [];
  }

  while (pagesProcessed < maxPagesToFetch) {
    const pageStartTime = Date.now();

    // Build URL with cursor-based pagination
    let url = `https://api.open.fec.gov/v1/schedules/schedule_a/?` +
      `api_key=${apiKey}` +
      `&committee_id=${committeeId}` +
      `&contributor_type=individual` +
      `&per_page=${perPage}` +
      `&two_year_transaction_period=${cycle}`;

    // Add cursor parameters if we have them (for continuation)
    if (progress.lastIndex && progress.lastContributionReceiptDate) {
      url += `&last_index=${progress.lastIndex}` +
             `&last_contribution_receipt_date=${encodeURIComponent(progress.lastContributionReceiptDate)}`;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)'
      }
    });

    const fetchTime = Date.now() - pageStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      log(`  ❌ FEC API error: ${errorText.substring(0, 200)}`);
      throw new Error(`FEC API returned ${response.status}`);
    }

    const data = await response.json();

    const transactions = data.results || [];

    // Check if we've reached the end (no more results)
    if (transactions.length === 0) {
      log(`  ✅ No more transactions (API returned empty results)`);
      reachedEnd = true;
      break;
    }

    progress.transactionBuffer.push(...transactions);
    progress.totalTransactions += transactions.length;

    // Update cursor for next page
    if (data.pagination && data.pagination.last_indexes) {
      progress.lastIndex = data.pagination.last_indexes.last_index;
      progress.lastContributionReceiptDate = data.pagination.last_indexes.last_contribution_receipt_date;
    }

    // Log progress with FEC's expected total count
    const totalCount = data.pagination?.count || '?';
    const percentComplete = data.pagination?.count ?
      Math.round((progress.totalTransactions / data.pagination.count) * 100) : '?';
    log(`  📄 Fetched ${transactions.length} transactions (${fetchTime}ms) - Total: ${progress.totalTransactions}/${totalCount} (${percentComplete}%)`);

    // Store FEC's total count for validation later
    if (data.pagination?.count && !progress.fecTotalCount) {
      progress.fecTotalCount = data.pagination.count;
    }

    pagesProcessed++;

    // Rate limit safety: small delay between requests
    await sleep(100); // 100ms delay
  }

  const totalFetchTime = Date.now() - fetchStartTime;
  log(`  ⏱️ Fetched ${pagesProcessed} API calls in ${Math.round(totalFetchTime/1000)}s`);

  // Save current buffer as a chunk (even if under 1000 transactions)
  // This ensures we don't lose data between runs
  if (progress.transactionBuffer.length > 0) {
    const chunkNumber = progress.totalChunks;
    const chunkKey = `transactions:${bioguideId}:chunk_${String(chunkNumber).padStart(3, '0')}`;

    await env.MEMBER_DATA.put(chunkKey, JSON.stringify(progress.transactionBuffer));
    log(`  💾 Stored chunk ${chunkNumber}: ${progress.transactionBuffer.length} transactions`);

    progress.totalChunks++;
    progress.transactionBuffer = []; // Clear buffer
  }

  // Update progress
  progress.runsCompleted++;
  progress.lastUpdated = new Date().toISOString();

  // Check if complete - we're done ONLY if we got empty results from FEC API
  // This prevents false completion from timeouts, errors, or other early breaks
  const isComplete = reachedEnd;

  if (isComplete) {
    progress.complete = true;
    progress.completedAt = new Date().toISOString();

    // Validate: Did we collect all the transactions FEC said exist?
    if (progress.fecTotalCount && progress.totalTransactions !== progress.fecTotalCount) {
      log(`  ⚠️ WARNING: Transaction count mismatch!`);
      log(`     FEC reported: ${progress.fecTotalCount} transactions`);
      log(`     We collected: ${progress.totalTransactions} transactions`);
      log(`     Missing: ${progress.fecTotalCount - progress.totalTransactions} transactions`);
    } else if (progress.fecTotalCount) {
      log(`  ✅ Transaction count validated: ${progress.totalTransactions} matches FEC total`);
    }

    log(`  🔄 Loading all ${progress.totalChunks} chunks for analysis...`);

    // Load all chunks and analyze
    const allTransactions = [];
    for (let i = 0; i < progress.totalChunks; i++) {
      const chunkKey = `transactions:${bioguideId}:chunk_${String(i).padStart(3, '0')}`;
      const chunkData = await env.MEMBER_DATA.get(chunkKey);
      if (chunkData) {
        const chunkTransactions = JSON.parse(chunkData);
        allTransactions.push(...chunkTransactions);
      }
    }

    log(`  📊 Analyzing ${allTransactions.length} transactions...`);
    const analysis = analyzeTransactions(allTransactions);
    progress.analysis = analysis;

    log(`  ✅ Analysis complete: ${analysis.uniqueDonors} unique donors, avg $${analysis.avgDonation}`);

    // CRITICAL: Reconcile our summed totalAmount against FEC's reported total
    log(`  🔍 Fetching FEC financial totals for reconciliation...`);
    try {
      const fecTotalsUrl = `https://api.open.fec.gov/v1/committee/${committeeId}/totals/?api_key=${apiKey}&cycle=${cycle}`;
      const fecTotalsResponse = await fetch(fecTotalsUrl, {
        headers: { 'User-Agent': 'TaskForcePurple/1.0 (Political Transparency Platform)' }
      });

      if (fecTotalsResponse.ok) {
        const fecTotalsData = await fecTotalsResponse.json();
        const fecTotal = fecTotalsData.results?.[0];

        if (fecTotal) {
          const fecItemizedTotal = fecTotal.individual_itemized_contributions || 0;
          const ourCalculatedTotal = analysis.totalAmount;
          const difference = Math.abs(fecItemizedTotal - ourCalculatedTotal);
          const percentDiff = fecItemizedTotal > 0 ? (difference / fecItemizedTotal) * 100 : 0;

          log(`  📊 FEC Reconciliation:`);
          log(`     FEC reported itemized total: $${fecItemizedTotal.toLocaleString()}`);
          log(`     Our calculated total:        $${ourCalculatedTotal.toLocaleString()}`);
          log(`     Difference:                  $${difference.toLocaleString()} (${percentDiff.toFixed(2)}%)`);

          if (percentDiff > 1) {
            log(`  ⚠️ WARNING: Totals differ by more than 1%! Check for missing or duplicate transactions.`);
          } else {
            log(`  ✅ Totals match within 1% tolerance`);
          }

          // Store reconciliation data
          analysis.fecReconciliation = {
            fecItemizedTotal,
            ourCalculatedTotal,
            difference,
            percentDiff
          };
        }
      }
    } catch (err) {
      log(`  ⚠️ Could not fetch FEC totals for reconciliation: ${err.message}`);
    }

    // Store analysis results separately
    const analysisKey = `itemized_analysis:${bioguideId}`;
    const analysisData = {
      bioguideId,
      committeeId,
      cycle,
      totalTransactions: allTransactions.length,
      totalChunks: progress.totalChunks,
      analysis,
      fetchedAt: progress.startedAt,
      completedAt: progress.completedAt
    };

    await env.MEMBER_DATA.put(analysisKey, JSON.stringify(analysisData));
    log(`  💾 Stored analysis results: ${analysisKey}`);

    // Clear transaction buffer from progress
    progress.transactionBuffer = [];
  }

  // Save progress (without transaction buffer to keep size small)
  const progressToSave = { ...progress };
  delete progressToSave.transactionBuffer;
  await env.MEMBER_DATA.put(progressKey, JSON.stringify(progressToSave));
  log(`  💾 Saved progress: ${progress.totalTransactions} transactions collected`);

  return {
    complete: isComplete,
    runsCompleted: progress.runsCompleted,
    totalTransactions: progress.totalTransactions,
    totalChunks: progress.totalChunks,
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

  // Deduplicate donors by composite key: first_name + last_name + state + zip
  // Using separate name fields handles variations better than contributor_name field
  // (which can be "SMITH, JOHN" or "JOHN SMITH" inconsistently)
  const donorKeys = new Set();
  const amounts = [];
  let totalAmount = 0;

  for (const tx of transactions) {
    if (tx.contribution_receipt_amount > 0) {
      // Use separate first/last name fields (more consistent than contributor_name)
      const firstName = (tx.contributor_first_name || '').toUpperCase().trim();
      const lastName = (tx.contributor_last_name || '').toUpperCase().trim();
      const state = (tx.contributor_state || '').toUpperCase().trim();
      const zip = (tx.contributor_zip || '').trim();

      // Composite key: first|last|state|zip for unique identification
      const compositeKey = `${firstName}|${lastName}|${state}|${zip}`;
      donorKeys.add(compositeKey);

      const amount = tx.contribution_receipt_amount;
      amounts.push(amount);
      totalAmount += amount;
    }
  }

  // Sort amounts for median calculation
  amounts.sort((a, b) => a - b);

  const uniqueDonors = donorKeys.size;
  const avgDonation = totalAmount / amounts.length;
  const medianDonation = amounts[Math.floor(amounts.length / 2)];
  const minDonation = amounts[0] || 0;
  const maxDonation = amounts[amounts.length - 1] || 0;

  // Find top donors by summing all donations per person (using composite key)
  const donorTotals = {};
  for (const tx of transactions) {
    if (tx.contribution_receipt_amount > 0) {
      const firstName = (tx.contributor_first_name || '').toUpperCase().trim();
      const lastName = (tx.contributor_last_name || '').toUpperCase().trim();
      const state = (tx.contributor_state || '').toUpperCase().trim();
      const zip = (tx.contributor_zip || '').trim();
      const compositeKey = `${firstName}|${lastName}|${state}|${zip}`;
      donorTotals[compositeKey] = (donorTotals[compositeKey] || 0) + tx.contribution_receipt_amount;
    }
  }

  // Sort donors by total contribution
  const topDonors = Object.entries(donorTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([compositeKey, amount]) => {
      // Extract name parts from composite key for display
      const parts = compositeKey.split('|');
      const displayName = `${parts[0]} ${parts[1]}`.trim(); // firstName lastName
      return { name: displayName, amount };
    });

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
