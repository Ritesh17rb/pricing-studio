/**
 * Data Viewer Module - Accordion-based CSV Data Explorer
 * Handles loading, displaying, and exporting CSV datasets only
 */

// Dataset configuration - CSV files only
const DATASETS = {
  subscribers: {
    title: 'Subscribers',
    description: 'Individual subscriber-level data with acquisition, behavior, engagement, and churn information',
    file: './data/subscribers.csv',
    recordCount: 50000,
    dateRange: '2022-01-01 to 2024-12-30',
    category: 'Core Data',
    icon: 'bi-people'
  },
  weekly_aggregated: {
    title: 'Weekly Aggregated',
    description: 'Pre-aggregated weekly KPIs by tier with external factors for time series modeling',
    file: './data/weekly_aggregated.csv',
    recordCount: 471,
    dateRange: '2022-01-02 to 2024-12-29',
    category: 'Core Data',
    icon: 'bi-graph-up'
  },
  pricing_history: {
    title: 'Pricing History',
    description: 'Historical pricing changes, promotional periods, and effective prices by tier',
    file: './data/pricing_history.csv',
    recordCount: 471,
    dateRange: '2022-01-02 to 2024-12-29',
    category: 'Pricing Data',
    icon: 'bi-tag'
  },
  external_factors: {
    title: 'External Factors',
    description: 'Macroeconomic indicators and competitor pricing data',
    file: './data/external_factors.csv',
    recordCount: 157,
    dateRange: '2022-01-02 to 2024-12-29',
    category: 'External Data',
    icon: 'bi-globe'
  },
  marketing_spend: {
    title: 'Marketing Spend',
    description: 'Marketing spend by channel for acquisition analysis',
    file: './data/marketing_spend.csv',
    recordCount: 157,
    dateRange: '2022-01-02 to 2024-12-29',
    category: 'Marketing Data',
    icon: 'bi-megaphone'
  },
  content_releases: {
    title: 'Content Releases',
    description: 'Content release calendar for content-driven demand modeling',
    file: './data/content_releases.csv',
    recordCount: 157,
    dateRange: '2022-01-02 to 2024-12-29',
    category: 'Content Data',
    icon: 'bi-play-circle'
  },
  event_calendar: {
    title: 'Event Calendar',
    description: 'Unified event log with price changes, promotions, and tentpole content releases',
    file: './data/event_calendar.csv',
    recordCount: 31,
    dateRange: '2022-01-02 to 2024-06-16',
    category: 'Event Data',
    icon: 'bi-calendar-event'
  },
  customer_segments: {
    title: 'Customer Segments',
    description: '375 behavioral segments across 3-axis framework (Monetization, Engagement, Acquisition)',
    file: './data/customer_segments.csv',
    recordCount: 375,
    dateRange: 'N/A',
    category: 'Segmentation Data',
    icon: 'bi-diagram-3'
  },
  segment_kpis: {
    title: 'Segment KPIs',
    description: 'Segment-level KPIs including ARPU, churn rate, and engagement metrics',
    file: './data/segment_kpis.csv',
    recordCount: 375,
    dateRange: 'Current snapshot',
    category: 'Segmentation Data',
    icon: 'bi-graph-up-arrow'
  }
};

// Group datasets by category
const CATEGORIES = {
  'Core Data': ['subscribers', 'weekly_aggregated'],
  'Pricing Data': ['pricing_history'],
  'Event Data': ['event_calendar'],
  'Segmentation Data': ['customer_segments', 'segment_kpis'],
  'Marketing Data': ['marketing_spend'],
  'Content Data': ['content_releases'],
  'External Data': ['external_factors']
};

// State
let currentDataset = null;
let currentData = [];
let filteredData = [];
let currentPage = 1;
let rowsPerPage = 25;
let sortColumn = null;
let sortDirection = 'asc';

/**
 * Initialize the data viewer
 */
export function initializeDataViewer() {
  console.log('Initializing Data Viewer...');

  // Build accordion
  buildAccordion();

  // Search
  document.getElementById('data-search').addEventListener('input', handleSearch);

  // Rows per page
  document.getElementById('rows-per-page').addEventListener('change', handleRowsPerPageChange);

  // Refresh
  document.getElementById('refresh-data-btn').addEventListener('click', refreshCurrentDataset);

  // Export button
  document.getElementById('export-csv-btn').addEventListener('click', () => exportData('csv'));
}

/**
 * Build the accordion structure
 */
function buildAccordion() {
  const accordion = document.getElementById('datasets-accordion');
  accordion.innerHTML = '';

  let categoryIndex = 0;
  for (const [category, datasetKeys] of Object.entries(CATEGORIES)) {
    const accordionItem = document.createElement('div');
    accordionItem.className = 'accordion-item';

    const headerId = `heading-${categoryIndex}`;
    const collapseId = `collapse-${categoryIndex}`;

    accordionItem.innerHTML = `
      <h2 class="accordion-header" id="${headerId}">
        <button class="accordion-button ${categoryIndex === 0 ? '' : 'collapsed'}" type="button"
                data-bs-toggle="collapse" data-bs-target="#${collapseId}"
                aria-expanded="${categoryIndex === 0 ? 'true' : 'false'}" aria-controls="${collapseId}">
          ${category}
        </button>
      </h2>
      <div id="${collapseId}" class="accordion-collapse collapse ${categoryIndex === 0 ? 'show' : ''}"
           aria-labelledby="${headerId}" data-bs-parent="#datasets-accordion">
        <div class="accordion-body">
          ${datasetKeys.map(key => {
            const dataset = DATASETS[key];
            return `
              <div class="dataset-item" data-dataset="${key}">
                <i class="bi ${dataset.icon} me-2"></i>
                <span>${dataset.title}</span>
                <small class="text-muted d-block ms-4" style="font-size: 0.75rem;">
                  ${dataset.recordCount.toLocaleString()} rows
                </small>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    accordion.appendChild(accordionItem);
    categoryIndex++;
  }

  // Add click handlers to dataset items
  document.querySelectorAll('.dataset-item').forEach(item => {
    item.addEventListener('click', () => {
      const datasetKey = item.dataset.dataset;
      handleDatasetSelection(datasetKey);
    });
  });
}

/**
 * Handle dataset selection
 */
async function handleDatasetSelection(datasetKey) {
  // Update active state
  document.querySelectorAll('.dataset-item').forEach(item => {
    item.classList.remove('active');
  });
  document.querySelector(`[data-dataset="${datasetKey}"]`).classList.add('active');

  // Load dataset
  await loadDataset(datasetKey);
}

/**
 * Load and display a dataset
 */
async function loadDataset(datasetKey) {
  const dataset = DATASETS[datasetKey];

  if (!dataset) {
    console.error('Dataset not found:', datasetKey);
    return;
  }

  currentDataset = { key: datasetKey, ...dataset };

  // Show loading state
  showLoading();

  try {
    // Load CSV data
    currentData = await loadCSV(dataset.file);
    displayCSVData();

    // Update dataset info
    updateDatasetInfo();

    // Enable export button
    document.getElementById('export-csv-btn').disabled = false;

  } catch (error) {
    console.error('Error loading dataset:', error);
    showError('Failed to load dataset: ' + error.message);
  }
}

/**
 * Load CSV file
 */
async function loadCSV(filePath) {
  const response = await fetch(filePath);
  const text = await response.text();

  // Parse CSV
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });
      data.push(row);
    }
  }

  return data;
}

/**
 * Parse CSV line (handles quoted values with commas)
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Display CSV data in table
 */
function displayCSVData() {
  filteredData = [...currentData];
  currentPage = 1;

  // Hide other views
  document.getElementById('data-empty').style.display = 'none';
  document.getElementById('data-loading').style.display = 'none';

  // Show table controls and container
  document.getElementById('data-controls').style.display = 'flex';
  document.getElementById('data-table-container').style.display = 'block';
  document.getElementById('pagination-container').style.display = 'flex';

  // Render table
  renderTable();
}

/**
 * Render table with pagination
 */
function renderTable() {
  const table = document.getElementById('data-table');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  // Clear existing content
  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (filteredData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="100" class="text-center text-muted py-4">No data found</td></tr>';
    return;
  }

  // Get headers
  const headers = Object.keys(filteredData[0]);

  // Create header row
  const headerRow = document.createElement('tr');
  headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.style.whiteSpace = 'nowrap';

    // Add sort indicator
    if (sortColumn === header) {
      th.innerHTML += sortDirection === 'asc' ? ' ▲' : ' ▼';
    }

    // Add click handler for sorting
    th.addEventListener('click', () => handleSort(header));

    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Calculate pagination
  const totalRows = filteredData.length;
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = rowsPerPage === 'all' ? totalRows : Math.min(startIndex + rowsPerPage, totalRows);
  const pageData = filteredData.slice(startIndex, endIndex);

  // Create data rows
  pageData.forEach(row => {
    const tr = document.createElement('tr');
    headers.forEach(header => {
      const td = document.createElement('td');
      td.textContent = row[header] || '';
      td.style.whiteSpace = 'nowrap';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // Update pagination
  updatePagination(totalRows, startIndex, endIndex);
}

/**
 * Handle sorting
 */
function handleSort(column) {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDirection = 'asc';
  }

  filteredData.sort((a, b) => {
    let aVal = a[column];
    let bVal = b[column];

    // Try to parse as numbers
    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
    }

    // String comparison
    aVal = String(aVal || '');
    bVal = String(bVal || '');

    if (sortDirection === 'asc') {
      return aVal.localeCompare(bVal);
    } else {
      return bVal.localeCompare(aVal);
    }
  });

  renderTable();
}

/**
 * Update pagination UI
 */
function updatePagination(totalRows, startIndex, endIndex) {
  const paginationInfo = document.getElementById('pagination-info');
  const pagination = document.getElementById('pagination');

  // Update info
  paginationInfo.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalRows.toLocaleString()} rows`;

  // Calculate total pages
  const totalPages = rowsPerPage === 'all' ? 1 : Math.ceil(totalRows / rowsPerPage);

  // Clear pagination
  pagination.innerHTML = '';

  if (totalPages <= 1) {
    return;
  }

  // Previous button
  const prevLi = document.createElement('li');
  prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
  prevLi.innerHTML = '<a class="page-link" href="#">Previous</a>';
  prevLi.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });
  pagination.appendChild(prevLi);

  // Page numbers (show max 5 pages)
  const maxPagesToShow = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
  let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

  if (endPage - startPage < maxPagesToShow - 1) {
    startPage = Math.max(1, endPage - maxPagesToShow + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    const li = document.createElement('li');
    li.className = `page-item ${i === currentPage ? 'active' : ''}`;
    li.innerHTML = `<a class="page-link" href="#">${i}</a>`;
    li.addEventListener('click', (e) => {
      e.preventDefault();
      currentPage = i;
      renderTable();
    });
    pagination.appendChild(li);
  }

  // Next button
  const nextLi = document.createElement('li');
  nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
  nextLi.innerHTML = '<a class="page-link" href="#">Next</a>';
  nextLi.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });
  pagination.appendChild(nextLi);
}

/**
 * Handle search
 */
function handleSearch(event) {
  const searchTerm = event.target.value.toLowerCase();

  if (!searchTerm) {
    filteredData = [...currentData];
  } else {
    filteredData = currentData.filter(row => {
      return Object.values(row).some(value => {
        return String(value).toLowerCase().includes(searchTerm);
      });
    });
  }

  currentPage = 1;
  renderTable();
}

/**
 * Handle rows per page change
 */
function handleRowsPerPageChange(event) {
  const value = event.target.value;
  rowsPerPage = value === 'all' ? 'all' : parseInt(value);
  currentPage = 1;
  renderTable();
}

/**
 * Update dataset info panel
 */
function updateDatasetInfo() {
  const info = document.getElementById('dataset-info');
  document.getElementById('dataset-title').textContent = currentDataset.title;
  document.getElementById('dataset-description').textContent = currentDataset.description;

  const recordsText = `${currentData.length.toLocaleString()} records`;
  const columns = Object.keys(currentData[0] || {}).length;

  document.getElementById('dataset-records').textContent = recordsText;
  document.getElementById('dataset-columns').textContent = `${columns} columns`;
  document.getElementById('dataset-date-range').textContent = currentDataset.dateRange || 'N/A';

  info.style.display = 'block';
}

/**
 * Export data as CSV
 */
function exportData(format) {
  if (!currentData || currentData.length === 0) {
    alert('No data to export');
    return;
  }

  const csvContent = dataToCSV(currentData);
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const filename = `${currentDataset.key}_export.csv`;

  // Download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Convert data to CSV string
 */
function dataToCSV(data) {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      // Escape quotes and wrap in quotes if contains comma
      if (String(value).includes(',') || String(value).includes('"')) {
        return `"${String(value).replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Refresh current dataset
 */
async function refreshCurrentDataset() {
  if (currentDataset) {
    await loadDataset(currentDataset.key);
  }
}

/**
 * Show loading state
 */
function showLoading() {
  document.getElementById('dataset-info').style.display = 'none';
  document.getElementById('data-controls').style.display = 'none';
  document.getElementById('data-table-container').style.display = 'none';
  document.getElementById('pagination-container').style.display = 'none';
  document.getElementById('data-empty').style.display = 'none';
  document.getElementById('data-loading').style.display = 'block';
}

/**
 * Show error message
 */
function showError(message) {
  document.getElementById('data-loading').style.display = 'none';
  document.getElementById('data-empty').style.display = 'block';
  document.getElementById('data-empty').innerHTML = `
    <i class="bi bi-exclamation-triangle-fill text-danger display-4 mb-3"></i>
    <p class="text-danger">${message}</p>
  `;
}
