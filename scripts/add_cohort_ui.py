#!/usr/bin/env python3
"""Add cohort selection dropdowns to index.html"""

import re
from pathlib import Path

html_file = Path(__file__).parent.parent / "index.html"
html_content = html_file.read_text()

# Acquisition cohort dropdown
acq_cohort_html = '''                  <!-- Cohort Selection (NEW!) -->
                  <div class="mb-4">
                    <label class="form-label fw-semibold">Select Cohort <span class="badge bg-info">NEW</span></label>
                    <select class="form-select" id="acq-cohort-select">
                      <option value="baseline">All Cohorts (Baseline)</option>
                      <option value="ultra_loyal">Ultra Loyal (Habitual Streamers)</option>
                      <option value="value_conscious">Value Conscious</option>
                      <option value="deal_hunter">Deal Hunter (Promo-Only)</option>
                      <option value="content_driven">Content Driven</option>
                      <option value="tier_flexible">Tier Flexible</option>
                      <option value="premium_seeker">Premium Seeker</option>
                      <option value="at_risk">At Risk (Lapsers)</option>
                    </select>
                    <small class="text-muted">Switch cohorts to see dramatic elasticity differences!</small>
                  </div>

                  '''

# Add acquisition cohort dropdown before tier selection
html_content = html_content.replace(
    '                  <h5 class="mb-4"><i class="bi bi-sliders me-2"></i>Adjust Price</h5>\n\n                  <!-- Tier Selection -->',
    f'                  <h5 class="mb-4"><i class="bi bi-sliders me-2"></i>Adjust Price</h5>\n\n{acq_cohort_html}                  <!-- Tier Selection -->'
)

# Churn cohort dropdown
churn_cohort_html = '''                  <!-- Cohort Selection (NEW!) -->
                  <div class="mb-4">
                    <label class="form-label fw-semibold">Select Cohort <span class="badge bg-info">NEW</span></label>
                    <select class="form-select" id="churn-cohort-select">
                      <option value="baseline">All Cohorts (Baseline)</option>
                      <option value="ultra_loyal">Ultra Loyal - Delayed Ramp</option>
                      <option value="value_conscious">Value Conscious - Moderate</option>
                      <option value="deal_hunter">Deal Hunter - Sharp Spike!</option>
                      <option value="content_driven">Content Driven - Conditional</option>
                      <option value="tier_flexible">Tier Flexible</option>
                      <option value="premium_seeker">Premium Seeker - Gentle Slope</option>
                      <option value="at_risk">At Risk - Accelerating</option>
                    </select>
                    <small class="text-muted">Watch curves change shape and cross as you switch cohorts!</small>
                  </div>

                  '''

# Add churn cohort dropdown before price slider
html_content = html_content.replace(
    '                  <h5 class="mb-4"><i class="bi bi-sliders me-2"></i>Simulate Price Increase</h5>\n\n                  <!-- Price Increase Slider -->',
    f'                  <h5 class="mb-4"><i class="bi bi-sliders me-2"></i>Simulate Price Increase</h5>\n\n{churn_cohort_html}                  <!-- Price Increase Slider -->'
)

# Migration cohort dropdown
mig_cohort_html = '''                  <!-- Cohort Selection (NEW!) -->
                  <div class="mb-4">
                    <label class="form-label fw-semibold">Select Cohort <span class="badge bg-info">NEW</span></label>
                    <select class="form-select" id="mig-cohort-select">
                      <option value="baseline">All Cohorts (Baseline)</option>
                      <option value="ultra_loyal">Ultra Loyal</option>
                      <option value="value_conscious">Value Conscious</option>
                      <option value="deal_hunter">Deal Hunter</option>
                      <option value="content_driven">Content Driven</option>
                      <option value="tier_flexible">Tier Flexible - High Asymmetry!</option>
                      <option value="premium_seeker">Premium Seeker - Upgrade-Willing</option>
                      <option value="at_risk">At Risk</option>
                    </select>
                    <small class="text-muted">See crossover point shift with different cohorts!</small>
                  </div>

                  '''

# Add migration cohort dropdown before price sliders
html_content = html_content.replace(
    '                  <h5 class="mb-4"><i class="bi bi-sliders me-2"></i>Adjust Tier Prices</h5>\n\n                  <!-- Ad-Lite Price Slider -->',
    f'                  <h5 class="mb-4"><i class="bi bi-sliders me-2"></i>Adjust Tier Prices</h5>\n\n{mig_cohort_html}                  <!-- Ad-Lite Price Slider -->'
)

# Write back
html_file.write_text(html_content)
print("✅ Added cohort selection dropdowns to index.html")
print("   - Acquisition section: acq-cohort-select")
print("   - Churn section: churn-cohort-select")
print("   - Migration section: mig-cohort-select")
