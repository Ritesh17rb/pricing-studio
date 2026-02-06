/**
 * Step Navigation System
 * Manages the step-by-step navigation flow for the Price Elasticity Studio
 * Now with 10 steps (0-9) for better progressive disclosure
 */

const TOTAL_STEPS = 10; // 0-9
let currentStep = 0;

// Track which steps have been initialized to prevent duplicate calls
const stepInitialized = {
  0: true,  // Hero always ready
  1: false, // Dashboard (initialized after data load)
  2: false, // Data Explorer
  3: false, // Event Calendar
  4: false, // Segmentation
  5: false, // Segment Comparison
  6: false, // Acquisition
  7: false, // Churn
  8: false, // Migration
  9: false  // Chat
};

const stepSectionMap = {
  0: 'section-0',
  1: 'section-1',
  2: 'section-2',
  3: 'section-8',
  4: 'section-6',
  5: 'section-7',
  6: 'section-3',
  7: 'section-4',
  8: 'section-5',
  9: 'section-9'
};

/**
 * Navigate to a specific step
 * @param {number} step - Step number (0-9)
 */
function goToStep(step) {
  if (step < 0 || step >= TOTAL_STEPS) return;

  // Hide all section wrappers
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  // Show the target section wrapper
  const sectionId = stepSectionMap[step];
  const section = sectionId ? document.getElementById(sectionId) : null;
  if (section) {
    section.classList.add('active');
  }

  // Update step indicators
  document.querySelectorAll('.step-dot').forEach(dot => {
    const dotStep = parseInt(dot.dataset.step, 10);
    dot.classList.remove('active', 'completed');
    if (!Number.isNaN(dotStep) && dotStep < step) {
      dot.classList.add('completed');
    } else if (dotStep === step) {
      dot.classList.add('active');
    }
  });

  currentStep = step;

  // Show/hide appropriate original content sections
  showStepContent(step);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Show content for the current step
 * @param {number} step - Step number
 */
function showStepContent(step) {
  // Hide all original content sections
  const allSections = [
    'load-data-section',
    'kpi-section',
    'elasticity-models-section',
    'comparison-section',
    'analytics-section',
    'segmentation-section',
    'segment-analysis-section',
    'event-calendar-section',
    'data-viewer-section',
    'chat-section'
  ];

  allSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      // Remove hide-tabs class when hiding elasticity section
      if (id === 'elasticity-models-section') {
        el.classList.remove('hide-elasticity-tabs');
      }
    }
  });

  // Show sections based on current step
  switch(step) {
    case 0:
      // Hero - no additional content
      break;
    case 1:
      // Dashboard - load-data-section and kpi-section are now INSIDE section-1
      // Trigger data loading if not already loaded
      if (window.loadAppData && !window.dataLoaded) {
        window.dataLoaded = true; // Set immediately to prevent multiple calls

        // IMPORTANT: Wait for section animation to complete and ensure loading UI is visible
        setTimeout(() => {
          // Make sure loading section is visible
          const loadSection = document.getElementById('load-data-section');
          const loadingProgress = document.getElementById('loading-progress');
          if (loadSection) {
            loadSection.style.display = 'block';
            loadSection.style.visibility = 'visible';
            loadSection.style.opacity = '1';
          }
          if (loadingProgress) {
            loadingProgress.style.display = 'block';
            loadingProgress.style.visibility = 'visible';
          }

          // Start loading data
          window.loadAppData().catch(error => {
            console.error('Failed to load data:', error);
            window.dataLoaded = false; // Reset on error
            // Show error message to user
            if (loadSection) {
              loadSection.innerHTML = `
                <div class="glass-card">
                  <div class="alert alert-danger mb-0">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    <strong>Failed to load data.</strong> ${error.message}
                    <button class="btn btn-sm btn-outline-danger ms-3" onclick="location.reload()">Retry</button>
                  </div>
                </div>
              `;
            }
          });
        }, 100); // Small delay to ensure DOM is ready after section animation starts
      }
      break;
    case 2:
      // Data Explorer - Show data viewer
      const dataViewerSection = document.getElementById('data-viewer-section');
      const dataViewerContentArea = document.getElementById('step-2-data-viewer-container-content');
      if (dataViewerSection && dataViewerContentArea) {
        dataViewerSection.style.display = 'block';
        // Move data viewer into step 2 content area if not already there
        if (dataViewerSection.parentElement !== dataViewerContentArea) {
          dataViewerContentArea.appendChild(dataViewerSection);
        }
      }
      break;
    case 3:
      // Event Calendar
      const eventCalendarSection = document.getElementById('event-calendar-section');
      const calendarContentArea = document.getElementById('step-8-calendar-container');
      if (eventCalendarSection && calendarContentArea) {
        eventCalendarSection.style.display = 'block';
        if (eventCalendarSection.parentElement !== calendarContentArea) {
          calendarContentArea.appendChild(eventCalendarSection);
        }
      }
      break;
    case 4:
      // Customer Cohorts & Elasticity (segmentation only)
      const segmentationSection6 = document.getElementById('segmentation-section');
      const segmentContentArea6 = document.getElementById('step-6-segmentation-container');
      if (segmentationSection6 && segmentContentArea6) {
        segmentationSection6.style.display = 'block';
        if (segmentationSection6.parentElement !== segmentContentArea6) {
          segmentContentArea6.appendChild(segmentationSection6);
        }

        // CRITICAL FIX: Initialize segmentation on navigation (only once)
        if (!stepInitialized[4] && window.initializeSegmentationSection && typeof window.initializeSegmentationSection === 'function') {
          if (window.dataLoaded && window.segmentEngine) {
            setTimeout(() => {
              try {
                window.initializeSegmentationSection();
                stepInitialized[4] = true; // Mark as initialized
              } catch (error) {
                console.error('Failed to initialize segmentation:', error);
                showStepError(segmentContentArea6, 'Failed to load visitor cohort data. Please refresh the page.');
              }
            }, 100);
          } else {
            showStepError(segmentContentArea6, 'Data is still loading. Please wait for Step 1 to complete, then try again.');
          }
        }
      }
      break;
    case 5:
      // Segment Elasticity Comparison (analysis only)
      const segmentAnalysisSection7 = document.getElementById('segment-analysis-section');
      const analysisContentArea7 = document.getElementById('step-7-analysis-container');
      if (segmentAnalysisSection7 && analysisContentArea7) {
        segmentAnalysisSection7.style.display = 'block';
        if (segmentAnalysisSection7.parentElement !== analysisContentArea7) {
          analysisContentArea7.appendChild(segmentAnalysisSection7);
        }

        // CRITICAL FIX: Initialize segment comparison on navigation (only once)
        if (!stepInitialized[5] && window.initializeSegmentComparison && typeof window.initializeSegmentComparison === 'function') {
          if (window.dataLoaded && window.segmentEngine) {
            setTimeout(() => {
              try {
                window.initializeSegmentComparison();
                stepInitialized[5] = true; // Mark as initialized
              } catch (error) {
                console.error('Failed to initialize segment comparison:', error);
                showStepError(analysisContentArea7, 'Failed to load segment comparison data. Please refresh the page.');
              }
            }, 100);
          } else {
            showStepError(analysisContentArea7, 'Data is still loading. Please wait for Step 1 to complete, then try again.');
          }
        }
      }
      break;
    case 6:
      // Acquisition Elasticity - Show elasticity models, force Acquisition tab, hide tabs
      showElasticityModel('acquisition', 'step-3-acquisition-container');
      // Initialize simplified acquisition model
      if (window.initAcquisitionSimple && typeof window.initAcquisitionSimple === 'function') {
        if (window.dataLoaded) {
          // Small delay to ensure DOM is ready
          setTimeout(() => window.initAcquisitionSimple(), 100);
        } else {
          const container = document.getElementById('step-3-acquisition-container');
          showStepError(container, 'Data is still loading. Please wait for Step 1 to complete.');
        }
      }
      break;
    case 7:
      // Churn Elasticity - Show elasticity models, force Churn tab, hide tabs
      showElasticityModel('churn', 'step-4-churn-container');
      // Initialize simplified churn model
      if (window.initChurnSimple && typeof window.initChurnSimple === 'function') {
        if (window.dataLoaded) {
          setTimeout(() => window.initChurnSimple(), 100);
        } else {
          const container = document.getElementById('step-4-churn-container');
          showStepError(container, 'Data is still loading. Please wait for Step 1 to complete.');
        }
      }
      break;
    case 8:
      // Tier Migration - Show elasticity models, force Migration tab, hide tabs
      showElasticityModel('migration', 'step-5-migration-container');
      // Initialize simplified migration model
      if (window.initMigrationSimple && typeof window.initMigrationSimple === 'function') {
        if (window.dataLoaded) {
          setTimeout(() => window.initMigrationSimple(), 100);
        } else {
          const container = document.getElementById('step-5-migration-container');
          showStepError(container, 'Data is still loading. Please wait for Step 1 to complete.');
        }
      }
      break;
    case 9:
      // Chat & Advanced Tools
      const chatSection = document.getElementById('chat-section');
      const chatContentArea = document.getElementById('step-9-chat-container-content');
      if (chatSection && chatContentArea) {
        chatSection.style.display = 'block';
        if (chatSection.parentElement !== chatContentArea) {
          chatContentArea.appendChild(chatSection);
        }
      }
      break;
  }
}

/**
 * Helper function to show elasticity model for a specific tab
 * @param {string} modelType - 'acquisition', 'churn', or 'migration'
 * @param {string} containerId - ID of the container to append content to
 */
function showElasticityModel(modelType, containerId) {
  const elasticityModelsSection = document.getElementById('elasticity-models-section');
  const contentArea = document.getElementById(`${containerId}-content`);

  if (!elasticityModelsSection || !contentArea) return;

  if (window.hideScenarioResults && typeof window.hideScenarioResults === 'function') {
    window.hideScenarioResults();
  }

  // Show ONLY the elasticity models section (scenario engine)
  // NOT the comparison or analytics sections - those are separate
  elasticityModelsSection.style.display = 'block';

  // Move it into the content area if not already there
  if (elasticityModelsSection.parentElement !== contentArea) {
    contentArea.appendChild(elasticityModelsSection);
  }

  // Hide the tab navigation (we'll show content directly)
  const tabNav = elasticityModelsSection.querySelector('.nav-tabs');
  if (tabNav) {
    tabNav.style.display = 'none';
  }

  // Activate the correct tab pane
  const allTabs = elasticityModelsSection.querySelectorAll('.tab-pane');
  allTabs.forEach(tab => {
    tab.classList.remove('show', 'active');
  });

  // Show the specific tab based on modelType
  let targetTabId = '';
  if (modelType === 'acquisition') {
    targetTabId = 'acquisition-pane';
  } else if (modelType === 'churn') {
    targetTabId = 'churn-pane';
  } else if (modelType === 'migration') {
    targetTabId = 'migration-pane';
  }

  const targetTab = document.getElementById(targetTabId);
  if (targetTab) {
    targetTab.classList.add('show', 'active');
  }

  if (window.setActiveModelType && typeof window.setActiveModelType === 'function') {
    window.setActiveModelType(modelType);
  }

  // Ensure scenario cards are populated
  if (window.populateElasticityModelTabs && typeof window.populateElasticityModelTabs === 'function') {
    window.populateElasticityModelTabs();
  }

  // If the target model has no results yet, ensure results stay hidden
  if (window.getCurrentResultForModel && typeof window.getCurrentResultForModel === 'function') {
    const modelResult = window.getCurrentResultForModel(modelType);
    if (!modelResult && window.hideScenarioResults && typeof window.hideScenarioResults === 'function') {
      window.hideScenarioResults();
    }
  }
}

/**
 * Create navigation buttons for a step
 * @param {number} prevStep - Previous step number
 * @param {number} nextStep - Next step number
 * @param {string} nextLabel - Label for next button
 * @returns {HTMLElement} Navigation div element
 */
function createStepNavigation(prevStep, nextStep, nextLabel = 'Next') {
  const nav = document.createElement('div');
  nav.className = 'section-header-nav';

  // Back button
  if (prevStep !== null) {
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary-custom';
    backBtn.onclick = () => goToStep(prevStep);
    backBtn.innerHTML = '<i class="bi bi-arrow-left me-2"></i> Back';
    nav.appendChild(backBtn);
  }

  // Next button
  if (nextStep !== null) {
    const nextBtn = document.createElement('button');
    nextBtn.className = nextStep === 0 ? 'btn btn-secondary-custom' : 'btn btn-primary-custom';
    nextBtn.onclick = () => goToStep(nextStep);

    if (nextStep === 0) {
      nextBtn.innerHTML = '<i class="bi bi-house me-2"></i> Back to Start';
    } else {
      nextBtn.innerHTML = `${nextLabel} <i class="bi bi-arrow-right ms-2"></i>`;
    }
    nav.appendChild(nextBtn);
  }

  return nav;
}

/**
 * Inject navigation buttons into step containers
 */
function injectStepNavigations() {
  const stepConfigs = [
    { step: 2, container: 'step-2-data-viewer-container', prev: 1, next: 3, nextLabel: 'Next: Event Calendar' },
    { step: 3, container: 'step-8-calendar-container', prev: 2, next: 4, nextLabel: 'Next: Customer Cohorts' },
    { step: 4, container: 'step-6-segmentation-container', prev: 3, next: 5, nextLabel: 'Next: Segment Comparison' },
    { step: 5, container: 'step-7-analysis-container', prev: 4, next: 6, nextLabel: 'Next: Acquisition Elasticity' },
    { step: 6, container: 'step-3-acquisition-container', prev: 5, next: 7, nextLabel: 'Next: Churn Elasticity' },
    { step: 7, container: 'step-4-churn-container', prev: 6, next: 8, nextLabel: 'Next: Tier Migration' },
    { step: 8, container: 'step-5-migration-container', prev: 7, next: 9, nextLabel: 'Next: AI Chat & Analytics' },
    { step: 9, container: 'step-9-chat-container', prev: 8, next: 0, nextLabel: null }
  ];

  stepConfigs.forEach(config => {
    const container = document.getElementById(config.container);
    if (!container) return;

    // Create wrapper structure: top-nav, content-area, bottom-nav
    const topNav = createStepNavigation(config.prev, config.next, config.nextLabel);
    topNav.classList.add('step-nav-top');

    const contentArea = document.createElement('div');
    contentArea.classList.add('step-content-area');
    contentArea.id = `${config.container}-content`;

    const bottomNav = createStepNavigation(config.prev, config.next, config.nextLabel);
    bottomNav.classList.add('step-nav-bottom');

    // Clear container and append in order
    container.innerHTML = '';
    container.appendChild(topNav);
    container.appendChild(contentArea);
    container.appendChild(bottomNav);
  });
}

/**
 * Initialize the steps overview modal behavior
 */
function initStepsOverviewModal() {
  const modalEl = document.getElementById('stepsOverviewModal');
  if (!modalEl || !window.bootstrap) return;

  modalEl.querySelectorAll('.steps-table-row').forEach(item => {
    item.addEventListener('click', () => {
      const step = parseInt(item.dataset.step, 10);
      if (Number.isNaN(step)) return;

      const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      modalEl.addEventListener('hidden.bs.modal', () => {
        goToStep(step);
      }, { once: true });
      modalInstance.hide();
    });
  });
}

/**
 * Display user-facing error message in a step container
 * @param {HTMLElement} container - Container to show error in
 * @param {string} message - Error message to display
 */
function showStepError(container, message) {
  if (!container) return;

  const errorDiv = document.createElement('div');
  errorDiv.className = 'alert alert-warning mt-3';
  errorDiv.innerHTML = `
    <i class="bi bi-exclamation-triangle me-2"></i>
    <strong>Unable to load this step:</strong> ${message}
    <button class="btn btn-sm btn-outline-warning ms-3" onclick="location.reload()">
      <i class="bi bi-arrow-clockwise me-1"></i>Refresh Page
    </button>
  `;

  // Only add if not already present
  if (!container.querySelector('.alert-warning')) {
    container.insertBefore(errorDiv, container.firstChild);
  }
}

/**
 * Initialize step navigation
 */
function initStepNavigation() {
  // Add click handlers to step dots
  document.querySelectorAll('.step-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const step = parseInt(dot.dataset.step);
      goToStep(step);
    });
  });

  // Inject navigation buttons for all steps
  injectStepNavigations();

  // Hook up steps overview modal
  initStepsOverviewModal();

  // Start at step 0 (hero)
  goToStep(0);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStepNavigation);
} else {
  initStepNavigation();
}

// Make goToStep available globally for onclick handlers
window.goToStep = goToStep;
