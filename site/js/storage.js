/**
 * STORAGE — localStorage persistence layer
 *
 * Centralizes all localStorage access.
 * All keys are prefixed with 'sts:' (Space Tactics Simulator).
 */

const PREFIX = 'sts:';

const KEYS = {
  classes:   PREFIX + 'shipClasses',
  fleets:    PREFIX + 'fleets',
  scenarios: PREFIX + 'scenarios',
  replays:   PREFIX + 'replays',
  settings:  PREFIX + 'settings',
};

/** Serializes and saves an object */
function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('[Storage] Save failed for key:', key, e);
    return false;
  }
}

/** Loads and deserializes an object */
function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('[Storage] Load failed for key:', key, e);
    return fallback;
  }
}

// ═══════════════════════════════════════════════════════
// SHIP CLASSES
// ═══════════════════════════════════════════════════════

export function saveShipClasses(classes) {
  return save(KEYS.classes, classes);
}
export function loadShipClasses() {
  return load(KEYS.classes, []);
}

// ═══════════════════════════════════════════════════════
// FLEETS
// ═══════════════════════════════════════════════════════

export function saveFleets(fleets) {
  return save(KEYS.fleets, fleets);
}
export function loadFleets() {
  return load(KEYS.fleets, []);
}

// ═══════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════

export function saveScenarios(scenarios) {
  return save(KEYS.scenarios, scenarios);
}
export function loadScenarios() {
  return load(KEYS.scenarios, []);
}

/** Saves or updates a scenario by ID */
export function upsertScenario(scenario, allScenarios) {
  const idx = allScenarios.findIndex(s => s.scenarioId === scenario.scenarioId);
  if (idx >= 0) allScenarios[idx] = scenario;
  else allScenarios.push(scenario);
  saveScenarios(allScenarios);
  return allScenarios;
}

// ═══════════════════════════════════════════════════════
// REPLAYS
// ═══════════════════════════════════════════════════════

export function saveReplays(replays) {
  return save(KEYS.replays, replays);
}
export function loadReplays() {
  return load(KEYS.replays, []);
}

/** Prepends a replay to the list (newest first) */
export function addReplay(replay, allReplays) {
  allReplays.unshift(replay);
  // Keep at most 10 saved replays
  if (allReplays.length > 10) allReplays.pop();
  saveReplays(allReplays);
  return allReplays;
}

/** Removes a replay by battleId */
export function deleteReplay(battleId, allReplays) {
  const filtered = allReplays.filter(r => r.battleId !== battleId);
  saveReplays(filtered);
  return filtered;
}

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════

export function saveSettings(settings) {
  return save(KEYS.settings, settings);
}
export function loadSettings() {
  return load(KEYS.settings, {
    defaultTickRate:   10,
    showCoords:        true,
    keyboardLayout:    'azerty',  // 'azerty' | 'qwerty'
  });
}

// ═══════════════════════════════════════════════════════
// RESET (debug utility)
// ═══════════════════════════════════════════════════════

export function resetAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  console.info('[Storage] All data cleared.');
}

// ═══════════════════════════════════════════════════════
// SHIP & FLEET LIBRARY (persistent templates)
// ═══════════════════════════════════════════════════════

/** Ship template: a configured ship NOT yet placed on the battlefield */
export function loadShipLibrary() {
  try { return JSON.parse(localStorage.getItem('sts:shipLib') || '[]'); } catch { return []; }
}
export function saveShipLibrary(lib) {
  try { localStorage.setItem('sts:shipLib', JSON.stringify(lib)); } catch {}
}

/** Fleet template: a named collection of ship templates */
export function loadFleetLibrary() {
  try { return JSON.parse(localStorage.getItem('sts:fleetLib') || '[]'); } catch { return []; }
}
export function saveFleetLibrary(lib) {
  try { localStorage.setItem('sts:fleetLib', JSON.stringify(lib)); } catch {}
}

// ═══════════════════════════════════════════════════════
// PRESET FLEET LIBRARY — Populated on first load if empty
// ═══════════════════════════════════════════════════════

export const PRESET_FLEETS = [
  // ── FLOTTE DE LA RÉPUBLIQUE ─────────────────────────────
  // Mélange réaliste : masse de clones standards + renforts élites (ARC, Heavy)
  // Jedi sur le Resolute (Anakin/Obi-Wan), médic sur le Pelta
  {
    id: 'preset_republic',
    name: 'Flotte de la République',
    colorIndex: 0,
    ships: [
      { classId:'cruiser',    name:'Resolute',             qty:1, pilotType:'clone_commander', pilotLevel:4,
        troops:[{type:'clone',count:1200,willFight:true},{type:'clone_arc',count:40,willFight:true},
                {type:'clone_heavy',count:80,willFight:true},{type:'jedi',count:2,willFight:true}] },
      { classId:'acclamator', name:'Acier de Coruscant',   qty:1, pilotType:'clone_commander', pilotLevel:3,
        troops:[{type:'clone',count:8000,willFight:true},{type:'clone_arc',count:120,willFight:true},
                {type:'clone_commando',count:8,willFight:true},{type:'clone_heavy',count:200,willFight:true}] },
      { classId:'acclamator', name:'Force de Kamino',      qty:1, pilotType:'clone_commander', pilotLevel:2,
        troops:[{type:'clone',count:7000,willFight:true},{type:'clone_shock',count:300,willFight:true},
                {type:'clone_medic',count:100,willFight:true}] },
      { classId:'pelta',      name:'Pelta Médical',        qty:1, pilotType:'clone', pilotLevel:2,
        troops:[{type:'clone',count:150,willFight:true},{type:'clone_medic',count:50,willFight:false}] },
      { classId:'arc170',     name:'Red Squadron',         qty:6,  pilotType:'clone', pilotLevel:2, inventory:{torpedoes:6} },
      { classId:'ywing',      name:'Gold Squadron',        qty:4,  pilotType:'clone', pilotLevel:2, inventory:{torpedoes:8,bombs:4} },
      { classId:'v19',        name:'Blue Escort',          qty:12, pilotType:'clone', pilotLevel:1 },
      { classId:'gunship',    name:'LAAT Gunship',         qty:8,  pilotType:'clone', pilotLevel:2,
        troops:[{type:'clone',count:20,willFight:true},{type:'clone_arc',count:4,willFight:true}] },
      { classId:'eta_shuttle',name:'Navette Jedi',         qty:2,  pilotType:'clone', pilotLevel:2,
        troops:[{type:'jedi',count:1,willFight:true},{type:'clone',count:6,willFight:true}] },
      { classId:'consular',   name:'Consular Diplomatique',qty:1,  pilotType:'clone', pilotLevel:1 },
    ]
  },

  // ── CONFÉDÉRATION DES SYSTÈMES INDÉPENDANTS ─────────────
  // Masse de B1 renforcée par B2, Commandos BX, et MagnaGardes escortes des officiers
  // Quelques Droids Araignée sur les gros vaisseaux (artillerie mobile)
  {
    id: 'preset_separatist',
    name: 'Confédération des Systèmes Indépendants',
    colorIndex: 1,
    ships: [
      { classId:'providence',      name:'Main Invisible',      qty:1,  pilotType:'droid_captain', pilotLevel:3,
        troops:[{type:'droid',count:35000,willFight:true},{type:'droid_b2',count:1000,willFight:true},
                {type:'magnaguard',count:6,willFight:true},{type:'droid_commando',count:50,willFight:true},
                {type:'droid_spider',count:4,willFight:true}] },
      { classId:'recusant',        name:'Recusant CIS',        qty:2,  pilotType:'droid_captain', pilotLevel:1,
        troops:[{type:'droid',count:25000,willFight:true},{type:'droid_b2',count:500,willFight:true},
                {type:'droid_nrn',count:20,willFight:true}] },
      { classId:'frigate_assault', name:'Banquier de Muun',    qty:1,  pilotType:'droid_captain', pilotLevel:2,
        troops:[{type:'droid',count:3000,willFight:true},{type:'droid_b2',count:200,willFight:true},
                {type:'droid_commando',count:12,willFight:true}] },
      { classId:'hardcell',        name:'Transport Droïde',    qty:2,  pilotType:'droid_integrated', pilotLevel:1,
        troops:[{type:'droid',count:5000,willFight:true},{type:'droid_b2',count:300,willFight:true}] },
      { classId:'vulture_droid',   name:'Escadron Vautour',    qty:24, pilotType:'droid_integrated',          pilotLevel:1 },
      { classId:'hyena',           name:'Bombardier Hyena',    qty:12, pilotType:'droid_integrated',          pilotLevel:2 },
      { classId:'tri_droid',       name:'Tri-chasseur Avancé', qty:8,  pilotType:'droid_integrated_advanced', pilotLevel:3 },
      { classId:'hmp_gunship',     name:'Canonnière HMP',      qty:4,  pilotType:'droid_integrated',          pilotLevel:1 },
      { classId:'sheathipede',     name:'Navette Ambassade',   qty:1,  pilotType:'droid_captain',             pilotLevel:1 },
    ]
  },

  // ── EMPIRE GALACTIQUE ────────────────────────────────────
  // Stormtroopers renforcés par Death Troopers (ISB), Royal Guards escortent l'officier
  // Scout Troopers pour la reconnaissance
  {
    id: 'preset_empire',
    name: 'Empire Galactique',
    colorIndex: 2,
    ships: [
      { classId:'destroyer', name:'Devastator (ISD-I)', qty:1, pilotType:'imperial', pilotLevel:4,
        troops:[{type:'stormtrooper',count:6000,willFight:true},{type:'death_trooper',count:100,willFight:true},
                {type:'scout_trooper',count:200,willFight:true},{type:'royal_guard',count:8,willFight:true}] },
      { classId:'imp2',      name:'Tyrannie (ISD-II)',  qty:1, pilotType:'imperial', pilotLevel:3,
        troops:[{type:'stormtrooper',count:6000,willFight:true},{type:'death_trooper',count:80,willFight:true},
                {type:'snowtrooper',count:200,willFight:true}] },
      { classId:'arquitens',       name:'Arquitens Croiseur',  qty:2, pilotType:'imperial', pilotLevel:2,
        troops:[{type:'stormtrooper',count:80,willFight:true},{type:'scout_trooper',count:20,willFight:true}] },
      { classId:'raider_corvette', name:'Raider Corvette',     qty:1, pilotType:'imperial', pilotLevel:3,
        troops:[{type:'death_trooper',count:30,willFight:true}] },
      { classId:'gozanti_imperial',name:'Gozanti Imperial',   qty:2, pilotType:'imperial', pilotLevel:1 },
      { classId:'tie_ln',          name:'Escadron TIE',        qty:24, pilotType:'imperial', pilotLevel:1 },
      { classId:'tie_int',         name:'TIE Intercepteur',    qty:12, pilotType:'imperial', pilotLevel:2 },
      { classId:'tie_bomber',      name:'Escadron Bombardier', qty:8,  pilotType:'imperial', pilotLevel:2 },
      { classId:'tie_defender',    name:'Défenseur d\'élite',  qty:4,  pilotType:'imperial', pilotLevel:4 },
      { classId:'lambda',          name:'Navette Lambda',      qty:2,  pilotType:'imperial', pilotLevel:2 },
    ]
  },

  // ── ALLIANCE REBELLE ─────────────────────────────────────
  // Mix rebelles standard + Pathfinders (Endor-style) + quelques SpecForces
  // Wookiees sur le Home One (Kashyyyk diaspora)
  {
    id: 'preset_rebel',
    name: 'Alliance Rebelle',
    colorIndex: 5,
    ships: [
      { classId:'mc80',           name:'Home One',          qty:1, pilotType:'rebel', pilotLevel:4,
        troops:[{type:'rebel',count:600,willFight:true},{type:'rebel_pathfinder',count:80,willFight:true},
                {type:'specforce',count:40,willFight:true},{type:'wookiee',count:20,willFight:true},
                {type:'civilian',count:100,willFight:false}] },
      { classId:'mc75',           name:'Profundity',        qty:1, pilotType:'rebel', pilotLevel:3,
        troops:[{type:'rebel',count:500,willFight:true},{type:'rebel_pathfinder',count:50,willFight:true}] },
      { classId:'corvette',       name:'Tantive IV',        qty:2, pilotType:'rebel', pilotLevel:2,
        troops:[{type:'rebel',count:30,willFight:true},{type:'senate_guard',count:10,willFight:true}] },
      { classId:'hammerhead',     name:'Hammerhead Corvette',qty:1, pilotType:'rebel', pilotLevel:2 },
      { classId:'frigate_medical',name:'Nebulon-B Médical', qty:1, pilotType:'rebel', pilotLevel:2 },
      { classId:'gr75',           name:'Transport Rebelle', qty:2, pilotType:'rebel', pilotLevel:1,
        troops:[{type:'rebel',count:40,willFight:true},{type:'civilian',count:60,willFight:false}] },
      { classId:'xwing',          name:'Escadron Rouge',    qty:8, pilotType:'rebel', pilotLevel:3, inventory:{torpedoes:6} },
      { classId:'ywing',          name:'Escadron Or',       qty:6, pilotType:'rebel', pilotLevel:2, inventory:{torpedoes:8,bombs:4} },
      { classId:'awing',          name:'Escadron Vert',     qty:4, pilotType:'rebel', pilotLevel:3 },
      { classId:'bwing',          name:'B-Wing Assaut',     qty:4, pilotType:'rebel', pilotLevel:3, inventory:{torpedoes:8} },
      { classId:'ghost',          name:'Le Fantôme',        qty:1, pilotType:'rebel', pilotLevel:3,
        troops:[{type:'rebel',count:5,willFight:true}] },
    ]
  },

  // ── COALISÉS MANDALORIENS ────────────────────────────────
  // Guerriers Mandaloriens (beskar) + Supercommandos Death Watch
  // Night Owls de Bo-Katan
  {
    id: 'preset_mandalorian',
    name: 'Coalisés Mandaloriens',
    colorIndex: 4,
    ships: [
      { classId:'razor_crest', name:'Razor Crest',         qty:1, pilotType:'bounty_hunter', pilotLevel:4,
        namedCharacter:{ enabled:true, name:'Din Djarin', performance:15, plotArmor:true, _savesMade:0 },
        troops:[{type:'mandalorian',count:1,willFight:true}] },
      { classId:'n1_mod',      name:'N-1 Modifié',         qty:1, pilotType:'bounty_hunter', pilotLevel:4,
        namedCharacter:{ enabled:true, name:'Din Djarin (N-1)', performance:14, plotArmor:true, _savesMade:0 } },
      { classId:'gauntlet',    name:'Gauntlet Épée Noire', qty:1, pilotType:'bounty_hunter', pilotLevel:4,
        namedCharacter:{ enabled:true, name:'Bo-Katan Kryze', performance:13, plotArmor:true, _savesMade:0 },
        troops:[{type:'night_owl',count:6,willFight:true}] },
      { classId:'komrk',       name:'Kom\'rk Warrior',     qty:3, pilotType:'bounty_hunter', pilotLevel:3,
        troops:[{type:'mandalorian',count:12,willFight:true},{type:'mandalorian_elite',count:4,willFight:true}] },
      { classId:'fang',        name:'Fang Fighter',        qty:12, pilotType:'bounty_hunter', pilotLevel:3 },
      { classId:'cumulus_c',   name:'Corsaire Pirate',     qty:1, pilotType:'pirate', pilotLevel:2,
        troops:[{type:'mandalorian',count:8,willFight:true}] },
    ]
  },

  // ── SYNDICAT DU CRIME / PIRATES ──────────────────────────
  // Pirates + Bounty Hunters + Gamorreans (gardes Hutt)
  {
    id: 'preset_pirates',
    name: 'Syndicat du Crime / Pirates',
    colorIndex: 7,
    ships: [
      { classId:'cumulus_c',    name:'C.S.S. Gorian Shard', qty:1, pilotType:'pirate', pilotLevel:3,
        namedCharacter:{ enabled:true, name:'Gorian Shard', performance:10, plotArmor:false, _savesMade:0 },
        troops:[{type:'pirate',count:80,willFight:true},{type:'gamorrean',count:20,willFight:true}] },
      { classId:'f3vara',       name:'F3-Vara Pirate',      qty:10, pilotType:'pirate', pilotLevel:2 },
      { classId:'gozanti_croc', name:'C-ROC Contrebande',   qty:2,  pilotType:'pirate', pilotLevel:2,
        troops:[{type:'pirate',count:40,willFight:true},{type:'smuggler',count:10,willFight:true}] },
      { classId:'z95',          name:'Z-95 Headhunter',     qty:8,  pilotType:'pirate', pilotLevel:1 },
      { classId:'kihraxz',      name:'Kihraxz Assault',     qty:5,  pilotType:'pirate', pilotLevel:2 },
      { classId:'firespray',    name:'Chasseur de primes',  qty:2,  pilotType:'bounty_hunter', pilotLevel:3,
        troops:[{type:'bounty_hunter',count:1,willFight:true}] },
    ]
  },

  // ── NOUVELLE RÉPUBLIQUE ──────────────────────────────────
  // SpecForces NR + Pathfinders + quelques Mandaloriens alliés (Mando alliance)
  {
    id: 'preset_new_republic',
    name: 'Nouvelle République',
    colorIndex: 0,
    ships: [
      { classId:'mc80',     name:'Croiseur Nouveau',  qty:1, pilotType:'rebel', pilotLevel:3,
        troops:[{type:'rebel',count:300,willFight:true},{type:'specforce',count:80,willFight:true},
                {type:'rebel_pathfinder',count:50,willFight:true}] },
      { classId:'corvette', name:'CR90 Patrouille',   qty:2, pilotType:'rebel', pilotLevel:2,
        troops:[{type:'rebel',count:20,willFight:true},{type:'specforce',count:10,willFight:true}] },
      { classId:'xwing',    name:'Escadron Rapace',   qty:8, pilotType:'rebel', pilotLevel:3, inventory:{torpedoes:6} },
      { classId:'awing',    name:'Escadron Spectre',  qty:6, pilotType:'rebel', pilotLevel:3 },
      { classId:'rp82_shin',name:'RP82 Garde',        qty:4, pilotType:'imperial', pilotLevel:2 },
    ]
  },

  // ── BATAILLE DE CORUSCANT — RÉPUBLIQUE (RotS) ────────────
  // Maximum d'élites pour la crise ultime : ARC Troopers, Commandos, Clone Shock
  {
    id: 'preset_coruscant_rep',
    name: 'République — Bataille de Coruscant',
    colorIndex: 0,
    ships: [
      { classId:'cruiser', name:'Resolute',      qty:1, pilotType:'clone_commander', pilotLevel:5,
        troops:[{type:'clone',count:1400,willFight:true},{type:'clone_arc',count:80,willFight:true},
                {type:'clone_shock',count:100,willFight:true},{type:'jedi',count:3,willFight:true}] },
      { classId:'cruiser', name:'Négociateur',   qty:1, pilotType:'clone_commander', pilotLevel:4,
        troops:[{type:'clone',count:1200,willFight:true},{type:'clone_arc',count:60,willFight:true},
                {type:'clone_heavy',count:80,willFight:true},{type:'jedi',count:2,willFight:true}] },
      { classId:'cruiser', name:'Invisible',     qty:1, pilotType:'clone_commander', pilotLevel:3,
        troops:[{type:'clone',count:1000,willFight:true},{type:'clone_commando',count:4,willFight:true}] },
      { classId:'acclamator', name:'Acclamator de Force', qty:2, pilotType:'clone_commander', pilotLevel:3,
        troops:[{type:'clone',count:10000,willFight:true},{type:'clone_arc',count:200,willFight:true},
                {type:'clone_heavy',count:400,willFight:true},{type:'clone_commando',count:16,willFight:true}] },
      { classId:'arc170',  name:'Red Squadron',  qty:12, pilotType:'clone', pilotLevel:3, inventory:{torpedoes:6} },
      { classId:'v19',     name:'Blue Wing',     qty:18, pilotType:'clone', pilotLevel:2 },
      { classId:'eta2',    name:'Eta-2 Jedi',    qty:4,  pilotType:'jedi',  pilotLevel:5 },
      { classId:'gunship', name:'LAAT Clone',    qty:12, pilotType:'clone', pilotLevel:2,
        troops:[{type:'clone',count:16,willFight:true},{type:'clone_arc',count:4,willFight:true},{type:'clone_heavy',count:4,willFight:true}] },
    ]
  },

  // ── BATAILLE DE CORUSCANT — CIS (RotS) ──────────────────
  // Masse de B1 + B2 + Commandos BX + MagnaGardes escorte Grievous
  // Droids Araignée sur les vaisseaux lourds (artillerie anti-abordage)
  {
    id: 'preset_coruscant_sep',
    name: 'CIS — Bataille de Coruscant',
    colorIndex: 1,
    ships: [
      { classId:'providence', name:'Invisible Hand',   qty:1, pilotType:'droid_captain', pilotLevel:4,
        troops:[{type:'droid',count:35000,willFight:true},{type:'droid_b2',count:2000,willFight:true},
                {type:'droid_commando',count:100,willFight:true},{type:'magnaguard',count:8,willFight:true},
                {type:'droid_spider',count:6,willFight:true}] },
      { classId:'providence', name:'Amiral Invincible', qty:1, pilotType:'droid_captain', pilotLevel:3,
        troops:[{type:'droid',count:30000,willFight:true},{type:'droid_b2',count:1500,willFight:true},
                {type:'magnaguard',count:4,willFight:true},{type:'droid_nrn',count:10,willFight:true}] },
      { classId:'recusant',        name:'Recusant Avant-Garde', qty:4, pilotType:'droid_captain', pilotLevel:2,
        troops:[{type:'droid',count:20000,willFight:true},{type:'droid_b2',count:800,willFight:true},
                {type:'droid_commando',count:30,willFight:true}] },
      { classId:'frigate_assault', name:'Frégate Bancaire',     qty:3, pilotType:'droid_captain', pilotLevel:2,
        troops:[{type:'droid',count:2500,willFight:true},{type:'droid_b2',count:300,willFight:true}] },
      { classId:'vulture_droid',   name:'Vautour CIS',          qty:30, pilotType:'droid_integrated',          pilotLevel:1 },
      { classId:'tri_droid',       name:'Tri-Chasseur',         qty:12, pilotType:'droid_integrated_advanced', pilotLevel:3 },
      { classId:'hyena',           name:'Hyena Bombers',        qty:10, pilotType:'droid_integrated',          pilotLevel:2 },
      { classId:'hmp_gunship',     name:'Gunship HMP',          qty:6,  pilotType:'droid_integrated',          pilotLevel:1 },
    ]
  },

  // ── EMPIRE — FLOTTE D'OCCUPATION ────────────────────────
  // Dark Troopers Phase III en réserve + Death Troopers ISB + Royal Guards VIP
  {
    id: 'preset_galactic_empire',
    name: 'Empire — Flotte d\'Occupation',
    colorIndex: 2,
    ships: [
      { classId:'imp2',      name:'Executor II',   qty:1, pilotType:'imperial', pilotLevel:5,
        troops:[{type:'stormtrooper',count:7000,willFight:true},{type:'death_trooper',count:150,willFight:true},
                {type:'dark_trooper',count:20,willFight:true},{type:'royal_guard',count:6,willFight:true},
                {type:'bounty_hunter',count:10,willFight:true}] },
      { classId:'destroyer', name:'Devastator',    qty:2, pilotType:'imperial', pilotLevel:4,
        troops:[{type:'stormtrooper',count:6000,willFight:true},{type:'death_trooper',count:80,willFight:true},
                {type:'scout_trooper',count:200,willFight:true}] },
      { classId:'interdictor',     name:'Intercessor',          qty:1, pilotType:'imperial', pilotLevel:3,
        troops:[{type:'stormtrooper',count:2500,willFight:true},{type:'snowtrooper',count:200,willFight:true}] },
      { classId:'nebulon_b2',      name:'Nebulon-B2',           qty:2, pilotType:'imperial', pilotLevel:2 },
      { classId:'arquitens',       name:'Croiseur Léger',       qty:3, pilotType:'imperial', pilotLevel:2,
        troops:[{type:'stormtrooper',count:80,willFight:true},{type:'compforce',count:40,willFight:true}] },
      { classId:'tie_ln',          name:'Escadron Death',       qty:24, pilotType:'imperial', pilotLevel:1 },
      { classId:'tie_int',         name:'Escadron Intercepteur',qty:12, pilotType:'imperial', pilotLevel:3 },
      { classId:'tie_bomber',      name:'Escadron Bombardier',  qty:8,  pilotType:'imperial', pilotLevel:2 },
      { classId:'tie_defender',    name:'Défenseur d\'Élite',   qty:4,  pilotType:'imperial', pilotLevel:5 },
      { classId:'lambda',          name:'Navette Impériale',    qty:3,  pilotType:'imperial', pilotLevel:2 },
      { classId:'gozanti_imperial',name:'Gozanti Patrouille',   qty:4,  pilotType:'imperial', pilotLevel:1 },
    ]
  },

  // ── THE MANDALORIAN — ERE IMPÉRIALE RÉSIDUELLE ────────────
  // Moff Gideon (Arquitens) + Dark Troopers Phase III en cargo secret
  // Death Troopers ISB comme élite personnelle, compforce pour la masse
  {
    id: 'preset_moff_gideon',
    name: 'Moff Gideon — Rémanence Impériale',
    colorIndex: 6,
    ships: [
      { classId:'arquitens', name:'Vaisseau de Gideon', qty:1, pilotType:'imperial', pilotLevel:5,
        troops:[{type:'death_trooper',count:30,willFight:true},{type:'dark_trooper',count:8,willFight:true},
                {type:'stormtrooper',count:120,willFight:true},{type:'bounty_hunter',count:3,willFight:true}] },
      { classId:'gozanti_imperial', name:'Gozanti Bouclier', qty:2, pilotType:'imperial', pilotLevel:2,
        troops:[{type:'stormtrooper',count:30,willFight:true},{type:'compforce',count:20,willFight:true}] },
      { classId:'tie_out',  name:'TIE Outland',  qty:8, pilotType:'imperial', pilotLevel:2 },
      { classId:'rp82',     name:'Fiend Garde',  qty:4, pilotType:'imperial', pilotLevel:2 },
      { classId:'lambda',   name:'Navette Sombre',qty:1, pilotType:'imperial', pilotLevel:3,
        troops:[{type:'death_trooper',count:8,willFight:true},{type:'stormtrooper',count:12,willFight:true}] },
    ]
  },

  // ── CARTEL HUTT ──────────────────────────────────────────
  // Pirates + Gamorreans (gardes Jabba) + contrebandiers + quelques Wookiees esclaves libérés
  // Jango Fett avec ses Mandalorian elite (pre-Clone Wars)
  {
    id: 'preset_hutt_cartel',
    name: 'Cartel Hutt',
    colorIndex: 7,
    ships: [
      { classId:'eravana', name:'Fondor', qty:1, pilotType:'smuggler', pilotLevel:3,
        troops:[{type:'pirate',count:100,willFight:true},{type:'gamorrean',count:40,willFight:true},
                {type:'smuggler',count:30,willFight:true},{type:'civilian',count:40,willFight:false}] },
      { classId:'gozanti_croc', name:'C-ROC Fer Brisé', qty:2, pilotType:'pirate', pilotLevel:2,
        troops:[{type:'pirate',count:60,willFight:true},{type:'gamorrean',count:15,willFight:true}] },
      { classId:'gozanti_croc', name:'C-ROC Vengeance Noire', qty:1, pilotType:'pirate', pilotLevel:3,
        troops:[{type:'pirate',count:80,willFight:true},{type:'bounty_hunter',count:3,willFight:true},
                {type:'wookiee',count:4,willFight:true}] },
      { classId:'z95',      name:'Headhunter Hutt',  qty:8, pilotType:'pirate', pilotLevel:1 },
      { classId:'kihraxz',  name:'Kihraxz Assaut',   qty:4, pilotType:'pirate', pilotLevel:2 },
      { classId:'firespray',name:'Chasseur de Primes',qty:2, pilotType:'bounty_hunter', pilotLevel:4,
        troops:[{type:'bounty_hunter',count:1,willFight:true}] },
      { classId:'slave1', name:'Slave I', qty:1, pilotType:'bounty_hunter', pilotLevel:5,
        namedCharacter:{enabled:true, name:'Jango Fett', performance:18, plotArmor:true, _savesMade:0},
        troops:[{type:'mandalorian_elite',count:2,willFight:true}] },
      { classId:'yt1300', name:'YT-1300 Contrebande', qty:3, pilotType:'smuggler', pilotLevel:2,
        troops:[{type:'smuggler',count:4,willFight:true}] },
    ]
  },

  // ── FORCE OPÉRATIONNELLE JEDI ────────────────────────────
  // Clone Commandos escortent les Jedi (missions critiques)
  // Clone ARF en éclaireurs, ARC comme garde rapprochée des Maîtres
  // Gardes Sénatoriaux sur le Tantive (mission diplomatique)
  {
    id: 'preset_jedi_task_force',
    name: 'Force Opérationnelle Jedi',
    colorIndex: 0,
    ships: [
      { classId:'consular', name:'Croiseur de Paix', qty:2, pilotType:'clone', pilotLevel:2,
        troops:[{type:'clone',count:60,willFight:true},{type:'clone_arc',count:8,willFight:true},
                {type:'clone_commando',count:2,willFight:true},{type:'jedi',count:3,willFight:true}] },
      { classId:'corvette', name:'Tantive Diplomatique', qty:1, pilotType:'clone', pilotLevel:2,
        troops:[{type:'senate_guard',count:15,willFight:true},{type:'clone_shock',count:10,willFight:true},
                {type:'civilian',count:25,willFight:false}] },
      { classId:'delta7',      name:'Eta-2 Maître',  qty:4, pilotType:'jedi',  pilotLevel:5 },
      { classId:'arc170',      name:'Escorte Clone', qty:6, pilotType:'clone', pilotLevel:3, inventory:{torpedoes:6} },
      { classId:'eta_shuttle', name:'Navette Jedi',  qty:2, pilotType:'jedi',  pilotLevel:3,
        troops:[{type:'jedi',count:2,willFight:true},{type:'clone_arc',count:4,willFight:true},
                {type:'clone_commando',count:1,willFight:true}] },
    ]
  },
];

/**
 * Synchronise la bibliothèque de flottes avec les presets.
 * - Si la lib est vide → inject tous les presets.
 * - Si la lib existe → ajoute les presets manquants (par id) sans écraser les custom.
 * - Force-remplace les presets existants si leur définition a changé (version bump).
 *   Cela permet de livrer de nouvelles compositions de troupes sans demander un reset manuel.
 */
export function ensurePresetFleets() {
  try {
    const lib = JSON.parse(localStorage.getItem('sts:fleetLib') || '[]');
    const presetIds = new Set(PRESET_FLEETS.map(p => p.id));

    if (lib.length === 0) {
      // Bibliothèque vide → injection complète
      localStorage.setItem('sts:fleetLib', JSON.stringify(PRESET_FLEETS));
      return;
    }

    // Mise à jour partielle : remplacer les presets existants + ajouter les nouveaux
    let changed = false;
    const updated = lib.map(entry => {
      if (presetIds.has(entry.id)) {
        // Remplacer par la version courante du preset (nouvelles troupes, nouveaux vaisseaux)
        changed = true;
        return PRESET_FLEETS.find(p => p.id === entry.id);
      }
      return entry; // Flottes custom : intouchables
    });
    // Ajouter les presets absents de la lib (nouvelles flottes ajoutées en cours de dev)
    for (const preset of PRESET_FLEETS) {
      if (!lib.find(e => e.id === preset.id)) {
        updated.push(preset);
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('sts:fleetLib', JSON.stringify(updated));
    }
  } catch {}
}
