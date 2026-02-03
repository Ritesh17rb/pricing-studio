/**
 * Scenario Engine Module
 * Simulate pricing scenarios and forecast KPIs
 *
 * Dependencies: elasticity-model.js, data-loader.js, pyodide-bridge.js
 */

import {
  forecastDemand,
  forecastChurn,
  forecastAcquisition,
  calculateElasticity
} from './elasticity-model.js';

import { getWeeklyData, getCurrentPrices, loadElasticityParams } from './data-loader.js';

import { pyodideBridge } from './pyodide-bridge.js';

/**
 * Simulate a pricing scenario
 * @param {Object} scenario - Scenario configuration
 * @param {Object} options - Additional options {timeHorizon, startDate}
 * @returns {Promise<Object>} Simulation results
 */
export async function simulateScenario(scenario, options = {}) {
  // Handle baseline "Do Nothing" scenario (tier="all")
  if (scenario.config.tier === 'all') {
    console.log('Baseline scenario detected - returning current state');
    return await simulateBaselineScenario(scenario, options);
  }

  // Check if this is a segment-targeted scenario
  if (options.targetSegment && options.targetSegment !== 'all') {
    console.log('Delegating to segment-targeted simulation');
    return simulateSegmentScenario(scenario, options);
  }

  const timeHorizon = options.timeHorizon || 'medium_term_3_12mo';

  try {
    console.log('Simulating scenario:', scenario.id, 'for tier:', scenario.config.tier);

    // Map new/hypothetical tiers to proxy tiers for baseline data
    const tierMap = {
      'basic': 'ad_supported',  // Basic tier uses ad_supported as proxy
      'premium': 'ad_free',      // Premium tier uses ad_free as proxy
      'bundle': 'ad_free'        // Bundle uses ad_free (already handled)
    };

    const baselineTier = tierMap[scenario.config.tier] || scenario.config.tier;
    // Only "basic" and "premium" are truly new tiers; "bundle" is just a pricing variation of ad_free
    const isNewTier = (scenario.config.tier === 'basic' || scenario.config.tier === 'premium');

    if (tierMap[scenario.config.tier] && isNewTier) {
      console.log(`⚠️ New tier "${scenario.config.tier}" - using "${baselineTier}" as baseline proxy`);
    }

    // Get baseline data (pass scenario for bundle handling)
    const baseline = await getBaselineMetrics(baselineTier, scenario);
    console.log('Baseline metrics retrieved:', baseline);

    // Calculate elasticity for this scenario (use baseline tier for new tiers)
    const elasticityInfo = await calculateElasticity(
      baselineTier,
      null,
      { timeHorizon }
    );

    // Calculate price change percentage
    const priceChangePct = (scenario.config.new_price - scenario.config.current_price) / scenario.config.current_price;

    // Forecast demand
    const demandForecast = forecastDemand(
      scenario.config.current_price,
      scenario.config.new_price,
      baseline.activeSubscribers,
      elasticityInfo.elasticity
    );

    // Forecast churn
    const churnForecast = await forecastChurn(
      scenario.config.tier,
      priceChangePct,
      baseline.churnRate
    );

    // Forecast acquisition
    const acquisitionForecast = await forecastAcquisition(
      scenario.config.tier,
      priceChangePct,
      baseline.newSubscribers
    );

    console.log('📊 Acquisition Forecast:', {
      tier: scenario.config.tier,
      baseline: baseline.newSubscribers,
      forecasted: acquisitionForecast.forecastedAcquisition,
      change: acquisitionForecast.change,
      changePercent: acquisitionForecast.changePercent
    });

    // Calculate revenue impact
    const revenueImpact = calculateRevenueImpact(
      demandForecast.forecastedSubscribers,
      scenario.config.new_price,
      baseline.activeSubscribers,
      scenario.config.current_price
    );

    // Calculate ARPU
    const forecastedARPU = scenario.config.new_price;
    const arpuChange = forecastedARPU - baseline.arpu;

    // Calculate ARPU percentage change, handling zero baseline
    let arpuChangePct = 0;
    if (baseline.arpu > 0) {
      arpuChangePct = (arpuChange / baseline.arpu) * 100;
    } else if (arpuChange !== 0) {
      // If baseline ARPU is 0 but there's a change, use a very large number to indicate significant change
      arpuChangePct = arpuChange > 0 ? 100 : -100;
    }

    // Estimate CLTV (simplified: ARPU × average lifetime months)
    const avgLifetimeMonths = 24; // Assumption
    const forecastedCLTV = forecastedARPU * avgLifetimeMonths;
    const baselineCLTV = baseline.arpu * avgLifetimeMonths;

    // Calculate net adds (new acquisitions - churn)
    const forecastedChurnCount = Math.round(demandForecast.forecastedSubscribers * churnForecast.forecastedChurn);
    const forecastedNetAdds = acquisitionForecast.forecastedAcquisition - forecastedChurnCount;
    const baselineNetAdds = baseline.newSubscribers - Math.round(baseline.activeSubscribers * baseline.churnRate);

    // Generate time series forecast (12 months)
    const timeSeries = generateTimeSeries(
      demandForecast,
      churnForecast,
      acquisitionForecast,
      scenario.config.new_price,
      12
    );

    // Compile results
    const result = {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      model_type: scenario.model_type,
      elasticity: elasticityInfo.elasticity,
      confidence_interval: elasticityInfo.confidenceInterval,

      baseline: {
        subscribers: baseline.activeSubscribers,
        churn_rate: baseline.churnRate,
        new_subscribers: baseline.newSubscribers,
        revenue: baseline.revenue,
        arpu: baseline.arpu,
        cltv: baselineCLTV,
        net_adds: baselineNetAdds
      },

      forecasted: {
        subscribers: demandForecast.forecastedSubscribers,
        churn_rate: churnForecast.forecastedChurn,
        new_subscribers: acquisitionForecast.forecastedAcquisition,
        revenue: revenueImpact.forecastedRevenue,
        arpu: forecastedARPU,
        cltv: forecastedCLTV,
        net_adds: forecastedNetAdds
      },

      delta: {
        subscribers: demandForecast.change,
        subscribers_pct: demandForecast.percentChange,
        churn_rate: churnForecast.change,
        churn_rate_pct: churnForecast.changePercent,
        new_subscribers: acquisitionForecast.change,
        new_subscribers_pct: acquisitionForecast.changePercent,
        revenue: revenueImpact.change,
        revenue_pct: revenueImpact.percentChange,
        arpu: arpuChange,
        arpu_pct: arpuChangePct,
        cltv: forecastedCLTV - baselineCLTV,
        cltv_pct: baselineCLTV > 0 ? ((forecastedCLTV - baselineCLTV) / baselineCLTV) * 100 : 0,
        net_adds: forecastedNetAdds - baselineNetAdds
      },

      time_series: timeSeries,

      warnings: generateWarnings(scenario, churnForecast, demandForecast),

      constraints_met: checkConstraints(scenario)
    };

    return result;

  } catch (error) {
    console.error('Error simulating scenario:', error);
    throw error;
  }
}

/**
 * Simulate baseline "Do Nothing" scenario
 * Returns current state across all tiers with no changes
 * @param {Object} scenario - Baseline scenario configuration
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Baseline simulation results
 */
async function simulateBaselineScenario(scenario, options = {}) {
  try {
    // Get current data for all three main tiers
    const tiers = ['ad_supported', 'ad_free'];
    const weeklyData = await getWeeklyData('all');

    // Calculate aggregated metrics across all tiers
    let totalSubs = 0;
    let totalRevenue = 0;
    let weightedChurnRate = 0;
    let weightedNewSubs = 0;

    for (const tier of tiers) {
      const tierData = weeklyData.filter(d => d.tier === tier);
      const latestWeek = tierData[tierData.length - 1];

      if (latestWeek) {
        totalSubs += latestWeek.active_subscribers;
        totalRevenue += latestWeek.revenue;
        weightedChurnRate += latestWeek.churn_rate * latestWeek.active_subscribers;
        weightedNewSubs += latestWeek.new_subscribers;
      }
    }

    const avgChurnRate = weightedChurnRate / totalSubs;
    const avgARPU = totalRevenue / totalSubs;
    const avgLifetimeMonths = 24;
    const baselineCLTV = avgARPU * avgLifetimeMonths;
    const baselineNetAdds = weightedNewSubs - Math.round(totalSubs * avgChurnRate);

    // Generate time series (no change over time for baseline)
    const timeSeries = [];
    for (let month = 0; month <= 12; month++) {
      timeSeries.push({
        month,
        subscribers: Math.round(totalSubs),
        revenue: Math.round(totalRevenue),
        churn_rate: avgChurnRate
      });
    }

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      elasticity: 0, // No price change
      confidence_interval: [0, 0],

      baseline: {
        subscribers: totalSubs,
        churn_rate: avgChurnRate,
        new_subscribers: weightedNewSubs,
        revenue: totalRevenue,
        arpu: avgARPU,
        cltv: baselineCLTV,
        net_adds: baselineNetAdds
      },

      forecasted: {
        subscribers: totalSubs,
        churn_rate: avgChurnRate,
        new_subscribers: weightedNewSubs,
        revenue: totalRevenue,
        arpu: avgARPU,
        cltv: baselineCLTV,
        net_adds: baselineNetAdds
      },

      delta: {
        subscribers: 0,
        subscribers_pct: 0,
        churn_rate: 0,
        churn_rate_pct: 0,
        new_subscribers: 0,
        new_subscribers_pct: 0,
        revenue: 0,
        revenue_pct: 0,
        arpu: 0,
        arpu_pct: 0,
        cltv: 0,
        cltv_pct: 0,
        net_adds: 0
      },

      time_series: timeSeries,

      warnings: ['This is a baseline scenario with no changes to pricing or strategy'],

      constraints_met: true
    };
  } catch (error) {
    console.error('Error simulating baseline scenario:', error);
    throw error;
  }
}

/**
 * Get baseline metrics for a tier
 * @param {string} tier - Tier name
 * @param {Object} scenario - Scenario object (for special handling)
 * @returns {Promise<Object>} Baseline metrics
 */
async function getBaselineMetrics(tier, scenario = null) {
  // Special handling for bundle scenarios
  if (tier === 'bundle') {
    console.log('Bundle scenario detected - using ad_free tier as baseline');

    // Use ad_free tier as baseline since bundle includes service ad-free
    const weeklyData = await getWeeklyData('ad_free');

    if (!weeklyData || weeklyData.length === 0) {
      throw new Error('No data available for ad_free tier (needed for bundle baseline)');
    }

    const latestWeek = weeklyData[weeklyData.length - 1];

    // For bundle scenarios, estimate potential bundle subscribers as a percentage of ad_free
    // Assumption: ~30% of ad_free users might be interested in bundle
    const bundlePotentialPct = 0.30;
    const estimatedBundleSubs = Math.round((latestWeek.active_subscribers || 0) * bundlePotentialPct);

    // Bundle baseline ARPU should be the CURRENT price, not the new price
    const bundleCurrentARPU = scenario?.config?.current_price || 14.99;

    return {
      activeSubscribers: estimatedBundleSubs,
      churnRate: (latestWeek.churn_rate || 0) * 0.7, // Bundles typically have lower churn
      newSubscribers: Math.round((latestWeek.new_subscribers || 0) * bundlePotentialPct),
      revenue: estimatedBundleSubs * bundleCurrentARPU,
      arpu: bundleCurrentARPU,
      isBundle: true,
      baseTier: 'ad_free'
    };
  }

  // Regular tier handling
  const weeklyData = await getWeeklyData(tier);

  if (!weeklyData || weeklyData.length === 0) {
    throw new Error(`No data available for tier: ${tier}. Please ensure data is loaded correctly.`);
  }

  const latestWeek = weeklyData[weeklyData.length - 1];

  if (!latestWeek) {
    throw new Error(`Unable to retrieve latest week data for tier: ${tier}`);
  }

  // Calculate ARPU if not available or is zero
  let arpu = latestWeek.arpu || 0;
  if (arpu === 0 && latestWeek.revenue && latestWeek.active_subscribers > 0) {
    arpu = latestWeek.revenue / latestWeek.active_subscribers;
    console.log(`Calculated ARPU from revenue/subscribers: ${arpu.toFixed(2)}`);
  }

  return {
    activeSubscribers: latestWeek.active_subscribers || 0,
    churnRate: latestWeek.churn_rate || 0,
    newSubscribers: latestWeek.new_subscribers || 0,
    revenue: latestWeek.revenue || 0,
    arpu: arpu,
    isBundle: false
  };
}

/**
 * Calculate revenue impact
 * @param {number} forecastedSubs - Forecasted subscriber count
 * @param {number} newPrice - New price
 * @param {number} baselineSubs - Baseline subscriber count
 * @param {number} currentPrice - Current price
 * @returns {Object} Revenue impact
 */
function calculateRevenueImpact(forecastedSubs, newPrice, baselineSubs, currentPrice) {
  // Monthly revenue = subscribers × price
  const forecastedRevenue = forecastedSubs * newPrice;
  const baselineRevenue = baselineSubs * currentPrice;
  const change = forecastedRevenue - baselineRevenue;
  const percentChange = (change / baselineRevenue) * 100;

  return {
    baselineRevenue,
    forecastedRevenue,
    change,
    percentChange
  };
}

/**
 * Generate time series forecast
 * @param {Object} demandForecast - Demand forecast object
 * @param {Object} churnForecast - Churn forecast object
 * @param {Object} acquisitionForecast - Acquisition forecast object
 * @param {number} newPrice - New price
 * @param {number} months - Number of months to forecast
 * @returns {Array} Time series data
 */
function generateTimeSeries(demandForecast, churnForecast, acquisitionForecast, newPrice, months) {
  const series = [];
  let currentSubs = demandForecast.baseSubscribers;

  for (let month = 0; month <= months; month++) {
    // Month 0 is baseline
    if (month === 0) {
      series.push({
        month: 0,
        subscribers: currentSubs,
        revenue: currentSubs * (newPrice / (1 + (demandForecast.priceChangePct / 100))),
        churn_rate: churnForecast.baselineChurn
      });
      continue;
    }

    // Apply changes gradually over time
    const progressFactor = Math.min(month / 3, 1); // Full effect after 3 months

    // Calculate subscriber change
    const totalChange = demandForecast.forecastedSubscribers - demandForecast.baseSubscribers;
    currentSubs = demandForecast.baseSubscribers + (totalChange * progressFactor);

    // Calculate churn for this month
    const churnChange = churnForecast.forecastedChurn - churnForecast.baselineChurn;
    const monthChurnRate = churnForecast.baselineChurn + (churnChange * progressFactor);

    // Revenue
    const revenue = currentSubs * newPrice;

    series.push({
      month,
      subscribers: Math.round(currentSubs),
      revenue: Math.round(revenue),
      churn_rate: monthChurnRate
    });
  }

  return series;
}

/**
 * Generate time series forecast for segment scenarios
 * @param {Object} baseline - Baseline tier metrics
 * @param {Object} forecasted - Forecasted tier metrics
 * @param {number} forecastedChurn - Forecasted churn rate
 * @param {number} baselineChurn - Baseline churn rate
 * @param {number} months - Number of months to forecast
 * @returns {Array} Time series data
 */
function generateTimeSeriesForSegment(baseline, forecasted, forecastedChurn, baselineChurn, months) {
  const series = [];

  for (let month = 0; month <= months; month++) {
    // Month 0 is baseline
    if (month === 0) {
      series.push({
        month: 0,
        subscribers: Math.round(baseline.subscribers),
        revenue: Math.round(baseline.revenue),
        churn_rate: baselineChurn
      });
      continue;
    }

    // Apply changes gradually over time
    const progressFactor = Math.min(month / 3, 1); // Full effect after 3 months

    // Calculate subscriber change
    const totalSubsChange = forecasted.subscribers - baseline.subscribers;
    const currentSubs = baseline.subscribers + (totalSubsChange * progressFactor);

    // Calculate revenue change
    const totalRevenueChange = forecasted.revenue - baseline.revenue;
    const currentRevenue = baseline.revenue + (totalRevenueChange * progressFactor);

    // Calculate churn for this month
    const churnChange = forecastedChurn - baselineChurn;
    const monthChurnRate = baselineChurn + (churnChange * progressFactor);

    series.push({
      month,
      subscribers: Math.round(currentSubs),
      revenue: Math.round(currentRevenue),
      churn_rate: monthChurnRate
    });
  }

  return series;
}

/**
 * Generate warnings based on scenario results
 * @param {Object} scenario - Scenario configuration
 * @param {Object} churnForecast - Churn forecast
 * @param {Object} demandForecast - Demand forecast
 * @returns {Array} Array of warning messages
 */
function generateWarnings(scenario, churnForecast, demandForecast) {
  const warnings = [];

  // Warn if churn increases significantly
  if (churnForecast.changePercent > 10) {
    warnings.push(`Churn rate increases by ${churnForecast.changePercent.toFixed(1)}% (exceeds 10% threshold)`);
  }

  // Warn if subscriber loss is significant
  if (demandForecast.percentChange < -5) {
    warnings.push(`Subscriber base decreases by ${Math.abs(demandForecast.percentChange).toFixed(1)}% (exceeds 5% threshold)`);
  }

  // Warn about large price increases
  const priceChangePct = ((scenario.config.new_price - scenario.config.current_price) / scenario.config.current_price) * 100;
  if (priceChangePct > 20) {
    warnings.push(`Price increase of ${priceChangePct.toFixed(1)}% may be too aggressive`);
  }

  return warnings;
}

/**
 * Check if scenario meets platform and policy constraints
 * @param {Object} scenario - Scenario object
 * @returns {boolean} True if constraints are met
 */
function checkConstraints(scenario) {
  if (!scenario.constraints) return true;

  // Check all constraint flags
  const constraintChecks = [
    scenario.constraints.platform_compliant,
    scenario.constraints.price_change_12mo_limit !== false, // May be missing
    scenario.constraints.notice_period_30d !== false
  ];

  return constraintChecks.every(check => check === true);
}

/**
 * Compare multiple scenarios
 * @param {Array} scenarios - Array of scenario objects
 * @returns {Promise<Array>} Array of simulation results
 */
export async function compareScenarios(scenarios) {
  const results = [];

  for (const scenario of scenarios) {
    try {
      const result = await simulateScenario(scenario);
      results.push(result);
    } catch (error) {
      console.error(`Error simulating scenario ${scenario.id}:`, error);
      results.push({
        scenario_id: scenario.id,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Rank scenarios by objective function
 * @param {Array} results - Array of simulation results
 * @param {string} objective - Objective ('revenue', 'growth', 'balanced')
 * @returns {Array} Ranked results
 */
export function rankScenarios(results, objective = 'balanced') {
  const validResults = results.filter(r => !r.error);

  const scored = validResults.map(result => {
    let score = 0;

    switch (objective) {
      case 'revenue':
        // Maximize revenue growth
        score = result.delta.revenue_pct;
        break;

      case 'growth':
        // Maximize subscriber growth
        score = result.delta.subscribers_pct;
        break;

      case 'balanced':
        // Balance revenue and subscriber growth
        score = (result.delta.revenue_pct * 0.6) + (result.delta.subscribers_pct * 0.4);
        // Penalize high churn
        if (result.delta.churn_rate_pct > 10) {
          score -= 10;
        }
        break;

      default:
        score = result.delta.revenue_pct;
    }

    return { ...result, score };
  });

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Export scenario result to CSV-compatible format
 * @param {Object} result - Simulation result
 * @returns {Object} Flattened result for CSV export
 */
export function exportScenarioResult(result) {
  return {
    scenario_id: result.scenario_id,
    scenario_name: result.scenario_name,
    elasticity: result.elasticity,

    baseline_subscribers: result.baseline.subscribers,
    baseline_revenue: result.baseline.revenue,
    baseline_churn_rate: result.baseline.churn_rate,
    baseline_arpu: result.baseline.arpu,

    forecasted_subscribers: result.forecasted.subscribers,
    forecasted_revenue: result.forecasted.revenue,
    forecasted_churn_rate: result.forecasted.churn_rate,
    forecasted_arpu: result.forecasted.arpu,

    delta_subscribers: result.delta.subscribers,
    delta_subscribers_pct: result.delta.subscribers_pct,
    delta_revenue: result.delta.revenue,
    delta_revenue_pct: result.delta.revenue_pct,
    delta_churn_rate: result.delta.churn_rate,

    warnings: result.warnings.join('; '),
    constraints_met: result.constraints_met
  };
}

// ========== Segment-Targeted Scenario Simulation ==========

/**
 * Simulate a pricing scenario for a specific customer segment
 * @param {Object} scenario - Scenario configuration
 * @param {Object} options - { targetSegment, segmentAxis }
 * @returns {Promise<Object>} Simulation results with segment breakdown
 */
export async function simulateSegmentScenario(scenario, options = {}) {
  const { targetSegment, segmentAxis } = options;

  console.log('Simulating segment-targeted scenario:', { targetSegment, segmentAxis });

  // Validate segment targeting
  if (!targetSegment || targetSegment === 'all') {
    throw new Error('simulateSegmentScenario requires a specific targetSegment');
  }

  const tier = scenario.config.tier;
  const currentPrice = scenario.config.current_price;
  const newPrice = scenario.config.new_price;
  const priceChangePct = (newPrice - currentPrice) / currentPrice;

  // Handle bundle tier - use ad_free as base tier for segment data
  // since bundle includes service ad-free
  const segmentTier = tier === 'bundle' ? 'ad_free' : tier;

  try {
    // Get segment-specific data (using segmentTier for lookups)
    const segmentElasticity = await getSegmentElasticity(segmentTier, targetSegment, segmentAxis);
    const segmentBaseline = await getSegmentBaseline(segmentTier, targetSegment, segmentAxis);

    console.log('Segment elasticity:', segmentElasticity);
    console.log('Segment baseline:', segmentBaseline);

    // Calculate direct impact on targeted segment
    const demandChangePct = segmentElasticity * priceChangePct;
    const forecastedSubscribers = Math.round(segmentBaseline.subscribers * (1 + demandChangePct));
    const forecastedRevenue = forecastedSubscribers * newPrice;

    // Estimate churn impact
    const churnMultiplier = 1 + (segmentElasticity * 0.15 * priceChangePct); // 15% of elasticity affects churn
    const forecastedChurn = segmentBaseline.churn_rate * churnMultiplier;

    // Calculate segment impact
    const segmentImpact = {
      baseline: segmentBaseline,
      forecasted: {
        subscribers: forecastedSubscribers,
        revenue: forecastedRevenue,
        churn_rate: forecastedChurn,
        arpu: newPrice
      },
      delta: {
        subscribers: forecastedSubscribers - segmentBaseline.subscribers,
        subscribers_pct: demandChangePct * 100,
        revenue: forecastedRevenue - segmentBaseline.revenue,
        revenue_pct: ((forecastedRevenue - segmentBaseline.revenue) / segmentBaseline.revenue) * 100,
        churn_rate: forecastedChurn - segmentBaseline.churn_rate,
        churn_rate_pct: ((forecastedChurn - segmentBaseline.churn_rate) / segmentBaseline.churn_rate) * 100
      },
      elasticity: segmentElasticity
    };

    // Estimate spillover effects on other segments (use segmentTier for data lookups)
    const spilloverEffects = await estimateSpilloverEffects(
      segmentTier,
      targetSegment,
      priceChangePct,
      demandChangePct,
      segmentBaseline.subscribers
    );

    // Calculate tier-level totals including spillovers (use segmentTier for data lookups)
    const tierImpact = await calculateTierTotals(segmentTier, {
      targetSegment,
      segmentBaseline,
      segmentForecasted: segmentImpact.forecasted,
      spilloverEffects: spilloverEffects.details
    });

    // Generate warnings
    const warnings = [];
    if (tier === 'bundle') {
      warnings.push(`Note: Bundle scenario uses ad_free tier segment data as baseline (bundle includes service ad-free)`);
    }
    if (Math.abs(priceChangePct) > 0.15) {
      warnings.push(`Large price change (${(priceChangePct * 100).toFixed(1)}%) may have unpredictable effects`);
    }
    if (Math.abs(demandChangePct) > 0.25) {
      warnings.push(`High demand sensitivity: ${(Math.abs(demandChangePct) * 100).toFixed(1)}% change expected`);
    }
    if (forecastedChurn > 0.20) {
      warnings.push(`High churn risk: ${(forecastedChurn * 100).toFixed(1)}%`);
    }
    if (spilloverEffects.total_migration > segmentBaseline.subscribers * 0.15) {
      warnings.push(`Significant spillover effects: ~${spilloverEffects.total_migration.toLocaleString()} subscribers may migrate`);
    }

    // Generate time series forecast for tier-level totals (12 months)
    const timeSeries = generateTimeSeriesForSegment(
      tierImpact.baseline,
      tierImpact.forecasted,
      forecastedChurn,
      segmentBaseline.churn_rate,
      12
    );

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      tier,
      target_segment: targetSegment,
      segment_axis: segmentAxis || 'auto-detected',

      // Segment-specific results
      segment_impact: segmentImpact,

      // Spillover effects
      spillover_effects: spilloverEffects.details,
      spillover_summary: {
        total_migration: spilloverEffects.total_migration,
        net_tier_change: spilloverEffects.net_tier_change
      },

      // Tier-level totals
      tier_impact: tierImpact,

      // Time series forecast
      time_series: timeSeries,

      // For compatibility with regular scenario display
      baseline: tierImpact.baseline,
      forecasted: tierImpact.forecasted,
      delta: tierImpact.delta,

      // Metadata
      elasticity: segmentElasticity,
      price_change_pct: priceChangePct * 100,
      warnings,
      constraints_met: warnings.length === 0,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error simulating segment scenario:', error);
    throw error;
  }
}

/**
 * Get elasticity for a specific segment
 * @param {string} tier - Tier name
 * @param {string} segmentId - Segment identifier
 * @param {string} axis - Optional axis override
 * @returns {Promise<number>} Elasticity value
 */
async function getSegmentElasticity(tier, segmentId, axis) {
  // Check if segmentEngine has elasticity data
  if (!window.segmentEngine || !window.segmentEngine.segmentElasticity) {
    console.warn('Segment elasticity data not available, using tier-level fallback');
    const params = await loadElasticityParams();
    return params.tiers[tier]?.base_elasticity || -2.0;
  }

  const tierData = window.segmentEngine.segmentElasticity[tier];
  if (!tierData || !tierData.segment_elasticity) {
    console.warn('No segment elasticity for tier:', tier);
    const params = await loadElasticityParams();
    return params.tiers[tier]?.base_elasticity || -2.0;
  }

  // Find segments matching the target segment ID
  const matchingKeys = Object.keys(tierData.segment_elasticity).filter(key => {
    const parts = key.split('|');
    return parts.includes(segmentId);
  });

  if (matchingKeys.length === 0) {
    console.warn('No matching segment found for:', segmentId);
    const params = await loadElasticityParams();
    return params.tiers[tier]?.base_elasticity || -2.0;
  }

  // Use the first matching segment's elasticity
  const compositeKey = matchingKeys[0];
  const segmentData = tierData.segment_elasticity[compositeKey];

  // Determine which axis to use
  let axisKey = axis ? `${axis}_axis` : null;

  // Auto-detect axis if not specified
  if (!axisKey) {
    // Check which position the segment appears in
    const parts = compositeKey.split('|');
    const position = parts.indexOf(segmentId);

    if (position === 0) axisKey = 'acquisition_axis';
    else if (position === 1) axisKey = 'engagement_axis';
    else if (position === 2) axisKey = 'monetization_axis';
    else axisKey = 'engagement_axis'; // Default
  }

  const elasticity = segmentData[axisKey]?.elasticity;

  if (elasticity !== undefined) {
    console.log(`Using segment elasticity: ${elasticity} for ${segmentId} (${axisKey})`);
    return elasticity;
  }

  // Fallback to tier-level
  console.warn('Could not find segment elasticity, using tier-level');
  const params = await loadElasticityParams();
  return params.tiers[tier]?.base_elasticity || -2.0;
}

/**
 * Get baseline metrics for a specific segment
 * @param {string} tier - Tier name
 * @param {string} segmentId - Segment identifier
 * @param {string} axis - Optional axis
 * @returns {Promise<Object>} Baseline metrics
 */
async function getSegmentBaseline(tier, segmentId, axis) {
  if (!window.segmentEngine) {
    throw new Error('Segment engine not initialized');
  }

  const segments = window.segmentEngine.getSegmentsForTier(tier);

  // Filter segments that match the target segment ID on any axis
  const matchingSegments = segments.filter(s =>
    s.acquisition === segmentId ||
    s.engagement === segmentId ||
    s.monetization === segmentId
  );

  if (matchingSegments.length === 0) {
    throw new Error(`No data found for segment: ${segmentId} in tier: ${tier}`);
  }

  console.log(`Found ${matchingSegments.length} matching segments for ${segmentId}`);

  // Aggregate across matching segments
  const totalSubscribers = matchingSegments.reduce((sum, s) =>
    sum + parseInt(s.subscriber_count || 0), 0);

  const weightedChurnRate = matchingSegments.reduce((sum, s) => {
    const subs = parseInt(s.subscriber_count || 0);
    const churn = parseFloat(s.avg_churn_rate || 0);
    return sum + (churn * subs);
  }, 0) / totalSubscribers;

  const weightedArpu = matchingSegments.reduce((sum, s) => {
    const subs = parseInt(s.subscriber_count || 0);
    const arpu = parseFloat(s.avg_arpu || 0);
    return sum + (arpu * subs);
  }, 0) / totalSubscribers;

  const revenue = totalSubscribers * weightedArpu;

  return {
    subscribers: totalSubscribers,
    churn_rate: weightedChurnRate,
    arpu: weightedArpu,
    revenue,
    segment_count: matchingSegments.length
  };
}

/**
 * Estimate spillover effects on other segments (migration patterns)
 * @param {string} tier - Tier name
 * @param {string} targetSegment - Target segment ID
 * @param {number} priceChangePct - Price change percentage
 * @param {number} demandChangePct - Demand change percentage for target
 * @param {number} targetSubscribers - Target segment subscribers
 * @returns {Promise<Object>} Spillover effects
 */
async function estimateSpilloverEffects(tier, targetSegment, priceChangePct, demandChangePct, targetSubscribers) {
  if (!window.segmentEngine) {
    return { details: [], total_migration: 0, net_tier_change: 0 };
  }

  const allSegments = window.segmentEngine.getSegmentsForTier(tier);
  const spillovers = [];

  // Simplified migration model: some churned customers move to other segments
  // Migration rate is proportional to demand change, capped at 10%
  const migrationRate = Math.min(Math.abs(demandChangePct) * 0.25, 0.10); // Max 10% migration
  const totalMigrants = Math.round(targetSubscribers * migrationRate);

  // Distribute migrants across other segments (weighted by their size)
  const otherSegments = allSegments.filter(s =>
    s.acquisition !== targetSegment &&
    s.engagement !== targetSegment &&
    s.monetization !== targetSegment
  );

  const totalOtherSubs = otherSegments.reduce((sum, s) =>
    sum + parseInt(s.subscriber_count || 0), 0);

  for (const seg of otherSegments) {
    const segSubs = parseInt(seg.subscriber_count || 0);
    const weight = segSubs / totalOtherSubs;

    // Migration direction: price increase -> outflow, price decrease -> inflow
    const direction = priceChangePct > 0 ? -1 : 1;
    const deltaSubscribers = Math.round(totalMigrants * weight * direction);

    if (deltaSubscribers !== 0) {
      spillovers.push({
        compositeKey: seg.compositeKey,
        baseline_subscribers: segSubs,
        delta_subscribers: deltaSubscribers,
        delta_pct: (deltaSubscribers / segSubs) * 100
      });
    }
  }

  // Sort by absolute impact
  spillovers.sort((a, b) => Math.abs(b.delta_subscribers) - Math.abs(a.delta_subscribers));

  // Calculate net tier change from spillover
  const netTierChange = spillovers.reduce((sum, s) => sum + s.delta_subscribers, 0);

  return {
    details: spillovers.slice(0, 10), // Top 10 affected segments
    total_migration: totalMigrants,
    net_tier_change: netTierChange
  };
}

/**
 * Calculate tier-level totals including segment impact and spillovers
 * @param {string} tier - Tier name
 * @param {Object} impactData - Segment and spillover data
 * @returns {Promise<Object>} Tier totals
 */
async function calculateTierTotals(tier, impactData) {
  if (!window.segmentEngine) {
    throw new Error('Segment engine not initialized');
  }

  const allSegments = window.segmentEngine.getSegmentsForTier(tier);

  // Calculate baseline tier totals
  const baselineSubscribers = allSegments.reduce((sum, s) =>
    sum + parseInt(s.subscriber_count || 0), 0);

  const baselineRevenue = allSegments.reduce((sum, s) => {
    const subs = parseInt(s.subscriber_count || 0);
    const arpu = parseFloat(s.avg_arpu || 0);
    return sum + (subs * arpu);
  }, 0);

  // Calculate forecasted tier totals
  const targetSegmentDelta = impactData.segmentForecasted.subscribers - impactData.segmentBaseline.subscribers;
  const spilloverDelta = impactData.spilloverEffects.reduce((sum, s) =>
    sum + (s.delta_subscribers || 0), 0);

  const forecastedSubscribers = baselineSubscribers + targetSegmentDelta + spilloverDelta;

  // Revenue calculation (simplified)
  const targetRevenueChange = impactData.segmentForecasted.revenue - impactData.segmentBaseline.revenue;
  const spilloverRevenueChange = impactData.spilloverEffects.reduce((sum, s) => {
    // Assume migrated subscribers keep similar ARPU
    const avgArpu = baselineRevenue / baselineSubscribers;
    return sum + (s.delta_subscribers * avgArpu);
  }, 0);

  const forecastedRevenue = baselineRevenue + targetRevenueChange + spilloverRevenueChange;
  const forecastedArpu = forecastedRevenue / forecastedSubscribers;

  return {
    baseline: {
      subscribers: baselineSubscribers,
      revenue: baselineRevenue,
      arpu: baselineRevenue / baselineSubscribers
    },
    forecasted: {
      subscribers: forecastedSubscribers,
      revenue: forecastedRevenue,
      arpu: forecastedArpu
    },
    delta: {
      subscribers: forecastedSubscribers - baselineSubscribers,
      subscribers_pct: ((forecastedSubscribers - baselineSubscribers) / baselineSubscribers) * 100,
      revenue: forecastedRevenue - baselineRevenue,
      revenue_pct: ((forecastedRevenue - baselineRevenue) / baselineRevenue) * 100
    }
  };
}

/**
 * NEW: Simulate scenario using Pyodide Python models
 * Uses real statistical models (Poisson, Logit, Multinomial Logit)
 * 
 * @param {Object} scenario - Scenario configuration
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Simulation results with Python model predictions
 */
export async function simulateScenarioWithPyodide(scenario, options = {}) {
  console.log('🐍 Simulating scenario with Pyodide Python models:', scenario.id);

  try {
    // Map new/hypothetical tiers to proxy tiers for baseline data
    const tierMap = {
      'basic': 'ad_supported',
      'premium': 'ad_free',
      'bundle': 'ad_free'
    };

    const baselineTier = tierMap[scenario.config.tier] || scenario.config.tier;
    // Only "basic" and "premium" are truly new tiers; "bundle" is just a pricing variation of ad_free
    const isNewTier = (scenario.config.tier === 'basic' || scenario.config.tier === 'premium');

    if (tierMap[scenario.config.tier] && isNewTier) {
      console.log(`⚠️ New tier "${scenario.config.tier}" - using "${baselineTier}" as baseline proxy`);
    }

    // Get baseline data
    const baseline = await getBaselineMetrics(baselineTier, scenario);

    // Prepare scenario for Python models
    const pythonScenario = {
      new_price: scenario.config.new_price,
      current_price: scenario.config.current_price,
      price_change_pct: ((scenario.config.new_price - scenario.config.current_price) / scenario.config.current_price) * 100,
      promotion: scenario.config.promotion,
      segment_elasticity: options.segmentElasticity || -1.8,
      baseline_churn: baseline.churnRate || 0.05,
      ad_supported_price: 5.99,  // TODO: Get from pricing data
      ad_free_price: 9.99
    };

    // Run Python model predictions in parallel
    const [acquisitionResult, churnResult, migrationResult] = await Promise.all([
      pyodideBridge.predictAcquisition(pythonScenario),
      pyodideBridge.predictChurn(pythonScenario),
      pyodideBridge.predictMigration(pythonScenario)
    ]);

    console.log('✅ Python predictions received:', {
      acquisition: acquisitionResult,
      churn: churnResult,
      migration: migrationResult
    });

    // Calculate forecasted KPIs using Python model outputs
    // Acquisition adds are absolute numbers (e.g., 5000 new subs)
    // Churn rate is a fraction (e.g., 0.05 = 5%)
    const churnedSubs = baseline.activeSubscribers * churnResult['0-4 Weeks'].churn_rate;
    const netAdds = acquisitionResult.predicted_adds - churnedSubs;

    const forecasted = {
      activeSubscribers: baseline.activeSubscribers + netAdds,
      revenue: baseline.revenue * (1 + (pythonScenario.price_change_pct / 100)),
      arpu: scenario.config.new_price,
      churnRate: churnResult['0-4 Weeks'].churn_rate,
      grossAdds: acquisitionResult.predicted_adds,
      netAdds: netAdds
    };

    // Calculate deltas
    const delta = {
      subscribers: forecasted.activeSubscribers - baseline.activeSubscribers,
      subscribers_pct: ((forecasted.activeSubscribers - baseline.activeSubscribers) / baseline.activeSubscribers) * 100,
      revenue: forecasted.revenue - baseline.revenue,
      revenue_pct: ((forecasted.revenue - baseline.revenue) / baseline.revenue) * 100,
      arpu: forecasted.arpu - baseline.arpu,
      arpu_pct: ((forecasted.arpu - baseline.arpu) / baseline.arpu) * 100,
      churn_rate: forecasted.churnRate - baseline.churnRate,
      churn_rate_pct: ((forecasted.churnRate - baseline.churnRate) / baseline.churnRate) * 100
    };

    // Build result object
    const result = {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      model_type: scenario.model_type,
      scenario_config: {
        ...scenario.config,
        baseline_tier: baselineTier  // Store proxy tier used for baseline
      },

      baseline: baseline,
      forecasted: forecasted,
      delta: delta,

      // Python model outputs
      python_models: {
        acquisition: acquisitionResult,
        churn: churnResult,
        migration: migrationResult
      },

      is_new_tier: isNewTier,  // Flag to indicate hypothetical tier
      model_source: 'pyodide-python',
      timestamp: new Date().toISOString()
    };

    return result;

  } catch (error) {
    console.error('❌ Pyodide simulation failed:', error);
    // Fallback to JavaScript simulation
    console.log('⚠️ Falling back to JavaScript simulation');
    return await simulateScenario(scenario, options);
  }
}

/**
 * Check if Pyodide models are available
 */
export function isPyodideAvailable() {
  return pyodideBridge.isReady();
}

/**
 * Initialize Pyodide models (call during app startup)
 */
export async function initializePyodideModels() {
  try {
    console.log('🚀 Initializing Pyodide models in background...');
    await pyodideBridge.loadModels();
    console.log('✅ Pyodide models ready');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Pyodide:', error);
    return false;
  }
}
