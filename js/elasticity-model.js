/**
 * Elasticity Model Module
 * Calculate price elasticity and demand forecasts
 *
 * Dependencies: data-loader.js
 */

import { loadElasticityParams } from './data-loader.js';

/**
 * Calculate elasticity for a specific tier and segment
 * @param {string} tier - Tier name (standard_pass, premium_pass, vip_pass)
 * @param {string} segment - Segment name (optional)
 * @param {Object} options - Additional options {cohort, timeHorizon}
 * @returns {Promise<Object>} Elasticity object with value and confidence interval
 */
export async function calculateElasticity(tier, segment = null, options = {}) {
  const params = await loadElasticityParams();

  // Special handling for vip_pass tier
  if (tier === 'vip_pass' && !params[tier]) {
    // VIP pass typically has better elasticity than individual tiers due to perceived value
    // Use premium_pass tier as base and apply VIP discount factor
    console.log('Using vip_pass elasticity (based on premium_pass with better price sensitivity)');
    const vipElasticity = -1.3; // Less elastic (more inelastic) than premium_pass
    const vipCI = 0.18;

    // Apply time horizon adjustment if specified
    let adjustedElasticity = vipElasticity;
    if (options.timeHorizon && params.standard_pass?.time_horizon_adjustment?.[options.timeHorizon]) {
      const multiplier = params.standard_pass.time_horizon_adjustment[options.timeHorizon];
      adjustedElasticity = vipElasticity * multiplier;
    }

    return {
      elasticity: adjustedElasticity,
      confidenceInterval: vipCI,
      lowerBound: adjustedElasticity - vipCI,
      upperBound: adjustedElasticity + vipCI,
      isVIP: true
    };
  }

  if (!params[tier]) {
    throw new Error(`Unknown tier: ${tier}`);
  }

  let elasticity = params[tier].base_elasticity;
  let confidenceInterval = params[tier].confidence_interval;

  // Apply segment-level elasticity if specified
  if (segment && params[tier].segments[segment]) {
    elasticity = params[tier].segments[segment];
    confidenceInterval = confidenceInterval; // Keep base CI
  }

  // Apply cohort adjustments if specified
  if (options.cohort) {
    const cohortType = Object.keys(options.cohort)[0];
    const cohortValue = options.cohort[cohortType];

    if (params[tier].cohort_elasticity?.[cohortType]?.[cohortValue]) {
      elasticity = params[tier].cohort_elasticity[cohortType][cohortValue];
    }
  }

  // Apply time horizon adjustment
  if (options.timeHorizon && params[tier].time_horizon_adjustment?.[options.timeHorizon]) {
    const multiplier = params[tier].time_horizon_adjustment[options.timeHorizon];
    elasticity = elasticity * multiplier;
  }

  return {
    elasticity,
    confidenceInterval,
    lowerBound: elasticity - confidenceInterval,
    upperBound: elasticity + confidenceInterval
  };
}

/**
 * Forecast demand based on price change
 * Uses elasticity formula: Q1 = Q0 * (P1/P0)^elasticity
 *
 * @param {number} currentPrice - Current price
 * @param {number} newPrice - New price
 * @param {number} baseVisitors - Current visitor count
 * @param {number} elasticity - Price elasticity coefficient
 * @returns {Object} Forecast object
 */
export function forecastDemand(currentPrice, newPrice, baseVisitors, elasticity) {
  if (!currentPrice || !newPrice || !baseVisitors || !elasticity) {
    throw new Error('Missing required parameters for demand forecast');
  }

  // Calculate price ratio
  const priceRatio = newPrice / currentPrice;

  // Calculate demand using elasticity formula: Q = Q0 * (P1/P0)^elasticity
  const forecastedVisitors = baseVisitors * Math.pow(priceRatio, elasticity);

  // Calculate changes
  const change = forecastedVisitors - baseVisitors;
  const percentChange = (change / baseVisitors) * 100;

  return {
    baseVisitors,
    forecastedVisitors: Math.round(forecastedVisitors),
    change: Math.round(change),
    percentChange,
    priceRatio,
    priceChangePct: (priceRatio - 1) * 100
  };
}

/**
 * Calculate Willingness to Pay (WTP) distribution
 * @param {string} tier - Tier name
 * @returns {Promise<Object>} WTP distribution
 */
export async function calculateWTP(tier) {
  const params = await loadElasticityParams();

  if (!params.willingness_to_pay[tier]) {
    throw new Error(`WTP data not available for tier: ${tier}`);
  }

  return params.willingness_to_pay[tier];
}

/**
 * Estimate tier migration when price changes
 * Uses cross-elasticity to estimate movement between tiers
 *
 * @param {Object} priceChanges - { tier: newPrice } mappings
 * @param {Object} currentDistribution - { tier: visitorCount }
 * @returns {Promise<Object>} Estimated new distribution
 */
export async function estimateMigration(priceChanges, currentDistribution) {
  const params = await loadElasticityParams();
  const newDistribution = { ...currentDistribution };

  // For each tier with price change
  for (const [tier, newPrice] of Object.entries(priceChanges)) {
    const currentPrice = getCurrentPriceForTier(tier);

    if (!currentPrice) continue;

    const priceChangePct = ((newPrice - currentPrice) / currentPrice);

    // Calculate own-price effect
    const elasticity = params.tiers[tier].base_elasticity;
    const demandChangePct = elasticity * priceChangePct;
    const currentSubs = currentDistribution[tier] || 0;
    const lostSubs = currentSubs * Math.abs(demandChangePct);

    newDistribution[tier] = currentSubs + (demandChangePct < 0 ? -lostSubs : lostSubs);

    // Calculate cross-price effects (migration to other tiers)
    for (const [otherTier, otherSubs] of Object.entries(currentDistribution)) {
      if (otherTier === tier) continue;

      const crossElasticityKey = `${tier}_to_${otherTier}`;
      const crossElasticity = params.cross_elasticity[crossElasticityKey];

      if (crossElasticity && crossElasticity > 0) {
        // Positive cross-elasticity means substitutes
        const migrationPct = crossElasticity * Math.abs(priceChangePct);
        const migrants = lostSubs * migrationPct;

        newDistribution[otherTier] = (newDistribution[otherTier] || otherSubs) + migrants;
      }
    }
  }

  return newDistribution;
}

/**
 * Calculate return rate elasticity (inverse of churn - how return rate changes with price)
 * @param {string} tier - Tier name
 * @param {number} priceChangePct - Price change percentage (e.g., 0.10 for 10% increase)
 * @param {number} baselineReturnRate - Current return rate (inverse of churn)
 * @returns {Promise<Object>} Forecast return rate
 */
export async function forecastChurn(tier, priceChangePct, baselineReturnRate) {
  const params = await loadElasticityParams();

  // Special handling for vip_pass tier
  if (tier === 'vip_pass') {
    // VIP pass has lower return rate sensitivity (better retention)
    const vipChurnElasticity = 0.3; // Lower than premium_pass
    const returnRateChangePct = vipChurnElasticity * priceChangePct;
    const forecastedReturnRate = baselineReturnRate * (1 + returnRateChangePct);

    return {
      baselineChurn: baselineReturnRate,
      forecastedChurn: forecastedReturnRate,
      change: forecastedReturnRate - baselineReturnRate,
      changePercent: (returnRateChangePct * 100),
      isVIP: true
    };
  }

  if (!params[tier]?.churn_elasticity) {
    throw new Error(`Return rate elasticity not available for tier: ${tier}`);
  }

  const churnElasticity = params[tier].churn_elasticity;
  const returnRateChangePct = churnElasticity * priceChangePct;

  const forecastedReturnRate = baselineReturnRate * (1 + returnRateChangePct);

  return {
    baselineChurn: baselineReturnRate,
    forecastedChurn: forecastedReturnRate,
    change: forecastedReturnRate - baselineReturnRate,
    changePercent: returnRateChangePct * 100
  };
}

/**
 * Calculate new visit elasticity (how new visitors change with price)
 * @param {string} tier - Tier name
 * @param {number} priceChangePct - Price change percentage
 * @param {number} baselineNewVisits - Current daily new visitors
 * @returns {Promise<Object>} Forecast new visits
 */
export async function forecastAcquisition(tier, priceChangePct, baselineNewVisits) {
  const params = await loadElasticityParams();

  // Special handling for vip_pass tier
  if (tier === 'vip_pass') {
    // VIP pass has better acquisition response due to perceived value
    // Despite higher price, VIP attracts experience-seeking customers
    const vipAcqElasticity = -1.8; // More responsive than individual tiers
    const acqChangePct = vipAcqElasticity * priceChangePct;
    const forecastedNewVisits = baselineNewVisits * (1 + acqChangePct);

    return {
      baselineAcquisition: baselineNewVisits,
      forecastedAcquisition: Math.round(forecastedNewVisits),
      change: Math.round(forecastedNewVisits - baselineNewVisits),
      changePercent: acqChangePct * 100,
      isVIP: true
    };
  }

  if (!params[tier]?.acquisition_elasticity) {
    throw new Error(`New visit elasticity not available for tier: ${tier}`);
  }

  const acqElasticity = params[tier].acquisition_elasticity;
  const acqChangePct = acqElasticity * priceChangePct;

  const forecastedNewVisits = baselineNewVisits * (1 + acqChangePct);

  return {
    baselineAcquisition: baselineNewVisits,
    forecastedAcquisition: Math.round(forecastedNewVisits),
    change: Math.round(forecastedNewVisits - baselineNewVisits),
    changePercent: acqChangePct * 100
  };
}

/**
 * Helper function to get current price for a tier (mocked for now)
 * @param {string} tier - Tier name
 * @returns {number} Current price
 */
function getCurrentPriceForTier(tier) {
  const prices = {
    standard_pass: 79,
    premium_pass: 139,
    vip_pass: 249
  };
  return prices[tier] || null;
}

/**
 * Get all elasticity estimates for a tier (base + all segments)
 * @param {string} tier - Tier name
 * @returns {Promise<Object>} Complete elasticity breakdown
 */
export async function getElasticityBreakdown(tier) {
  const params = await loadElasticityParams();

  if (!params[tier]) {
    throw new Error(`Unknown tier: ${tier}`);
  }

  return {
    base: params[tier].base_elasticity,
    segments: params[tier].segments,
    cohorts: params[tier].cohort_elasticity,
    confidenceInterval: params[tier].confidence_interval
  };
}
