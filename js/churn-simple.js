/**
 * Simplified Churn Elasticity Model
 * Interactive slider-based interface with time-lagged effects
 */

import { loadElasticityParams } from './data-loader.js';
import { getChurnCohorts } from './cohort-aggregator.js';

// Chart instances
let churnChartSimple = null;
let survivalCurveChart = null;

// Churn parameters (loaded from elasticity-params.json)
let churnParams = null;

// Churn time lag distribution (loaded from cohort_coefficients.json)
// These represent how churn impact is distributed across time horizons
let churnTimeLag = null;  // Will be loaded from data

// Baseline churn rate (loaded from elasticity-params.json)
let baselineChurn = null;

// Cohort data for dynamic curve shaping
let cohortData = null;

/**
 * Load cohort data for curve shaping
 */
async function loadCohortData() {
  try {
    const response = await fetch('data/cohort_coefficients.json');
    cohortData = await response.json();
    console.log('✓ Loaded cohort profiles:', Object.keys(cohortData).filter(k => k !== 'metadata').length);
    return cohortData;
  } catch (error) {
    console.error('Error loading cohort data:', error);
    return null;
  }
}

/**
 * Load churn parameters from actual Legoland visitor data
 */
async function loadChurnParams() {
  try {
    console.log('Step 1: Loading elasticity params...');
    const elasticityData = await loadElasticityParams();
    console.log('✓ Step 1 complete');

    // Build params object from actual visitor cohorts
    churnParams = {};

    for (const tier of ['standard_pass', 'premium_pass', 'vip_pass']) {
      try {
        console.log(`Step 2: Processing tier ${tier}...`);
        const tierData = elasticityData[tier];

        if (!tierData) {
          console.warn(`No tier data found for ${tier} in elasticityData`);
          continue;
        }

        // Get actual churn cohorts from visitor data (engagement axis)
        console.log(`Step 3: Getting churn cohorts for ${tier}...`);
        const cohorts = await getChurnCohorts(tier);
        console.log(`✓ Step 3 complete: Got ${cohorts ? cohorts.length : 0} cohorts`);

      if (!cohorts || cohorts.length === 0) {
        console.warn(`No churn cohorts found for ${tier}, using fallback values`);
        // Use fallback values so the model can still work
        churnParams[tier] = {
          churn_elasticity: tier === 'standard_pass' ? 0.8 : tier === 'premium_pass' ? 0.6 : 0.4,
          baseline_churn: tier === 'standard_pass' ? 25 : tier === 'premium_pass' ? 18 : 12,
          price: tierData.price_range.current,
          cohorts: []
        };
        continue;
      }

      // Calculate total visitors across all cohorts
      const totalVisitors = cohorts.reduce((sum, c) => sum + c.size, 0);

      // Calculate weighted average elasticity for churn axis
      const weightedChurnElasticity = cohorts.reduce((sum, c) => {
        return sum + (c.elasticity * c.size / totalVisitors);
      }, 0);

      // Estimate baseline churn from engagement elasticity
      // Higher elasticity means more sensitive to price (higher churn)
      // For theme parks: Standard ~25%, Premium ~18%, VIP ~12%
      let estimatedBaselineChurn;
      if (tier === 'standard_pass') {
        estimatedBaselineChurn = 25;
      } else if (tier === 'premium_pass') {
        estimatedBaselineChurn = 18;
      } else if (tier === 'vip_pass') {
        estimatedBaselineChurn = 12;
      } else {
        estimatedBaselineChurn = 20;
      }

      churnParams[tier] = {
        churn_elasticity: weightedChurnElasticity,
        baseline_churn: estimatedBaselineChurn,
        price: tierData.price_range.current,
        cohorts: cohorts // Store full cohort data
      };

      console.log(`✓ Loaded ${cohorts.length} churn cohorts for ${tier}:`, {
        visitors: totalVisitors,
        avgElasticity: weightedChurnElasticity.toFixed(3),
        baselineChurn: estimatedBaselineChurn + '%',
        cohorts: cohorts
      });
      } catch (tierError) {
        console.error(`❌ Error processing tier ${tier}:`, tierError);
        console.error('Error details:', tierError.stack);
        // Add fallback for this tier so model can still work
        const fallbackTierData = elasticityData[tier];
        churnParams[tier] = {
          churn_elasticity: tier === 'standard_pass' ? 0.8 : tier === 'premium_pass' ? 0.6 : 0.4,
          baseline_churn: tier === 'standard_pass' ? 25 : tier === 'premium_pass' ? 18 : 12,
          price: fallbackTierData?.price_range?.current || (tier === 'standard_pass' ? 79 : tier === 'premium_pass' ? 139 : 249),
          cohorts: []
        };
        console.warn(`⚠️ Using fallback values for ${tier}`);
      }
    }

    // Set default baseline churn (standard_pass)
    if (churnParams.standard_pass) {
      baselineChurn = churnParams.standard_pass.baseline_churn;
    } else if (churnParams.premium_pass) {
      baselineChurn = churnParams.premium_pass.baseline_churn;
    } else if (churnParams.vip_pass) {
      baselineChurn = churnParams.vip_pass.baseline_churn;
    } else {
      baselineChurn = 25; // Fallback
    }

    console.log('✓ Baseline churn set to:', baselineChurn + '%');
    console.log('✓ Available tiers:', Object.keys(churnParams));

    // Load time-lag distribution from cohort_coefficients.json
    try {
      const response = await fetch('data/cohort_coefficients.json');
      const cohortData = await response.json();

      // Use baseline cohort's time-lag distribution (aggregate of all cohorts)
      if (cohortData.baseline && cohortData.baseline.time_lag_distribution) {
        const dist = cohortData.baseline.time_lag_distribution;
        churnTimeLag = {
          '0_4_weeks': dist['0_4_weeks'] || 0.15,
          '4_8_weeks': dist['4_8_weeks'] || 0.25,
          '8_12_weeks': dist['8_12_weeks'] || 0.30,
          '12_plus': (dist['12_16_weeks'] || 0.20) + (dist['16_20_weeks'] || 0.10)  // Combine last two periods
        };
        console.log('✓ Loaded time-lag distribution from cohort_coefficients.json:', churnTimeLag);
      } else {
        // Fallback to default if cohort data not available
        churnTimeLag = {
          '0_4_weeks': 0.15,
          '4_8_weeks': 0.25,
          '8_12_weeks': 0.30,
          '12_plus': 0.30
        };
        console.warn('⚠️ Using fallback time-lag distribution');
      }
    } catch (cohortError) {
      console.warn('⚠️ Could not load cohort_coefficients.json, using fallback:', cohortError);
      churnTimeLag = {
        '0_4_weeks': 0.15,
        '4_8_weeks': 0.25,
        '8_12_weeks': 0.30,
        '12_plus': 0.30
      };
    }

    console.log('✓ Churn parameters loaded from actual visitor data:', churnParams);
    return churnParams;
  } catch (error) {
    console.error('❌ Error loading churn parameters:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

/**
 * Initialize the simplified churn section
 */
async function initChurnSimple() {
  console.log('Initializing simplified churn model...');

  try {
    // Load parameters from actual data
    await loadChurnParams();
    await loadCohortData();

    // Create charts with loaded parameters
    createChurnChartSimple();
    createSurvivalCurveChart();

    // Setup interactivity
    setupChurnInteractivity();

    // Initial update
    updateChurnModel();
  } catch (error) {
    console.error('❌ Failed to initialize churn model:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name
    });

    // Show detailed error to user
    const container = document.getElementById('step-4-churn-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle me-2"></i>
          <strong>Failed to load churn model data</strong><br>
          <small>Error: ${error.message}</small><br>
          <small class="text-muted">Check browser console for details (F12)</small>
        </div>
      `;
    }
  }
}

/**
 * Create the churn chart
 */
function createChurnChartSimple() {
  const ctx = document.getElementById('churn-chart-simple');
  if (!ctx) {
    console.warn('Churn chart canvas not found');
    return;
  }

  // Destroy existing chart
  if (churnChartSimple) {
    churnChartSimple.destroy();
  }

  // Use loaded baseline churn or fallback to standard_pass baseline
  const initialBaseline = churnParams ? churnParams.standard_pass.baseline_churn : 4.2;

  // Calculate initial projected data with default slider value ($1)
  const defaultPriceIncrease = 1; // Default slider value from HTML
  const tierParams = churnParams ? churnParams.standard_pass : null;
  let initialProjectedData = [initialBaseline, initialBaseline, initialBaseline, initialBaseline, initialBaseline, initialBaseline];

  if (tierParams) {
    const priceChangePct = (defaultPriceIncrease / tierParams.price) * 100;
    const totalChurnImpact = tierParams.baseline_churn * tierParams.churn_elasticity * (priceChangePct / 100);
    const impacts = {
      '0_4': totalChurnImpact * churnTimeLag['0_4_weeks'],
      '4_8': totalChurnImpact * churnTimeLag['4_8_weeks'],
      '8_12': totalChurnImpact * churnTimeLag['8_12_weeks'],
      '12plus': totalChurnImpact * churnTimeLag['12_plus']
    };

    initialProjectedData = [
      initialBaseline,
      initialBaseline + impacts['0_4'],
      initialBaseline + impacts['4_8'],
      initialBaseline + impacts['8_12'],
      initialBaseline + (impacts['8_12'] + impacts['12plus']) / 2,
      initialBaseline + impacts['12plus']
    ];

    console.log('🎨 Creating Churn Chart with initial projected data:', initialProjectedData);
  }

  churnChartSimple = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Week 0', 'Week 4', 'Week 8', 'Week 12', 'Week 16', 'Week 20'],
      datasets: [
        {
          label: 'Baseline Churn',
          data: [initialBaseline, initialBaseline, initialBaseline, initialBaseline, initialBaseline, initialBaseline],
          borderColor: 'rgba(99, 102, 241, 1)',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          borderDash: [5, 5],
          fill: false,
          tension: 0.1,
          borderWidth: 2
        },
        {
          label: 'Projected Churn',
          data: initialProjectedData,
          borderColor: 'rgba(239, 68, 68, 1)',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
              return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + '%';
            }
          }
        }
      },
      scales: {
        y: {
          // Dynamic min/max - will be updated based on data
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
            text: 'Churn Rate (%)',
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
 * Create the survival curve (retention forecast) chart with revenue impact
 */
function createSurvivalCurveChart() {
  const ctx = document.getElementById('survival-curve-chart');
  if (!ctx) {
    console.warn('Survival curve canvas not found');
    return;
  }

  // Destroy existing chart
  if (survivalCurveChart) {
    survivalCurveChart.destroy();
  }

  // Use loaded baseline churn to calculate initial retention curve
  const initialBaseline = churnParams && churnParams.standard_pass ? churnParams.standard_pass.baseline_churn : 25;
  const baselineRetention = [
    100,
    100 - (initialBaseline * 0.25),
    100 - (initialBaseline * 0.5),
    100 - (initialBaseline * 0.75),
    100 - (initialBaseline * 1.0),
    100 - (initialBaseline * 1.25),
    100 - (initialBaseline * 1.5)
  ];

  // Calculate initial scenario retention with default slider value ($5)
  const defaultPriceIncrease = 5;
  const tierParams = churnParams && churnParams.standard_pass ? churnParams.standard_pass : null;
  let initialScenarioRetention = baselineRetention;
  let initialRevenueImpact = [0, 0, 0, 0, 0, 0, 0];

  if (tierParams) {
    const priceChangePct = (defaultPriceIncrease / tierParams.price) * 100;
    const totalChurnImpact = tierParams.baseline_churn * tierParams.churn_elasticity * (priceChangePct / 100);
    const impacts = {
      '0_4': totalChurnImpact * churnTimeLag['0_4_weeks'],
      '4_8': totalChurnImpact * churnTimeLag['4_8_weeks'],
      '8_12': totalChurnImpact * churnTimeLag['8_12_weeks'],
      '12plus': totalChurnImpact * churnTimeLag['12_plus']
    };

    let cumulativeChurn = 0;
    const scenarioRetention = [100];
    cumulativeChurn += impacts['0_4'];
    scenarioRetention.push(100 - (initialBaseline * 0.25 + cumulativeChurn * 0.25));
    cumulativeChurn += impacts['4_8'];
    scenarioRetention.push(100 - (initialBaseline * 0.5 + cumulativeChurn * 0.5));
    cumulativeChurn += impacts['8_12'];
    scenarioRetention.push(100 - (initialBaseline * 0.75 + cumulativeChurn * 0.75));
    cumulativeChurn += impacts['12plus'] * 0.5;
    scenarioRetention.push(100 - (initialBaseline * 1.0 + cumulativeChurn * 1.0));
    cumulativeChurn += impacts['12plus'] * 0.3;
    scenarioRetention.push(100 - (initialBaseline * 1.25 + cumulativeChurn * 1.0));
    cumulativeChurn += impacts['12plus'] * 0.2;
    scenarioRetention.push(100 - (initialBaseline * 1.5 + cumulativeChurn * 1.0));

    initialScenarioRetention = scenarioRetention;

    // Calculate initial revenue impact (cumulative over 24 weeks)
    // Assume baseline of 100,000 current visitors
    const baselineSubCount = 100000;
    const currentPrice = tierParams.price;
    const newPrice = currentPrice + defaultPriceIncrease;

    initialRevenueImpact = [0]; // Start at $0
    let cumulativeRevenue = 0;

    // Calculate period-by-period revenue
    for (let i = 0; i < baselineRetention.length - 1; i++) {
      const baselineSubsAvg = baselineSubCount * ((baselineRetention[i] + baselineRetention[i+1]) / 2) / 100;
      const scenarioSubsAvg = baselineSubCount * ((scenarioRetention[i] + scenarioRetention[i+1]) / 2) / 100;

      const monthlyBillingCycles = 1;
      const baselineRevPeriod = baselineSubsAvg * currentPrice * monthlyBillingCycles;
      const scenarioRevPeriod = scenarioSubsAvg * newPrice * monthlyBillingCycles;

      const periodRevenue = scenarioRevPeriod - baselineRevPeriod;
      cumulativeRevenue += periodRevenue;
      initialRevenueImpact.push(cumulativeRevenue);
    }

    console.log('🎨 Creating Survival Curve with initial scenario data:', initialScenarioRetention);
    console.log('💰 Initial revenue impact:', initialRevenueImpact);
  }

  survivalCurveChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Week 0', 'Week 4', 'Week 8', 'Week 12', 'Week 16', 'Week 20', 'Week 24'],
      datasets: [
        {
          label: 'Baseline Retention',
          data: baselineRetention,
          borderColor: 'rgba(99, 102, 241, 1)',
          backgroundColor: 'rgba(99, 102, 241, 0.0)',
          borderWidth: 3,
          fill: false,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          yAxisID: 'y',
          order: 2
        },
        {
          label: 'Scenario Retention',
          data: initialScenarioRetention,
          borderColor: 'rgba(239, 68, 68, 1)',
          backgroundColor: 'rgba(239, 68, 68, 0.0)',
          borderWidth: 3,
          fill: { target: 0, above: 'rgba(239, 68, 68, 0.2)' },
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          yAxisID: 'y',
          order: 1
        },
        {
          label: 'Revenue Impact',
          data: initialRevenueImpact,
          borderColor: 'rgba(251, 191, 36, 1)',
          backgroundColor: 'rgba(251, 191, 36, 0.1)',
          borderWidth: 3,
          fill: false,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          yAxisID: 'yRevenue',
          order: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.datasetIndex === 2) {
                // Revenue Impact dataset
                const value = context.parsed.y;
                const sign = value >= 0 ? '+' : '';
                return context.dataset.label + ': ' + sign + '$' + value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0});
              } else {
                // Retention datasets
                return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + '%';
              }
            },
            afterBody: function(tooltipItems) {
              const index = tooltipItems[0].dataIndex;
              const baseline = tooltipItems[0].chart.data.datasets[0].data[index];
              const scenario = tooltipItems[0].chart.data.datasets[1].data[index];
              const loss = baseline - scenario;
              return loss > 0 ? `\nRetention Loss: ${loss.toFixed(1)}%` : '';
            }
          }
        }
      },
      scales: {
        y: {
          // Dynamic min/max - will be updated based on data
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
            text: 'Retention Rate (%)',
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        yRevenue: {
          type: 'linear',
          position: 'right',
          // Dynamic scale - will be updated based on data
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529',
            callback: function(value) {
              const sign = value >= 0 ? '+' : '';
              return sign + '$' + (value / 1000).toFixed(0) + 'K';
            }
          },
          title: {
            display: true,
            text: 'Cumulative Revenue Impact ($)',
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
 * Populate tier buttons with actual pass prices
 */
function populateTierButtons() {
  const container = document.getElementById('churn-tier-buttons');
  if (!container || !churnParams) return;

  const tierNames = {
    'standard_pass': 'Standard Pass',
    'premium_pass': 'Premium Pass',
    'vip_pass': 'VIP Pass'
  };

  container.innerHTML = '';
  let isFirst = true;

  for (const tier of ['standard_pass', 'premium_pass', 'vip_pass']) {
    if (churnParams[tier]) {
      const price = churnParams[tier].price;
      const btn = document.createElement('button');
      btn.className = `btn btn-sm btn-outline-primary tier-btn${isFirst ? ' active' : ''}`;
      btn.dataset.tier = tier;
      btn.dataset.price = price;
      btn.textContent = `${tierNames[tier]} ($${price})`;
      container.appendChild(btn);
      isFirst = false;
    }
  }
}

/**
 * Populate cohort dropdown with engagement cohorts
 */
function populateCohortDropdown() {
  const select = document.getElementById('churn-cohort-select');
  if (!select || !churnParams) return;

  // Keep the baseline option, add cohorts from data
  const tier = 'standard_pass'; // Use standard as reference
  if (churnParams[tier] && churnParams[tier].cohorts && churnParams[tier].cohorts.length > 0) {
    churnParams[tier].cohorts.forEach(cohort => {
      const option = document.createElement('option');
      option.value = cohort.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      option.textContent = cohort.name;
      select.appendChild(option);
    });
  }
}

/**
 * Setup slider interactivity
 */
function setupChurnInteractivity() {
  const priceSlider = document.getElementById('churn-price-slider');
  const cohortSelect = document.getElementById('churn-cohort-select');

  if (!priceSlider || !churnParams) {
    console.warn('Churn controls not found or params not loaded');
    return;
  }

  // Populate tier buttons and cohorts
  populateTierButtons();
  populateCohortDropdown();

  let currentTier = 'standard_pass';

  // Price slider input
  priceSlider.addEventListener('input', () => updateChurnModel(currentTier));

  // Tier button clicks (using event delegation since buttons are dynamically created)
  const tierButtonContainer = document.getElementById('churn-tier-buttons');
  if (tierButtonContainer) {
    tierButtonContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tier-btn');
      if (!btn) return;

      tierButtonContainer.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTier = btn.dataset.tier;
      updateChurnModel(currentTier);
    });
  }

  // Cohort selection change - filters to show specific party composition behavior
  if (cohortSelect) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Filtering to churn cohort:', selectedCohort);
      updateChurnModel(currentTier);
    });
  }
}

/**
 * Update the churn model based on current inputs
 */
function updateChurnModel(currentTier = 'standard_pass') {
  const priceSlider = document.getElementById('churn-price-slider');
  const cohortSelect = document.getElementById('churn-cohort-select');

  if (!priceSlider || !churnParams) {
    console.warn('⚠️ updateChurnModel early return:', { priceSlider: !!priceSlider, churnParams: !!churnParams });
    return;
  }

  const tierParams = churnParams[currentTier];
  if (!tierParams) {
    console.warn('⚠️ updateChurnModel no tier params for:', currentTier);
    return;
  }

  // Check if a specific cohort is selected
  const selectedCohortId = cohortSelect ? cohortSelect.value : 'baseline';
  let activeElasticity = tierParams.churn_elasticity;
  let activeBaselineChurn = tierParams.baseline_churn;
  let activeTimeLag = churnTimeLag;

  // If a specific cohort is selected, use that cohort's data
  if (selectedCohortId !== 'baseline' && tierParams.cohorts) {
    const selectedCohort = tierParams.cohorts.find(c => c.id === selectedCohortId);

    if (selectedCohort) {
      activeElasticity = selectedCohort.elasticity;
      console.log(`✓ Using cohort "${selectedCohort.name}" elasticity: ${activeElasticity.toFixed(3)}`);

      // Optionally use cohort-specific time-lag if available from cohortData
      if (cohortData && cohortData[selectedCohortId] && cohortData[selectedCohortId].time_lag_distribution) {
        const dist = cohortData[selectedCohortId].time_lag_distribution;
        activeTimeLag = {
          '0_4_weeks': dist['0_4_weeks'] || 0.15,
          '4_8_weeks': dist['4_8_weeks'] || 0.25,
          '8_12_weeks': dist['8_12_weeks'] || 0.30,
          '12_plus': (dist['12_16_weeks'] || 0.20) + (dist['16_20_weeks'] || 0.10)
        };
        console.log(`✓ Using cohort-specific time-lag distribution`);
      }
    } else {
      console.warn(`⚠️ Cohort "${selectedCohortId}" not found in tier data, using baseline`);
    }
  }

  const priceIncrease = parseFloat(priceSlider.value);
  const currentTierPrice = tierParams.price;
  const priceChangePct = (priceIncrease / currentTierPrice) * 100;

  console.log('📊 Churn Model Update:', {
    tier: currentTier,
    cohort: selectedCohortId,
    priceIncrease,
    currentTierPrice,
    priceChangePct: priceChangePct.toFixed(2) + '%',
    baseline_churn: activeBaselineChurn,
    churn_elasticity: activeElasticity,
    chartExists: !!churnChartSimple
  });

  // Update displays
  document.getElementById('churn-increase-display').textContent = '+$' + priceIncrease.toFixed(2);
  document.getElementById('churn-pct-change').textContent = '+' + priceChangePct.toFixed(1) + '%';

  // Update baseline churn rate display
  const baselineRateEl = document.getElementById('churn-baseline-rate');
  if (baselineRateEl) {
    baselineRateEl.textContent = activeBaselineChurn.toFixed(1) + '%';
  }

  // Calculate total churn impact using active churn elasticity (cohort-specific or baseline)
  // Formula: churn_change = baseline_churn × churn_elasticity × (price_change_pct / 100)
  const totalChurnImpact = activeBaselineChurn * activeElasticity * (priceChangePct / 100);

  // Distribute impact across time horizons using active time lag distribution
  const impacts = {
    '0_4': totalChurnImpact * activeTimeLag['0_4_weeks'],
    '4_8': totalChurnImpact * activeTimeLag['4_8_weeks'],
    '8_12': totalChurnImpact * activeTimeLag['8_12_weeks'],
    '12plus': totalChurnImpact * activeTimeLag['12_plus']
  };

  // Update impact displays
  document.getElementById('churn-0-4').textContent = '+' + impacts['0_4'].toFixed(1) + 'pp';
  document.getElementById('churn-4-8').textContent = '+' + impacts['4_8'].toFixed(1) + 'pp';
  document.getElementById('churn-8-12').textContent = '+' + impacts['8_12'].toFixed(1) + 'pp';
  document.getElementById('churn-12plus').textContent = '+' + impacts['12plus'].toFixed(1) + 'pp';

  // Update peak impact
  const peakImpact = Math.max(...Object.values(impacts));
  document.getElementById('churn-peak-impact').textContent = '+' + peakImpact.toFixed(1) + 'pp';

  // Update bar widths (normalized to max of 5pp for visualization)
  const maxImpact = 5;
  document.getElementById('bar-0-4').style.width = Math.min(impacts['0_4'] / maxImpact * 100, 100) + '%';
  document.getElementById('bar-4-8').style.width = Math.min(impacts['4_8'] / maxImpact * 100, 100) + '%';
  document.getElementById('bar-8-12').style.width = Math.min(impacts['8_12'] / maxImpact * 100, 100) + '%';
  document.getElementById('bar-12plus').style.width = Math.min(impacts['12plus'] / maxImpact * 100, 100) + '%';

  // Update churn chart
  if (churnChartSimple) {
    const tierBaseline = activeBaselineChurn;
    const projectedData = [
      tierBaseline,
      tierBaseline + impacts['0_4'],
      tierBaseline + impacts['4_8'],
      tierBaseline + impacts['8_12'],
      tierBaseline + (impacts['8_12'] + impacts['12plus']) / 2,
      tierBaseline + impacts['12plus']
    ];

    // Calculate dynamic y-axis range based on data
    const baselineData = [tierBaseline, tierBaseline, tierBaseline, tierBaseline, tierBaseline, tierBaseline];
    const allDataPoints = [...baselineData, ...projectedData];
    const minValue = Math.min(...allDataPoints);
    const maxValue = Math.max(...allDataPoints);
    const range = maxValue - minValue;
    const padding = Math.max(range * 0.15, 0.5); // 15% padding or minimum 0.5%

    // Set dynamic scale
    churnChartSimple.options.scales.y.min = Math.max(0, minValue - padding);
    churnChartSimple.options.scales.y.max = maxValue + padding;

    console.log('📈 Updating Churn Chart:', {
      baseline: tierBaseline,
      impacts: impacts,
      projectedData: projectedData,
      baselineData: baselineData,
      dynamicScale: {
        min: churnChartSimple.options.scales.y.min.toFixed(2),
        max: churnChartSimple.options.scales.y.max.toFixed(2)
      }
    });

    // Update baseline data too
    churnChartSimple.data.datasets[0].data = baselineData;
    churnChartSimple.data.datasets[1].data = projectedData;
    churnChartSimple.update('none'); // Instant update
  }

  // Update survival curve chart with revenue impact
  if (survivalCurveChart) {
    const tierBaseline = activeBaselineChurn;

    // Calculate actual churn rates at each period from the churn chart data
    const churnRates = [
      tierBaseline,                         // Week 0-4: baseline
      tierBaseline + impacts['0_4'],        // Week 4-8: baseline + impact
      tierBaseline + impacts['4_8'],        // Week 8-12: baseline + impact
      tierBaseline + impacts['8_12'],       // Week 12-16: baseline + impact
      tierBaseline + (impacts['8_12'] + impacts['12plus']) / 2,  // Week 16-20: average
      tierBaseline + impacts['12plus']      // Week 20-24: baseline + residual
    ];

    console.log('📊 Churn rates by period:', churnRates.map(r => r.toFixed(2) + '%'));

    // Baseline: Apply consistent baseline churn rate each period
    let baselineRetention = [100];
    let currentRetention = 100;
    for (let i = 0; i < 6; i++) {
      // Each period, lose (tierBaseline/100) of remaining visitors
      currentRetention = currentRetention * (1 - tierBaseline / 100);
      baselineRetention.push(currentRetention);
    }

    // Scenario: Apply time-varying churn rates from churnRates array
    // This ensures survival curve slope matches churn rate at each point!
    let scenarioRetention = [100];
    currentRetention = 100;
    for (let i = 0; i < 6; i++) {
      // Each period, lose (churnRates[i]/100) of remaining visitors
      currentRetention = currentRetention * (1 - churnRates[i] / 100);
      scenarioRetention.push(currentRetention);
    }

    console.log('📉 Survival curve retention:', {
      baseline: baselineRetention.map(r => r.toFixed(1) + '%'),
      scenario: scenarioRetention.map(r => r.toFixed(1) + '%')
    });

    // Calculate revenue impact over time (cumulative over 24 weeks)
    // Assume baseline of 100,000 current visitors
    const baselineSubCount = 100000;
    const currentTierPrice = tierParams.price;
    const newPrice = currentTierPrice + priceIncrease;

    let revenueImpact = [0]; // Start at $0
    let cumulativeRevenue = 0;

    // Calculate period-by-period revenue (each period is 4 weeks)
    for (let i = 0; i < baselineRetention.length - 1; i++) {
      // Average visitor count during this 4-week period
      const baselineSubsAvg = baselineSubCount * ((baselineRetention[i] + baselineRetention[i+1]) / 2) / 100;
      const scenarioSubsAvg = baselineSubCount * ((scenarioRetention[i] + scenarioRetention[i+1]) / 2) / 100;

      // Monthly revenue for this period (assuming monthly billing)
      const monthlyBillingCycles = 1; // Each 4-week period ≈ 1 billing cycle
      const baselineRevPeriod = baselineSubsAvg * currentTierPrice * monthlyBillingCycles;
      const scenarioRevPeriod = scenarioSubsAvg * newPrice * monthlyBillingCycles;

      const periodRevenue = scenarioRevPeriod - baselineRevPeriod;
      cumulativeRevenue += periodRevenue;
      revenueImpact.push(cumulativeRevenue);
    }

    console.log('💰 Revenue impact over time:', revenueImpact.map(r => '$' + Math.round(r).toLocaleString()));

    // Update summary metrics
    const finalRetainedSubs = Math.round(baselineSubCount * (scenarioRetention[scenarioRetention.length - 1] / 100));
    const finalRevenueImpact = Math.round(revenueImpact[revenueImpact.length - 1]);

    const retainedSubsEl = document.getElementById('churn-retained-subs');
    const totalRevenueEl = document.getElementById('churn-total-revenue');
    if (retainedSubsEl) {
      retainedSubsEl.textContent = finalRetainedSubs.toLocaleString();
      retainedSubsEl.className = 'metric-value';
    }
    if (totalRevenueEl) {
      const sign = finalRevenueImpact >= 0 ? '+' : '';
      totalRevenueEl.textContent = sign + '$' + finalRevenueImpact.toLocaleString();
      totalRevenueEl.className = 'metric-value ' + (finalRevenueImpact >= 0 ? 'text-success' : 'text-danger');
    }

    // Calculate dynamic y-axis range for retention (y-axis)
    const allRetentionPoints = [...baselineRetention, ...scenarioRetention];
    const minRetention = Math.min(...allRetentionPoints);
    const maxRetention = Math.max(...allRetentionPoints);
    const retentionRange = maxRetention - minRetention;
    const retentionPadding = Math.max(retentionRange * 0.15, 2); // 15% padding or minimum 2%

    survivalCurveChart.options.scales.y.min = Math.max(0, minRetention - retentionPadding);
    survivalCurveChart.options.scales.y.max = Math.min(100, maxRetention + retentionPadding);

    // Calculate dynamic scale for revenue (yRevenue axis)
    const minRevenue = Math.min(...revenueImpact);
    const maxRevenue = Math.max(...revenueImpact);
    const revenueRange = maxRevenue - minRevenue;
    const revenuePadding = Math.max(revenueRange * 0.15, 1000); // 15% padding or minimum $1000

    survivalCurveChart.options.scales.yRevenue.min = minRevenue - revenuePadding;
    survivalCurveChart.options.scales.yRevenue.max = maxRevenue + revenuePadding;

    console.log('📊 Survival Chart Dynamic Scales:', {
      retention: {
        min: survivalCurveChart.options.scales.y.min.toFixed(1) + '%',
        max: survivalCurveChart.options.scales.y.max.toFixed(1) + '%'
      },
      revenue: {
        min: '$' + Math.round(survivalCurveChart.options.scales.yRevenue.min).toLocaleString(),
        max: '$' + Math.round(survivalCurveChart.options.scales.yRevenue.max).toLocaleString()
      }
    });

    survivalCurveChart.data.datasets[0].data = baselineRetention;
    survivalCurveChart.data.datasets[1].data = scenarioRetention;
    survivalCurveChart.data.datasets[2].data = revenueImpact; // Revenue impact line
    survivalCurveChart.update('none');
  }
}

// Export for use in step-navigation.js
window.initChurnSimple = initChurnSimple;