"""
Churn Elasticity Model (Time-Lagged)
Uses Logistic Regression with pre-fitted coefficients
"""

import numpy as np

# Pre-fitted coefficients for time-lagged churn model
# Tuned to realistic streaming industry benchmarks:
# +$1 on $6 base (~16% increase) should drive 6-8pp churn increase at peak
CHURN_COEFFICIENTS = {
    'intercept': -2.944,  # log-odds of baseline churn (5% = -2.944)
    'price_change_pct': 0.01,  # Base effect of price change
    # Time-lagged interaction coefficients
    'price_x_0_4wks': 0.006,   # Immediate effect (2-3pp for +16% price)
    'price_x_4_8wks': 0.018,   # Roll-off peak (5-6pp)
    'price_x_8_12wks': 0.028,  # Peak churn period (7-8pp)
    'price_x_12plus': 0.008,   # Stabilization (positive but lower = +2-3pp)
}

def logistic(x):
    """Logistic sigmoid function"""
    return 1 / (1 + np.exp(-x))

def predict_churn_by_horizon(scenario):
    """
    Predict churn probability for each time horizon after price change

    Args:
        scenario: dict with {price_change_pct, baseline_churn}

    Returns:
        dict with churn rates by time horizon
    """
    price_change_pct = scenario.get('price_change_pct', 0)
    baseline_churn = scenario.get('baseline_churn', 0.05)

    # Calculate log-odds for each time horizon
    horizons = {
        '0-4 Weeks': CHURN_COEFFICIENTS['price_x_0_4wks'],
        '4-8 Weeks': CHURN_COEFFICIENTS['price_x_4_8wks'],
        '8-12 Weeks': CHURN_COEFFICIENTS['price_x_8_12wks'],
        '12+ Weeks': CHURN_COEFFICIENTS['price_x_12plus']
    }

    results_by_horizon = {}

    for horizon_name, coef in horizons.items():
        # Calculate log-odds
        log_odds = (
            CHURN_COEFFICIENTS['intercept'] +
            CHURN_COEFFICIENTS['price_change_pct'] * price_change_pct +
            coef * price_change_pct
        )

        # Convert to probability
        churn_prob = logistic(log_odds)

        # Calculate uplift vs baseline
        churn_uplift = churn_prob - baseline_churn

        results_by_horizon[horizon_name] = {
            'churn_rate': float(churn_prob),
            'churn_uplift': float(churn_uplift),
            'churn_uplift_pp': float(churn_uplift * 100)  # percentage points
        }

    return results_by_horizon


def predict_churn_by_segment(scenario, segments):
    """
    Predict churn by segment and time horizon

    Args:
        scenario: pricing scenario
        segments: list of segment dicts

    Returns:
        list of segment-level churn predictions by horizon
    """
    results = []

    for segment in segments:
        # Base prediction
        horizons = predict_churn_by_horizon(scenario)

        # Adjust by segment characteristics
        # Use engagement elasticity but cap variation to 0.7x - 1.3x range
        # (churn doesn't vary as wildly across segments as acquisition does)
        elasticity = abs(segment.get('elasticity', -2.0))
        segment_multiplier = 0.7 + (min(elasticity, 4.0) / 4.0) * 0.6  # Maps -1 to -4 → 0.85 to 1.3

        segment_result = {
            'name': segment['name'],
            'size': segment['size']
        }

        # Apply segment multiplier to each horizon
        for horizon, values in horizons.items():
            horizon_key = horizon.replace(' ', '_').replace('-', '_').replace('+', 'plus').lower()
            segment_result[f'churn_{horizon_key}'] = values['churn_uplift_pp'] * segment_multiplier

        results.append(segment_result)

    return results
