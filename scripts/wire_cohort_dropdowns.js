/**
 * Wire Cohort Dropdowns to Charts
 * This script adds event listeners to cohort dropdowns and updates charts with cohort-specific data
 *
 * Add this to the end of acquisition-simple.js, churn-simple.js, and migration-simple.js
 */

// ============================================================================
// FOR ACQUISITION-SIMPLE.JS
// ============================================================================

// Add after loadAcquisitionParams() function:
let cohortData = null;

async function loadCohortData() {
  try {
    const response = await fetch('data/cohort_coefficients.json');
    cohortData = await response.json();
    console.log('✓ Loaded cohort data:', Object.keys(cohortData).filter(k => k !== 'metadata'));
    return cohortData;
  } catch (error) {
    console.error('Error loading cohort data:', error);
    return null;
  }
}

// Modify setupAcquisitionInteractivity() to add cohort listener:
function setupAcquisitionInteractivity() {
  const tierSelect = document.getElementById('acq-tier-select');
  const priceSlider = document.getElementById('acq-price-slider');
  const ciToggle = document.getElementById('acq-show-ci');
  const cohortSelect = document.getElementById('acq-cohort-select'); // NEW!

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

  // Cohort selection change (NEW!)
  if (cohortSelect && cohortData) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Switching to cohort:', selectedCohort);

      // Update elasticity from cohort data
      if (cohortData[selectedCohort]) {
        const cohort = cohortData[selectedCohort];
        const tierSelect = document.getElementById('acq-tier-select');
        const tier = tierSelect.value;

        // Override acquisition elasticity with cohort-specific value
        if (acquisitionParams[tier]) {
          acquisitionParams[tier].base_elasticity = cohort.acquisition_elasticity;
          console.log(`  Elasticity: ${cohort.acquisition_elasticity.toFixed(2)}`);
        }
      }

      updateAcquisitionModel();
    });
  }
}

// Add to initAcquisitionSimple() at the end:
await loadCohortData();

// ============================================================================
// FOR CHURN-SIMPLE.JS
// ============================================================================

// Modify loadChurnParams() to load cohort data too:
let cohortData = null;

async function loadCohortData() {
  try {
    const response = await fetch('data/cohort_coefficients.json');
    cohortData = await response.json();
    return cohortData;
  } catch (error) {
    console.error('Error loading cohort data:', error);
    return null;
  }
}

// Add after setupChurnInteractivity():
function setupCohortListener() {
  const cohortSelect = document.getElementById('churn-cohort-select');

  if (cohortSelect && cohortData) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Switching to churn cohort:', selectedCohort);

      if (cohortData[selectedCohort]) {
        const cohort = cohortData[selectedCohort];

        // Update time-lag distribution
        if (cohort.time_lag_distribution) {
          const dist = cohort.time_lag_distribution;
          churnTimeLag = {
            '0_4_weeks': dist['0_4_weeks'] || 0.15,
            '4_8_weeks': dist['4_8_weeks'] || 0.25,
            '8_12_weeks': dist['8_12_weeks'] || 0.30,
            '12_plus': (dist['12_16_weeks'] || 0.20) + (dist['16_20_weeks'] || 0.10)
          };
          console.log(`  Time-lag: [${Object.values(dist).map(v => (v*100).toFixed(0)+'%').join(', ')}]`);
        }

        // Update churn elasticity
        Object.keys(churnParams).forEach(tier => {
          churnParams[tier].churn_elasticity = cohort.churn_elasticity;
        });

        console.log(`  Churn elasticity: ${cohort.churn_elasticity.toFixed(2)}`);
      }

      // Force update with current price
      updateChurnModel();
    });
  }
}

// Add to initChurnSimple() at the end:
await loadCohortData();
setupCohortListener();

// ============================================================================
// FOR MIGRATION-SIMPLE.JS
// ============================================================================

// Add cohort data loading:
let cohortData = null;

async function loadCohortData() {
  try {
    const response = await fetch('data/cohort_coefficients.json');
    cohortData = await response.json();
    return cohortData;
  } catch (error) {
    console.error('Error loading cohort data:', error);
    return null;
  }
}

// Modify setupMigrationInteractivity():
function setupMigrationInteractivity() {
  const adliteSlider = document.getElementById('mig-adlite-slider');
  const adfreeSlider = document.getElementById('mig-adfree-slider');
  const cohortSelect = document.getElementById('mig-cohort-select'); // NEW!

  if (!adliteSlider || !adfreeSlider) {
    console.warn('Migration controls not found');
    return;
  }

  // Slider inputs
  adliteSlider.addEventListener('input', updateMigrationModel);
  adfreeSlider.addEventListener('input', updateMigrationModel);

  // Cohort selection change (NEW!)
  if (cohortSelect && cohortData) {
    cohortSelect.addEventListener('change', () => {
      const selectedCohort = cohortSelect.value;
      console.log('🔄 Switching to migration cohort:', selectedCohort);

      if (cohortData[selectedCohort]) {
        const cohort = cohortData[selectedCohort];

        // Update baseline migration rates from cohort
        if (cohort.migration_upgrade !== undefined) {
          migrationParams.baselineUpgrade = cohort.migration_upgrade * 3; // Scale to percentage
          console.log(`  Upgrade willingness: ${migrationParams.baselineUpgrade.toFixed(1)}%`);
        }
        if (cohort.migration_downgrade !== undefined) {
          migrationParams.baselineDowngrade = cohort.migration_downgrade * 2; // Scale to percentage
          console.log(`  Downgrade propensity: ${migrationParams.baselineDowngrade.toFixed(1)}%`);
        }
      }

      updateMigrationModel();
    });
  }
}

// Add to initMigrationSimple() at the end:
await loadCohortData();
