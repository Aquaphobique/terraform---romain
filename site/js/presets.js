/**
 * PRESETS — Predefined ship classes
 *
 * Color scheme (Star Wars lore):
 *   Republic / Rebellion   → blue  (#4488ff) fighters, green (#33cc55) capital guns
 *   Separatists / Empire   → red   (#ff3333)
 *   Ion weapons            → blue  (#4488ff) always — ion-based charge
 *   Orange                 → light/training weapons
 *   Green + 10% damage     → quality tibanna gas (expensive)
 *   Red  = base damage     → cheap common tibanna
 *
 * Damage adjustment by color is handled in _applyDamage (simulation.js):
 *   green ×1.10, blue ×0.95 (+shield penetration), orange ×0.70
 */

import { createShipClass, createWeapon, createInventory, calcHpFromDims, calcShieldsFromDims, calcHullArmor, SHIELD_REGEN_BY_SIZE, shipVisualPx } from './models.js';
import { rollPilotLevel, PILOT_TYPES } from './pilot.js';
import { nanoid, SIZE_DEFAULT_HP, SIZE_DEFAULT_SPEED } from './utils.js';

// ── Color constants (Star Wars lore) ────────────────────────────────────────
// Republic (Clone Wars)  → BLUE fighters, mixed capital guns
// Empire                 → GREEN turbolasers (quality tibanna)
// Separatists            → RED (cheap/common tibanna)
// Rebels                 → RED (same cheap stock as Separatists, with exceptions)
// Ion weapons            → BLUE always (ion-based charge regardless of faction)
// Exceptions exist: some ships use different colors for specific weapon systems

const RED    = '#ff3333';   // Separatist / Rebel standard
const CYAN   = '#22ccff';   // Jedi / advanced interceptors
const GREEN  = '#33cc55';   // Imperial — quality green tibanna
const BLUE   = '#4488ff';   // Republic fighters / ion weapons
const ORANGE = '#ff8833';   // Low power / torpedoes / training
const PURPLE = '#cc44ff';   // Rare / superweapon
const YELLOW = '#ffee44';   // High energy variant (exception weapons)
const WHITE  = '#eef8ff';   // Superlaser / extreme power
const ION = '#4488ff';   // Ion weapons always blue

export const PRESET_CLASSES = {

  // ────────────────────────────────────────────────────────────────────────────
  // XS — FIGHTERS & BOMBERS
  // ────────────────────────────────────────────────────────────────────────────

  arc170: createShipClass({
    classId: 'arc170',
    lengthM: 14.5, widthM: 7.2, defaultPilotLevel: 2, name: 'ARC-170', type: 'heavy_fighter', size: 'XS', mass: 2, hullArmor: 2,
    crewCapacity:3, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    defaultWeapons: [
      createWeapon({ id:'w_arc1', name:'Blue Laser (×2)', type:'laser', size:'medium',
        damage:18, range:6, accuracy:0.75, cooldown:2, mode:'twin',
        color: BLUE, travelSpeed:22 }),
      createWeapon({ id:'w_arc2', name:'Proton Torpedo', type:'torpedo', size:'light',
        damage:40, range:5, accuracy:0.65, cooldown:8, ammoUsage:1,
        color: ORANGE, travelSpeed:10 }),
    ],
    defaultInventory: createInventory({ torpedoes: 6 }),
    defaultShields: { max: 40, rechargeRate: 0.004, restartDelay: 3 },
    icon: 'heavy_fighter',
  }),

  ywing: createShipClass({
    classId: 'ywing',
    lengthM: 16.0, widthM: 8.3, defaultPilotLevel: 2, name: 'Y-Wing', type: 'bomber', size: 'XS', mass: 2, hullArmor: 2,
    crewCapacity:2, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    defaultWeapons: [
      createWeapon({ id:'w_yw1', name:'Forward Laser (×2)', type:'laser', size:'light',
        damage:12, range:5, accuracy:0.70, cooldown:2, mode:'twin',
        color: BLUE, travelSpeed:20, firingArc:130, arcOffset:0 }),
      // Dorsal ion turret — 300° arc (fires at attackers even while bombing)
      createWeapon({ id:'w_yw2', name:'Dorsal Ion Turret', type:'ion', size:'medium',
        damage:5, range:5, accuracy:0.75, cooldown:3, ionStacks:2,
        color: BLUE, travelSpeed:16, firingArc:300, arcOffset:0, defensive:true }),
      createWeapon({ id:'w_yw3', name:'Proton Torpedo', type:'torpedo', size:'standard',
        damage:60, range:6, accuracy:0.70, cooldown:10, ammoUsage:1,
        color: ORANGE, travelSpeed:9 }),
      // Proton bombs — dropped from above during bombing passes (downward arc)
      createWeapon({ id:'w_yw4', name:'Proton Bomb (×2)', type:'bomb', size:'heavy',
        damage:90, range:3, accuracy:0.85, cooldown:5, ammoUsage:1,
        color: ORANGE, travelSpeed:4 }),
    ],
    defaultInventory: createInventory({ torpedoes: 4, bombs: 8, astromech: 1 }),
    defaultShields: { max: 35, rechargeRate: 0.003, restartDelay: 3 },
    icon: 'bomber',
  }),

  v19: createShipClass({
    classId: 'v19',
    lengthM: 6.0, widthM: 5.8, defaultPilotLevel: 2, name: 'V-19 Torrent', type: 'fighter', size: 'XS', mass: 1, hullArmor: 1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    defaultWeapons: [
      createWeapon({ id:'w_v191', name:'Blue Laser (×2)', type:'laser', size:'light',
        damage:10, range:5, accuracy:0.80, cooldown:2, mode:'twin',
        color: BLUE, travelSpeed:24 }),
      createWeapon({ id:'w_v192', name:'Concussion Missile', type:'missile', size:'light',
        damage:30, range:7, accuracy:0.85, cooldown:12, ammoUsage:1,
        color: ORANGE, travelSpeed:12 }),
    ],
    defaultInventory: createInventory({ missiles: 4 }),
    defaultShields: { max: 25, rechargeRate: 0.005, restartDelay: 2 },
    icon: 'fighter',
  }),

  // Hyena-class Droid Bomber — bombardier droïde Séparatiste, version lourdement armée du Vulture.
  // Wookieepedia : 12,48m, deux ailes repliables, torpilles/bombes, porteur de l'AOE de précision.
  hyena: createShipClass({
    classId: 'hyena',
    lengthM: 12.5, widthM: 12.0, name: 'Hyena-class Droid Bomber', type: 'bomber', size: 'XS', mass: 1, hullArmor: 2,
    defaultPilotLevel: 2, defaultPilotType: 'droid_integrated',
    defaultWeapons: [
      createWeapon({ id:'hyw1', name:'Blaster cannon (×2)', type:'laser', size:'light',
        damage:8, range:5, accuracy:0.72, cooldown:1, count:2,
        color: RED, travelSpeed:24 }),
      createWeapon({ id:'hyw2', name:'Proton torpedo (×6)', type:'torpedo', size:'heavy',
        damage:90, range:7, accuracy:0.70, cooldown:8, ammoUsage:1,
        color: ORANGE, travelSpeed:10 }),
    ],
    defaultInventory: createInventory({ torpedoes: 6 }),
    defaultShields: { max: 0, rechargeRate: 0, restartDelay: 99 },
    icon: 'bomber',
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // S — GUNSHIPS
  // ────────────────────────────────────────────────────────────────────────────

  gunship: createShipClass({
    classId: 'gunship',
    lengthM: 17.4, widthM: 17.0, defaultPilotLevel: 2, name: 'LAAT/i Gunship', type: 'gunship', size: 'S', mass: 3, hullArmor: 2,
    crewCapacity:4, passengerCapacity:30,
    brigCapacity:0,
    medicalCapacity:8,
    cargoVolume:2,
    defaultWeapons: [
      createWeapon({ id:'w_gs1', name:'Blue Laser (×2)', type:'laser', size:'medium',
        damage:20, range:6, accuracy:0.75, cooldown:2, mode:'twin',
        color: BLUE, travelSpeed:20 }),
      createWeapon({ id:'w_gs2', name:'Anti-Armor Rocket', type:'missile', size:'medium',
        damage:50, range:5, accuracy:0.80, cooldown:8, ammoUsage:1,
        color: ORANGE, travelSpeed:10 }),
    ],
    defaultInventory: createInventory({ missiles: 6 }),
    defaultShields: { max: 60, rechargeRate: 0.004, restartDelay: 3 },
    icon: 'gunship',
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // M — CORVETTES
  // ────────────────────────────────────────────────────────────────────────────

  corvette: createShipClass({
    classId: 'corvette',
    lengthM: 150, widthM: 48, defaultPilotLevel: 2, name: 'Light Corvette (CR90)', type: 'corvette', size: 'M', mass: 50, hullArmor: 2,
    crewCapacity:165, passengerCapacity:600,
    brigCapacity:10,
    medicalCapacity:20,
    cargoVolume:3000,
    defaultWeapons: [
      // Green turbolasers — Republic quality
      createWeapon({ id:'w_cr1', name:'Green Turbolaser (×4)', type:'laser', size:'light',
        damage:22, range:8, accuracy:0.70, cooldown:3, mode:'quad',
        color: GREEN, travelSpeed:16 }),
      createWeapon({ id:'w_cr2', name:'Ion Cannon', type:'ion', size:'medium',
        damage:8, range:6, accuracy:0.75, cooldown:4, ionStacks:2,
        color: BLUE, travelSpeed:14 }),
    ],
    defaultInventory: createInventory({}),
    defaultShields: { max: 150, rechargeRate: 0.003, restartDelay: 3 },
    icon: 'corvette',
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // L — FRIGATES
  // ────────────────────────────────────────────────────────────────────────────

  frigate_medical: createShipClass({
    classId: 'frigate_medical',
    lengthM: 300, widthM: 72, defaultPilotLevel: 2, name: 'Medical Frigate (Nebulon-B)', type: 'frigate', size: 'L', mass: 200, hullArmor: 3,
    crewCapacity:920, passengerCapacity:500,
    brigCapacity:50,
    medicalCapacity:800,
    cargoVolume:2000,
    defaultWeapons: [
      createWeapon({ id:'w_nb1', name:'Green Turbolaser (×6)', type:'laser', size:'medium',
        damage:38, range:10, accuracy:0.65, cooldown:4,
        color: GREEN, travelSpeed:14 }),
      createWeapon({ id:'w_nb2', name:'Heavy Ion Cannon (×2)', type:'ion', size:'heavy',
        damage:15, range:8, accuracy:0.70, cooldown:5, ionStacks:3,
        color: BLUE, travelSpeed:12 }),
    ],
    defaultInventory: createInventory({}),
    defaultShields: { max: 400, rechargeRate: 0.002, restartDelay: 4 },
    icon: 'frigate',
    defaultCarrier: {
      enabled: true, maxSlots: 12,
      reserves: [
        { classId: 'v19',  count: 8, name: 'Fighter Squadron' },
        { classId: 'ywing',count: 4, name: 'Bomber Flight' },
      ],
      carriedShips: [], autoFighters: true, autoBombers: true, autoInterceptors: true,
    },
  }),

  // Munificent-class Star Frigate — frégate bancaire Séparatiste, 825m.
  // Wookieepedia : turbolasers lourds × 2 batteries, canons laser × 6 batteries, 2 hangars.
  frigate_assault: createShipClass({
    classId: 'frigate_assault',
    lengthM: 825, widthM: 225, defaultPilotLevel: 2, name: 'Munificent-class Star Frigate', type: 'frigate', size: 'L', mass: 250, hullArmor: 4,
    brigCapacity:100,
    medicalCapacity:50,
    cargoVolume:8000,
    defaultWeapons: [
      createWeapon({ id:'w_fa1', name:'Heavy Turbolaser (×2 batteries)', type:'laser', size:'heavy',
        damage:60, range:12, accuracy:0.62, cooldown:4,
        color: RED, travelSpeed:12 }),
      createWeapon({ id:'w_fa2', name:'Laser Battery (×6)', type:'laser', size:'medium',
        damage:30, range:9, accuracy:0.68, cooldown:2, count:6,
        color: RED, travelSpeed:18 }),
      createWeapon({ id:'w_fa3', name:'Droid Torpedo', type:'torpedo', size:'capital',
        damage:150, range:12, accuracy:0.55, cooldown:20, ammoUsage:1,
        color: ORANGE, travelSpeed:7 }),
    ],
    defaultInventory: createInventory({ heavyTorpedoes: 12 }),
    defaultShields: { max: 500, rechargeRate: 0.002, restartDelay: 4 },
    defaultCarrier: { maxSlots:40, maxSimultaneous:12, reserves:[
      { classId:'vulture_droid', type:'fighter', count:30, deployed:0 },
      { classId:'hyena', type:'bomber', count:10, deployed:0 },
    ]},
    icon: 'frigate',
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // XL — CRUISERS & DESTROYERS
  // ────────────────────────────────────────────────────────────────────────────

  cruiser: createShipClass({
    classId: 'cruiser',
    lengthM: 1155, widthM: 548, defaultPilotLevel: 3, name: 'Medium Cruiser (Venator)', type: 'cruiser', size: 'XL', mass: 1500, hullArmor: 4,
    crewCapacity:7400, passengerCapacity:2000,
    medicalCapacity:500, brigCapacity:200,
    defaultWeapons: [
      // Republic BLUE broadside batteries (sailing-ship style)
      createWeapon({ id:'w_ven1',  name:'Republic Turbolaser — Starboard (×8)', type:'laser', size:'heavy',
        damage:66, range:14, accuracy:0.60, cooldown:5, firingArc:150, arcOffset: Math.PI/2,
        mode:'volley', color: BLUE, travelSpeed:12 }),
      createWeapon({ id:'w_ven1b', name:'Republic Turbolaser — Port (×8)', type:'laser', size:'heavy',
        damage:66, range:14, accuracy:0.60, cooldown:5, firingArc:150, arcOffset:-Math.PI/2,
        mode:'volley', color: BLUE, travelSpeed:12 }),
      // Forward chase guns — also Republic blue
      createWeapon({ id:'w_ven2',  name:'Republic Turbolaser — Forward (×12)', type:'laser', size:'medium',
        damage:33, range:10, accuracy:0.65, cooldown:3, firingArc:120, arcOffset:0,
        mode:'burst', color: BLUE, travelSpeed:16 }),
      // Exception: Yellow heavy ion — specialist weapon
      createWeapon({ id:'w_ven3',  name:'Heavy Ion Cannon (×4)', type:'ion', size:'heavy',
        damage:20, range:10, accuracy:0.65, cooldown:5, ionStacks:4,
        color: BLUE, travelSpeed:11 }),
      createWeapon({ id:'w_ven4',  name:'Capital Torpedo (×2)', type:'torpedo', size:'capital',
        damage:200, range:12, accuracy:0.55, cooldown:20, ammoUsage:1,
        color: ORANGE, travelSpeed:7 }),
    ],
    defaultInventory: createInventory({ torpedoes: 20, heavyTorpedoes: 8 }),
    defaultShields: { max: 1200, rechargeRate: 0.0015, restartDelay: 5 },
    icon: 'cruiser',
    // Venator: 178 fighters (Clone Wars standard complement)
    // Launch capacity: ~30 simultaneously (one full wing sortie)
    defaultCarrier: { maxSlots:420 /* ICS: 192 V-19 + 192 inter. + 36 ARC/Y */,
      maxSimultaneous: 30,
      autoFighters: true,  // fighters auto-deploy when in combat
      autoBombers: true, autoInterceptors: true, autoGunships: true,
      reserves: [
        { classId: 'arc170',  type: 'heavy_fighter', count: 48,  deployed: 0 },
        { classId: 'v19',     type: 'fighter',        count: 72,  deployed: 0 },
        { classId: 'ywing',   type: 'bomber',         count: 36,  deployed: 0 },
        { classId: 'gunship', type: 'gunship',         count: 12,  deployed: 0 },
      ],
    },
  }),

  destroyer: createShipClass({
    classId: 'destroyer',
    lengthM: 1600, widthM: 900, defaultPilotLevel: 3, name: 'Heavy Destroyer (ISD)', type: 'destroyer', size: 'XL', mass: 3000, hullArmor: 5,
    crewCapacity:9235, passengerCapacity:9700,
    brigCapacity:1000,
    medicalCapacity:3000,
    defaultWeapons: [
      // Imperial green superheavy turbolasers (dorsal towers — exception: some were red)
      createWeapon({ id:'w_isd1', name:'Green Turbolaser — Dorsal (×6)', type:'laser', size:'superheavy',
        damage:100, range:16, accuracy:0.55, cooldown:6, mode:'burst',
        color: GREEN, travelSpeed:10 }),
      // Main green batteries
      createWeapon({ id:'w_isd2', name:'Green Turbolaser — Heavy (×20)', type:'laser', size:'heavy',
        damage:60, range:12, accuracy:0.60, cooldown:4, mode:'volley',
        color: GREEN, travelSpeed:13 }),
      // Exception: ventral red guns (historical variant)
      createWeapon({ id:'w_isd2b', name:'Red Turbolaser — Ventral (×8)', type:'laser', size:'heavy',
        damage:55, range:10, accuracy:0.62, cooldown:4, mode:'twin',
        color: RED, travelSpeed:13 }),
      createWeapon({ id:'w_isd3', name:'Capital Ion Cannon (×4)', type:'ion', size:'capital',
        damage:30, range:12, accuracy:0.60, cooldown:6, ionStacks:5, mode:'twin',
        color: BLUE, travelSpeed:10 }),
    ],
    defaultInventory: createInventory({ torpedoes: 40, heavyTorpedoes: 20 }),
    defaultShields: { max: 3000, rechargeRate: 0.001, restartDelay: 6 },
    icon: 'destroyer',
    // ISD-I : 72 TIE/LN standard + 12 TIE Bombers + 8 TIE Interceptors
    // + option vaisseaux spéciaux selon mission (Wookieepedia)
    defaultCarrier: {
      maxSlots: 96,
      maxSimultaneous: 24,
      autoFighters: true, autoBombers: true, autoInterceptors: true,
      reserves: [
        { classId: 'tie_ln',      type: 'fighter',       count: 72, deployed: 0 },
        { classId: 'tie_bomber',  type: 'bomber',        count: 12, deployed: 0 },
        { classId: 'tie_int',     type: 'interceptor',   count: 8,  deployed: 0 },
        { classId: 'vulture_droid', type: 'fighter',     count: 0,  deployed: 0 },
      ],
    },
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // XL — PROVIDENCE DREADNOUGHT (CIS — Invisible Hand class)
  // ────────────────────────────────────────────────────────────────────────────

  providence: createShipClass({
    classId: 'providence',
    lengthM: 1088, widthM: 198, defaultPilotLevel: 3,
    name: 'Providence Dreadnought', type: 'dreadnought', size: 'XL', mass: 7500, hullArmor: 4,
    crewCapacity:600, passengerCapacity:50000,
    medicalCapacity:500, brigCapacity:2000,
    defaultWeapons: [
      // 14 quad heavy turbolasers — main batteries (Separatist red)
      createWeapon({ id:'w_prov1', name:'Quad Turbolaser — Heavy (×14)', type:'laser', size:'heavy',
        damage:80, range:15, accuracy:0.57, cooldown:5, mode:'quad',
        color: RED, travelSpeed:11 }),
      // 34 dual light turbolasers — secondary batteries
      createWeapon({ id:'w_prov2', name:'Dual Turbolaser — Light (×34)', type:'laser', size:'medium',
        damage:40, range:11, accuracy:0.62, cooldown:3, mode:'twin',
        color: RED, travelSpeed:15 }),
      // 2 proton torpedo launch bays
      createWeapon({ id:'w_prov3', name:'Proton Torpedo Tube (×2)', type:'torpedo', size:'capital',
        damage:220, range:14, accuracy:0.52, cooldown:15, ammoUsage:1,
        color: ORANGE, travelSpeed:7 }),
      // Ion cannon array
      createWeapon({ id:'w_prov4', name:'Heavy Ion Cannon (×6)', type:'ion', size:'heavy',
        damage:25, range:10, accuracy:0.62, cooldown:6, ionStacks:4,
        color: BLUE, travelSpeed:10 }),
    ],
    defaultInventory: createInventory({ torpedoes: 60, heavyTorpedoes: 20 }),
    defaultShields: { max: 2500, rechargeRate: 0.0012, restartDelay: 5 },
    icon: 'dreadnought',
    defaultCarrier: {
      maxSlots: 240, maxSimultaneous: 40,
      autoFighters: true, autoBombers: true, autoInterceptors: true, autoGunships: true,
      reserves: [
        { classId: 'vulture_droid', type: 'fighter',      count: 192, deployed: 0 },
        { classId: 'tri_droid',     type: 'heavy_fighter', count:  48, deployed: 0 },
      ],
    },
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // XXL — DREADNOUGHTS
  // ────────────────────────────────────────────────────────────────────────────

  dreadnought: createShipClass({
    classId: 'dreadnought',
    lengthM: 19000, widthM: 7600, defaultPilotLevel: 3, name: 'Heavy Dreadnought (Executor)', type: 'dreadnought', size: 'XXL', mass: 10000, hullArmor: 5,
    crewCapacity:7200, passengerCapacity:20000,
    brigCapacity:500,
    medicalCapacity:1000,
    defaultWeapons: [
      // Purple/white superlaser — unique exception
      createWeapon({ id:'w_ex1', name:'Superlaser (×2)', type:'laser', size:'capital',
        damage:300, range:20, accuracy:0.50, cooldown:10,
        color: WHITE, continuous: true, travelSpeed:6 }),
      // Imperial green main batteries
      createWeapon({ id:'w_ex2', name:'Green Turbolaser — Superheavy (×40)', type:'laser', size:'superheavy',
        damage:100, range:16, accuracy:0.55, cooldown:5, mode:'volley',
        color: GREEN, travelSpeed:10 }),
      createWeapon({ id:'w_ex3', name:'Green Turbolaser — Heavy (×80)', type:'laser', size:'heavy',
        damage:60, range:12, accuracy:0.60, cooldown:3, mode:'quad',
        color: GREEN, travelSpeed:13 }),
      // Exception: some red point-defense guns
      createWeapon({ id:'w_ex3b', name:'Red Point-Defense (×40)', type:'laser', size:'light',
        damage:20, range:5, accuracy:0.80, cooldown:1, mode:'quad',
        color: RED, travelSpeed:22 }),
      createWeapon({ id:'w_ex4', name:'Capital Ion (×8)', type:'ion', size:'capital',
        damage:40, range:14, accuracy:0.55, cooldown:6, ionStacks:6,
        color: BLUE, travelSpeed:9 }),
    ],
    defaultInventory: createInventory({ torpedoes: 100, heavyTorpedoes: 50 }),
    defaultShields: { max: 8000, rechargeRate: 0.0008, restartDelay: 8 },
    icon: 'dreadnought',
    defaultCarrier: {
      maxSlots: 144,
      autoFighters: true, autoBombers: true, autoInterceptors: true, autoGunships: true,
      reserves: [
        { classId: 'vulture_droid', type: 'fighter',     count: 80, deployed: 0 },
        { classId: 'tri_droid',     type: 'heavy_fighter',count: 24, deployed: 0 },
      ],
    },
  }),

  // ────────────────────────────────────────────────────────────────────────────
  // DROID FIGHTERS (Separatist / CIS) — no shields, accurate formation flying
  // ────────────────────────────────────────────────────────────────────────────

  vulture_droid: createShipClass({
    classId: 'vulture_droid', defaultPilotLevel: 1,
    name: 'Vulture-class Droid Fighter', type: 'fighter', size: 'XS', mass: 1, hullArmor: 1,
    lengthM: 5.8, widthM: 6.4,
    defaultWeapons: [
      // Droids use energy torpedoes / blasters
      createWeapon({ id:'w_vd1', name:'Energy Torpedo (×4)', type:'laser', size:'light',
        damage:9, range:4, accuracy:0.68, cooldown:1, mode:'quad',
        color: RED, travelSpeed:26 }),
      createWeapon({ id:'w_vd2', name:'Energy Torpedo Burst', type:'torpedo', size:'light',
        damage:25, range:5, accuracy:0.55, cooldown:8, ammoUsage:1,
        color: ORANGE, travelSpeed:14 }),
    ],
    defaultInventory: createInventory({ torpedoes: 6 }),
    // No shields — pure droid, compensates with numbers
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 99 },
    icon: 'fighter',
  }),

  // Droid Tri-Fighter — chasseur droïde Séparatiste avancé (fin des Guerres des Clones).
  // Wookieepedia : 5,47m, 3 canons laser, missiles + décharges de missiles en essaim.
  tri_droid: createShipClass({
    classId: 'tri_droid', defaultPilotLevel: 3, // better than standard vulture
    name: 'Droid Tri-Fighter', type: 'heavy_fighter', size: 'S', mass: 2, hullArmor: 2,
    lengthM: 5.5, widthM: 5.5,
    defaultPilotType: 'droid_integrated_advanced',
    defaultWeapons: [
      createWeapon({ id:'w_td1', name:'Laser Cannon (×3)', type:'laser', size:'medium',
        damage:16, range:6, accuracy:0.76, cooldown:2, mode:'twin',
        color: RED, travelSpeed:22 }),
      createWeapon({ id:'w_td2', name:'Missile burst (×3)', type:'missile', size:'light',
        damage:50, range:7, accuracy:0.68, cooldown:6, ammoUsage:1,
        color: ORANGE, travelSpeed:14 }),
    ],
    defaultInventory: createInventory({ missiles: 6 }),
    defaultShields: { max: 0, rechargeRate: 0, restartDelay: 99 },
    icon: 'heavy_fighter',
  }),

  // ═══════════════════════════════════════════════════════
  // REPUBLIC / PREQUEL ERA FIGHTERS
  // ═══════════════════════════════════════════════════════

  n1: createShipClass({
    classId:'n1', name:'N-1 Naboo Starfighter', type:'fighter', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:11.0, widthM:3.5,
    defaultPilotLevel:2, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'n1w1', name:'Twin Laser Cannon', type:'laser', size:'light', damage:10, range:8, accuracy:0.74, cooldown:1, count:2, color:YELLOW }),
      createWeapon({ id:'n1w2', name:'Proton Torpedo', type:'torpedo', size:'light', damage:100, range:11, accuracy:0.64, cooldown:8, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ torpedoes: 10 }),
    defaultShields: { max: 40, rechargeRate: 0.006, restartDelay: 2 },
  }),

  delta7: createShipClass({
    classId:'delta7', name:'Delta-7 Aethersprite', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:8.0, widthM:3.7,
    defaultPilotLevel:3, defaultPilotType:'force_user',
    defaultWeapons:[
      createWeapon({ id:'d7w1', name:'Twin Laser Cannon', type:'laser', size:'light', damage:10, range:9, accuracy:0.80, cooldown:1, count:2, color:CYAN }),
    ],
    defaultInventory: createInventory({ astromech: 1 }),
    defaultShields: { max: 30, rechargeRate: 0.008, restartDelay: 2 },
  }),

  eta2: createShipClass({
    classId:'eta2', name:'Eta-2 Actis Interceptor', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:5.47, widthM:4.3,
    defaultPilotLevel:3, defaultPilotType:'force_user',
    defaultWeapons:[
      createWeapon({ id:'e2w1', name:'Laser Cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.78, cooldown:1, count:2, color:CYAN }),
      createWeapon({ id:'e2w2', name:'Ion Cannon', type:'ion', size:'light', damage:15, range:6, accuracy:0.72, cooldown:3, count:2, color:'#4499ff' }),
    ],
    defaultInventory: createInventory({ astromech: 1 }),
    defaultShields: { max: 20, rechargeRate: 0.007, restartDelay: 2 },
  }),

  v_wing: createShipClass({
    classId:'v_wing', name:'Alpha-3 Nimbus V-Wing', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    lengthM:7.9, widthM:10.4,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'vww1', name:'Laser Cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.74, cooldown:1, count:2, color:BLUE }),
    ],
    defaultShields: { max: 25, rechargeRate: 0.007, restartDelay: 2 },
  }),

  z95: createShipClass({
    classId:'z95', name:'Z-95 Headhunter', type:'fighter', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:11.85, widthM:6.4,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'z95w1', name:'Twin Laser Cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.72, cooldown:1, count:2, color:BLUE }),
      createWeapon({ id:'z95w2', name:'Concussion Missile', type:'missile', size:'light', damage:60, range:10, accuracy:0.60, cooldown:6, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 6 }),
    defaultShields: { max: 20, rechargeRate: 0.005, restartDelay: 3 },
  }),

  // ═══════════════════════════════════════════════════════
  // IMPERIAL FIGHTERS
  // ═══════════════════════════════════════════════════════

  tie_ln: createShipClass({
    classId:'tie_ln', name:'TIE/ln Starfighter', type:'fighter', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:7.24, widthM:6.7,
    defaultPilotLevel:1, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'tlw1', name:'SFS L-s1 Laser Cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.70, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 0 }, // No shields
  }),

  tie_int: createShipClass({
    classId:'tie_int', name:'TIE/IN Interceptor', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:9.6, widthM:9.9,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'tiw1', name:'Laser Cannon', type:'laser', size:'light', damage:9, range:9, accuracy:0.76, cooldown:1, count:4, color:RED }),
    ],
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 0 },
  }),

  tie_bomber: createShipClass({
    classId:'tie_bomber', name:'TIE/sa Bomber', type:'bomber', size:'XS', mass:2, hullArmor:2,
    crewCapacity:2, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:7.8, widthM:10.6,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'tbw1', name:'Laser Cannon', type:'laser', size:'light', damage:8, range:7, accuracy:0.66, cooldown:2, count:2, color:RED }),
      createWeapon({ id:'tbw2', name:'Proton Bomb', type:'bomb', size:'heavy', damage:180, range:4, accuracy:0.85, cooldown:6, ammoUsage:1, color:ORANGE }),
      createWeapon({ id:'tbw3', name:'Proton Torpedo', type:'torpedo', size:'light', damage:120, range:10, accuracy:0.65, cooldown:8, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ bombs: 16, torpedoes: 8 }),
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 0 },
  }),

  tie_adv: createShipClass({
    classId:'tie_adv', name:'TIE Advanced x1', type:'heavy_fighter', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:9.2, widthM:8.3,
    defaultPilotLevel:4, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'taw1', name:'SFS L-s9.3 Laser Cannon', type:'laser', size:'light', damage:11, range:9, accuracy:0.80, cooldown:1, count:2, color:RED }),
      createWeapon({ id:'taw2', name:'Concussion Missile', type:'missile', size:'light', damage:80, range:10, accuracy:0.68, cooldown:5, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 4 }),
    defaultShields: { max: 50, rechargeRate: 0.006, restartDelay: 3 },
  }),

  // ═══════════════════════════════════════════════════════
  // REBEL / ALLIANCE FIGHTERS
  // ═══════════════════════════════════════════════════════

  xwing: createShipClass({
    classId:'xwing', name:'T-65B X-Wing', type:'heavy_fighter', size:'XS', mass:2, hullArmor:2,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:13.4, widthM:11.76, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'xww1', name:'KX9 Laser Cannon', type:'laser', size:'light', damage:11, range:9, accuracy:0.76, cooldown:1, count:4, color:RED }),
      createWeapon({ id:'xww2', name:'Proton Torpedo', type:'torpedo', size:'light', damage:130, range:12, accuracy:0.68, cooldown:8, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ torpedoes: 6, astromech: 1 }),
    defaultShields: { max: 60, rechargeRate: 0.008, restartDelay: 3 },
  }),

  awing: createShipClass({
    classId:'awing', name:'RZ-1 A-Wing', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:9.6, widthM:6.48,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'aww1', name:'Laser Cannon', type:'laser', size:'light', damage:9, range:9, accuracy:0.78, cooldown:1, count:2, color:GREEN }),
      createWeapon({ id:'aww2', name:'Concussion Missile', type:'missile', size:'light', damage:70, range:10, accuracy:0.66, cooldown:5, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 12, astromech: 1 }),
    defaultShields: { max: 40, rechargeRate: 0.009, restartDelay: 2 },
  }),

  bwing: createShipClass({
    classId:'bwing', name:'A/SF-01 B-Wing', type:'bomber', size:'S', mass:2, hullArmor:2,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:16.9, widthM:17.83,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'bww1', name:'Laser Cannon', type:'laser', size:'light', damage:10, range:8, accuracy:0.73, cooldown:1, count:3, color:GREEN }),
      createWeapon({ id:'bww2', name:'Ion Cannon', type:'ion', size:'medium', damage:30, range:7, accuracy:0.70, cooldown:3, count:2, color:'#4499ff' }),
      createWeapon({ id:'bww3', name:'Proton Torpedo', type:'torpedo', size:'heavy', damage:160, range:12, accuracy:0.68, cooldown:8, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ torpedoes: 8 }),
    defaultShields: { max: 80, rechargeRate: 0.007, restartDelay: 3 },
  }),

  uwing: createShipClass({
    classId:'uwing', name:'UT-60D U-Wing', type:'gunship', size:'S', mass:3, hullArmor:2,
    crewCapacity:2, passengerCapacity:8,
    lengthM:28.8, widthM:24.2,
    defaultPilotLevel:2, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'uww1', name:'Laser Cannon', type:'laser', size:'light', damage:10, range:8, accuracy:0.72, cooldown:1, count:2, color:GREEN }),
      createWeapon({ id:'uww2', name:'Side Cannon', type:'laser', size:'light', damage:9, range:7, accuracy:0.68, cooldown:2, count:2, color:GREEN, firingArc:180 }),
    ],
    defaultShields: { max: 100, rechargeRate: 0.007, restartDelay: 3 },
  }),

  // ═══════════════════════════════════════════════════════
  // GUNSHIPS
  // ═══════════════════════════════════════════════════════

  hmp_gunship: createShipClass({
    classId:'hmp_gunship', name:'HMP Droid Gunship', type:'gunship', size:'S', mass:3, hullArmor:2,
    crewCapacity:0, passengerCapacity:0,
    medicalCapacity:0, brigCapacity:0,
    lengthM:35.0, widthM:25.0,
    defaultPilotLevel:2, defaultPilotType:'droid_integrated_advanced',
    defaultWeapons:[
      createWeapon({ id:'hmpw1', name:'Laser Cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.70, cooldown:1, count:4, color:RED }),
      createWeapon({ id:'hmpw2', name:'Concussion Missile', type:'missile', size:'medium', damage:80, range:9, accuracy:0.65, cooldown:5, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 16 }),
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 0 },
  }),

  // ═══════════════════════════════════════════════════════
  // CORVETTES
  // ═══════════════════════════════════════════════════════

  hammerhead: createShipClass({
    classId:'hammerhead', name:'Hammerhead Corvette', type:'corvette', size:'M', mass:4, hullArmor:2,
    crewCapacity:64, passengerCapacity:400,
    brigCapacity:20,
    medicalCapacity:40,
    lengthM:315, widthM:55,
    defaultPilotLevel:2, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'hhw1', name:'Turbolaser', type:'laser', size:'medium', damage:80, range:15, accuracy:0.66, cooldown:2, count:4, color:GREEN }),
      createWeapon({ id:'hhw2', name:'Ion Cannon', type:'ion', size:'medium', damage:40, range:12, accuracy:0.70, cooldown:3, count:2, color:'#4499ff' }),
    ],
    defaultShields: { max: 600, rechargeRate: 0.015, restartDelay: 4 },
  }),

  arquitens: createShipClass({
    classId:'arquitens', name:'Arquitens Light Cruiser', type:'corvette', size:'M', mass:5, hullArmor:3,
    crewCapacity:210, passengerCapacity:0,
    brigCapacity:10,
    medicalCapacity:30,
    lengthM:325, widthM:115,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'arqw1', name:'Turbolaser Battery', type:'laser', size:'heavy', damage:130, range:18, accuracy:0.63, cooldown:2, count:4, color:RED }),
      createWeapon({ id:'arqw2', name:'Ion Cannon', type:'ion', size:'medium', damage:50, range:14, accuracy:0.68, cooldown:3, count:2, color:'#4499ff' }),
      createWeapon({ id:'arqw3', name:'Concussion Missile', type:'missile', size:'medium', damage:90, range:14, accuracy:0.62, cooldown:5, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 20 }),
    defaultShields: { max: 900, rechargeRate: 0.02, restartDelay: 4 },
  }),

  // ═══════════════════════════════════════════════════════
  // FRIGATES
  // ═══════════════════════════════════════════════════════

  pelta: createShipClass({
    classId:'pelta', name:'Pelta-class Frigate', type:'frigate', size:'L', mass:6, hullArmor:3,
    crewCapacity:900, passengerCapacity:300,
    brigCapacity:30,
    medicalCapacity:200,
    lengthM:282, widthM:75,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'pew1', name:'Turbolaser', type:'laser', size:'heavy', damage:120, range:18, accuracy:0.62, cooldown:2, count:6, color:BLUE }),
      createWeapon({ id:'pew2', name:'Point Defense Laser', type:'laser', size:'light', damage:25, range:8, accuracy:0.80, cooldown:1, count:4, color:BLUE, defensive:true }),
    ],
    defaultShields: { max: 1500, rechargeRate: 0.02, restartDelay: 5 },
    defaultCarrier: { maxSlots:6, maxSimultaneous:3, reserves:[{ classId:'arc170', type:'heavy_fighter', count:6, deployed:0 }] },
  }),

  // ═══════════════════════════════════════════════════════
  // CAPITAL SHIPS
  // ═══════════════════════════════════════════════════════

  acclamator: createShipClass({
    classId:'acclamator', name:'Acclamator-class Assault Ship', type:'cruiser', size:'XL', mass:8, hullArmor:4,
    crewCapacity:700, passengerCapacity:16000,
    brigCapacity:500,
    medicalCapacity:1000,
    lengthM:752, widthM:460,
    defaultPilotLevel:3, defaultPilotType:'clone_commander',
    defaultWeapons:[
      createWeapon({ id:'acw1', name:'Heavy Turbolaser', type:'laser', size:'capital', damage:350, range:28, accuracy:0.60, cooldown:3, count:12, color:BLUE }),
      createWeapon({ id:'acw2', name:'Proton Torpedo Battery', type:'torpedo', size:'heavy', damage:280, range:20, accuracy:0.58, cooldown:6, count:4, ammoUsage:1, color:ORANGE }),
      createWeapon({ id:'acw3', name:'Point Defense', type:'laser', size:'light', damage:30, range:8, accuracy:0.82, cooldown:1, count:6, color:BLUE, defensive:true }),
    ],
    defaultInventory: createInventory({ torpedoes: 60 }),
    defaultShields: { max: 4000, rechargeRate: 0.04, restartDelay: 6 },
    defaultCarrier: { maxSlots:16, maxSimultaneous:8, reserves:[
      { classId:'arc170', type:'heavy_fighter', count:12, deployed:0 },
      { classId:'gunship', type:'gunship', count:8, deployed:0 },
    ]},
  }),

  victory: createShipClass({
    classId:'victory', name:'Victory I-class Star Destroyer', type:'destroyer', size:'XL', mass:8, hullArmor:4,
    crewCapacity:6107, passengerCapacity:2000,
    brigCapacity:200,
    medicalCapacity:400,
    lengthM:900, widthM:516,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'vicw1', name:'Turbolaser Battery', type:'laser', size:'capital', damage:400, range:30, accuracy:0.60, cooldown:3, count:10, color:RED }),
      createWeapon({ id:'vicw2', name:'Ion Cannon Battery', type:'ion', size:'capital', damage:200, range:22, accuracy:0.62, cooldown:4, count:6, color:'#4499ff' }),
      createWeapon({ id:'vicw3', name:'Concussion Missile', type:'missile', size:'heavy', damage:200, range:20, accuracy:0.58, cooldown:5, count:4, ammoUsage:1, color:ORANGE }),
      createWeapon({ id:'vicw4', name:'Point Defense', type:'laser', size:'light', damage:30, range:8, accuracy:0.82, cooldown:1, count:8, color:RED, defensive:true }),
    ],
    defaultInventory: createInventory({ missiles: 40 }),
    defaultShields: { max: 5500, rechargeRate: 0.05, restartDelay: 6 },
    defaultCarrier: { maxSlots:24, maxSimultaneous:12, reserves:[
      { classId:'tie_ln', type:'fighter', count:24, deployed:0 },
    ]},
  }),

  recusant: createShipClass({
    classId:'recusant', name:'Recusant-class Destroyer', type:'destroyer', size:'XL', mass:7, hullArmor:4,
    crewCapacity:300, passengerCapacity:40000,
    brigCapacity:200,
    medicalCapacity:50,
    lengthM:1187, widthM:228,
    defaultPilotLevel:2, defaultPilotType:'droid_captain',
    defaultWeapons:[
      createWeapon({ id:'recw1', name:'Long-range Turbolaser', type:'laser', size:'capital', damage:380, range:32, accuracy:0.58, cooldown:3, count:8, color:RED }),
      createWeapon({ id:'recw2', name:'Ion Cannon', type:'ion', size:'capital', damage:180, range:24, accuracy:0.60, cooldown:4, count:4, color:'#4499ff' }),
      createWeapon({ id:'recw3', name:'Point Defense', type:'laser', size:'light', damage:25, range:7, accuracy:0.80, cooldown:1, count:6, color:RED, defensive:true }),
    ],
    defaultShields: { max: 4500, rechargeRate: 0.04, restartDelay: 6 },
    defaultCarrier: { maxSlots:20, maxSimultaneous:10, reserves:[
      { classId:'vulture_droid', type:'fighter', count:20, deployed:0 },
    ]},
  }),

  mc75: createShipClass({
    classId:'mc75', name:'MC75 Star Cruiser', type:'cruiser', size:'XL', mass:8, hullArmor:4,
    crewCapacity:3225, passengerCapacity:1200,
    brigCapacity:200,
    medicalCapacity:600,
    lengthM:1204, widthM:375,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'m75w1', name:'Turbolaser Battery', type:'laser', size:'capital', damage:360, range:30, accuracy:0.62, cooldown:3, count:11, color:GREEN }),
      createWeapon({ id:'m75w2', name:'Ion Cannon Battery', type:'ion', size:'capital', damage:180, range:22, accuracy:0.65, cooldown:4, count:6, color:'#4499ff' }),
      createWeapon({ id:'m75w3', name:'Proton Torpedo', type:'torpedo', size:'heavy', damage:260, range:20, accuracy:0.60, cooldown:5, count:4, ammoUsage:1, color:ORANGE }),
      createWeapon({ id:'m75w4', name:'Point Defense', type:'laser', size:'light', damage:28, range:8, accuracy:0.82, cooldown:1, count:8, color:GREEN, defensive:true }),
    ],
    defaultInventory: createInventory({ torpedoes: 36 }),
    defaultShields: { max: 6000, rechargeRate: 0.055, restartDelay: 6 },
    defaultCarrier: { maxSlots:20, maxSimultaneous:10, reserves:[
      { classId:'xwing', type:'heavy_fighter', count:12, deployed:0 },
      { classId:'awing', type:'interceptor', count:8, deployed:0 },
    ]},
  }),

  mc80: createShipClass({
    classId:'mc80', name:'MC80 Star Cruiser (Home One type)', type:'cruiser', size:'XL', mass:8, hullArmor:4,
    crewCapacity:5765, passengerCapacity:1200,
    brigCapacity:200,
    medicalCapacity:800,
    lengthM:1200, widthM:550,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'m80w1', name:'Turbolaser Battery', type:'laser', size:'capital', damage:380, range:30, accuracy:0.62, cooldown:3, count:12, color:GREEN }),
      createWeapon({ id:'m80w2', name:'Ion Cannon Battery', type:'ion', size:'capital', damage:200, range:24, accuracy:0.65, cooldown:4, count:8, color:'#4499ff' }),
      createWeapon({ id:'m80w3', name:'Proton Torpedo', type:'torpedo', size:'heavy', damage:280, range:20, accuracy:0.60, cooldown:5, count:6, ammoUsage:1, color:ORANGE }),
      createWeapon({ id:'m80w4', name:'Point Defense', type:'laser', size:'light', damage:30, range:8, accuracy:0.84, cooldown:1, count:10, color:GREEN, defensive:true }),
    ],
    defaultInventory: createInventory({ torpedoes: 48 }),
    defaultShields: { max: 7000, rechargeRate: 0.06, restartDelay: 6 },
    defaultCarrier: { maxSlots:30, maxSimultaneous:15, reserves:[
      { classId:'xwing', type:'heavy_fighter', count:18, deployed:0 },
      { classId:'ywing', type:'bomber', count:6, deployed:0 },
      { classId:'awing', type:'interceptor', count:6, deployed:0 },
    ]},
  }),

  // ═══════════════════════════════════════════════════════
  // VAISSEAUX DE PERSONNAGES NOMMÉS — à utiliser avec Named Character
  // Ces classes représentent des appareils FORTEMENT MODIFIÉS appartenant
  // à des personnages précis. Le système Named Character (éditeur MJ) permet
  // de les associer à leur pilote canonique.
  // ═══════════════════════════════════════════════════════

  n1_mod: createShipClass({
    // N-1 profondément modifié par Din Djarin (The Mandalorian S3).
    // Classe de base : N-1 Naboo Starfighter, mais hyper-turbo modifié.
    classId:'n1_mod', name:'N-1 Modifié (Din Djarin)', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    lengthM:9.4, widthM:2.8, hyperdrive:true,
    defaultPilotLevel:4, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'nmw1', name:'Répulseurs cannons', type:'laser', size:'light', damage:12, range:9, accuracy:0.82, cooldown:1, count:2, color:YELLOW }),
      createWeapon({ id:'nmw2', name:'Propulseur ionique', type:'ion', size:'light', damage:20, range:8, accuracy:0.74, cooldown:3, color:CYAN }),
    ],
    defaultInventory: createInventory({ astromech: 1 }),
    defaultShields: { max: 60, rechargeRate: 0.008, restartDelay: 2 },
  }),

  // RP82 Fiend Fighter — chasseur compact haute performance (Ahsoka, 9 ABY).
  // Wookieepedia : ~6,7m, 2 canons laser frontaux, hyperdrive x1, ailes orientables,
  // très maniable. Utilisé par les mercenaires de Morgan Elsbeth (Shin Hati, Marrok)
  // et les gardes de Thrawn. Fabricant : Feethan Ottraw Scalable Assemblies.
  rp82: createShipClass({
    classId:'rp82', name:'RP82 Fiend Fighter', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:6.7, widthM:5.4, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'rpw1', name:'Laser cannon (×2 frontaux)', type:'laser', size:'light',
        damage:10, range:8, accuracy:0.76, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 25, rechargeRate: 0.005, restartDelay: 2 },
  }),

  // RP82 Fiend modifié — Shin Hati (ailes élargies, couleurs rouge/jaune, armement renforcé).
  // Vaisseau nommé : utiliser avec le système Named Character (Shin Hati, Niveau 4).
  rp82_shin: createShipClass({
    classId:'rp82_shin', name:'RP82 Fiend Modifié (Shin Hati)', type:'interceptor', size:'XS', mass:1, hullArmor:2,
    crewCapacity:1, passengerCapacity:0,
    lengthM:6.7, widthM:6.2, hyperdrive:true,
    defaultPilotLevel:4, defaultPilotType:'force_user',
    defaultWeapons:[
      createWeapon({ id:'rsw1', name:'Laser cannon (×2 renforcés)', type:'laser', size:'medium',
        damage:14, range:10, accuracy:0.82, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 50, rechargeRate: 0.007, restartDelay: 2 },
  }),

  ginivex: createShipClass({
    classId:'ginivex', name:'Ginivex-class Starfighter', type:'fighter', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    lengthM:12.5, widthM:12.5,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'gnw1', name:'Laser cannon', type:'laser', size:'light', damage:10, range:8, accuracy:0.73, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 30, rechargeRate: 0.006, restartDelay: 2 },
  }),

  // Cumulus-class Corsair — vaisseau pirate de Gorian Shard (The Mandalorian S3, Skeleton Crew).
  // Wookieepedia (confirmé) : 126m, forme cruciforme/dague, hyperdrive Classe 1, 75 MGLT,
  // boucliers équipés, 4 canons quad laser en tourelles + 14 gunwales ventraux,
  // hangar dorsal pour au moins 10 F3-Vara. Apparitions : Ch.17, Ch.21, Skeleton Crew.
  cumulus_c: createShipClass({
    classId:'cumulus_c', name:'Cumulus-class Corsair', type:'corvette', size:'M', mass:5, hullArmor:2,
    crewCapacity:50, passengerCapacity:50,
    brigCapacity:20,
    medicalCapacity:15,
    lengthM:126.0, widthM:38.0, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'pirate',
    defaultWeapons:[
      createWeapon({ id:'ccw1', name:'Quad laser cannon (×4 tourelles)', type:'laser', size:'medium',
        damage:20, range:10, accuracy:0.72, cooldown:1, count:4, color:ORANGE }),
      createWeapon({ id:'ccw2', name:'Ventral gunwale (×14)', type:'laser', size:'light',
        damage:12, range:6, accuracy:0.68, cooldown:1, count:14, color:ORANGE }),
    ],
    defaultShields: { max: 300, rechargeRate: 0.008, restartDelay: 3 },
    defaultCarrier: { maxSlots:12, maxSimultaneous:6, reserves:[
      { classId:'f3vara', type:'fighter', count:10, deployed:0 },
    ]},
  }),

  // F3-Vara snubfighter — chasseur pirate de l'équipage de Gorian Shard (Mandalorian S3,
  // Skeleton Crew). Wookieepedia (confirmé) : 9,2m, 110 MGLT, 4 canons laser frontaux,
  // 3 moteurs, PAS d'hyperdrive. Fabricant : Rendili StarDrive.
  // Note : l'Encyclopedia 2025 l'a incorrectement nommé "Cumulus-class snub" — le nom
  // officiel depuis le Mandalorian Visual Guide 2026 est F3-Vara snubfighter.
  // L'alias 'cumulus_s' est maintenu pour la rétrocompatibilité.
  f3vara: createShipClass({
    classId:'f3vara', name:'F3-Vara Snubfighter', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:0, passengerCapacity:0,
    medicalCapacity:0, brigCapacity:0,
    lengthM:9.2, widthM:6.0, hyperdrive:false,
    defaultPilotLevel:2, defaultPilotType:'pirate',
    defaultWeapons:[
      createWeapon({ id:'fvw1', name:'Laser cannon (×4 frontaux)', type:'laser', size:'light',
        damage:9, range:7, accuracy:0.72, cooldown:1, count:4, color:ORANGE }),
    ],
    defaultShields: { max: 0, rechargeRate: 0, restartDelay: 99 },
  }),

  // TIE Outland modifié (Moff Gideon) — vaisseau personnalisé, voir vaisseaux nommés.
  // La classe générique ci-dessous représente le type de base ; l'appareil de Gideon
  // est une modification unique avec armement amélioré (Named Ship via éditeur MJ).
  tie_out: createShipClass({
    classId:'tie_out', name:'TIE Outland Fighter', type:'fighter', size:'XS', mass:1, hullArmor:1,
    lengthM:7.2, widthM:6.5,
    defaultPilotLevel:2, defaultPilotType:'pirate',
    defaultWeapons:[
      createWeapon({ id:'tow1', name:'Laser cannon (×2)', type:'laser', size:'light', damage:9, range:8, accuracy:0.71, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 30, rechargeRate: 0.005, restartDelay: 3 },
  }),

  fang: createShipClass({
    classId:'fang', name:'Fang-class Starfighter', type:'interceptor', size:'XS', mass:2, hullArmor:2,
    crewCapacity:1, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:0,
    lengthM:10.5, widthM:9.0,
    defaultPilotLevel:3, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'fnw1', name:'Laser cannon', type:'laser', size:'medium', damage:13, range:10, accuracy:0.78, cooldown:1, count:3, color:ORANGE }),
      createWeapon({ id:'fnw2', name:'Proton torpedo', type:'torpedo', size:'heavy', damage:120, range:12, accuracy:0.66, cooldown:8, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ torpedoes: 4 }),
    defaultShields: { max: 80, rechargeRate: 0.007, restartDelay: 3 },
  }),

  komrk: createShipClass({
    classId:'komrk', name:"Kom'rk-class Fighter/Transport (Gauntlet)", type:'gunship', size:'S', mass:4, hullArmor:2,
    crewCapacity:4, passengerCapacity:80,
    brigCapacity:2,
    medicalCapacity:8,
    lengthM:25.0, widthM:31.0, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'kmw1', name:'Laser cannon', type:'laser', size:'medium', damage:12, range:10, accuracy:0.70, cooldown:1, count:4, color:ORANGE }),
    ],
    defaultShields: { max: 150, rechargeRate: 0.01, restartDelay: 4 },
  }),

  scyk: createShipClass({
    classId:'scyk', name:'M3-A Scyk Interceptor', type:'interceptor', size:'XS', mass:1, hullArmor:1,
    crewCapacity:1, passengerCapacity:0,
    lengthM:9.1, widthM:3.7,
    defaultPilotLevel:1, defaultPilotType:'pirate',
    defaultWeapons:[
      createWeapon({ id:'skw1', name:'Laser cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.70, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 0 },
  }),

  // ═══════════════════════════════════════════════════════
  // TRANSPORTS, NAVETTES & CANONNIÈRES SUPPLÉMENTAIRES
  // ═══════════════════════════════════════════════════════

  laat_c: createShipClass({
    classId:'laat_c', name:'LAAT/c Carrier', type:'gunship', size:'S', mass:4, hullArmor:2,
    lengthM:28.0, widthM:30.0,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'lcw1', name:'Point defense', type:'laser', size:'light', damage:8, range:6, accuracy:0.65, cooldown:2, count:2, color:BLUE, defensive:true }),
    ],
    defaultShields: { max: 0, rechargeRate: 0.0, restartDelay: 0 },
    defaultCarrier: { maxSlots:2, maxSimultaneous:1, reserves:[{ classId:'gunship', type:'gunship', count:2, deployed:0 }] },
  }),

  tie_reaper: createShipClass({
    classId:'tie_reaper', name:'TIE Reaper', type:'gunship', size:'S', mass:3, hullArmor:2,
    crewCapacity:3, passengerCapacity:20,
    lengthM:24.0, widthM:28.0,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'trw1', name:'Laser cannon', type:'laser', size:'light', damage:9, range:8, accuracy:0.70, cooldown:1, count:4, color:RED }),
    ],
    defaultShields: { max: 40, rechargeRate: 0.005, restartDelay: 3 },
  }),

  lambda: createShipClass({
    classId:'lambda', name:'Lambda-class T-4a Shuttle', type:'corvette', size:'M', mass:3, hullArmor:2,
    crewCapacity:6, passengerCapacity:20,
    brigCapacity:2,
    medicalCapacity:4,
    lengthM:20.0, widthM:43.9, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'lbw1', name:'Laser cannon', type:'laser', size:'light', damage:8, range:7, accuracy:0.66, cooldown:2, count:2, color:RED }),
      createWeapon({ id:'lbw2', name:'Rear laser', type:'laser', size:'light', damage:7, range:6, accuracy:0.62, cooldown:2, count:2, color:RED, firingArc:120 }),
    ],
    defaultShields: { max: 200, rechargeRate: 0.012, restartDelay: 4 },
  }),

  gr75: createShipClass({
    classId:'gr75', name:'GR-75 Medium Transport', type:'corvette', size:'M', mass:5, hullArmor:2,
    crewCapacity:6, passengerCapacity:300,
    brigCapacity:0,
    medicalCapacity:10,
    lengthM:90.0, widthM:38.0, hyperdrive:true,
    defaultPilotLevel:1, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'grw1', name:'Point defense', type:'laser', size:'light', damage:6, range:5, accuracy:0.60, cooldown:2, count:4, color:GREEN, defensive:true }),
    ],
    defaultShields: { max: 100, rechargeRate: 0.008, restartDelay: 5 },
  }),

  // ── Gozanti CIVIL : transport armé de base, désarmé, pas de hangar ──
  // Lore : la version civile utilisée par marchands et contrebandiers (Wookieepedia)
  gozanti_civilian: createShipClass({
    classId:'gozanti_civilian', name:'Gozanti-class (Civil)', type:'corvette', size:'M', mass:4, hullArmor:1,
    crewCapacity:4, passengerCapacity:6,
    brigCapacity:1,
    medicalCapacity:3,
    lengthM:63.8, widthM:21.7, hyperdrive:true,
    defaultPilotLevel:1, defaultPilotType:'civilian',
    defaultWeapons:[
      createWeapon({ id:'gzcw1', name:'Twin Laser Turret', type:'laser', size:'light', damage:18, range:7, accuracy:0.60, cooldown:2, count:1, color:RED, defensive:true }),
    ],
    defaultShields: { max: 120, rechargeRate: 0.008, restartDelay: 4 },
    // Pas de hangar par défaut — c'est un cargo
  }),

  // ── Gozanti IMPÉRIAL : porteur de TIE, tourelle dorsale + canon ventral ──
  // Lore : "Imperial Gozanti-class TIE carrier", ~64 m, 4 TIE/ln (1 swap bombardier)
  // Alias rétro-compatibilité : 'gozanti' = version impériale
  gozanti_imperial: createShipClass({
    classId:'gozanti_imperial', name:'Gozanti-class (Impérial)', type:'corvette', size:'M', mass:4, hullArmor:2,
    crewCapacity:5, passengerCapacity:0,
    brigCapacity:2,
    medicalCapacity:4,
    lengthM:63.8, widthM:33.0, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'gziw1', name:'Twin Laser Turret (dorsal)', type:'laser', size:'medium', damage:40, range:10, accuracy:0.65, cooldown:2, count:1, color:GREEN }),
      createWeapon({ id:'gziw2', name:'Heavy Laser Cannon (ventral)', type:'laser', size:'medium', damage:55, range:11, accuracy:0.58, cooldown:3, count:1, color:GREEN }),
    ],
    defaultShields: { max: 200, rechargeRate: 0.01, restartDelay: 4 },
    defaultCarrier: { maxSlots:4, maxSimultaneous:2, reserves:[{ classId:'tie_ln', type:'fighter', count:4, deployed:0 }] },
  }),

  // ── C-ROC : version pirate/contrebandier renforcée, plus de cargo ──
  // Lore : 73.9 m, populaire chez pirates/contrebandiers, ex. 4 Scyk (Kimoliga's Maw)
  gozanti_croc: createShipClass({
    classId:'gozanti_croc', name:'C-ROC Gozanti (Pirate)', type:'corvette', size:'M', mass:5, hullArmor:2,
    crewCapacity:5, passengerCapacity:10,
    brigCapacity:4,
    medicalCapacity:4,
    lengthM:73.9, widthM:38.0, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'gzcrw1', name:'Twin Laser Cannon', type:'laser', size:'medium', damage:42, range:10, accuracy:0.62, cooldown:2, count:2, color:RED }),
    ],
    defaultShields: { max: 280, rechargeRate: 0.014, restartDelay: 4 }, // mieux blindé/boucliers
    defaultCarrier: { maxSlots:4, maxSimultaneous:2, reserves:[{ classId:'scyk', type:'fighter', count:4, deployed:0 }] },
  }),

  razor_crest: createShipClass({
    classId:'razor_crest', name:'Razor Crest (ST-70)', type:'gunship', size:'S', mass:2, hullArmor:2,
    crewCapacity:1, passengerCapacity:2,
    brigCapacity:1,
    medicalCapacity:2,
    lengthM:27.5, widthM:21.2, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'rcw1', name:'Laser cannon', type:'laser', size:'light', damage:10, range:8, accuracy:0.72, cooldown:1, count:2, color:WHITE }),
    ],
    defaultShields: { max: 60, rechargeRate: 0.007, restartDelay: 3 },
  }),

  consular: createShipClass({
    classId:'consular', name:'Consular-class Cruiser', type:'corvette', size:'M', mass:4, hullArmor:2,
    crewCapacity:8, passengerCapacity:16,
    brigCapacity:2,
    medicalCapacity:6,
    lengthM:115.0, widthM:57.0, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'cnw1', name:'Turbolaser', type:'laser', size:'medium', damage:60, range:14, accuracy:0.65, cooldown:2, count:4, color:BLUE }),
    ],
    defaultShields: { max: 500, rechargeRate: 0.014, restartDelay: 4 },
  }),

  // ═══════════════════════════════════════════════════════
  // DESTROYERS SUPPLÉMENTAIRES
  // ═══════════════════════════════════════════════════════

  imp2: createShipClass({
    classId:'imp2', name:'Imperial II-class Star Destroyer', type:'destroyer', size:'XL', mass:9, hullArmor:5,
    crewCapacity:37085, passengerCapacity:9700,
    brigCapacity:1000,
    medicalCapacity:3000,
    lengthM:1600, widthM:900, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'i2w1', name:'Heavy turbolaser', type:'laser', size:'capital', damage:500, range:32, accuracy:0.60, cooldown:3, count:12, color:RED }),
      createWeapon({ id:'i2w2', name:'Ion cannon battery', type:'ion', size:'capital', damage:250, range:24, accuracy:0.62, cooldown:4, count:8, color:'#4499ff' }),
      createWeapon({ id:'i2w3', name:'Point defense', type:'laser', size:'light', damage:35, range:8, accuracy:0.84, cooldown:1, count:12, color:RED, defensive:true }),
    ],
    defaultShields: { max: 9000, rechargeRate: 0.08, restartDelay: 6 },
    defaultCarrier: { maxSlots:72, maxSimultaneous:20, reserves:[
      { classId:'tie_ln', type:'fighter', count:48, deployed:0 },
      { classId:'tie_int', type:'interceptor', count:12, deployed:0 },
      { classId:'tie_bomber', type:'bomber', count:12, deployed:0 },
    ]},
  }),

  interdictor: createShipClass({
    // Lore (Wookieepedia) : Immobilizer 418, coque Vindicator de 600 m,
    // 4 projecteurs de puits de gravité, 20 canons laser (dont quads), 24 TIE.
    // Volontairement FAIBLE en combat : sa protection est le cœur du dilemme tactique.
    classId:'interdictor', name:'Immobilizer 418 (Interdicteur)', type:'cruiser', size:'L', mass:4, hullArmor:3,
    crewCapacity:9235, passengerCapacity:2400,
    brigCapacity:300,
    medicalCapacity:600,
    lengthM:600, widthM:300, hyperdrive:true,
    gravityWell: 25,  // puits de gravité : bloque l'hyperespace ennemi (rayon en cases)
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'idw1', name:'Quad Laser Cannon (×12)', type:'laser', size:'medium', damage:38, range:10, accuracy:0.62, cooldown:2, count:12, color:GREEN }),
      createWeapon({ id:'idw2', name:'Laser Cannon (×8)', type:'laser', size:'light', damage:25, range:8, accuracy:0.72, cooldown:1, count:8, color:GREEN, defensive:true }),
    ],
    defaultShields: { max: 2800, rechargeRate: 0.05, restartDelay: 6 },
    defaultCarrier: { maxSlots:24, maxSimultaneous:12, reserves:[
      { classId:'tie_ln', type:'fighter', count:24, deployed:0 },
    ]},
  }),
  kihraxz: createShipClass({
    classId:'kihraxz', name:'Kihraxz Assault Fighter', type:'heavy_fighter', size:'XS', mass:2, hullArmor:2,
    crewCapacity:1, passengerCapacity:0,
    lengthM:11.0, widthM:9.5,
    defaultPilotLevel:2, defaultPilotType:'pirate',
    defaultWeapons:[
      createWeapon({ id:'khw1', name:'Laser lourd', type:'laser', size:'medium', damage:14, range:9, accuracy:0.73, cooldown:1, count:2, color:ORANGE }),
      createWeapon({ id:'khw2', name:'Missile', type:'missile', size:'heavy', damage:90, range:11, accuracy:0.64, cooldown:6, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 4 }),
    defaultShields: { max: 50, rechargeRate: 0.006, restartDelay: 3 },
  }),

  // ═══════════════════════════════════════════════════════
  // SÉPARATISTES — CLASSES MANQUANTES
  // ═══════════════════════════════════════════════════════

  // Lucrehulk-class Battleship — cuirassé/transporteur Fédération du Commerce.
  // Wookiepedia : 3 170m de diamètre, anneau extérieur + sphère centrale,
  // 1 500 vaisseaux droïdes, 50 turbolasers à quad, 50 canons laser.
  lucrehulk: createShipClass({
    classId:'lucrehulk', name:'Lucrehulk-class Battleship', type:'dreadnought', size:'XXL', mass:40, hullArmor:5,
    crewCapacity:0, passengerCapacity:329000,
    brigCapacity:5000,
    medicalCapacity:200,
    lengthM:3170, widthM:3170, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'droid_integrated',
    defaultWeapons:[
      createWeapon({ id:'lhw1', name:'Quad turbolaser (×50)', type:'laser', size:'capital', damage:80, range:30, accuracy:0.58, cooldown:3, count:50, color:RED }),
      createWeapon({ id:'lhw2', name:'Laser cannon (×50)', type:'laser', size:'heavy', damage:40, range:18, accuracy:0.65, cooldown:2, count:50, color:RED }),
    ],
    defaultShields: { max: 18000, rechargeRate: 0.10, restartDelay: 8 },
    defaultCarrier: { maxSlots:300, maxSimultaneous:50, reserves:[
      { classId:'vulture_droid', type:'fighter', count:200, deployed:0 },
      { classId:'hyena', type:'bomber', count:50, deployed:0 },
      { classId:'tri_droid', type:'heavy_fighter', count:50, deployed:0 },
    ]},
  }),

  // Subjugator-class Heavy Cruiser — la Malevolence. Wookiepedia : 4 845m,
  // 2 canons à ions de masse, canons laser. Une seule confirmée construite.
  subjugator: createShipClass({
    classId:'subjugator', name:'Subjugator-class Heavy Cruiser (Malevolence)', type:'dreadnought', size:'XXL', mass:50, hullArmor:6,
    crewCapacity:0, passengerCapacity:50000,
    brigCapacity:200,
    medicalCapacity:200,
    lengthM:4845, widthM:900, hyperdrive:true,
    defaultPilotLevel:4, defaultPilotType:'droid_integrated',
    defaultWeapons:[
      createWeapon({ id:'sjw1', name:'Ion pulse cannon (×2)', type:'ion', size:'capital', damage:2000, range:45, accuracy:0.72, cooldown:20, count:2, color:CYAN }),
      createWeapon({ id:'sjw2', name:'Dual turbolaser (×500)', type:'laser', size:'capital', damage:60, range:25, accuracy:0.60, cooldown:3, count:500, color:RED }),
      createWeapon({ id:'sjw3', name:'Point defense', type:'laser', size:'light', damage:20, range:8, accuracy:0.82, cooldown:1, count:32, color:RED, defensive:true }),
    ],
    defaultShields: { max: 30000, rechargeRate: 0.12, restartDelay: 10 },
    defaultCarrier: { maxSlots:500, maxSimultaneous:60, reserves:[
      { classId:'vulture_droid', type:'fighter', count:300, deployed:0 },
      { classId:'hyena', type:'bomber', count:100, deployed:0 },
      { classId:'tri_droid', type:'heavy_fighter', count:100, deployed:0 },
    ]},
  }),

  // Banking Clan Frigate (Munificent-class) alias déjà géré (frigate_assault).
  // Ici on ajoute le Separatist light destroyer manquant :

  // Recusant-class Light Destroyer — déjà présent. On ajoute le Hardcell.
  // Hardcell-class Transport — vaisseau de transport/ravitaillement CIS.
  // Wookiepedia : 218m, peu armé, sert au transport de troupes droïdes.
  hardcell: createShipClass({
    classId:'hardcell', name:'Hardcell-class Transport', type:'transport', size:'M', mass:3, hullArmor:2,
    crewCapacity:20, passengerCapacity:8000,
    brigCapacity:10,
    medicalCapacity:20,
    lengthM:218, widthM:98, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'droid_integrated',
    defaultWeapons:[
      createWeapon({ id:'hcw1', name:'Laser cannon (×4)', type:'laser', size:'light', damage:14, range:7, accuracy:0.62, cooldown:1, count:4, color:RED }),
    ],
    defaultShields: { max: 200, rechargeRate: 0.003, restartDelay: 4 },
  }),

  // ═══════════════════════════════════════════════════════
  // RÉPUBLICAINS — CLASSES MANQUANTES
  // ═══════════════════════════════════════════════════════

  // LAAT/le (Low-Altitude Assault Transport / Elevation) — version de reconnaissance légère.
  laat_le: createShipClass({
    classId:'laat_le', name:'LAAT/le Police Gunship', type:'gunship', size:'S', mass:2, hullArmor:2,
    crewCapacity:2, passengerCapacity:6,
    lengthM:18.8, widthM:17.4, hyperdrive:false,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'llw1', name:'Laser cannon (×2)', type:'laser', size:'medium', damage:20, range:8, accuracy:0.72, cooldown:1, count:2, color:GREEN }),
    ],
    defaultShields: { max: 80, rechargeRate: 0.006, restartDelay: 3 },
  }),

  // Sheathipede-class Transport Shuttle — navette Séparatiste petite taille.
  // Wookiepedia : 14,39m, utilisée par Nute Gunray & hauts officiels CIS.
  sheathipede: createShipClass({
    classId:'sheathipede', name:'Sheathipede-class Transport Shuttle', type:'shuttle', size:'S', mass:1, hullArmor:1,
    crewCapacity:4, passengerCapacity:10,
    lengthM:14.4, widthM:12.7, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'droid_integrated',
    defaultWeapons:[
      createWeapon({ id:'shw1', name:'Laser cannon (×2)', type:'laser', size:'light', damage:10, range:6, accuracy:0.65, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 30, rechargeRate: 0.004, restartDelay: 3 },
  }),

  // Eta-class Shuttle — navette d'état République/Empire.
  // Wookiepedia : 17,4m, navette de commandement de l'Ordre 66.
  eta_shuttle: createShipClass({
    classId:'eta_shuttle', name:'Eta-class Shuttle', type:'shuttle', size:'S', mass:1, hullArmor:1,
    crewCapacity:6, passengerCapacity:20,
    brigCapacity:0,
    medicalCapacity:4,
    lengthM:17.4, widthM:12.1, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'esw1', name:'Laser cannon (×2)', type:'laser', size:'light', damage:10, range:6, accuracy:0.65, cooldown:1, count:2, color:GREEN }),
    ],
    defaultShields: { max: 50, rechargeRate: 0.005, restartDelay: 3 },
  }),

  // ═══════════════════════════════════════════════════════
  // EMPIRE — CLASSES MANQUANTES
  // ═══════════════════════════════════════════════════════

  // TIE/D Defender — chasseur d'élite impérial (Rebels canon, Wookiepedia confirmé).
  // Wookiepedia : 8,02m, boucliers et hyperdrive (rarissimes sur un TIE),
  // 3 canons laser + 2 canons à ions + torpilles.
  tie_defender: createShipClass({
    classId:'tie_defender', name:'TIE/D Defender', type:'heavy_fighter', size:'XS', mass:2, hullArmor:2,
    crewCapacity:1, passengerCapacity:0,
    lengthM:8.0, widthM:9.0, hyperdrive:true,
    defaultPilotLevel:4, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'tdw1', name:'Laser cannon (×4)', type:'laser', size:'medium', damage:16, range:11, accuracy:0.82, cooldown:1, count:4, color:RED }),
      createWeapon({ id:'tdw2', name:'Ion cannon (×2)', type:'ion', size:'medium', damage:25, range:9, accuracy:0.78, cooldown:2, count:2, color:CYAN }),
      createWeapon({ id:'tdw3', name:'Concussion missile (×8)', type:'missile', size:'heavy', damage:110, range:13, accuracy:0.72, cooldown:6, ammoUsage:1, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 8 }),
    defaultShields: { max: 120, rechargeRate: 0.012, restartDelay: 2 },
  }),

  // TIE/ph Phantom — chasseur furtif impérial (Rebels).
  // Wookiepedia : 12,08m, générateur de masquage, canon à ions + lasers.
  tie_phantom: createShipClass({
    classId:'tie_phantom', name:'TIE/ph Phantom', type:'stealth_fighter', size:'XS', mass:2, hullArmor:2,
    crewCapacity:2, passengerCapacity:0,
    lengthM:12.1, widthM:9.4, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'tpw1', name:'Laser cannon (×4)', type:'laser', size:'medium', damage:15, range:10, accuracy:0.80, cooldown:1, count:4, color:RED }),
      createWeapon({ id:'tpw2', name:'Ion cannon (×2)', type:'ion', size:'medium', damage:28, range:8, accuracy:0.76, cooldown:2, count:2, color:CYAN }),
    ],
    defaultShields: { max: 80, rechargeRate: 0.008, restartDelay: 2 },
  }),

  // Raider-class Corvette — corvette impériale anti-chasseurs.
  // Wookiepedia : 150m, canon laser lourd, pods de missiles, rapide.
  raider_corvette: createShipClass({
    classId:'raider_corvette', name:'Raider-class Corvette', type:'corvette', size:'M', mass:5, hullArmor:3,
    crewCapacity:60, passengerCapacity:0,
    brigCapacity:5,
    medicalCapacity:10,
    lengthM:150, widthM:47, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'rcw1', name:'Heavy laser cannon (×8)', type:'laser', size:'heavy', damage:45, range:12, accuracy:0.74, cooldown:2, count:8, color:RED }),
      createWeapon({ id:'rcw2', name:'Concussion missile (×4)', type:'missile', size:'heavy', damage:120, range:15, accuracy:0.68, cooldown:8, ammoUsage:1, count:4, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 16 }),
    defaultShields: { max: 300, rechargeRate: 0.010, restartDelay: 3 },
  }),

  // IPV-1 System Patrol Craft — patrouilleur impérial léger.
  // Wookiepedia : 60,3m, deux canons laser, faible blindage.
  ipv1: createShipClass({
    classId:'ipv1', name:'IPV-1 System Patrol Craft', type:'gunship', size:'S', mass:2, hullArmor:2,
    crewCapacity:45, passengerCapacity:0,
    lengthM:60, widthM:19, hyperdrive:false,
    defaultPilotLevel:2, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'ipw1', name:'Laser cannon (×2)', type:'laser', size:'medium', damage:22, range:9, accuracy:0.70, cooldown:1, count:2, color:RED }),
    ],
    defaultShields: { max: 80, rechargeRate: 0.006, restartDelay: 3 },
  }),

  // Gozanti-class Cruiser (Imperial) — déjà présent. Ajout du Cantwell-class.
  // Cantwell-class Arrestor Cruiser — croiseur d'arrestation (Andor S2).
  // Wookiepedia : 1 005m, filets d'arrestation + armement défensif.
  arrestor_cruiser: createShipClass({
    classId:'arrestor_cruiser', name:'Cantwell-class Arrestor Cruiser', type:'cruiser', size:'XL', mass:7, hullArmor:4,
    crewCapacity:1000, passengerCapacity:0,
    brigCapacity:500,
    medicalCapacity:200,
    lengthM:1005, widthM:450, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    gravityWell: 20,
    defaultWeapons:[
      createWeapon({ id:'acw1', name:'Turbolaser (×6)', type:'laser', size:'heavy', damage:80, range:18, accuracy:0.65, cooldown:3, count:6, color:RED }),
      createWeapon({ id:'acw2', name:'Ion cannon (×4)', type:'ion', size:'capital', damage:200, range:20, accuracy:0.60, cooldown:5, count:4, color:CYAN }),
      createWeapon({ id:'acw3', name:'Point defense', type:'laser', size:'light', damage:25, range:7, accuracy:0.82, cooldown:1, count:16, color:RED, defensive:true }),
    ],
    defaultShields: { max: 5000, rechargeRate: 0.06, restartDelay: 6 },
  }),

  // ═══════════════════════════════════════════════════════
  // ALLIANCE REBELLE — CLASSES MANQUANTES
  // ═══════════════════════════════════════════════════════

  // VCX-100 Armed Freighter (Ghost) — Star Wars Rebels.
  // Wookiepedia : 43,9m, canons jumelés dorsaux + ventral + poupe, 2 turrets.
  ghost: createShipClass({
    classId:'ghost', name:'VCX-100 Armed Freighter (Ghost)', type:'heavy_fighter', size:'S', mass:3, hullArmor:3,
    crewCapacity:4, passengerCapacity:6,
    brigCapacity:2,
    medicalCapacity:6,
    lengthM:43.9, widthM:27.4, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'ghw1', name:'Twin laser cannon (dorsal)', type:'laser', size:'medium', damage:22, range:10, accuracy:0.75, cooldown:1, count:2, color:GREEN }),
      createWeapon({ id:'ghw2', name:'Ventral gun', type:'laser', size:'medium', damage:20, range:9, accuracy:0.73, cooldown:1, count:1, color:GREEN }),
      createWeapon({ id:'ghw3', name:'Proton torpedo (×4)', type:'torpedo', size:'heavy', damage:95, range:12, accuracy:0.68, cooldown:8, ammoUsage:1, count:4, color:ORANGE }),
    ],
    defaultInventory: createInventory({ torpedoes: 8 }),
    defaultShields: { max: 250, rechargeRate: 0.008, restartDelay: 3 },
    scanner: 12,
  }),

  // AB-75 Bo-rifle / Phantom II — navette attachée au Ghost.
  // Wookiepedia : 11,63m, deux canons laser, légère.
  phantom: createShipClass({
    classId:'phantom', name:'Phantom II (Navette AB-75)', type:'shuttle', size:'XS', mass:1, hullArmor:1,
    crewCapacity:2, passengerCapacity:5,
    brigCapacity:0,
    medicalCapacity:1,
    lengthM:11.6, widthM:8.9, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'phw1', name:'Laser cannon (×2)', type:'laser', size:'light', damage:10, range:8, accuracy:0.70, cooldown:1, count:2, color:GREEN }),
    ],
    defaultShields: { max: 40, rechargeRate: 0.006, restartDelay: 2 },
  }),

  // DP20 Gunship (Corellian Gunship) — canonnnière de corvette Rebelle.
  // Wookiepedia : 120m, canons à tir rapide × 12, très maniable.
  dp20: createShipClass({
    classId:'dp20', name:'DP20 Corellian Gunship', type:'corvette', size:'M', mass:3, hullArmor:2,
    crewCapacity:91, passengerCapacity:0,
    brigCapacity:0,
    medicalCapacity:8,
    lengthM:120, widthM:46, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'rebel',
    defaultWeapons:[
      createWeapon({ id:'dpw1', name:'Rapid-fire cannon (×12)', type:'laser', size:'medium', damage:18, range:9, accuracy:0.78, cooldown:1, count:12, color:GREEN }),
      createWeapon({ id:'dpw2', name:'Concussion missile', type:'missile', size:'heavy', damage:100, range:12, accuracy:0.66, cooldown:8, ammoUsage:1, count:2, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 8 }),
    defaultShields: { max: 250, rechargeRate: 0.008, restartDelay: 3 },
  }),

  // ═══════════════════════════════════════════════════════
  // VAISSEAUX GÉNÉRIQUES / MERCENAIRES / NEUTRES
  // ═══════════════════════════════════════════════════════

  // Firespray-31-class Patrol and Attack Craft (Slave I type).
  // Wookiepedia : 21,5m, canons laser rotatifs, missile + torpilles,
  // soute à prisonniers. Modèle générique : Jango/Boba Fett utilisent cette classe.
  firespray: createShipClass({
    classId:'firespray', name:'Firespray-31-class Patrol Craft', type:'heavy_fighter', size:'S', mass:3, hullArmor:3,
    crewCapacity:1, passengerCapacity:4,
    lengthM:21.5, widthM:17.4, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'fsw1', name:'Rotating laser cannon (×2)', type:'laser', size:'medium', damage:18, range:11, accuracy:0.80, cooldown:1, count:2, color:ORANGE }),
      createWeapon({ id:'fsw2', name:'Concussion missile (×4)', type:'missile', size:'heavy', damage:120, range:14, accuracy:0.70, cooldown:6, ammoUsage:1, count:4, color:ORANGE }),
      createWeapon({ id:'fsw3', name:'Seismic charge', type:'bomb', size:'capital', damage:300, range:6, accuracy:1.0, cooldown:16, ammoUsage:1, count:1, color:'#ffeeaa' }),
    ],
    defaultInventory: createInventory({ missiles: 8 }),
    defaultShields: { max: 150, rechargeRate: 0.010, restartDelay: 3 },
    scanner: 8, tractorBeam: 4,
    brigCapacity: 3,
  }),

  // YT-1300 Light Freighter — classe générique du Faucon Millenium.
  // Wookiepedia : 34,37m, canon laser dorsal + ventral. Le Faucon est un
  // exemplaire FORTEMENT modifié (vitesse, armement). Classe générique ici.
  yt1300: createShipClass({
    classId:'yt1300', name:'YT-1300 Light Freighter', type:'transport', size:'S', mass:2, hullArmor:2,
    crewCapacity:2, passengerCapacity:6,
    lengthM:34.4, widthM:25.6, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'smuggler',
    defaultWeapons:[
      createWeapon({ id:'ytw1', name:'Quad laser cannon (dorsal)', type:'laser', size:'medium', damage:18, range:9, accuracy:0.72, cooldown:1, count:2, color:GREEN }),
      createWeapon({ id:'ytw2', name:'Quad laser cannon (ventral)', type:'laser', size:'medium', damage:18, range:9, accuracy:0.70, cooldown:1, count:2, color:GREEN }),
    ],
    defaultShields: { max: 100, rechargeRate: 0.007, restartDelay: 3 },
    cargoVolume: 100, cargoEject: true,
  }),

  // Faucon Millenium — vaisseau nommé (Named Ship), variante fortement modifiée du YT-1300.
  millennium_falcon: createShipClass({
    classId:'millennium_falcon', name:'Faucon Millenium (YT-1300 modifié)', type:'heavy_fighter', size:'S', mass:2, hullArmor:3,
    crewCapacity:2, passengerCapacity:6,
    lengthM:34.4, widthM:25.6, hyperdrive:true,
    defaultPilotLevel:5, defaultPilotType:'smuggler',
    defaultWeapons:[
      createWeapon({ id:'mfw1', name:'AG-2G quad laser (dorsal)', type:'laser', size:'medium', damage:24, range:12, accuracy:0.84, cooldown:1, count:2, color:GREEN }),
      createWeapon({ id:'mfw2', name:'AG-2G quad laser (ventral)', type:'laser', size:'medium', damage:22, range:12, accuracy:0.82, cooldown:1, count:2, color:GREEN }),
      createWeapon({ id:'mfw3', name:'Concussion missile (×2)', type:'missile', size:'heavy', damage:130, range:15, accuracy:0.72, cooldown:8, ammoUsage:1, count:2, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 4 }),
    defaultShields: { max: 200, rechargeRate: 0.012, restartDelay: 2 },
    scanner: 10,
  }),

  // YT-2400 Light Freighter — Dash Rendar, classe générique.
  yt2400: createShipClass({
    classId:'yt2400', name:'YT-2400 Light Freighter', type:'transport', size:'S', mass:2, hullArmor:2,
    crewCapacity:2, passengerCapacity:6,
    lengthM:21.5, widthM:21.5, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'smuggler',
    defaultWeapons:[
      createWeapon({ id:'y24w1', name:'Quad laser cannon (×2)', type:'laser', size:'medium', damage:20, range:10, accuracy:0.74, cooldown:1, count:2, color:ORANGE }),
    ],
    defaultShields: { max: 110, rechargeRate: 0.008, restartDelay: 3 },
    cargoVolume: 80,
  }),

  // Eravana — classe YT-1300 extra-long modifiée (Han Solo, Le Réveil de la Force).
  // Classe générique : freighter lourd Corellien.
  eravana: createShipClass({
    classId:'eravana', name:'Eravana (Freighter Corellien XL)', type:'transport', size:'M', mass:5, hullArmor:2,
    crewCapacity:10, passengerCapacity:20,
    lengthM:227, widthM:98, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'smuggler',
    defaultWeapons:[
      createWeapon({ id:'evw1', name:'Laser cannon (×4)', type:'laser', size:'medium', damage:18, range:9, accuracy:0.68, cooldown:2, count:4, color:ORANGE }),
    ],
    defaultShields: { max: 180, rechargeRate: 0.005, restartDelay: 4 },
    cargoVolume: 250, cargoEject: true,
  }),

  // Slave I (Firespray modifié — vaisseau nommé Jango/Boba Fett).
  slave1: createShipClass({
    classId:'slave1', name:'Slave I (Firespray modifié — Fett)', type:'heavy_fighter', size:'S', mass:3, hullArmor:3,
    crewCapacity:1, passengerCapacity:4,
    lengthM:21.5, widthM:17.4, hyperdrive:true,
    defaultPilotLevel:5, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'s1w1', name:'Laser canon rotatif (×2)', type:'laser', size:'medium', damage:22, range:13, accuracy:0.86, cooldown:1, count:2, color:ORANGE }),
      createWeapon({ id:'s1w2', name:'Missile traçant (×4)', type:'missile', size:'heavy', damage:130, range:16, accuracy:0.76, cooldown:6, ammoUsage:1, count:4, color:ORANGE }),
      createWeapon({ id:'s1w3', name:'Charge sismique', type:'bomb', size:'capital', damage:350, range:7, accuracy:1.0, cooldown:18, ammoUsage:1, count:1, color:'#ffeeaa' }),
      createWeapon({ id:'s1w4', name:'Canon à ions', type:'ion', size:'medium', damage:35, range:10, accuracy:0.78, cooldown:3, count:1, color:CYAN }),
    ],
    defaultInventory: createInventory({ missiles: 8 }),
    defaultShields: { max: 200, rechargeRate: 0.012, restartDelay: 2 },
    scanner: 10, tractorBeam: 5,
    brigCapacity: 4,
  }),

  // Gauntlet Fighter (Kom'rk-class modifié) — déjà présent comme komrk.
  // Ajout du Gauntlet Fighter canonique (Bo-Katan, The Mandalorian S2/S3).
  gauntlet: createShipClass({
    classId:'gauntlet', name:'Gauntlet Fighter (Kom\'rk modifié)', type:'gunship', size:'S', mass:3, hullArmor:3,
    crewCapacity:4, passengerCapacity:80,
    brigCapacity:2,
    medicalCapacity:8,
    lengthM:26.4, widthM:20.7, hyperdrive:true,
    defaultPilotLevel:4, defaultPilotType:'bounty_hunter',
    defaultWeapons:[
      createWeapon({ id:'gaw1', name:'Laser cannon (×4)', type:'laser', size:'medium', damage:18, range:11, accuracy:0.80, cooldown:1, count:4, color:ORANGE }),
      createWeapon({ id:'gaw2', name:'Concussion missile (×2)', type:'missile', size:'heavy', damage:120, range:13, accuracy:0.70, cooldown:6, ammoUsage:1, count:2, color:ORANGE }),
    ],
    defaultInventory: createInventory({ missiles: 4 }),
    defaultShields: { max: 180, rechargeRate: 0.009, restartDelay: 3 },
  }),

  // Naboo Royal Starship (J-type 327) — vaisseau de la Reine Amidala.
  // Wookiepedia : 76m, pas d'armes à l'origine, vitesse exceptionnelle, bouclier de plasma.
  j327: createShipClass({
    classId:'j327', name:'J-type 327 Nubian Royal Starship', type:'shuttle', size:'M', mass:2, hullArmor:1,
    crewCapacity:8, passengerCapacity:4,
    lengthM:76, widthM:26.4, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'royal_guard',
    defaultWeapons:[], // pas d'armement canonique
    defaultShields: { max: 600, rechargeRate: 0.015, restartDelay: 2 }, // plasma shield
  }),

  // J-type Diplomatic Barge — vaisseau diplomatique Naboo (AotC).
  // Wookiepedia : 39m, non armé, très rapide.
  j_barge: createShipClass({
    classId:'j_barge', name:'J-type Diplomatic Barge (Naboo)', type:'shuttle', size:'S', mass:1, hullArmor:1,
    crewCapacity:6, passengerCapacity:4,
    lengthM:39, widthM:16, hyperdrive:true,
    defaultPilotLevel:2, defaultPilotType:'royal_guard',
    defaultWeapons:[],
    defaultShields: { max: 120, rechargeRate: 0.010, restartDelay: 2 },
  }),

  // Nebulon-B2 Frigate — variante améliorée (Empire/RSF).
  // Wookiepedia : 300m, armement supérieur au Nebulon-B classique.
  nebulon_b2: createShipClass({
    classId:'nebulon_b2', name:'Nebulon-B2 Frigate', type:'frigate', size:'L', mass:180, hullArmor:3,
    crewCapacity:920, passengerCapacity:500,
    brigCapacity:20,
    medicalCapacity:100,
    lengthM:300, widthM:72, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'nb2w1', name:'Turbolaser (×12)', type:'laser', size:'heavy', damage:60, range:15, accuracy:0.68, cooldown:3, count:12, color:RED }),
      createWeapon({ id:'nb2w2', name:'Ion cannon (×6)', type:'ion', size:'capital', damage:160, range:16, accuracy:0.62, cooldown:5, count:6, color:CYAN }),
      createWeapon({ id:'nb2w3', name:'Point defense', type:'laser', size:'light', damage:20, range:7, accuracy:0.84, cooldown:1, count:12, color:RED, defensive:true }),
    ],
    defaultShields: { max: 2200, rechargeRate: 0.04, restartDelay: 5 },
    defaultCarrier: { maxSlots:24, maxSimultaneous:12, reserves:[
      { classId:'tie_ln', type:'fighter', count:24, deployed:0 },
    ]},
  }),

  // Venator-class Star Destroyer — croiseur-porteur République (déjà dans alias 'venator' → cruiser).
  // La classe 'cruiser' = Venator. On l'enrichit avec les corrects (cruiser existe déjà).
  // Ajout du Acclamator II (assault ship amélioré) :
  acclamator2: createShipClass({
    classId:'acclamator2', name:'Acclamator II-class Assault Ship', type:'assault_ship', size:'XL', mass:7, hullArmor:4,
    crewCapacity:700, passengerCapacity:16000,
    brigCapacity:500,
    medicalCapacity:1000,
    lengthM:752, widthM:460, hyperdrive:true,
    defaultPilotLevel:3, defaultPilotType:'clone',
    defaultWeapons:[
      createWeapon({ id:'ac2w1', name:'Turbolaser (×12)', type:'laser', size:'capital', damage:120, range:22, accuracy:0.65, cooldown:3, count:12, color:GREEN }),
      createWeapon({ id:'ac2w2', name:'Ion cannon (×6)', type:'ion', size:'capital', damage:200, range:20, accuracy:0.62, cooldown:5, count:6, color:CYAN }),
      createWeapon({ id:'ac2w3', name:'Point defense', type:'laser', size:'light', damage:30, range:7, accuracy:0.85, cooldown:1, count:24, color:GREEN, defensive:true }),
    ],
    defaultShields: { max: 6000, rechargeRate: 0.06, restartDelay: 6 },
    defaultCarrier: { maxSlots:48, maxSimultaneous:16, reserves:[
      { classId:'arc170', type:'fighter', count:24, deployed:0 },
      { classId:'v19', type:'interceptor', count:24, deployed:0 },
    ]},
  }),

  // Pelican-class Transport (The Mandalorian) — transport lourd.
  // Dans le canon Mandalorian, le transport de troupes de Moff Gideon est une classe distincte.
  trident: createShipClass({
    classId:'trident', name:'Trident-class Assault Ship', type:'assault_ship', size:'M', mass:4, hullArmor:3,
    crewCapacity:6, passengerCapacity:60,
    lengthM:88, widthM:62, hyperdrive:false,
    defaultPilotLevel:3, defaultPilotType:'imperial',
    defaultWeapons:[
      createWeapon({ id:'trw1', name:'Laser cannon (×6)', type:'laser', size:'medium', damage:22, range:9, accuracy:0.72, cooldown:1, count:6, color:RED }),
      createWeapon({ id:'trw2', name:'Grapple cable', type:'missile', size:'light', damage:5, range:5, accuracy:0.90, cooldown:10, ammoUsage:1, count:4, color:'#aaaaaa' }),
    ],
    defaultShields: { max: 200, rechargeRate: 0.007, restartDelay: 4 },
  }),
};

// INSTANTIATION
// ═══════════════════════════════════════════════════════

export function instantiatePreset(classId, overrides, createShipFn) {
  // Class ID aliases for backward compatibility / common alternate names
  const ALIASES = {
    'nebulon_b': 'frigate_medical', 'nebulon-b': 'frigate_medical',
    'nebulon':   'frigate_medical', 'nebulonb':  'frigate_medical',
    'munificent':'frigate_assault', 'munn':      'frigate_assault',
    'venator':   'cruiser',         'acclamator_mk2': 'acclamator2',
    'x_wing':    'xwing',           'x-wing':    'xwing',
    'y_wing':    'ywing',           'y-wing':    'ywing',
    'a_wing':    'awing',           'a-wing':    'awing',
    'b_wing':    'bwing',           'b-wing':    'bwing',
    'tie_fighter':'tie_ln',         'tie_interceptor':'tie_int',
    'isd':       'destroyer',       'star_destroyer': 'destroyer',
    'isd2':      'imp2',            'imperial_ii': 'imp2',
    'gozanti':   'gozanti_imperial',
    'mc80_liberty': 'mc80',         'cr90':      'corvette',
    'cr-90':     'corvette',
    'slave_i':   'slave1',          'slave-i':   'slave1',
    'firespray_31':'firespray',      'firespray-31':'firespray',
    'falcon':    'millennium_falcon','millennium_falcon_class':'yt1300',
    'ghost_ship':'ghost',            'vcx100':    'ghost',
    'hyena_bomber':'hyena',          'droid_tri_fighter':'tri_droid',
    'lucrehulk_battleship':'lucrehulk',
    'subjugator_cruiser':'subjugator', 'malevolence':'subjugator',
    'munificent_frigate':'frigate_assault',
    'naboo_royal':'j327',           'royal_starship':'j327',
    'nebulon_b2_frigate':'nebulon_b2',
    'tie_defender_fighter':'tie_defender',
    'tie_phantom_fighter':'tie_phantom',
    'raider_corvette_class':'raider_corvette',
    'gauntlet_fighter':'gauntlet',  'kom_rk_modified':'gauntlet',
    'trident_assault':'trident',
    'eta_shuttle_class':'eta_shuttle',
    'sheathipede_shuttle':'sheathipede',
    // F3-Vara (ex "Cumulus-class snub" — mauvaise désignation Encyclopedia 2025)
    'cumulus_s':   'f3vara',          'cumulus_snub': 'f3vara',
    'f3_vara':     'f3vara',
    // RP82 Fiend Fighter (Ahsoka)
    'fiend':       'rp82',            'fiend_fighter':'rp82',
    'rp82_fiend':  'rp82',
    'shin_hati_fighter':'rp82_shin',  'fiend_shin':   'rp82_shin',
  };
  const resolvedId = ALIASES[classId?.toLowerCase()] || classId;
  const cls = PRESET_CLASSES[resolvedId];
  if (!cls) {
    throw new Error(`Classe inconnue: "${classId}"${resolvedId !== classId ? ` (alias de "${resolvedId}")` : ''}`);
  }
  const size = cls.size;
  // ─── HP: longueur × SIZE_HP_MULT[size] ──────────────────────
  const maxHp = overrides.maxHp
    ?? (cls.lengthM && size ? calcHpFromDims(cls.lengthM, cls.widthM, cls.hullArmor, size, cls.type)
                            : SIZE_DEFAULT_HP[size] || 100);

  // ─── Armor: computed from type + size + dims ─────────────────
  const computedArmor = calcHullArmor(cls.type, size, cls.lengthM, cls.widthM);
  const hullArmor     = overrides.hullArmor ?? computedArmor;

  // ─── Shields: regen params scaled by size ────────────────────
  const shieldRegen = SHIELD_REGEN_BY_SIZE[size] || SHIELD_REGEN_BY_SIZE.M || { passiveRate:0.003, restartDelay:4, burstRate:0.10 };
  const baseShields = cls.defaultShields;
  const shieldMax   = overrides.shields?.max ?? baseShields?.max
    ?? (hullArmor > 18 ? Math.round(maxHp * 0.6) : hullArmor > 10 ? Math.round(maxHp * 0.35) : 0);
  const shieldObj = {
    max:              shieldMax,
    current:          shieldMax,
    rechargeRate:     baseShields?.rechargeRate    ?? shieldRegen.passiveRate,
    burstRechargeRate:baseShields?.burstRechargeRate ?? shieldRegen.burstRate,
    restartDelay:     baseShields?.restartDelay    ?? shieldRegen.restartDelay,
    restartCounter:   0,
    disabled:         false,
    _inBurstMode:     false,
  };

  // ─── Pilot ───────────────────────────────────────────────────
  const defaultPilotType = {
    arc170:      'clone',
    ywing:       'clone',
    v19:         'clone',
    gunship:     'clone',
    corvette:    'rebel',
    frigate_medical:  'rebel',
    frigate_assault:  'droid_captain',
    cruiser:     'clone_commander',
    destroyer:   'imperial',
    providence:  'droid_strategist',
    dreadnought: 'imperial',
    interceptor: 'droid_integrated',
    vulture_droid: 'droid_integrated',
    tri_droid:   'droid_integrated_advanced',
  }[resolvedId] || (overrides.pilotType || 'imperial');

  const pilotType  = overrides.pilotType || defaultPilotType;
  const pilotLevel = overrides.pilotLevel ?? rollPilotLevel(pilotType);
  // Policy unlocks from pilot type (e.g. smuggler→retreat, pirate→weapons)
  const _pilotPolicyUnlocks = PILOT_TYPES[pilotType]?.mods?.policyUnlocks || [];

  const ship = createShipFn({
    classId:   resolvedId,
    name:      overrides.name || cls.name,
    type:      cls.type,
    size,
    mass:      cls.mass,
    hullArmor,
    lengthM:   cls.lengthM,
    widthM:    cls.widthM,
    maxHp, hp: maxHp,
    speed:     SIZE_DEFAULT_SPEED[size] || 1,
    weapons:   cls.defaultWeapons.map(w => ({ ...w, id: nanoid(), currentCooldown: 0 })),
    inventory: { ...cls.defaultInventory },
    shields:   shieldObj,
    icon:      cls.icon,
    pilotType,
    pilotLevel,
    _pilotPolicyUnlocks,
    carrier: cls.defaultCarrier
      ? JSON.parse(JSON.stringify(cls.defaultCarrier))
      : null,
    gravityWell: cls.gravityWell || 0,
    tractorBeam: cls.tractorBeam || _defaultTractor(size),
    hyperdrive: cls.hyperdrive ?? true,
    scanner:    cls.scanner    ?? 0,
    cargoEject: cls.cargoEject ?? false,
    crewCapacity:      cls.crewCapacity      ?? 0,
    passengerCapacity: cls.passengerCapacity ?? 0,
    ...overrides,
  });

  // ─── Roster initial équipage : droïde ou humain selon pilotType ──────────
  // Les types de pilotes droïdes ont un équipage 100% droïde, les autres
  // ont un équipage 100% humain/organique par défaut.
  // Aucune forme de vie détectable au scanner pour les vaisseaux à équipage droïde.
  const DROID_PILOT_TYPES = new Set([
    'droid_integrated', 'droid_integrated_advanced', 'droid_captain',
  ]);
  const crewCap = ship.crewCapacity || 0;
  if (crewCap > 0 && !ship._paxRoster) {
    const isDroid = DROID_PILOT_TYPES.has(ship.pilotType);
    ship._paxRoster = {
      crew: isDroid ? { human: 0, droid: crewCap } : { human: crewCap, droid: 0 },
      pax:  { human: 0, droid: 0 },
      wnd:  { human: 0, droid: 0 },
      pri:  { human: 0, droid: 0 },
    };
  }

  return ship;
}

/** Portée tracteur par défaut selon la taille (cases). XS/S : aucun. */
function _defaultTractor(size) {
  switch (size) {
    case 'M':   return 3;
    case 'L':   return 5;
    case 'XL':  return 7;
    case 'XXL': return 10;
    default:    return 0;   // XS, S
  }
}

// ═══════════════════════════════════════════════════════
// DEMO SCENARIO
// ═══════════════════════════════════════════════════════

export function buildDemoScenario(createShipFn, createFleetFn, createScenarioFn) {
  const fleetRepublic = createFleetFn({ fleetId:'fleet_rep', name:'Republic',    faction:'Republic',    colorIndex:0 });
  const fleetSeparate = createFleetFn({ fleetId:'fleet_sep', name:'Separatists', faction:'Separatists', colorIndex:1 });

  // Fleets start ~18 cells apart — close enough to engage quickly
  const ships = [
    // ─── Republic (left side) ─────────────────────────────────────────
    instantiatePreset('cruiser',         { id:'ship_ven',  name:'Resolute',       fleetId:'fleet_rep', position:{x:150,y:230,z:3}, heading:0 }, createShipFn),
    instantiatePreset('corvette',        { id:'ship_cr90a',name:'Twilight',        fleetId:'fleet_rep', position:{x:144,y:260,z:3}, heading:0 }, createShipFn),
    instantiatePreset('arc170',          { id:'ship_arc1', name:'Red Leader',      fleetId:'fleet_rep', position:{x:136,y:210,z:2}, heading:0 }, createShipFn),
    instantiatePreset('arc170',          { id:'ship_arc2', name:'Red 2',           fleetId:'fleet_rep', position:{x:136,y:220,z:2}, heading:0 }, createShipFn),
    instantiatePreset('v19',             { id:'ship_v19a', name:'Blue Leader',     fleetId:'fleet_rep', position:{x:130,y:240,z:2}, heading:0 }, createShipFn),
    instantiatePreset('v19',             { id:'ship_v19b', name:'Blue 2',          fleetId:'fleet_rep', position:{x:130,y:250,z:2}, heading:0 }, createShipFn),
    instantiatePreset('ywing',           { id:'ship_yw1',  name:'Gold Leader',     fleetId:'fleet_rep', position:{x:146,y:280,z:3}, heading:0 }, createShipFn),
    instantiatePreset('gunship',         { id:'ship_gs1',  name:'Hammer 1',        fleetId:'fleet_rep', position:{x:140,y:296,z:2}, heading:0 }, createShipFn),
    // ─── Separatists (right side) — use droid fighters ────────────────
    instantiatePreset('providence',      { id:'ship_isd',  name:'Invisible Hand',  fleetId:'fleet_sep', position:{x:330,y:230,z:3}, heading:Math.PI }, createShipFn),
    instantiatePreset('frigate_assault', { id:'ship_fa1',  name:'Malevolence',     fleetId:'fleet_sep', position:{x:336,y:264,z:3}, heading:Math.PI }, createShipFn),
    instantiatePreset('vulture_droid',   { id:'ship_vd1',  name:'Droid-1',         fleetId:'fleet_sep', position:{x:330,y:210,z:2}, heading:Math.PI }, createShipFn),
    instantiatePreset('vulture_droid',   { id:'ship_vd2',  name:'Droid-2',         fleetId:'fleet_sep', position:{x:330,y:220,z:2}, heading:Math.PI }, createShipFn),
    instantiatePreset('vulture_droid',   { id:'ship_vd3',  name:'Droid-3',         fleetId:'fleet_sep', position:{x:334,y:240,z:2}, heading:Math.PI }, createShipFn),
    // Separatist bomber — Vulture Droid in strafing/bombing config
    instantiatePreset('vulture_droid',   { id:'ship_vb1',  name:'Droid Bomber',    fleetId:'fleet_sep', position:{x:326,y:260,z:4}, heading:Math.PI }, createShipFn),
  ];

  // Initial AI behaviors
  const set = (id, beh) => { const s = ships.find(x=>x.id===id); if(s) s.behavior = beh; };
  const B = (mode, extra={}) => ({ mode, radius:80, targetId:null, points:[], patrolIndex:0, attackedBy:null, distance:3, authorizedFleets:[], ...extra });
  ships.filter(s=>s.fleetId==='fleet_rep').forEach(s=>{ s.behavior = B('aggressive'); });
  ships.filter(s=>s.fleetId==='fleet_sep').forEach(s=>{ s.behavior = B('aggressive'); });
  const allFleets = [fleetRepublic, fleetSeparate];
  const diplomacy = {};
  allFleets.forEach(a => { diplomacy[a.fleetId] = {}; allFleets.forEach(b => { if (a.fleetId !== b.fleetId) diplomacy[a.fleetId][b.fleetId] = 'conflict'; }); });
  return createScenarioFn({ name: 'Battle of Coruscant', ships, fleets: allFleets, diplomacy });
}
