/**
 * Simplified Acquisition Elasticity Model
 * Interactive slider-based interface for immediate feedback
 */

import { loadElasticityParams, loadWeeklyAggregated } from './data-loader.js';

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
 * Load acquisition parameters from actual data sources
 */
async function loadAcquisitionParams() {
  try {
    const [elasticityData, weeklyData] = await Promise.all([
      loadElasticityParams(),
      loadWeeklyAggregated()
    ]);

    // Calculate average monthly new subscribers by tier (from last 12 weeks)
    // Convert weekly average to monthly (4.33 weeks per month)
    const recentWeeks = weeklyData.slice(-12);
    const avgNewSubs = {};

    ['ad_supported', 'ad_free'].forEach(tier => {
      const tierWeeks = recentWeeks.filter(w => w.tier === tier);
      const avgWeekly = tierWeeks.reduce((sum, w) => sum + parseFloat(w.new_subscribers || 0), 0) / tierWeeks.length;
      avgNewSubs[tier] = Math.round(avgWeekly * 4.33); // Convert to monthly
    });

    // Build params object from actual data
    acquisitionParams = {};
    ['ad_supported', 'ad_free'].forEach(tier => {
      const tierData = elasticityData.tiers[tier];
      const totalNew = avgNewSubs[tier];

      acquisitionParams[tier] = {
        base_elasticity: tierData.base_elasticity,
        price: tierData.price_range.current,
        segments: {
          new_0_3mo: {
            elasticity: tierData.segments.new_0_3mo.elasticity,
            size_pct: tierData.segments.new_0_3mo.size_pct,
            baseline_adds: Math.round(totalNew * tierData.segments.new_0_3mo.size_pct)
          },
          tenured_3_12mo: {
            elasticity: tierData.segments.tenured_3_12mo.elasticity,
            size_pct: tierData.segments.tenured_3_12mo.size_pct,
            baseline_adds: Math.round(totalNew * tierData.segments.tenured_3_12mo.size_pct)
          },
          tenured_12plus: {
            elasticity: tierData.segments.tenured_12plus.elasticity,
            size_pct: tierData.segments.tenured_12plus.size_pct,
            baseline_adds: Math.round(totalNew * tierData.segments.tenured_12plus.size_pct)
          }
        }
      };
    });

    console.log('Acquisition parameters loaded from actual data:', acquisitionParams);
    return acquisitionParams;
  } catch (error) {
    console.error('Error loading acquisition parameters:', error);
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

    // Apply initial cohort elasticity (before first chart update)
    const cohortSelect = document.getElementById('acq-cohort-select');
    const tierSelect = document.getElementById('acq-tier-select');
    if (cohortSelect && cohortData && tierSelect) {
      const selectedCohort = cohortSelect.value;
      if (cohortData[selectedCohort]) {
        const cohort = cohortData[selectedCohort];
        const tier = tierSelect.value;
        if (acquisitionParams[tier]) {
          acquisitionParams[tier].base_elasticity = cohort.acquisition_elasticity;
          acquisitionParams[tier].segments.new_0_3mo.elasticity = cohort.acquisition_elasticity;
          acquisitionParams[tier].segments.tenured_3_12mo.elasticity = cohort.acquisition_elasticity;
          acquisitionParams[tier].segments.tenured_12plus.elasticity = cohort.acquisition_elasticity;
          console.log(`✓ Applied initial cohort "${selectedCohort}" elasticity: ${cohort.acquisition_elasticity.toFixed(2)}`);
        }
      }
    }

    // Create chart
    createAcquisitionChartSimple();

    // Setup interactivity
    setupAcquisitionInteractivity();

    // Initial update
    updateAcquisitionModel();
  } catch (error) {
    console.error('Failed to initialize acquisition model:', error);
    // Show error to user
    const container = document.getElementById('step-3-acquisition-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle me-2"></i>
          Failed to load acquisition model data. Please refresh the page.
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

  // Use loaded baseline data or fallback to placeholder values
  const initialData = acquisitionParams && acquisitionParams.ad_supported
    ? [
        acquisitionParams.ad_supported.segments.new_0_3mo.baseline_adds,
        acquisitionParams.ad_supported.segments.tenured_3_12mo.baseline_adds,
        acquisitionParams.ad_supported.segments.tenured_12plus.baseline_adds
      ]
    : [1000, 1400, 1600];

  acquisitionChartSimple = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['0–3 months', '3–12 months', '12+ months'],
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
          data: [0, 0, 0],
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

    // Update slider range based on tier
    if (tier === 'ad_free') {
      priceSlider.min = 6.99;
      priceSlider.max = 12.99;
      priceSlider.value = params.price;
      priceSlider.step = 0.5;
    } else {
      priceSlider.min = 3.99;
      priceSlider.max = 9.99;
      priceSlider.value = params.price;
      priceSlider.step = 0.5;
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

  // Cohort selection change
  if (cohortSelect && cohortData) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Switching to acquisition cohort:', selectedCohort);

      if (cohortData[selectedCohort]) {
        const cohort = cohortData[selectedCohort];
        const tier = tierSelect.value;

        // Update elasticity from cohort profile
        if (acquisitionParams[tier]) {
          acquisitionParams[tier].base_elasticity = cohort.acquisition_elasticity;
          // CRITICAL FIX: Also update segment-level elasticities
          acquisitionParams[tier].segments.new_0_3mo.elasticity = cohort.acquisition_elasticity;
          acquisitionParams[tier].segments.tenured_3_12mo.elasticity = cohort.acquisition_elasticity;
          acquisitionParams[tier].segments.tenured_12plus.elasticity = cohort.acquisition_elasticity;
          console.log(`  ✓ Acquisition elasticity: ${cohort.acquisition_elasticity.toFixed(2)}`);
        }
      }

      updateAcquisitionModel();
    });
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

  // Update segment table
  const segments = params.segments;
  const segNewImpact = segments.new_0_3mo.elasticity * (priceChangePct / 100) * 100;
  const segMidImpact = segments.tenured_3_12mo.elasticity * (priceChangePct / 100) * 100;
  const segLoyalImpact = segments.tenured_12plus.elasticity * (priceChangePct / 100) * 100;

  updateSegmentCell('acq-seg-new', segNewImpact);
  updateSegmentCell('acq-seg-mid', segMidImpact);
  updateSegmentCell('acq-seg-loyal', segLoyalImpact);

  // Update chart
  if (acquisitionChartSimple) {
    const baselineData = [
      segments.new_0_3mo.baseline_adds,
      segments.tenured_3_12mo.baseline_adds,
      segments.tenured_12plus.baseline_adds
    ];
    const projectedData = [
      Math.round(segments.new_0_3mo.baseline_adds * (1 + segNewImpact / 100)),
      Math.round(segments.tenured_3_12mo.baseline_adds * (1 + segMidImpact / 100)),
      Math.round(segments.tenured_12plus.baseline_adds * (1 + segLoyalImpact / 100))
    ];

    // Calculate confidence intervals (95% CI with ±15% standard error)
    const errorBars = projectedData.map(value => ({
      lower: value * (1 - Z_SCORE * STD_ERROR),
      upper: value * (1 + Z_SCORE * STD_ERROR)
    }));

    // Calculate revenue impact per segment based on lifetime value
    // Each segment has different expected tenure (average months subscribed)
    const tenureMonths = [1.5, 7.5, 18]; // Average months for 0-3mo, 3-12mo, 12+mo segments
    const baselineRevenue = baselineData.map((subs, i) => subs * currentPrice * tenureMonths[i]);
    const projectedRevenue = projectedData.map((subs, i) => subs * newPrice * tenureMonths[i]);
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

// Export for use in step-navigation.js
window.initAcquisitionSimple = initAcquisitionSimple;