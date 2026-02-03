"""
Tier Migration Model (2-Tier & 3-Tier Support)
Uses Multinomial Logit with industry-calibrated coefficients

Supports:
- 2-tier: Ad-Lite ↔ Ad-Free
- 3-tier Bundle: Ad-Lite, Ad-Free, Bundle (Service + Premium)
- 3-tier Basic: Basic, Ad-Lite, Ad-Free
"""

import numpy as np

# ============================================================================
# REALISTIC COEFFICIENTS (Industry Benchmarks)
# ============================================================================

# 3-TIER BUNDLE COEFFICIENTS
# Bundle = Service Ad-Free ($8.99) + Premium Ad-Free ($9.99) = $14.99 (saves $3.99)
# Tuned for realistic transition rates: Ad-Free→Bundle 55-70%, Ad-Supp→Bundle 7-12%
BUNDLE_COEFFICIENTS = {
    # From Ad-Lite → Bundle (big price jump but compelling value)
    'ad_supp_to_bundle': {
        'intercept': -2.6,        # Very strong base resistance (2.5x price increase)
        'value_savings_pct': 0.020, # Conservative savings impact (21% savings → +0.42 utility)
        'has_content_need': 0.5,  # If customer wants Max content
        'tenure_months': 0.006    # Loyal customers slightly more likely
    },
    # From Ad-Free → Bundle (Strong but not universal upgrade incentive)
    'ad_free_to_bundle': {
        'intercept': -0.5,        # Moderate base appeal for majority upgrade
        'value_savings_pct': 0.03,# Solid savings impact (21% savings → +0.63 utility)
        'has_content_need': 0.8,  # Max content is key driver
        'tenure_months': 0.012    # Loyal premium customers upgrade
    },
    # From Bundle → Ad-Free (LOW downgrade - why give up Max?)
    'bundle_to_ad_free': {
        'intercept': -4.0,        # Strong resistance to downgrade
        'price_pressure': 0.10,   # Only if under financial stress
        'tenure_months': -0.018   # Longer tenure = stickier
    },
    # From Bundle → Ad-Lite (VERY LOW - big step down)
    'bundle_to_ad_supp': {
        'intercept': -5.0,        # Very strong resistance
        'price_pressure': 0.15,   # Extreme financial stress only
        'tenure_months': -0.025
    }
}

# 3-TIER BASIC COEFFICIENTS
# Basic = $2.99 tier with limited content library
BASIC_COEFFICIENTS = {
    # From Ad-Lite → Basic (HIGH for price-sensitive)
    'ad_supp_to_basic': {
        'intercept': -1.4,        # Strong resistance (save $3/month but limited library)
        'price_sensitivity': 0.12, # Price-sensitive customers downgrade
        'content_satisfaction': -0.18, # If unsatisfied with content
        'tenure_months': -0.010   # Newer customers more likely
    },
    # From Basic → Ad-Lite (MODERATE - after experiencing limits)
    'basic_to_ad_supp': {
        'intercept': -1.2,        # Some resistance (costs more)
        'content_need': 0.22,     # Limited library drives upgrades
        'tenure_months': 0.015    # After experiencing basic tier
    },
    # From Ad-Free → Basic (MEDIUM - big downgrade)
    'ad_free_to_basic': {
        'intercept': -2.8,        # Strong resistance
        'price_pressure': 0.15,   # Only if financially stressed
        'tenure_months': -0.018
    },
    # From Basic → Ad-Free (LOW - big price jump)
    'basic_to_ad_free': {
        'intercept': -3.0,        # Strong resistance ($6 jump)
        'content_need': 0.20,     # If really need full library + no ads
        'tenure_months': 0.010
    }
}

# 2-TIER COEFFICIENTS (Original)
MIGRATION_COEFFICIENTS_2TIER = {
    'upgrade': {
        'intercept': -1.5,
        'price_gap': -0.08,
        'has_promo': 0.4,
        'tenure_months': 0.01
    },
    'downgrade': {
        'intercept': -2.8,
        'price_gap': 0.08,
        'has_promo': -0.3,
        'tenure_months': -0.015
    },
    'cancel': {
        'intercept': -2.5,
        'price_gap': 0.05,
        'has_promo': -0.2,
        'tenure_months': -0.02
    }
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def softmax(x):
    """Softmax function for multinomial logit"""
    exp_x = np.exp(x - np.max(x))
    return exp_x / np.sum(exp_x)

def detect_tier_config(scenario):
    """Detect which tier configuration we're in"""
    tier = scenario.get('tier', 'ad_supported').lower()
    new_price = scenario.get('new_price', 0)

    # Bundle scenario: tier='bundle' or price around $14.99
    if tier == 'bundle' or (new_price >= 13.99 and new_price <= 15.99):
        return '3-tier-bundle'

    # Basic scenario: tier='basic' or price around $2.99
    if tier == 'basic' or (new_price >= 1.99 and new_price <= 3.99):
        return '3-tier-basic'

    # Default: 2-tier
    return '2-tier'

# ============================================================================
# 3-TIER BUNDLE MODEL
# ============================================================================

def predict_3tier_bundle(scenario):
    """
    Predict migration for 3-tier Bundle scenario
    Tiers: Ad-Lite ($5.99), Ad-Free ($8.99), Bundle ($14.99)
    """
    has_promo = 1 if scenario.get('promotion') else 0
    avg_tenure = 12  # months

    # Bundle value proposition: saves $3.99 vs standalone ($18.98)
    savings_pct = 21.0  # (3.99 / 18.98) * 100

    # FROM Ad-Lite
    # Choices: Stay, → Ad-Free, → Bundle, Cancel
    u_stay_as = 0

    u_to_af = (
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['price_gap'] * 3.0 +  # $3 gap
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['tenure_months'] * avg_tenure
    )

    u_to_bundle = (
        BUNDLE_COEFFICIENTS['ad_supp_to_bundle']['intercept'] +
        BUNDLE_COEFFICIENTS['ad_supp_to_bundle']['value_savings_pct'] * savings_pct +
        BUNDLE_COEFFICIENTS['ad_supp_to_bundle']['has_content_need'] * 0.15 +  # 15% want Max
        BUNDLE_COEFFICIENTS['ad_supp_to_bundle']['tenure_months'] * avg_tenure
    )

    u_cancel_as = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_as = softmax(np.array([u_stay_as, u_to_af, u_to_bundle, u_cancel_as]))

    # FROM AD-FREE
    # Choices: Stay, → Bundle, → Ad-Lite, Cancel
    u_stay_af = 0

    u_af_to_bundle = (
        BUNDLE_COEFFICIENTS['ad_free_to_bundle']['intercept'] +
        BUNDLE_COEFFICIENTS['ad_free_to_bundle']['value_savings_pct'] * savings_pct +
        BUNDLE_COEFFICIENTS['ad_free_to_bundle']['has_content_need'] * 0.45 +  # 45% want Max
        BUNDLE_COEFFICIENTS['ad_free_to_bundle']['tenure_months'] * avg_tenure
    )

    u_af_to_as = (
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['price_gap'] * 3.0 +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['tenure_months'] * avg_tenure
    )

    u_cancel_af = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] - 0.3 +  # Premium tier more stable
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_af = softmax(np.array([u_stay_af, u_af_to_bundle, u_af_to_as, u_cancel_af]))

    # FROM BUNDLE
    # Choices: Stay, → Ad-Free, → Ad-Lite, Cancel
    u_stay_bundle = 0

    u_bundle_to_af = (
        BUNDLE_COEFFICIENTS['bundle_to_ad_free']['intercept'] +
        BUNDLE_COEFFICIENTS['bundle_to_ad_free']['price_pressure'] * 2.0 +  # Moderate pressure
        BUNDLE_COEFFICIENTS['bundle_to_ad_free']['tenure_months'] * avg_tenure
    )

    u_bundle_to_as = (
        BUNDLE_COEFFICIENTS['bundle_to_ad_supp']['intercept'] +
        BUNDLE_COEFFICIENTS['bundle_to_ad_supp']['price_pressure'] * 3.0 +  # High pressure
        BUNDLE_COEFFICIENTS['bundle_to_ad_supp']['tenure_months'] * avg_tenure
    )

    u_cancel_bundle = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] - 0.5 +  # Highest tier most stable
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_bundle = softmax(np.array([u_stay_bundle, u_bundle_to_af, u_bundle_to_as, u_cancel_bundle]))

    return {
        'from_ad_supported': {
            'stay': float(probs_as[0]),
            'to_ad_free': float(probs_as[1]),
            'to_bundle': float(probs_as[2]),
            'to_basic': 0.0,
            'cancel': float(probs_as[3])
        },
        'from_ad_free': {
            'stay': float(probs_af[0]),
            'to_bundle': float(probs_af[1]),
            'to_ad_supported': float(probs_af[2]),
            'to_basic': 0.0,
            'cancel': float(probs_af[3])
        },
        'from_bundle': {
            'stay': float(probs_bundle[0]),
            'to_ad_free': float(probs_bundle[1]),
            'to_ad_supported': float(probs_bundle[2]),
            'to_basic': 0.0,
            'cancel': float(probs_bundle[3])
        },
        'tier_config': '3-tier-bundle'
    }

# ============================================================================
# 3-TIER BASIC MODEL
# ============================================================================

def predict_3tier_basic(scenario):
    """
    Predict migration for 3-tier Basic scenario
    Tiers: Basic ($2.99), Ad-Lite ($5.99), Ad-Free ($8.99)
    """
    has_promo = 1 if scenario.get('promotion') else 0
    avg_tenure = 12

    # FROM BASIC
    # Choices: Stay, → Ad-Lite, → Ad-Free, Cancel
    u_stay_basic = 0

    u_basic_to_as = (
        BASIC_COEFFICIENTS['basic_to_ad_supp']['intercept'] +
        BASIC_COEFFICIENTS['basic_to_ad_supp']['content_need'] * 0.4 +  # 40% need more content
        BASIC_COEFFICIENTS['basic_to_ad_supp']['tenure_months'] * avg_tenure
    )

    u_basic_to_af = (
        BASIC_COEFFICIENTS['basic_to_ad_free']['intercept'] +
        BASIC_COEFFICIENTS['basic_to_ad_free']['content_need'] * 0.2 +  # 20% go premium
        BASIC_COEFFICIENTS['basic_to_ad_free']['tenure_months'] * avg_tenure
    )

    u_cancel_basic = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] + 0.5 +  # Lower tier less sticky
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_basic = softmax(np.array([u_stay_basic, u_basic_to_as, u_basic_to_af, u_cancel_basic]))

    # FROM Ad-Lite
    # Choices: Stay, → Ad-Free, → Basic, Cancel
    u_stay_as = 0

    u_as_to_af = (
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['price_gap'] * 3.0 +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['tenure_months'] * avg_tenure
    )

    u_as_to_basic = (
        BASIC_COEFFICIENTS['ad_supp_to_basic']['intercept'] +
        BASIC_COEFFICIENTS['ad_supp_to_basic']['price_sensitivity'] * 0.35 +  # 35% price sensitive
        BASIC_COEFFICIENTS['ad_supp_to_basic']['content_satisfaction'] * 0.20 +  # Some unsatisfied
        BASIC_COEFFICIENTS['ad_supp_to_basic']['tenure_months'] * avg_tenure
    )

    u_cancel_as = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_as = softmax(np.array([u_stay_as, u_as_to_af, u_as_to_basic, u_cancel_as]))

    # FROM AD-FREE
    # Choices: Stay, → Ad-Lite, → Basic, Cancel
    u_stay_af = 0

    u_af_to_as = (
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['price_gap'] * 3.0 +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['tenure_months'] * avg_tenure
    )

    u_af_to_basic = (
        BASIC_COEFFICIENTS['ad_free_to_basic']['intercept'] +
        BASIC_COEFFICIENTS['ad_free_to_basic']['price_pressure'] * 2.0 +  # Financial stress
        BASIC_COEFFICIENTS['ad_free_to_basic']['tenure_months'] * avg_tenure
    )

    u_cancel_af = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] - 0.3 +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_af = softmax(np.array([u_stay_af, u_af_to_as, u_af_to_basic, u_cancel_af]))

    return {
        'from_basic': {
            'stay': float(probs_basic[0]),
            'to_ad_supported': float(probs_basic[1]),
            'to_ad_free': float(probs_basic[2]),
            'to_bundle': 0.0,
            'cancel': float(probs_basic[3])
        },
        'from_ad_supported': {
            'stay': float(probs_as[0]),
            'to_ad_free': float(probs_as[1]),
            'to_basic': float(probs_as[2]),
            'to_bundle': 0.0,
            'cancel': float(probs_as[3])
        },
        'from_ad_free': {
            'stay': float(probs_af[0]),
            'to_ad_supported': float(probs_af[1]),
            'to_basic': float(probs_af[2]),
            'to_bundle': 0.0,
            'cancel': float(probs_af[3])
        },
        'tier_config': '3-tier-basic'
    }

# ============================================================================
# 2-TIER MODEL (Original)
# ============================================================================

def predict_2tier(scenario):
    """Original 2-tier model: Ad-Lite ↔ Ad-Free"""
    ad_supported_price = scenario.get('ad_supported_price', 5.99)
    ad_free_price = scenario.get('ad_free_price', 8.99)
    has_promo = 1 if scenario.get('promotion') else 0
    avg_tenure = 12

    price_gap = ad_free_price - ad_supported_price

    # FROM Ad-Lite
    u_stay_as = 0
    u_upgrade = (
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['price_gap'] * price_gap +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['upgrade']['tenure_months'] * avg_tenure
    )
    u_cancel_as = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['price_gap'] * price_gap +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_as = softmax(np.array([u_stay_as, u_upgrade, -999, u_cancel_as]))

    # FROM AD-FREE
    u_stay_af = 0
    u_downgrade = (
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['price_gap'] * abs(price_gap) +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['downgrade']['tenure_months'] * avg_tenure
    )
    u_cancel_af = (
        MIGRATION_COEFFICIENTS_2TIER['cancel']['intercept'] +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['price_gap'] * abs(price_gap) +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['has_promo'] * has_promo +
        MIGRATION_COEFFICIENTS_2TIER['cancel']['tenure_months'] * avg_tenure
    )

    probs_af = softmax(np.array([u_stay_af, -999, u_downgrade, u_cancel_af]))

    return {
        'from_ad_supported': {
            'stay': float(probs_as[0]),
            'to_ad_free': float(probs_as[1]),
            'to_bundle': 0.0,
            'to_basic': 0.0,
            'cancel': float(probs_as[3])
        },
        'from_ad_free': {
            'stay': float(probs_af[0]),
            'to_ad_supported': float(probs_af[2]),
            'to_bundle': 0.0,
            'to_basic': 0.0,
            'cancel': float(probs_af[3])
        },
        'tier_config': '2-tier'
    }

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def predict_migration_matrix(scenario):
    """
    Main prediction function - routes to appropriate tier model

    Args:
        scenario: dict with pricing and tier information

    Returns:
        dict with migration probabilities by tier
    """
    tier_config = detect_tier_config(scenario)

    if tier_config == '3-tier-bundle':
        return predict_3tier_bundle(scenario)
    elif tier_config == '3-tier-basic':
        return predict_3tier_basic(scenario)
    else:
        return predict_2tier(scenario)
