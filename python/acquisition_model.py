"""
Acquisition Elasticity Model
Uses Poisson GLM with pre-fitted coefficients (no training needed for POC)
"""

import numpy as np

# Pre-fitted model coefficients (realistic industry benchmarks)
# These would come from actual training in production
ACQUISITION_COEFFICIENTS = {
    'intercept': 6.5,  # log(baseline_adds) → exp(6.5) ≈ 665 baseline adds
    'price': -0.25,     # Price elasticity coefficient
    'promo_discount': 0.03,  # Positive effect of discounts (50% promo → +1.5 boost)
    'is_promo': 0.4,   # Binary promo indicator boost (promos are 1.5x more effective)
    'segment_elasticity_factor': 0.12  # Amplifies segment-specific elasticity
}

def predict_acquisition(scenario):
    """
    Predict gross adds for a pricing scenario using pre-fitted Poisson model

    Model: log(adds) = β₀ + β₁*price + β₂*discount + β₃*is_promo + β₄*segment

    Args:
        scenario: dict with keys {new_price, promotion, segment_elasticity}

    Returns:
        dict with {predicted_adds, ci_lower, ci_upper, elasticity}
    """
    # Extract features
    price = scenario.get('new_price', 8.99)
    promo_discount = 0
    is_promo = 0

    if scenario.get('promotion'):
        promo = scenario['promotion']
        promo_discount = promo.get('discount_pct', 0) / 100.0
        is_promo = 1

    segment_elasticity = scenario.get('segment_elasticity', -1.8)

    # Calculate linear predictor
    log_adds = (
        ACQUISITION_COEFFICIENTS['intercept'] +
        ACQUISITION_COEFFICIENTS['price'] * price +
        ACQUISITION_COEFFICIENTS['promo_discount'] * promo_discount * 100 +
        ACQUISITION_COEFFICIENTS['is_promo'] * is_promo +
        ACQUISITION_COEFFICIENTS['segment_elasticity_factor'] * abs(segment_elasticity)
    )

    # Poisson link: E[Y] = exp(linear_pred)
    predicted_adds = np.exp(log_adds)

    # Calculate confidence interval (approximate)
    # For Poisson, variance = mean, so SE = sqrt(mean)
    se = np.sqrt(predicted_adds)
    ci_lower = max(0, predicted_adds - 1.96 * se)
    ci_upper = predicted_adds + 1.96 * se

    # Calculate elasticity (d log(Y) / d log(P) = β * P)
    elasticity = ACQUISITION_COEFFICIENTS['price'] * price

    return {
        'predicted_adds': float(predicted_adds),
        'ci_lower': float(ci_lower),
        'ci_upper': float(ci_upper),
        'elasticity': float(elasticity),
        'confidence': float(se / predicted_adds * 100) if predicted_adds > 0 else 0
    }


def predict_acquisition_by_segment(scenario, segments):
    """
    Predict acquisition for multiple customer segments

    Args:
        scenario: pricing scenario dict
        segments: list of segment dicts with {name, size, elasticity}

    Returns:
        list of segment predictions
    """
    results = []

    for segment in segments:
        # Create scenario for this segment
        seg_scenario = {
            **scenario,
            'segment_elasticity': segment.get('elasticity', -1.8)
        }

        # Predict
        prediction = predict_acquisition(seg_scenario)

        # Scale by segment size
        segment_adds = prediction['predicted_adds'] * (segment['size'] / 50000)

        # Calculate lift at different price points
        lift_minus_5 = -5.0 * segment['elasticity']  # -5% price → elasticity * 5% adds
        lift_plus_5 = 5.0 * segment['elasticity']    # +5% price → elasticity * -5% adds

        # Recalculate confidence for segment (smaller segments have more uncertainty)
        # For Poisson, se = sqrt(lambda), so CV = sqrt(lambda)/lambda = 1/sqrt(lambda)
        segment_confidence = (1.0 / np.sqrt(max(segment_adds, 1))) * 100 if segment_adds > 0 else 10.0

        results.append({
            'name': segment['name'],
            'size': segment['size'],
            'predicted_adds': segment_adds,
            'elasticity': segment['elasticity'],
            'lift_at_minus_5pct': lift_minus_5,
            'lift_at_plus_5pct': lift_plus_5,
            'confidence': float(min(segment_confidence, 15.0))  # Cap at ±15%
        })

    return results
