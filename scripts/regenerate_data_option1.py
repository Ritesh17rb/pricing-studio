#!/usr/bin/env python3
"""
Data Regeneration Script - Option 1 (Data-Only Changes)
Creates interesting elasticity patterns using behavioral archetypes
"""

import json
import random
import math
import csv
from pathlib import Path

# Set random seed for reproducibility
random.seed(42)

# ============================================================================
# PART 1: BEHAVIORAL ARCHETYPE PROFILES
# ============================================================================

ELASTICITY_PROFILES = {
    "ultra_loyal": {
        "description": "Habitual Streamers, Long-Tenure Loyalists, Content-Anchored High-Engagement",
        "base_acquisition_elasticity": -0.65,
        "base_churn_elasticity": 0.25,
        "base_migration_upgrade": 1.4,
        "base_migration_downgrade": 0.5,
        "tenure_decay_rate": 0.08,  # Becomes more loyal over time
        "engagement_offset": 0.4,   # High engagement reduces sensitivity significantly
        "price_history_habituation": 0.2,
        "churn_curve_type": "delayed_ramp",
        "migration_asymmetry_factor": 1.8,  # Slightly favor staying
        "time_lag_distribution": {
            "0_4_weeks": 0.05,   # Minimal immediate impact
            "4_8_weeks": 0.10,   # Gradual increase
            "8_12_weeks": 0.20,  # Continued increase
            "12_16_weeks": 0.35, # Peak (delayed!)
            "16_20_weeks": 0.30  # Sustained
        }
    },
    "value_conscious": {
        "description": "Ad-Value Seekers, Value-Perception Buyers",
        "base_acquisition_elasticity": -1.8,
        "base_churn_elasticity": 0.9,
        "base_migration_upgrade": 0.8,
        "base_migration_downgrade": 1.3,
        "tenure_decay_rate": 0.03,  # Slower learning
        "engagement_offset": 0.15,
        "price_history_habituation": 0.05,
        "churn_curve_type": "moderate",
        "migration_asymmetry_factor": 2.2,
        "time_lag_distribution": {
            "0_4_weeks": 0.15,
            "4_8_weeks": 0.25,
            "8_12_weeks": 0.30,
            "12_16_weeks": 0.20,
            "16_20_weeks": 0.10
        }
    },
    "deal_hunter": {
        "description": "Promo-Only Users, Deal-Responsive Acquirers",
        "base_acquisition_elasticity": -3.5,
        "base_churn_elasticity": 1.6,
        "base_migration_upgrade": 0.4,
        "base_migration_downgrade": 2.0,
        "tenure_decay_rate": 0.01,  # Barely learns
        "engagement_offset": 0.05,  # Engagement doesn't help much
        "price_history_habituation": 0.0,  # Never habituates
        "promo_spike_multiplier": 2.5,  # 2.5x more elastic during promos
        "churn_curve_type": "sharp_spike_plateau",
        "migration_asymmetry_factor": 4.5,  # Heavily favor downgrade
        "time_lag_distribution": {
            "0_4_weeks": 0.40,   # Immediate shock!
            "4_8_weeks": 0.35,   # Peak
            "8_12_weeks": 0.15,  # Drops off
            "12_16_weeks": 0.07, # Plateau (survivors adapted)
            "16_20_weeks": 0.03
        }
    },
    "content_driven": {
        "description": "Content-Anchored Viewers, TVOD-to-SVOD Converters",
        "base_acquisition_elasticity": -1.2,
        "base_churn_elasticity": 0.7,
        "base_migration_upgrade": 1.1,
        "base_migration_downgrade": 0.9,
        "content_conditional_multiplier": 2.0,  # 2x churn during droughts
        "tenure_decay_rate": 0.05,
        "engagement_offset": 0.25,
        "price_history_habituation": 0.12,
        "churn_curve_type": "conditional_spike",
        "migration_asymmetry_factor": 2.0,
        "time_lag_distribution": {
            "0_4_weeks": 0.12,
            "4_8_weeks": 0.22,
            "8_12_weeks": 0.30,
            "12_16_weeks": 0.25,
            "16_20_weeks": 0.11
        }
    },
    "tier_flexible": {
        "description": "Price-Triggered Downgraders, Tier Switchers",
        "base_acquisition_elasticity": -1.6,
        "base_churn_elasticity": 0.85,
        "base_migration_upgrade": 0.9,
        "base_migration_downgrade": 2.7,
        "tenure_decay_rate": 0.04,
        "engagement_offset": 0.18,
        "price_history_habituation": 0.08,
        "churn_curve_type": "moderate",
        "migration_asymmetry_factor": 3.8,  # Downgrades 3.8x faster than upgrades
        "time_lag_distribution": {
            "0_4_weeks": 0.18,
            "4_8_weeks": 0.28,
            "8_12_weeks": 0.28,
            "12_16_weeks": 0.18,
            "16_20_weeks": 0.08
        }
    },
    "premium_seeker": {
        "description": "Ad-Free Loyalists, Ad-Intolerant Upgraders",
        "base_acquisition_elasticity": -1.0,
        "base_churn_elasticity": 0.4,
        "base_migration_upgrade": 1.6,
        "base_migration_downgrade": 0.4,
        "ad_aversion_factor": 0.6,  # Less elastic because ads are intolerable
        "tenure_decay_rate": 0.06,
        "engagement_offset": 0.3,
        "price_history_habituation": 0.15,
        "churn_curve_type": "gentle_slope",
        "migration_asymmetry_factor": 0.8,  # Actually favors upgrade!
        "time_lag_distribution": {
            "0_4_weeks": 0.08,
            "4_8_weeks": 0.12,
            "8_12_weeks": 0.18,
            "12_16_weeks": 0.30,
            "16_20_weeks": 0.32
        }
    },
    "at_risk": {
        "description": "At-Risk Lapsers, Dormant Subscribers",
        "base_acquisition_elasticity": -2.0,
        "base_churn_elasticity": 1.2,
        "base_migration_upgrade": 0.5,
        "base_migration_downgrade": 1.8,
        "churn_acceleration": 1.5,  # Churn increases non-linearly
        "tenure_decay_rate": -0.02,  # Gets WORSE over time (fatigue)
        "engagement_offset": 0.1,
        "price_history_habituation": 0.03,
        "churn_curve_type": "accelerating",
        "migration_asymmetry_factor": 3.2,
        "time_lag_distribution": {
            "0_4_weeks": 0.25,
            "4_8_weeks": 0.30,
            "8_12_weeks": 0.25,
            "12_16_weeks": 0.13,
            "16_20_weeks": 0.07
        }
    }
}

# ============================================================================
# PART 2: SEGMENT-TO-PROFILE MAPPING
# ============================================================================

def get_profile_weights(acquisition_segment, engagement_segment, monetization_segment):
    """
    Map segment combinations to profile weights
    Returns: dict of {profile_name: weight}
    """
    weights = {
        "ultra_loyal": 0.0,
        "value_conscious": 0.0,
        "deal_hunter": 0.0,
        "content_driven": 0.0,
        "tier_flexible": 0.0,
        "premium_seeker": 0.0,
        "at_risk": 0.0
    }

    # ACQUISITION AXIS MAPPING
    if acquisition_segment == "habitual_streamers":
        weights["ultra_loyal"] += 0.6
        weights["content_driven"] += 0.2
        weights["value_conscious"] += 0.2
    elif acquisition_segment == "content_anchored_viewers":
        weights["content_driven"] += 0.6
        weights["ultra_loyal"] += 0.25
        weights["value_conscious"] += 0.15
    elif acquisition_segment == "at_risk_lapsers":
        weights["at_risk"] += 0.7
        weights["value_conscious"] += 0.2
        weights["tier_flexible"] += 0.1
    elif acquisition_segment == "promo_only_users":
        weights["deal_hunter"] += 0.7
        weights["value_conscious"] += 0.3
    elif acquisition_segment == "dormant_subscribers":
        weights["at_risk"] += 0.6
        weights["deal_hunter"] += 0.25
        weights["value_conscious"] += 0.15

    # ENGAGEMENT AXIS MAPPING
    if engagement_segment == "ad_value_seekers":
        weights["value_conscious"] += 0.5
        weights["deal_hunter"] += 0.3
        weights["tier_flexible"] += 0.2
    elif engagement_segment == "ad_tolerant_upgraders":
        weights["tier_flexible"] += 0.4
        weights["value_conscious"] += 0.3
        weights["premium_seeker"] += 0.3
    elif engagement_segment == "ad_free_loyalists":
        weights["premium_seeker"] += 0.6
        weights["ultra_loyal"] += 0.4
    elif engagement_segment == "price_triggered_downgraders":
        weights["tier_flexible"] += 0.5
        weights["deal_hunter"] += 0.3
        weights["at_risk"] += 0.2
    elif engagement_segment == "tvod_inclined_buyers":
        weights["content_driven"] += 0.5
        weights["premium_seeker"] += 0.3
        weights["value_conscious"] += 0.2

    # MONETIZATION AXIS MAPPING
    if monetization_segment == "platform_bundled_acquirers":
        weights["ultra_loyal"] += 0.4
        weights["value_conscious"] += 0.4
        weights["premium_seeker"] += 0.2
    elif monetization_segment == "tvod_to_svod_converters":
        weights["content_driven"] += 0.5
        weights["ultra_loyal"] += 0.3
        weights["premium_seeker"] += 0.2
    elif monetization_segment == "content_triggered_buyers":
        weights["content_driven"] += 0.6
        weights["value_conscious"] += 0.25
        weights["ultra_loyal"] += 0.15
    elif monetization_segment == "deal_responsive_acquirers":
        weights["deal_hunter"] += 0.6
        weights["value_conscious"] += 0.3
        weights["tier_flexible"] += 0.1
    elif monetization_segment == "value_perception_buyers":
        weights["value_conscious"] += 0.6
        weights["tier_flexible"] += 0.25
        weights["deal_hunter"] += 0.15

    # Normalize weights to sum to 1.0
    total = sum(weights.values())
    if total > 0:
        for profile in weights:
            weights[profile] /= total

    return weights

# ============================================================================
# PART 3: PROFILE MIXING - CALCULATE SEGMENT ELASTICITY
# ============================================================================

def calculate_segment_elasticity(profile_weights):
    """
    Calculate elasticity metrics by mixing profiles
    Returns: dict with acquisition, churn, migration elasticities
    """

    # Mix acquisition elasticity
    acquisition_elasticity = sum(
        ELASTICITY_PROFILES[profile]["base_acquisition_elasticity"] * weight
        for profile, weight in profile_weights.items()
    )

    # Mix churn elasticity
    churn_elasticity = sum(
        ELASTICITY_PROFILES[profile]["base_churn_elasticity"] * weight
        for profile, weight in profile_weights.items()
    )

    # Mix migration parameters
    upgrade_willingness = sum(
        ELASTICITY_PROFILES[profile]["base_migration_upgrade"] * weight
        for profile, weight in profile_weights.items()
    )

    downgrade_propensity = sum(
        ELASTICITY_PROFILES[profile]["base_migration_downgrade"] * weight
        for profile, weight in profile_weights.items()
    )

    # Mix behavioral parameters
    tenure_decay_rate = sum(
        ELASTICITY_PROFILES[profile]["tenure_decay_rate"] * weight
        for profile, weight in profile_weights.items()
    )

    engagement_offset = sum(
        ELASTICITY_PROFILES[profile]["engagement_offset"] * weight
        for profile, weight in profile_weights.items()
    )

    price_history_habituation = sum(
        ELASTICITY_PROFILES[profile]["price_history_habituation"] * weight
        for profile, weight in profile_weights.items()
    )

    asymmetry_factor = sum(
        ELASTICITY_PROFILES[profile]["migration_asymmetry_factor"] * weight
        for profile, weight in profile_weights.items()
    )

    # Mix time-lag distribution (weighted average)
    time_lag_distribution = {
        "0_4_weeks": 0.0,
        "4_8_weeks": 0.0,
        "8_12_weeks": 0.0,
        "12_16_weeks": 0.0,
        "16_20_weeks": 0.0
    }

    for profile, weight in profile_weights.items():
        profile_dist = ELASTICITY_PROFILES[profile]["time_lag_distribution"]
        for period in time_lag_distribution:
            time_lag_distribution[period] += profile_dist[period] * weight

    # Determine dominant churn curve type (highest weight profile)
    dominant_profile = max(profile_weights.items(), key=lambda x: x[1])[0]
    churn_curve_type = ELASTICITY_PROFILES[dominant_profile]["churn_curve_type"]

    # Add small noise (±5% for more variance)
    noise = random.uniform(-0.05, 0.05)

    return {
        "acquisition_axis": {
            "elasticity": acquisition_elasticity * (1 + noise),
            "tenure_decay_rate": tenure_decay_rate,
            "engagement_offset": engagement_offset,
            "price_history_habituation": price_history_habituation
        },
        "churn_axis": {
            "elasticity": churn_elasticity * (1 + noise),
            "churn_curve_type": churn_curve_type,
            "time_lag_distribution": time_lag_distribution
        },
        "migration_axis": {
            "upgrade_willingness": upgrade_willingness,
            "downgrade_propensity": downgrade_propensity,
            "asymmetry_factor": asymmetry_factor
        },
        "profile_weights": profile_weights
    }

# ============================================================================
# PART 4: GENERATE SEGMENT ELASTICITY JSON
# ============================================================================

def generate_segment_elasticity_json():
    """
    Generate segment_elasticity.json with profile-mixed elasticities
    """

    # Define segment types
    acquisition_segments = [
        "habitual_streamers",
        "content_anchored_viewers",
        "at_risk_lapsers",
        "promo_only_users",
        "dormant_subscribers"
    ]

    engagement_segments = [
        "ad_value_seekers",
        "ad_tolerant_upgraders",
        "ad_free_loyalists",
        "price_triggered_downgraders",
        "tvod_inclined_buyers"
    ]

    monetization_segments = [
        "platform_bundled_acquirers",
        "tvod_to_svod_converters",
        "content_triggered_buyers",
        "deal_responsive_acquirers",
        "value_perception_buyers"
    ]

    tiers = ["ad_supported", "ad_free"]

    output = {}

    for tier in tiers:
        output[tier] = {"segment_elasticity": {}}

        for acq in acquisition_segments:
            for eng in engagement_segments:
                for mon in monetization_segments:
                    # Create composite key
                    composite_key = f"{acq}|{eng}|{mon}"

                    # Get profile weights
                    profile_weights = get_profile_weights(acq, eng, mon)

                    # Calculate elasticity via profile mixing
                    segment_data = calculate_segment_elasticity(profile_weights)

                    # Adjust for tier (ad_free is generally less elastic)
                    if tier == "ad_free":
                        segment_data["acquisition_axis"]["elasticity"] *= 0.75
                        segment_data["churn_axis"]["elasticity"] *= 0.70

                    # Store
                    output[tier]["segment_elasticity"][composite_key] = segment_data

    return output

# ============================================================================
# PART 5: UPDATE COHORT COEFFICIENTS JSON
# ============================================================================

def generate_cohort_coefficients_json():
    """
    Generate cohort_coefficients.json with behavioral archetypes
    """

    output = {
        "metadata": {
            "description": "Behavioral archetype profiles for customer cohorts",
            "version": "4.0",
            "generation_date": "2026-01-29",
            "method": "Profile mixing with non-linear dynamics"
        }
    }

    # Add each archetype as a cohort
    for profile_name, profile_data in ELASTICITY_PROFILES.items():
        output[profile_name] = {
            "label": profile_data["description"],
            "description": profile_data["description"],
            "acquisition_elasticity": profile_data["base_acquisition_elasticity"],
            "churn_elasticity": profile_data["base_churn_elasticity"],
            "migration_upgrade": profile_data["base_migration_upgrade"],
            "migration_downgrade": profile_data["base_migration_downgrade"],
            "tenure_decay_rate": profile_data["tenure_decay_rate"],
            "engagement_offset": profile_data["engagement_offset"],
            "price_history_habituation": profile_data["price_history_habituation"],
            "churn_curve_type": profile_data["churn_curve_type"],
            "migration_asymmetry_factor": profile_data["migration_asymmetry_factor"],
            "time_lag_distribution": profile_data["time_lag_distribution"]
        }

    # Add baseline (all cohorts weighted equally)
    output["baseline"] = {
        "label": "All Cohorts (Baseline)",
        "description": "Aggregate of all cohorts weighted by population",
        "acquisition_elasticity": -1.6,  # Weighted average
        "churn_elasticity": 0.8,
        "migration_upgrade": 1.0,
        "migration_downgrade": 1.2,
        "tenure_decay_rate": 0.05,
        "engagement_offset": 0.2,
        "price_history_habituation": 0.1,
        "churn_curve_type": "moderate",
        "migration_asymmetry_factor": 2.2,
        "time_lag_distribution": {
            "0_4_weeks": 0.15,
            "4_8_weeks": 0.25,
            "8_12_weeks": 0.30,
            "12_16_weeks": 0.20,
            "16_20_weeks": 0.10
        }
    }

    return output

# ============================================================================
# PART 6: VALIDATION & STATISTICS
# ============================================================================

def validate_generated_data(segment_elasticity_data):
    """
    Validate the generated data and print statistics
    """
    print("\n" + "="*70)
    print("DATA VALIDATION & STATISTICS")
    print("="*70)

    # Collect all acquisition elasticities
    all_acq_elasticities = []
    all_churn_elasticities = []

    for tier in ["ad_supported", "ad_free"]:
        for segment_key, segment_data in segment_elasticity_data[tier]["segment_elasticity"].items():
            all_acq_elasticities.append(segment_data["acquisition_axis"]["elasticity"])
            all_churn_elasticities.append(segment_data["churn_axis"]["elasticity"])

    # Calculate statistics
    print(f"\n📊 Acquisition Elasticity Distribution:")
    print(f"   Min:    {min(all_acq_elasticities):.2f}")
    print(f"   Max:    {max(all_acq_elasticities):.2f}")
    print(f"   Mean:   {sum(all_acq_elasticities)/len(all_acq_elasticities):.2f}")
    print(f"   Spread: {max(all_acq_elasticities) - min(all_acq_elasticities):.2f}")
    print(f"   StdDev: {(sum((x - sum(all_acq_elasticities)/len(all_acq_elasticities))**2 for x in all_acq_elasticities) / len(all_acq_elasticities))**0.5:.2f}")

    print(f"\n📊 Churn Elasticity Distribution:")
    print(f"   Min:    {min(all_churn_elasticities):.2f}")
    print(f"   Max:    {max(all_churn_elasticities):.2f}")
    print(f"   Mean:   {sum(all_churn_elasticities)/len(all_churn_elasticities):.2f}")
    print(f"   Spread: {max(all_churn_elasticities) - min(all_churn_elasticities):.2f}")
    print(f"   StdDev: {(sum((x - sum(all_churn_elasticities)/len(all_churn_elasticities))**2 for x in all_churn_elasticities) / len(all_churn_elasticities))**0.5:.2f}")

    # Check for sufficient differentiation
    print(f"\n✅ SUCCESS CRITERIA:")
    spread = max(all_acq_elasticities) - min(all_acq_elasticities)
    std_dev = (sum((x - sum(all_acq_elasticities)/len(all_acq_elasticities))**2 for x in all_acq_elasticities) / len(all_acq_elasticities))**0.5

    print(f"   ✓ Elasticity spread > 2.0: {spread:.2f} {'✓' if spread > 2.0 else '✗'}")
    print(f"   ✓ Standard deviation > 0.5: {std_dev:.2f} {'✓' if std_dev > 0.5 else '✗'}")
    print(f"   ✓ Total segments: {len(all_acq_elasticities)} (expected 750 = 375×2 tiers)")

    print("\n" + "="*70)

# ============================================================================
# MAIN EXECUTION
# ============================================================================

def main():
    print("\n🚀 STARTING DATA REGENERATION - OPTION 1")
    print("="*70)

    # Set up paths
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    # Generate segment elasticity
    print("\n📝 Task 1/3: Generating segment_elasticity.json...")
    segment_elasticity_data = generate_segment_elasticity_json()

    output_path = data_dir / "segment_elasticity.json"
    with open(output_path, 'w') as f:
        json.dump(segment_elasticity_data, f, indent=2)
    print(f"   ✓ Saved to: {output_path}")
    print(f"   ✓ Generated {len(segment_elasticity_data['ad_supported']['segment_elasticity'])} segments per tier")

    # Generate cohort coefficients
    print("\n📝 Task 2/3: Generating cohort_coefficients.json...")
    cohort_data = generate_cohort_coefficients_json()

    output_path = data_dir / "cohort_coefficients.json"
    with open(output_path, 'w') as f:
        json.dump(cohort_data, f, indent=2)
    print(f"   ✓ Saved to: {output_path}")
    print(f"   ✓ Generated {len(ELASTICITY_PROFILES)} behavioral archetypes + 1 baseline")

    # Validate
    print("\n📝 Task 3/3: Validating generated data...")
    validate_generated_data(segment_elasticity_data)

    print("\n✅ DATA REGENERATION COMPLETE!")
    print("="*70)
    print("\nNext steps:")
    print("1. Update churn-simple.js to load time_lag_distribution from data")
    print("2. Update migration-simple.js to use sigmoid/exponential formulas")
    print("3. Test in browser to verify 'Whoa!' moments")
    print("\n")

if __name__ == "__main__":
    main()
