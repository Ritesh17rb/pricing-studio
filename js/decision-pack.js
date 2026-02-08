/**
 * Decision Pack Export Module
 * Exports scenario analysis to PDF and XLSX formats
 * Export-ready + Auditable
 */

import { formatCurrency, formatPercent, formatNumber, showAlert } from './utils.js';

/**
 * Export Top 3 scenarios to PDF
 * @param {Array} top3Scenarios - Top 3 ranked scenarios
 * @param {string} objective - Selected objective lens
 * @param {Object} constraints - Applied constraints
 */
export async function exportToPDF(top3Scenarios, objective, constraints = {}) {
  if (!top3Scenarios || top3Scenarios.length === 0) {
    showAlert('No scenarios to export. Please rank scenarios first.', 'warning');
    return;
  }

  try {
    // Access jsPDF from global scope
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Document metadata
    const timestamp = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    // Page 1: Executive Summary
    addExecutiveSummary(doc, top3Scenarios, objective, timestamp);

    // Page 2: Top 3 Recommendations
    doc.addPage();
    addTop3Recommendations(doc, top3Scenarios);

    // Page 3: KPI Comparison
    doc.addPage();
    addKPIComparison(doc, top3Scenarios);

    // Page 4: Implementation Guidance
    doc.addPage();
    addImplementationGuidance(doc, top3Scenarios[0]);

    // Page 5: Audit Trail
    doc.addPage();
    addAuditTrail(doc, constraints, timestamp);

    // Save PDF
    const filename = `Decision_Pack_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    console.log(`✅ PDF exported: ${filename}`);
    return filename;

  } catch (error) {
    console.error('Error exporting PDF:', error);
    showAlert('Error generating PDF. Check console for details.', 'danger');
    throw error;
  }
}

/**
 * Export scenarios to XLSX
 * @param {Array} scenarios - All scenarios to export
 * @param {Array} top3 - Top 3 ranked scenarios (optional)
 */
export async function exportToXLSX(scenarios, top3 = null) {
  if (!scenarios || scenarios.length === 0) {
    showAlert('No scenarios to export.', 'warning');
    return;
  }

  try {
    const XLSX = window.XLSX;
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = createSummarySheet(top3 || scenarios.slice(0, 3));
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Sheet 2: All Scenarios
    const scenariosData = createScenariosSheet(scenarios);
    const scenariosSheet = XLSX.utils.aoa_to_sheet(scenariosData);
    XLSX.utils.book_append_sheet(workbook, scenariosSheet, 'All Scenarios');

    // Sheet 3: KPI Details
    const kpiData = createKPISheet(scenarios);
    const kpiSheet = XLSX.utils.aoa_to_sheet(kpiData);
    XLSX.utils.book_append_sheet(workbook, kpiSheet, 'KPI Details');

    // Sheet 4: Metadata
    const metadataData = createMetadataSheet();
    const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
    XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Metadata');

    // Save XLSX
    const filename = `Decision_Pack_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);

    console.log(`✅ XLSX exported: ${filename}`);
    return filename;

  } catch (error) {
    console.error('Error exporting XLSX:', error);
    showAlert('Error generating Excel file. Check console for details.', 'danger');
    throw error;
  }
}

// ============================================================================
// PDF Helper Functions
// ============================================================================

function addExecutiveSummary(doc, top3, objective, timestamp) {
  // Header
  doc.setFontSize(20);
  doc.setTextColor(13, 110, 253); // Bootstrap primary blue
  doc.text('Decision Pack: Pricing Scenario Analysis', 20, 20);

  doc.setFontSize(10);
  doc.setTextColor(108, 117, 125); // Gray
  doc.text(`Generated: ${timestamp}`, 20, 28);
  doc.text(`Objective: ${getObjectiveName(objective)}`, 20, 34);

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 38, 190, 38);

  // Executive Summary
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Executive Summary', 20, 48);

  doc.setFontSize(10);
  const winner = top3[0];
  const summary = [
    `Recommended Option: ${winner.scenario_name || winner.id}`,
    ``,
    `Key Metrics:`,
    `• Revenue Impact: ${winner.delta.revenue >= 0 ? '+' : ''}${formatPercent(winner.delta.revenue_pct, 1)}`,
    `• Subscriber Impact: ${winner.delta.visitors >= 0 ? '+' : ''}${formatPercent(winner.delta.visitors_pct, 1)}`,
    `• Churn Impact: ${winner.delta.churn_rate >= 0 ? '+' : ''}${formatPercent(winner.delta.churn_rate, 2)}pp`,
    `• Risk Level: ${winner.risk_level}`,
    `• Decision Score: ${winner.decision_score.toFixed(1)}`,
    ``,
    `Rationale:`,
    ...winner.rationale.split('<br>').slice(0, 5).map(line => `  ${line.replace(/<[^>]*>/g, '')}`)
  ];

  let y = 56;
  summary.forEach(line => {
    doc.text(line, 20, y);
    y += 6;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Streaming Service Price Elasticity Demo | Confidential', 20, 285);
  doc.text('Page 1 of 5', 180, 285);
}

function addTop3Recommendations(doc, top3) {
  // Header
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Top 3 Recommendations', 20, 20);

  let y = 30;
  top3.forEach((scenario, index) => {
    const rank = ['🥇', '🥈', '🥉'][index];

    // Rank badge
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`${rank} Rank #${index + 1}: ${scenario.scenario_name || scenario.id}`, 20, y);

    // Metrics
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    y += 8;

    const metrics = [
      `Revenue: ${scenario.delta.revenue >= 0 ? '+' : ''}${formatPercent(scenario.delta.revenue_pct, 1)} | ` +
      `Subscribers: ${scenario.delta.visitors >= 0 ? '+' : ''}${formatPercent(scenario.delta.visitors_pct, 1)} | ` +
      `Churn: ${scenario.delta.churn_rate >= 0 ? '+' : ''}${formatPercent(scenario.delta.churn_rate, 2)}pp`,
      `Risk: ${scenario.risk_level} | Score: ${scenario.decision_score.toFixed(1)}`
    ];

    metrics.forEach(metric => {
      doc.text(metric, 25, y);
      y += 5;
    });

    // Rationale
    y += 2;
    doc.setFontSize(8);
    const rationale = scenario.rationale.split('<br>').slice(0, 4);
    rationale.forEach(line => {
      const cleaned = line.replace(/<[^>]*>/g, '').substring(0, 80);
      doc.text(cleaned, 25, y);
      y += 4;
    });

    y += 10;
    if (y > 250) return; // Prevent overflow
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Streaming Service Price Elasticity Demo | Confidential', 20, 285);
  doc.text('Page 2 of 5', 180, 285);
}

function addKPIComparison(doc, top3) {
  // Header
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('KPI Comparison Matrix', 20, 20);

  // Table
  doc.setFontSize(9);
  const headers = ['Metric', 'Rank #1', 'Rank #2', 'Rank #3'];
  const rows = [
    ['Revenue Impact',
      `${formatPercent(top3[0].delta.revenue_pct, 1)}`,
      top3[1] ? `${formatPercent(top3[1].delta.revenue_pct, 1)}` : 'N/A',
      top3[2] ? `${formatPercent(top3[2].delta.revenue_pct, 1)}` : 'N/A'
    ],
    ['Subscriber Impact',
      `${formatPercent(top3[0].delta.visitors_pct, 1)}`,
      top3[1] ? `${formatPercent(top3[1].delta.visitors_pct, 1)}` : 'N/A',
      top3[2] ? `${formatPercent(top3[2].delta.visitors_pct, 1)}` : 'N/A'
    ],
    ['Churn Impact',
      `${formatPercent(top3[0].delta.churn_rate, 2)}pp`,
      top3[1] ? `${formatPercent(top3[1].delta.churn_rate, 2)}pp` : 'N/A',
      top3[2] ? `${formatPercent(top3[2].delta.churn_rate, 2)}pp` : 'N/A'
    ],
    ['ARPU Impact',
      `${formatPercent(top3[0].delta.arpu_pct, 1)}`,
      top3[1] ? `${formatPercent(top3[1].delta.arpu_pct, 1)}` : 'N/A',
      top3[2] ? `${formatPercent(top3[2].delta.arpu_pct, 1)}` : 'N/A'
    ],
    ['Risk Level',
      top3[0].risk_level,
      top3[1] ? top3[1].risk_level : 'N/A',
      top3[2] ? top3[2].risk_level : 'N/A'
    ],
    ['Decision Score',
      top3[0].decision_score.toFixed(1),
      top3[1] ? top3[1].decision_score.toFixed(1) : 'N/A',
      top3[2] ? top3[2].decision_score.toFixed(1) : 'N/A'
    ]
  ];

  // Draw table
  let y = 35;
  const colWidths = [60, 40, 40, 40];
  let x = 20;

  // Headers
  doc.setFont(undefined, 'bold');
  headers.forEach((header, i) => {
    doc.text(header, x, y);
    x += colWidths[i];
  });

  y += 8;
  doc.line(20, y - 2, 190, y - 2);

  // Rows
  doc.setFont(undefined, 'normal');
  rows.forEach(row => {
    x = 20;
    row.forEach((cell, i) => {
      doc.text(cell, x, y);
      x += colWidths[i];
    });
    y += 7;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Streaming Service Price Elasticity Demo | Confidential', 20, 285);
  doc.text('Page 3 of 5', 180, 285);
}

function addImplementationGuidance(doc, winner) {
  // Header
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Implementation Guidance', 20, 20);

  doc.setFontSize(10);
  doc.text(`For: ${winner.scenario_name || winner.id}`, 20, 28);

  // Timeline
  doc.setFontSize(12);
  doc.text('Recommended Timeline', 20, 45);

  doc.setFontSize(9);
  const timeline = [
    'Week 1: Stakeholder approval & legal review',
    'Week 2: Platform configuration & testing',
    'Week 3: Communication plan execution',
    'Week 4: Price change rollout',
    'Week 5-8: Monitor KPIs & churn response',
    'Week 9-12: Evaluate success & iterate'
  ];

  let y = 55;
  timeline.forEach(item => {
    doc.text(`• ${item}`, 25, y);
    y += 6;
  });

  // Risk Mitigation
  y += 10;
  doc.setFontSize(12);
  doc.text('Risk Mitigation', 20, y);

  y += 10;
  doc.setFontSize(9);
  const risks = [
    'Churn spike monitoring: Track cohort churn weekly (0-4, 4-8, 8-12 weeks)',
    'Fallback plan: Prepare win-back campaign for churned users',
    'Communication: Clear value messaging to existing visitors',
    'Grandfathering: Consider protecting loyal users (12+ month tenure)'
  ];

  risks.forEach(risk => {
    doc.text(`• ${risk}`, 25, y);
    y += 8;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Streaming Service Price Elasticity Demo | Confidential', 20, 285);
  doc.text('Page 4 of 5', 180, 285);
}

function addAuditTrail(doc, constraints, timestamp) {
  // Header
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Audit Trail & Metadata', 20, 20);

  doc.setFontSize(9);
  let y = 35;

  const audit = [
    ['Analysis Date', timestamp],
    ['Data Cut', '2024-12-31'],
    ['Model Version', 'v3.0'],
    ['Elasticity Model', 'Industry-calibrated coefficients'],
    ['Churn Model', 'Time-lagged (0-4, 4-8, 8-12, 12+ weeks)'],
    ['Migration Model', 'Multinomial Logit'],
    ['Segments Analyzed', '375 behavioral segments'],
    ['Scenarios Evaluated', 'All saved scenarios'],
    ['Constraints Applied', Object.keys(constraints).length > 0 ?
      `Churn Cap: ${(constraints.churn_cap * 100).toFixed(1)}%` :
      'None'],
    ['Data Source', 'Streaming service visitor panel (50K records)'],
    ['Forecast Horizon', '12 months'],
    ['Confidence Level', '90%']
  ];

  audit.forEach(([label, value]) => {
    doc.setFont(undefined, 'bold');
    doc.text(`${label}:`, 20, y);
    doc.setFont(undefined, 'normal');
    doc.text(value, 80, y);
    y += 7;
  });

  // Disclaimer
  y += 15;
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const disclaimer = [
    'DISCLAIMER: This analysis is based on synthetic data and industry benchmarks.',
    'Results should be validated with actual business data before implementation.',
    'Elasticity coefficients are calibrated to streaming industry standards.',
    'Forecasts assume no significant market disruptions or competitive changes.'
  ];

  disclaimer.forEach(line => {
    doc.text(line, 20, y);
    y += 5;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Streaming Service Price Elasticity Demo | Confidential', 20, 285);
  doc.text('Page 5 of 5', 180, 285);
}

// ============================================================================
// XLSX Helper Functions
// ============================================================================

function createSummarySheet(top3) {
  const data = [
    ['Decision Pack Summary'],
    [`Generated: ${new Date().toLocaleDateString()}`],
    [],
    ['Rank', 'Scenario', 'Revenue', 'Subscribers', 'Churn', 'Risk', 'Score'],
  ];

  top3.forEach((s, i) => {
    data.push([
      i + 1,
      s.scenario_name || s.id,
      formatPercent(s.delta.revenue_pct, 1),
      formatPercent(s.delta.visitors_pct, 1),
      formatPercent(s.delta.churn_rate, 2) + 'pp',
      s.risk_level,
      s.decision_score.toFixed(1)
    ]);
  });

  return data;
}

function createScenariosSheet(scenarios) {
  const data = [
    ['All Scenarios'],
    [],
    ['ID', 'Name', 'Tier', 'Price', 'Revenue %', 'Subs %', 'Churn pp', 'ARPU %']
  ];

  scenarios.forEach(s => {
    data.push([
      s.id || s.scenario_id,
      s.scenario_name || s.name || '',
      s.scenario_config?.tier || '',
      s.scenario_config?.new_price || '',
      formatPercent(s.delta?.revenue_pct || 0, 1),
      formatPercent(s.delta?.visitors_pct || 0, 1),
      formatPercent((s.delta?.churn_rate || 0) * 100, 2),
      formatPercent(s.delta?.arpu_pct || 0, 1)
    ]);
  });

  return data;
}

function createKPISheet(scenarios) {
  const data = [
    ['KPI Details'],
    [],
    ['Scenario', 'Baseline Revenue', 'Forecast Revenue', 'Baseline Subs', 'Forecast Subs', 'Baseline Churn', 'Forecast Churn']
  ];

  scenarios.forEach(s => {
    data.push([
      s.scenario_name || s.id,
      formatCurrency(s.baseline?.revenue || 0),
      formatCurrency(s.forecasted?.revenue || 0),
      formatNumber(s.baseline?.visitors || s.baseline?.activeSubscribers || 0),
      formatNumber(s.forecasted?.visitors || s.forecasted?.activeSubscribers || 0),
      formatPercent((s.baseline?.churn_rate || 0) * 100, 2),
      formatPercent((s.forecasted?.churn_rate || s.forecasted?.churnRate || 0) * 100, 2)
    ]);
  });

  return data;
}

function createMetadataSheet() {
  return [
    ['Metadata'],
    [],
    ['Field', 'Value'],
    ['Analysis Date', new Date().toLocaleDateString()],
    ['Data Cut', '2024-12-31'],
    ['Model Version', 'v3.0'],
    ['Segments', '375'],
    ['Data Source', 'Streaming service synthetic panel'],
    ['Forecast Horizon', '12 months']
  ];
}

function getObjectiveName(objective) {
  const names = {
    'growth-max': 'Growth Maximization',
    'revenue-max': 'Revenue Maximization',
    'churn-capped': 'Churn-Capped (Retention)',
    'mix-targeted': 'Mix-Shift (Tier Optimization)'
  };
  return names[objective] || objective;
}
