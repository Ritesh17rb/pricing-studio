/**
 * Utility Functions
 * Helper functions for formatting, calculations, and UI interactions
 */

/**
 * Format number as currency (USD)
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/**
 * Format number with commas
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted number
 */
export function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Format percentage
 * @param {number} value - Value to format (0.05 = 5%)
 * @param {number} decimals - Decimal places
 * @returns {string} Formatted percentage
 */
export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Calculate percentage change
 * @param {number} oldValue - Original value
 * @param {number} newValue - New value
 * @returns {number} Percentage change
 */
export function calculatePercentChange(oldValue, newValue) {
  if (!oldValue || oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Get color based on value and thresholds
 * @param {number} value - Value to evaluate
 * @param {Object} thresholds - { good, warning } threshold values
 * @returns {string} Bootstrap color class
 */
export function getColorByValue(value, thresholds = { good: 0, warning: -5 }) {
  if (value >= thresholds.good) return 'success';
  if (value >= thresholds.warning) return 'warning';
  return 'danger';
}

/**
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Show Bootstrap toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type ('success', 'danger', 'warning', 'info')
 */
export function showToast(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  // Can be enhanced with actual Bootstrap toast implementation
}

/**
 * Generate unique scenario ID
 * @returns {string} Unique ID
 */
export function generateScenarioId() {
  return `scenario_custom_${Date.now()}`;
}
/**
 * Show Bootstrap alert instead of window.alert()
 * @param {string} message - Alert message
 * @param {string} type - Alert type: 'success', 'danger', 'warning', 'info' (default: 'info')
 * @param {number} duration - Auto-dismiss duration in ms (0 = no auto-dismiss, default: 5000)
 */
export function showAlert(message, type = 'info', duration = 5000) {
  // Create alert container if it doesn't exist
  let alertContainer = document.getElementById('alert-container');
  if (!alertContainer) {
    alertContainer = document.createElement('div');
    alertContainer.id = 'alert-container';
    alertContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
    document.body.appendChild(alertContainer);
  }

  // Create alert element
  const alertId = 'alert-' + Date.now();
  const alertEl = document.createElement('div');
  alertEl.id = alertId;
  alertEl.className = `alert alert-${type} alert-dismissible fade show`;
  alertEl.setAttribute('role', 'alert');
  alertEl.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;

  // Add to container
  alertContainer.appendChild(alertEl);

  // Auto-dismiss after duration
  if (duration > 0) {
    setTimeout(() => {
      alertEl.classList.remove('show');
      setTimeout(() => alertEl.remove(), 150);
    }, duration);
  }

  return alertEl;
}
