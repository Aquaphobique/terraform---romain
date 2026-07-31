/**
 * PILOT — Pilot type system
 *
 * Each ship has a pilotType that determines:
 * - How pilot level is rolled
 * - Combat modifiers (accuracy, evasion, reaction speed)
 * - Behavior tendencies (suicidal, improvisational, disciplined)
 *
 * Named characters get additional stat boosts, a visual indicator,
 * and optional plot armor (subtle survival assistance).
 */

// ═══════════════════════════════════════════════════════
// PILOT TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════

export const PILOT_TYPES = {

  // ── ORGANIC PILOTS ──────────────────────────────────

  clone: {
    label: 'Clone Trooper',
    description: 'Mass-produced elite soldiers — disciplined, coordinated, adaptive.',
    /**
     * Level distribution: [lv0_weight, lv1, lv2, lv3, lv4, lv5]
     * Clones start at lv2 minimum (exceptional training from birth).
     */
    levelWeights: [0, 0, 0.80, 0.15, 0.05, 0],
    levelMin: 2, levelMax: 4,
    mods: {
      accuracyBonus:  +0.04,   // formation training improves aim
      evasionBonus:   +0.02,   // tactical discipline
      reactionMult:    1.05,   // slightly faster cooldowns
      suicidal:        false,  // clones value their lives
      improv:          0.10,   // adapts to tactics
      fearless:        false,  // retreats under heavy fire
      formationBonus:  0.03,   // bonus when near allied ships
    },
    icon: '🔵',
  },

  droid_integrated: {
    label: 'Integrated Droid Brain',
    description: 'Ship IS the pilot — droid AI. Predictable but fearless.',
    levelWeights: [0, 1.0, 0, 0, 0, 0],
    levelMin: 1, levelMax: 1,
    mods: {
      accuracyBonus:  -0.04,
      evasionBonus:   -0.06,
      reactionMult:    1.10,
      suicidal:        true,
      improv:         -0.15,
      fearless:        true,
      swarmBonus:      0.04,
    },
    icon: '🤖',
  },

  droid_integrated_advanced: {
    label: 'Advanced Droid AI (Tri-Fighter)',
    description: 'Superior combat droid — more adaptive than basic models.',
    levelWeights: [0, 0, 1.0, 0, 0, 0],
    levelMin: 2, levelMax: 2,
    mods: {
      accuracyBonus:  -0.01,
      evasionBonus:   -0.03,
      reactionMult:    1.08,
      suicidal:        true,
      improv:         -0.05,
      fearless:        true,
      swarmBonus:      0.02,
    },
    icon: '🤖',
  },

  /**
   * Droid Captain — commands CIS frigates (Munificent, etc.).
   * Experienced tactical droid: level 2–4.
   */
  droid_captain: {
    label: 'Droid Captain (CIS Frigate)',
    description: 'Experienced tactical droid — commands smaller CIS capital ships.',
    levelWeights: [0, 0, 0.55, 0.35, 0.10, 0],
    levelMin: 2, levelMax: 4,
    mods: {
      accuracyBonus:   0.00,
      evasionBonus:   -0.02,
      reactionMult:    1.05,
      suicidal:        true,
      improv:         -0.05,
      fearless:        true,
    },
    icon: '🤖',
  },

  /**
   * Droid Strategist — commands CIS dreadnoughts (Providence-class).
   * Highest tier droid AI: level 3–4.
   */
  droid_strategist: {
    label: 'Droid Strategist (Providence)',
    description: 'Elite tactical AI commanding a CIS dreadnought — highly capable.',
    levelWeights: [0, 0, 0, 0.60, 0.40, 0],
    levelMin: 3, levelMax: 4,
    mods: {
      accuracyBonus:  +0.03,
      evasionBonus:   -0.01,
      reactionMult:    1.06,
      suicidal:        true,
      improv:          0.03,
      fearless:        true,
    },
    icon: '🤖',
  },

  /**
   * Clone Commander — commands Republic capital ships (Venator).
   * Elite soldiers promoted to command: level 3–4.
   */
  clone_commander: {
    label: 'Clone Commander',
    description: 'Elite clone officer — naturally promoted for exceptional performance.',
    levelWeights: [0, 0, 0, 0.55, 0.40, 0.05],
    levelMin: 3, levelMax: 5,
    mods: {
      accuracyBonus:  +0.06,
      evasionBonus:   +0.03,
      reactionMult:    1.08,
      suicidal:        false,
      improv:          0.15,
      fearless:        false,
      formationBonus:  0.04,
    },
    icon: '🔵',
  },

  force_user: {
    label: 'Force User',
    description: 'Force-sensitive pilot — precognition and enhanced reflexes are extraordinary.',
    levelWeights: [0, 0, 0, 0.45, 0.45, 0.10],
    levelMin: 3, levelMax: 5,
    mods: {
      accuracyBonus:  +0.15,
      evasionBonus:   +0.12,
      reactionMult:    1.15,
      suicidal:        false,
      improv:          0.25,
      fearless:        false,
      forceAware:      true,
      forceDodge:      true,    // NEW: can dodge one hit every 10 ticks
    },
    icon: '⚡',
  },

  imperial: {
    label: 'Imperial Navy Pilot',
    description: 'Trained academy pilot — disciplined but sometimes overconfident.',
    levelWeights: [0, 0.60, 0.30, 0.10, 0, 0],
    levelMin: 1, levelMax: 3,
    mods: {
      accuracyBonus:  +0.02,
      evasionBonus:   -0.01,
      reactionMult:    1.0,
      suicidal:        false,
      improv:          0.05,
      fearless:        false,
    },
    icon: '🎖',
  },

  rebel: {
    label: 'Rebel Alliance Pilot',
    description: 'Scrappy guerrilla — improvises well, surprising agility.',
    levelWeights: [0, 0.50, 0.35, 0.15, 0, 0],
    levelMin: 1, levelMax: 3,
    mods: {
      accuracyBonus:   0.00,
      evasionBonus:   +0.05,
      reactionMult:    1.02,
      suicidal:        false,
      improv:          0.15,
      fearless:        false,
      escapeBonus:     0.10,
      policyUnlocks:   ['hit_and_run'],  // rebels can always run and gun
    },
    icon: '✊',
  },

  bounty_hunter: {
    label: 'Bounty Hunter',
    description: 'Experienced mercenary — excellent pilot, pragmatic survival instinct.',
    levelWeights: [0, 0.20, 0.55, 0.25, 0, 0],
    levelMin: 2, levelMax: 3,
    mods: {
      accuracyBonus:  +0.06,   // years of real combat
      evasionBonus:   +0.06,
      reactionMult:    1.05,
      suicidal:        false,
      improv:          0.18,
      fearless:        false,
      mercenary:       true,   // may disengage if the fight is too costly
    },
    icon: '🎯',
  },

  pirate: {
    label: 'Pirate',
    description: 'Self-taught opportunist — unpredictable, dangerous when cornered.',
    levelWeights: [0, 0.40, 0.45, 0.15, 0, 0],
    levelMin: 1, levelMax: 3,
    mods: {
      accuracyBonus:  -0.02,
      evasionBonus:   +0.04,
      reactionMult:    1.03,
      suicidal:        false,
      improv:          0.12,
      fearless:        false,
      dirtyTactics:    0.05,
      policyUnlocks:   ['weapons'],   // can use weapons boost at any level
    },
    icon: '☠️',
  },

  smuggler: {
    label: 'Smuggler',
    description: 'Extremely skilled at running and evading — mediocre fighter.',
    levelWeights: [0, 0.35, 0.50, 0.15, 0, 0],
    levelMin: 1, levelMax: 3,
    mods: {
      accuracyBonus:  -0.03,
      evasionBonus:   +0.08,
      reactionMult:    1.04,
      suicidal:        false,
      improv:          0.20,
      fearless:        false,
      escapeBonus:     0.15,
      policyUnlocks:   ['retreat'],   // can use retreat at any level
    },
    icon: '🚀',
  },

  militia: {
    label: 'Militia',
    description: 'Irregular volunteer — variable skill, passionate but under-trained.',
    levelWeights: [0, 0.70, 0.25, 0.05, 0, 0],
    levelMin: 1, levelMax: 3,
    mods: {
      accuracyBonus:  -0.03,
      evasionBonus:    0.00,
      reactionMult:    0.95,
      suicidal:        false,
      improv:          0.08,
      fearless:        false,
    },
    icon: '🛡',
  },

  civilian: {
    label: 'Civilian',
    description: 'Non-combat trained — very limited capabilities.',
    levelWeights: [0, 0.85, 0.15, 0, 0, 0],
    levelMin: 1, levelMax: 2,
    mods: {
      accuracyBonus:  -0.10,
      evasionBonus:   -0.05,
      reactionMult:    0.85,
      suicidal:        false,
      improv:          0.05,
      fearless:        false,
    },
    icon: '👤',
  },
};

// ═══════════════════════════════════════════════════════
// LEVEL ROLLING
// ═══════════════════════════════════════════════════════

/**
 * Roll a pilot level from the type's distribution.
 * @param {string} pilotType - key in PILOT_TYPES
 * @returns {number} pilot level 1-5
 */
export function rollPilotLevel(pilotType) {
  const def = PILOT_TYPES[pilotType];
  if (!def) return 1;

  const weights = def.levelWeights;
  let r = Math.random();
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return def.levelMin;
}

// ═══════════════════════════════════════════════════════
// COMBAT MODIFIERS
// ═══════════════════════════════════════════════════════

/**
 * Returns combined combat modifiers for a ship based on pilotType,
 * pilotLevel, and namedCharacter performance.
 *
 * @param {Ship} ship
 * @returns {{ accuracyMod, evasionMod, cooldownMult, fearless, suicidal, improv }}
 */
export function getPilotCombatMods(ship) {
  const typeDef  = PILOT_TYPES[ship.pilotType || 'imperial'];
  const typeMods = typeDef?.mods || {};
  const level    = ship.pilotLevel || 1;

  // Each pilot level adds small flat bonus
  const levelBonus = (level - 1) * 0.025;

  // Named character bonus — max +50% at performance 20
  let namedBonus = 0;
  if (ship.namedCharacter?.enabled) {
    const perf = ship.namedCharacter.performance || 1;
    namedBonus = Math.min(0.50, perf * 0.025); // perf 1→2.5%, perf 20→50%
  }

  // Crew bonus (improving decision quality)
  const crewBonus = getCrewBonus(ship);

  // Last stand: < 10% HP → +25% to all offensive/defensive capabilities
  const lastStand = (ship.hp / (ship.maxHp || 1)) < 0.10 ? 0.25 : 0;

  return {
    accuracyMod:    (typeMods.accuracyBonus || 0) + levelBonus + namedBonus + crewBonus + lastStand,
    evasionMod:     (typeMods.evasionBonus  || 0) + levelBonus * 0.5 + namedBonus * 0.5 + lastStand,
    cooldownMult:   typeMods.reactionMult   || 1.0,
    fearless:       typeMods.fearless       || false,
    suicidal:       typeMods.suicidal       || false,
    improv:         typeMods.improv         || 0,
    swarmBonus:     typeMods.swarmBonus     || 0,
    escapeBonus:    typeMods.escapeBonus    || 0,
    forceAware:     typeMods.forceAware     || false,
    forceDodge:     typeMods.forceDodge     || false,
    mercenary:      typeMods.mercenary      || false,
    policyUnlocks:  typeMods.policyUnlocks  || [],
    // Droid G-force resistance: tighter turns
    gTurnMult:      isDroid(ship.pilotType) ? 1.35 : 1.0,
    lastStand:      lastStand > 0,
    crewBonus,
  };
}

/** Whether a pilot type is droid-based (can handle more G-forces) */
export function isDroid(pilotType) {
  return ['droid_integrated', 'droid_integrated_advanced', 'droid_captain',
          'droid_strategist', 'droid_maintenance'].includes(pilotType);
}

/**
 * Crew bonus to decision-making (diminishing returns, max +10%)
 * 1: 0%, 2: +3%, 3: +5%, 4: +6%, 5+: +0.25% per member, cap 10%
 */
export function getCrewBonus(ship) {
  const crew = ship.crew ?? 1;
  if (crew <= 1) return 0;
  let bonus = 0;
  if (crew >= 2) bonus += 0.03;
  if (crew >= 3) bonus += 0.02;
  if (crew >= 4) bonus += 0.01;
  if (crew >= 5) bonus += (crew - 4) * 0.0025;
  return Math.min(0.10, bonus);
}

// ═══════════════════════════════════════════════════════
// PLOT ARMOR
// ═══════════════════════════════════════════════════════

/**
 * Called when a named character's HP would drop to 0.
 * Returns true if plot armor saves them (they survive at 1 HP).
 *
 * Plot armor is subtle — it doesn't make characters invincible:
 * - Performance 1-5:   20% survival chance, max 1 save
 * - Performance 6-10:  40% survival chance, max 2 saves
 * - Performance 11-15: 60% survival chance, max 3 saves
 * - Performance 16-19: 80% survival chance, max 4 saves
 * - Performance 20:    95% survival chance, max 5 saves
 *
 * @param {Ship} ship
 * @param {Function} logFn
 * @returns {boolean} true = saved, false = truly dead
 */
export function checkPlotArmor(ship, logFn) {
  const nc = ship.namedCharacter;
  if (!nc?.enabled || !nc.plotArmor) return false;

  const perf      = nc.performance || 1;
  const maxSaves  = Math.floor(perf / 5) + 1;
  const savesMade = nc._savesMade || 0;

  if (savesMade >= maxSaves) return false; // armor exhausted

  const survivalChance = Math.min(0.95, 0.20 + (perf - 1) * 0.038);
  if (Math.random() > survivalChance) return false; // failed the save

  nc._savesMade = savesMade + 1;
  ship.hp = 1;

  const messages = [
    `${ship.name} barely pulls out of the explosion!`,
    `${ship.name} survives — shields held just long enough!`,
    `${ship.name} is heavily damaged but still flying!`,
    `Somehow, ${ship.name} lives to fight another day.`,
    `${ship.name} escapes the killing blow by a hair's breadth!`,
  ];
  logFn?.(messages[Math.floor(Math.random() * messages.length)], 'death');
  return true;
}

/**
 * Pilot level label (1-5 mapped to title).
 */
export function pilotLevelLabel(level) {
  return ['', 'Rookie', 'Veteran', 'Ace', 'Elite', 'Legendary'][Math.min(5, level)] || 'Unknown';
}

export default PILOT_TYPES;
