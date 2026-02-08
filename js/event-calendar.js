/**
 * Event Calendar Module
 * Renders and manages the event calendar UI
 */

import { loadEventCalendar, loadPromoMetadata, loadValidationWindows } from './data-loader.js';
import { formatCurrency, formatPercent, formatNumber } from './utils.js';

// Global state
let allEvents = [];
let promoMetadata = {};
let validationWindows = {};
let activeFilters = {
  holiday: true,
  special_event: true,
  school_break: true,
  weather: true
};

/**
 * Initialize event calendar section
 */
export async function initializeEventCalendar() {
  console.log('Initializing Event Calendar...');

  try {
    // Load all data
    [allEvents, promoMetadata, validationWindows] = await Promise.all([
      loadEventCalendar(),
      loadPromoMetadata(),
      loadValidationWindows()
    ]);

    // Update event count badge
    updateEventCountBadge();

    // Render all components
    renderEventTimeline();
    renderEventTable();
    renderPromoCards();
    renderValidationWindows();

    // Setup event listeners
    setupEventFilters();

    console.log('Event Calendar initialized successfully');
  } catch (error) {
    console.error('Error initializing event calendar:', error);
    document.getElementById('event-timeline').innerHTML = `
      <div class="alert alert-danger">
        <i class="bi bi-exclamation-triangle me-2"></i>
        Error loading event calendar data: ${error.message}
      </div>
    `;
  }
}

/**
 * Update event count badge
 */
function updateEventCountBadge() {
  const badge = document.getElementById('event-count-badge');
  if (badge) {
    const counts = {
      holidays: allEvents.filter(e => e.event_type === 'holiday').length,
      events: allEvents.filter(e => e.event_type === 'special_event').length,
      schoolBreaks: allEvents.filter(e => e.event_type === 'school_break').length
    };
    badge.textContent = `${allEvents.length} Events (${counts.holidays} Holidays, ${counts.events} Special Events, ${counts.schoolBreaks} School Breaks)`;
  }
}

/**
 * Render event timeline visualization
 */
function renderEventTimeline() {
  const container = document.getElementById('event-timeline');
  if (!container) return;

  // Filter events based on active filters
  const filteredEvents = filterEvents();

  if (filteredEvents.length === 0) {
    container.innerHTML = '<div class="text-center text-muted">No events match the current filters</div>';
    return;
  }

  // Get date range (2024-2026 for theme park data)
  const startDate = new Date('2024-01-01');
  const endDate = new Date('2026-01-01');
  const totalDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));

  // Build timeline slider HTML
  let html = '<div class="timeline-slider-container">';

  // Legend
  html += `
    <div class="d-flex justify-content-center gap-4 mb-3">
      <div class="d-flex align-items-center">
        <div style="width: 16px; height: 16px; border-radius: 50%; background: var(--primary-green); box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2);"></div>
        <span class="ms-2 small">Holidays</span>
      </div>
      <div class="d-flex align-items-center">
        <div style="width: 16px; height: 16px; border-radius: 50%; background: var(--primary-blue); box-shadow: 0 0 0 4px rgba(0, 102, 255, 0.2);"></div>
        <span class="ms-2 small">Special Events</span>
      </div>
      <div class="d-flex align-items-center">
        <div style="width: 16px; height: 16px; border-radius: 50%; background: var(--primary-orange); box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.2);"></div>
        <span class="ms-2 small">School Breaks</span>
      </div>
      <div class="d-flex align-items-center">
        <div style="width: 16px; height: 16px; border-radius: 50%; background: var(--bs-secondary); box-shadow: 0 0 0 4px rgba(108, 117, 125, 0.2);"></div>
        <span class="ms-2 small">Weather</span>
      </div>
    </div>
    <p class="text-center text-muted small mb-3"><i class="bi bi-info-circle me-1"></i>Click on any event marker to see details</p>
  `;

  // Year markers
  html += '<div class="timeline-years">';
  html += '<div class="timeline-year-marker" style="left: 0%;">2024</div>';
  html += '<div class="timeline-year-marker" style="left: 50%;">2025</div>';
  html += '<div class="timeline-year-marker" style="left: 100%;">2026</div>';
  html += '</div>';

  // Timeline track
  html += '<div class="timeline-track">';

  // Add event markers
  filteredEvents.forEach((event, index) => {
    const eventDate = new Date(event.date);
    const daysSinceStart = Math.floor((eventDate - startDate) / (1000 * 60 * 60 * 24));
    const positionPercent = (daysSinceStart / totalDays) * 100;

    // Skip events outside timeline range
    if (positionPercent < 0 || positionPercent > 100) return;

    // Determine event class based on type
    let eventClass = 'timeline-event';
    if (event.event_type === 'holiday') {
      eventClass += ' event-price';
    } else if (event.event_type === 'special_event') {
      eventClass += ' event-promo';
    } else if (event.event_type === 'school_break') {
      eventClass += ' event-content';
    } else if (event.event_type === 'weather') {
      eventClass += ' event-weather';
    }

    html += `
      <div class="${eventClass}"
           style="left: ${positionPercent}%;"
           data-event-index="${index}"
           title="${event.event_name} - ${eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}">
      </div>
    `;
  });

  html += '</div>'; // Close timeline-track

  // Selected event details panel
  html += '<div class="timeline-details mt-4" id="timeline-details" style="display: none;"></div>';

  html += '</div>'; // Close timeline-slider-container

  container.innerHTML = html;

  // Add click event listeners to show event details
  const eventMarkers = container.querySelectorAll('.timeline-event');
  eventMarkers.forEach(marker => {
    marker.addEventListener('click', () => {
      const eventIndex = parseInt(marker.dataset.eventIndex);
      const event = filteredEvents[eventIndex];
      if (event) {
        showEventDetails(event);
      }
    });
  });
}

/**
 * Show detailed information for a selected event
 * @param {object} event - Event object
 */
function showEventDetails(event) {
  const detailsPanel = document.getElementById('timeline-details');
  if (!detailsPanel) return;

  const eventDate = new Date(event.date);
  const dateStr = eventDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Get event type display name
  const eventTypeMap = {
    'holiday': 'Holiday',
    'special_event': 'Special Event',
    'school_break': 'School Break',
    'weather': 'Weather Event'
  };
  const eventTypeDisplay = eventTypeMap[event.event_type] || event.event_type;

  // Get impact level badge
  const impactClass = event.impact_level === 'high' ? 'danger' : event.impact_level === 'medium' ? 'warning' : 'info';

  let html = `
    <div class="glass-card p-4">
      <div class="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h5 class="mb-2">${event.event_name}</h5>
          <div class="mb-2">
            <span class="badge bg-primary me-2">${eventTypeDisplay}</span>
            <span class="badge bg-${impactClass}">${event.impact_level} Impact</span>
          </div>
          <div class="text-muted small">
            <i class="bi bi-calendar-event me-2"></i>${dateStr}
          </div>
        </div>
        <button type="button" class="btn-close" onclick="document.getElementById('timeline-details').style.display='none'"></button>
      </div>
      <p class="mb-0"><strong>Expected Impact:</strong> ${event.impact_level.charAt(0).toUpperCase() + event.impact_level.slice(1)} visitor impact expected for this ${eventTypeDisplay.toLowerCase()}.</p>
    </div>
  `;

  detailsPanel.innerHTML = html;
  detailsPanel.style.display = 'block';

  // Scroll to details
  detailsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Render event table
 */
function renderEventTable() {
  const tbody = document.getElementById('event-table-body');
  if (!tbody) return;

  const filteredEvents = filterEvents();

  if (filteredEvents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No events match the current filters</td></tr>';
    return;
  }

  let html = '';
  filteredEvents.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(event => {
    const date = new Date(event.date);
    const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const badge = getEventBadge(event.event_type);
    const priceChange = event.price_before && event.price_after && event.price_before !== event.price_after
      ? `${formatCurrency(event.price_before)} → ${formatCurrency(event.price_after)}`
      : '-';
    const promo = event.promo_discount_pct > 0
      ? `${event.promo_discount_pct}% off`
      : '-';

    html += `
      <tr>
        <td class="text-nowrap">${dateStr}</td>
        <td><span class="badge ${badge.class}">${badge.text}</span></td>
        <td>${formatTier(event.tier)}</td>
        <td class="text-nowrap">${priceChange}</td>
        <td>${promo}</td>
        <td class="small">${event.notes || '-'}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Render promo campaign performance cards
 */
function renderPromoCards() {
  const container = document.getElementById('promo-cards-container');
  if (!container) return;

  const promos = Object.values(promoMetadata);

  if (promos.length === 0) {
    container.innerHTML = '<div class="col-12 text-center text-muted">No promo campaigns available</div>';
    return;
  }

  let html = '';
  promos.forEach(promo => {
    const status = promo.actual_adds ? 'Complete' : 'In Progress';
    const statusClass = promo.actual_adds ? 'success' : 'warning';
    // Calculate as decimal, formatPercent will multiply by 100
    const attainment = promo.actual_adds ?
      formatPercent(promo.actual_adds / promo.target_adds) : 'TBD';
    const roi = promo.actual_roi ? `${promo.actual_roi}x` : 'TBD';

    html += `
      <div class="col-md-6 col-lg-4 mb-3">
        <div class="card h-100">
          <div class="card-header bg-${statusClass} text-white">
            <div class="d-flex justify-content-between align-items-center">
              <h6 class="mb-0">${promo.campaign_name}</h6>
              <span class="badge text-dark">${status}</span>
            </div>
          </div>
          <div class="card-body">
            <div class="mb-2">
              <strong>Period:</strong> ${formatDate(promo.start_date)} - ${formatDate(promo.end_date)}
              <span class="badge bg-secondary ms-2">${promo.duration_weeks}w</span>
            </div>
            <div class="mb-2">
              <strong>Discount:</strong> <span class="text-success">${promo.discount_pct}% off</span>
            </div>
            <div class="mb-2">
              <strong>Target:</strong> ${formatNumber(promo.target_adds)} adds
            </div>
            ${promo.actual_adds ? `
              <div class="mb-2">
                <strong>Actual:</strong> ${formatNumber(promo.actual_adds)}
                <span class="badge bg-primary">${attainment}</span>
              </div>
              <div class="mb-2">
                <strong>ROI:</strong> <span class="text-success">${roi}</span>
              </div>
            ` : ''}
            <div class="mb-2">
              <strong>Roll-off:</strong> ${formatDate(promo.roll_off_date)}
              ${promo.churn_spike_expected ?
                `<span class="badge bg-warning text-dark ms-1" title="Expected churn spike at ${promo.churn_spike_lag_weeks} weeks">
                  <i class="bi bi-exclamation-triangle"></i> Churn Risk
                </span>` : ''}
            </div>
            <div class="mt-3 small text-muted">
              <strong>Tags:</strong> ${promo.campaign_tags.map(tag =>
                `<span class="badge bg-secondary text-white me-1">${tag}</span>`
              ).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Render validation windows table
 */
function renderValidationWindows() {
  const tbody = document.getElementById('validation-windows-body');
  if (!tbody) return;

  const windows = validationWindows.validation_windows || [];

  if (windows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No validation windows defined</td></tr>';
    return;
  }

  let html = '';
  windows.forEach(window => {
    const statusBadge = getWindowBadge(window.status);
    const typeBadge = window.type === 'train' ? 'bg-primary' : 'bg-info';

    html += `
      <tr>
        <td><code class="small">${window.window_id}</code></td>
        <td><span class="badge ${typeBadge}">${window.type}</span></td>
        <td class="text-nowrap small">${formatDate(window.start)} - ${formatDate(window.end)}</td>
        <td>${window.weeks}</td>
        <td><span class="badge ${statusBadge}">${window.status}</span></td>
        <td class="small">${window.purpose || '-'}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Setup event filter listeners
 */
function setupEventFilters() {
  const filterAll = document.getElementById('filter-all');
  const filterPriceChange = document.getElementById('filter-price-change');
  const filterPromo = document.getElementById('filter-special-event');
  const filterTentpole = document.getElementById('filter-school-break');

  if (filterAll) {
    filterAll.addEventListener('change', (e) => {
      const checked = e.target.checked;
      activeFilters.holiday = checked;
      activeFilters.special_event = checked;
      activeFilters.special_event = checked;

      filterPriceChange.checked = checked;
      filterPromo.checked = checked;
      filterTentpole.checked = checked;

      renderEventTimeline();
      renderEventTable();
    });
  }

  if (filterPriceChange) {
    filterPriceChange.addEventListener('change', (e) => {
      activeFilters.holiday = e.target.checked;
      renderEventTimeline();
      renderEventTable();
    });
  }

  if (filterPromo) {
    filterPromo.addEventListener('change', (e) => {
      activeFilters.special_event = e.target.checked;
      renderEventTimeline();
      renderEventTable();
    });
  }

  if (filterTentpole) {
    filterTentpole.addEventListener('change', (e) => {
      activeFilters.special_event = e.target.checked;
      renderEventTimeline();
      renderEventTable();
    });
  }
}

/**
 * Filter events based on active filters
 */
function filterEvents() {
  return allEvents.filter(event => {
    if (event.event_type === 'holiday' && !activeFilters.holiday) return false;
    if (event.event_type === 'special_event' && !activeFilters.special_event) return false;
    if (event.event_type === 'school_break' && !activeFilters.school_break) return false;
    if (event.event_type === 'weather' && !activeFilters.weather) return false;
    return true;
  });
}

/**
 * Get event badge configuration
 */
function getEventBadge(eventType) {
  const badges = {
    'Price Change': { text: 'Price Change', class: 'bg-success' },
    'Promo Start': { text: 'Promo Start', class: 'bg-info' },
    'Promo End': { text: 'Promo End', class: 'bg-secondary' },
    'Promo Roll-off': { text: 'Roll-off', class: 'bg-warning text-dark' },
    'Tentpole': { text: 'Tentpole', class: 'bg-warning text-dark' }
  };
  return badges[eventType] || { text: eventType, class: 'bg-secondary' };
}

/**
 * Get validation window badge
 */
function getWindowBadge(status) {
  const badges = {
    'clean': 'bg-success',
    'test': 'bg-info',
    'confounded': 'bg-warning text-dark'
  };
  return badges[status] || 'bg-secondary';
}

/**
 * Get event price info string
 */
function getEventPriceInfo(event) {
  if (event.price_before && event.price_after && event.price_before !== event.price_after) {
    // Calculate as decimal (0.4293 = 42.93%), formatPercent will multiply by 100
    const change = (event.price_after - event.price_before) / event.price_before;
    const arrow = change > 0 ? '↑' : '↓';
    const color = change > 0 ? 'text-success' : 'text-danger';
    return `
      <span class="${color}">
        <strong>${formatCurrency(event.price_before)} → ${formatCurrency(event.price_after)}</strong>
        (${arrow} ${formatPercent(Math.abs(change))})
      </span>
    `;
  }
  if (event.promo_discount_pct > 0) {
    return `<span class="text-info"><strong>${event.promo_discount_pct}% discount</strong></span>`;
  }
  return null;
}

/**
 * Format tier name
 */
function formatTier(tier) {
  const tiers = {
    'ad_supported': 'Ad-Lite',
    'ad_free': 'Ad-Free',
    'bundle': 'Bundle',
    'all': 'All Tiers'
  };
  return tiers[tier] || tier;
}

/**
 * Format cohort name
 */
function formatCohortName(cohort) {
  if (!cohort || cohort === 'all') return 'All Cohorts';
  return cohort.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Format date string
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
