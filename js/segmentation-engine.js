/**
 * Segmentation Engine Module
 * Core logic for customer segmentation, elasticity calculation with fallbacks, and KPI aggregation
 *
 * Dependencies: D3.js (for CSV/JSON loading)
 */

class SegmentationEngine {
    constructor() {
        this.segmentElasticity = null;
        this.customerSegments = null;
        this.segmentKPIs = null;
        this.cohortCoefficients = null;
        this.activeCohort = 'baseline';

        // Strategic segment axis definitions (based on customer personas)
        this.axisDefinitions = {
            acquisition: [
                'habitual_streamers',
                'content_anchored_viewers',
                'at_risk_lapsers',
                'promo_only_users',
                'dormant_subscribers'
            ],
            engagement: [
                'ad_value_seekers',
                'ad_tolerant_upgraders',
                'ad_free_loyalists',
                'price_triggered_downgraders',
                'tvod_inclined_buyers'
            ],
            monetization: [
                'platform_bundled_acquirers',
                'tvod_to_svod_converters',
                'content_triggered_buyers',
                'deal_responsive_acquirers',
                'value_perception_buyers'
            ]
        };

        // Axis labels for display
        this.axisLabels = {
            acquisition: 'Axis 3: Acquisition Price Sensitivity',
            engagement: 'Axis 2: Engagement & Churn Propensity',
            monetization: 'Axis 1: Monetization & Plan Type'
        };

        // Segment descriptions and characteristics
        this.segmentDescriptions = {
            // Axis 3: Acquisition Price Sensitivity
            'habitual_streamers': {
                label: 'Habitual Streamers',
                description: 'Top quartile frequency & recency',
                elasticity_level: 'Very low churn elasticity'
            },
            'content_anchored_viewers': {
                label: 'Content-Anchored Viewers',
                description: 'High SVOD w/ genre affinity',
                elasticity_level: 'Low churn if content available'
            },
            'at_risk_lapsers': {
                label: 'At-Risk Lapsers',
                description: 'Declining frequency, high inactivity',
                elasticity_level: 'Moderate'
            },
            'promo_only_users': {
                label: 'Promo-Only Users',
                description: 'Engagement spikes only during discounts',
                elasticity_level: 'Extreme churn elasticity'
            },
            'dormant_subscribers': {
                label: 'Dormant Subscribers',
                description: 'No usage for X days',
                elasticity_level: 'Price irrelevant; experience/content first'
            },

            // Axis 2: Engagement & Churn Propensity
            'ad_value_seekers': {
                label: 'Ad-Value Seekers',
                description: 'Ad-Lite plan, high ad completion, low ARPU',
                elasticity_level: 'Highly price elastic, sensitive to small increases'
            },
            'ad_tolerant_upgraders': {
                label: 'Ad-Tolerant Upgraders',
                description: 'Started on ad-tier, now upgraded',
                elasticity_level: 'Strong candidates for upsell elasticity modeling'
            },
            'ad_free_loyalists': {
                label: 'Ad-Free Loyalists',
                description: 'Long tenure on ad-free, low churn',
                elasticity_level: 'Low churn elasticity, ARPU growth anchor'
            },
            'price_triggered_downgraders': {
                label: 'Price-Triggered Downgraders',
                description: 'Past switches from ad-free → ad-tier',
                elasticity_level: 'Migration elasticity critical'
            },
            'tvod_inclined_buyers': {
                label: 'TVOD-Inclined Buyers',
                description: 'Has made at least one transactional purchase',
                elasticity_level: 'Monetization expansion segment'
            },

            // Axis 1: Monetization & Plan Type
            'platform_bundled_acquirers': {
                label: 'Platform-Bundled Acquirers',
                description: 'App store / bundle-driven',
                elasticity_level: 'Low-moderate'
            },
            'tvod_to_svod_converters': {
                label: 'TVOD-to-SVOD Converters',
                description: 'First transaction was TVOD',
                elasticity_level: 'Low price sensitivity for entry'
            },
            'content_triggered_buyers': {
                label: 'Content-Triggered Buyers',
                description: 'Subscribes after viewing specific titles',
                elasticity_level: 'Low'
            },
            'deal_responsive_acquirers': {
                label: 'Deal-Responsive Acquirers',
                description: 'Enters via discounts/free trial',
                elasticity_level: 'Very high'
            },
            'value_perception_buyers': {
                label: 'Value-Perception Buyers',
                description: 'Subscribes at full price after browsing',
                elasticity_level: 'Moderate'
            }
        };
    }

    /**
     * Load all segment data files
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    async loadSegmentData() {
        try {
            const [elasticity, segments, kpis, cohorts] = await Promise.all([
                d3.json('data/segment_elasticity.json'),
                d3.csv('data/customer_segments.csv'),
                d3.csv('data/segment_kpis.csv'),
                d3.json('data/cohort_coefficients.json')
            ]);

            this.segmentElasticity = elasticity;
            this.customerSegments = segments;
            this.segmentKPIs = this.#indexKPIsByCompositeKey(kpis);
            this.cohortCoefficients = cohorts;

            return true;
        } catch (error) {
            console.error('Failed to load segment data:', error);
            return false;
        }
    }

    /**
     * Get elasticity with 4-level fallback strategy
     * @param {string} tier - Subscription tier (ad_supported, ad_free)
     * @param {string} compositeKey - Segment composite key "tenure|age|device"
     * @param {string} axis - Axis name ('engagement', 'monetization', 'acquisition')
     * @returns {number} Elasticity value
     */
    getElasticity(tier, compositeKey, axis = null) {
        try {
            // Validate inputs
            if (!tier || !compositeKey) {
                console.warn('Invalid parameters for elasticity lookup:', { tier, compositeKey });
                return this.#getBaseFallback(tier);
            }

            // Check if data is loaded
            if (!this.segmentElasticity) {
                console.warn('Segment elasticity data not loaded');
                return this.#getBaseFallback(tier);
            }

            const tierData = this.segmentElasticity[tier];
            if (!tierData) {
                console.warn(`No elasticity data for tier: ${tier}`);
                return this.#getBaseFallback(tier);
            }

            // Level 1: 3-axis segment lookup
            const segmentData = tierData.segment_elasticity?.[compositeKey];

            if (segmentData && axis) {
                // Map UI axis names to JSON axis keys
                // UI uses: 'acquisition', 'engagement', 'monetization'
                // JSON has: 'acquisition_axis', 'churn_axis', 'migration_axis'
                const axisMapping = {
                    'acquisition': 'acquisition_axis',
                    'engagement': 'churn_axis',  // Engagement relates to churn behavior
                    'monetization': 'migration_axis'  // Monetization relates to tier migration
                };

                const axisKey = axisMapping[axis] || `${axis}_axis`;
                const axisData = segmentData[axisKey];

                if (axisData && axisData.elasticity !== undefined) {
                    const multipliers = this.#getCohortMultipliers();

                    // Apply the CORRECT multiplier based on axis type
                    let appliedMultiplier = 1;
                    if (axis === 'acquisition') {
                        // Use acquisition elasticity multiplier
                        appliedMultiplier = multipliers?.acquisition_elasticity || 1;
                    } else if (axis === 'engagement') {
                        // Use churn elasticity multiplier (engagement = churn propensity)
                        appliedMultiplier = multipliers?.churn || 1;
                    } else if (axis === 'monetization') {
                        // Use migration asymmetry multiplier (monetization = tier switching)
                        appliedMultiplier = multipliers?.migration_asymmetry || 1;
                    }

                    const segmentElasticity = axisData.elasticity * appliedMultiplier;
                    return segmentElasticity;
                }

                console.warn('⚠️ Axis data not found, using fallback:', {
                    tier,
                    axis,
                    axisKey,
                    compositeKey: compositeKey.substring(0, 50) + '...',
                    hasSegmentData: !!segmentData,
                    availableKeys: segmentData ? Object.keys(segmentData) : []
                });
            }

            // Level 2-4: Fallback to existing elasticity calculation
            // This integrates with the existing elasticity-model.js
            const baseElasticity = this.#getBaseFallback(tier);
            const multipliers = this.#getCohortMultipliers();
            // For fallback, assume acquisition context (most common)
            return baseElasticity * (multipliers?.acquisition_elasticity || 1);
        } catch (error) {
            console.error('Error getting elasticity:', error);
            const baseElasticity = this.#getBaseFallback(tier);
            const multipliers = this.#getCohortMultipliers();
            // For fallback, assume acquisition context (most common)
            return baseElasticity * (multipliers?.acquisition_elasticity || 1);
        }
    }

    /**
     * Get complete segment data for a composite key
     * @param {string} compositeKey - Segment composite key
     * @param {string} tier - Subscription tier
     * @returns {Object|null} Segment data with all axis values
     */
    getSegmentData(compositeKey, tier) {
        if (!this.segmentElasticity || !tier) return null;

        const tierData = this.segmentElasticity[tier];
        if (!tierData) return null;

        const segmentData = tierData.segment_elasticity?.[compositeKey];
        if (!segmentData) return null;

        return this.#applyCohortToSegmentData(segmentData);
    }

    /**
     * Filter segments by axis values
     * @param {Object} filters - { acquisition: [], engagement: [], monetization: [] }
     * @returns {Array<Object>} Filtered segment data with KPIs
     */
    filterSegments(filters = {}) {
        if (!this.segmentKPIs) {
            console.warn('Segment KPIs not loaded');
            return [];
        }

        const results = [];

        for (const [indexKey, kpis] of Object.entries(this.segmentKPIs)) {
            // Index key format is: tier|acquisition|engagement|monetization
            const parts = indexKey.split('|');
            const tier = parts[0];
            const compositeKey = parts.slice(1).join('|');
            const [acquisition, engagement, monetization] = parts.slice(1);

            // Check if segment matches all active filters
            const matchesAcquisition = !filters.acquisition?.length ||
                                      filters.acquisition.includes(acquisition);
            const matchesEngagement = !filters.engagement?.length ||
                                     filters.engagement.includes(engagement);
            const matchesMonetization = !filters.monetization?.length ||
                                       filters.monetization.includes(monetization);

            if (matchesAcquisition && matchesEngagement && matchesMonetization) {
                const adjustedKPIs = this.#applyCohortToKPIs(kpis);
                results.push({
                    compositeKey,
                    acquisition,
                    engagement,
                    monetization,
                    tier,
                    ...adjustedKPIs
                });
            }
        }

        return results;
    }

    /**
     * Aggregate KPIs across segments (weighted by subscriber count)
     * @param {Array<Object>} segments - Filtered segments
     * @returns {Object} Aggregated metrics
     */
    aggregateKPIs(segments) {
        if (!segments || segments.length === 0) {
            return {
                total_subscribers: 0,
                weighted_churn: 0,
                weighted_arpu: 0,
                weighted_watch_hours: 0,
                segment_count: 0
            };
        }

        const totalSubs = segments.reduce((sum, s) => {
            return sum + parseFloat(s.subscriber_count || 0);
        }, 0);

        if (totalSubs === 0) {
            return {
                total_subscribers: 0,
                weighted_churn: 0,
                weighted_arpu: 0,
                weighted_watch_hours: 0,
                segment_count: segments.length
            };
        }

        return {
            total_subscribers: Math.round(totalSubs),
            weighted_churn: this.#weightedAvg(segments, 'avg_churn_rate', 'subscriber_count'),
            weighted_arpu: this.#weightedAvg(segments, 'avg_arpu', 'subscriber_count'),
            weighted_watch_hours: this.#weightedAvg(segments, 'avg_watch_hours', 'subscriber_count'),
            weighted_cac: this.#weightedAvg(segments, 'avg_cac', 'subscriber_count'),
            segment_count: segments.length
        };
    }

    /**
     * Get all segments for a specific tier
     * @param {string} tier - Tier name
     * @returns {Array<Object>} Segments with KPIs for that tier
     */
    getSegmentsForTier(tier) {
        if (!this.segmentKPIs) return [];

        return Object.entries(this.segmentKPIs)
            .filter(([indexKey, _]) => indexKey.startsWith(tier + '|'))
            .map(([indexKey, kpis]) => {
                // Index key format is: tier|acquisition|engagement|monetization
                const parts = indexKey.split('|');
                const compositeKey = parts.slice(1).join('|');
                const [acquisition, engagement, monetization] = parts.slice(1);
                const adjustedKPIs = this.#applyCohortToKPIs(kpis);
                return {
                    compositeKey,
                    acquisition,
                    engagement,
                    monetization,
                    tier,
                    ...adjustedKPIs
                };
            });
    }

    /**
     * Get available cohort definitions
     * @returns {Array<Object>} Cohort list with id, label, description
     */
    getCohortDefinitions() {
        if (!this.cohortCoefficients) return [];

        const cohorts = Object.entries(this.cohortCoefficients)
            .filter(([id]) => id !== 'metadata')  // Exclude metadata key
            .map(([id, data]) => ({
                id,
                label: data.label,
                description: data.description || ''
            }));

        // Sort to put baseline first
        return cohorts.sort((a, b) => {
            if (a.id === 'baseline') return -1;
            if (b.id === 'baseline') return 1;
            return 0;
        });
    }

    /**
     * Set active cohort for calculations
     * @param {string} cohortId - Cohort identifier
     */
    setActiveCohort(cohortId) {
        if (!cohortId || !this.cohortCoefficients) return;
        if (!this.cohortCoefficients[cohortId]) {
            console.warn(`Unknown cohort: ${cohortId}`);
            return;
        }
        this.activeCohort = cohortId;
    }

    /**
     * Get active cohort id
     * @returns {string}
     */
    getActiveCohort() {
        return this.activeCohort || 'baseline';
    }

    /**
     * Get formatted label for a segment value
     * @param {string} value - Segment value
     * @returns {string} Formatted label
     */
    formatSegmentLabel(value) {
        if (this.segmentDescriptions[value]) {
            return this.segmentDescriptions[value].label;
        }
        return value;
    }

    /**
     * Get full segment information
     * @param {string} value - Segment value
     * @returns {Object|null} Segment info with label, description, elasticity_level
     */
    getSegmentInfo(value) {
        return this.segmentDescriptions[value] || null;
    }

    /**
     * Generate a single-line summary for a segment based on its composite key and metrics
     * @param {string} compositeKey - "acquisition|engagement|monetization"
     * @param {Object} metrics - { subscriber_count, avg_churn_rate, avg_arpu }
     * @returns {string} Single-line description
     */
    generateSegmentSummary(compositeKey, metrics) {
        const [acquisition, engagement, monetization] = compositeKey.split('|');

        // Get segment info
        const acqInfo = this.segmentDescriptions[acquisition];
        const engInfo = this.segmentDescriptions[engagement];
        const monInfo = this.segmentDescriptions[monetization];

        // Determine key characteristics
        const churnRate = parseFloat(metrics.avg_churn_rate) || 0;
        const arpu = parseFloat(metrics.avg_arpu) || 0;
        const subscribers = parseInt(metrics.subscriber_count) || 0;

        // Size descriptor
        const sizeDesc = subscribers > 2000 ? 'Large' : subscribers > 1000 ? 'Medium-sized' : 'Small';

        // Churn risk level
        const churnRisk = churnRate > 0.18 ? 'very high churn risk' :
                         churnRate > 0.14 ? 'high churn risk' :
                         churnRate > 0.10 ? 'moderate churn' : 'stable retention';

        // Value tier
        const valueTier = arpu > 35 ? 'premium' : arpu > 25 ? 'mid-tier' : 'budget-conscious';

        // Price sensitivity from elasticity info
        const priceSensitivity = engInfo?.elasticity_level?.toLowerCase() || 'moderate price sensitivity';

        // Build smart summary based on most notable characteristic
        let summary = '';

        // Priority 1: High churn segments (biggest risk)
        if (churnRate > 0.15) {
            summary = `${sizeDesc} ${valueTier} segment with ${churnRisk} - requires retention focus`;
        }
        // Priority 2: High-value stable segments (revenue drivers)
        else if (arpu > 30 && churnRate < 0.10) {
            summary = `${sizeDesc} high-value segment with excellent retention - key revenue driver`;
        }
        // Priority 3: Large segments (volume plays)
        else if (subscribers > 2000) {
            summary = `Large ${valueTier} segment with ${churnRisk} - ${priceSensitivity}`;
        }
        // Priority 4: Small high-value segments (niche opportunities)
        else if (arpu > 30) {
            summary = `Small premium segment with ${churnRisk} - niche opportunity`;
        }
        // Priority 5: Everyone else
        else {
            summary = `${sizeDesc} ${valueTier} segment - ${priceSensitivity} with ${churnRisk}`;
        }

        return summary;
    }

    /**
     * Format composite key to human-readable label
     * @param {string} compositeKey - "acquisition|engagement|monetization"
     * @returns {string} Formatted label with separators
     */
    formatCompositeKey(compositeKey) {
        const [acquisition, engagement, monetization] = compositeKey.split('|');
        return `${this.formatSegmentLabel(acquisition)} | ${this.formatSegmentLabel(engagement)} | ${this.formatSegmentLabel(monetization)}`;
    }

    /**
     * Parse composite key into components
     * @param {string} compositeKey - "acquisition|engagement|monetization"
     * @returns {Object} { acquisition, engagement, monetization }
     */
    parseCompositeKey(compositeKey) {
        const [acquisition, engagement, monetization] = compositeKey.split('|');
        return { acquisition, engagement, monetization };
    }

    /**
     * Check if segment data is available
     * @returns {boolean}
     */
    isDataLoaded() {
        return !!(this.segmentElasticity && this.customerSegments && this.segmentKPIs);
    }

    // ========== Private Helper Methods ==========

    /**
     * Index KPIs by composite key AND tier for fast lookup
     * @private
     */
    #indexKPIsByCompositeKey(kpis) {
        const index = {};
        kpis.forEach(kpi => {
            // Use both tier and composite_key as the index to avoid overwriting
            const indexKey = `${kpi.tier}|${kpi.composite_key}`;
            index[indexKey] = kpi;
        });
        return index;
    }

    /**
     * Calculate weighted average
     * @private
     */
    #weightedAvg(segments, metric, weight) {
        const totalWeight = segments.reduce((sum, s) => {
            return sum + parseFloat(s[weight] || 0);
        }, 0);

        if (totalWeight === 0) return 0;

        const weightedSum = segments.reduce((sum, s) => {
            const metricValue = parseFloat(s[metric] || 0);
            const weightValue = parseFloat(s[weight] || 0);
            return sum + (metricValue * weightValue);
        }, 0);

        return weightedSum / totalWeight;
    }

    /**
     * Get base tier elasticity fallback
     * @private
     */
    #getBaseFallback(tier) {
        const baseFallbacks = {
            'ad_supported': -2.1,
            'ad_free': -1.7
        };
        return baseFallbacks[tier] || -1.7;
    }

    /**
     * Get cohort multipliers (dynamically calculated from coefficients)
     * @private
     */
    #getCohortMultipliers() {
        if (!this.cohortCoefficients) return null;

        const activeCohortId = this.getActiveCohort();
        const cohort = this.cohortCoefficients[activeCohortId];
        const baseline = this.cohortCoefficients['baseline'];

        if (!cohort || !baseline) return null;

        // If baseline is selected, no adjustments needed
        if (activeCohortId === 'baseline') {
            return {
                churn: 1.0,
                arpu: 1.0,
                watch_hours: 1.0,
                cac: 1.0,
                subscriber_count: 1.0,
                acquisition_elasticity: 1.0,
                migration_asymmetry: 1.0
            };
        }

        // Calculate multipliers as ratios relative to baseline
        const multipliers = {
            // Churn: ratio of churn elasticity (how much more/less likely to churn)
            churn: cohort.churn_elasticity / baseline.churn_elasticity,

            // ARPU: infer from engagement and tier preference
            // Premium seekers have higher ARPU, value-conscious have lower
            // Using migration_upgrade as proxy: higher upgrade willingness = higher ARPU preference
            arpu: 0.8 + (cohort.migration_upgrade * 0.3),

            // Watch hours: based on engagement_offset
            // Higher engagement offset = more watch hours
            watch_hours: 1.0 + cohort.engagement_offset,

            // CAC: Deal hunters and promo-sensitive have lower CAC (come from cheaper channels)
            // Using migration_downgrade as proxy: higher downgrade = more price-sensitive = lower CAC
            cac: Math.max(0.5, 1.5 - (cohort.migration_downgrade * 0.3)),

            // Subscriber count: don't adjust population distribution
            subscriber_count: 1.0,

            // Acquisition Elasticity: ratio of acquisition elasticity (price sensitivity for NEW customers)
            acquisition_elasticity: Math.abs(cohort.acquisition_elasticity) / Math.abs(baseline.acquisition_elasticity),

            // Migration Asymmetry: ratio of migration asymmetry factor (tier switching propensity)
            migration_asymmetry: cohort.migration_asymmetry_factor / baseline.migration_asymmetry_factor
        };

        return multipliers;
    }

    /**
     * Apply cohort multipliers to axis data
     * @private
     */
    #applyCohortToAxis(axisData) {
        const multipliers = this.#getCohortMultipliers();
        if (!multipliers || !axisData) return axisData;

        const adjusted = { ...axisData };
        if (typeof adjusted.elasticity === 'number') {
            adjusted.elasticity = adjusted.elasticity * multipliers.elasticity;
        }
        if (typeof adjusted.churn_rate === 'number') {
            adjusted.churn_rate = Math.min(1, Math.max(0, adjusted.churn_rate * multipliers.churn));
        }
        if (typeof adjusted.arpu === 'number') {
            adjusted.arpu = adjusted.arpu * multipliers.arpu;
        }
        if (typeof adjusted.cac_sensitivity === 'number') {
            adjusted.cac_sensitivity = adjusted.cac_sensitivity * multipliers.cac_sensitivity;
        }
        if (typeof adjusted.watch_hours === 'number') {
            adjusted.watch_hours = adjusted.watch_hours * multipliers.watch_hours;
        }
        return adjusted;
    }

    /**
     * Apply cohort multipliers to segment axis data
     * @private
     */
    #applyCohortToSegmentData(segmentData) {
        const adjusted = { ...segmentData };
        if (segmentData.acquisition_axis) {
            adjusted.acquisition_axis = this.#applyCohortToAxis(segmentData.acquisition_axis);
        }
        if (segmentData.engagement_axis) {
            adjusted.engagement_axis = this.#applyCohortToAxis(segmentData.engagement_axis);
        }
        if (segmentData.monetization_axis) {
            adjusted.monetization_axis = this.#applyCohortToAxis(segmentData.monetization_axis);
        }
        return adjusted;
    }

    /**
     * Apply cohort multipliers to KPI values
     * @private
     */
    #applyCohortToKPIs(kpis) {
        const multipliers = this.#getCohortMultipliers();

        // If no multipliers or no KPIs, return original
        if (!multipliers || !kpis) return kpis;

        const original = { ...kpis };
        const adjusted = { ...kpis };

        if (adjusted.avg_churn_rate !== undefined) {
            adjusted.avg_churn_rate = Math.min(1, Math.max(0, parseFloat(adjusted.avg_churn_rate) * multipliers.churn));
        }
        if (adjusted.avg_arpu !== undefined) {
            adjusted.avg_arpu = parseFloat(adjusted.avg_arpu) * multipliers.arpu;
        }
        if (adjusted.avg_watch_hours !== undefined) {
            adjusted.avg_watch_hours = parseFloat(adjusted.avg_watch_hours) * multipliers.watch_hours;
        }
        if (adjusted.avg_cac !== undefined) {
            adjusted.avg_cac = parseFloat(adjusted.avg_cac) * multipliers.cac;
        }
        if(adjusted.subscriber_count !== undefined && multipliers.subscriber_count !== undefined) {
            adjusted.subscriber_count = Math.round(parseFloat(adjusted.subscriber_count) * multipliers.subscriber_count);
        }

        return adjusted;
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.segmentEngine = new SegmentationEngine();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SegmentationEngine;
}
