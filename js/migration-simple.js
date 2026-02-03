/**
 * Simplified Tier Migration Model
 * Interactive dual-slider interface for tier pricing
 */

import { loadElasticityParams, loadWeeklyAggregated } from './data-loader.js';

// Chart instance
let migrationChartSimple = null;

// Migration parameters (loaded from elasticity-params.json and weekly_aggregated.csv)
let migrationParams = null;

// Cohort data for asymmetry factors
let cohortData = null;

/**
 * Load cohort data for migration asymmetry
 */
async function loadCohortData() {
  try {
    const response = await fetch('data/cohort_coefficients.json');
    cohortData = await response.json();
    console.log('✓ Loaded cohort profiles for migration');
    return cohortData;
  } catch (error) {
    console.error('Error loading cohort data:', error);
    return null;
  }
}

/**
 * Load migration parameters from actual data sources
 */
async function loadMigrationParams() {
  try {
    const [elasticityData, weeklyData] = await Promise.all([
      loadElasticityParams(),
      loadWeeklyAggregated()
    ]);

    // Get latest week's subscriber counts by tier
    const latestWeek = weeklyData[weeklyData.length - 1];
    const latestByTier = {};

    // Group latest data by tier
    for (let i = weeklyData.length - 1; i >= weeklyData.length - 3 && i >= 0; i--) {
      const row = weeklyData[i];
      if (!latestByTier[row.tier]) {
        latestByTier[row.tier] = row;
      }
    }

    const adSupportedData = latestByTier.ad_supported || {};
    const adFreeData = latestByTier.ad_free || {};

    // Load actual prices and subscriber counts
    const baselineAdLitePrice = elasticityData.tiers.ad_supported.price_range.current;
    const baselineAdFreePrice = elasticityData.tiers.ad_free.price_range.current;
    const baselineGap = baselineAdFreePrice - baselineAdLitePrice;

    const adLiteSubs = parseFloat(adSupportedData.active_subscribers || 10000);
    const adFreeSubs = parseFloat(adFreeData.active_subscribers || 12000);

    // Calculate baseline tier distribution
    const totalSubs = adLiteSubs + adFreeSubs;
    const baselineLitePct = (adLiteSubs / totalSubs) * 100;
    const baselineFreePct = (adFreeSubs / totalSubs) * 100;

    // Baseline churn rates from elasticity params
    const baselineCancelLite = elasticityData.churn_elasticity.ad_supported.baseline_churn * 100;
    const baselineCancelFree = elasticityData.churn_elasticity.ad_free.baseline_churn * 100;

    // Migration rates (estimated from cross-elasticity)
    // Positive cross-elasticity means substitutes - price increase in one tier increases demand for another
    const crossElasticity = elasticityData.cross_elasticity;
    const baselineUpgrade = Math.abs(crossElasticity.ad_supported_to_ad_free) * 10; // ~3% baseline
    const baselineDowngrade = Math.abs(crossElasticity.ad_free_to_ad_supported) * 10; // ~2% baseline

    migrationParams = {
      baselineAdLitePrice,
      baselineAdFreePrice,
      baselineGap,
      baselineLitePct,
      baselineFreePct,
      baselineUpgrade,
      baselineDowngrade,
      baselineCancelLite,
      baselineCancelFree,
      adLiteSubs,
      adFreeSubs,
      crossElasticity: crossElasticity.ad_supported_to_ad_free
    };

    console.log('Migration parameters loaded from actual data:', migrationParams);
    return migrationParams;
  } catch (error) {
    console.error('Error loading migration parameters:', error);
    throw error;
  }
}

/**
 * Initialize the simplified migration section
 */
async function initMigrationSimple() {
  console.log('Initializing simplified migration model...');

  try {
    // Load parameters from actual data
    await loadMigrationParams();
    await loadCohortData();

    // Create chart and Sankey diagram
    createMigrationChartSimple();
    createSankeyDiagram();

    // Setup interactivity
    setupMigrationInteractivity();

    // Initial update
    updateMigrationModel();
  } catch (error) {
    console.error('Failed to initialize migration model:', error);
    // Show error to user
    const container = document.getElementById('step-5-migration-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle me-2"></i>
          Failed to load migration model data. Please refresh the page.
        </div>
      `;
    }
  }
}

/**
 * Create the migration chart
 */
function createMigrationChartSimple() {
  const ctx = document.getElementById('migration-chart-simple');
  if (!ctx) {
    console.warn('Migration chart canvas not found');
    return;
  }

  // Destroy existing chart
  if (migrationChartSimple) {
    migrationChartSimple.destroy();
  }

  // Use loaded baseline data or fallback to placeholder values
  const initialLitePct = migrationParams ? migrationParams.baselineLitePct : 62;
  const initialFreePct = migrationParams ? migrationParams.baselineFreePct : 38;

  migrationChartSimple = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Month 0', 'Month 3', 'Month 6', 'Month 9', 'Month 12'],
      datasets: [
        {
          label: 'Ad-Lite %',
          data: [initialLitePct, initialLitePct, initialLitePct, initialLitePct, initialLitePct],
          borderColor: 'rgba(245, 158, 11, 1)',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        },
        {
          label: 'Ad-Free %',
          data: [initialFreePct, initialFreePct, initialFreePct, initialFreePct, initialFreePct],
          borderColor: 'rgba(0, 102, 255, 1)',
          backgroundColor: 'rgba(0, 102, 255, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + context.parsed.y.toFixed(0) + '%';
            }
          }
        }
      },
      scales: {
        y: {
          min: 30,
          max: 70,
          grid: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark'
              ? 'rgba(255,255,255,0.1)'
              : 'rgba(0,0,0,0.1)'
          },
          ticks: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529',
            callback: (value) => value + '%'
          },
          title: {
            display: true,
            text: 'Tier Mix (%)',
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        }
      }
    }
  });
}

/**
 * Create the Sankey flow diagram
 */
function createSankeyDiagram() {
  if (!migrationParams) return;

  const container = document.getElementById('sankey-diagram');
  if (!container) {
    console.warn('Sankey diagram container not found');
    return;
  }

  // Clear any existing content
  container.innerHTML = '';

  // Initial render with baseline data
  updateSankeyDiagram();
}

/**
 * Update the Sankey diagram with current migration flows
 */
function updateSankeyDiagram(upgradeRate = null, downgradeRate = null, cancelLiteRate = null, cancelFreeRate = null) {
  if (!migrationParams) return;

  const container = document.getElementById('sankey-diagram');
  if (!container) return;

  // Use provided rates or defaults
  const upgrade = upgradeRate !== null ? upgradeRate : migrationParams.baselineUpgrade;
  const downgrade = downgradeRate !== null ? downgradeRate : migrationParams.baselineDowngrade;
  const cancelLite = cancelLiteRate !== null ? cancelLiteRate : migrationParams.baselineCancelLite;
  const cancelFree = cancelFreeRate !== null ? cancelFreeRate : migrationParams.baselineCancelFree;

  // Calculate stay rates
  const stayLite = 100 - upgrade - cancelLite;
  const stayFree = 100 - downgrade - cancelFree;

  // Total subscribers
  const totalLite = migrationParams.adLiteSubs;
  const totalFree = migrationParams.adFreeSubs;

  // Calculate flows (convert percentages to actual numbers)
  const liteToLite = Math.round((stayLite / 100) * totalLite);
  const liteToFree = Math.round((upgrade / 100) * totalLite);
  const liteToChurn = Math.round((cancelLite / 100) * totalLite);

  const freeToFree = Math.round((stayFree / 100) * totalFree);
  const freeToLite = Math.round((downgrade / 100) * totalFree);
  const freeToChurn = Math.round((cancelFree / 100) * totalFree);

  // Define nodes
  const nodes = [
    { name: 'Ad-Lite\n(Current)', id: 0 },
    { name: 'Ad-Free\n(Current)', id: 1 },
    { name: 'Ad-Lite\n(Projected)', id: 2 },
    { name: 'Ad-Free\n(Projected)', id: 3 },
    { name: 'Churned', id: 4 }
  ];

  // Define links
  const links = [
    { source: 0, target: 2, value: liteToLite, type: 'stay' },
    { source: 0, target: 3, value: liteToFree, type: 'upgrade' },
    { source: 0, target: 4, value: liteToChurn, type: 'churn' },
    { source: 1, target: 3, value: freeToFree, type: 'stay' },
    { source: 1, target: 2, value: freeToLite, type: 'downgrade' },
    { source: 1, target: 4, value: freeToChurn, type: 'churn' }
  ];

  // Get container dimensions
  const width = container.clientWidth;
  const height = 400;
  const margin = { top: 20, right: 100, bottom: 20, left: 100 };

  // Remove any existing tooltip
  d3.selectAll('.sankey-tooltip').remove();

  // Clear and create SVG
  container.innerHTML = '';
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  // Create sankey generator
  const sankey = d3.sankey()
    .nodeId(d => d.id)
    .nodeWidth(20)
    .nodePadding(30)
    .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

  // Generate sankey layout
  const { nodes: sankeyNodes, links: sankeyLinks } = sankey({
    nodes: nodes.map(d => Object.assign({}, d)),
    links: links.map(d => Object.assign({}, d))
  });

  // Color scale
  const colors = {
    stay: '#6366f1',        // Blue
    upgrade: '#10b981',     // Green
    downgrade: '#ef4444',   // Red
    churn: '#6b7280'        // Gray
  };

  // Create tooltip div
  const tooltip = d3.select('body')
    .append('div')
    .attr('class', 'sankey-tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background-color', 'rgba(0, 0, 0, 0.9)')
    .style('color', '#fff')
    .style('padding', '12px 16px')
    .style('border-radius', '8px')
    .style('font-size', '13px')
    .style('line-height', '1.6')
    .style('pointer-events', 'none')
    .style('z-index', '9999')
    .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)');

  // Draw links (flows)
  svg.append('g')
    .selectAll('path')
    .data(sankeyLinks)
    .join('path')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', d => colors[d.type])
    .attr('stroke-width', d => Math.max(1, d.width))
    .attr('fill', 'none')
    .attr('opacity', 0.4)
    .on('mouseover', function(_event, d) {
      d3.select(this).attr('opacity', 0.7);

      // Calculate flow metrics
      const sourceTier = d.source.id === 0 ? 'Ad-Lite' : 'Ad-Free';
      const targetTier = d.target.id === 2 ? 'Ad-Lite' : (d.target.id === 3 ? 'Ad-Free' : 'Churned');
      const sourceTotal = d.source.id === 0 ? totalLite : totalFree;
      const pct = (d.value / sourceTotal * 100).toFixed(1);

      // Get prices from sliders
      const adlitePrice = parseFloat(document.getElementById('mig-adlite-slider').value);
      const adfreePrice = parseFloat(document.getElementById('mig-adfree-slider').value);

      // Calculate revenue impact
      let revenueImpact = 0;
      let revenueText = '';

      if (d.type === 'upgrade') {
        revenueImpact = d.value * (adfreePrice - adlitePrice);
        revenueText = `Revenue Impact: <span style="color: #10b981;">+$${Math.abs(revenueImpact).toLocaleString()}</span>`;
      } else if (d.type === 'downgrade') {
        revenueImpact = d.value * (adlitePrice - adfreePrice);
        revenueText = `Revenue Impact: <span style="color: #ef4444;">$${revenueImpact.toLocaleString()}</span>`;
      } else if (d.type === 'churn') {
        const lostPrice = d.source.id === 0 ? adlitePrice : adfreePrice;
        revenueImpact = -1 * d.value * lostPrice;
        revenueText = `Revenue Impact: <span style="color: #ef4444;">-$${Math.abs(revenueImpact).toLocaleString()}</span>`;
      } else {
        revenueText = `Revenue Impact: <span style="color: #94a3b8;">No change (retention)</span>`;
      }

      // Build tooltip HTML
      const flowType = d.type === 'stay' ? 'Retention' :
                       d.type === 'upgrade' ? 'Upgrade' :
                       d.type === 'downgrade' ? 'Downgrade' : 'Churn';

      tooltip.html(`
        <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 6px;">
          ${flowType}: ${sourceTier} → ${targetTier}
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div>Subscribers: <strong>${d.value.toLocaleString()}</strong></div>
          <div>Percentage: <strong>${pct}%</strong> of ${sourceTier}</div>
          <div>${revenueText}</div>
        </div>
      `)
        .style('visibility', 'visible');
    })
    .on('mousemove', function(event) {
      tooltip
        .style('top', (event.pageY - 10) + 'px')
        .style('left', (event.pageX + 15) + 'px');
    })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', 0.4);
      tooltip.style('visibility', 'hidden');
    });

  // Draw nodes
  svg.append('g')
    .selectAll('rect')
    .data(sankeyNodes)
    .join('rect')
    .attr('x', d => d.x0)
    .attr('y', d => d.y0)
    .attr('height', d => Math.max(1, d.y1 - d.y0))
    .attr('width', d => d.x1 - d.x0)
    .attr('fill', d => {
      if (d.id === 4) return colors.churn;
      if (d.id < 2) return '#94a3b8'; // Light gray for current
      return '#1e293b'; // Dark for projected
    })
    .attr('opacity', 0.8);

  // Add node labels
  svg.append('g')
    .selectAll('text')
    .data(sankeyNodes)
    .join('text')
    .attr('x', d => d.x0 < width / 2 ? d.x0 - 6 : d.x1 + 6)
    .attr('y', d => (d.y0 + d.y1) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => d.x0 < width / 2 ? 'end' : 'start')
    .attr('font-size', '12px')
    .attr('font-weight', '600')
    .attr('fill', document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#1e293b')
    .each(function(d) {
      const lines = d.name.split('\n');
      const text = d3.select(this);
      lines.forEach((line, i) => {
        text.append('tspan')
          .attr('x', d.x0 < width / 2 ? d.x0 - 6 : d.x1 + 6)
          .attr('dy', i === 0 ? 0 : '1.2em')
          .text(line);
      });
    });
}

/**
 * Setup slider interactivity
 */
function setupMigrationInteractivity() {
  const adliteSlider = document.getElementById('mig-adlite-slider');
  const adfreeSlider = document.getElementById('mig-adfree-slider');
  const cohortSelect = document.getElementById('mig-cohort-select');

  if (!adliteSlider || !adfreeSlider) {
    console.warn('Migration controls not found');
    return;
  }

  // Slider inputs
  adliteSlider.addEventListener('input', updateMigrationModel);
  adfreeSlider.addEventListener('input', updateMigrationModel);

  // Cohort selection change
  if (cohortSelect && cohortData) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Switching to migration cohort:', selectedCohort);

      // Cohort-specific parameters are now read directly in updateMigrationModel()
      updateMigrationModel();
    });
  }
}

/**
 * Update the migration model based on current inputs
 */
function updateMigrationModel() {
  const adliteSlider = document.getElementById('mig-adlite-slider');
  const adfreeSlider = document.getElementById('mig-adfree-slider');

  if (!adliteSlider || !adfreeSlider || !migrationParams) {
    console.warn('⚠️ updateMigrationModel early return:', {
      adliteSlider: !!adliteSlider,
      adfreeSlider: !!adfreeSlider,
      migrationParams: !!migrationParams
    });
    return;
  }

  const adlitePrice = parseFloat(adliteSlider.value);
  const adfreePrice = parseFloat(adfreeSlider.value);
  const newGap = adfreePrice - adlitePrice;
  const gapChange = ((newGap - migrationParams.baselineGap) / migrationParams.baselineGap) * 100;

  // Calculate price changes for each tier (for churn calculation)
  const adlitePriceChange = ((adlitePrice - migrationParams.baselineAdLitePrice) / migrationParams.baselineAdLitePrice) * 100;
  const adfreePriceChange = ((adfreePrice - migrationParams.baselineAdFreePrice) / migrationParams.baselineAdFreePrice) * 100;

  console.log('📊 Migration Model Update:', {
    baselineAdLitePrice: migrationParams.baselineAdLitePrice,
    baselineAdFreePrice: migrationParams.baselineAdFreePrice,
    adlitePrice,
    adfreePrice,
    adlitePriceChange: adlitePriceChange.toFixed(2) + '%',
    adfreePriceChange: adfreePriceChange.toFixed(2) + '%',
    baselineGap: migrationParams.baselineGap,
    newGap,
    gapChange: gapChange.toFixed(2) + '%',
    chartExists: !!migrationChartSimple
  });

  // Update displays
  document.getElementById('mig-adlite-display').textContent = '$' + adlitePrice.toFixed(2);
  document.getElementById('mig-adfree-display').textContent = '$' + adfreePrice.toFixed(2);
  document.getElementById('mig-price-gap').textContent = '$' + newGap.toFixed(2);
  document.getElementById('mig-gap-change').textContent = (gapChange >= 0 ? '+' : '') + gapChange.toFixed(1) + '%';

  // Get cohort-specific migration parameters
  const selectedCohort = document.getElementById('mig-cohort-select')?.value || 'baseline';
  const cohort = (cohortData && cohortData[selectedCohort]) || cohortData?.baseline || {};

  // Migration asymmetry factor: how much more willing to migrate based on cohort
  // Deal Hunter: 4.5 (very asymmetric - extreme reactions)
  // Tier Flexible: 3.8 (high asymmetry)
  // Baseline: 2.2 (moderate)
  const asymmetryFactor = cohort.migration_asymmetry_factor || 2.2;

  // Base migration willingness (higher = more willing to switch tiers)
  const upgradeWillingness = cohort.migration_upgrade || 1.0;
  const downgradeWillingness = cohort.migration_downgrade || 1.2;

  console.log('🎯 Cohort Migration Profile:', {
    cohort: selectedCohort,
    asymmetryFactor,
    upgradeWillingness,
    downgradeWillingness
  });

  // Calculate migration probabilities based on BOTH gap size AND individual price changes
  // Key insight: When ad-lite increases but ad-free stays constant, upgrade rate should spike!

  // Upgrade Rate Calculation:
  // 1. Base upgrade willingness depends on gap size (sigmoid)
  // 2. Ad-lite price increase amplifies upgrade motivation (customers flee higher ad-lite price)
  // 3. Ad-free price increase reduces upgrade motivation (ad-free becomes less attractive)
  // 4. Cohort asymmetry factor amplifies/dampens the response

  const upgradeMax = 12.0;  // Max 12% upgrade rate (baseline)
  const upgradeK = -0.75;    // Steepness (negative = decreasing with gap)
  const upgradeMidpoint = 2.5;  // Inflection at $2.5 gap

  // Base upgrade from gap (narrower gap = more upgrades)
  let upgradePct = upgradeMax / (1 + Math.exp(upgradeK * (newGap - upgradeMidpoint)));

  // When ad-lite increases significantly, upgrade motivation should OVERRIDE low baseline willingness
  // This is the "fleeing expensive tier" effect - MUCH stronger for high-asymmetry cohorts
  let priceMotivatedUpgrade = 0;
  if (adlitePriceChange > 0) {
    // More aggressive formula for price-motivated upgrade
    // Deal Hunter with asymmetry 4.5 and +33% price = 20-30% upgrade pressure
    // Formula: (price_change_pct / 5) × (asymmetry / 2.2) × gap_attractiveness

    // Gap attractiveness: if gap is small (< $3), ad-free is more attractive
    const gapAttractiveness = newGap < 3 ? 1.5 : (newGap < 4 ? 1.2 : 1.0);

    priceMotivatedUpgrade = (adlitePriceChange / 5) * (asymmetryFactor / 2.2) * gapAttractiveness;

    console.log('📈 Ad-lite increased - Price-motivated upgrade:', {
      priceChange: adlitePriceChange.toFixed(1) + '%',
      asymmetryFactor: asymmetryFactor.toFixed(2),
      gapAttractiveness: gapAttractiveness.toFixed(2),
      priceMotivatedUpgrade: priceMotivatedUpgrade.toFixed(2) + '%'
    });
  }

  // When ad-free increases, upgrade becomes less attractive
  let priceResistanceUpgrade = 0;
  if (adfreePriceChange > 0) {
    // If ad-free also increases, reduce upgrade motivation
    priceResistanceUpgrade = (adfreePriceChange / 10) * (asymmetryFactor / 2.2);
  }

  // Final upgrade rate combines:
  // 1. Gap-based willingness (weighted by cohort baseline willingness)
  // 2. Price-motivated fleeing from expensive ad-lite
  // 3. Price resistance to expensive ad-free
  const gapBasedUpgrade = upgradePct * upgradeWillingness;
  upgradePct = gapBasedUpgrade + priceMotivatedUpgrade - priceResistanceUpgrade;

  // Ensure non-negative
  upgradePct = Math.max(0, upgradePct);

  // Cap upgrade at dynamic limit based on asymmetry (more aggressive cap)
  const upgradeMaxCap = 40.0 * (asymmetryFactor / 2.2);
  upgradePct = Math.min(upgradeMaxCap, upgradePct);

  console.log('🎯 Final Upgrade Calculation:', {
    gapBasedUpgrade: gapBasedUpgrade.toFixed(2) + '%',
    priceMotivatedUpgrade: priceMotivatedUpgrade.toFixed(2) + '%',
    priceResistance: priceResistanceUpgrade.toFixed(2) + '%',
    finalUpgrade: upgradePct.toFixed(2) + '%'
  });

  // Downgrade Rate Calculation:
  // 1. Base downgrade depends on gap size (exponential with threshold)
  // 2. Ad-free price increase amplifies downgrade motivation (customers flee higher ad-free price)
  // 3. Ad-lite price increase reduces downgrade motivation (ad-lite becomes less attractive)
  // 4. Cohort asymmetry factor amplifies/dampens the response

  const downgradeBase = 0.8;  // Base rate at narrow gaps
  const downgradeThreshold = 4.5;  // Acceleration kicks in at $4.5 gap
  let downgradePct;

  if (newGap < downgradeThreshold) {
    downgradePct = downgradeBase + 3.5 * Math.pow(newGap / downgradeThreshold, 2);
  } else {
    downgradePct = downgradeBase + 3.5 + 4.0 * Math.exp(0.35 * (newGap - downgradeThreshold));
  }

  // Price-motivated downgrade when ad-free becomes expensive
  let priceMotivatedDowngrade = 0;
  if (adfreePriceChange > 0) {
    // More aggressive downgrade formula
    const gapAttractiveness = newGap > 5 ? 1.5 : (newGap > 4 ? 1.2 : 1.0);
    priceMotivatedDowngrade = (adfreePriceChange / 5) * (asymmetryFactor / 2.2) * gapAttractiveness;
  }

  // Price resistance to downgrade when ad-lite is also expensive
  let priceResistanceDowngrade = 0;
  if (adlitePriceChange > 0) {
    priceResistanceDowngrade = (adlitePriceChange / 10) * (asymmetryFactor / 2.2);
  }

  // Final downgrade rate combines:
  // 1. Gap-based willingness (weighted by cohort baseline willingness)
  // 2. Price-motivated fleeing from expensive ad-free
  // 3. Price resistance to expensive ad-lite
  const gapBasedDowngrade = downgradePct * downgradeWillingness;
  downgradePct = gapBasedDowngrade + priceMotivatedDowngrade - priceResistanceDowngrade;

  // Ensure non-negative
  downgradePct = Math.max(0, downgradePct);

  // Cap downgrade
  const downgradeMaxCap = 35.0 * (asymmetryFactor / 2.2);
  downgradePct = Math.min(downgradeMaxCap, downgradePct);

  // Dynamic Churn Calculation (based on price elasticity)
  // Churn increases when prices increase, regardless of tier gap
  // Using churn elasticity from cohort data (baseline: 6.5 for baseline cohort)

  const churnElasticity = cohort.churn_elasticity || 6.5;

  // More aggressive churn formula for high-elasticity cohorts
  // Churn impact = (elasticity × price_change_pct) / 50
  // This makes the impact stronger - Deal Hunter with 15.0 elasticity and 33% increase = 10% churn impact
  const churnImpactLite = (churnElasticity * adlitePriceChange) / 50; // More aggressive
  const churnImpactFree = (churnElasticity * adfreePriceChange) / 50;

  let cancelLitePct = migrationParams.baselineCancelLite + churnImpactLite;
  let cancelFreePct = migrationParams.baselineCancelFree + churnImpactFree;

  // Floor churn at baseline, cap at 35% for extreme scenarios
  cancelLitePct = Math.max(migrationParams.baselineCancelLite, Math.min(35, cancelLitePct));
  cancelFreePct = Math.max(migrationParams.baselineCancelFree, Math.min(35, cancelFreePct));

  console.log('💀 Churn Calculation:', {
    cohort: selectedCohort,
    churnElasticity: churnElasticity.toFixed(1),
    adlitePriceChange: adlitePriceChange.toFixed(1) + '%',
    adfreePriceChange: adfreePriceChange.toFixed(1) + '%',
    churnImpactLite: churnImpactLite.toFixed(2) + ' pp',
    cancelLitePct: cancelLitePct.toFixed(2) + '%',
    cancelFreePct: cancelFreePct.toFixed(2) + '%'
  });

  // Update table
  document.getElementById('mig-upgrade-pct').textContent = upgradePct.toFixed(1) + '%';
  document.getElementById('mig-downgrade-pct').textContent = downgradePct.toFixed(1) + '%';
  document.getElementById('mig-cancel-lite-pct').textContent = cancelLitePct.toFixed(1) + '%';
  document.getElementById('mig-cancel-free-pct').textContent = cancelFreePct.toFixed(1) + '%';

  // Calculate subscriber counts (using dynamic churn rates)
  const upgradeSubs = Math.round(migrationParams.adLiteSubs * (upgradePct / 100));
  const downgradeSubs = Math.round(migrationParams.adFreeSubs * (downgradePct / 100));
  const cancelLiteSubs = Math.round(migrationParams.adLiteSubs * (cancelLitePct / 100));
  const cancelFreeSubs = Math.round(migrationParams.adFreeSubs * (cancelFreePct / 100));

  document.getElementById('mig-upgrade-subs').textContent = '~' + upgradeSubs.toLocaleString();
  document.getElementById('mig-downgrade-subs').textContent = '~' + downgradeSubs.toLocaleString();
  document.getElementById('mig-cancel-lite-subs').textContent = '~' + cancelLiteSubs.toLocaleString();
  document.getElementById('mig-cancel-free-subs').textContent = '~' + cancelFreeSubs.toLocaleString();

  // Calculate revenue impacts
  const upgradeRev = upgradeSubs * (adfreePrice - adlitePrice);
  const downgradeRev = downgradeSubs * (adlitePrice - adfreePrice);
  const cancelLiteRev = cancelLiteSubs * adlitePrice * -1;
  const cancelFreeRev = cancelFreeSubs * adfreePrice * -1;

  document.getElementById('mig-upgrade-rev').textContent = '+$' + Math.abs(upgradeRev).toLocaleString();
  document.getElementById('mig-downgrade-rev').textContent = '$' + downgradeRev.toLocaleString();
  document.getElementById('mig-cancel-lite-rev').textContent = '$' + cancelLiteRev.toLocaleString();
  document.getElementById('mig-cancel-free-rev').textContent = '$' + cancelFreeRev.toLocaleString();

  // Calculate tier mix shift
  const shift = (upgradePct - migrationParams.baselineUpgrade) - (downgradePct - migrationParams.baselineDowngrade);
  const newLitePct = Math.max(40, Math.min(80, migrationParams.baselineLitePct - shift));
  const newFreePct = 100 - newLitePct;

  document.getElementById('mig-adlite-pct').textContent = newLitePct.toFixed(0) + '%';
  document.getElementById('mig-adfree-pct').textContent = newFreePct.toFixed(0) + '%';

  // Update arrow direction
  const arrow = document.getElementById('mig-arrow');
  if (shift > 0.5) {
    arrow.textContent = '→';
    arrow.style.color = 'var(--primary-green)';
  } else if (shift < -0.5) {
    arrow.textContent = '←';
    arrow.style.color = 'var(--primary-red)';
  } else {
    arrow.textContent = '↔';
    arrow.style.color = 'var(--primary-blue)';
  }

  // Update chart with proper compounding migration rates
  if (migrationChartSimple) {
    // Calculate net migration rate per period (monthly)
    // Net flow = upgrades - downgrades (as a percentage of Ad-Lite population)
    const netFlowRate = (upgradePct - downgradePct) / 100; // Convert to decimal

    // Apply compounding migration each month
    const liteTrend = [migrationParams.baselineLitePct];
    const freeTrend = [migrationParams.baselineFreePct];

    let currentLitePct = migrationParams.baselineLitePct;

    for (let month = 1; month <= 4; month++) {
      // Each month, a percentage of Ad-Lite subscribers migrate
      // This compounds because we apply rate to the NEW mix, not the original
      const absoluteChange = currentLitePct * netFlowRate;
      currentLitePct = Math.max(40, Math.min(80, currentLitePct - absoluteChange));
      const currentFreePct = 100 - currentLitePct;

      liteTrend.push(currentLitePct);
      freeTrend.push(currentFreePct);
    }

    console.log('📈 Updating Migration Chart:', {
      baselineLitePct: migrationParams.baselineLitePct,
      baselineFreePct: migrationParams.baselineFreePct,
      newLitePct: newLitePct,
      newFreePct: newFreePct,
      shift: shift,
      liteTrend: liteTrend,
      freeTrend: freeTrend
    });

    migrationChartSimple.data.datasets[0].data = liteTrend;
    migrationChartSimple.data.datasets[1].data = freeTrend;
    migrationChartSimple.update('none'); // Instant update
  }

  // Update Sankey diagram (with dynamic churn rates)
  updateSankeyDiagram(
    upgradePct,
    downgradePct,
    cancelLitePct,
    cancelFreePct
  );
}

// Export for use in step-navigation.js
window.initMigrationSimple = initMigrationSimple;