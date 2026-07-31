/**
 * COMBAT POLICY — Tactical stance
 *
 * hit_and_run:     Fast passes, bonus while moving
 * blockade:        Defensive wall — slow but absorbs + deals more
 * assault:         Frontal push — max damage, -5% frontal damage taken
 * blockade_runner: Transit mode — shields + speed, weapons on auto-defense only
 *
 * Policy changes take 3 ticks (2 for level 5 pilots).
 */

export const COMBAT_POLICIES = {
  standard: {
    label: '⚖️ Standard',
    desc:  'Mode équilibré — aucun bonus ni malus',
    movingDamageMult:  1.0,
    movingEvasionMult: 1.0,
    damageReceiveMult: 1.0,
    damageDealMult:    1.0,
    rangeMult:         1.0,
    speedMult:         1.0,
    frontDamageReduction: 0,
    holdPosition:      false,
    preferStrafing:    false,
    defensiveOnly:     false,
  },
  assault: {
    label: '⚔️ Assaut',
    desc:  '+8% dmg infligés | +3% portée | -5% dmg frontaux subits',
    movingDamageMult:  1.0,
    movingEvasionMult: 1.0,
    damageReceiveMult: 1.0,
    damageDealMult:    1.08,
    rangeMult:         1.03,
    speedMult:         1.0,
    frontDamageReduction: 0.05,  // -5% incoming frontal damage
    holdPosition:      false,
    preferStrafing:    false,
    defensiveOnly:     false,
  },
  hit_and_run: {
    label: '🔄 Hit & Run',
    desc:  '+5% dmg & évasion en mouvement | +3% vitesse',
    movingDamageMult:  1.05,
    movingEvasionMult: 1.05,
    damageReceiveMult: 1.0,
    damageDealMult:    1.0,
    rangeMult:         1.0,
    speedMult:         1.03,
    frontDamageReduction: 0,
    holdPosition:      false,
    preferStrafing:    true,
    defensiveOnly:     false,
  },
  blockade: {
    label: '🔒 Blocus',
    desc:  '-25% vitesse | +7% dmg infligés | -10% dmg subits',
    movingDamageMult:  1.0,
    movingEvasionMult: 1.0,
    damageReceiveMult: 0.90,
    damageDealMult:    1.07,
    rangeMult:         1.0,
    speedMult:         0.75,
    frontDamageReduction: 0,
    holdPosition:      true,
    preferStrafing:    false,
    defensiveOnly:     false,
  },
  blockade_runner: {
    label: '💨 Blockade Runner',
    desc:  '+5% vitesse | +10% regen boucliers | armes défensives uniquement',
    movingDamageMult:  1.0,
    movingEvasionMult: 1.0,
    damageReceiveMult: 1.0,
    damageDealMult:    1.0,
    rangeMult:         1.0,
    speedMult:         1.05,
    shieldRegenMult:   1.10,
    frontDamageReduction: 0,
    holdPosition:      false,
    preferStrafing:    false,
    defensiveOnly:     true,  // no proactive targeting, weapons on auto-defense
  },
};

/**
 * Returns combat policy modifiers for a ship.
 * @param {object} ship
 * @param {boolean} isMoving
 */
export function getCombatPolicyMods(ship, isMoving = false) {
  const pol = COMBAT_POLICIES[ship.combatPolicy] || COMBAT_POLICIES.assault;
  return {
    damageDealMult:       pol.damageDealMult * (isMoving ? pol.movingDamageMult : 1.0),
    damageReceiveMult:    pol.damageReceiveMult,
    frontDamageReduction: pol.frontDamageReduction || 0,
    evasionBonus:         isMoving ? (pol.movingEvasionMult - 1.0) : 0,
    rangeMult:            pol.rangeMult,
    speedMult:            pol.speedMult,
    shieldRegenMult:      pol.shieldRegenMult || 1.0,
    holdPosition:         pol.holdPosition || false,
    preferStrafing:       pol.preferStrafing || false,
    defensiveOnly:        pol.defensiveOnly || false,
  };
}

/**
 * Ticks remaining to change policy.
 * Level 5 pilots change in 2 ticks, others 3 ticks.
 */
export function getPolicyChangeDelay(ship) {
  return (ship.pilotLevel || 1) >= 5 ? 2 : 3;
}

// ─── Ship-type based unlocks ────────────────────────────────────
const BOMBER_TYPES   = ['bomber'];
const BLOCKADE_RUNNER_CLASSES = ['cr90', 'corvette', 'pelta', 'pelta_frigate'];
const CAPITAL_TYPES  = ['cruiser', 'light_cruiser', 'destroyer', 'frigate', 'star_destroyer'];

/**
 * Returns the set of combat policies available to this ship.
 * Level 1-2 are restricted to 'standard' unless exceptions apply.
 */
export function getAvailablePolicies(ship) {
  const level = ship.pilotLevel || 1;
  const type  = ship.type || '';
  const classId = ship.classId || '';
  const unlocks = ship._pilotPolicyUnlocks || [];

  // All pilots can use standard
  const available = new Set(['standard']);

  // Level 3+ get everything
  if (level >= 3) {
    Object.keys(COMBAT_POLICIES).forEach(k => available.add(k));
    return available;
  }

  // Level 1-2 exceptions:
  // Smuggler → blockade_runner (from policyUnlocks)
  // Pirate → weapons (from policyUnlocks, handled in energy)
  // Rebel → hit_and_run (from policyUnlocks)
  for (const u of unlocks) available.add(u);

  // Bomber ships → hit_and_run
  if (BOMBER_TYPES.includes(type)) available.add('hit_and_run');

  // CR90 Corvette / Pelta → blockade_runner
  if (BLOCKADE_RUNNER_CLASSES.some(c => classId.toLowerCase().includes(c) || type.toLowerCase().includes(c))) {
    available.add('blockade_runner');
  }

  // Cruiser / Destroyer → blockade + assault
  if (CAPITAL_TYPES.includes(type) || ['M','L','XL','XXL'].includes(ship.size)) {
    available.add('blockade');
    available.add('assault');
  }

  return available;
}
