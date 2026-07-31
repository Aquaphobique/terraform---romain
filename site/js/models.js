/**
 * MODELS — Data models for the simulator
 *
 * Factory functions that create objects with default values.
 * Always use these functions instead of raw object literals
 * to guarantee schema consistency.
 */

import { nanoid, SIZE_DEFAULT_HP, SIZE_DEFAULT_SPEED, CARGO_HOLD_VOLUME, MEDICAL_BAY_CAPACITY, BRIG_CAPACITY } from './utils.js';

// ═══════════════════════════════════════════════════════
// CARGO — types de marchandises pour la cale des vaisseaux
// ═══════════════════════════════════════════════════════

/**
 * Catalogue des types de cargaison déployables par le MJ dans la cale d'un
 * vaisseau (ship.cargoHold). Chaque type a un volume unitaire (combien de
 * place une unité de cette marchandise prend) et une étiquette de légalité
 * pour l'ambiance RP — n'affecte pas les règles, juste l'affichage.
 * Les BLESSÉS et CAPTIFS ne sont PAS dans ce catalogue : ils utilisent leurs
 * propres compartiments dédiés (medicalBay / brig), voir createShip.
 */
export const CARGO_TYPES = {
  // ── Ressources de base ──
  vivres:        { label: '🍞 Vivres / rations',            legal: true,  unitVolume: 2,  color: '#6ab04c' },  // ~2t/unité (caisses ravitaillement)
  eau:           { label: '💧 Eau',                          legal: true,  unitVolume: 5,  color: '#22a6e8' },
  carburant:     { label: '⛽ Carburant',                     legal: true,  unitVolume: 10, color: '#f0932b' },
  // ── Matières premières / industrie ──
  mineraux:      { label: '⛏ Minéraux',                      legal: true,  unitVolume: 5,  color: '#888fa0' },
  mineraux_precieux: { label: '💎 Minéraux précieux',         legal: true,  unitVolume: 1,  color: '#a29bfe' },
  kyber_brut:    { label: '🔷 Cristaux Kyber bruts',          legal: true,  unitVolume: 1,  color: '#74b9ff' },
  composants:    { label: '🔧 Composants techniques',         legal: true,  unitVolume: 3,  color: '#fdcb6e' },
  pieces_droides:{ label: '🤖 Droïdes en pièces détachées',   legal: true,  unitVolume: 3,  color: '#b2bec3' },
  textiles:      { label: '🧵 Textiles / biens manufacturés', legal: true,  unitVolume: 2,  color: '#fd79a8' },
  // ── Commerce médical / civil ──
  medical:       { label: '💉 Matériel médical',              legal: true,  unitVolume: 1,  color: '#00b894' },
  betail:        { label: '🐄 Bétail',                        legal: true,  unitVolume: 8,  color: '#a0522d' },
  armes_civiles: { label: '🔫 Armes civiles',                 legal: true,  unitVolume: 2,  color: '#c0392b' },
  // ── Marchandises spéciales / dangereuses ──
  carbonite:     { label: '🧊 Blocs de carbonite',            legal: true,  unitVolume: 3,  color: '#636e72' },
  explosifs:     { label: '💣 Explosifs',                     legal: true,  unitVolume: 1,  color: '#e17055' },
  matieres_dangereuses: { label: '☢ Matières dangereuses',   legal: true,  unitVolume: 2,  color: '#d63031' },
  artefacts:     { label: '🏺 Artéfacts / reliques',          legal: true,  unitVolume: 1,  color: '#e6b800' },
  // ── Illégal ──
  epice:         { label: '🌶 Épice',                         legal: false, unitVolume: 1,  color: '#e84393' },
  contrebande:   { label: '📦 Contrebande',                   legal: false, unitVolume: 2,  color: '#8e44ad' },
  contrebande_precieuse: { label: '💰 Contrebande précieuse', legal: false, unitVolume: 2,  color: '#c0392b' },
  armes_guerre:  { label: '⚔ Armes de guerre',                legal: false, unitVolume: 5,  color: '#e74c3c' },
  donnees_classifiees: { label: '🗃 Données classifiées',     legal: false, unitVolume: 1,  color: '#6c5ce7' },
  detritus:      { label: '🗑 Détritus',                       legal: true,  unitVolume: 2,  color: '#4a4a4a' },
};



// ═══════════════════════════════════════════════════════
// WEAPONS
// ═══════════════════════════════════════════════════════

/**
 * Creates a weapon.
 * @param {object} overrides
 * @returns {Weapon}
 */
export function createWeapon(overrides = {}) {
  return {
    id:           overrides.id           || nanoid(),
    name:         overrides.name         || 'Light Laser',
    type:         overrides.type         || 'laser',
    size:         overrides.size         || 'light',
    damage:       overrides.damage       ?? 10,
    range:        overrides.range        ?? 5,
    accuracy:     overrides.accuracy     ?? 0.8,
    cooldown:     overrides.cooldown     ?? 2,
    ionStacks:    overrides.ionStacks    ?? 0,
    ignoreShields:overrides.ignoreShields ?? 0,
    areaRadius:   overrides.areaRadius   ?? 0,
    ammoUsage:    overrides.ammoUsage    ?? 0,
    mode:         overrides.mode         || 'single',
    /**
     * color: laser beam color (Star Wars lore).
     *   '#ff3333' red    — cheap tibanna gas, most common
     *   '#33cc55' green  — higher quality gas, +10% dmg
     *   '#4488ff' blue   — ion-based, better vs shields
     *   '#ff8833' orange — low power / training
     *   '#cc44ff' purple — rare, very powerful
     *   '#ffff44' yellow — high energy variant
     */
    color:        overrides.color        || '#ff3333',
    /** continuous: true = sustained beam (rare). false = travelling bolt. */
    continuous:   overrides.continuous   ?? false,
    /** travelSpeed: bolt travel speed in cells/s (visual only). */
    travelSpeed:  overrides.travelSpeed  ?? 20,
    firingArc:    overrides.firingArc    ?? 360,
    arcOffset:    overrides.arcOffset    ?? 0,
    /**
     * defensive: if true, weapon independently targets ships attacking THIS vessel —
     * even while the ship is pursuing another target.
     * Example: Y-Wing dorsal turret fires at pursuers while bombing capital ships.
     */
    defensive:    overrides.defensive    ?? false,
    currentCooldown: 0,
  };
}

// ═══════════════════════════════════════════════════════
// SHIELDS
// ═══════════════════════════════════════════════════════

/**
 * Creates a shields block.
 * @param {object} overrides
 * @returns {Shields}
 */
export function createShields(overrides = {}) {
  const max = overrides.max ?? 0;
  return {
    max,
    current:       overrides.current      ?? max,
    rechargeRate:  overrides.rechargeRate  ?? 0.05,  // points per tick
    restartDelay:  overrides.restartDelay  ?? 3,     // ticks before restart after shutdown
    restartCounter: 0,   // internal countdown
    disabled:      false,
  };
}

// ═══════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════

/**
 * Creates an ammo inventory.
 * @param {object} overrides
 * @returns {Inventory}
 */
export function createInventory(overrides = {}) {
  return {
    torpedoes:      overrides.torpedoes      ?? 0,
    heavyTorpedoes: overrides.heavyTorpedoes ?? 0,
    ionTorpedoes:   overrides.ionTorpedoes   ?? 0,
    missiles:       overrides.missiles       ?? 0,
    mines:          overrides.mines          ?? 0,
    bombs:          overrides.bombs          ?? 0,
  };
}

// ═══════════════════════════════════════════════════════
// AI BEHAVIOR
// ═══════════════════════════════════════════════════════

/**
 * Creates an AI behavior block.
 *
 * Modes:
 *   neutral   → retaliates only if attacked
 *   passive   → never fires
 *   aggressive → attacks all enemies within radius
 *   target    → attacks a specific ship (targetId)
 *   escort    → follows and defends an ally (targetId)
 *   patrol    → patrols between points[], attacks unauthorized ships
 *
 * @param {object} overrides
 * @returns {Behavior}
 */
export function createBehavior(overrides = {}) {
  return {
    mode:             overrides.mode             || 'neutral',
    targetId:         overrides.targetId         || null,
    radius:           overrides.radius           ?? 25,   // detection radius in cells
    distance:         overrides.distance         ?? 2,
    points:           overrides.points           || [],
    authorizedFleets: overrides.authorizedFleets || [],
    // Internal state
    patrolIndex:      0,
    attackedBy:       null,   // ID of the ship that attacked this one (neutral mode)
  };
}

// ═══════════════════════════════════════════════════════
// SHIP (GAME INSTANCE)
// ═══════════════════════════════════════════════════════

/**
 * Creates a ship instance (in-game object).
 *
 * This is the central object of the simulator. Each ship in the game
 * is an independent instance with its own state.
 *
 * @param {object} overrides
 * @returns {Ship}
 */
export function createShip(overrides = {}) {
  const size  = overrides.size  || 'S';
  const maxHp = overrides.maxHp || SIZE_DEFAULT_HP[size] || 100;

  return {
    // ─── Fleet / Faction ──────────────────────
    fleetId:           overrides.fleetId           || null,
    _factionColorIndex: (overrides._factionColorIndex !== undefined)
                        ? overrides._factionColorIndex : null,

    // ─── Pilot special capabilities ───────────
    // Pilot type policy unlocks (set from PILOT_TYPES at instantiation)
    _pilotPolicyUnlocks: overrides._pilotPolicyUnlocks || [],
    // Force-sensitive dodge cooldown (10 ticks between dodges)
    _forceDodgeCooldown: overrides._forceDodgeCooldown ?? 0,
    // Recently hit flag (used by astromech healing)
    _recentlyHit:       false,

    // ─── Crew ─────────────────────────────────
    // Number of crew members — improves decision quality (max bonus +10% at large crews)
    crew: overrides.crew ?? 1,

    // ─── Combat stance ────────────────────────
    // 'hit_and_run' | 'blockade' | 'assault'
    combatPolicy: overrides.combatPolicy || 'assault',

    // ─── Capacités spéciales ──────────────────
    // Puits de gravité (interdicteur) : bloque l'hyperespace ennemi dans ce rayon (cases)
    gravityWell: overrides.gravityWell || 0,
    // Rayon tracteur : portée de capture (cases). 0 = aucun. La taille max
    // capturable dépend de la taille du vaisseau capteur (voir simulation).
    tractorBeam: overrides.tractorBeam || 0,
    // Scanner : portée (cases). 0 = pas de scanner. Scan court → formes de
    // vie. Long scan → signature énergétique + nature de la cargaison.
    scanner: overrides.scanner ?? 0,
    // Éjection de cargaison : true si le vaisseau est équipé d'un système
    // d'éjection (ex. Gozanti, cargos lourds). Crée des conteneurs flottants
    // récupérables. Valeur par défaut : false (la plupart des vaisseaux ne
    // peuvent pas éjecter leur cargaison).
    cargoEject: overrides.cargoEject ?? false,

    // ─── Passagers & équipage ──────────────────────────────
    // Équipage : personnel de bord nécessaire au fonctionnement du vaisseau.
    crewCapacity:     overrides.crewCapacity    ?? 0,  // 0 = non défini
    // crewCount = tripulants actuellement à bord. Initialisé à crewCapacity
    // (l'équipage canonique est supposé présent au départ).
    crewCount:        overrides.crewCount       ?? (overrides.crewCapacity ?? 0),
    // Passagers : capacité de transport civil (cabines, soutes à passagers)
    passengerCapacity: overrides.passengerCapacity ?? 0,
    passengerCount:    overrides.passengerCount    ?? 0,
    // Troupes typées : [{ type:'clone'|'droid'|..., count:N, willFight:bool }]
    _troops: overrides._troops ? JSON.parse(JSON.stringify(overrides._troops)) : [],

    // ─── Cargaison ─────────────────────────────
    // Cale marchande : volume max + contenu réel ([{type, count}]). Volume
    // par défaut selon la taille (CARGO_HOLD_VOLUME), ajustable par le MJ.
    cargoVolume: overrides.cargoVolume ?? (CARGO_HOLD_VOLUME[overrides.size] ?? 0),
    cargoHold:   overrides.cargoHold ? JSON.parse(JSON.stringify(overrides.cargoHold)) : [],
    // Espace médical : capacité de blessés transportables + occupation
    // actuelle. Tout vaisseau en a un peu par défaut (MEDICAL_BAY_CAPACITY) ;
    // une frégate médicale dédiée aura une capacité bien supérieure (le MJ
    // l'ajuste manuellement via overrides.medicalCapacity).
    medicalCapacity: overrides.medicalCapacity ?? (MEDICAL_BAY_CAPACITY[overrides.size] ?? 0),
    woundedCount:    overrides.woundedCount ?? 0,
    // Cellules de détention : capacité de captifs + occupation actuelle.
    brigCapacity: overrides.brigCapacity ?? (BRIG_CAPACITY[overrides.size] ?? 0),
    captiveCount: overrides.captiveCount ?? 0,

    // ─── Identity ─────────────────────────────
    id:      overrides.id      || nanoid(),
    name:    overrides.name    || 'Unknown',
    classId: overrides.classId || null,
    type:    overrides.type    || 'fighter',
    size,
    mass:      overrides.mass      ?? 1,
    hullArmor: overrides.hullArmor ?? 1,   // 1–5
    lengthM:   overrides.lengthM   ?? null, // real ship length in metres
    widthM:    overrides.widthM    ?? null, // real ship width in metres
    image:     overrides.image     || '',   // custom image URL
    icon:      overrides.icon      || '',   // type icon slug

    // ─── Vision & Hyperspace ──────────────────
    visionRange:  overrides.visionRange  ?? null, // set from size if null
    hyperdrive:   overrides.hyperdrive   ?? true,  // hyperespace par défaut — fuir doit fonctionner pour tous ; mettre false explicitement pour les chasseurs courte portée (lore strict)

    // ─── Position & Movement ──────────────────
    position: overrides.position
      ? { ...overrides.position }
      : { x: 0, y: 0, z: 1 },
    velocity: overrides.velocity
      ? { ...overrides.velocity }
      : { x: 0, y: 0, z: 0 },
    speed: overrides.speed ?? SIZE_DEFAULT_SPEED[size] ?? 1,

    // ─── Health & Shields ─────────────────────
    hp:     overrides.hp     ?? maxHp,
    maxHp,
    shields: createShields(overrides.shields || {}),
    ionStacks: 0,               // active ion effect stacks

    // ─── Weapons & Inventory ──────────────────
    weapons:   (overrides.weapons   || []).map(w => ({ ...w, currentCooldown: w.currentCooldown || 0 })),
    inventory: createInventory(overrides.inventory),

    // ─── AI & Orders ──────────────────────────
    behavior: createBehavior(overrides.behavior || {}),
    orders:   overrides.orders || null,
    /*
     * Order format:
     * { type: 'moveTo'|'attack'|'escort'|'patrol'|'retreat',
     *   targetPosition?: {x,y,z},
     *   targetId?: string,
     *   patrolPoints?: [{x,y,z}] }
     */

    // ─── Special profiles ─────────────────────
    explosionOnDeath: overrides.explosionOnDeath || {
      enabled: false,
      damage:  20,
      radius:  1,
    },
    rammingProfile: overrides.rammingProfile || {
      enabled:         false,
      bonusDamage:     0,
      pushForce:       0,
      reinforcedHull:  false,
    },

    // ─── Squadrons ────────────────────────────
    // null = individual ship
    // object = squadron (multiple units represented as one)
    squadron: overrides.squadron || null,
    /*
     * squadron format:
     * { enabled: true, count: 12, massPerUnit: 1,
     *   hullArmorPerUnit: 1, weaponsPerUnit: [...] }
     */

    // ─── Internal state (not persisted in replay ticks) ───
    alive:      true,
    moveTarget: null,   // {x,y,z} movement destination
    attacking:  null,   // ID of current attack target (AI-driven, volatile)
    /**
     * heading: ship facing direction in radians (0 = right/east).
     * Updated automatically when the ship moves.
     * Used for firing arc checks and arrow display.
     * Default: face right. Fleets on the right half face left (Math.PI).
     */
    heading:    overrides.heading !== undefined
      ? overrides.heading
      : (() => {
          // Face toward center of map (240,240 in grid coords)
          const x = overrides.position?.x ?? 0;
          const y = overrides.position?.y ?? 0;
          const cx = 240, cy = 240;
          return Math.atan2(cy - y, cx - x);
        })(),
    /**
     * permanentOrder: persists until the target dies or a new explicit order overrides it.
     * Format: { type: 'attack'|'escort', targetId: string }
     * Takes priority over AI behavior mode.
     */
    permanentOrder: overrides.permanentOrder || null,
    ionDisabled:false,
    driveOff:   0,
    // ─── Energy policy ────────────────────────────
    energyPolicy:     overrides.energyPolicy     || 'balanced',
    pilotLevel:       overrides.pilotLevel        ?? 1,
    pilotType:        overrides.pilotType         || 'imperial', // see pilot.js PILOT_TYPES
    autoEnergyPolicy: overrides.autoEnergyPolicy  ?? true,
    /**
     * namedCharacter: null = regular ship.
     * { enabled, name, performance (1-20), plotArmor, _savesMade }
     * Named characters get stat boosts, a visual indicator, and optional plot armor.
     */
    namedCharacter: overrides.namedCharacter || null,
    // ─── Carrier / hangar ─────────────────────────
    carrier: overrides.carrier
      ? { carriedShips: [], ...overrides.carrier }
      : null,
    docked: overrides.docked || null,
    carriedBy: overrides.carriedBy || null,
    defensiveTarget: null,  // ID of enemy attacking this ship — for defensive weapons
    _rx: null,
    _ry: null,
  };
}

// ═══════════════════════════════════════════════════════
// SHIP CLASS (TEMPLATE / BLUEPRINT)
// ═══════════════════════════════════════════════════════

/**
 * Creates a ship class.
 * This is a template from which ship instances are created.
 * Stored in localStorage, editable by the GM.
 *
 * @param {object} overrides
 * @returns {ShipClass}
 */
export function createShipClass(overrides = {}) {
  const size = overrides.size || 'S';
  return {
    classId:          overrides.classId   || nanoid(),
    name:             overrides.name      || 'New Class',
    type:             overrides.type      || 'fighter',
    size,
    mass:             overrides.mass      ?? 1,
    hullArmor:        overrides.hullArmor ?? 1,
    /** Real ship dimensions in metres — used for HP calculation and ellipse shape */
    lengthM:          overrides.lengthM   ?? null,
    widthM:           overrides.widthM    ?? null,
    defaultWeapons:   (overrides.defaultWeapons   || []).map(w => ({ ...w })),
    defaultInventory: createInventory(overrides.defaultInventory),
    defaultShields:   overrides.defaultShields
      ? { ...overrides.defaultShields }
      : { max: 0, rechargeRate: 0.05, restartDelay: 3 },
    defaultCarrier:   overrides.defaultCarrier
      ? JSON.parse(JSON.stringify(overrides.defaultCarrier))
      : null,
    defaultPilotLevel: overrides.defaultPilotLevel ?? 1,
    /** Puits de gravité (interdicteur) — rayon en cases, 0 = aucun */
    gravityWell: overrides.gravityWell || 0,
    /** Rayon tracteur — portée de capture en cases, 0 = aucun */
    tractorBeam: overrides.tractorBeam || 0,
    /** Hyperdrive embarqué — false uniquement pour les chasseurs courte portée sans hyperespace */
    hyperdrive: overrides.hyperdrive ?? true,
    /** Scanner — portée en cases, 0 = aucun */
    scanner: overrides.scanner ?? 0,
    /** Éjection de cargaison */
    cargoEject: overrides.cargoEject ?? false,
    /** Équipage canon fixe (ne pas modifier en jeu — valeur Wookieepedia) */
    crewCapacity: overrides.crewCapacity ?? 0,
    /** Capacité de passagers/troupes (modifiable en jeu) */
    passengerCapacity: overrides.passengerCapacity ?? 0,
    image: overrides.image || '',
    icon:  overrides.icon  || '',
  };
}

// ═══════════════════════════════════════════════════════
// FLEET
// ═══════════════════════════════════════════════════════

/**
 * HP from real ship dimensions: (length × width)^0.4 × armorFactor × 12
 * e.g. ARC-170 (14.5m × 7.2m, armor 1) → 80 HP
 *      Venator  (1137m × 548m, armor 4) → ~10 000 HP
 */
/**
 * HP = longueur × SIZE_HP_MULT[size]
 * Armor = base_type + size_bonus + dimension_bonus
 */
export const SIZE_HP_MULT = {
  XS:  1.25,
  S:   1.5,
  M:   2.0,
  L:   3.0,
  XL:  4.0,
  XXL: 6.0,
};

// Armor base by ship type (damage reduction: dmg_received = dmg * max(0.1, 1 - armor/100))
const ARMOR_BASE_BY_TYPE = {
  interceptor:   5,   // Fragile, fast
  fighter:       8,
  heavy_fighter: 12,
  bomber:        10,
  gunship:       15,
  transport:     8,
  corvette:      18,
  frigate:       22,
  cruiser:       28,
  destroyer:     35,
  dreadnought:   42,
};

const ARMOR_SIZE_BONUS = {
  XS: 0, S: 2, M: 5, L: 10, XL: 15, XXL: 20,
};

export function calcHullArmor(type, size, lengthM, widthM) {
  const base  = ARMOR_BASE_BY_TYPE[type] ?? 8;
  const sBonus = ARMOR_SIZE_BONUS[size] ?? 0;
  const dBonus = lengthM && widthM ? Math.floor(Math.sqrt(lengthM * widthM) / 20) : 0;
  return base + sBonus + dBonus;
}

export function calcHpFromDims(lengthM, widthM, hullArmor, size, type) {
  // New formula: HP = longueur × SIZE_HP_MULT[size], rounded to nearest integer
  if (lengthM && size && SIZE_HP_MULT[size]) {
    return Math.max(5, Math.round(lengthM * SIZE_HP_MULT[size]));
  }
  // Legacy fallback
  return Math.max(10, Math.round(Math.pow(lengthM * widthM, 0.4) * (hullArmor||1) * 12 / 10) * 10);
}

export function calcShieldsFromDims(lengthM, widthM, armor) {
  if (armor <= 1) return 0;
  return Math.max(0, Math.round(Math.pow(lengthM * widthM, 0.38) * (armor - 1) * 8 / 10) * 10);
}

/**
 * Shield regen params by size:
 * - passiveRate: very slow regen while shields are up
 * - restartDelay: how long after full collapse before restart (in ticks)
 * - burstRate: fast regen during restart phase (fraction of max per tick)
 */
export const SHIELD_REGEN_BY_SIZE = {
  XS:  { passiveRate: 0.006, restartDelay: 2, burstRate: 0.15 },
  S:   { passiveRate: 0.004, restartDelay: 3, burstRate: 0.12 },
  M:   { passiveRate: 0.002, restartDelay: 4, burstRate: 0.10 },
  L:   { passiveRate: 0.001, restartDelay: 6, burstRate: 0.08 },
  XL:  { passiveRate: 0.0005,restartDelay: 8, burstRate: 0.06 },
  XXL: { passiveRate: 0.0002,restartDelay:12, burstRate: 0.04 },
};

/**
 * Visual hull size at zoom 1, CELL_SIZE 56px.
 * Long axis (vLen) goes along the ship heading; short axis (vWid) is perpendicular.
 */
export function shipVisualPx(lengthM, widthM) {
  const vLen = Math.max(6,  Math.min(52, Math.sqrt(lengthM) * 2.8));
  const vWid = Math.max(3, Math.min(26, Math.sqrt(widthM)  * 2.8));
  return { vLen: Math.round(vLen), vWid: Math.round(vWid) };
}

/**
 * Creates a fleet.
 * @param {object} overrides
 * @returns {Fleet}
 */
export function createFleet(overrides = {}) {
  return {
    fleetId:     overrides.fleetId    || nanoid(),
    name:        overrides.name       || 'Flotte Sans Nom',
    colorIndex:  overrides.colorIndex ?? null, // null until assigned to a faction
    shipIds:     overrides.shipIds    ? [...overrides.shipIds] : [],
    // Library metadata (not in active game)
    description: overrides.description || '',
  };
}

// ═══════════════════════════════════════════════════════
// SCENARIO
// ═══════════════════════════════════════════════════════

/**
 * Creates a scenario (initial battle configuration).
 * @param {object} overrides
 * @returns {Scenario}
 */
export function createScenario(overrides = {}) {
  return {
    scenarioId:  overrides.scenarioId  || nanoid(),
    name:        overrides.name        || 'New Scenario',
    description: overrides.description || '',
    /**
     * ships: [{ shipData: Ship, fleetId: string }]
     * Each entry contains a serialized ship and its fleetId.
     */
    ships:  overrides.ships  ? [...overrides.ships]  : [],
    fleets: overrides.fleets ? [...overrides.fleets] : [],
  };
}

// ═══════════════════════════════════════════════════════
// REPLAY
// ═══════════════════════════════════════════════════════

/**
 * Creates an empty replay record.
 * @param {object} overrides
 * @returns {Replay}
 */
export function createReplay(overrides = {}) {
  return {
    battleId: overrides.battleId || nanoid(),
    meta: {
      name:      overrides.name      || 'Unnamed Battle',
      createdAt: overrides.createdAt || new Date().toISOString(),
    },
    /**
     * ticks: [{ tick, ships: [...simplified state], events: [...] }]
     * Recorded each tick by ReplayRecorder.
     */
    ticks: [],
  };
}

// ═══════════════════════════════════════════════════════
// CONSTANTS / ENUMS
// ═══════════════════════════════════════════════════════

export const SHIP_TYPES = [
  'fighter', 'heavy_fighter', 'interceptor', 'bomber',
  'gunship', 'transport', 'corvette', 'frigate',
  'cruiser', 'destroyer', 'dreadnought', 'other',
];

export const SHIP_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const WEAPON_TYPES = [
  'laser', 'ion', 'projectile', 'torpedo',
  'missile', 'mine', 'bombardment', 'tractor',
];

export const WEAPON_SIZES = ['light', 'medium', 'heavy', 'superheavy', 'capital'];

export const BEHAVIOR_MODES = [
  'neutral', 'passive', 'aggressive', 'target', 'escort', 'patrol', 'kamikaze',
];
