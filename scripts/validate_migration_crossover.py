#!/usr/bin/env python3
"""
Validate that migration curves cross at $4 gap
"""

import math

def calculate_migration_rates(price_gap):
    """Calculate upgrade and downgrade rates using the formulas from migration-simple.js"""

    # Upgrade: Sigmoid function
    upgrade_max = 10.0
    upgrade_k = -0.75
    upgrade_midpoint = 2.5
    upgrade_pct = upgrade_max / (1 + math.exp(upgrade_k * (price_gap - upgrade_midpoint)))

    # Downgrade: Exponential with threshold
    downgrade_base = 0.8
    downgrade_threshold = 4.5

    if price_gap < downgrade_threshold:
        downgrade_pct = downgrade_base + 3.5 * (price_gap / downgrade_threshold) ** 2
    else:
        downgrade_pct = downgrade_base + 3.5 + 4.0 * math.exp(0.35 * (price_gap - downgrade_threshold))

    return upgrade_pct, downgrade_pct

# Test various price gaps
print("\n" + "="*70)
print("MIGRATION CURVE VALIDATION")
print("="*70)
print(f"\n{'Price Gap':<12} {'Upgrade %':<12} {'Downgrade %':<12} {'Net Flow':<12} {'Status'}")
print("-"*70)

for gap in [1, 2, 3, 3.5, 4, 4.5, 5, 6, 7, 8]:
    upgrade, downgrade = calculate_migration_rates(gap)
    net_flow = upgrade - downgrade

    # Determine status
    if abs(net_flow) < 0.5:
        status = "⚖️  EQUILIBRIUM"
    elif net_flow > 0:
        status = "⬆️  Net Upgrade"
    else:
        status = "⬇️  Net Downgrade"

    print(f"${gap:<11.1f} {upgrade:<11.1f}% {downgrade:<11.1f}% {net_flow:>+10.1f}% {status}")

print("="*70)
print("\n✅ Expected behavior:")
print("   - Crossover should be near $4 gap (upgrade ≈ downgrade)")
print("   - At $2 gap: Strong net upgrade flow")
print("   - At $6 gap: Strong net downgrade flow")
print("   - Curves should be non-linear (not straight lines)")
print("\n")
