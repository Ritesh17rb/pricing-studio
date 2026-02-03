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

    if (!aggregatedKPIs || aggregatedKPIs.total_subscribers === 0) {
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
            label: 'Total Subscribers',
            value: safeNumber(aggregatedKPIs.total_subscribers, 0).toLocaleString(),
            icon: 'bi-people-fill',
            color: '#667eea'
        },
        {
            label: 'Avg Churn Rate',
            value: `${(safeNumber(aggregatedKPIs.weighted_churn, 0) * 100).toFixed(2)}%`,
            icon: 'bi-graph-down-arrow',
            color: '#f093fb'
        },
        {
            label: 'Avg ARPU',
            value: `$${safeNumber(aggregatedKPIs.weighted_arpu, 0).toFixed(2)}`,
            icon: 'bi-currency-dollar',
            color: '#4facfe'
        },
        {
            label: 'Avg Watch Hours',
            value: safeNumber(aggregatedKPIs.weighted_watch_hours, 0).toFixed(1),
            icon: 'bi-clock-fill',
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
            kpi: axis === 'engagement' ? seg.avg_churn_rate :
                 axis === 'monetization' ? seg.avg_arpu :
                 seg.avg_cac,
            subscribers: parseInt(seg.subscriber_count || 0)
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
        xLabel = 'Acquisition Price Sensitivity';
        yLabel = 'Engagement & Churn Propensity';
    } else if (axis === 'engagement') {
        xCategories = window.segmentEngine.axisDefinitions.engagement;
        yCategories = window.segmentEngine.axisDefinitions.monetization;
        xLabel = 'Engagement & Churn Propensity';
        yLabel = 'Monetization & Plan Type';
    } else {
        xCategories = window.segmentEngine.axisDefinitions.monetization;
        yCategories = window.segmentEngine.axisDefinitions.acquisition;
        xLabel = 'Monetization & Plan Type';
        yLabel = 'Acquisition Price Sensitivity';
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
        .on('mouseenter', function(event, d) {
            d3.select(this)
                .attr('stroke-width', 4)
                .attr('stroke', '#000');

            const segmentSummary = window.segmentEngine.generateSegmentSummary(d.compositeKey, {
                subscriber_count: d.subscribers,
                avg_churn_rate: axis === 'engagement' ? d.kpi : 0.12,
                avg_arpu: axis === 'monetization' ? d.kpi : 20
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
                        <strong>${axis === 'engagement' ? 'Churn Rate' :
                                axis === 'monetization' ? 'ARPU' : 'CAC Sensitivity'}:</strong>
                        ${axis === 'engagement' ? (d.kpi * 100).toFixed(2) + '%' :
                          axis === 'monetization' ? '$' + d.kpi.toFixed(2) : d.kpi.toFixed(2)}<br>
                        <strong>Subscribers:</strong> ${d.subscribers.toLocaleString()}
                    </div>
                `);
        })
        .on('mousemove', function(event) {
            // Calculate position relative to container
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip
                .style('left', (x + 15) + 'px')
                .style('top', (y - 30) + 'px');
        })
        .on('mouseleave', function() {
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

    // Dimensions
    const width = 1000;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;
    const axisLength = 280;

    // Create SVG
    const svg = container.append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background', '#fafafa');

    // Define three axes at 120° apart
    const axes = [
        {
            name: 'Monetization & Plan Type',
            key: 'monetization',
            color: '#2563eb', // Blue
            angle: 90, // Vertical (up)
            segments: window.segmentEngine.axisDefinitions.monetization
        },
        {
            name: 'Engagement & Churn Propensity',
            key: 'engagement',
            color: '#22c55e', // Green
            angle: 210, // Left diagonal (210°)
            segments: window.segmentEngine.axisDefinitions.engagement
        },
        {
            name: 'Acquisition Price Sensitivity',
            key: 'acquisition',
            color: '#ef4444', // Red
            angle: 330, // Right diagonal (330°)
            segments: window.segmentEngine.axisDefinitions.acquisition
        }
    ];

    // Create tooltip
    const tooltip = container.append('div')
        .attr('class', 'position-absolute bg-dark text-white p-3 rounded shadow')
        .style('display', 'none')
        .style('pointer-events', 'none')
        .style('font-size', '12px')
        .style('z-index', '1000')
        .style('max-width', '300px');

    // Draw axes
    axes.forEach(axis => {
        const radians = (axis.angle * Math.PI) / 180;
        const endX = centerX + Math.cos(radians) * axisLength;
        const endY = centerY - Math.sin(radians) * axisLength;

        // Axis line
        svg.append('line')
            .attr('x1', centerX)
            .attr('y1', centerY)
            .attr('x2', endX)
            .attr('y2', endY)
            .attr('stroke', axis.color)
            .attr('stroke-width', 3)
            .attr('opacity', 0.6);

        // Axis label (at the end)
        const labelDistance = 30;
        const labelX = centerX + Math.cos(radians) * (axisLength + labelDistance);
        const labelY = centerY - Math.sin(radians) * (axisLength + labelDistance);

        svg.append('text')
            .attr('x', labelX)
            .attr('y', labelY)
            .attr('text-anchor', 'middle')
            .attr('fill', axis.color)
            .attr('font-weight', 'bold')
            .attr('font-size', '13px')
            .text(axis.name);

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
                subscriber_count: parseInt(seg.subscriber_count) || 0,
                avg_churn_rate: parseFloat(seg.avg_churn_rate) || 0,
                avg_arpu: parseFloat(seg.avg_arpu) || 0
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

    // Determine radius scale based on subscriber count
    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(segmentPositions, d => d.subscriber_count)])
        .range([3, 20]);

    // Color scale based on churn rate
    const churnScale = d3.scaleSequential(d3.interpolateRdYlGn)
        .domain([d3.max(segmentPositions, d => d.avg_churn_rate),
                 d3.min(segmentPositions, d => d.avg_churn_rate)]);

    // Draw segment data points
    svg.selectAll('.segment-point')
        .data(segmentPositions)
        .join('circle')
        .attr('class', 'segment-point')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', d => radiusScale(d.subscriber_count))
        .attr('fill', d => churnScale(d.avg_churn_rate))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('opacity', 0.7)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event, d) {
            d3.select(this)
                .attr('opacity', 1)
                .attr('stroke-width', 3);

            const segmentInfo = window.segmentEngine.formatCompositeKey(d.compositeKey);
            const segmentSummary = window.segmentEngine.generateSegmentSummary(d.compositeKey, {
                subscriber_count: d.subscriber_count,
                avg_churn_rate: d.avg_churn_rate,
                avg_arpu: d.avg_arpu
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
                    <strong>${segmentInfo}</strong><br>
                    <em class="text-white-50" style="font-size: 11px;">${segmentSummary}</em><br>
                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
                        <strong>Subscribers:</strong> ${d.subscriber_count.toLocaleString()}<br>
                        <strong>Churn Rate:</strong> ${(d.avg_churn_rate * 100).toFixed(2)}%<br>
                        <strong>ARPU:</strong> $${d.avg_arpu.toFixed(2)}
                    </div>
                `);
        })
        .on('mousemove', function(event) {
            // Calculate position relative to container
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip
                .style('left', (x + 15) + 'px')
                .style('top', (y - 30) + 'px');
        })
        .on('mouseleave', function() {
            d3.select(this)
                .attr('opacity', 0.7)
                .attr('stroke-width', 2);

            tooltip.style('display', 'none');
        })
        .on('click', function(event, d) {
            // Future: Show detailed segment analysis
        });

    // Add legend
    const legendX = width - 180;
    const legendY = 50;

    const legend = svg.append('g')
        .attr('transform', `translate(${legendX}, ${legendY})`);

    legend.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('font-weight', 'bold')
        .attr('font-size', '12px')
        .text('Legend');

    // Size legend
    legend.append('text')
        .attr('x', 0)
        .attr('y', 25)
        .attr('font-size', '10px')
        .attr('fill', '#666')
        .text('Circle Size: Subscribers');

    [1000, 5000, 10000].forEach((count, i) => {
        const r = radiusScale(count);
        legend.append('circle')
            .attr('cx', 10)
            .attr('cy', 40 + i * 25)
            .attr('r', r)
            .attr('fill', '#ccc')
            .attr('opacity', 0.5);

        legend.append('text')
            .attr('x', 25)
            .attr('y', 43 + i * 25)
            .attr('font-size', '9px')
            .attr('fill', '#666')
            .text(count.toLocaleString());
    });

    // Color legend
    legend.append('text')
        .attr('x', 0)
        .attr('y', 130)
        .attr('font-size', '10px')
        .attr('fill', '#666')
        .text('Color: Churn Rate');

    legend.append('text')
        .attr('x', 10)
        .attr('y', 145)
        .attr('font-size', '9px')
        .attr('fill', '#22c55e')
        .text('Low');

    legend.append('text')
        .attr('x', 10)
        .attr('y', 170)
        .attr('font-size', '9px')
        .attr('fill', '#ef4444')
        .text('High');

    // Center title
    svg.append('text')
        .attr('x', centerX)
        .attr('y', 30)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .attr('font-size', '16px')
        .attr('fill', '#333')
        .text(`3-Axis Customer Cohorts - ${tier.replace('_', ' ').toUpperCase()} Tier`);
}

/**
 * Render scatter plot of segments (Elasticity vs Subscriber Count)
 * @param {string} containerId - DOM element ID
 * @param {string} tier - Subscription tier
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
    const data = segments.map(seg => ({
        compositeKey: seg.compositeKey,
        subscribers: parseInt(seg.subscriber_count),
        churn_rate: parseFloat(seg.avg_churn_rate),
        arpu: parseFloat(seg.avg_arpu),
        elasticity: window.segmentEngine.getElasticity(tier, seg.compositeKey, 'engagement') || -2.0
    }));

    // Set up dimensions
    const margin = { top: 40, right: 150, bottom: 60, left: 80 };
    const width = 900 - margin.left - margin.right;
    const height = 600 - margin.top - margin.bottom;

    const svg = container.append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.subscribers)])
        .range([0, width])
        .nice();

    const yScale = d3.scaleLinear()
        .domain([d3.min(data, d => d.elasticity), 0])
        .range([height, 0])
        .nice();

    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
        .domain([d3.max(data, d => d.churn_rate), d3.min(data, d => d.churn_rate)]);

    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(data, d => d.arpu)])
        .range([4, 15]);

    // Axes
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickFormat(d => (d / 1000).toFixed(0) + 'K'));

    svg.append('g')
        .call(d3.axisLeft(yScale));

    // Axis labels
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 50)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .text('Subscriber Count');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -60)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .text('Price Elasticity');

    // Quadrant line
    svg.append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', yScale(-2.0))
        .attr('y2', yScale(-2.0))
        .attr('stroke', '#ccc')
        .attr('stroke-dasharray', '5,5')
        .attr('opacity', 0.5);

    // Tooltip
    const tooltip = container.append('div')
        .attr('class', 'position-absolute bg-dark text-white p-2 rounded shadow-sm')
        .style('display', 'none')
        .style('pointer-events', 'none')
        .style('font-size', '11px')
        .style('z-index', '1000');

    // Plot points
    svg.selectAll('.segment-point')
        .data(data)
        .join('circle')
        .attr('class', 'segment-point')
        .attr('cx', d => xScale(d.subscribers))
        .attr('cy', d => yScale(d.elasticity))
        .attr('r', d => radiusScale(d.arpu))
        .attr('fill', d => colorScale(d.churn_rate))
        .attr('opacity', 0.7)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event, d) {
            d3.select(this).attr('opacity', 1).attr('stroke-width', 2);

            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip.style('display', 'block')
                .style('left', x + 10 + 'px')
                .style('top', y - 20 + 'px')
                .html(`
                    <strong>${window.segmentEngine.formatCompositeKey(d.compositeKey)}</strong><br>
                    Subscribers: ${d.subscribers.toLocaleString()}<br>
                    Elasticity: ${d.elasticity.toFixed(2)}<br>
                    Churn: ${(d.churn_rate * 100).toFixed(2)}%<br>
                    ARPU: $${d.arpu.toFixed(2)}
                `);
        })
        .on('mousemove', function(event) {
            const containerNode = container.node();
            const containerRect = containerNode.getBoundingClientRect();
            const x = event.clientX - containerRect.left;
            const y = event.clientY - containerRect.top;

            tooltip.style('left', x + 10 + 'px')
                .style('top', y - 20 + 'px');
        })
        .on('mouseleave', function() {
            d3.select(this).attr('opacity', 0.7).attr('stroke-width', 1);
            tooltip.style('display', 'none');
        });

    // Legend
    const legend = svg.append('g')
        .attr('transform', `translate(${width + 20}, 0)`);

    legend.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('font-weight', 'bold')
        .attr('font-size', '12px')
        .text('Legend');

    // Size legend
    legend.append('text')
        .attr('x', 0)
        .attr('y', 25)
        .attr('font-size', '10px')
        .text('Size: ARPU');

    // Color legend
    legend.append('text')
        .attr('x', 0)
        .attr('y', 80)
        .attr('font-size', '10px')
        .text('Color: Churn');

    legend.append('circle')
        .attr('cx', 10)
        .attr('cy', 95)
        .attr('r', 5)
        .attr('fill', '#22c55e');
    legend.append('text')
        .attr('x', 20)
        .attr('y', 98)
        .attr('font-size', '9px')
        .text('Low');

    legend.append('circle')
        .attr('cx', 10)
        .attr('cy', 110)
        .attr('r', 5)
        .attr('fill', '#ef4444');
    legend.append('text')
        .attr('x', 20)
        .attr('y', 113)
        .attr('font-size', '9px')
        .text('High');

    // Title
    svg.append('text')
        .attr('x', width / 2)
        .attr('y', -20)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .attr('font-size', '14px')
        .text(`Segment Analysis - ${tier.replace('_', ' ').toUpperCase()}`);
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
