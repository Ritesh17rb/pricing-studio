/**
 * Simplified Acquisition Elasticity Model
 * Interactive slider-based interface for immediate feedback
 */

import { loadElasticityParams, loadDailyAggregated } from './data-loader.js';
import { getAcquisitionCohorts } from './cohort-aggregator.js';

// Chart instance
let acquisitionChartSimple = null;

// Elasticity parameters (loaded from elasticity-params.json and weekly_aggregated.csv)
let acquisitionParams = null;

// Cohort data for dynamic elasticity
let cohortData = null;

// Configuration
const CONFIDENCE_INTERVAL = 0.95; // 95% CI
const STD_ERROR = 0.15; // 15% standard error (industry benchmark)
const Z_SCORE = 1.96; // For 95% CI
let showConfidenceIntervals = true;

/**
 * Load cohort data for dynamic elasticity
 */
async function loadCohortData() {
  try {
    const response = await fetch('data/cohort_coefficients.json');
    cohortData = await response.json();
    console.log('✓ Loaded cohort profiles for acquisition');
    return cohortData;
  } catch (error) {
    console.error('Error loading cohort data:', error);
    return null;
  }
}

/**
 * Load acquisition parameters from actual Legoland visitor data
 */
async function loadAcquisitionParams() {
  try {
    console.log('Step 1: Loading elasticity params and daily data...');
    const [elasticityData, weeklyData] = await Promise.all([
      loadElasticityParams(),
      loadDailyAggregated()
    ]);
    console.log('✓ Step 1 complete:', { elasticityData, weeklyDataLength: weeklyData.length });

    // Build params object from actual visitor cohorts
    acquisitionParams = {};

    for (const tier of ['standard_pass', 'premium_pass', 'vip_pass']) {
      console.log(`Step 2: Processing tier ${tier}...`);
      const tierData = elasticityData[tier];

      if (!tierData) {
        console.error(`No tier data found for ${tier} in elasticityData`);
        continue;
      }

      // Get actual acquisition cohorts from visitor data
      console.log(`Step 3: Getting acquisition cohorts for ${tier}...`);
      const cohorts = await getAcquisitionCohorts(tier);
      console.log(`✓ Step 3 complete: Got ${cohorts ? cohorts.length : 0} cohorts`);

      if (!cohorts || cohorts.length === 0) {
        console.warn(`No acquisition cohorts found for ${tier}`);
        continue;
      }

      // Calculate total visitors across all cohorts
      const totalVisitors = cohorts.reduce((sum, c) => sum + c.size, 0);
      console.log(`Total visitors for ${tier}: ${totalVisitors}`);

      // Calculate weighted average elasticity
      const weightedElasticity = cohorts.reduce((sum, c) => {
        return sum + (c.elasticity * c.size / totalVisitors);
      }, 0);

      // Convert cohorts to segment structure for the model
      const segments = {};
      cohorts.forEach(cohort => {
        segments[cohort.id] = {
          name: cohort.name,
          elasticity: cohort.elasticity,
          size_pct: cohort.size / totalVisitors,
          baseline_adds: cohort.size
        };
      });

      acquisitionParams[tier] = {
        base_elasticity: weightedElasticity,
        price: tierData.price_range.current,
        segments: segments,
        cohorts: cohorts // Store full cohort data
      };

      console.log(`✓ Loaded ${cohorts.length} acquisition cohorts for ${tier}:`, cohorts);
    }

    console.log('✓ Acquisition parameters loaded from actual visitor data:', acquisitionParams);
    return acquisitionParams;
  } catch (error) {
    console.error('❌ Error loading acquisition parameters:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

/**
 * Initialize the simplified acquisition section
 */
async function initAcquisitionSimple() {
  console.log('Initializing simplified acquisition model...');

  try {
    // Load parameters from actual data
    await loadAcquisitionParams();
    await loadCohortData();

    // Note: We're now using real visitor data with actual elasticity values,
    // so we don't need to apply cohort overrides from cohort_coefficients.json
    // The elasticity values are already loaded from segment_elasticity.json
    console.log('✓ Using real elasticity values from visitor data');

    // Create chart
    createAcquisitionChartSimple();

    // Setup interactivity
    setupAcquisitionInteractivity();

    // Initial update
    updateAcquisitionModel();
  } catch (error) {
    console.error('Failed to initialize acquisition model:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name
    });

    // Show detailed error to user
    const container = document.getElementById('step-3-acquisition-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle me-2"></i>
          <strong>Failed to load acquisition model data</strong><br>
          <small>Error: ${error.message}</small><br>
          <small class="text-muted">Check browser console for details (F12)</small>
        </div>
      `;
    }
  }
}

/**
 * Create the acquisition chart with error bars plugin
 */
function createAcquisitionChartSimple() {
  const ctx = document.getElementById('acquisition-chart-simple');
  if (!ctx) {
    console.warn('Acquisition chart canvas not found');
    return;
  }

  // Destroy existing chart
  if (acquisitionChartSimple) {
    acquisitionChartSimple.destroy();
  }

  // Custom plugin for error bars
  const errorBarsPlugin = {
    id: 'errorBars',
    afterDatasetsDraw(chart) {
      const { ctx, data, scales } = chart;
      const meta = chart.getDatasetMeta(1); // Projected dataset (index 1)

      if (!showConfidenceIntervals || !meta.data || !data.datasets[1].errorBars) return;

      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      meta.data.forEach((bar, index) => {
        const errorBar = data.datasets[1].errorBars[index];
        if (!errorBar) return;

        const x = bar.x;
        const yUpper = scales.y.getPixelForValue(errorBar.upper);
        const yLower = scales.y.getPixelForValue(errorBar.lower);
        const capWidth = 8;

        // Draw vertical line
        ctx.beginPath();
        ctx.moveTo(x, yUpper);
        ctx.lineTo(x, yLower);
        ctx.stroke();

        // Draw upper cap
        ctx.beginPath();
        ctx.moveTo(x - capWidth, yUpper);
        ctx.lineTo(x + capWidth, yUpper);
        ctx.stroke();

        // Draw lower cap
        ctx.beginPath();
        ctx.moveTo(x - capWidth, yLower);
        ctx.lineTo(x + capWidth, yLower);
        ctx.stroke();
      });

      ctx.restore();
    }
  };

  // Use loaded baseline data from actual cohorts or fallback to placeholder values
  let initialData = [1000, 1400, 1600, 2000, 3000]; // Default placeholder
  let initialLabels = ['Cohort 1', 'Cohort 2', 'Cohort 3', 'Cohort 4', 'Cohort 5'];

  if (acquisitionParams && acquisitionParams.standard_pass && acquisitionParams.standard_pass.cohorts) {
    const cohorts = acquisitionParams.standard_pass.cohorts;
    initialData = cohorts.map(c => c.size);
    initialLabels = cohorts.map(c => c.name);
  }

  acquisitionChartSimple = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: initialLabels,
      datasets: [
        {
          label: 'Baseline',
          data: initialData,
          backgroundColor: 'rgba(99, 102, 241, 0.5)',
          borderColor: 'rgba(99, 102, 241, 1)',
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Projected',
          data: initialData,
          backgroundColor: 'rgba(16, 185, 129, 0.5)',
          borderColor: 'rgba(16, 185, 129, 1)',
          borderWidth: 2,
          errorBars: [],
          yAxisID: 'y'
        },
        {
          label: 'Revenue Impact',
          data: Array(initialData.length).fill(0),
          backgroundColor: 'rgba(251, 191, 36, 0.5)',
          borderColor: 'rgba(251, 191, 36, 1)',
          borderWidth: 2,
          yAxisID: 'yRevenue'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.datasetIndex === 2) {
                // Revenue Impact dataset (LTV)
                const value = context.parsed.y;
                const sign = value >= 0 ? '+' : '';
                return context.dataset.label + ': ' + sign + '$' + value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) + ' LTV';
              } else {
                // Subscriber datasets
                let label = context.dataset.label + ': ' + context.parsed.y.toLocaleString() + ' new subs';
                if (context.datasetIndex === 1 && context.dataset.errorBars && context.dataset.errorBars[context.dataIndex]) {
                  const eb = context.dataset.errorBars[context.dataIndex];
                  label += '\n95% CI: ' + Math.round(eb.lower).toLocaleString() + ' - ' + Math.round(eb.upper).toLocaleString();
                }
                return label;
              }
            }
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          grid: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark'
              ? 'rgba(255,255,255,0.1)'
              : 'rgba(0,0,0,0.1)'
          },
          ticks: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          },
          title: {
            display: true,
            text: 'New Subscribers (Monthly)',
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        yRevenue: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529',
            callback: function(value) {
              const sign = value >= 0 ? '+' : '';
              return sign + '$' + value.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0});
            }
          },
          title: {
            display: true,
            text: 'Revenue Impact ($ LTV)',
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          },
          title: {
            display: true,
            text: 'Customer Tenure Segment (Months Since Signup)',
            color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#e5e5e5' : '#212529'
          }
        }
      }
    },
    plugins: [errorBarsPlugin]
  });
}

/**
 * Setup slider interactivity
 */
function setupAcquisitionInteractivity() {
  const tierSelect = document.getElementById('acq-tier-select');
  const priceSlider = document.getElementById('acq-price-slider');
  const ciToggle = document.getElementById('acq-show-ci');
  const cohortSelect = document.getElementById('acq-cohort-select');

  if (!tierSelect || !priceSlider) {
    console.warn('Acquisition controls not found');
    return;
  }

  // Tier selection change
  tierSelect.addEventListener('change', () => {
    const tier = tierSelect.value;
    const params = acquisitionParams[tier];

    if (params) {
      // Update price slider range dynamically based on tier's current price
      priceSlider.min = Math.round(params.price * 0.6);  // 40% discount
      priceSlider.max = Math.round(params.price * 1.6);  // 60% increase
      priceSlider.value = params.price;
      priceSlider.step = 5;

      // Update slider labels
      const sliderLabels = priceSlider.parentElement.querySelectorAll('.small.text-muted span');
      if (sliderLabels.length === 2) {
        sliderLabels[0].textContent = '$' + priceSlider.min;
        sliderLabels[1].textContent = '$' + priceSlider.max;
      }

      // Update tier selector labels with actual prices
      updateTierLabels();
    }

    updateAcquisitionModel();
  });

  // Price slider input
  priceSlider.addEventListener('input', updateAcquisitionModel);

  // Confidence interval toggle
  if (ciToggle) {
    ciToggle.addEventListener('change', () => {
      showConfidenceIntervals = ciToggle.checked;
      updateAcquisitionModel();
    });
  }

  // Cohort selection change (optional feature - applies cohort multipliers)
  if (cohortSelect && cohortData) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Switching to acquisition cohort:', selectedCohort);

      if (cohortData[selectedCohort]) {
        const cohort = cohortData[selectedCohort];
        const tier = tierSelect.value;

        // Update base elasticity from cohort profile
        if (acquisitionParams[tier]) {
          acquisitionParams[tier].base_elasticity = cohort.acquisition_elasticity;
          // Update all segment elasticities proportionally
          if (acquisitionParams[tier].cohorts) {
            acquisitionParams[tier].cohorts.forEach(c => {
              c.elasticity = cohort.acquisition_elasticity;
            });
          }
          console.log(`  ✓ Applied cohort "${selectedCohort}" elasticity: ${cohort.acquisition_elasticity.toFixed(2)}`);
        }
      }

      updateAcquisitionModel();
    });
  }

  // Initialize tier labels and price slider on first load
  updateTierLabels();
  const initialTier = tierSelect.value;
  if (acquisitionParams[initialTier]) {
    const params = acquisitionParams[initialTier];
    priceSlider.min = Math.round(params.price * 0.6);
    priceSlider.max = Math.round(params.price * 1.6);
    priceSlider.value = params.price;

    // Update slider labels
    const sliderLabels = priceSlider.parentElement.querySelectorAll('.small.text-muted span');
    if (sliderLabels.length === 2) {
      sliderLabels[0].textContent = '$' + priceSlider.min;
      sliderLabels[1].textContent = '$' + priceSlider.max;
    }
  }
}

/**
 * Update the acquisition model based on current inputs
 */
function updateAcquisitionModel() {
  const tierSelect = document.getElementById('acq-tier-select');
  const priceSlider = document.getElementById('acq-price-slider');
  const priceDisplay = document.getElementById('acq-price-display');

  if (!tierSelect || !priceSlider || !acquisitionParams) {
    console.warn('⚠️ updateAcquisitionModel early return:', {
      tierSelect: !!tierSelect,
      priceSlider: !!priceSlider,
      acquisitionParams: !!acquisitionParams
    });
    return;
  }

  const tier = tierSelect.value;
  const params = acquisitionParams[tier];
  if (!params) {
    console.warn('⚠️ updateAcquisitionModel no params for tier:', tier);
    return;
  }
  const currentPrice = params.price;
  const newPrice = parseFloat(priceSlider.value);
  const priceChangePct = ((newPrice - currentPrice) / currentPrice) * 100;
  const elasticity = params.base_elasticity;

  console.log('📊 Acquisition Model Update:', {
    tier,
    currentPrice,
    newPrice,
    priceChangePct: priceChangePct.toFixed(2) + '%',
    elasticity,
    chartExists: !!acquisitionChartSimple
  });

  // Update displays
  priceDisplay.textContent = '$' + newPrice.toFixed(2);
  document.getElementById('acq-price-change').textContent =
    (priceChangePct >= 0 ? '+' : '') + priceChangePct.toFixed(1) + '%';
  document.getElementById('acq-elasticity').textContent = elasticity.toFixed(1);

  // Calculate acquisition impact
  const acqImpact = elasticity * (priceChangePct / 100) * 100;
  const acqImpactEl = document.getElementById('acq-impact');
  acqImpactEl.textContent = (acqImpact >= 0 ? '+' : '') + acqImpact.toFixed(1) + '%';
  acqImpactEl.className = 'metric-value ' + (acqImpact >= 0 ? 'text-success' : 'text-danger');

  // Update dynamic elasticity explanation
  updateElasticityExplanation(elasticity);

  // Update segment table with actual cohorts
  if (params.cohorts) {
    updateSegmentTable(params.cohorts, priceChangePct);
  }

  // Update chart with actual cohorts
  if (acquisitionChartSimple && params.cohorts) {
    const cohorts = params.cohorts;
    const segments = params.segments;

    // Build arrays dynamically from cohorts
    const labels = cohorts.map(c => c.name);
    const baselineData = cohorts.map(c => c.size);

    // Calculate projected visitors for each cohort
    const projectedData = cohorts.map(c => {
      const segmentImpact = c.elasticity * (priceChangePct / 100) * 100;
      return Math.round(c.size * (1 + segmentImpact / 100));
    });

    // Calculate confidence intervals (95% CI with ±15% standard error)
    const errorBars = projectedData.map(value => ({
      lower: value * (1 - Z_SCORE * STD_ERROR),
      upper: value * (1 + Z_SCORE * STD_ERROR)
    }));

    // Calculate revenue impact per cohort
    // Estimate visit value based on cohort type
    const visitMultiplier = {
      'one_time': 1.0,
      'occasional': 2.5,
      'regular': 6.0,
      'frequent': 12.0,
      'season_pass': 20.0
    };

    const baselineRevenue = cohorts.map((c, i) =>
      baselineData[i] * currentPrice * (visitMultiplier[c.id] || 1.0)
    );
    const projectedRevenue = cohorts.map((c, i) =>
      projectedData[i] * newPrice * (visitMultiplier[c.id] || 1.0)
    );
    const revenueImpact = projectedRevenue.map((rev, i) => Math.round(rev - baselineRevenue[i]));

    // Calculate totals for summary metrics
    const totalBaselineSubs = baselineData.reduce((sum, val) => sum + val, 0);
    const totalProjectedSubs = projectedData.reduce((sum, val) => sum + val, 0);
    const totalRevenueImpact = revenueImpact.reduce((sum, val) => sum + val, 0);

    console.log('📈 Updating Acquisition Chart:', {
      baselineData: baselineData,
      projectedData: projectedData,
      difference: projectedData.map((val, i) => val - baselineData[i]),
      baselineRevenue: baselineRevenue,
      projectedRevenue: projectedRevenue,
      revenueImpact: revenueImpact,
      totalProjectedSubs: totalProjectedSubs,
      totalRevenueImpact: totalRevenueImpact
    });

    // Update summary metrics
    const totalSubsEl = document.getElementById('acq-total-subs');
    const totalRevenueEl = document.getElementById('acq-total-revenue');
    if (totalSubsEl) {
      totalSubsEl.textContent = totalProjectedSubs.toLocaleString() + ' /mo';
      totalSubsEl.className = 'metric-value';
    }
    if (totalRevenueEl) {
      const sign = totalRevenueImpact >= 0 ? '+' : '';
      totalRevenueEl.textContent = sign + '$' + totalRevenueImpact.toLocaleString();
      totalRevenueEl.className = 'metric-value ' + (totalRevenueImpact >= 0 ? 'text-success' : 'text-danger');
    }

    // Update labels with actual cohort names
    acquisitionChartSimple.data.labels = labels;

    acquisitionChartSimple.data.datasets[0].data = baselineData;
    acquisitionChartSimple.data.datasets[1].data = projectedData;
    acquisitionChartSimple.data.datasets[1].errorBars = errorBars;
    acquisitionChartSimple.data.datasets[2].data = revenueImpact;

    // Dynamically color revenue bars: red for negative, yellow for positive
    acquisitionChartSimple.data.datasets[2].backgroundColor = revenueImpact.map(value =>
      value < 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(251, 191, 36, 0.5)'
    );
    acquisitionChartSimple.data.datasets[2].borderColor = revenueImpact.map(value =>
      value < 0 ? 'rgba(239, 68, 68, 1)' : 'rgba(251, 191, 36, 1)'
    );

    acquisitionChartSimple.update('none'); // Use 'none' for instant update without animation
  }
}

/**
 * Update a segment cell with color coding
 */
function updateSegmentCell(id, impact) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = (impact >= 0 ? '+' : '') + impact.toFixed(1) + '%';
    el.style.color = impact >= 0 ? 'var(--primary-green)' : 'var(--primary-red)';
  }
}

/**
 * Update tier selector labels with actual prices
 */
function updateTierLabels() {
  const tierSelect = document.getElementById('acq-tier-select');
  if (!tierSelect || !acquisitionParams) return;

  const tierNames = {
    'standard_pass': 'Standard Pass',
    'premium_pass': 'Premium Pass',
    'vip_pass': 'VIP Pass'
  };

  // Update each option's text with actual price
  Array.from(tierSelect.options).forEach(option => {
    const tier = option.value;
    if (acquisitionParams[tier]) {
      const price = acquisitionParams[tier].price;
      option.textContent = `${tierNames[tier]} ($${price})`;
    }
  });
}

/**
 * Update elasticity explanation with actual calculated value
 */
function updateElasticityExplanation(elasticity) {
  const explanationEl = document.getElementById('elasticity-explanation');
  if (explanationEl) {
    const absElasticity = Math.abs(elasticity);
    const direction = elasticity < 0 ? 'decrease' : 'increase';
    explanationEl.innerHTML = `An elasticity of <strong>${elasticity.toFixed(2)}</strong> means a 1% price increase leads to a ${absElasticity.toFixed(1)}% ${direction} in new visitor acquisitions. ${elasticity < 0 ? 'Negative values indicate inverse relationship.' : 'Positive values indicate direct relationship.'}`;
  }
}

/**
 * Update segment elasticity table with actual cohort data
 */
function updateSegmentTable(cohorts, priceChangePct) {
  const tableBody = document.querySelector('#acquisition-pane .table tbody');
  if (!tableBody || !cohorts) return;

  // Clear existing rows
  tableBody.innerHTML = '';

  // Add row for each cohort
  cohorts.forEach(cohort => {
    const impact = cohort.elasticity * (priceChangePct / 100) * 100;
    const absElasticity = Math.abs(cohort.elasticity);

    // Determine sensitivity level
    let sensitivity, badgeClass;
    if (absElasticity > 2.0) {
      sensitivity = 'Very High';
      badgeClass = 'bg-danger';
    } else if (absElasticity > 1.5) {
      sensitivity = 'High';
      badgeClass = 'bg-warning';
    } else if (absElasticity > 1.0) {
      sensitivity = 'Medium';
      badgeClass = 'bg-info';
    } else {
      sensitivity = 'Low';
      badgeClass = 'bg-success';
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${cohort.name}</strong></td>
      <td>${cohort.elasticity.toFixed(2)}</td>
      <td><span class="badge ${badgeClass}">${sensitivity}</span></td>
      <td><strong class="${impact >= 0 ? 'text-success' : 'text-danger'}">${impact >= 0 ? '+' : ''}${impact.toFixed(1)}%</strong></td>
    `;
    tableBody.appendChild(row);
  });
}

// Export for use in step-navigation.js
window.initAcquisitionSimple = initAcquisitionSimple;