/**
 * Segment Charts Module
 * Visualization functions for customer segmentation and elasticity analysis
 *
 * Dependencies: D3.js v7, segmentation-engine.js
 */

/**
 * Render segment KPI dashboard cards
 * @param {string} containerId - DOM element ID
 * @param {Object} aggregatedKPIs - From segmentEngine.aggregateKPIs()
 */
export function renderSegmentKPICards(containerId, aggregatedKPIs) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();

    if (!aggregatedKPIs || aggregatedKPIs.total_visitors === 0) {
        container.append('p')
            .attr('class', 'text-muted text-center')
            .text('No segments match the selected filters.');
        return;
    }

    // Helper to safely format numbers, replacing NaN/null/undefined with 0
    const safeNumber = (val, defaultVal = 0) => {
        if (val === null || val === undefined || isNaN(val)) return defaultVal;
        return val;
    };

    const kpiData = [
        {
            label: 'Total Visitors',
            value: safeNumber(aggregatedKPIs.total_visitors, 0).toLocaleString(),
            icon: 'bi-people-fill',
            color: '#667eea'
        },
        {
            label: 'Avg Return Rate',
            value: `${(safeNumber(aggregatedKPIs.weighted_return_rate, 0) * 100).toFixed(2)}%`,
            icon: 'bi-arrow-repeat',
            color: '#f093fb'
        },
        {
            label: 'Avg Revenue Per Visit',
            value: `$${safeNumber(aggregatedKPIs.weighted_arpv, 0).toFixed(2)}`,
            icon: 'bi-currency-dollar',
            color: '#4facfe'
        },
        {
            label: 'Avg Visits Per Year',
            value: safeNumber(aggregatedKPIs.weighted_visits_per_year, 0).toFixed(1),
            icon: 'bi-calendar-check',
            color: '#43e97b'
        },
        {
            label: 'Active Cohorts',
            value: safeNumber(aggregatedKPIs.segment_count, 0),
            icon: 'bi-diagram-3-fill',
            color: '#fa709a'
        }
    ];

    const cardContainer = container.append('div')
        .attr('class', 'row g-3');

    const cards = cardContainer.selectAll('.col')
        .data(kpiData)
        .join('div')
        .attr('class', 'col-md-6 col-lg')
        .append('div')
        .attr('class', 'card kpi-card h-100')
        .style('border-left', d => `4px solid ${d.color}`);

    const cardBody = cards.append('div')
        .attr('class', 'card-body');

    cardBody.append('div')
        .attr('class', 'd-flex justify-content-between align-items-start mb-2');

    cardBody.append('i')
        .attr('class', d => `${d.icon} fs-2 mb-2`)
        .style('color', d => d.color);

    cardBody.append('div')
        .attr('class', 'text-muted small text-uppercase mb-1')
        .text(d => d.label);

    cardBody.append('div')
        .attr('class', 'fs-4 fw-bold')
        .text(d => d.value);
}

/**
 * Render enhanced elasticity heatmap with segment filtering
 * @param {string} containerId - DOM element ID
 * @param {string} tier - Subscription tier
 * @param {Object} filters - Segment filters
 * @param {string} axis - Analysis axis ('engagement', 'monetization', 'acquisition')
 */
export function renderSegmentElasticityHeatmap(containerId, tier, filters = {}, axis = 'engagement') {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    container.style('position', 'relative');

    // Get filtered segments
    const segments = window.segmentEngine.filterSegments(filters);

    if (!segments || segments.length === 0) {
        container.append('p')
            .attr('class', 'alert alert-warning')
            .text('No segments match the selected filters.');
        return;
    }

    // Filter segments for the selected tier
    const tierSegments = segments.filter(s => s.tier === tier);

    if (tierSegments.length === 0) {
        container.append('p')
            .attr('class', 'alert alert-info')
            .text(`No ${tier} segments match the selected filters.`);
        return;
    }

    // Prepare heatmap data
    const heatmapData = [];
    tierSegments.forEach(seg => {
        // Use getElasticity which handles axis mapping and cohort adjustments
        const elasticity = window.segmentEngine.getElasticity(tier, seg.compositeKey, axis);

        heatmapData.push({
            compositeKey: seg.compositeKey,
            acquisition: seg.acquisition,
            engagement: seg.engagement,
            monetization: seg.monetization,
            elasticity: elasticity,
            // Use cohort-adjusted KPIs from segment data
            kpi: axis === 'engagement' ? seg.avg_return_rate :
                axis === 'monetization' ? seg.avg_arpv :
                    seg.avg_cac,
            visitors: parseInt(seg.visitor_count || 0)
        });
    });

    // Set up dimensions
    const margin = { top: 80, right: 120, bottom: 100, left: 150 };
    const cellSize = 60;

    // Determine axes based on selected analysis axis
    let xCategories, yCategories, xLabel, yLabel;

    if (axis === 'acquisition') {
        xCategories = window.segmentEngine.axisDefinitions.acquisition;
        yCategories = window.segmentEngine.axisDefinitions.engagement;
        xLabel = 'Visit Frequency';
        yLabel = 'Party Composition';
    } else if (axis === 'engagement') {
        xCategories = window.segmentEngine.axisDefinitions.engagement;
        yCategories = window.segmentEngine.axisDefinitions.monetization;
        xLabel = 'Party Composition';
        yLabel = 'Price Sensitivity';
    } else {
        xCategories = window.segmentEngine.axisDefinitions.monetization;
        yCategories = window.segmentEngine.axisDefinitions.acquisition;
        xLabel = 'Price Sensitivity';
        yLabel = 'Visit Frequency';
    }

    const width = xCategories.length * cellSize;
    const height = yCategories.length * cellSize;

    const svg = container.append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3.scaleBand()
        .domain(xCategories)
        .range([0, width])
        .padding(0.05);

    const yScale = d3.scaleBand()
        .domain(yCategories)
        .range([0, height])
        .padding(0.05);

    // Color scale - axis-aware direction
    const elasticityExtent = d3.extent(heatmapData, d => d.elasticity);

    let colorScale;
    if (axis === 'engagement') {
        // Engagement (churn): POSITIVE values, higher = worse
        // Domain: [low, high] maps to [green, red]
        colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
            .domain([elasticityExtent[1], elasticityExtent[0]]);  // Reverse: high = red
    } else if (axis === 'acquisition') {
        // Acquisition: NEGATIVE values, more negative = worse
        // Domain: [more negative, less negative] maps to [red, green]
        colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
            .domain([elasticityExtent[0], elasticityExtent[1]]);  // More negative = red
    } else {
        // Monetization (migration): POSITIVE values, higher = more switching
        // Domain: [low, high] maps to [green, red]
        colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
            .domain([elasticityExtent[1], elasticityExtent[0]]);  // Reverse: high = red
    }

    // Create tooltip
    const tooltip = container.append('div')
        .attr('class', 'position-absolute bg-dark text-white p-2 rounded shadow-sm')
        .style('display', 'none')
        .style('pointer-events', 'none')
        .style('font-size', '12px')
        .style('z-index', '1000');

    // Draw cells
    const cells = svg.selectAll('.heatmap-cell')
        .data(heatmapData)
        .join('g')
        .attr('class', 'heatmap-cell');

    // Get x/y coordinates based on axis
    const getX = d => axis === 'acquisition' ? d.acquisition :
        axis === 'engagement' ? d.engagement : d.monetization;
    const getY = d => axis === 'acquisition' ? d.engagement :
        axis === 'engagement' ? d.monetization : d.acquisition;

    cells.append('rect')
        .attr('x', d => xScale(getX(d)))
        .attr('y', d => yScale(getY(d)))
        .attr('width', xScale.bandwidth())
        .attr('height', yScale.bandwidth())
        .attr('fill', d => colorScale(d.elasticity))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('rx', 4)
        .style('cursor', 'pointer')
        .on('mouseenter', function (event, d) {
            d3.select(this)
                .attr('stroke-width', 4)
                .attr('stroke', '#000');

            const segmentSummary = window.segmentEngine.generateSegmentSummary(d.compositeKey, {
                visitor_count: d.visitors,
                avg_return_rate: axis === 'engagement' ? d.kpi : 0.12,
                avg_arpv: axis === 'monetization' ? d.kpi : 20
            });

            // Calculate position relative to container
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip
                .style('display', 'block')
                .style('left', (x + 15) + 'px')
                .style('top', (y - 30) + 'px')
                .html(`
                    <strong>${window.segmentEngine.formatCompositeKey(d.compositeKey)}</strong><br>
                    <em class="text-white-50" style="font-size: 11px;">${segmentSummary}</em><br>
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
                        <strong>Elasticity:</strong> ${d.elasticity.toFixed(2)}<br>
                        <strong>${axis === 'engagement' ? 'Return Rate' :
                        axis === 'monetization' ? 'ARPV' : 'CAC Sensitivity'}:</strong>
                        ${axis === 'engagement' ? (d.kpi * 100).toFixed(2) + '%' :
                        axis === 'monetization' ? '$' + d.kpi.toFixed(2) : d.kpi.toFixed(2)}<br>
                        <strong>Visitors:</strong> ${d.visitors.toLocaleString()}
                    </div>
                `);
        })
        .on('mousemove', function (event) {
            // Calculate position relative to container
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip
                .style('left', (x + 15) + 'px')
                .style('top', (y - 30) + 'px');
        })
        .on('mouseleave', function () {
            d3.select(this)
                .attr('stroke-width', 2)
                .attr('stroke', '#fff');

            tooltip.style('display', 'none');
        });

    // Add text values
    cells.append('text')
        .attr('x', d => xScale(getX(d)) + xScale.bandwidth() / 2)
        .attr('y', d => yScale(getY(d)) + yScale.bandwidth() / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .attr('fill', d => d.elasticity < -1.8 ? '#fff' : '#000')
        .attr('pointer-events', 'none')
        .text(d => d.elasticity.toFixed(2));

    // X axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickFormat(d => window.segmentEngine.formatSegmentLabel(d)))
        .selectAll('text')
        .attr('transform', 'rotate(-45)')
        .style('text-anchor', 'end')
        .attr('dx', '-0.8em')
        .attr('dy', '0.15em');

    // Y axis
    svg.append('g')
        .call(d3.axisLeft(yScale).tickFormat(d => window.segmentEngine.formatSegmentLabel(d)));

    // X axis label
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + margin.bottom - 10)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .text(xLabel);

    // Y axis label
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -margin.left + 20)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .text(yLabel);

    // Title
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', -margin.top / 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', '16px')
        .attr('font-weight', 'bold')
        .text(`${window.segmentEngine.axisLabels[axis]} - ${tier.replace('_', ' ').toUpperCase()}`);

    // Legend
    const legendWidth = 20;
    const legendHeight = height / 2;
    const legend = svg.append('g')
        .attr('transform', `translate(${width + 20}, ${height / 4})`);

    const legendScale = d3.scaleLinear()
        .domain(colorScale.domain())
        .range([legendHeight, 0]);

    const legendAxis = d3.axisRight(legendScale)
        .ticks(5)
        .tickFormat(d => d.toFixed(1));

    // Gradient
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
        .attr('id', `legend-gradient-${containerId}`)
        .attr('x1', '0%')
        .attr('y1', '100%')
        .attr('x2', '0%')
        .attr('y2', '0%');

    gradient.selectAll('stop')
        .data(d3.range(0, 1.01, 0.01))
        .join('stop')
        .attr('offset', d => `${d * 100}%`)
        .attr('stop-color', d => {
            const value = legendScale.invert(legendHeight * (1 - d));
            return colorScale(value);
        });

    legend.append('rect')
        .attr('width', legendWidth)
        .attr('height', legendHeight)
        .style('fill', `url(#legend-gradient-${containerId})`);

    legend.append('g')
        .attr('transform', `translate(${legendWidth}, 0)`)
        .call(legendAxis);

    legend.append('text')
        .attr('x', legendWidth / 2)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .text('Elasticity');
}

/**
 * Render 3-axis radial visualization
 * @param {string} containerId - DOM element ID
 * @param {string} tier - Subscription tier
 * @param {string} highlightSegment - Optional segment composite key to highlight
 */
export function render3AxisRadialChart(containerId, tier, highlightSegment = null) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();

    // Get segments for the selected tier
    const segments = window.segmentEngine.getSegmentsForTier(tier);

    if (!segments || segments.length === 0) {
        container.append('div')
            .attr('class', 'alert alert-warning')
            .html(`<p class="mb-0">No segment data available for tier: ${tier}</p>`);
        return;
    }

    // Set container to relative positioning for tooltip
    container.style('position', 'relative');

    // Add beginner-friendly explanation panel at the top
    const explanationPanel = container.append('div')
        .attr('class', 'alert alert-info border-info mb-3')
        .style('font-size', '13px')
        .html(`
            <div class="d-flex align-items-start">
                <i class="bi bi-info-circle-fill me-2 mt-1" style="font-size: 18px;"></i>
                <div>
                    <strong>How to Read This Chart:</strong> Each bubble represents a visitor segment.
                    <ul class="mb-0 mt-2 small">
                        <li><strong>Position:</strong> Shows visitor characteristics on 3 dimensions (closer to an axis = stronger trait)</li>
                        <li><strong>Size:</strong> Larger bubbles = more visitors in that segment</li>
                        <li><strong>Color:</strong> <span style="color: #22c55e;">●</span> Green = High (>70%) |
                            <span style="color: #f97316;">●</span> Orange = Medium (40-70%) |
                            <span style="color: #ef4444;">●</span> Red = Low (<40%)</li>
                        <li><strong>Hover:</strong> See detailed visitor counts, return rates, and spending patterns</li>
                    </ul>
                </div>
            </div>
        `);

    // Dimensions
    const width = 1000;
    const height = 850;
    const centerX = width / 2;
    const centerY = height / 2;
    const axisLength = 280;

    // Create SVG
    const svg = container.append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background', '#fafafa');

    // Define three axes at 120° apart with beginner-friendly descriptions
    const axes = [
        {
            name: 'Price Sensitivity',
            subtitle: '(How much visitors are willing to spend)',
            key: 'monetization',
            color: '#2563eb', // Blue
            angle: 90, // Vertical (up)
            segments: window.segmentEngine.axisDefinitions.monetization,
            examples: {
                budget: 'Most price-conscious',
                luxury: 'Willing to pay premium'
            }
        },
        {
            name: 'Party Composition',
            subtitle: '(Who visits together)',
            key: 'engagement',
            color: '#22c55e', // Green
            angle: 210, // Left diagonal (210°)
            segments: window.segmentEngine.axisDefinitions.engagement,
            examples: {
                solo: 'Individual visitors',
                family_large: 'Large family groups'
            }
        },
        {
            name: 'Visit Frequency',
            subtitle: '(How often they come)',
            key: 'acquisition',
            color: '#ef4444', // Red
            angle: 330, // Right diagonal (330°)
            segments: window.segmentEngine.axisDefinitions.acquisition,
            examples: {
                one_time: 'Rarely visit',
                season_pass: 'Very frequent visitors'
            }
        }
    ];

    // Create tooltip
    const tooltip = container.append('div')
        .attr('class', 'position-absolute bg-dark text-white p-3 rounded shadow')
        .style('display', 'none')
        .style('pointer-events', 'none')
        .style('font-size', '12px')
        .style('z-index', '1000')
        .style('max-width', '320px');

    // Draw concentric circles for depth perception
    [0.33, 0.66, 1.0].forEach((ratio, i) => {
        svg.append('circle')
            .attr('cx', centerX)
            .attr('cy', centerY)
            .attr('r', axisLength * ratio)
            .attr('fill', 'none')
            .attr('stroke', '#e5e7eb')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,4')
            .attr('opacity', 0.4);
    });

    // Add center point
    svg.append('circle')
        .attr('cx', centerX)
        .attr('cy', centerY)
        .attr('r', 6)
        .attr('fill', '#94a3b8')
        .attr('opacity', 0.6);

    // Define arrow marker for axes
    svg.append('defs').selectAll('marker')
        .data(axes)
        .join('marker')
        .attr('id', d => `arrow-${d.key}`)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 8)
        .attr('refY', 5)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M 0 0 L 10 5 L 0 10 z')
        .attr('fill', d => d.color);

    // Draw axes
    axes.forEach(axis => {
        const radians = (axis.angle * Math.PI) / 180;
        const endX = centerX + Math.cos(radians) * axisLength;
        const endY = centerY - Math.sin(radians) * axisLength;

        // Axis line with arrow
        svg.append('line')
            .attr('x1', centerX)
            .attr('y1', centerY)
            .attr('x2', endX)
            .attr('y2', endY)
            .attr('stroke', axis.color)
            .attr('stroke-width', 3)
            .attr('opacity', 0.7)
            .attr('marker-end', `url(#arrow-${axis.key})`);

        // Axis label (at the end) - Main title
        const labelDistance = 30;
        const labelX = centerX + Math.cos(radians) * (axisLength + labelDistance);
        const labelY = centerY - Math.sin(radians) * (axisLength + labelDistance);

        svg.append('text')
            .attr('x', labelX)
            .attr('y', labelY)
            .attr('text-anchor', 'middle')
            .attr('fill', axis.color)
            .attr('font-weight', 'bold')
            .attr('font-size', '14px')
            .text(axis.name);

        // Axis subtitle (below main label)
        svg.append('text')
            .attr('x', labelX)
            .attr('y', labelY + 15)
            .attr('text-anchor', 'middle')
            .attr('fill', axis.color)
            .attr('font-size', '10px')
            .attr('opacity', 0.8)
            .text(axis.subtitle);

        // Plot segment markers along the axis
        axis.segments.forEach((segmentId, index) => {
            const ratio = (index + 1) / (axis.segments.length + 1);
            const pointX = centerX + Math.cos(radians) * axisLength * ratio;
            const pointY = centerY - Math.sin(radians) * axisLength * ratio;

            // Segment label
            const labelInfo = window.segmentEngine.getSegmentInfo(segmentId);
            const label = labelInfo ? labelInfo.label : segmentId;

            // Position label perpendicular to axis
            const labelOffsetAngle = radians + Math.PI / 2;
            const labelOffset = 20;
            const textX = pointX + Math.cos(labelOffsetAngle) * labelOffset;
            const textY = pointY - Math.sin(labelOffsetAngle) * labelOffset;

            svg.append('text')
                .attr('x', textX)
                .attr('y', textY)
                .attr('text-anchor', 'middle')
                .attr('font-size', '9px')
                .attr('fill', '#666')
                .text(label.length > 15 ? label.substring(0, 13) + '...' : label);

            // Marker circle
            svg.append('circle')
                .attr('cx', pointX)
                .attr('cy', pointY)
                .attr('r', 4)
                .attr('fill', axis.color)
                .attr('opacity', 0.4);
        });
    });

    // Plot actual customer segments as data points
    // Group segments by their 3-axis position and aggregate
    const segmentMap = new Map();

    segments.forEach(seg => {
        const key = seg.compositeKey;
        if (!segmentMap.has(key)) {
            segmentMap.set(key, {
                compositeKey: key,
                acquisition: seg.acquisition,
                engagement: seg.engagement,
                monetization: seg.monetization,
                visitor_count: parseInt(seg.visitor_count) || 0,
                avg_return_rate: parseFloat(seg.avg_return_rate) || 0,
                avg_arpv: parseFloat(seg.avg_arpv) || 0
            });
        }
    });

    // Calculate positions for each segment in 3D space
    const segmentPositions = Array.from(segmentMap.values()).map(seg => {
        // Find index position on each axis
        const monetizationIdx = axes[0].segments.indexOf(seg.monetization);
        const engagementIdx = axes[1].segments.indexOf(seg.engagement);
        const acquisitionIdx = axes[2].segments.indexOf(seg.acquisition);

        // Calculate ratios (0 to 1) for each axis
        const monetizationRatio = (monetizationIdx + 1) / (axes[0].segments.length + 1);
        const engagementRatio = (engagementIdx + 1) / (axes[1].segments.length + 1);
        const acquisitionRatio = (acquisitionIdx + 1) / (axes[2].segments.length + 1);

        // Calculate vector for each axis
        const radians0 = (axes[0].angle * Math.PI) / 180;
        const radians1 = (axes[1].angle * Math.PI) / 180;
        const radians2 = (axes[2].angle * Math.PI) / 180;

        // Sum the vectors (weighted by position on each axis)
        const x = centerX +
            Math.cos(radians0) * axisLength * monetizationRatio +
            Math.cos(radians1) * axisLength * engagementRatio +
            Math.cos(radians2) * axisLength * acquisitionRatio;

        const y = centerY -
            Math.sin(radians0) * axisLength * monetizationRatio -
            Math.sin(radians1) * axisLength * engagementRatio -
            Math.sin(radians2) * axisLength * acquisitionRatio;

        return {
            ...seg,
            x,
            y,
            monetizationIdx,
            engagementIdx,
            acquisitionIdx
        };
    });

    // Determine radius scale based on visitor count
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(segmentPositions, d => d.visitor_count)])
        .range([3, 20]);

    // Color scale based on return rate - Matching the Legend
    const getSegmentColor = (rate) => {
        if (rate >= 0.70) return '#22c55e'; // High - Green
        if (rate >= 0.40) return '#f97316'; // Medium - Orange
        return '#ef4444'; // Low - Red
    };

    // Draw segment data points
    svg.selectAll('.segment-point')
        .data(segmentPositions)
        .join('circle')
        .attr('class', 'segment-point')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', d => radiusScale(d.visitor_count))
        .attr('fill', d => getSegmentColor(d.avg_return_rate))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseenter', function (event, d) {
            // Highlight current segment
            d3.select(this)
                .attr('opacity', 1)
                .attr('stroke-width', 4)
                .attr('stroke', '#fbbf24'); // Gold highlight

            // Dim all other segments
            svg.selectAll('.segment-point')
                .filter(function (otherD) { return otherD !== d; })
                .attr('opacity', 0.2);

            const segmentInfo = window.segmentEngine.formatCompositeKey(d.compositeKey);
            const segmentSummary = window.segmentEngine.generateSegmentSummary(d.compositeKey, {
                visitor_count: d.visitor_count,
                avg_return_rate: d.avg_return_rate,
                avg_arpv: d.avg_arpv
            });

            // Calculate position relative to container
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            // Get human-readable labels for each axis
            const acqInfo = window.segmentEngine.getSegmentInfo(d.acquisition);
            const engInfo = window.segmentEngine.getSegmentInfo(d.engagement);
            const monInfo = window.segmentEngine.getSegmentInfo(d.monetization);

            // Calculate percentage of total visitors
            const totalVisitors = segmentPositions.reduce((sum, s) => sum + s.visitor_count, 0);
            const visitorPct = ((d.visitor_count / totalVisitors) * 100).toFixed(1);

            // Return rate quality indicator
            const returnQuality = d.avg_return_rate > 0.75 ? '🟢 Excellent' :
                d.avg_return_rate > 0.60 ? '🟡 Good' :
                    d.avg_return_rate > 0.40 ? '🟠 Fair' : '🔴 At Risk';

            tooltip
                .style('display', 'block')
                .style('left', (x + 15) + 'px')
                .style('top', (y - 30) + 'px')
                .html(`
                    <div style="font-size: 13px;">
                        <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #fbbf24;">
                            ${segmentInfo}
                        </div>
                        <div style="font-size: 11px; color: rgba(255,255,255,0.7); margin-bottom: 10px;">
                            ${segmentSummary}
                        </div>
                        <div style="padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.2);">
                            <div style="margin-bottom: 4px;"><strong>👥 Visitors:</strong> ${d.visitor_count.toLocaleString()} <span style="color: rgba(255,255,255,0.6);">(${visitorPct}% of tier)</span></div>
                            <div style="margin-bottom: 4px;"><strong>🔁 Return Rate:</strong> ${(d.avg_return_rate * 100).toFixed(1)}% ${returnQuality}</div>
                            <div><strong>💰 Avg Spend:</strong> $${d.avg_arpv.toFixed(2)} per visit</div>
                        </div>
                        <div style="padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 10px; color: rgba(255,255,255,0.6);">
                            <div style="margin-bottom: 2px;"><span style="color: #ef4444;">●</span> ${acqInfo ? acqInfo.label : d.acquisition}</div>
                            <div style="margin-bottom: 2px;"><span style="color: #22c55e;">●</span> ${engInfo ? engInfo.label : d.engagement}</div>
                            <div><span style="color: #2563eb;">●</span> ${monInfo ? monInfo.label : d.monetization}</div>
                        </div>
                    </div>
                `);
        })
        .on('mousemove', function (event) {
            // Calculate position relative to container
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip
                .style('left', (x + 15) + 'px')
                .style('top', (y - 30) + 'px');
        })
        .on('mouseleave', function () {
            // Restore all segments to original state
            svg.selectAll('.segment-point')
                .attr('opacity', 0.7)
                .attr('stroke-width', 2)
                .attr('stroke', '#fff');

            tooltip.style('display', 'none');
        })
        .on('click', function (event, d) {
            // Future: Show detailed segment analysis
        });

    // Add clean, professional legend
    const legendX = width - 190;
    const legendY = 60;

    // Legend background with shadow
    svg.append('rect')
        .attr('x', legendX - 15)
        .attr('y', legendY - 15)
        .attr('width', 180)
        .attr('height', 330)
        .attr('fill', '#ffffff')
        .attr('stroke', '#cbd5e1')
        .attr('stroke-width', 1.5)
        .attr('rx', 10)
        .attr('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))');

    const legend = svg.append('g')
        .attr('transform', `translate(${legendX}, ${legendY})`);

    // Legend title
    legend.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('font-weight', 'bold')
        .attr('font-size', '14px')
        .attr('fill', '#1e293b')
        .text('Legend');

    // Horizontal separator line
    legend.append('line')
        .attr('x1', 0)
        .attr('y1', 10)
        .attr('x2', 150)
        .attr('y2', 10)
        .attr('stroke', '#e2e8f0')
        .attr('stroke-width', 1);

    // SECTION 1: Bubble Size
    legend.append('text')
        .attr('x', 0)
        .attr('y', 30)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#475569')
        .text('Bubble Size');

    legend.append('text')
        .attr('x', 0)
        .attr('y', 42)
        .attr('font-size', '9px')
        .attr('fill', '#94a3b8')
        .text('Number of visitors in segment');

    const maxVisitors = d3.max(segmentPositions, d => d.visitor_count) || 10000;

    // Round to nice numbers (nearest 10 or 100)
    const roundToNice = (num) => {
        if (num < 100) return Math.round(num / 10) * 10 || 10;
        if (num < 1000) return Math.round(num / 50) * 50;
        return Math.round(num / 100) * 100;
    };

    const sizeExamples = [
        { count: roundToNice(maxVisitors * 0.15), label: 'Small' },
        { count: roundToNice(maxVisitors * 0.45), label: 'Medium' },
        { count: roundToNice(maxVisitors * 0.85), label: 'Large' }
    ];

    sizeExamples.forEach((example, i) => {
        const r = radiusScale(example.count);
        const yPos = 62 + i * 28;

        legend.append('circle')
            .attr('cx', 20)
            .attr('cy', yPos)
            .attr('r', r)
            .attr('fill', '#8b5cf6')
            .attr('opacity', 0.7)
            .attr('stroke', '#fff')
            .attr('stroke-width', 2);

        legend.append('text')
            .attr('x', 40)
            .attr('y', yPos - 4)
            .attr('font-size', '10px')
            .attr('font-weight', '500')
            .attr('fill', '#334155')
            .text(example.label);

        legend.append('text')
            .attr('x', 40)
            .attr('y', yPos + 7)
            .attr('font-size', '9px')
            .attr('fill', '#94a3b8')
            .text(example.count.toLocaleString());
    });

    // SECTION 2: Color Coding
    const colorSectionY = 170;

    legend.append('text')
        .attr('x', 0)
        .attr('y', colorSectionY)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#475569')
        .text('Bubble Color');

    legend.append('text')
        .attr('x', 0)
        .attr('y', colorSectionY + 12)
        .attr('font-size', '9px')
        .attr('fill', '#94a3b8')
        .text('Visitor return rate (retention)');

    // High return rate (green) - stacked vertically
    legend.append('circle')
        .attr('cx', 20)
        .attr('cy', colorSectionY + 32)
        .attr('r', 9)
        .attr('fill', '#22c55e')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

    legend.append('text')
        .attr('x', 40)
        .attr('y', colorSectionY + 28)
        .attr('font-size', '10px')
        .attr('fill', '#22c55e')
        .attr('font-weight', '600')
        .text('High Return Rate');

    legend.append('text')
        .attr('x', 40)
        .attr('y', colorSectionY + 39)
        .attr('font-size', '8px')
        .attr('fill', '#94a3b8')
        .text('(>70% - Good retention)');

    // Medium return rate (orange)
    legend.append('circle')
        .attr('cx', 20)
        .attr('cy', colorSectionY + 62)
        .attr('r', 9)
        .attr('fill', '#f97316')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

    legend.append('text')
        .attr('x', 40)
        .attr('y', colorSectionY + 58)
        .attr('font-size', '10px')
        .attr('fill', '#f97316')
        .attr('font-weight', '600')
        .text('Medium Return Rate');

    legend.append('text')
        .attr('x', 40)
        .attr('y', colorSectionY + 69)
        .attr('font-size', '8px')
        .attr('fill', '#94a3b8')
        .text('(40-70% - Fair retention)');

    // Low return rate (red)
    legend.append('circle')
        .attr('cx', 20)
        .attr('cy', colorSectionY + 92)
        .attr('r', 9)
        .attr('fill', '#ef4444')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

    legend.append('text')
        .attr('x', 40)
        .attr('y', colorSectionY + 88)
        .attr('font-size', '10px')
        .attr('fill', '#ef4444')
        .attr('font-weight', '600')
        .text('Low Return Rate');

    legend.append('text')
        .attr('x', 40)
        .attr('y', colorSectionY + 99)
        .attr('font-size', '8px')
        .attr('fill', '#94a3b8')
        .text('(<40% - Retention risk)');

    // Center title
    svg.append('text')
        .attr('x', centerX)
        .attr('y', 30)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .attr('font-size', '18px')
        .attr('fill', '#1e293b')
        .text(`Visitor Segments - ${tier.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Tier`);

    svg.append('text')
        .attr('x', centerX)
        .attr('y', 48)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('fill', '#64748b')
        .text('Each bubble is a unique visitor segment. Hover to explore details.');
}

/**
 * Render scatter plot of segments (Elasticity vs Visitor Count)
 * @param {string} containerId - DOM element ID
 * @param {string} tier - Membership tier
 */
export function renderSegmentScatterPlot(containerId, tier) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    container.style('position', 'relative');

    const segments = window.segmentEngine.getSegmentsForTier(tier);
    if (!segments || segments.length === 0) {
        container.append('div')
            .attr('class', 'alert alert-warning')
            .html('<p>No segment data available</p>');
        return;
    }

    // Prepare data
    // Prepare data with robust fallbacks
    const data = segments.map(seg => {
        // Robust extraction for return rate (or inverse churn)
        let returnRate = 0;
        if (seg.avg_return_rate !== undefined) {
            returnRate = parseFloat(seg.avg_return_rate);
        } else if (seg.avg_churn_rate !== undefined) {
            returnRate = 1 - parseFloat(seg.avg_churn_rate);
        }

        // Robust extraction for revenue metric
        let revenueMetric = 0;
        if (seg.avg_arpv !== undefined) {
            revenueMetric = parseFloat(seg.avg_arpv);
        } else if (seg.avg_arpu !== undefined) {
            revenueMetric = parseFloat(seg.avg_arpu);
        }

        return {
            compositeKey: seg.compositeKey,
            visitors: parseInt(seg.visitor_count) || 0,
            return_rate: returnRate,
            revenue_metric: revenueMetric,
            elasticity: window.segmentEngine.getElasticity(tier, seg.compositeKey, 'engagement') || -2.0
        };
    }).filter(d => d.visitors > 0);

    // Set up dimensions with generous margins
    const margin = { top: 70, right: 180, bottom: 100, left: 100 };
    const width = 950 - margin.left - margin.right;
    const height = 650 - margin.top - margin.bottom;

    const svg = container.append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .style('background', '#ffffff') // Solid white background for max contrast
        .style('border-radius', '8px')
        .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1)')
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Add Title
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', -35)
        .attr('text-anchor', 'middle')
        .attr('font-weight', '800')
        .attr('font-size', '20px')
        .attr('fill', '#0f172a')
        .text(`Segment Analysis - ${tier.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}`);

    // scales
    const xMax = d3.max(data, d => d.visitors) || 1000;
    const yMin = d3.min(data, d => d.elasticity) || -2.0;
    const yMax = d3.max(data, d => d.elasticity) || 0;
    const maxBubbleRadius = d3.max(data, d => d.revenue_metric) || 100;

    // Calculate max radius for padding
    const radiusScaleTemp = d3.scaleSqrt()
        .domain([0, maxBubbleRadius])
        .range([6, 22]);
    const maxRadius = radiusScaleTemp(maxBubbleRadius);

    // Add padding that accounts for bubble sizes
    // Convert pixel radius back to data units for proper padding
    const xPadding = (xMax * 0.05) + (maxRadius * xMax / width); // 5% + bubble size
    const yPadding = Math.abs(yMin) * 0.1; // 10% padding

    const xScale = d3.scaleLinear()
        .domain([0, xMax + xPadding])
        .range([0, width])
        .nice();

    const yScale = d3.scaleLinear()
        .domain([yMin - yPadding, yMax + 0.5]) // Padding on both ends
        .range([height, 0])
        .nice();

    const getScatterColor = (rate) => {
        if (rate >= 0.70) return '#16a34a'; // High - Vibrant Green
        if (rate >= 0.40) return '#f97316'; // Medium - Vibrant Orange
        return '#dc2626'; // Low - Vibrant Red
    };

    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(data, d => d.revenue_metric) || 100])
        .range([6, 22]);

    // Gridlines X (Vertical)
    svg.append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickSize(-height).tickFormat('').ticks(10))
        .attr('stroke-opacity', 0.1)
        .attr('stroke', '#000');

    // Gridlines Y (Horizontal)
    svg.append('g')
        .attr('class', 'grid')
        .call(d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(10))
        .attr('stroke-opacity', 0.1)
        .attr('stroke', '#000');

    // Axes
    const xAxis = d3.axisBottom(xScale)
        .tickFormat(d => d >= 1000 ? (d / 1000).toFixed(0) + 'k' : d)
        .tickPadding(10);
    const yAxis = d3.axisLeft(yScale)
        .tickPadding(10);

    const gX = svg.append('g').attr('transform', `translate(0,${height})`).call(xAxis);
    gX.selectAll('path').attr('stroke', '#0f172a').attr('stroke-width', '2px');
    gX.selectAll('line').attr('stroke', '#0f172a').attr('stroke-width', '1px');
    gX.selectAll('text').attr('fill', '#0f172a').attr('font-weight', '600').attr('font-size', '12px');

    const gY = svg.append('g').call(yAxis);
    gY.selectAll('path').attr('stroke', '#0f172a').attr('stroke-width', '2px');
    gY.selectAll('line').attr('stroke', '#0f172a').attr('stroke-width', '1px');
    gY.selectAll('text').attr('fill', '#0f172a').attr('font-weight', '600').attr('font-size', '12px');

    // Reference Lines (Industry Standard) - Averages
    const avgVisitors = d3.mean(data, d => d.visitors);
    const avgElasticity = d3.mean(data, d => d.elasticity);

    if (avgVisitors) {
        svg.append('line')
            .attr('x1', xScale(avgVisitors))
            .attr('x2', xScale(avgVisitors))
            .attr('y1', 0)
            .attr('y2', height)
            .attr('stroke', '#64748b')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,4');

        svg.append('text')
            .attr('x', xScale(avgVisitors) + 5)
            .attr('y', 20)
            .attr('font-size', '11px')
            .attr('fill', '#64748b')
            .text(`Avg Visitors: ${Math.round(avgVisitors).toLocaleString()}`);
    }

    if (avgElasticity) {
        svg.append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', yScale(avgElasticity))
            .attr('y2', yScale(avgElasticity))
            .attr('stroke', '#64748b')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,4');

        svg.append('text')
            .attr('x', width - 10)
            .attr('y', yScale(avgElasticity) - 5)
            .attr('text-anchor', 'end')
            .attr('font-size', '11px')
            .attr('fill', '#64748b')
            .text(`Avg Elasticity: ${avgElasticity.toFixed(2)}`);
    }

    // Axis labels (Larger and bolder)
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 60)
        .attr('text-anchor', 'middle')
        .attr('font-weight', '800')
        .attr('font-size', '16px')
        .attr('fill', '#0f172a')
        .text('Visitor Count (Segment Size)');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -70)
        .attr('text-anchor', 'middle')
        .attr('font-weight', '800')
        .attr('font-size', '16px')
        .attr('fill', '#0f172a')
        .text('Price Elasticity (Sensitivity)');

    // Tooltip
    const tooltip = container.append('div')
        .attr('class', 'position-absolute bg-dark text-white p-3 rounded shadow')
        .style('display', 'none')
        .style('pointer-events', 'none')
        .style('z-index', '1000')
        .style('min-width', '220px')
        .style('font-size', '13px')
        .style('border', '1px solid rgba(255,255,255,0.1)');

    // Plot points with white stroke for separation
    svg.selectAll('.segment-point')
        .data(data)
        .join('circle')
        .attr('class', 'segment-point')
        .attr('cx', d => xScale(d.visitors))
        .attr('cy', d => yScale(d.elasticity))
        .attr('r', d => radiusScale(d.revenue_metric))
        .attr('fill', d => getScatterColor(d.return_rate))
        .attr('opacity', 0.75) // Slightly clearer
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .on('mouseenter', function (event, d) {
            d3.select(this)
                .attr('opacity', 1)
                .attr('stroke-width', 3)
                .attr('stroke', '#0f172a'); // Dark stroke on hover

            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip.style('display', 'block')
                .style('left', x + 15 + 'px')
                .style('top', y - 20 + 'px')
                .html(`
                    <div class="fw-bold mb-2" style="font-size:14px; color:#fbbf24">${window.segmentEngine.formatCompositeKey(d.compositeKey)}</div>
                    <div style="border-top:1px solid #555; padding-top:6px;">
                        <div class="d-flex justify-content-between mb-1"><span style="opacity:0.8">Visitors:</span> <span class="fw-bold">${d.visitors.toLocaleString()}</span></div>
                        <div class="d-flex justify-content-between mb-1"><span style="opacity:0.8">Elasticity:</span> <span class="fw-bold">${d.elasticity.toFixed(2)}</span></div>
                        <div class="d-flex justify-content-between mb-1"><span style="opacity:0.8">Return Rate:</span> <span class="fw-bold">${(d.return_rate * 100).toFixed(1)}%</span></div>
                        <div class="d-flex justify-content-between"><span style="opacity:0.8">Rev/User:</span> <span class="fw-bold">$${d.revenue_metric.toFixed(2)}</span></div>
                    </div>
                `);
        })
        .on('mousemove', function (event) {
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;
            tooltip.style('left', x + 15 + 'px')
                .style('top', y - 20 + 'px');
        })
        .on('mouseleave', function () {
            d3.select(this)
                .attr('opacity', 0.75)
                .attr('stroke-width', 1.5)
                .attr('stroke', '#fff');
            tooltip.style('display', 'none');
        });

    // LEGEND
    const legendWidth = 160;
    const legendHeight = 240;
    const legendX = width + 40;
    const legendY = 20;

    // Legend Background Card
    svg.append('rect')
        .attr('x', legendX)
        .attr('y', legendY)
        .attr('width', legendWidth)
        .attr('height', legendHeight)
        .attr('fill', '#ffffff')
        .attr('stroke', '#cbd5e1')
        .attr('stroke-width', 1)
        .attr('rx', 8)
        .attr('filter', 'drop-shadow(0 4px 6px rgba(0,0,0,0.05))');

    const legend = svg.append('g')
        .attr('transform', `translate(${legendX + 20}, ${legendY + 25})`);

    legend.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('font-weight', '800')
        .attr('font-size', '14px')
        .attr('fill', '#0f172a')
        .text('Legend');

    // Horizontal separator line
    legend.append('line')
        .attr('x1', 0)
        .attr('y1', 10)
        .attr('x2', 120)
        .attr('y2', 10)
        .attr('stroke', '#e2e8f0')
        .attr('stroke-width', 1);

    // Size legend
    legend.append('text')
        .attr('x', 0)
        .attr('y', 35)
        .attr('font-size', '12px')
        .attr('font-weight', '700')
        .attr('fill', '#334155')
        .text('Bubble Size: Rev/User');

    legend.append('text')
        .attr('x', 0)
        .attr('y', 50)
        .attr('font-size', '11px')
        .attr('fill', '#64748b')
        .text('(Larger = Higher Spend)');

    // Color legend
    const colorY = 90;
    legend.append('text')
        .attr('x', 0)
        .attr('y', colorY)
        .attr('font-size', '12px')
        .attr('font-weight', '700')
        .attr('fill', '#334155')
        .text('Color: Return Rate');

    // High
    legend.append('circle')
        .attr('cx', 8)
        .attr('cy', colorY + 25)
        .attr('r', 7)
        .attr('fill', '#16a34a') // Vibrant Green
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5);
    legend.append('text')
        .attr('x', 25)
        .attr('y', colorY + 29)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#334155')
        .text('> 70% (High)');

    // Medium
    legend.append('circle')
        .attr('cx', 8)
        .attr('cy', colorY + 50)
        .attr('r', 7)
        .attr('fill', '#f97316') // Vibrant Orange
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5);
    legend.append('text')
        .attr('x', 25)
        .attr('y', colorY + 54)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#334155')
        .text('40-70% (Med)');

    // Low
    legend.append('circle')
        .attr('cx', 8)
        .attr('cy', colorY + 75)
        .attr('r', 7)
        .attr('fill', '#dc2626') // Vibrant Red
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5);
    legend.append('text')
        .attr('x', 25)
        .attr('y', colorY + 79)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#334155')
        .text('< 40% (Low)');

    // Export Button (Optional, can be added if needed)
}


/**
 * Export SVG to file
 * @param {string} containerId - DOM element ID
 * @param {string} filename - Output filename
 */
export function exportSVG(containerId, filename) {
    const svg = document.querySelector(`#${containerId} svg`);
    if (!svg) {
        console.warn('No SVG found in container:', containerId);
        return;
    }

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();

    URL.revokeObjectURL(link.href);
}
