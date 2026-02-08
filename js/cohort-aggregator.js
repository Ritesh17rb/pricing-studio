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
    console.log(`[Cohort Aggregator] Loading data for tier: ${tier}`);

    // Load segment data
    const segmentKPIs = await loadSegmentKPIs();
    console.log(`[Cohort Aggregator] Loaded ${segmentKPIs.length} segment KPIs`);

    const segmentElasticity = await loadSegmentElasticity();
    console.log(`[Cohort Aggregator] Loaded segment elasticity data:`, Object.keys(segmentElasticity));

    // Define acquisition segment types (visit frequency)
    const acquisitionSegments = [
      'one_time',
      'occasional',
      'regular',
      'frequent',
      'season_pass'
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

      // Calculate cohort size (sum of visitor counts)
      const size = cohortSegments.reduce((sum, s) => sum + parseInt(s.visitor_count), 0);

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
        'one_time': 'One-Time Visitors',
        'occasional': 'Occasional Visitors',
        'regular': 'Regular Visitors',
        'frequent': 'Frequent Visitors',
        'season_pass': 'Season Pass Holders'
      };

      cohorts.push({
        id: segmentType,
        name: nameMap[segmentType] || segmentType,
        size: size,
        elasticity: avgElasticity
      });
    }

    console.log(`[Cohort Aggregator] Returning ${cohorts.length} cohorts for ${tier}`);
    return cohorts;
  } catch (error) {
    console.error('[Cohort Aggregator] Error aggregating acquisition cohorts:', error);
    console.error('[Cohort Aggregator] Error stack:', error.stack);
    throw error; // Re-throw to propagate error
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
      'solo',
      'couple',
      'family_small',
      'family_large',
      'group'
    ];

    const cohorts = [];

    for (const segmentType of engagementSegments) {
      const cohortSegments = segmentKPIs.filter(s => {
        const compositeKey = s.composite_key;
        const [acq, eng, mon] = compositeKey.split('|');
        return eng === segmentType && s.tier === tier;
      });

      if (cohortSegments.length === 0) continue;

      const size = cohortSegments.reduce((sum, s) => sum + parseInt(s.visitor_count), 0);

      let elasticitySum = 0;
      let elasticityCount = 0;

      for (const segment of cohortSegments) {
        const elasticityData = segmentElasticity[tier]?.segment_elasticity?.[segment.composite_key];
        if (elasticityData?.churn_axis?.elasticity) {
          elasticitySum += elasticityData.churn_axis.elasticity;
          elasticityCount++;
        }
      }

      const avgElasticity = elasticityCount > 0 ? elasticitySum / elasticityCount : 0.5;

      console.log(`[Churn Cohort] ${segmentType}: size=${size}, elasticity=${avgElasticity.toFixed(3)} (from ${elasticityCount} segments)`);

      const nameMap = {
        'solo': 'Solo Visitors',
        'couple': 'Couples',
        'family_small': 'Small Families',
        'family_large': 'Large Families',
        'group': 'Groups'
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
