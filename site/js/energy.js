/**
 * ENERGY — Energy policy system
 *
 * Ships can redistribute power between three systems:
 *   Reactor (speed/maneuverability)
 *   Shields (defense)
 *   Weapons (offense)
 *
 * Requires pilot level 2+ for non-balanced modes.
 * Requires pilot level 3+ for assault/retreat.
 *
 * The auto-adapt flag lets the pilot switch mode automatically based on situation.
 */

// ═══════════════════════════════════════════════════════
// POLICY MODIFIERS TABLE
// ═══════════════════════════════════════════════════════

export const ENERGY_POLICIES = {
  balanced: {
    label: '⚡ Balanced',
    desc:  'Default — equal distribution',
    minLevel: 1,
    speedMult:         1.0,
    turnMult:          1.0,
    shieldMaxMult:     1.0,
    shieldRegenMult:   1.0,
    weaponCooldownMult:1.0,
    weaponDamageMult:  1.0,
  },
  reactor: {
    label: '🚀 Reactor Boost',
    desc:  '+35% speed & agility | −25% shields | −40% weapon rate',
    minLevel: 2,
    speedMult:         1.4375,
    turnMult:          1.375,
    shieldMaxMult:     0.6875,
    shieldRegenMult:   0.375,
    weaponCooldownMult:1.5,
    weaponDamageMult:  1.0,
  },
  shields: {
    label: '🛡 Shield Boost',
    desc:  '+50% shields & regen | −30% speed | −40% weapon rate',
    minLevel: 2,
    speedMult:         0.625,
    turnMult:          0.75,
    shieldMaxMult:     1.625,
    shieldRegenMult:   1.625,
    weaponCooldownMult:1.5,
    weaponDamageMult:  0.875,
  },
  weapons: {
    label: '⚔️ Weapons Boost',
    desc:  '+35% damage & −35% cooldown | −20% speed | −30% shields',
    minLevel: 2,
    speedMult:         0.75,
    turnMult:          0.875,
    shieldMaxMult:     0.8125,
    shieldRegenMult:   0.625,
    weaponCooldownMult:0.5625,
    weaponDamageMult:  1.4375,
  },
  assault: {
    label: '⚡ Frontal Assault',
    desc:  'Shield & weapon overcharge forward | −25% speed | rear shields weak',
    minLevel: 3,
    speedMult:         0.8125,
    turnMult:          0.8125,
    shieldMaxMult:     1.125,    // overall boost (directional TODO for dev)
    shieldRegenMult:   0.875,
    weaponCooldownMult:0.6875,
    weaponDamageMult:  1.25,
  },
  retreat: {
    label: '🚀 Evasive Retreat',
    desc:  '+40% speed | rear shields strong | −40% weapons | front shields weak',
    minLevel: 3,
    speedMult:         1.5,
    turnMult:          1.25,
    shieldMaxMult:     1.25,    // rear-weighted (directional TODO for dev)
    shieldRegenMult:   1.125,
    weaponCooldownMult:1.625,
    weaponDamageMult:  0.5,
  },
};

// ═══════════════════════════════════════════════════════
// EFFECTIVE MODIFIERS (applies policy + balancing note)
// ═══════════════════════════════════════════════════════

/**
 * Returns effective modifiers for a ship, clamped to its pilot level.
 * If the ship's policy requires higher level than it has, falls back to balanced.
 */
export function getEnergyMods(ship) {
  const policy = ship.energyPolicy || 'balanced';
  const level  = ship.pilotLevel   || 1;
  const mods   = ENERGY_POLICIES[policy];

  // Capital ships have dedicated engineering crews
  const hasEngineeringCrew = ['M','L','XL','XXL'].includes(ship.size);
  const effectiveLevel = hasEngineeringCrew ? Math.max(level, 2) : level;

  // Pilot type special policy unlocks (set at ship creation as _pilotPolicyUnlocks)
  let baseMods;
  if (!mods) {
    baseMods = ENERGY_POLICIES.balanced;
  } else if (mods.minLevel > effectiveLevel) {
    const unlocked = (ship._pilotPolicyUnlocks || []).includes(policy);
    baseMods = unlocked ? mods : ENERGY_POLICIES.balanced;
  } else {
    baseMods = mods;
  }

  // Last stand: < 10% HP → +25% to all capabilities
  const isLastStand = ship.hp > 0 && (ship.hp / (ship.maxHp || 1)) < 0.10;

  // Astromech boosts non-neutral policy effects by 10%
  const hasAstromech = (ship.inventory?.astromech ?? 0) > 0;

  if (!isLastStand && !hasAstromech) return baseMods;

  // Amplify modifier deviations from 1.0
  const amp = (v) => {
    if (v === 1) return isLastStand ? 1.25 * v : v; // last stand: global boost for neutral mults too
    let d = v - 1;
    if (hasAstromech) d *= 1.10;         // astromech: +10% effect
    if (isLastStand)  d *= 1.25;         // last stand: +25% effect
    return 1 + d;
  };

  return {
    ...baseMods,
    speedMult:          amp(baseMods.speedMult),
    turnMult:           amp(baseMods.turnMult),
    shieldMaxMult:      amp(baseMods.shieldMaxMult),
    shieldRegenMult:    amp(baseMods.shieldRegenMult),
    weaponCooldownMult: amp(baseMods.weaponCooldownMult),
    weaponDamageMult:   amp(baseMods.weaponDamageMult),
  };
}

// ═══════════════════════════════════════════════════════
// AUTO-ADAPT LOGIC
// ═══════════════════════════════════════════════════════

/**
 * Auto-adapt: switch energy policy based on situation.
 * Called once per tick for ships with autoEnergyPolicy = true.
 *
 * @param {Ship} ship
 */
export function autoAdaptEnergy(ship) {
  if (!ship.autoEnergyPolicy) return;
  const level = ship.pilotLevel || 1;
  if (level < 2) return; // need at least level 2 for any non-balanced policy

  const hpPct     = ship.hp / ship.maxHp;
  const shPct     = ship.shields.max > 0 ? ship.shields.current / ship.shields.max : 1;
  const hasTarget = !!ship.attacking || !!ship.permanentOrder?.targetId;

  if (hpPct < 0.25 && level >= 3) {
    ship.energyPolicy = 'retreat';
  } else if (shPct < 0.25 && level >= 2) {
    ship.energyPolicy = 'shields';
  } else if (hasTarget && shPct > 0.65) {
    if (level >= 3 && (ship.behavior.mode === 'aggressive' || ship.permanentOrder)) {
      ship.energyPolicy = 'assault';
    } else if (level >= 2) {
      ship.energyPolicy = 'weapons';
    }
  } else if (!hasTarget && hpPct > 0.6) {
    ship.energyPolicy = 'balanced';
  }
  // else: keep current policy
}
