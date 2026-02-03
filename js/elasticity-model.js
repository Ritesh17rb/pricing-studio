/**
 * Elasticity Model Module
 * Calculate price elasticity and demand forecasts
 *
 * Dependencies: data-loader.js
 */

import { loadElasticityParams } from './data-loader.js';

/**
 * Calculate elasticity for a specific tier and segment
 * @param {string} tier - Tier name (ad_supported, ad_free)
 * @param {string} segment - Segment name (optional)
 * @param {Object} options - Additional options {cohort, timeHorizon}
 * @returns {Promise<Object>} Elasticity object with value and confidence interval
 */
export async function calculateElasticity(tier, segment = null, options = {}) {
  const params = await loadElasticityParams();

  // Special handling for bundle tier
  if (tier === 'bundle') {
    // Bundles typically have better elasticity than individual tiers due to perceived value
    // Use ad_free tier as base and apply bundle discount factor
    console.log('Using bundle elasticity (based on ad_free with better price sensitivity)');
    const bundleElasticity = -1.3; // Less elastic (more inelastic) than ad_free
    const bundleCI = 0.15;

    // Apply time horizon adjustment if specified
    let adjustedElasticity = bundleElasticity;
    if (options.timeHorizon && params.time_horizon_adjustments[options.timeHorizon]) {
      const multiplier = params.time_horizon_adjustments[options.timeHorizon].multiplier;
      adjustedElasticity = bundleElasticity * multiplier;
    }

    return {
      elasticity: adjustedElasticity,
      confidenceInterval: bundleCI,
      lowerBound: adjustedElasticity - bundleCI,
      upperBound: adjustedElasticity + bundleCI,
      isBundle: true
    };
  }

  if (!params.tiers[tier]) {
    throw new Error(`Unknown tier: ${tier}`);
  }

  let elasticity = params.tiers[tier].base_elasticity;
  let confidenceInterval = params.tiers[tier].confidence_interval;

  // Apply segment-level elasticity if specified
  if (segment && params.tiers[tier].segments[segment]) {
    elasticity = params.tiers[tier].segments[segment].elasticity;
    confidenceInterval = params.tiers[tier].segments[segment].confidence_interval;
  }

  // Apply cohort adjustments if specified
  if (options.cohort) {
    const cohortType = Object.keys(options.cohort)[0];
    const cohortValue = options.cohort[cohortType];

    if (params.tiers[tier].cohort_elasticity?.[cohortType]?.[cohortValue]) {
      elasticity = params.tiers[tier].cohort_elasticity[cohortType][cohortValue];
    }
  }

  // Apply time horizon adjustment
  if (options.timeHorizon && params.time_horizon_adjustments[options.timeHorizon]) {
    const multiplier = params.time_horizon_adjustments[options.timeHorizon].multiplier;
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
 * @param {number} baseSubscribers - Current subscriber count
 * @param {number} elasticity - Price elasticity coefficient
 * @returns {Object} Forecast object
 */
export function forecastDemand(currentPrice, newPrice, baseSubscribers, elasticity) {
  if (!currentPrice || !newPrice || !baseSubscribers || !elasticity) {
    throw new Error('Missing required parameters for demand forecast');
  }

  // Calculate price ratio
  const priceRatio = newPrice / currentPrice;

  // Calculate demand using elasticity formula: Q = Q0 * (P1/P0)^elasticity
  const forecastedSubscribers = baseSubscribers * Math.pow(priceRatio, elasticity);

  // Calculate changes
  const change = forecastedSubscribers - baseSubscribers;
  const percentChange = (change / baseSubscribers) * 100;

  return {
    baseSubscribers,
    forecastedSubscribers: Math.round(forecastedSubscribers),
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
 * @param {Object} currentDistribution - { tier: subscriberCount }
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
 * Calculate churn elasticity (how churn rate changes with price)
 * @param {string} tier - Tier name
 * @param {number} priceChangePct - Price change percentage (e.g., 0.10 for 10% increase)
 * @param {number} baselineChurn - Current churn rate
 * @returns {Promise<Object>} Forecast churn
 */
export async function forecastChurn(tier, priceChangePct, baselineChurn) {
  const params = await loadElasticityParams();

  // Special handling for bundle tier
  if (tier === 'bundle') {
    // Bundles have lower churn sensitivity (better retention)
    const bundleChurnElasticity = 0.3; // Lower than ad_free (0.5)
    const churnChangePct = bundleChurnElasticity * priceChangePct;
    const forecastedChurn = baselineChurn * (1 + churnChangePct);

    return {
      baselineChurn,
      forecastedChurn,
      change: forecastedChurn - baselineChurn,
      changePercent: (churnChangePct * 100),
      isBundle: true
    };
  }

  if (!params.churn_elasticity[tier]) {
    throw new Error(`Churn elasticity not available for tier: ${tier}`);
  }

  const churnElasticity = params.churn_elasticity[tier].churn_elasticity;
  const churnChangePct = churnElasticity * priceChangePct;

  const forecastedChurn = baselineChurn * (1 + churnChangePct);

  return {
    baselineChurn,
    forecastedChurn,
    change: forecastedChurn - baselineChurn,
    changePercent: churnChangePct * 100
  };
}

/**
 * Calculate acquisition elasticity (how new subscribers change with price)
 * @param {string} tier - Tier name
 * @param {number} priceChangePct - Price change percentage
 * @param {number} baselineAcquisition - Current weekly new subscribers
 * @returns {Promise<Object>} Forecast acquisition
 */
export async function forecastAcquisition(tier, priceChangePct, baselineAcquisition) {
  const params = await loadElasticityParams();

  // Special handling for bundle tier
  if (tier === 'bundle') {
    // Bundles have better acquisition response due to perceived value
    // Despite lower price, bundles attract more customers
    const bundleAcqElasticity = -1.8; // More responsive than individual tiers
    const acqChangePct = bundleAcqElasticity * priceChangePct;
    const forecastedAcquisition = baselineAcquisition * (1 + acqChangePct);

    return {
      baselineAcquisition,
      forecastedAcquisition: Math.round(forecastedAcquisition),
      change: Math.round(forecastedAcquisition - baselineAcquisition),
      changePercent: acqChangePct * 100,
      isBundle: true
    };
  }

  if (!params.acquisition_elasticity[tier]) {
    throw new Error(`Acquisition elasticity not available for tier: ${tier}`);
  }

  const acqElasticity = params.acquisition_elasticity[tier].acquisition_elasticity;
  const acqChangePct = acqElasticity * priceChangePct;

  const forecastedAcquisition = baselineAcquisition * (1 + acqChangePct);

  return {
    baselineAcquisition,
    forecastedAcquisition: Math.round(forecastedAcquisition),
    change: Math.round(forecastedAcquisition - baselineAcquisition),
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
    ad_supported: 5.99,
    ad_free: 9.99
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

  if (!params.tiers[tier]) {
    throw new Error(`Unknown tier: ${tier}`);
  }

  return {
    base: params.tiers[tier].base_elasticity,
    segments: params.tiers[tier].segments,
    cohorts: params.tiers[tier].cohort_elasticity,
    confidenceInterval: params.tiers[tier].confidence_interval
  };
}
