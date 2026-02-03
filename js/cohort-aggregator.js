/**
 * Cohort Aggregator Module
 * Aggregates 375 customer segments into cohorts for model predictions
 */

/**
 * Aggregate segments into acquisition cohorts
 * Groups by acquisition_segment (5 cohorts)
 */
export async function getAcquisitionCohorts(tier) {
  try {
    // Load segment data
    const segmentKPIs = await loadSegmentKPIs();
    const segmentElasticity = await loadSegmentElasticity();

    // Define acquisition segment types
    const acquisitionSegments = [
      'habitual_streamers',
      'content_anchored_viewers',
      'at_risk_lapsers',
      'promo_only_users',
      'dormant_subscribers'
    ];

    const cohorts = [];

    for (const segmentType of acquisitionSegments) {
      // Filter segments for this cohort and tier
      const cohortSegments = segmentKPIs.filter(s => {
        const compositeKey = s.composite_key;
        const [acq, eng, mon] = compositeKey.split('|');
        return acq === segmentType && s.tier === tier;
      });

      if (cohortSegments.length === 0) continue;

      // Calculate cohort size (sum of subscriber counts)
      const size = cohortSegments.reduce((sum, s) => sum + parseInt(s.subscriber_count), 0);

      // Calculate average elasticity for acquisition axis
      let elasticitySum = 0;
      let elasticityCount = 0;

      for (const segment of cohortSegments) {
        const elasticityData = segmentElasticity[tier]?.segment_elasticity?.[segment.composite_key];
        if (elasticityData?.acquisition_axis?.elasticity) {
          elasticitySum += elasticityData.acquisition_axis.elasticity;
          elasticityCount++;
        }
      }

      const avgElasticity = elasticityCount > 0 ? elasticitySum / elasticityCount : -1.8;

      // Friendly name mapping
      const nameMap = {
        'habitual_streamers': 'Habitual Streamers',
        'content_anchored_viewers': 'Content-Anchored Viewers',
        'at_risk_lapsers': 'At-Risk Lapsers',
        'promo_only_users': 'Promo-Only Users',
        'dormant_subscribers': 'Dormant Subscribers'
      };

      cohorts.push({
        name: nameMap[segmentType] || segmentType,
        size: size,
        elasticity: avgElasticity
      });
    }

    return cohorts;
  } catch (error) {
    console.error('Error aggregating acquisition cohorts:', error);
    return [];
  }
}

/**
 * Aggregate segments into churn cohorts
 * Groups by engagement_segment (5 cohorts)
 */
export async function getChurnCohorts(tier) {
  try {
    const segmentKPIs = await loadSegmentKPIs();
    const segmentElasticity = await loadSegmentElasticity();

    const engagementSegments = [
      'ad_value_seekers',
      'ad_tolerant_upgraders',
      'ad_free_loyalists',
      'price_triggered_downgraders',
      'tvod_inclined_buyers'
    ];

    const cohorts = [];

    for (const segmentType of engagementSegments) {
      const cohortSegments = segmentKPIs.filter(s => {
        const compositeKey = s.composite_key;
        const [acq, eng, mon] = compositeKey.split('|');
        return eng === segmentType && s.tier === tier;
      });

      if (cohortSegments.length === 0) continue;

      const size = cohortSegments.reduce((sum, s) => sum + parseInt(s.subscriber_count), 0);

      let elasticitySum = 0;
      let elasticityCount = 0;

      for (const segment of cohortSegments) {
        const elasticityData = segmentElasticity[tier]?.segment_elasticity?.[segment.composite_key];
        if (elasticityData?.engagement_axis?.elasticity) {
          elasticitySum += elasticityData.engagement_axis.elasticity;
          elasticityCount++;
        }
      }

      const avgElasticity = elasticityCount > 0 ? elasticitySum / elasticityCount : -2.1;

      const nameMap = {
        'ad_value_seekers': 'Ad-Value Seekers',
        'ad_tolerant_upgraders': 'Ad-Tolerant Upgraders',
        'ad_free_loyalists': 'Ad-Free Loyalists',
        'price_triggered_downgraders': 'Price-Triggered Downgraders',
        'tvod_inclined_buyers': 'TVOD-Inclined Buyers'
      };

      cohorts.push({
        name: nameMap[segmentType] || segmentType,
        size: size,
        elasticity: avgElasticity
      });
    }

    return cohorts;
  } catch (error) {
    console.error('Error aggregating churn cohorts:', error);
    return [];
  }
}

/**
 * Load segment KPIs from CSV
 */
async function loadSegmentKPIs() {
  const response = await fetch('data/segment_kpis.csv');
  const text = await response.text();

  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i];
    });
    return obj;
  });
}

/**
 * Load segment elasticity from JSON
 */
async function loadSegmentElasticity() {
  const response = await fetch('data/segment_elasticity.json');
  return await response.json();
}
