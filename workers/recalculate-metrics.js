/**
 * Recalculate Oligarchic Capture Metrics from D1 donor aggregates
 * Run with: curl https://taskforce-purple-recalc-metrics.dev-a4b.workers.dev/?bioguide=S000033
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const bioguideId = url.searchParams.get('bioguide') || 'S000033';

    try {
      // Fetch donor aggregates from D1 (descending order for Nakamoto)
      const result = await env.DONOR_DB.prepare(
        `SELECT
           contributor_first_name || '|' || contributor_last_name || '|' || contributor_state || '|' || contributor_zip as donor_key,
           SUM(amount) as total_amount
         FROM itemized_transactions
         WHERE bioguide_id = ?
         GROUP BY donor_key
         ORDER BY total_amount DESC`
      ).bind(bioguideId).all();

      if (!result.results || result.results.length === 0) {
        return Response.json({ error: 'No transaction data found in D1', bioguideId });
      }

      const amounts = result.results.map(row => row.total_amount);
      const N = amounts.length;
      const totalAmount = amounts.reduce((sum, amt) => sum + amt, 0);

      // OLIGARCHIC CAPTURE METRICS

      // 1. Whale Weight (Top 1% Concentration Ratio)
      const top1PercentCount = Math.max(1, Math.ceil(N * 0.01));
      const top1PercentAmounts = amounts.slice(0, top1PercentCount);
      const whaleWeight = top1PercentAmounts.reduce((sum, amt) => sum + amt, 0) / totalAmount;

      // 2. Nakamoto Coefficient (50% Coordination Threshold)
      let nakamotoRunningTotal = 0;
      let nakamotoCoefficient = 0;
      const halfTotal = totalAmount * 0.5;
      for (const amount of amounts) {
        nakamotoRunningTotal += amount;
        nakamotoCoefficient++;
        if (nakamotoRunningTotal >= halfTotal) {
          break;
        }
      }

      // Get current analysis from KV
      const currentAnalysis = await env.MEMBER_DATA.get(
        `itemized_analysis_v2:${bioguideId}`,
        'json'
      );

      if (!currentAnalysis) {
        return Response.json({
          error: 'No analysis found in KV',
          bioguideId,
          calculated: { whaleWeight, nakamotoCoefficient, uniqueDonors: N, totalAmount }
        });
      }

      // Update with new metrics
      const updatedAnalysis = {
        ...currentAnalysis,
        whaleWeight,
        nakamotoCoefficient,
        lastUpdated: new Date().toISOString(),
        recalculatedAt: new Date().toISOString()
      };

      // Remove old deprecated metrics if they exist
      delete updatedAnalysis.gini;
      delete updatedAnalysis.hhi;

      // Save back to KV
      await env.MEMBER_DATA.put(
        `itemized_analysis_v2:${bioguideId}`,
        JSON.stringify(updatedAnalysis)
      );

      return Response.json({
        bioguideId,
        status: 'updated',
        old: {
          gini: currentAnalysis.gini,
          hhi: currentAnalysis.hhi
        },
        new: {
          whaleWeight,
          nakamotoCoefficient
        },
        interpretation: {
          whaleWeight: `${(whaleWeight * 100).toFixed(2)}% of funding from top ${top1PercentCount} donors (top 1%)`,
          nakamotoCoefficient: `${nakamotoCoefficient} donors needed to control 50% of funding`,
          captureRisk: nakamotoCoefficient < 100 ? 'HIGH - small group can coordinate' :
                       nakamotoCoefficient < 1000 ? 'MODERATE - requires organization' :
                       'LOW - coordination nearly impossible'
        },
        uniqueDonors: N,
        totalAmount
      });

    } catch (error) {
      return Response.json({
        error: error.message,
        stack: error.stack
      }, { status: 500 });
    }
  }
};
