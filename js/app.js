/**
 * Main Application Module
 * Orchestrates the Legoland Pricing & Revenue Optimization Studio
 *
 * Dependencies: data-loader.js, scenario-engine.js, charts.js
 */

import { loadAllData, loadScenarios, getDailyData, getWeeklyData, loadElasticityParams } from './data-loader.js';
import {
  simulateScenario,
  simulateScenarioWithPyodide,
  initializePyodideModels,
  isPyodideAvailable,
  compareScenarios as compareScenariosEngine
} from './scenario-engine.js';
import { renderDemandCurve, renderElasticityHeatmap, renderTierMixShift, renderTradeoffsScatter, renderComparisonBarChart, renderRadarChart } from './charts.js';
import { initializeChat, configureLLM, sendMessage, clearHistory } from './chat.js';
import { initializeDataViewer } from './data-viewer.js';
import { renderSegmentKPICards, renderSegmentElasticityHeatmap, render3AxisRadialChart, renderSegmentScatterPlot, exportSVG } from './segment-charts.js';
import { getAcquisitionCohorts, getChurnCohorts } from './cohort-aggregator.js';
import { pyodideBridge } from './pyodide-bridge.js';
import { initializeEventCalendar } from './event-calendar.js';
import { rankScenarios, getObjectiveDescription } from './decision-engine.js';
import { exportToPDF, exportToXLSX } from './decision-pack.js';
import { showAlert } from './utils.js';

// Global state
let allScenarios = [];
let dataLoaded = false;

const modelTypes = ['acquisition', 'churn', 'migration']; // Internal IDs maintained for compatibility
let activeModelType = 'acquisition'; // acquisition = new_visits, churn = loyalty, migration = pass_migration

let selectedScenarioByModel = {
  acquisition: null,
  churn: null,
  migration: null
};

let currentResultByModel = {
  acquisition: null,
  churn: null,
  migration: null
};

let savedScenariosByModel = {
  acquisition: [],
  churn: [],
  migration: []
};

let allSimulationResultsByModel = {
  acquisition: [],
  churn: [],
  migration: []
};

let selectedScenario = selectedScenarioByModel[activeModelType];
let savedScenarios = savedScenariosByModel[activeModelType];
let currentResult = currentResultByModel[activeModelType];

// Format helpers
function formatNumber(num) {
  // Check for null, undefined, NaN, and Infinity
  if (num === null || num === undefined || !Number.isFinite(num)) {
    return 'N/A';
  }
  return num.toLocaleString();
}

function formatCurrency(num) {
  // Check for null, undefined, NaN, and Infinity
  if (num === null || num === undefined || !Number.isFinite(num)) {
    return 'N/A';
  }
  return `$${num.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function formatPercent(num, decimals = 1) {
  // Check for null, undefined, NaN, and Infinity
  if (num === null || num === undefined || !Number.isFinite(num)) {
    return 'N/A';
  }
  return `${(num * 100).toFixed(decimals)}%`;
}

function getModelTypeFromTabId(tabId) {
  if (tabId === 'acquisition-tab') return 'acquisition';
  if (tabId === 'churn-tab') return 'churn';
  if (tabId === 'migration-tab') return 'migration';
  return activeModelType;
}

function syncScenarioSelectionUI() {
  const activePane = document.querySelector('.tab-pane.active');
  if (!activePane) return;
  activePane.querySelectorAll('.scenario-card-tab').forEach(card => card.classList.remove('selected'));
  if (selectedScenario) {
    const card = activePane.querySelector(`.scenario-card-tab[data-scenario-id="${selectedScenario.id}"]`);
    if (card) card.classList.add('selected');
  }
}

function updateScenarioComparisonUI() {
  const count = savedScenarios.length;
  const countLabel = document.getElementById('saved-scenarios-count');
  const compareBtn = document.getElementById('compare-btn');
  const comparisonSection = document.getElementById('comparison-section');
  const comparisonCharts = document.getElementById('comparison-charts');

  if (countLabel) {
    countLabel.textContent = `${count} scenario${count !== 1 ? 's' : ''} saved`;
  }
  if (compareBtn) {
    compareBtn.disabled = count < 2;
  }
  if (comparisonSection) {
    comparisonSection.style.display = count > 0 ? 'block' : 'none';
  }
  if (comparisonCharts && count < 2) {
    comparisonCharts.style.display = 'none';
  }
}

function updateSimulateButtonState() {
  const simulateBtn = document.getElementById('simulate-btn-models');
  if (simulateBtn) {
    simulateBtn.disabled = !selectedScenario;
  }
}

function updateSaveButtonState() {
  const saveBtn = document.getElementById('save-scenario-btn-models');
  if (!saveBtn) return;

  const activeResult = currentResultByModel[activeModelType];

  // Disable if no result exists
  if (!activeResult) {
    saveBtn.disabled = true;
    saveBtn.title = 'Run a simulation first';
    return;
  }

  // Disable if selected scenario doesn't match simulated result
  if (selectedScenario && activeResult.scenario_id !== selectedScenario.id) {
    saveBtn.disabled = true;
    saveBtn.title = 'Click "Simulate" first to update results for the selected scenario';
    return;
  }

  // Enable if result matches selected scenario
  saveBtn.disabled = false;
  saveBtn.title = 'Save this scenario for comparison';
}

function updateResultContainerForModel() {
  const resultContainer = document.getElementById('result-container-models');
  if (!resultContainer) return;
  const resolvedModelType = resolveModelTypeForResult(currentResult);
  if (!currentResult || (resolvedModelType && resolvedModelType !== activeModelType)) {
    resultContainer.style.display = 'none';
    clearResultsUI();
    return;
  }
  displayResultsInTabs(currentResult);
  resultContainer.style.display = 'block';
}

function clearResultsUI() {
  const cards = document.getElementById('result-cards-models');
  if (cards) cards.innerHTML = '';
  const warning = document.getElementById('new-tier-warning');
  if (warning) {
    warning.style.display = 'none';
    warning.innerHTML = '';
  }
  const acquisitionDetail = document.getElementById('acquisition-results-detail');
  const churnDetail = document.getElementById('churn-results-detail');
  const migrationDetail = document.getElementById('migration-results-detail');
  if (acquisitionDetail) acquisitionDetail.style.display = 'none';
  if (churnDetail) churnDetail.style.display = 'none';
  if (migrationDetail) migrationDetail.style.display = 'none';
}

function hideScenarioResults() {
  const resultContainer = document.getElementById('result-container-models');
  if (resultContainer) {
    resultContainer.style.display = 'none';
  }
  clearResultsUI();
}

/**
 * Update Decision Engine ranking display for the current active model type
 */
function updateDecisionEngineDisplay() {
  const container = document.getElementById('top-scenarios-container');
  const list = document.getElementById('top-scenarios-list');

  if (!container || !list) return;

  // Check if rankings exist for the current model type
  const currentTop3 = window.currentTop3ScenariosByModel?.[activeModelType];

  if (currentTop3 && currentTop3.length > 0) {
    // Rankings exist for this model, display them
    displayTop3Scenarios(currentTop3);
  } else {
    // No rankings for this model, hide the container
    container.style.display = 'none';
    list.innerHTML = '';
  }
}

function setActiveModelType(modelType) {
  if (!modelTypes.includes(modelType)) return;
  activeModelType = modelType;
  selectedScenario = selectedScenarioByModel[modelType];
  savedScenarios = savedScenariosByModel[modelType];
  currentResult = currentResultByModel[modelType];
  allSimulationResults = allSimulationResultsByModel[modelType];

  // Debug logging
  console.log(`🔄 Switching to ${modelType} model`, {
    hasResult: !!currentResult,
    resultModelType: currentResult?.model_type,
    resultScenarioId: currentResult?.scenario_id,
    storedResults: Object.keys(currentResultByModel).reduce((acc, key) => {
      acc[key] = currentResultByModel[key] ? {
        model_type: currentResultByModel[key].model_type,
        scenario_id: currentResultByModel[key].scenario_id
      } : null;
      return acc;
    }, {})
  });

  const comparisonCharts = document.getElementById('comparison-charts');
  if (comparisonCharts) comparisonCharts.style.display = 'none';
  // Clear any previously displayed results from other models
  hideScenarioResults();
  // Re-render results for this model if they exist
  if (currentResult) {
    displayResultsInTabs(currentResult, true); // Pass true to indicate this is a re-display, not a new simulation
    const resultContainer = document.getElementById('result-container-models');
    if (resultContainer) resultContainer.style.display = 'block';
  }
  syncScenarioSelectionUI();
  updateScenarioComparisonUI();
  updateSimulateButtonState();
  updateSaveButtonState(); // Update save button state when switching models
  // Update Decision Engine display for this model
  updateDecisionEngineDisplay();
}

function resolveModelTypeForResult(result) {
  if (!result) return null;
  if (result.model_type) return result.model_type;
  if (result.scenario_config?.model_type) return result.scenario_config.model_type;
  if (result.scenario_id) {
    const match = allScenarios.find(s => s.id === result.scenario_id);
    if (match?.model_type) return match.model_type;
  }
  return null;
}

function startSimulateLoading() {
  const loadingEl = document.getElementById('simulate-loading');
  const labelEl = document.getElementById('simulate-loading-label');
  const barEl = document.getElementById('simulate-loading-bar');

  if (!loadingEl || !labelEl || !barEl) {
    return {
      done: Promise.resolve(),
      stop: () => {}
    };
  }

  const duration = 2600 + Math.random() * 1000;
  const start = performance.now();

  loadingEl.style.display = 'block';
  labelEl.textContent = 'Running scenario simulation...';
  barEl.style.width = '0%';
  barEl.textContent = '0%';
  barEl.setAttribute('aria-valuenow', '0');

  let resolveDone;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });

  const tick = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const percent = Math.round(progress * 100);
    barEl.style.width = `${percent}%`;
    barEl.textContent = `${percent}%`;
    barEl.setAttribute('aria-valuenow', String(percent));

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      labelEl.textContent = 'Finalizing...';
      resolveDone();
    }
  };

  requestAnimationFrame(tick);

  return {
    done,
    stop: () => {
      loadingEl.style.display = 'none';
    }
  };
}

// Load KPI data
async function loadKPIs() {
  try {
    const dailyData = await getDailyData('all');
    const latestDay = {};
    const previousWeekDay = {};

    // Get latest day and previous week (7 days ago) for each tier
    ['standard_pass', 'premium_pass', 'vip_pass'].forEach(tier => {
      const tierData = dailyData.filter(d => d.membership_tier === tier);
      latestDay[tier] = tierData[tierData.length - 1];
      // Get data from 7 days ago for week-over-week comparison
      previousWeekDay[tier] = tierData.length >= 8 ? tierData[tierData.length - 8] : null;
    });

    // Calculate current totals
    const totalVisitors = Object.values(latestDay).reduce((sum, d) => sum + (d.daily_visitors || 0), 0);
    const totalDailyRevenue = Object.values(latestDay).reduce((sum, d) => sum + (d.daily_revenue || 0), 0);
    const totalRevenue = totalDailyRevenue * 30; // Daily to monthly estimate
    const avgARPV = totalDailyRevenue / totalVisitors; // FIXED: Don't divide by 30 again
    const avgReturnRate = Object.values(latestDay).reduce((sum, d) => sum + (d.return_rate || 0), 0) / 3;

    // Calculate previous week totals for comparison
    const prevTotalVisitors = Object.values(previousWeekDay).reduce((sum, d) => sum + (d?.daily_visitors || 0), 0);
    const prevTotalDailyRevenue = Object.values(previousWeekDay).reduce((sum, d) => sum + (d?.daily_revenue || 0), 0);
    const prevTotalRevenue = prevTotalDailyRevenue * 30;
    const prevAvgARPV = prevTotalVisitors > 0 ? prevTotalDailyRevenue / prevTotalVisitors : 0;
    const prevAvgReturnRate = Object.values(previousWeekDay).reduce((sum, d) => sum + (d?.return_rate || 0), 0) / 3;

    // Update KPI cards
    document.getElementById('kpi-visitors').textContent = formatNumber(totalVisitors);
    document.getElementById('kpi-revenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('kpi-arpu').textContent = formatCurrency(avgARPV);
    document.getElementById('kpi-return').textContent = formatPercent(avgReturnRate);

    // Calculate and display week-over-week changes
    const visitorsChange = prevTotalVisitors > 0 ? ((totalVisitors - prevTotalVisitors) / prevTotalVisitors) * 100 : 0;
    const revenueChange = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 : 0;
    const arpvChange = avgARPV - prevAvgARPV;
    const returnRateChange = (avgReturnRate - prevAvgReturnRate) * 100; // Convert to percentage points

    // Update change indicators with proper formatting and CSS classes
    const visitorsChangeEl = document.getElementById('kpi-visitors-change');
    visitorsChangeEl.textContent = (visitorsChange >= 0 ? '+' : '') + visitorsChange.toFixed(1) + '%';
    visitorsChangeEl.className = visitorsChange >= 0 ? 'text-success' : 'text-danger';

    const revenueChangeEl = document.getElementById('kpi-revenue-change');
    revenueChangeEl.textContent = (revenueChange >= 0 ? '+' : '') + revenueChange.toFixed(1) + '%';
    revenueChangeEl.className = revenueChange >= 0 ? 'text-success' : 'text-danger';

    const arpvChangeEl = document.getElementById('kpi-arpu-change');
    arpvChangeEl.textContent = (arpvChange >= 0 ? '+' : '') + formatCurrency(Math.abs(arpvChange));
    arpvChangeEl.className = arpvChange >= 0 ? 'text-success' : 'text-danger';

    const returnChangeEl = document.getElementById('kpi-return-change');
    returnChangeEl.textContent = (returnRateChange >= 0 ? '+' : '') + returnRateChange.toFixed(1) + 'pp';
    returnChangeEl.className = returnRateChange >= 0 ? 'text-success' : 'text-danger';

  } catch (error) {
    console.error('Error loading KPIs:', error);
  }
}

// Load scenarios data only (no UI rendering)
async function loadScenariosData() {
  try {
    allScenarios = await loadScenarios();
    console.log(`✅ Loaded ${allScenarios.length} scenarios`);
  } catch (error) {
    console.error('Error loading scenarios:', error);
  }
}

// [OLD SIMULATION FUNCTIONS REMOVED - Using tabbed interface]

// Update elasticity analysis with scenario data
async function updateElasticityAnalysis(result) {
  try {
    const params = await loadElasticityParams();
    const dailyData = await getDailyData('all');

    // Get baseline data
    const latestDay = {};
    ['standard_pass', 'premium_pass', 'vip_pass'].forEach(tier => {
      const tierData = dailyData.filter(d => d.membership_tier === tier);
      latestDay[tier] = tierData[tierData.length - 1];
    });

    // Determine which tier was affected by the scenario
    const affectedTier = result.tier || selectedScenario?.config?.tier;
    const scenarioPrice = result.new_price || selectedScenario?.config?.new_price;

    const demandCurveData = {
      tiers: [
        {
          name: 'Standard Pass',
          elasticity: params.standard_pass?.base_elasticity || -1.9,
          currentPrice: 79,
          currentSubs: latestDay.standard_pass?.daily_visitors || 0,
          newPrice: affectedTier === 'standard_pass' ? scenarioPrice : null,
          newSubs: affectedTier === 'standard_pass' ? result.forecasted.visitors : null,
          color: '#dc3545'
        },
        {
          name: 'Premium Pass',
          elasticity: params.premium_pass?.base_elasticity || -1.5,
          currentPrice: 139,
          currentSubs: latestDay.premium_pass?.daily_visitors || 0,
          newPrice: affectedTier === 'premium_pass' ? scenarioPrice : null,
          newSubs: affectedTier === 'premium_pass' ? result.forecasted.visitors : null,
          color: '#ffc107'
        },
        {
          name: 'VIP Pass',
          elasticity: params.vip_pass?.base_elasticity || -1.3,
          currentPrice: 249,
          currentSubs: latestDay.vip_pass?.daily_visitors || 0,
          newPrice: affectedTier === 'vip_pass' ? scenarioPrice : null,
          newSubs: affectedTier === 'vip_pass' ? result.forecasted.visitors : null,
          color: '#28a745'
        }
      ]
    };

    renderDemandCurve('demand-curve-chart', demandCurveData, { width: 1100, height: 500 });
  } catch (error) {
    console.error('Error updating elasticity analysis:', error);
  }
}

// Load and render elasticity analytics
async function loadElasticityAnalytics() {
  try {
    const params = await loadElasticityParams();
    const dailyData = await getDailyData('all');

    // Prepare demand curve data
    const latestDay = {};
    ['standard_pass', 'premium_pass', 'vip_pass'].forEach(tier => {
      const tierData = dailyData.filter(d => d.membership_tier === tier);
      latestDay[tier] = tierData[tierData.length - 1];
    });

    const demandCurveData = {
      tiers: [
        {
          name: 'Standard Pass',
          elasticity: params.standard_pass?.base_elasticity || -1.9,
          currentPrice: 79,
          currentSubs: latestDay.standard_pass?.daily_visitors || 0,
          color: '#dc3545'
        },
        {
          name: 'Premium Pass',
          elasticity: params.premium_pass?.base_elasticity || -1.5,
          currentPrice: 139,
          currentSubs: latestDay.premium_pass?.daily_visitors || 0,
          color: '#ffc107'
        },
        {
          name: 'VIP Pass',
          elasticity: params.vip_pass?.base_elasticity || -1.3,
          currentPrice: 249,
          currentSubs: latestDay.vip_pass?.daily_visitors || 0,
          color: '#28a745'
        }
      ]
    };

    renderDemandCurve('demand-curve-chart', demandCurveData, { width: 1100, height: 500 });

    // Prepare heatmap data
    const segments = ['new_0_3mo', 'tenured_3_12mo', 'tenured_12plus'];
    const tiers = ['standard_pass', 'premium_pass', 'vip_pass'];
    const values = segments.map(segment =>
      tiers.map(tier => {
        if (params[tier]?.segments && params[tier].segments[segment]) {
          return params[tier].segments[segment];
        }
        return params[tier]?.base_elasticity || -1.5;
      })
    );

    const heatmapData = {
      segments: ['New (0-3mo)', 'Tenured (3-12mo)', 'Tenured (12+mo)'],
      tiers: ['Standard Pass', 'Premium Pass', 'VIP Pass'],
      values: values
    };

    renderElasticityHeatmap('elasticity-heatmap', heatmapData, { cellSize: 100 });

  } catch (error) {
    console.error('Error loading elasticity analytics:', error);
  }
}

// Store all simulation results for chatbot access
let allSimulationResults = allSimulationResultsByModel[activeModelType];

// Initialize chat context with scenario-focused tools
async function initializeChatContext() {
  try {
    // Get current KPI values
    const dailyData = await getDailyData('all');
    const latestDay = {};
    ['standard_pass', 'premium_pass', 'vip_pass'].forEach(tier => {
      const tierData = dailyData.filter(d => d.membership_tier === tier);
      latestDay[tier] = tierData[tierData.length - 1];
    });

    const totalVisitors = Object.values(latestDay).reduce((sum, d) => sum + (d.daily_visitors || 0), 0);
    const totalRevenue = Object.values(latestDay).reduce((sum, d) => sum + (d.daily_revenue || 0), 0) * 30;
    const avgReturnRate = Object.values(latestDay).reduce((sum, d) => sum + (d.return_rate || 0), 0) / 3;

    // Load elasticity parameters for visualization context
    const elasticityParams = await loadElasticityParams();

    // Create scenario-focused context for chat
    const context = {
      // All scenario definitions
      allScenarios: allScenarios,

      // Current simulation result (if any)
      getCurrentSimulation: () => currentResult,

      // All saved scenarios for comparison
      getSavedScenarios: () => savedScenarios,

      // All simulation results
      getAllSimulationResults: () => allSimulationResults,

      // Business context
      businessContext: {
        currentVisitors: totalVisitors,
        currentRevenue: totalRevenue,
        currentReturnRate: avgReturnRate,
        elasticityByTier: {
          standard_pass: elasticityParams.standard_pass?.base_elasticity || -1.9,
          premium_pass: elasticityParams.premium_pass?.base_elasticity || -1.5,
          vip_pass: elasticityParams.vip_pass?.base_elasticity || -1.3
        },
        tierPricing: {
          standard_pass: 79,
          premium_pass: 139,
          vip_pass: 249
        }
      },

      // Visualization data context
      getVisualizationData: () => ({
        demandCurve: {
          description: "Shows price elasticity - how demand changes with price for each tier",
          tiers: [
            { name: 'Standard Pass', elasticity: elasticityParams.standard_pass?.base_elasticity || -1.9, price: 79 },
            { name: 'Premium Pass', elasticity: elasticityParams.premium_pass?.base_elasticity || -1.5, price: 139 },
            { name: 'VIP Pass', elasticity: elasticityParams.vip_pass?.base_elasticity || -1.3, price: 249 }
          ]
        },
        tierMix: currentResult ? {
          description: "Baseline vs Forecasted visitor distribution across tiers",
          baseline: currentResult.baseline,
          forecasted: currentResult.forecasted
        } : null,
        forecast: currentResult ? {
          description: "12-month visitor forecast with 90% confidence intervals",
          timeSeries: currentResult.time_series
        } : null
      }),

      // SCENARIO-FOCUSED TOOLS

      // Interpret a specific scenario's results
      interpretScenario: async (scenarioId) => {
        // Check if we have results for this scenario
        let result = allSimulationResults.find(r => r.scenario_id === scenarioId);

        // If not, check if it's the current result
        if (!result && currentResult && currentResult.scenario_id === scenarioId) {
          result = currentResult;
        }

        // If still not found, run the simulation
        if (!result) {
          const scenario = allScenarios.find(s => s.id === scenarioId);
          if (!scenario) {
            throw new Error(`Scenario ${scenarioId} not found`);
          }
          result = await simulateScenario(scenario);
        }

        // Build interpretation
        const interpretation = {
          scenario_id: result.scenario_id,
          scenario_name: result.scenario_name,

          // Key metrics
          metrics: {
            revenue: {
              change_pct: result.delta.revenue_pct,
              change_amount: result.delta.revenue,
              forecasted: result.forecasted.revenue,
              baseline: result.baseline.revenue
            },
            visitors: {
              change_pct: result.delta.visitors_pct,
              change_amount: result.delta.visitors,
              forecasted: result.forecasted.visitors,
              baseline: result.baseline.visitors
            },
            churn: {
              change_pct: result.delta.churn_rate_pct,
              forecasted_rate: result.forecasted.churn_rate,
              baseline_rate: result.baseline.churn_rate
            },
            arpu: {
              change_pct: result.delta.arpu_pct,
              forecasted: result.forecasted.arpu,
              baseline: result.baseline.arpu
            }
          },

          // Trade-offs
          tradeoffs: {
            revenue_vs_visitors: `${result.delta.revenue_pct >= 0 ? 'Gain' : 'Loss'} ${Math.abs(result.delta.revenue_pct).toFixed(1)}% revenue, ${result.delta.visitors_pct >= 0 ? 'gain' : 'lose'} ${Math.abs(result.delta.visitors_pct).toFixed(1)}% visitors`,
            price_sensitivity: result.elasticity < -2.0 ? 'High' : result.elasticity < -1.5 ? 'Medium' : 'Low'
          },

          // Warnings and risks
          warnings: result.warnings || [],

          // Elasticity info
          elasticity: result.elasticity,

          // Time series forecast
          forecast_12m: result.time_series,

          summary: `${result.scenario_name} analysis: Revenue ${result.delta.revenue_pct >= 0 ? 'increases' : 'decreases'} by ${Math.abs(result.delta.revenue_pct).toFixed(1)}% while visitors ${result.delta.visitors_pct >= 0 ? 'grow' : 'decline'} by ${Math.abs(result.delta.visitors_pct).toFixed(1)}%. Churn ${result.delta.churn_rate_pct >= 0 ? 'increases' : 'decreases'} by ${Math.abs(result.delta.churn_rate_pct).toFixed(1)}%.`
        };

        return interpretation;
      },

      // Suggest a new scenario based on business goal
      suggestScenario: async (goal) => {
        const goalMap = {
          maximize_revenue: {
            strategy: 'Price increase on lower-elasticity tier',
            tier: 'ad_free',
            priceChange: +1.00,
            rationale: 'Ad-Free has lower elasticity than Ad-Lite, so moderate increases reduce visitor loss'
          },
          grow_visitors: {
            strategy: 'Aggressive promotion on high-elasticity tier',
            tier: 'ad_supported',
            priceChange: -2.00,
            rationale: 'Ad-Lite has highest elasticity (-2.1), so discounts drive maximum visitor growth'
          },
          reduce_churn: {
            strategy: 'Moderate price decrease to improve value perception',
            tier: 'ad_free',
            priceChange: -1.00,
            rationale: 'Modest price reduction improves perceived value while maintaining revenue'
          },
          maximize_arpu: {
            strategy: 'Premium tier price increase',
            tier: 'ad_free',
            priceChange: +1.50,
            rationale: 'Target customers less price-sensitive, willing to pay premium for ad-free experience'
          }
        };

        const suggestion = goalMap[goal];
        if (!suggestion) {
          throw new Error(`Unknown goal: ${goal}. Valid goals: ${Object.keys(goalMap).join(', ')}`);
        }

        const tierPrices = {
          ad_supported: 5.99,
          ad_free: 9.99
        };

        const currentPrice = tierPrices[suggestion.tier];
        const newPrice = currentPrice + suggestion.priceChange;

        return {
          goal: goal,
          suggested_scenario: {
            name: `${suggestion.strategy} - ${suggestion.tier.replace('_', ' ')}`,
            tier: suggestion.tier,
            current_price: currentPrice,
            new_price: newPrice,
            price_change: suggestion.priceChange,
            price_change_pct: (suggestion.priceChange / currentPrice) * 100
          },
          rationale: suggestion.rationale,
          estimated_impact: `For ${goal.replace('_', ' ')}, this strategy is optimal based on elasticity analysis`,
          next_steps: 'Use the scenario editor to create this scenario, then simulate to see detailed forecasts'
        };
      },

      // Analyze a specific chart/visualization
      analyzeChart: async (chartName) => {
        const chartAnalysis = {
          demand_curve: {
            name: 'Demand Curve by Tier',
            description: 'Shows price elasticity - how quantity demanded changes with price',
            interpretation: [
              'Steeper curve = higher elasticity = more price-sensitive customers',
              `Ad-Lite (elasticity ${elasticityParams.tiers.ad_supported.base_elasticity}): Most price-sensitive`,
              `Ad-Free (elasticity ${elasticityParams.tiers.ad_free.base_elasticity}): Moderately price-sensitive`
            ],
            insights: 'Use this to identify optimal price points for each tier. Flatter curves allow for price increases with minimal visitor loss.'
          },
          tier_mix: currentResult ? {
            name: 'Tier Mix: Baseline vs Forecasted',
            description: 'Compares current vs forecasted visitor distribution across tiers',
            baseline: currentResult.baseline,
            forecasted: currentResult.forecasted,
            interpretation: `Scenario "${currentResult.scenario_name}" shifts tier distribution. Revenue impact depends on tier ARPU differences.`
          } : null,
          forecast: currentResult ? {
            name: '12-Month Subscriber Forecast',
            description: 'Projects visitor count over 12 months with 90% confidence intervals',
            timeSeries: currentResult.time_series,
            interpretation: 'Confidence intervals widen over time due to increasing uncertainty. Use for medium-term planning (3-6 months most reliable).'
          } : null,
          heatmap: {
            name: 'Elasticity Heatmap by Cohort',
            description: 'Shows how price sensitivity varies by customer tenure and tier',
            interpretation: [
              'New visitors (0-3mo) are typically more price-sensitive',
              'Tenured visitors (12+mo) show lower elasticity (more loyal)',
              'This guides targeted pricing strategies by segment'
            ]
          }
        };

        const analysis = chartAnalysis[chartName];
        if (!analysis) {
          throw new Error(`Unknown chart: ${chartName}. Available charts: ${Object.keys(chartAnalysis).join(', ')}`);
        }

        return analysis;
      },

      // Deep comparison of multiple scenarios
      compareOutcomes: async (scenarioIds) => {
        if (scenarioIds.length < 2) {
          throw new Error('Need at least 2 scenarios to compare');
        }

        const scenarios = scenarioIds.map(id => allScenarios.find(s => s.id === id)).filter(s => s);
        if (scenarios.length === 0) {
          throw new Error('No valid scenarios found');
        }

        // Run all scenarios if not already simulated
        const results = [];
        for (const scenario of scenarios) {
          let result = allSimulationResults.find(r => r.scenario_id === scenario.id);
          if (!result && currentResult && currentResult.scenario_id === scenario.id) {
            result = currentResult;
          }
          if (!result) {
            result = await simulateScenario(scenario);
            allSimulationResults.push(result);
          }
          results.push(result);
        }

        // Analyze trade-offs
        const comparison = {
          scenarios: results.map(r => ({
            id: r.scenario_id,
            name: r.scenario_name,
            revenue_pct: r.delta.revenue_pct,
            visitors_pct: r.delta.visitors_pct,
            churn_pct: r.delta.churn_rate_pct,
            arpu_pct: r.delta.arpu_pct
          })),

          best_for: {
            revenue: results.reduce((best, r) => r.delta.revenue_pct > best.delta.revenue_pct ? r : best).scenario_name,
            visitors: results.reduce((best, r) => r.delta.visitors_pct > best.delta.visitors_pct ? r : best).scenario_name,
            churn: results.reduce((best, r) => r.delta.churn_rate_pct < best.delta.churn_rate_pct ? r : best).scenario_name,
            arpu: results.reduce((best, r) => r.delta.arpu_pct > best.delta.arpu_pct ? r : best).scenario_name
          },

          tradeoffs: results.map(r => ({
            scenario: r.scenario_name,
            tradeoff: `Revenue ${r.delta.revenue_pct >= 0 ? '+' : ''}${r.delta.revenue_pct.toFixed(1)}% vs Visitors ${r.delta.visitors_pct >= 0 ? '+' : ''}${r.delta.visitors_pct.toFixed(1)}%`,
            risk_level: r.warnings && r.warnings.length > 0 ? 'High' : Math.abs(r.delta.visitors_pct) > 10 ? 'Medium' : 'Low'
          })),

          recommendation: `Best scenario depends on business priority. For revenue: ${results.reduce((best, r) => r.delta.revenue_pct > best.delta.revenue_pct ? r : best).scenario_name}. For growth: ${results.reduce((best, r) => r.delta.visitors_pct > best.delta.visitors_pct ? r : best).scenario_name}.`
        };

        return comparison;
      },

      // Create a new scenario from parameters
      createScenario: async (parameters) => {
        const { tier, price_change, promotion_discount, promotion_duration } = parameters;

        if (!tier || !['ad_supported', 'ad_free'].includes(tier)) {
          throw new Error('Invalid tier. Must be: ad_supported or ad_free');
        }

        const tierPrices = {
          ad_supported: 5.99,
          ad_free: 9.99
        };

        const currentPrice = tierPrices[tier];
        let newPrice;
        let scenarioType;

        if (promotion_discount && promotion_duration) {
          // Promotion scenario
          newPrice = currentPrice * (1 - promotion_discount / 100);
          scenarioType = 'promotion';
        } else if (price_change !== undefined) {
          // Price change scenario
          newPrice = currentPrice + price_change;
          scenarioType = 'price_change';
        } else {
          throw new Error('Must specify either price_change or (promotion_discount and promotion_duration)');
        }

        const newScenario = {
          id: `scenario_custom_${Date.now()}`,
          name: scenarioType === 'promotion'
            ? `${promotion_discount}% Off Promo (${promotion_duration}mo) - ${tier}`
            : `${tier} ${price_change >= 0 ? '+' : ''}$${price_change.toFixed(2)}`,
          description: `Custom scenario created via chatbot`,
          category: scenarioType,
          config: {
            tier: tier,
            current_price: currentPrice,
            new_price: newPrice,
            price_change_pct: ((newPrice - currentPrice) / currentPrice) * 100
          },
          constraints: {
            min_price: currentPrice * 0.5,
            max_price: currentPrice * 1.5
          }
        };

        if (scenarioType === 'promotion') {
          newScenario.config.promotion = {
            discount_pct: promotion_discount,
            duration_months: promotion_duration
          };
        }

        // Add to scenarios list
        allScenarios.push(newScenario);

        return {
          created: true,
          scenario: newScenario,
          message: `Created scenario: ${newScenario.name}. Use interpretScenario('${newScenario.id}') to simulate and analyze results.`
        };
      }
    };

    // Initialize chat module with scenario-focused context
    initializeChat(context);
  } catch (error) {
    console.error('Error initializing chat context:', error);
    throw error;
  }
}

// Load sample data with progress bar
async function loadData() {
  const btn = document.getElementById('load-data-btn');
  const progressContainer = document.getElementById('loading-progress');
  const progressBar = document.getElementById('loading-progress-bar');
  const progressText = document.getElementById('loading-percentage');
  const stageText = document.getElementById('loading-stage');

  // Hide button, show progress
  btn.style.display = 'none';
  progressContainer.style.display = 'block';

  // Ensure loading UI elements exist and are visible
  if (!progressContainer || !progressBar || !progressText || !stageText) {
    console.error('Loading UI elements not found');
    return;
  }

  // Force visibility
  progressContainer.style.display = 'block';
  progressContainer.style.visibility = 'visible';

  // Define loading stages
  const stages = [
    { progress: 5, text: 'Initializing data loader...' },
    { progress: 15, text: 'Loading CSV files...' },
    { progress: 30, text: 'Parsing weekly aggregated data...' },
    { progress: 45, text: 'Calculating KPIs...' },
    { progress: 60, text: 'Loading pricing scenarios...' },
    { progress: 75, text: 'Analyzing price elasticity...' },
    { progress: 85, text: 'Initializing AI chat context...' },
    { progress: 95, text: 'Finalizing data viewer...' },
    { progress: 100, text: 'Complete!' }
  ];

  // Random total duration between 2-7 seconds
  const totalDuration = 2000 + Math.random() * 5000;
  const stageInterval = totalDuration / stages.length;

  try {
    console.log('Starting data load with visible progress bar');

    // Show progress through stages
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      console.log(`Loading stage ${i+1}/${stages.length}: ${stage.text} (${stage.progress}%)`);

      // Update UI
      progressBar.style.width = stage.progress + '%';
      progressBar.style.minWidth = '5%'; // Always show at least 5%
      progressBar.setAttribute('aria-valuenow', stage.progress);
      progressText.textContent = stage.progress + '%';
      stageText.textContent = stage.text;

      // Add color transition as we progress
      if (stage.progress >= 75) {
        progressBar.classList.remove('bg-primary');
        progressBar.classList.add('bg-success');
      }

      // Wait for stage interval
      await new Promise(resolve => setTimeout(resolve, stageInterval));

      // Load actual data at specific stages
      if (stage.progress === 45) {
        await loadKPIs();
      } else if (stage.progress === 60) {
        await loadScenariosData();
        // Populate elasticity model tabs with filtered scenarios
        populateElasticityModelTabs();
        // Load segmentation data
        if (window.segmentEngine) {
          const segmentDataLoaded = await window.segmentEngine.loadSegmentData();
          if (!segmentDataLoaded) {
            console.error('Failed to load segmentation data');
          }
        } else {
          console.error('Segmentation engine not available');
        }
      } else if (stage.progress === 75) {
        await loadElasticityAnalytics();
      } else if (stage.progress === 85) {
        await initializeChatContext();
      } else if (stage.progress === 95) {
        initializeDataViewer();
      }
    }

    // Wait a bit before transitioning
    await new Promise(resolve => setTimeout(resolve, 500));

    // Hide loading progress, show KPI dashboard
    const loadDataSection = document.getElementById('load-data-section');
    const kpiSection = document.getElementById('kpi-section');
    if (loadDataSection) loadDataSection.style.display = 'none';
    if (kpiSection) kpiSection.style.display = 'block';

    // NOTE: We're already on Step 1 (navigated before loadData was called)
    // All section visibility is now controlled by step navigation
    // After data loads, we auto-navigate to Step 1 which shows:
    // - load-data-section (hidden after load completes)
    // - kpi-section (with dashboard KPI cards)
    //
    // Other sections controlled by their respective steps:
    // Step 2-4: Individual elasticity models (insight boxes only)
    // Step 5: Scenario Analysis (elasticity-models-section with full scenarios)
    // Step 6: Customer Segmentation
    // Step 7: Event Calendar
    // Step 8: Data Explorer & Chat

    // Initialize segmentation section if data is available (but keep hidden)
    if (window.segmentEngine && window.segmentEngine.isDataLoaded()) {
      initializeSegmentationSection();
      initializeSegmentComparison();
      // initializeFilterPresets(); // Removed - Quick Presets feature removed from UI
      initializeExportButtons();
    }

    // Initialize Event Calendar
    try {
      await initializeEventCalendar();
      console.log('✅ Event Calendar initialized');
    } catch (error) {
      console.error('⚠️ Event Calendar initialization failed:', error);
    }

    // Re-initialize popovers for newly visible sections
    initializePopovers();

    dataLoaded = true;

    // Initialize Pyodide models in background (non-blocking)
    initializePyodideModels().then(success => {
      if (success) {
        console.log('✅ Pyodide Python models ready to use');
      } else {
        console.log('⚠️ Pyodide initialization failed, using JavaScript fallback');
      }
    });

  } catch (error) {
    console.error('Error loading data:', error);

    // Show error state
    progressBar.classList.remove('bg-success');
    progressBar.classList.add('bg-danger');
    stageText.textContent = 'Error loading data: ' + error.message;

    // Reset after 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    progressContainer.style.display = 'none';
    btn.style.display = 'inline-block';
    btn.disabled = false;
  }
}

// Save current scenario
function saveScenario() {
  const activeResult = currentResultByModel[activeModelType];
  if (!activeResult) {
    showAlert('No simulation results to save. Please run a simulation first.', 'warning');
    return;
  }

  // Check if the current result matches the selected scenario
  if (selectedScenario && activeResult.scenario_id !== selectedScenario.id) {
    showAlert(`You have "${selectedScenario.name}" selected but haven't simulated it yet. Click "Simulate" first, then save.`, 'warning');
    return;
  }

  // Check for duplicates - don't save if this scenario_id is already saved
  const isDuplicate = savedScenariosByModel[activeModelType].some(
    s => s.scenario_id === activeResult.scenario_id
  );

  if (isDuplicate) {
    showAlert(`Scenario "${activeResult.scenario_name}" is already saved. Try simulating a different scenario to compare.`, "warning");
    return;
  }

  savedScenariosByModel[activeModelType].push({
    ...activeResult,
    savedAt: new Date().toISOString()
  });
  savedScenarios = savedScenariosByModel[activeModelType];

  updateScenarioComparisonUI();

  showAlert(`Scenario "${activeResult.scenario_name}" saved! You can now compare it with other scenarios.`, "success");
}

// Compare saved scenarios
function compareScenarios() {
  if (savedScenarios.length < 2) {
    showAlert('Please save at least 2 scenarios to compare.', 'warning');
    return;
  }

  // Prepare data for grouped bar chart with proper null/undefined handling
  const barChartData = savedScenarios.map(s => {
    // Calculate churn_rate_pct if not already present
    const churnPct = s.delta.churn_rate_pct ||
      (s.delta.churn_rate && s.baseline && s.baseline.churn_rate
        ? (s.delta.churn_rate / s.baseline.churn_rate) * 100
        : 0);

    return {
      name: s.scenario_name || 'Unnamed Scenario',
      visitors_pct: s.delta?.visitors_pct || 0,
      revenue_pct: s.delta?.revenue_pct || 0,
      arpu_pct: s.delta?.arpu_pct || 0,
      churn_pct: churnPct
    };
  });

  // Prepare data for radar chart with proper null/undefined handling
  const radarChartData = savedScenarios.map(s => {
    // Calculate churn_rate_pct if not already present
    const churnPct = s.delta.churn_rate_pct ||
      (s.delta.churn_rate && s.baseline && s.baseline.churn_rate
        ? (s.delta.churn_rate / s.baseline.churn_rate) * 100
        : 0);

    // Calculate CLTV change estimate (simple approximation if not available)
    const cltvPct = s.delta?.cltv_pct ||
      ((s.delta?.revenue_pct || 0) - (churnPct * 0.5));

    return {
      name: s.scenario_name || 'Unnamed Scenario',
      dimensions: {
        revenue: s.delta?.revenue_pct || 0,
        growth: s.delta?.visitors_pct || 0,
        arpu: s.delta?.arpu_pct || 0,
        churn: churnPct,
        cltv: cltvPct
      }
    };
  });

  // Render charts
  renderComparisonBarChart('comparison-bar-chart', barChartData, { width: 750, height: 450 });
  renderRadarChart('comparison-radar-chart', radarChartData, { width: 500, height: 500 });

  // Show comparison charts
  document.getElementById('comparison-charts').style.display = 'block';

  // Scroll to comparison
  document.getElementById('comparison-section').scrollIntoView({ behavior: 'smooth' });
}

// Clear saved scenarios
function clearScenarios() {
  if (savedScenarios.length === 0) return;

  if (confirm('Are you sure you want to clear all saved scenarios?')) {
    savedScenariosByModel[activeModelType] = [];
    savedScenarios = savedScenariosByModel[activeModelType];

    // Also clear rankings for this model
    if (window.currentTop3ScenariosByModel) {
      window.currentTop3ScenariosByModel[activeModelType] = null;
    }

    updateScenarioComparisonUI();
    updateDecisionEngineDisplay();
  }
}

// Handle chat message send
async function handleChatSend() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();

  if (!message) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('chat-send-btn').disabled = true;

  try {
    await sendMessage(message);
  } finally {
    input.disabled = false;
    document.getElementById('chat-send-btn').disabled = false;
    input.focus();
  }
}

// Open Scenario Editor
function openScenarioEditor(scenarioId) {
  const scenario = allScenarios.find(s => s.id === scenarioId);
  if (!scenario) return;

  // Populate form
  document.getElementById('edit-scenario-id').value = scenario.id;
  document.getElementById('edit-scenario-name').value = scenario.name;
  document.getElementById('edit-tier').value = scenario.config.tier.replace('_', ' ').toUpperCase();
  document.getElementById('edit-current-price').value = scenario.config.current_price;
  document.getElementById('edit-new-price').value = scenario.config.new_price;

  // Show constraints
  const constraints = scenario.constraints;
  document.getElementById('price-constraints').textContent =
    `Valid range: $${constraints.min_price} - $${constraints.max_price}`;

  // Show promotion settings if applicable
  if (scenario.config.promotion) {
    document.getElementById('promotion-settings').style.display = 'block';
    document.getElementById('edit-discount-pct').value = scenario.config.promotion.discount_pct;
    document.getElementById('edit-duration-months').value = scenario.config.promotion.duration_months;
  } else {
    document.getElementById('promotion-settings').style.display = 'none';
  }

  // Update price change indicator
  updatePriceChangeIndicator();

  // Show modal
  const modal = new bootstrap.Modal(document.getElementById('scenarioEditorModal'));
  modal.show();
}

// Update price change indicator
function updatePriceChangeIndicator() {
  const currentPrice = parseFloat(document.getElementById('edit-current-price').value);
  const newPrice = parseFloat(document.getElementById('edit-new-price').value);

  if (currentPrice && newPrice) {
    const change = ((newPrice - currentPrice) / currentPrice) * 100;
    const indicator = document.getElementById('price-change-indicator');
    indicator.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
    indicator.className = 'input-group-text';
    if (change > 0) indicator.classList.add('bg-danger', 'text-white');
    else if (change < 0) indicator.classList.add('bg-success', 'text-white');
  }
}

// Save edited scenario
async function saveEditedScenario() {
  const scenarioId = document.getElementById('edit-scenario-id').value;
  const scenario = allScenarios.find(s => s.id === scenarioId);
  if (!scenario) return;

  // Get new values
  const newPrice = parseFloat(document.getElementById('edit-new-price').value);
  const discountPct = document.getElementById('edit-discount-pct').value ?
    parseFloat(document.getElementById('edit-discount-pct').value) : null;
  const durationMonths = document.getElementById('edit-duration-months').value ?
    parseInt(document.getElementById('edit-duration-months').value) : null;

  // Validate constraints
  if (newPrice < scenario.constraints.min_price || newPrice > scenario.constraints.max_price) {
    showAlert(`Price must be between $${scenario.constraints.min_price} and $${scenario.constraints.max_price}`, "warning");
    return;
  }

  // Update scenario
  scenario.config.new_price = newPrice;
  scenario.config.price_change_pct = ((newPrice - scenario.config.current_price) / scenario.config.current_price) * 100;

  if (scenario.config.promotion && discountPct && durationMonths) {
    scenario.config.promotion.discount_pct = discountPct;
    scenario.config.promotion.duration_months = durationMonths;

    // Recalculate promo price
    scenario.config.new_price = scenario.config.current_price * (1 - discountPct / 100);
  }

  // Update description
  if (scenario.category === 'promotion') {
    scenario.name = `Launch ${discountPct}% Off Promo (${durationMonths} months)`;
    scenario.description = `Offer ${discountPct}% discount for ${durationMonths} months on ${scenario.config.tier.replace('_', '-')} tier`;
  } else {
    const priceDiff = newPrice - scenario.config.current_price;
    scenario.name = `${scenario.config.tier.replace('_', ' ')} ${priceDiff >= 0 ? '+' : ''}$${Math.abs(priceDiff).toFixed(2)}`;
  }

  // Close modal properly to avoid focus issues
  const modalElement = document.getElementById('scenarioEditorModal');
  const modalInstance = bootstrap.Modal.getInstance(modalElement);
  if (modalInstance) {
    modalInstance.hide();
  }

  // Wait for modal to close animation
  await new Promise(resolve => setTimeout(resolve, 300));

  // Reload scenario data and refresh tabs
  await loadScenariosData();
  populateElasticityModelTabs();

  // If this was the selected scenario, re-select it
  const modelType = scenario.model_type;
  if (selectedScenarioByModel[modelType] && selectedScenarioByModel[modelType].id === scenarioId) {
    selectedScenarioByModel[modelType] = scenario;
    if (modelType === activeModelType) {
      selectedScenario = scenario;
      syncScenarioSelectionUI();
      updateSimulateButtonState();
    }
  }

  showAlert('Scenario updated! Click "Simulate" to see the new results.', 'info');
}

function buildKpiSummaryCard() {
  const kpiCards = document.querySelectorAll('#kpi-cards .kpi-card');
  const items = [...kpiCards].map(card => {
    const labelEl = card.querySelector('.text-muted');
    const valueEl = card.querySelector('.fs-2');
    const changeEl = card.querySelector('.small');
    const label = labelEl?.childNodes?.[0]?.textContent?.trim() || labelEl?.textContent?.trim() || '';
    const value = valueEl?.textContent?.trim() || '--';
    const changeText = changeEl?.textContent?.trim() || '--';
    const changeClass = changeEl?.classList?.contains('text-success')
      ? 'text-success'
      : (changeEl?.classList?.contains('text-danger') ? 'text-danger' : 'text-muted');

    return `
      <div class="col-6">
        <div class="small text-muted text-uppercase">${label}</div>
        <div class="fw-semibold">${value}</div>
        <div class="small ${changeClass}">${changeText}</div>
      </div>
    `;
  });

  return `
    <div class="card kpi-popover-card border-0 shadow-sm">
      <div class="card-body p-3">
        <div class="small text-uppercase text-muted mb-2">Key Performance Metrics (Latest Week)</div>
        <div class="row g-2">
          ${items.join('')}
        </div>
      </div>
    </div>
  `;
}

// Initialize Bootstrap popovers for ML methodology and KPI hover cards
function initializePopovers() {
  const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
  const popoverList = [...popoverTriggerList].map(popoverTriggerEl => {
    const trigger = popoverTriggerEl.getAttribute('data-bs-trigger') || 'focus';
    const isKpiSummary = popoverTriggerEl.dataset.kpiPopover === 'summary';
    const placement = popoverTriggerEl.getAttribute('data-bs-placement') || 'top';

    // Build config object conditionally to avoid undefined values
    const config = {
      html: true,
      sanitize: false,
      trigger,
      placement
    };

    // Only add content if it's a KPI summary popover
    if (isKpiSummary) {
      config.content = buildKpiSummaryCard;
    }

    return new bootstrap.Popover(popoverTriggerEl, config);
  });
}

// ========== Segmentation Section Functions ==========

/**
 * Initialize the segmentation section
 */
function initializeSegmentationSection() {
  // Populate filter pills for each axis
  populateFilterPills(
    'acquisition-filters',
    window.segmentEngine.axisDefinitions.acquisition,
    'acquisition'
  );
  populateFilterPills(
    'engagement-filters',
    window.segmentEngine.axisDefinitions.engagement,
    'engagement'
  );
  populateFilterPills(
    'monetization-filters',
    window.segmentEngine.axisDefinitions.monetization,
    'monetization'
  );

  // Set up event listeners for controls
  const tierSelector = document.getElementById('segment-tier-select');
  const axisSelector = document.getElementById('segment-axis-select');
  const vizTypeSelector = document.getElementById('segment-viz-select');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');

  tierSelector.addEventListener('change', updateSegmentVisualization);
  axisSelector.addEventListener('change', updateSegmentVisualization);
  vizTypeSelector.addEventListener('change', updateSegmentVisualization);
  clearFiltersBtn.addEventListener('click', clearAllFilters);

  // 3-axis view buttons
  const reset3AxisBtn = document.getElementById('reset-3axis-btn');
  const export3AxisBtn = document.getElementById('export-3axis-btn');

  if (reset3AxisBtn) {
    reset3AxisBtn.addEventListener('click', () => {
      updateSegmentVisualization();
    });
  }

  if (export3AxisBtn) {
    export3AxisBtn.addEventListener('click', () => {
      const tier = document.getElementById('segment-tier-select').value;
      const filename = `segment-3axis-${tier}-${new Date().toISOString().slice(0, 10)}.svg`;
      exportSVG('three-axis-radial-viz', filename);
    });
  }

  // Initial render
  updateSegmentVisualization();
}

/**
 * Populate cohort selector options
 * @param {string} selectId - Select element ID
 */
function populateCohortSelector(selectId) {
  const selector = document.getElementById(selectId);
  if (!selector || !window.segmentEngine) return;

  const cohorts = window.segmentEngine.getCohortDefinitions();
  if (!cohorts.length) return;

  selector.innerHTML = '';
  cohorts.forEach(cohort => {
    const option = document.createElement('option');
    option.value = cohort.id;
    option.textContent = cohort.label;
    if (cohort.id === window.segmentEngine.getActiveCohort()) {
      option.selected = true;
    }
    selector.appendChild(option);
  });
}

/**
 * Keep cohort selectors in sync (only Step 5 now)
 * @param {string} cohortId - Selected cohort id
 */
function syncCohortSelectors(cohortId) {
  // Only Step 5 has cohort selector now
  const selector = document.getElementById('compare-cohort-select');
  if (selector && selector.value !== cohortId) {
    selector.value = cohortId;
  }
}

/**
 * Populate filter pills for a specific axis
 * @param {string} containerId - Container element ID
 * @param {Array<string>} values - Filter values
 * @param {string} axisType - Axis type (engagement, monetization, acquisition)
 */
function populateFilterPills(containerId, values, axisType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  values.forEach(value => {
    const pill = document.createElement('div');
    pill.className = 'filter-pill';
    pill.dataset.value = value;
    pill.dataset.axis = axisType;
    pill.textContent = window.segmentEngine.formatSegmentLabel(value);

    // Toggle active state on click
    pill.addEventListener('click', () => {
      pill.classList.toggle('active');
      updateSegmentVisualization();
    });

    container.appendChild(pill);
  });
}

/**
 * Update segment visualization based on current filters and selections
 */
function updateSegmentVisualization() {
  const tier = document.getElementById('segment-tier-select').value;
  const axis = document.getElementById('segment-axis-select').value;
  const vizType = document.getElementById('segment-viz-select').value;

  // Collect active filters
  const filters = {
    acquisition: getActivePillValues('acquisition-filters'),
    engagement: getActivePillValues('engagement-filters'),
    monetization: getActivePillValues('monetization-filters')
  };

  // Get filtered segments (with cohort adjustments applied)
  const filteredSegments = window.segmentEngine.filterSegments(filters);

  // Filter by selected tier
  const tierSegments = filteredSegments.filter(s => s.tier === tier);

  // Aggregate KPIs (cohort adjustments already applied in filterSegments)
  const aggregatedKPIs = window.segmentEngine.aggregateKPIs(tierSegments);

  // Render KPI cards
  renderSegmentKPICards('segment-kpi-dashboard', aggregatedKPIs);

  // Show/hide views based on visualization type
  const heatmapView = document.getElementById('heatmap-view');
  const threeAxisView = document.getElementById('3axis-view');
  const scatterView = document.getElementById('scatter-view');

  if (vizType === 'heatmap') {
    heatmapView.style.display = 'block';
    threeAxisView.style.display = 'none';
    scatterView.style.display = 'none';
    renderSegmentElasticityHeatmap('segment-elasticity-heatmap', tier, filters, axis);
  } else if (vizType === '3axis') {
    heatmapView.style.display = 'none';
    threeAxisView.style.display = 'block';
    scatterView.style.display = 'none';
    render3AxisRadialChart('three-axis-radial-viz', tier, null);
  } else if (vizType === 'scatter') {
    heatmapView.style.display = 'none';
    threeAxisView.style.display = 'none';
    scatterView.style.display = 'block';
    renderSegmentScatterPlot('segment-scatter-plot', tier);
  }
}

/**
 * Get active pill values from a container
 * @param {string} containerId - Container element ID
 * @returns {Array<string>} Array of active filter values
 */
function getActivePillValues(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];

  const activePills = container.querySelectorAll('.filter-pill.active');
  return Array.from(activePills).map(pill => pill.dataset.value);
}

/**
 * Clear all filter pills
 */
function clearAllFilters() {
  // Remove active class from all pills
  document.querySelectorAll('.filter-pill.active').forEach(pill => {
    pill.classList.remove('active');
  });

  // Update visualization
  updateSegmentVisualization();
}

/**
 * Render segment comparison table
 */
function renderSegmentComparisonTable() {
  const axisSelect = document.getElementById('compare-axis-select');
  const tierSelect = document.getElementById('compare-tier-select');
  const sortSelect = document.getElementById('compare-sort-select');

  if (!axisSelect || !tierSelect || !sortSelect) {
    console.error('Segment comparison controls not found in DOM');
    return;
  }

  const axis = axisSelect.value;
  const tier = tierSelect.value;
  const sortBy = sortSelect.value;

  // Get segments with cohort adjustments already applied
  const segments = window.segmentEngine.getSegmentsForTier(tier);

  if (!segments || segments.length === 0) {
    console.error('No segments available for tier:', tier);
    return;
  }

  const axisSegments = [...new Set(segments.map(s => s[axis]))];

  // Aggregate by axis
  const comparisonData = axisSegments.map(segmentId => {
    const matching = segments.filter(s => s[axis] === segmentId);
    const totalSubs = matching.reduce((sum, s) => sum + parseInt(s.visitor_count), 0);
    const avgChurn = matching.reduce((sum, s) => sum + (parseFloat(s.avg_return_rate) * parseInt(s.visitor_count)), 0) / totalSubs;
    const avgArpu = matching.reduce((sum, s) => sum + (parseFloat(s.avg_arpv) * parseInt(s.visitor_count)), 0) / totalSubs;

    // Get elasticity from segment_elasticity.json (with cohort multiplier applied)
    const elasticity = window.segmentEngine.getElasticity(tier, matching[0].compositeKey, axis);

    // Calculate axis-aware risk level
    let risk_level;
    if (axis === 'engagement') {
      // Engagement (return rate) elasticity is POSITIVE - higher = more risky
      // Realistic thresholds based on actual business impact:
      // Low: < 0.7 (return rate increases < 70% when price doubles - very sticky)
      // Medium: 0.7 - 1.5 (70-150% return rate increase - moderate risk)
      // High: > 1.5 (> 150% return rate increase - very risky)
      risk_level = elasticity < 0.7 ? 'Low' : (elasticity < 1.5 ? 'Medium' : 'High');
    } else if (axis === 'acquisition') {
      // Acquisition elasticity is NEGATIVE - more negative = more risky
      // Low: > -1.2 (inelastic)
      // Medium: -1.8 to -1.2
      // High: < -1.8 (very elastic)
      const absElasticity = Math.abs(elasticity);
      risk_level = absElasticity < 1.2 ? 'Low' : (absElasticity < 1.8 ? 'Medium' : 'High');
    } else if (axis === 'monetization') {
      // Monetization (migration) - higher upgrade willingness
      // Low: < 0.8 (sticky to current tier)
      // Medium: 0.8 - 1.3
      // High: > 1.3 (very likely to switch tiers)
      risk_level = elasticity < 0.8 ? 'Low' : (elasticity < 1.3 ? 'Medium' : 'High');
    } else {
      // Fallback for unknown axis
      risk_level = 'Medium';
    }

    return {
      segment: segmentId,
      label: window.segmentEngine.formatSegmentLabel(segmentId),
      visitors: totalSubs,
      return_rate: avgChurn,
      arpv: avgArpu,
      elasticity: elasticity || -2.0,
      risk_level: risk_level
    };
  });

  // Sort
  comparisonData.sort((a, b) => {
    switch(sortBy) {
      case 'elasticity': return a.elasticity - b.elasticity;
      case 'visitors': return b.visitors - a.visitors;
      case 'return_rate': return b.return_rate - a.return_rate;
      case 'arpv': return b.arpv - a.arpv;
      default: return 0;
    }
  });

  // Render table
  const container = document.getElementById('segment-comparison-table');

  if (!container) {
    console.error('segment-comparison-table container not found');
    return;
  }

  container.innerHTML = `
    <table class="table table-hover">
      <thead class="table-light">
        <tr>
          <th>Segment</th>
          <th class="text-end">Visitors</th>
          <th class="text-end">Return Rate</th>
          <th class="text-end">ARPV</th>
          <th class="text-end">Elasticity</th>
          <th class="text-center">Risk Level</th>
        </tr>
      </thead>
      <tbody>
        ${comparisonData.map(d => `
          <tr>
            <td><strong>${d.label}</strong></td>
            <td class="text-end">${formatNumber(d.visitors)}</td>
            <td class="text-end">${formatPercent(d.return_rate, 2)}</td>
            <td class="text-end">${formatCurrency(d.arpv)}</td>
            <td class="text-end">
              <span class="badge ${d.risk_level === 'High' ? 'bg-danger' : (d.risk_level === 'Medium' ? 'bg-warning' : 'bg-success')}">
                ${d.elasticity.toFixed(2)}
              </span>
            </td>
            <td class="text-center">
              <span class="badge ${d.risk_level === 'High' ? 'bg-danger' : (d.risk_level === 'Medium' ? 'bg-warning' : 'bg-success')}">
                ${d.risk_level}
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Render chart
  renderSegmentComparisonChart(comparisonData);
}

/**
 * Render comparison chart (Chart.js bar chart)
 */
function renderSegmentComparisonChart(data) {
  const ctx = document.getElementById('segment-comparison-chart');

  if (!ctx) {
    console.error('segment-comparison-chart canvas not found');
    return;
  }

  if (window.comparisonChart) {
    window.comparisonChart.destroy();
  }

  window.comparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: 'Price Elasticity',
        data: data.map(d => Math.abs(d.elasticity)),
        backgroundColor: data.map(d =>
          d.risk_level === 'High' ? '#dc3545' : (d.risk_level === 'Medium' ? '#ffc107' : '#28a745')
        ),
        borderColor: '#fff',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Elasticity: ${context.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Absolute Elasticity' }
        }
      }
    }
  });
}

/**
 * Initialize segment comparison table
 */
function initializeSegmentComparison() {
  console.log('Initializing segment comparison...');

  const compareAxisSelect = document.getElementById('compare-axis-select');
  const compareTierSelect = document.getElementById('compare-tier-select');
  const compareSortSelect = document.getElementById('compare-sort-select');

  if (!compareAxisSelect || !compareTierSelect || !compareSortSelect) {
    console.error('Segment comparison controls not found:', {
      axisSelect: !!compareAxisSelect,
      tierSelect: !!compareTierSelect,
      sortSelect: !!compareSortSelect
    });
    return;
  }

  console.log('Adding event listeners to segment comparison controls');
  compareAxisSelect.addEventListener('change', renderSegmentComparisonTable);
  compareTierSelect.addEventListener('change', renderSegmentComparisonTable);
  compareSortSelect.addEventListener('change', renderSegmentComparisonTable);

  // Initial render
  console.log('Rendering initial segment comparison table');
  renderSegmentComparisonTable();
}

/**
 * Initialize filter presets
 */
function initializeFilterPresets() {
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      applyFilterPreset(preset);
    });
  });

  // Search toggle
  document.getElementById('filter-search-toggle')?.addEventListener('click', () => {
    const searchBox = document.getElementById('filter-search-box');
    searchBox.style.display = searchBox.style.display === 'none' ? 'block' : 'none';
  });

  // Search input
  document.getElementById('segment-search-input')?.addEventListener('input', (e) => {
    searchSegments(e.target.value);
  });
}

/**
 * Apply filter preset
 */
function applyFilterPreset(preset) {
  clearAllFilters();

  const tier = document.getElementById('segment-tier-select').value;
  const segments = window.segmentEngine.getSegmentsForTier(tier);

  let targetSegments = [];

  switch(preset) {
    case 'high-risk':
      // High return rate (> 15%)
      targetSegments = segments
        .filter(s => parseFloat(s.avg_return_rate) > 0.15)
        .map(s => s.engagement);
      break;
    case 'low-elastic':
      // Low elasticity (> -2.0)
      targetSegments = segments
        .filter(s => {
          const elasticity = window.segmentEngine.getElasticity(tier, s.compositeKey, 'engagement');
          return elasticity > -2.0;
        })
        .map(s => s.engagement);
      break;
    case 'high-value':
      // High ARPV (> $30)
      targetSegments = segments
        .filter(s => parseFloat(s.avg_arpv) > 30)
        .map(s => s.monetization);
      break;
    case 'large':
      // Large visitor count (> 2000)
      targetSegments = segments
        .filter(s => parseInt(s.visitor_count) > 2000)
        .map(s => s.acquisition);
      break;
  }

  // Activate relevant pills
  targetSegments = [...new Set(targetSegments)];
  targetSegments.forEach(segmentId => {
    const pill = document.querySelector(`[data-segment-id="${segmentId}"]`);
    if (pill) pill.classList.add('active');
  });

  updateSegmentVisualization();
  updateFilterSummary();
}

/**
 * Search segments by name
 */
function searchSegments(query) {
  const resultsContainer = document.getElementById('search-results');

  if (!query || query.length < 2) {
    resultsContainer.innerHTML = '';
    return;
  }

  const allSegments = [
    ...window.segmentEngine.axisDefinitions.acquisition,
    ...window.segmentEngine.axisDefinitions.engagement,
    ...window.segmentEngine.axisDefinitions.monetization
  ];

  const matches = allSegments.filter(segmentId => {
    const info = window.segmentEngine.getSegmentInfo(segmentId);
    const label = info ? info.label : segmentId;
    return label.toLowerCase().includes(query.toLowerCase());
  });

  resultsContainer.innerHTML = matches.map(segmentId => {
    const info = window.segmentEngine.getSegmentInfo(segmentId);
    return `
      <button class="btn btn-sm btn-outline-secondary me-2 mb-2"
              onclick="selectSegmentFromSearch('${segmentId}')">
        ${info ? info.label : segmentId}
      </button>
    `;
  }).join('');
}

/**
 * Select segment from search results
 */
window.selectSegmentFromSearch = function(segmentId) {
  const pill = document.querySelector(`[data-segment-id="${segmentId}"]`);
  if (pill) {
    pill.classList.add('active');
    updateSegmentVisualization();
    updateFilterSummary();
  }
};

/**
 * Update filter summary stats
 */
function updateFilterSummary() {
  const filters = {
    acquisition: getActivePillValues('acquisition-filters'),
    engagement: getActivePillValues('engagement-filters'),
    monetization: getActivePillValues('monetization-filters')
  };

  const tier = document.getElementById('segment-tier-select').value;
  const filteredSegments = window.segmentEngine.filterSegments(filters);
  const tierSegments = filteredSegments.filter(s => s.tier === tier);

  const totalSubs = tierSegments.reduce((sum, s) => sum + parseInt(s.visitor_count || 0), 0);

  const statsElement = document.getElementById('filter-stats');
  if (tierSegments.length === window.segmentEngine.getSegmentsForTier(tier).length) {
    statsElement.textContent = 'All segments';
  } else {
    statsElement.innerHTML = `
      ${tierSegments.length} segments,
      ${totalSubs.toLocaleString()} visitors
    `;
  }
}

/**
 * Export segments to CSV
 */
function exportSegmentsToCSV() {
  const tier = document.getElementById('segment-tier-select').value;
  const segments = window.segmentEngine.getSegmentsForTier(tier);
  const cohort = window.segmentEngine.getActiveCohort();

  const headers = [
    'Composite Key',
    'Acquisition',
    'Engagement',
    'Monetization',
    'Visitors',
    'Return Rate',
    'ARPV',
    'Elasticity'
  ];

  const rows = segments.map(seg => {
    const elasticity = window.segmentEngine.getElasticity(tier, seg.compositeKey, 'engagement');
    return [
      seg.compositeKey,
      seg.acquisition,
      seg.engagement,
      seg.monetization,
      seg.visitor_count,
      seg.avg_return_rate,
      seg.avg_arpv,
      elasticity
    ];
  });

  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `segments-${tier}-${cohort}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export visualization to SVG
 */
function exportVisualizationToSVG(containerId, filename) {
  const container = document.getElementById(containerId);
  const svg = container.querySelector('svg');

  if (!svg) {
    showAlert('No SVG visualization found to export', 'warning');
    return;
  }

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `visualization-${new Date().toISOString().slice(0, 10)}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Initialize export buttons
 */
function initializeExportButtons() {
  document.getElementById('export-segments-csv')?.addEventListener('click', exportSegmentsToCSV);
  document.getElementById('export-viz-svg')?.addEventListener('click', () => {
    const vizType = document.getElementById('segment-viz-select').value;
    let containerId;
    switch(vizType) {
      case '3axis':
        containerId = 'three-axis-radial-viz';
        break;
      case 'scatter':
        containerId = 'segment-scatter-plot';
        break;
      default:
        containerId = 'segment-elasticity-heatmap';
    }
    exportVisualizationToSVG(containerId, `segment-viz-${vizType}.svg`);
  });
}

// Initialize app
async function init() {
  // Add event listeners
  document.getElementById('load-data-btn')?.addEventListener('click', loadData);
  // Old simulate-btn and save-scenario-btn removed - using tabbed interface now
  document.getElementById('save-scenario-btn-models')?.addEventListener('click', saveScenario);
  document.getElementById('compare-btn')?.addEventListener('click', compareScenarios);
  document.getElementById('clear-scenarios-btn')?.addEventListener('click', clearScenarios);

  // Chat event listeners
  document.getElementById('configure-llm')?.addEventListener('click', configureLLM);
  document.getElementById('chat-send-btn')?.addEventListener('click', handleChatSend);
  document.getElementById('chat-reset-btn')?.addEventListener('click', () => {
    clearHistory();
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  });
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSend();
      }
    });
  }

  // Suggested query buttons
  document.querySelectorAll('.suggested-query').forEach(btn => {
    btn.addEventListener('click', () => {
      const query = btn.textContent.trim();
      document.getElementById('chat-input').value = query;
      handleChatSend();
    });
  });

  // Initialize popovers (will be initialized again after data loads)
  initializePopovers();

  // Scenario editor event listeners
  document.getElementById('edit-new-price')?.addEventListener('input', updatePriceChangeIndicator);
  document.getElementById('save-edited-scenario-btn')?.addEventListener('click', saveEditedScenario);

  // Make loadData available globally so it can be called when navigating to step 1
  window.loadAppData = loadData;
  window.dataLoaded = false;

  // Export segmentation functions for step navigation
  window.initializeSegmentationSection = initializeSegmentationSection;
  window.initializeSegmentComparison = initializeSegmentComparison;
}

// Start app
init().catch(error => {
  console.error('Failed to initialize app:', error);
  showAlert('Failed to load application. Please check console for details.', 'danger');
});

/**
 * Populate scenarios into elasticity model tabs
 * Filters scenarios by model_type and displays them in respective tabs
 */
function populateElasticityModelTabs() {
  const scenarios = allScenarios;
  if (!scenarios || scenarios.length === 0) {
    console.error('No scenarios loaded');
    return;
  }

  // Filter scenarios by model type
  const acquisitionScenarios = scenarios.filter(s => s.model_type === 'acquisition');
  const churnScenarios = scenarios.filter(s => s.model_type === 'churn');
  const migrationScenarios = scenarios.filter(s => s.model_type === 'migration');

  console.log(`Populating tabs: Acquisition(${acquisitionScenarios.length}), Churn(${churnScenarios.length}), Migration(${migrationScenarios.length})`);

  // Populate acquisition tab
  const acquisitionContainer = document.getElementById('acquisition-scenarios');
  if (acquisitionContainer) {
    acquisitionContainer.innerHTML = acquisitionScenarios.map(scenario => createScenarioCard(scenario)).join('');
  }

  // Populate churn tab
  const churnContainer = document.getElementById('churn-scenarios');
  if (churnContainer) {
    churnContainer.innerHTML = churnScenarios.map(scenario => createScenarioCard(scenario)).join('');
  }

  // Populate migration tab with custom order
  const migrationContainer = document.getElementById('migration-scenarios');
  if (migrationContainer) {
    // Custom order: Bundle first, iOS second, Basic last
    const migrationOrder = ['scenario_008', 'scenario_010', 'scenario_005'];
    const sortedMigration = migrationScenarios.sort((a, b) => {
      const indexA = migrationOrder.indexOf(a.id);
      const indexB = migrationOrder.indexOf(b.id);
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
    migrationContainer.innerHTML = sortedMigration.map(scenario => createScenarioCard(scenario)).join('');
  }

  // Add click handlers for scenario cards
  document.querySelectorAll('.scenario-card-tab').forEach(card => {
    card.addEventListener('click', function(e) {
      // Don't select if clicking edit button
      if (e.target.closest('.edit-scenario-btn-tab')) return;

      const pane = this.closest('.tab-pane');
      if (pane) {
        pane.querySelectorAll('.scenario-card-tab').forEach(c => c.classList.remove('selected'));
      }
      this.classList.add('selected');

      const scenarioId = this.dataset.scenarioId;
      const selected = scenarios.find(s => s.id === scenarioId);
      if (selected) {
        selectedScenarioByModel[selected.model_type] = selected;
        if (selected.model_type !== activeModelType) {
          setActiveModelType(selected.model_type);
        } else {
          selectedScenario = selected;
        }
        updateSimulateButtonState();
        updateSaveButtonState(); // Update save button state when scenario is selected
        console.log('Selected scenario:', scenarioId);
      }
    });
  });

  // Add click handlers for edit buttons in tabs
  document.querySelectorAll('.edit-scenario-btn-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scenarioId = btn.dataset.scenarioId;
      openScenarioEditor(scenarioId);
    });
  });

  // Add decision engine event listeners
  const objectiveLensSelect = document.getElementById('objective-lens-select');
  if (objectiveLensSelect) {
    objectiveLensSelect.addEventListener('change', (e) => {
      const description = getObjectiveDescription(e.target.value);
      document.getElementById('objective-description').textContent = description;
    });
  }

  const rankScenariosBtn = document.getElementById('rank-scenarios-btn');
  if (rankScenariosBtn) {
    rankScenariosBtn.addEventListener('click', rankAndDisplayScenarios);
  }

  // Export button event listeners
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  const exportXlsxBtn = document.getElementById('export-xlsx-btn');

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
      try {
        exportPdfBtn.disabled = true;
        exportPdfBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating PDF...';

        // Get current top 3 scenarios from the UI
        const top3Container = document.getElementById('top-scenarios-list');
        const currentTop3 = window.currentTop3ScenariosByModel?.[activeModelType] || [];
        if (!top3Container || currentTop3.length === 0) {
          showAlert('Please rank scenarios first to generate a decision pack.', 'warning');
          return;
        }

        const objective = document.getElementById('objective-lens-select').value;

        await exportToPDF(currentTop3, objective, {});

      } catch (error) {
        console.error('Error exporting PDF:', error);
        showAlert('Error generating PDF: ' + error.message, 'danger');
      } finally {
        exportPdfBtn.disabled = false;
        exportPdfBtn.innerHTML = '<i class="bi bi-file-pdf me-2"></i>Export to PDF';
      }
    });
  }

  if (exportXlsxBtn) {
    exportXlsxBtn.addEventListener('click', async () => {
      try {
        exportXlsxBtn.disabled = true;
        exportXlsxBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating Excel...';

        // Export all saved scenarios with top 3 highlighted
        if (!savedScenarios || savedScenarios.length === 0) {
          showAlert('No saved scenarios to export. Please save at least one scenario first.', 'warning');
          return;
        }

        const currentTop3 = window.currentTop3ScenariosByModel?.[activeModelType] || null;
        await exportToXLSX(savedScenarios, currentTop3);

      } catch (error) {
        console.error('Error exporting XLSX:', error);
        showAlert('Error generating Excel file: ' + error.message, 'danger');
      } finally {
        exportXlsxBtn.disabled = false;
        exportXlsxBtn.innerHTML = '<i class="bi bi-file-excel me-2"></i>Export to Excel';
      }
    });
  }

  // Track active model tab for model-scoped state
  document.querySelectorAll('#elasticityTabs .nav-link').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const modelType = getModelTypeFromTabId(e.currentTarget.id);
      setActiveModelType(modelType);
    });
    tab.addEventListener('shown.bs.tab', (e) => {
      const modelType = getModelTypeFromTabId(e.target.id);
      setActiveModelType(modelType);
    });
  });

  // Only auto-detect active tab on first load (when activeModelType is not set)
  // Don't do this on subsequent calls because setActiveModelType is called before populateElasticityModelTabs()
  // Doing auto-detection on every call was causing the active model to be overwritten during step navigation
  // because the tab links weren't being updated, only the tab panes
  if (!activeModelType) {
    const activeTab = document.querySelector('#elasticityTabs .nav-link.active');
    if (activeTab) {
      setActiveModelType(getModelTypeFromTabId(activeTab.id));
    }
  }

  // Add simulate button handler (remove old handler first to prevent duplicates)
  const simulateBtn = document.getElementById('simulate-btn-models');
  if (simulateBtn) {
    // Clone and replace button to remove all event listeners
    const newSimulateBtn = simulateBtn.cloneNode(true);
    simulateBtn.parentNode.replaceChild(newSimulateBtn, simulateBtn);

    newSimulateBtn.addEventListener('click', async function() {
      const activeScenario = selectedScenarioByModel[activeModelType];
      if (!activeScenario) {
        console.warn('⚠️ No scenario selected!');
        return;
      }

      console.log('🎬 Starting simulation for:', activeScenario.id, activeScenario.name);

      const resultContainer = document.getElementById('result-container-models');

      try {
        newSimulateBtn.disabled = true;
        newSimulateBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Simulating...';
        const loadingState = startSimulateLoading();

        console.log('📝 Scenario config:', {
          tier: activeScenario.config.tier,
          current_price: activeScenario.config.current_price,
          new_price: activeScenario.config.new_price,
          price_change: activeScenario.config.new_price - activeScenario.config.current_price,
          price_change_pct: ((activeScenario.config.new_price - activeScenario.config.current_price) / activeScenario.config.current_price * 100).toFixed(2) + '%',
          model_type: activeScenario.model_type
        });

        // Run simulation with Pyodide if available, otherwise fallback to JS
        let result;
        if (isPyodideAvailable()) {
          console.log('✅ Using Pyodide Python models');
          newSimulateBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Running Python models...';
          result = await simulateScenarioWithPyodide(activeScenario, {
            targetSegment: 'all',
            segmentAxis: null
          });
      } else {
        console.log('⚠️ Pyodide not ready, using JavaScript simulation');
        result = await simulateScenario(activeScenario, {
          targetSegment: 'all',
          segmentAxis: null
        });
      }
      result.model_type = activeScenario.model_type;

      // Debug: Verify result has correct model_type before displaying
      console.log(`🎯 Simulation complete for ${activeScenario.model_type}:`, {
        scenario_id: result.scenario_id,
        model_type: result.model_type,
        activeModelType: activeModelType
      });

      await loadingState.done;
      loadingState.stop();

        // Display results in the new containers
        displayResultsInTabs(result);

        resultContainer.style.display = 'block';
        resultContainer.scrollIntoView({ behavior: 'smooth' });

        // Update save button state after successful simulation
        updateSaveButtonState();

      } catch (error) {
        console.error('Error simulating scenario:', error);
        showAlert('Error running simulation: ' + error.message, 'danger');
      } finally {
        newSimulateBtn.disabled = false;
        newSimulateBtn.innerHTML = '<i class="bi bi-play-fill me-2"></i>Simulate Selected Scenario';
        const loadingEl = document.getElementById('simulate-loading');
        if (loadingEl) loadingEl.style.display = 'none';
      }
    });
  }
}

// Expose populateElasticityModelTabs globally for step navigation
window.populateElasticityModelTabs = populateElasticityModelTabs;
window.setActiveModelType = setActiveModelType;
window.hideScenarioResults = hideScenarioResults;
window.getCurrentResultForModel = function(modelType) {
  return currentResultByModel[modelType] || null;
};

/**
 * Create scenario card HTML for tabs
 */
function createScenarioCard(scenario) {
  const priorityBadge = {
    'high': '<span class="badge bg-danger">High</span>',
    'medium': '<span class="badge bg-warning">Medium</span>',
    'low': '<span class="badge bg-secondary">Low</span>',
    'n/a': ''
  }[scenario.priority] || '';

  return `
    <div class="col-md-4">
      <div class="card scenario-card-tab h-100" data-scenario-id="${scenario.id}">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="card-title mb-0 flex-grow-1">${scenario.name}</h6>
            <div class="scenario-card-actions">
              ${priorityBadge}
              <button class="btn btn-sm btn-outline-secondary edit-scenario-btn-tab ms-1" data-scenario-id="${scenario.id}" title="Edit parameters">
                <i class="bi bi-pencil"></i>
              </button>
            </div>
          </div>
          <p class="card-text small text-muted mb-2">${scenario.description}</p>
          <div class="small text-muted">
            <i class="bi bi-lightbulb me-1"></i>
            ${scenario.rationale || scenario.business_rationale || 'No rationale provided'}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Calculate acquisition payback period
 * Payback = Months to recover customer acquisition cost through revenue
 * Formula: CAC / (ARPU - marginal costs)
 */
function calculateAcquisitionPayback(result) {
  try {
    // Estimate visitor acquisition cost based on theme park industry benchmarks ($15-30)
    // For promos, acquisition cost is higher due to discount
    const isPromo = result.scenario_config?.promotional_status === true;
    const baseCAC = 22; // Theme park industry median for marketing cost per new visitor
    const promoCACMultiplier = isPromo ? 1.3 : 1.0;
    const estimatedCAC = baseCAC * promoCACMultiplier;

    // Contribution margin = ARPV - marginal costs (~20% for variable costs at theme parks)
    const arpv = result.forecasted.arpv || result.forecasted.arpu || 0;
    const marginPercent = 0.80; // 80% contribution margin (theme parks have high fixed costs, low variable costs)
    const visitContribution = arpv * marginPercent;

    if (visitContribution <= 0) {
      return { value: 'N/A', label: 'Negative margin' };
    }

    // Calculate how many visits needed to recover acquisition cost
    const visitsToPayback = estimatedCAC / visitContribution;

    // Format output based on visitor frequency (assume avg 4 visits/year for theme parks)
    const avgVisitsPerYear = 4;
    const monthsToPayback = (visitsToPayback / avgVisitsPerYear) * 12;

    if (monthsToPayback > 24) {
      return { value: '>24', label: 'months' };
    } else if (monthsToPayback < 1) {
      return { value: '<1', label: 'month' };
    } else {
      return { value: monthsToPayback.toFixed(1), label: 'months' };
    }
  } catch (error) {
    console.error('Error calculating acquisition payback:', error);
    return { value: 'N/A', label: 'calc error' };
  }
}

/**
 * Calculate churn payback period
 * Churn Payback = Weeks until churn rate stabilizes after price change
 * Based on time-lagged churn model: 0-4, 4-8, 8-12, 12+ weeks
 */
function calculateChurnPayback(result) {
  try {
    // Check if we have time-lagged churn data
    const churnData = result.forecasted.churn_by_weeks || result.churn_by_weeks;

    if (churnData) {
      // Find when churn stabilizes (delta < 10% of peak)
      const weeks_0_4 = churnData.weeks_0_4 || 0;
      const weeks_4_8 = churnData.weeks_4_8 || 0;
      const weeks_8_12 = churnData.weeks_8_12 || 0;
      const weeks_12plus = churnData.weeks_12plus || 0;

      const peak = Math.max(weeks_0_4, weeks_4_8, weeks_8_12, weeks_12plus);
      const threshold = peak * 0.1;

      if (weeks_0_4 <= threshold) return { value: '<4', label: 'weeks' };
      if (weeks_4_8 <= threshold) return { value: '4-8', label: 'weeks' };
      if (weeks_8_12 <= threshold) return { value: '8-12', label: 'weeks' };
      return { value: '12+', label: 'weeks' };
    }

    // Fallback: Estimate based on return rate delta magnitude
    const returnRateDelta = Math.abs(result.delta.return_rate || result.delta.churn_rate || 0);

    if (returnRateDelta < 0.01) {
      // Low impact: stabilizes quickly
      return { value: '<4', label: 'weeks' };
    } else if (returnRateDelta < 0.03) {
      // Medium impact: stabilizes in 4-8 weeks
      return { value: '4-8', label: 'weeks' };
    } else if (returnRateDelta < 0.05) {
      // High impact: stabilizes in 8-12 weeks
      return { value: '8-12', label: 'weeks' };
    } else {
      // Very high impact: takes 12+ weeks
      return { value: '12+', label: 'weeks' };
    }
  } catch (error) {
    console.error('Error calculating churn payback:', error);
    return { value: 'N/A', label: 'calc error' };
  }
}

/**
 * Display simulation results in the tabbed interface
 * @param {Object} result - The simulation result to display
 * @param {boolean} isRedisplay - True if this is re-displaying an existing result (don't re-store it)
 */
function displayResultsInTabs(result, isRedisplay = false) {
  const modelType = resolveModelTypeForResult(result);
  if (!modelType) {
    console.warn('Unable to resolve model type for result; skipping render', result);
    return;
  }

  // Ensure the result object has the correct model_type
  if (!result.model_type) {
    result.model_type = modelType;
  }

  // Verify that the result's model_type matches the resolved modelType
  if (result.model_type !== modelType) {
    console.warn(`⚠️ Result model_type mismatch! result.model_type=${result.model_type}, resolved=${modelType}. Using resolved.`);
    result.model_type = modelType;
  }

  // Only store the result if this is a NEW simulation, not a re-display
  if (!isRedisplay) {
    currentResultByModel[modelType] = result;
    console.log(`💾 Storing result for ${modelType} model:`, result.scenario_id);
  } else {
    console.log(`🔁 Re-displaying existing result for ${modelType} model:`, result.scenario_id);
  }

  // Debug logging
  console.log(`📊 displayResultsInTabs called`, {
    resolvedModelType: modelType,
    activeModelType: activeModelType,
    isRedisplay: isRedisplay,
    willRender: modelType === activeModelType,
    scenario_id: result.scenario_id,
    resultModelType: result.model_type,
    storageState: Object.keys(currentResultByModel).reduce((acc, key) => {
      acc[key] = currentResultByModel[key] ? currentResultByModel[key].scenario_id : null;
      return acc;
    }, {})
  });

  // Only render if this result belongs to the active model
  if (modelType !== activeModelType) {
    console.log(`⏭️ Skipping render: modelType (${modelType}) !== activeModelType (${activeModelType})`);
    return;
  }

  // Clear any prior UI before rendering to avoid bleed-through
  hideScenarioResults();

  currentResult = result;
  console.log(`✅ Rendering results for ${modelType} model, scenario: ${result.scenario_id}`);
  const resultContainer = document.getElementById('result-container-models');
  if (resultContainer) resultContainer.style.display = 'block';

  // Debug logging
  console.log('📊 Displaying results:', {
    scenario: result.scenario_id,
    baseline_revenue: result.baseline.revenue,
    forecasted_revenue: result.forecasted.revenue,
    delta_revenue: result.delta.revenue,
    baseline_subs: result.baseline.visitors,
    forecasted_subs: result.forecasted.activeVisitors || result.forecasted.visitors
  });

  // Store in all simulation results for chatbot access
  if (!allSimulationResultsByModel[modelType].find(r => r.scenario_id === result.scenario_id)) {
    allSimulationResultsByModel[modelType].push(result);
  }

  // Display warning for new tier scenarios
  const warningContainer = document.getElementById('new-tier-warning');
  if (result.is_new_tier && warningContainer) {
    warningContainer.innerHTML = `
      <div class="alert alert-info border-info mb-3">
        <i class="bi bi-info-circle me-2"></i>
        <strong>New Tier Simulation:</strong> This scenario introduces a hypothetical "${result.scenario_config.tier}" tier that doesn't exist in historical data.
        Results use "${result.scenario_config.baseline_tier}" tier as baseline proxy for modeling.
      </div>
    `;
    warningContainer.style.display = 'block';
  } else if (warningContainer) {
    warningContainer.style.display = 'none';
  }

  // Display KPI cards
  const container = document.getElementById('result-cards-models');
  const visitors = result.forecasted.activeVisitors || result.forecasted.visitors;
  const deltaVisitors = result.delta.visitors;
  const deltaVisitorsPct = result.delta.visitors_pct;

  // Calculate Payback Metrics
  const acquisitionPayback = calculateAcquisitionPayback(result);
  const churnPayback = calculateChurnPayback(result);

  console.log(`💳 Rendering KPI cards for ${modelType}:`, {
    scenario_id: result.scenario_id,
    model_type: result.model_type,
    forecasted_revenue: result.forecasted.revenue,
    delta_revenue: result.delta.revenue,
    visitors: visitors,
    container_exists: !!container,
    delta_new_visitors: result.delta?.new_visitors,
    delta_new_visitors_pct: result.delta?.new_visitors_pct,
    forecasted_new_visitors: result.forecasted?.new_visitors
  });

  container.innerHTML = `
    <div class="col-md-3">
      <div class="card">
        <div class="card-body text-center">
          <div class="text-muted small">Visitors</div>
          <div class="h4 mb-1">${formatNumber(visitors)}</div>
          <div class="small ${deltaVisitors >= 0 ? 'text-success' : 'text-danger'}">
            ${deltaVisitors >= 0 ? '+' : ''}${formatNumber(deltaVisitors)}
            (${formatPercent(deltaVisitorsPct, 1)})
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="card">
        <div class="card-body text-center">
          <div class="text-muted small">Revenue (Monthly)</div>
          <div class="h4 mb-1">${formatCurrency(result.forecasted.revenue)}</div>
          <div class="small ${result.delta.revenue >= 0 ? 'text-success' : 'text-danger'}">
            ${result.delta.revenue >= 0 ? '+' : ''}${formatCurrency(result.delta.revenue)}
            (${formatPercent(result.delta.revenue_pct, 1)})
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="card">
        <div class="card-body text-center">
          <div class="text-muted small">ARPV</div>
          <div class="h4 mb-1">${formatCurrency(result.forecasted.arpv || result.forecasted.arpu || 0)}</div>
          <div class="small ${(result.delta.arpv_pct || result.delta.arpu_pct || 0) >= 0 ? 'text-success' : 'text-danger'}">
            ${(result.delta.arpv || result.delta.arpu || 0) >= 0 ? '+' : ''}${formatCurrency(result.delta.arpv || result.delta.arpu || 0)}
            (${formatPercent(result.delta.arpv_pct || result.delta.arpu_pct || 0, 1)})
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="card">
        <div class="card-body text-center">
          <div class="text-muted small">Return Rate</div>
          <div class="h4 mb-1">${formatPercent((result.forecasted.return_rate || result.forecasted.churnRate || result.forecasted.churn_rate || 0), 2)}</div>
          <div class="small ${(result.delta.return_rate || result.delta.churn_rate || 0) >= 0 ? 'text-success' : 'text-danger'}">
            ${(result.delta.return_rate || result.delta.churn_rate || 0) >= 0 ? '+' : ''}${formatPercent(result.delta.return_rate || result.delta.churn_rate || 0, 2)}
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-3">
      <div class="card border-primary">
        <div class="card-body text-center">
          <div class="text-muted small">
            <i class="bi bi-calendar-check me-1"></i>Acquisition Payback
          </div>
          <div class="h4 mb-1 text-primary">${acquisitionPayback.value}</div>
          <div class="small text-muted">${acquisitionPayback.label}</div>
        </div>
      </div>
    </div>
    <div class="col-md-2">
      <div class="card border-info">
        <div class="card-body text-center">
          <div class="text-muted small">
            <i class="bi bi-hourglass-split me-1"></i>Churn Payback
          </div>
          <div class="h4 mb-1 text-info">${churnPayback.value}</div>
          <div class="small text-muted">${churnPayback.label}</div>
        </div>
      </div>
    </div>
  `;

  // Render charts
  renderRevenueChartInTabs(result);
  renderSubscriberChartInTabs(result);

  // Render dynamic cohort tables
  renderAcquisitionCohortTable(result);
  renderChurnHeatmap(result);
  renderMigrationMatrix(result);

  // Show/hide appropriate detail table based on model type
  const acquisitionDetail = document.getElementById('acquisition-results-detail');
  const churnDetail = document.getElementById('churn-results-detail');
  const migrationDetail = document.getElementById('migration-results-detail');

  if (acquisitionDetail) acquisitionDetail.style.display = (modelType === 'acquisition') ? 'block' : 'none';
  if (churnDetail) churnDetail.style.display = (modelType === 'churn') ? 'block' : 'none';
  if (migrationDetail) migrationDetail.style.display = (modelType === 'migration') ? 'block' : 'none';

  console.log(`👁️ Detail sections visibility:`, {
    modelType: modelType,
    acquisition: acquisitionDetail?.style.display,
    churn: churnDetail?.style.display,
    migration: migrationDetail?.style.display
  });
}

/**
 * Render revenue chart in tabs
 */
function renderRevenueChartInTabs(result) {
  const ctx = document.getElementById('revenue-chart-models');

  console.log(`📊 Rendering revenue chart:`, {
    scenario_id: result.scenario_id,
    model_type: result.model_type,
    baseline_revenue: result.baseline.revenue,
    forecasted_revenue: result.forecasted.revenue,
    chart_exists: !!window.revenueChartModels
  });

  if (window.revenueChartModels) {
    window.revenueChartModels.destroy();
  }

  window.revenueChartModels = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Baseline', 'Scenario'],
      datasets: [{
        label: 'Monthly Revenue',
        data: [result.baseline.revenue, result.forecasted.revenue],
        backgroundColor: ['rgba(108, 117, 125, 0.8)', 'rgba(13, 110, 253, 0.8)']
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => formatCurrency(context.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => formatCurrency(value)
          }
        }
      }
    }
  });
}

/**
 * Render visitor chart in tabs
 */
function renderSubscriberChartInTabs(result) {
  const ctx = document.getElementById('visitor-chart-models');

  if (window.visitorChartModels) {
    window.visitorChartModels.destroy();
  }

  window.visitorChartModels = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Baseline', 'Scenario'],
      datasets: [{
        label: 'Visitors',
        data: [
          result.baseline.activeVisitors || result.baseline.visitors,
          result.forecasted.activeVisitors || result.forecasted.visitors
        ],
        backgroundColor: ['rgba(108, 117, 125, 0.8)', 'rgba(13, 110, 253, 0.8)']
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => formatNumber(context.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => formatNumber(value)
          }
        }
      }
    }
  });
}

/**
 * Navigation Functions for Contextual Links
 */

// Navigate to segmentation section and optionally filter by model type
window.navigateToSegments = function(modelType) {
  const segmentSection = document.getElementById('segmentation-section');
  const analyticsSection = document.getElementById('analytics-section');
  const comparisonSection = document.getElementById('segment-analysis-section');

  if (segmentSection) {
    // Show the deep dive sections
    segmentSection.style.display = 'block';
    if (analyticsSection) analyticsSection.style.display = 'block';
    if (comparisonSection) comparisonSection.style.display = 'block';

    // Scroll to segmentation section
    segmentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Optional: Auto-filter segments based on model type
    // This could be enhanced to actually filter the segments
    console.log(`Navigating to segments with focus on: ${modelType}`);
  }
};

// Scroll back to scenario engine
window.scrollToScenarioEngine = function() {
  const scenarioEngine = document.getElementById('elasticity-models-section');
  if (scenarioEngine) {
    scenarioEngine.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// Scroll to scenario engine and switch to specific tab
window.scrollToTab = function(tabName) {
  const scenarioEngine = document.getElementById('elasticity-models-section');
  if (scenarioEngine) {
    scenarioEngine.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Switch to the specified tab after scrolling
    setTimeout(() => {
      const tabButton = document.getElementById(`${tabName}-tab`);
      if (tabButton) {
        tabButton.click();
      }
    }, 500);
  }
};

/**
 * Render Acquisition Cohort Table dynamically
 */
async function renderAcquisitionCohortTable(result) {
  const tableBody = document.querySelector('#acquisition-cohort-table tbody');
  if (!tableBody) return;

  try {
    // Get tier from scenario
    const tier = result.scenario_config?.tier || 'standard_pass';

    // Get cohorts
    const cohorts = await getAcquisitionCohorts(tier);

    if (!cohorts || cohorts.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No cohort data available</td></tr>';
      return;
    }

    // Get Python model predictions if available
    let predictions = [];
    if (isPyodideAvailable() && result.python_models) {
      const scenario = {
        new_price: result.scenario_config.new_price,
        current_price: result.scenario_config.current_price,
        promotion: result.scenario_config.promotion
      };

      predictions = await pyodideBridge.predictAcquisitionBySegment(scenario, cohorts);
    }

    // Render table rows
    tableBody.innerHTML = cohorts.map((cohort, index) => {
      const prediction = predictions[index] || {};
      // Correct elasticity formula: elasticity × price_change
      // -5% price change: elasticity × (-5) = lift
      // +5% price change: elasticity × (+5) = lift
      const addsLiftMinus5 = prediction.lift_at_minus_5pct || (cohort.elasticity * (-5));
      const addsLiftPlus5 = prediction.lift_at_plus_5pct || (cohort.elasticity * 5);
      const confidence = prediction.confidence || 2.5;

      // Badge color based on elasticity
      const elasticityBadge = Math.abs(cohort.elasticity) > 2.5 ? 'bg-danger' :
                              Math.abs(cohort.elasticity) > 1.5 ? 'bg-warning' : 'bg-success';

      return `
        <tr>
          <td><strong>${cohort.name}</strong></td>
          <td>${formatNumber(cohort.size)}</td>
          <td><span class="badge ${elasticityBadge}">${cohort.elasticity.toFixed(2)}</span></td>
          <td class="text-success">${addsLiftMinus5 > 0 ? '+' : ''}${addsLiftMinus5.toFixed(1)}%</td>
          <td class="text-danger">${addsLiftPlus5 > 0 ? '+' : ''}${addsLiftPlus5.toFixed(1)}%</td>
          <td><span class="text-muted">±${confidence.toFixed(1)}%</span></td>
        </tr>
      `;
    }).join('');

    console.log(`✅ Rendered ${cohorts.length} acquisition cohorts`);
  } catch (error) {
    console.error('Error rendering acquisition cohort table:', error);
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading cohort data</td></tr>';
  }
}

/**
 * Render Churn Heatmap dynamically
 */
async function renderChurnHeatmap(result) {
  const tableBody = document.querySelector('#churn-heatmap-table tbody');
  if (!tableBody) return;

  try {
    const tier = result.scenario_config?.tier || 'standard_pass';
    const cohorts = await getChurnCohorts(tier);

    if (!cohorts || cohorts.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No cohort data available</td></tr>';
      return;
    }

    // Get Python model predictions by time horizon
    let predictions = [];
    if (isPyodideAvailable() && result.python_models) {
      const scenario = {
        new_price: result.scenario_config.new_price,
        current_price: result.scenario_config.current_price,
        price_change_pct: ((result.scenario_config.new_price - result.scenario_config.current_price) / result.scenario_config.current_price) * 100,
        baseline_churn: result.baseline.churnRate || 0.05,
        promotion: result.scenario_config.promotion
      };

      predictions = await pyodideBridge.predictChurnBySegment(scenario, cohorts);
    }

    // Render heatmap rows
    tableBody.innerHTML = cohorts.map((cohort, index) => {
      const prediction = predictions[index] || {};

      // Extract churn uplift by horizon (in percentage points)
      const churn_0_4 = prediction.churn_0_4_weeks || (cohort.elasticity * 0.015 * 100);
      const churn_4_8 = prediction.churn_4_8_weeks || (cohort.elasticity * 0.035 * 100);
      const churn_8_12 = prediction.churn_8_12_weeks || (cohort.elasticity * 0.045 * 100);
      const churn_12plus = prediction.churn_12plus_weeks || (cohort.elasticity * 0.020 * 100);

      // Simple color coding - green for decreases (good), red for increases (bad)
      const getColorClass = (value) => {
        if (value < 0) return 'text-success';  // Negative = churn decrease = GOOD
        if (value > 0) return 'text-danger';   // Positive = churn increase = BAD
        return 'text-muted';                    // Zero = no change
      };

      const formatChurn = (val) => `${val > 0 ? '+' : ''}${val.toFixed(1)} pp`;

      return `
        <tr>
          <td><strong>${cohort.name}</strong></td>
          <td class="${getColorClass(churn_0_4)}">${formatChurn(churn_0_4)}</td>
          <td class="${getColorClass(churn_4_8)}">${formatChurn(churn_4_8)}</td>
          <td class="${getColorClass(churn_8_12)}">${formatChurn(churn_8_12)}</td>
          <td class="${getColorClass(churn_12plus)}">${formatChurn(churn_12plus)}</td>
        </tr>
      `;
    }).join('');

    console.log(`✅ Rendered ${cohorts.length} churn cohorts`);
  } catch (error) {
    console.error('Error rendering churn heatmap:', error);
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error loading cohort data</td></tr>';
  }
}

/**
 * Render Migration Matrix dynamically
 */
async function renderMigrationMatrix(result) {
  const tableBody = document.querySelector('#migration-matrix-table tbody');
  const tableCard = tableBody?.closest('.card');
  const tableHeader = document.querySelector('#migration-matrix-table thead');
  const detailSection = document.getElementById('migration-results-detail');

  if (!tableBody) return;

  // Show the card
  if (tableCard) {
    tableCard.style.display = 'block';
  }
  if (detailSection) {
    detailSection.style.display = 'block';
  }

  try {
    if (result?.migration_matrix?.tiers?.length) {
      renderTierMigrationMatrix(tableHeader, tableBody, result.migration_matrix);
      return;
    }

    // Use Python model migration predictions
    if (!result.python_models || !result.python_models.migration) {
      console.log('⚠️ No migration predictions available');
      tableHeader.innerHTML = `
        <tr>
          <th>Tier Transition Matrix (Δ vs baseline)</th>
        </tr>
      `;
      tableBody.innerHTML = `
        <tr>
          <td class="text-muted">Migration model not available yet. Run Step 8 after Python models finish loading.</td>
        </tr>
      `;
      return;
    }

    const migration = result.python_models.migration;
    const tierConfig = migration.tier_config || '2-tier';

    console.log('📊 Rendering migration matrix - Tier config:', tierConfig);

    // Render based on tier configuration
    if (tierConfig === '3-tier-bundle') {
      renderBundleMigrationMatrix(tableHeader, tableBody, migration);
    } else if (tierConfig === '3-tier-basic') {
      renderBasicMigrationMatrix(tableHeader, tableBody, migration);
    } else {
      render2TierMigrationMatrix(tableHeader, tableBody, migration);
    }

    console.log(`✅ Rendered migration matrix (${tierConfig})`);
  } catch (error) {
    console.error('Error rendering migration matrix:', error);
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error loading migration data</td></tr>';
  }
}

function getTierLabel(tier) {
  const labels = {
    economy_pass: 'Economy Pass',
    standard_pass: 'Standard Pass',
    premium_pass: 'Premium Pass',
    vip_pass: 'VIP Pass',
    bundle: 'Bundle Pass',
    ad_supported: 'Ad-Lite',
    ad_free: 'Ad-Free'
  };
  if (labels[tier]) return labels[tier];
  return tier.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderTierMigrationMatrix(tableHeader, tableBody, migrationMatrix) {
  const tiers = migrationMatrix.tiers || [];
  const flows = migrationMatrix.flows || {};

  tableHeader.innerHTML = `
    <tr>
      <th>Current Tier</th>
      ${tiers.map(tier => `<th>→ ${getTierLabel(tier)}</th>`).join('')}
      <th>Cancel</th>
      <th>Net Change</th>
    </tr>
  `;

  const formatPct = (value) => {
    if (!value || Math.abs(value) < 0.0001) return '—';
    const pct = (value * 100);
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const classFor = (value, isCancel = false) => {
    if (!value || Math.abs(value) < 0.0001) return 'text-muted';
    if (isCancel) return 'text-danger';
    return value >= 0 ? 'text-success' : 'text-danger';
  };

  tableBody.innerHTML = tiers.map(fromTier => {
    const rowFlows = flows[fromTier] || {};
    const outflow = tiers.reduce((sum, toTier) => {
      if (toTier === fromTier) return sum;
      return sum + (rowFlows[toTier] || 0);
    }, 0);
    const cancel = rowFlows.cancel || 0;
    const inflow = tiers.reduce((sum, otherTier) => {
      if (otherTier === fromTier) return sum;
      return sum + ((flows[otherTier] || {})[fromTier] || 0);
    }, 0);
    const net = inflow - outflow - cancel;

    return `
      <tr>
        <td><strong>${getTierLabel(fromTier)}</strong></td>
        ${tiers.map(toTier => {
          if (toTier === fromTier) {
            return '<td class="text-muted">—</td>';
          }
          const value = rowFlows[toTier] || 0;
          return `<td class="${classFor(value)}">${formatPct(value)}</td>`;
        }).join('')}
        <td class="${classFor(cancel, true)}">${formatPct(cancel)}</td>
        <td class="${classFor(net)}"><strong>${formatPct(net)}</strong></td>
      </tr>
    `;
  }).join('');
}

/**
 * Render 2-tier migration matrix (original)
 */
function render2TierMigrationMatrix(tableHeader, tableBody, migration) {
  // Simple single-row header
  tableHeader.innerHTML = `
    <tr>
      <th>Current Tier</th>
      <th>→ Ad-Free</th>
      <th>→ Ad-Supp</th>
      <th>Cancel</th>
      <th>Net Change</th>
    </tr>
  `;

  // Ad-Lite row
  const adSuppUpgrade = (migration.from_ad_supported?.to_ad_free || 0) * 100;
  const adSuppCancel = (migration.from_ad_supported?.cancel || 0) * 100;
  const adSuppNetMix = adSuppUpgrade - adSuppCancel;

  // Ad-Free row
  const adFreeDowngrade = (migration.from_ad_free?.to_ad_supported || 0) * 100;
  const adFreeCancel = (migration.from_ad_free?.cancel || 0) * 100;
  const adFreeNetMix = -adFreeDowngrade - adFreeCancel;

  tableBody.innerHTML = `
    <tr>
      <td><strong>Ad-Lite</strong></td>
      <td class="text-success">${adSuppUpgrade > 0 ? '+' : ''}${adSuppUpgrade.toFixed(1)}%</td>
      <td class="text-muted">—</td>
      <td class="text-danger">${adSuppCancel > 0 ? '+' : ''}${adSuppCancel.toFixed(1)}%</td>
      <td class="${adSuppNetMix >= 0 ? 'text-success' : 'text-danger'}"><strong>${adSuppNetMix > 0 ? '+' : ''}${adSuppNetMix.toFixed(1)}%</strong></td>
    </tr>
    <tr>
      <td><strong>Ad-Free</strong></td>
      <td class="text-muted">—</td>
      <td class="text-warning">${adFreeDowngrade > 0 ? '+' : ''}${adFreeDowngrade.toFixed(1)}%</td>
      <td class="text-danger">${adFreeCancel > 0 ? '+' : ''}${adFreeCancel.toFixed(1)}%</td>
      <td class="${adFreeNetMix >= 0 ? 'text-success' : 'text-danger'}"><strong>${adFreeNetMix > 0 ? '+' : ''}${adFreeNetMix.toFixed(1)}%</strong></td>
    </tr>
  `;
}

/**
 * Render 3-tier Bundle migration matrix
 */
function renderBundleMigrationMatrix(tableHeader, tableBody, migration) {
  // Simple single-row header
  tableHeader.innerHTML = `
    <tr>
      <th>Current Tier</th>
      <th>→ Ad-Free</th>
      <th>→ Bundle</th>
      <th>→ Ad-Supp</th>
      <th>Cancel</th>
      <th>Net Change</th>
    </tr>
  `;

  // FROM Ad-Lite
  const as_to_af = (migration.from_ad_supported?.to_ad_free || 0) * 100;
  const as_to_bundle = (migration.from_ad_supported?.to_bundle || 0) * 100;
  const as_cancel = (migration.from_ad_supported?.cancel || 0) * 100;
  const as_net = as_to_af + as_to_bundle - as_cancel;

  // FROM AD-FREE
  const af_to_bundle = (migration.from_ad_free?.to_bundle || 0) * 100;
  const af_to_as = (migration.from_ad_free?.to_ad_supported || 0) * 100;
  const af_cancel = (migration.from_ad_free?.cancel || 0) * 100;
  const af_net = af_to_bundle - af_to_as - af_cancel;

  // FROM BUNDLE
  const bundle_to_af = (migration.from_bundle?.to_ad_free || 0) * 100;
  const bundle_to_as = (migration.from_bundle?.to_ad_supported || 0) * 100;
  const bundle_cancel = (migration.from_bundle?.cancel || 0) * 100;
  const bundle_net = -bundle_to_af - bundle_to_as - bundle_cancel;

  tableBody.innerHTML = `
    <tr>
      <td><strong>Ad-Lite</strong></td>
      <td class="text-success">${as_to_af > 0 ? '+' : ''}${as_to_af.toFixed(1)}%</td>
      <td class="text-primary">${as_to_bundle > 0 ? '+' : ''}${as_to_bundle.toFixed(1)}%</td>
      <td class="text-muted">—</td>
      <td class="text-danger">${as_cancel > 0 ? '+' : ''}${as_cancel.toFixed(1)}%</td>
      <td class="${as_net >= 0 ? 'text-success' : 'text-danger'}"><strong>${as_net > 0 ? '+' : ''}${as_net.toFixed(1)}%</strong></td>
    </tr>
    <tr>
      <td><strong>Ad-Free</strong></td>
      <td class="text-muted">—</td>
      <td class="text-primary">${af_to_bundle > 0 ? '+' : ''}${af_to_bundle.toFixed(1)}%</td>
      <td class="text-warning">${af_to_as > 0 ? '+' : ''}${af_to_as.toFixed(1)}%</td>
      <td class="text-danger">${af_cancel > 0 ? '+' : ''}${af_cancel.toFixed(1)}%</td>
      <td class="${af_net >= 0 ? 'text-success' : 'text-danger'}"><strong>${af_net > 0 ? '+' : ''}${af_net.toFixed(1)}%</strong></td>
    </tr>
    <tr>
      <td><strong>Bundle</strong></td>
      <td class="text-warning">${bundle_to_af > 0 ? '+' : ''}${bundle_to_af.toFixed(1)}%</td>
      <td class="text-muted">—</td>
      <td class="text-warning">${bundle_to_as > 0 ? '+' : ''}${bundle_to_as.toFixed(1)}%</td>
      <td class="text-danger">${bundle_cancel > 0 ? '+' : ''}${bundle_cancel.toFixed(1)}%</td>
      <td class="${bundle_net >= 0 ? 'text-success' : 'text-danger'}"><strong>${bundle_net > 0 ? '+' : ''}${bundle_net.toFixed(1)}%</strong></td>
    </tr>
  `;
}

/**
 * Render 3-tier Basic migration matrix
 */
function renderBasicMigrationMatrix(tableHeader, tableBody, migration) {
  // Simple single-row header
  tableHeader.innerHTML = `
    <tr>
      <th>Current Tier</th>
      <th>→ Ad-Supp</th>
      <th>→ Ad-Free</th>
      <th>→ Basic</th>
      <th>Cancel</th>
      <th>Net Change</th>
    </tr>
  `;

  // FROM BASIC
  const basic_to_as = (migration.from_basic?.to_ad_supported || 0) * 100;
  const basic_to_af = (migration.from_basic?.to_ad_free || 0) * 100;
  const basic_cancel = (migration.from_basic?.cancel || 0) * 100;
  const basic_net = basic_to_as + basic_to_af - basic_cancel;

  // FROM Ad-Lite
  const as_to_af = (migration.from_ad_supported?.to_ad_free || 0) * 100;
  const as_to_basic = (migration.from_ad_supported?.to_basic || 0) * 100;
  const as_cancel = (migration.from_ad_supported?.cancel || 0) * 100;
  const as_net = as_to_af - as_to_basic - as_cancel;

  // FROM AD-FREE
  const af_to_as = (migration.from_ad_free?.to_ad_supported || 0) * 100;
  const af_to_basic = (migration.from_ad_free?.to_basic || 0) * 100;
  const af_cancel = (migration.from_ad_free?.cancel || 0) * 100;
  const af_net = -af_to_as - af_to_basic - af_cancel;

  tableBody.innerHTML = `
    <tr>
      <td><strong>Basic</strong></td>
      <td class="text-success">${basic_to_as > 0 ? '+' : ''}${basic_to_as.toFixed(1)}%</td>
      <td class="text-primary">${basic_to_af > 0 ? '+' : ''}${basic_to_af.toFixed(1)}%</td>
      <td class="text-muted">—</td>
      <td class="text-danger">${basic_cancel > 0 ? '+' : ''}${basic_cancel.toFixed(1)}%</td>
      <td class="${basic_net >= 0 ? 'text-success' : 'text-danger'}"><strong>${basic_net > 0 ? '+' : ''}${basic_net.toFixed(1)}%</strong></td>
    </tr>
    <tr>
      <td><strong>Ad-Lite</strong></td>
      <td class="text-muted">—</td>
      <td class="text-success">${as_to_af > 0 ? '+' : ''}${as_to_af.toFixed(1)}%</td>
      <td class="text-warning">${as_to_basic > 0 ? '+' : ''}${as_to_basic.toFixed(1)}%</td>
      <td class="text-danger">${as_cancel > 0 ? '+' : ''}${as_cancel.toFixed(1)}%</td>
      <td class="${as_net >= 0 ? 'text-success' : 'text-danger'}"><strong>${as_net > 0 ? '+' : ''}${as_net.toFixed(1)}%</strong></td>
    </tr>
    <tr>
      <td><strong>Ad-Free</strong></td>
      <td class="text-warning">${af_to_as > 0 ? '+' : ''}${af_to_as.toFixed(1)}%</td>
      <td class="text-muted">—</td>
      <td class="text-warning">${af_to_basic > 0 ? '+' : ''}${af_to_basic.toFixed(1)}%</td>
      <td class="text-danger">${af_cancel > 0 ? '+' : ''}${af_cancel.toFixed(1)}%</td>
      <td class="${af_net >= 0 ? 'text-success' : 'text-danger'}"><strong>${af_net > 0 ? '+' : ''}${af_net.toFixed(1)}%</strong></td>
    </tr>
  `;
}

/**
 * Rank and display scenarios using decision engine
 */
async function rankAndDisplayScenarios() {
  if (savedScenarios.length === 0) {
    showAlert('No saved scenarios to rank. Please simulate and save scenarios first.', 'warning');
    return;
  }

  try {
    // Get selected objective and constraints
    const objective = document.getElementById('objective-lens-select').value;

    // DEBUG: Log saved scenarios before ranking
    console.log('🔍 Ranking scenarios - Input data:', {
      count: savedScenarios.length,
      objective: objective,
      scenarios: savedScenarios.map(s => ({
        name: s.scenario_name,
        id: s.scenario_id,
        revenue_pct: s.delta?.revenue_pct,
        visitors_pct: s.delta?.visitors_pct,
        churn_rate: s.delta?.churn_rate,
        premium_share: s.forecasted?.premium_share
      }))
    });

    // Rank scenarios
    const rankedScenarios = rankScenarios(savedScenarios, objective, {});

    // DEBUG: Log ranked results
    console.log('🏆 Ranked scenarios output:', {
      count: rankedScenarios.length,
      results: rankedScenarios.map(s => ({
        rank: s.rank,
        name: s.scenario_name,
        score: s.decision_score,
        revenue_pct: s.delta?.revenue_pct,
        visitors_pct: s.delta?.visitors_pct,
        risk: s.risk_level
      }))
    });

    if (rankedScenarios.length === 0) {
      showAlert('No scenarios available to rank. Try saving more scenarios.', 'warning');
      return;
    }

    // Display top 3
    displayTop3Scenarios(rankedScenarios);

  } catch (error) {
    console.error('Error ranking scenarios:', error);
    showAlert('Error ranking scenarios. See console for details.', 'danger');
  }
}

/**
 * Display top 3 ranked scenarios
 */
function displayTop3Scenarios(top3) {
  const container = document.getElementById('top-scenarios-container');
  const list = document.getElementById('top-scenarios-list');

  if (!container || !list) return;

  if (!window.currentTop3ScenariosByModel) {
    window.currentTop3ScenariosByModel = {};
  }
  window.currentTop3ScenariosByModel[activeModelType] = top3;

  let html = '';
  top3.forEach((scenario, index) => {
    const rankBadge = index === 0 ? 'bg-warning' : index === 1 ? 'bg-secondary' : 'bg-info';
    const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
    const riskBadge = scenario.risk_level === 'Low' ? 'bg-success' :
                      scenario.risk_level === 'Med' ? 'bg-warning' :
                      'bg-danger';

    html += `
      <div class="col-md-4">
        <div class="card h-100 ${index === 0 ? 'border-warning border-2' : ''}">
          <div class="card-header ${index === 0 ? 'bg-warning-subtle' : ''}">
            <div class="d-flex justify-content-between align-items-center">
              <span class="badge ${rankBadge}">${rankIcon} Rank #${scenario.rank}</span>
              <span class="badge ${riskBadge}">${scenario.risk_level} Risk</span>
            </div>
          </div>
          <div class="card-body">
            <h6 class="card-title">${scenario.scenario_name || scenario.id}</h6>
            <p class="card-text small text-muted mb-2">
              ${scenario.description || ''}
            </p>

            <!-- KPIs -->
            <div class="mb-2">
              <div class="row g-1 small">
                <div class="col-6">
                  <strong>Revenue:</strong>
                  <span class="${(scenario.delta.revenue_pct || 0) >= 0 ? 'text-success' : 'text-danger'}">
                    ${(scenario.delta.revenue_pct || 0) >= 0 ? '+' : ''}${(scenario.delta.revenue_pct || 0).toFixed(1)}%
                  </span>
                </div>
                <div class="col-6">
                  <strong>Visitors:</strong>
                  <span class="${(scenario.delta.visitors_pct || 0) >= 0 ? 'text-success' : 'text-danger'}">
                    ${(scenario.delta.visitors_pct || 0) >= 0 ? '+' : ''}${(scenario.delta.visitors_pct || 0).toFixed(1)}%
                  </span>
                </div>
                <div class="col-6">
                  <strong>Non-Return:</strong>
                  <span class="${(scenario.delta.churn_rate || 0) <= 0 ? 'text-success' : 'text-danger'}">
                    ${(scenario.delta.churn_rate || 0) >= 0 ? '+' : ''}${((scenario.delta.churn_rate || 0) * 100).toFixed(2)}pp
                  </span>
                </div>
                <div class="col-6">
                  <strong>Score:</strong>
                  <span class="text-primary fw-bold">${(scenario.decision_score || 0).toFixed(1)}</span>
                </div>
              </div>
            </div>

            <!-- Rationale -->
            <div class="alert alert-light mb-0 small">
              <strong>Why it wins:</strong><br>
              ${scenario.rationale}
            </div>
          </div>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
  container.style.display = 'block';

  // Enable export buttons
  const exportPdfBtn = document.getElementById('export-pdf-btn');
  const exportXlsxBtn = document.getElementById('export-xlsx-btn');
  if (exportPdfBtn) exportPdfBtn.disabled = false;
  if (exportXlsxBtn) exportXlsxBtn.disabled = false;

  // Scroll to results
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
