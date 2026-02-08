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

import { getDailyData, getWeeklyData, getCurrentPrices, loadElasticityParams } from './data-loader.js';

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
      'economy_pass': 'standard_pass',  // Economy tier uses standard_pass as proxy
      'vip_pass': 'premium_pass',       // VIP pass uses premium_pass as proxy (if not in data)
    };

    const baselineTier = tierMap[scenario.config.tier] || scenario.config.tier;
    // Only "economy_pass" is truly a new tier
    const isNewTier = (scenario.config.tier === 'economy_pass');

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
      baseline.activeVisitors,
      elasticityInfo.elasticity
    );

    // Forecast return rate (inverse of churn)
    const returnRateForecast = await forecastChurn(
      scenario.config.tier,
      priceChangePct,
      baseline.returnRate
    );

    // Forecast new visits (acquisition)
    const newVisitsForecast = await forecastAcquisition(
      scenario.config.tier,
      priceChangePct,
      baseline.newVisitors
    );

    console.log('📊 New Visits Forecast:', {
      tier: scenario.config.tier,
      baseline: baseline.newVisitors,
      forecasted: newVisitsForecast.forecastedAcquisition,
      change: newVisitsForecast.change,
      changePercent: newVisitsForecast.changePercent
    });

    // Calculate revenue impact
    const revenueImpact = calculateRevenueImpact(
      demandForecast.forecastedVisitors,
      scenario.config.new_price,
      baseline.activeVisitors,
      scenario.config.current_price
    );

    // Calculate ARPV (Average Revenue Per Visitor)
    const forecastedARPV = scenario.config.new_price;
    const arpvChange = forecastedARPV - baseline.arpv;

    // Calculate ARPV percentage change, handling zero baseline
    let arpvChangePct = 0;
    if (baseline.arpv > 0) {
      arpvChangePct = (arpvChange / baseline.arpv) * 100;
    } else if (arpvChange !== 0) {
      // If baseline ARPV is 0 but there's a change, use a very large number to indicate significant change
      arpvChangePct = arpvChange > 0 ? 100 : -100;
    }

    // Estimate Lifetime Value (simplified: ARPV × average lifetime visits)
    const avgLifetimeVisits = 8; // Assumption: average visitor returns 8 times
    const forecastedLTV = forecastedARPV * avgLifetimeVisits;
    const baselineLTV = baseline.arpv * avgLifetimeVisits;

    // Calculate net adds (new visitors - non-returning visitors)
    const forecastedNonReturningCount = Math.round(demandForecast.forecastedVisitors * (1 - returnRateForecast.forecastedChurn));
    const forecastedNetAdds = newVisitsForecast.forecastedAcquisition - forecastedNonReturningCount;
    const baselineNetAdds = baseline.newVisitors - Math.round(baseline.activeVisitors * (1 - baseline.returnRate));

    // Generate time series forecast (12 months)
    const timeSeries = generateTimeSeries(
      demandForecast,
      returnRateForecast,
      newVisitsForecast,
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
        visitors: baseline.activeVisitors,
        return_rate: baseline.returnRate,
        new_visitors: baseline.newVisitors,
        revenue: baseline.revenue,
        arpv: baseline.arpv,
        ltv: baselineLTV,
        net_adds: baselineNetAdds
      },

      forecasted: {
        visitors: demandForecast.forecastedVisitors,
        return_rate: returnRateForecast.forecastedChurn,
        new_visitors: newVisitsForecast.forecastedAcquisition,
        revenue: revenueImpact.forecastedRevenue,
        arpv: forecastedARPV,
        ltv: forecastedLTV,
        net_adds: forecastedNetAdds
      },

      delta: {
        visitors: demandForecast.change,
        visitors_pct: demandForecast.percentChange,
        return_rate: returnRateForecast.change,
        return_rate_pct: returnRateForecast.changePercent,
        new_visitors: newVisitsForecast.change,
        new_visitors_pct: newVisitsForecast.changePercent,
        revenue: revenueImpact.change,
        revenue_pct: revenueImpact.percentChange,
        arpv: arpvChange,
        arpv_pct: arpvChangePct,
        ltv: forecastedLTV - baselineLTV,
        ltv_pct: baselineLTV > 0 ? ((forecastedLTV - baselineLTV) / baselineLTV) * 100 : 0,
        net_adds: forecastedNetAdds - baselineNetAdds
      },

      time_series: timeSeries,

      warnings: generateWarnings(scenario, returnRateForecast, demandForecast),

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
    const tiers = ['standard_pass', 'premium_pass', 'vip_pass'];
    const dailyData = await getDailyData('all');

    // Calculate aggregated metrics across all tiers
    let totalVisitors = 0;
    let totalRevenue = 0;
    let weightedReturnRate = 0;
    let weightedNewVisitors = 0;

    for (const tier of tiers) {
      const tierData = dailyData.filter(d => d.membership_tier === tier);
      const latestDay = tierData[tierData.length - 1];

      if (latestDay) {
        totalVisitors += latestDay.daily_visitors;
        totalRevenue += latestDay.daily_revenue;
        weightedReturnRate += latestDay.return_rate * latestDay.daily_visitors;
        weightedNewVisitors += latestDay.new_registrations;
      }
    }

    const avgReturnRate = weightedReturnRate / totalVisitors;
    const avgARPV = totalRevenue / totalVisitors;
    const avgLifetimeVisits = 8;
    const baselineLTV = avgARPV * avgLifetimeVisits;
    const baselineNetAdds = weightedNewVisitors - Math.round(totalVisitors * (1 - avgReturnRate));

    // Generate time series (no change over time for baseline)
    const timeSeries = [];
    for (let month = 0; month <= 12; month++) {
      timeSeries.push({
        month,
        visitors: Math.round(totalVisitors),
        revenue: Math.round(totalRevenue),
        return_rate: avgReturnRate
      });
    }

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      elasticity: 0, // No price change
      confidence_interval: [0, 0],

      baseline: {
        visitors: totalVisitors,
        return_rate: avgReturnRate,
        new_visitors: weightedNewVisitors,
        revenue: totalRevenue,
        arpv: avgARPV,
        ltv: baselineLTV,
        net_adds: baselineNetAdds
      },

      forecasted: {
        visitors: totalVisitors,
        return_rate: avgReturnRate,
        new_visitors: weightedNewVisitors,
        revenue: totalRevenue,
        arpv: avgARPV,
        ltv: baselineLTV,
        net_adds: baselineNetAdds
      },

      delta: {
        visitors: 0,
        visitors_pct: 0,
        return_rate: 0,
        return_rate_pct: 0,
        new_visitors: 0,
        new_visitors_pct: 0,
        revenue: 0,
        revenue_pct: 0,
        arpv: 0,
        arpv_pct: 0,
        ltv: 0,
        ltv_pct: 0,
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
  // Special handling for vip_pass scenarios
  if (tier === 'vip_pass') {
    console.log('VIP pass scenario detected - using premium_pass tier as baseline');

    // Use premium_pass tier as baseline since VIP is premium tier with enhancements
    const dailyData = await getDailyData('premium_pass');

    if (!dailyData || dailyData.length === 0) {
      throw new Error('No data available for premium_pass tier (needed for VIP baseline)');
    }

    const latestDay = dailyData[dailyData.length - 1];

    // For VIP scenarios, estimate potential VIP visitors as a percentage of premium
    // Assumption: ~25% of premium_pass users might be interested in VIP
    const vipPotentialPct = 0.25;
    const estimatedVIPVisitors = Math.round((latestDay.daily_visitors || 0) * vipPotentialPct);

    // VIP baseline ARPV should be the CURRENT price, not the new price
    const vipCurrentARPV = scenario?.config?.current_price || 249;

    return {
      activeVisitors: estimatedVIPVisitors,
      returnRate: (latestDay.return_rate || 0) * 1.15, // VIP typically has higher return rate
      newVisitors: Math.round((latestDay.new_registrations || 0) * vipPotentialPct),
      revenue: estimatedVIPVisitors * vipCurrentARPV,
      arpv: vipCurrentARPV,
      isVIP: true,
      baseTier: 'premium_pass'
    };
  }

  // Regular tier handling
  const dailyData = await getDailyData(tier);

  if (!dailyData || dailyData.length === 0) {
    throw new Error(`No data available for tier: ${tier}. Please ensure data is loaded correctly.`);
  }

  const latestDay = dailyData[dailyData.length - 1];

  if (!latestDay) {
    throw new Error(`Unable to retrieve latest day data for tier: ${tier}`);
  }

  // Calculate ARPV if not available or is zero
  let arpv = latestDay.arpv || 0;
  if (arpv === 0 && latestDay.daily_revenue && latestDay.daily_visitors > 0) {
    arpv = latestDay.daily_revenue / latestDay.daily_visitors;
    console.log(`Calculated ARPV from revenue/visitors: ${arpv.toFixed(2)}`);
  }

  return {
    activeVisitors: latestDay.daily_visitors || 0,
    returnRate: latestDay.return_rate || 0,
    newVisitors: latestDay.new_registrations || 0,
    revenue: latestDay.daily_revenue || 0,
    arpv: arpv,
    isVIP: false
  };
}

/**
 * Calculate revenue impact
 * @param {number} forecastedVisitors - Forecasted visitor count
 * @param {number} newPrice - New price
 * @param {number} baselineVisitors - Baseline visitor count
 * @param {number} currentPrice - Current price
 * @returns {Object} Revenue impact
 */
function calculateRevenueImpact(forecastedVisitors, newPrice, baselineVisitors, currentPrice) {
  // Daily revenue = visitors × price
  const forecastedRevenue = forecastedVisitors * newPrice;
  const baselineRevenue = baselineVisitors * currentPrice;
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
 * @param {Object} returnRateForecast - Return rate forecast object
 * @param {Object} newVisitsForecast - New visits forecast object
 * @param {number} newPrice - New price
 * @param {number} months - Number of months to forecast
 * @returns {Array} Time series data
 */
function generateTimeSeries(demandForecast, returnRateForecast, newVisitsForecast, newPrice, months) {
  const series = [];
  let currentVisitors = demandForecast.baseVisitors;

  for (let month = 0; month <= months; month++) {
    // Month 0 is baseline
    if (month === 0) {
      series.push({
        month: 0,
        visitors: currentVisitors,
        revenue: currentVisitors * (newPrice / (1 + (demandForecast.priceChangePct / 100))),
        return_rate: returnRateForecast.baselineChurn
      });
      continue;
    }

    // Apply changes gradually over time
    const progressFactor = Math.min(month / 3, 1); // Full effect after 3 months

    // Calculate visitor change
    const totalChange = demandForecast.forecastedVisitors - demandForecast.baseVisitors;
    currentVisitors = demandForecast.baseVisitors + (totalChange * progressFactor);

    // Calculate return rate for this month
    const returnRateChange = returnRateForecast.forecastedChurn - returnRateForecast.baselineChurn;
    const monthReturnRate = returnRateForecast.baselineChurn + (returnRateChange * progressFactor);

    // Revenue
    const revenue = currentVisitors * newPrice;

    series.push({
      month,
      visitors: Math.round(currentVisitors),
      revenue: Math.round(revenue),
      return_rate: monthReturnRate
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
        visitors: Math.round(baseline.visitors),
        revenue: Math.round(baseline.revenue),
        churn_rate: baselineChurn
      });
      continue;
    }

    // Apply changes gradually over time
    const progressFactor = Math.min(month / 3, 1); // Full effect after 3 months

    // Calculate visitor change
    const totalVisitorsChange = forecasted.visitors - baseline.visitors;
    const currentVisitors = baseline.visitors + (totalVisitorsChange * progressFactor);

    // Calculate revenue change
    const totalRevenueChange = forecasted.revenue - baseline.revenue;
    const currentRevenue = baseline.revenue + (totalRevenueChange * progressFactor);

    // Calculate churn for this month
    const churnChange = forecastedChurn - baselineChurn;
    const monthChurnRate = baselineChurn + (churnChange * progressFactor);

    series.push({
      month,
      visitors: Math.round(currentVisitors),
      revenue: Math.round(currentRevenue),
      churn_rate: monthChurnRate
    });
  }

  return series;
}

/**
 * Generate warnings based on scenario results
 * @param {Object} scenario - Scenario configuration
 * @param {Object} returnRateForecast - Return rate forecast
 * @param {Object} demandForecast - Demand forecast
 * @returns {Array} Array of warning messages
 */
function generateWarnings(scenario, returnRateForecast, demandForecast) {
  const warnings = [];

  // Warn if return rate decreases significantly (inverse of churn increasing)
  if (returnRateForecast.changePercent < -10) {
    warnings.push(`Return rate decreases by ${Math.abs(returnRateForecast.changePercent).toFixed(1)}% (exceeds 10% threshold)`);
  }

  // Warn if visitor loss is significant
  if (demandForecast.percentChange < -5) {
    warnings.push(`Visitor base decreases by ${Math.abs(demandForecast.percentChange).toFixed(1)}% (exceeds 5% threshold)`);
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
        // Maximize visitor growth
        score = result.delta.visitors_pct;
        break;

      case 'balanced':
        // Balance revenue and visitor growth
        score = (result.delta.revenue_pct * 0.6) + (result.delta.visitors_pct * 0.4);
        // Penalize low return rate (high visitor turnover)
        if (result.delta.return_rate_pct < -10) {
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

    baseline_visitors: result.baseline.visitors,
    baseline_revenue: result.baseline.revenue,
    baseline_return_rate: result.baseline.return_rate,
    baseline_arpv: result.baseline.arpv,

    forecasted_visitors: result.forecasted.visitors,
    forecasted_revenue: result.forecasted.revenue,
    forecasted_return_rate: result.forecasted.return_rate,
    forecasted_arpv: result.forecasted.arpv,

    delta_visitors: result.delta.visitors,
    delta_visitors_pct: result.delta.visitors_pct,
    delta_revenue: result.delta.revenue,
    delta_revenue_pct: result.delta.revenue_pct,
    delta_return_rate: result.delta.return_rate,

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
    const forecastedVisitors = Math.round(segmentBaseline.visitors * (1 + demandChangePct));
    const forecastedRevenue = forecastedVisitors * newPrice;

    // Estimate churn impact
    const churnMultiplier = 1 + (segmentElasticity * 0.15 * priceChangePct); // 15% of elasticity affects churn
    const forecastedChurn = segmentBaseline.churn_rate * churnMultiplier;

    // Calculate segment impact
    const segmentImpact = {
      baseline: segmentBaseline,
      forecasted: {
        visitors: forecastedVisitors,
        revenue: forecastedRevenue,
        churn_rate: forecastedChurn,
        arpu: newPrice
      },
      delta: {
        visitors: forecastedVisitors - segmentBaseline.visitors,
        visitors_pct: demandChangePct * 100,
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
      segmentBaseline.visitors
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
    if (spilloverEffects.total_migration > segmentBaseline.visitors * 0.15) {
      warnings.push(`Significant spillover effects: ~${spilloverEffects.total_migration.toLocaleString()} visitors may migrate`);
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
  const totalVisitors = matchingSegments.reduce((sum, s) =>
    sum + parseInt(s.visitor_count || 0), 0);

  const weightedChurnRate = matchingSegments.reduce((sum, s) => {
    const subs = parseInt(s.visitor_count || 0);
    const churn = parseFloat(s.avg_churn_rate || 0);
    return sum + (churn * subs);
  }, 0) / totalVisitors;

  const weightedArpu = matchingSegments.reduce((sum, s) => {
    const subs = parseInt(s.visitor_count || 0);
    const arpu = parseFloat(s.avg_arpu || 0);
    return sum + (arpu * subs);
  }, 0) / totalVisitors;

  const revenue = totalVisitors * weightedArpu;

  return {
    visitors: totalVisitors,
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
 * @param {number} targetVisitors - Target segment visitors
 * @returns {Promise<Object>} Spillover effects
 */
async function estimateSpilloverEffects(tier, targetSegment, priceChangePct, demandChangePct, targetVisitors) {
  if (!window.segmentEngine) {
    return { details: [], total_migration: 0, net_tier_change: 0 };
  }

  const allSegments = window.segmentEngine.getSegmentsForTier(tier);
  const spillovers = [];

  // Simplified migration model: some churned customers move to other segments
  // Migration rate is proportional to demand change, capped at 10%
  const migrationRate = Math.min(Math.abs(demandChangePct) * 0.25, 0.10); // Max 10% migration
  const totalMigrants = Math.round(targetVisitors * migrationRate);

  // Distribute migrants across other segments (weighted by their size)
  const otherSegments = allSegments.filter(s =>
    s.acquisition !== targetSegment &&
    s.engagement !== targetSegment &&
    s.monetization !== targetSegment
  );

  const totalOtherVisitors = otherSegments.reduce((sum, s) =>
    sum + parseInt(s.visitor_count || 0), 0);

  for (const seg of otherSegments) {
    const segVisitors = parseInt(seg.visitor_count || 0);
    const weight = segVisitors / totalOtherVisitors;

    // Migration direction: price increase -> outflow, price decrease -> inflow
    const direction = priceChangePct > 0 ? -1 : 1;
    const deltaVisitors = Math.round(totalMigrants * weight * direction);

    if (deltaVisitors !== 0) {
      spillovers.push({
        compositeKey: seg.compositeKey,
        baseline_visitors: segVisitors,
        delta_visitors: deltaVisitors,
        delta_pct: (deltaVisitors / segVisitors) * 100
      });
    }
  }

  // Sort by absolute impact
  spillovers.sort((a, b) => Math.abs(b.delta_visitors) - Math.abs(a.delta_visitors));

  // Calculate net tier change from spillover
  const netTierChange = spillovers.reduce((sum, s) => sum + s.delta_visitors, 0);

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
  const baselineVisitors = allSegments.reduce((sum, s) =>
    sum + parseInt(s.visitor_count || 0), 0);

  const baselineRevenue = allSegments.reduce((sum, s) => {
    const subs = parseInt(s.visitor_count || 0);
    const arpu = parseFloat(s.avg_arpu || 0);
    return sum + (subs * arpu);
  }, 0);

  // Calculate forecasted tier totals
  const targetSegmentDelta = impactData.segmentForecasted.visitors - impactData.segmentBaseline.visitors;
  const spilloverDelta = impactData.spilloverEffects.reduce((sum, s) =>
    sum + (s.delta_visitors || 0), 0);

  const forecastedVisitors = baselineVisitors + targetSegmentDelta + spilloverDelta;

  // Revenue calculation (simplified)
  const targetRevenueChange = impactData.segmentForecasted.revenue - impactData.segmentBaseline.revenue;
  const spilloverRevenueChange = impactData.spilloverEffects.reduce((sum, s) => {
    // Assume migrated visitors keep similar ARPU
    const avgArpu = baselineRevenue / baselineVisitors;
    return sum + (s.delta_visitors * avgArpu);
  }, 0);

  const forecastedRevenue = baselineRevenue + targetRevenueChange + spilloverRevenueChange;
  const forecastedArpu = forecastedRevenue / forecastedVisitors;

  return {
    baseline: {
      visitors: baselineVisitors,
      revenue: baselineRevenue,
      arpu: baselineRevenue / baselineVisitors
    },
    forecasted: {
      visitors: forecastedVisitors,
      revenue: forecastedRevenue,
      arpu: forecastedArpu
    },
    delta: {
      visitors: forecastedVisitors - baselineVisitors,
      visitors_pct: ((forecastedVisitors - baselineVisitors) / baselineVisitors) * 100,
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
    const churnedVisitors = baseline.activeVisitors * churnResult['0-4 Weeks'].churn_rate;
    const netAdds = acquisitionResult.predicted_adds - churnedVisitors;

    const forecasted = {
      activeVisitors: baseline.activeVisitors + netAdds,
      revenue: baseline.revenue * (1 + (pythonScenario.price_change_pct / 100)),
      arpu: scenario.config.new_price,
      churnRate: churnResult['0-4 Weeks'].churn_rate,
      grossAdds: acquisitionResult.predicted_adds,
      netAdds: netAdds
    };

    // Calculate deltas
    const delta = {
      visitors: forecasted.activeVisitors - baseline.activeVisitors,
      visitors_pct: ((forecasted.activeVisitors - baseline.activeVisitors) / baseline.activeVisitors) * 100,
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
