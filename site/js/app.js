/**
 * APP — Main Orchestrator
 *
 * This is the JavaScript entry point.
 * It initializes all modules, connects them together,
 * and manages the game loop.
 *
 * Data flow:
 *
 *   GameState (shared object)
 *       │
 *       ├─ GameEngine.tick()   → modifies ships, projectiles, tick
 *       ├─ Renderer.render()   → reads state, draws the canvas
 *       ├─ UIManager           → reads state, updates panels
 *       ├─ EditorManager       → reads and modifies state (ships, fleets)
 *       ├─ ReplayRecorder      → reads state, records snapshots
 *       └─ NetworkClient       → reads and writes state (multiplayer mode)
 */

import CONFIG      from './config.js?v=20250617c';
import { clamp, dist2D, SHIP_HANGAR_VOLUME, CARGO_HOLD_VOLUME, MEDICAL_BAY_CAPACITY, BRIG_CAPACITY, CARGO_ENERGY_SIGNATURE, CARGO_IS_ORGANIC, SIGNATURE_LABELS } from './utils.js?v=20250617c';
import { createShip, createFleet, createScenario, CARGO_TYPES } from './models.js?v=20250617c';
import { buildDemoScenario, instantiatePreset, PRESET_CLASSES }    from './presets.js?v=20250617c';
import { GameEngine }           from './simulation.js?v=20250617c';
import { Renderer }             from './renderer.js?v=20250617c';
import { UIManager }            from './ui.js?v=20250617c';
import { EditorManager }        from './editor.js?v=20250617c';
import { ReplayRecorder, ReplayModal } from './replay.js?v=20250617c';
import { createDiplomacyMatrix, getDiplomacy, setDiplomacy, getFactionInviteUrl, generateFactionToken, readFactionFromUrl, VoteManager, FACTION_COLORS, FACTION_NAMES_DEFAULT, NEUTRAL_FACTION_INDEX } from './faction.js?v=20250617c';
import { SetupWizard, TERRAIN_PRESETS } from './setup.js?v=20250617c';
import SFX, { initSoundUI } from './sound.js?v=20250617c';
import { createBackground, drawBackground, drawSuperlaserBeam, SUN_PALETTES, PLANET_TYPES, STATION_TYPES, isStationType } from './background.js?v=20250617c';
import { initHost, connectToHost, getGameSnapshot, applyGameSnapshot, getLightState, applyLightState, shortCode } from './network.js?v=20250617c';
import { canDockTo, applyDock, applyUndock, initBoarding, tickBoarding, TROOP_TYPES, TROOP_MATCHUPS } from './boarding.js?v=20250617c';
import {
  loadShipClasses, loadFleets, loadScenarios, loadReplays,
  saveReplays, addReplay,
  loadShipLibrary, saveShipLibrary, loadFleetLibrary, saveFleetLibrary,
  ensurePresetFleets,
} from './storage.js?v=20250617c';

// Local clamp utility (must be after all imports)
// clamp is imported from utils.js

// ═══════════════════════════════════════════════════════
// GLOBAL STATE (GameState)
// ═══════════════════════════════════════════════════════

/**
 * The GameState is the central shared object for all modules.
 * It is the single source of truth for the current game session.
 *
 * Convention: only GameEngine modifies ships during ticks.
 * Other modules read only, except the editor (GM modifications).
 */
const GameState = {
  // exposed on window so editor can read live ship states for recall
  // see: editor.js _recall handler → window.GameState.ships
  ships:          [],
  fleets:         [],
  projectiles:    [],
  explosions:     [],
  scenarios:      [],
  diplomacy:      {},
  tick:           0,
  paused:         false,
  selectedShipId: null,
  pendingOrder:   null,
  lastTickTime:   Date.now(),
  tickInterval:   CONFIG.TICK_INTERVAL_MS,
  gmActiveFaction: null,
  hyperspaceRoutes: [],
  terrain:          null,
  terrainConfig:    null,
  activeFactions:   [], // [{ colorIndex, name }] populated by setup wizard
};
window.GameState = GameState; // expose for editor recall + P2P + debug

// ═══════════════════════════════════════════════════════
// MODULE INITIALIZATION
// ═══════════════════════════════════════════════════════

// ─── Core modules ────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new Renderer(canvas, GameState);
renderer._drawBackgroundFn = drawBackground;
renderer._drawSuperlaserFn = drawSuperlaserBeam;
if (!GameState.background) GameState.background = createBackground();

// Multi-selection state
GameState.selectedShipIds = []; // lasso-selected ship IDs

// Wire lasso callback
renderer._onLassoSelect = (ids) => {
  // Joueur P2P : ne sélectionner QUE les vaisseaux de sa faction
  const playerCi = window._p2pFactionCi ?? -1;
  const filtered = playerCi >= 0
    ? ids.filter(id => {
        const s = GameState.ships.find(x => x.id === id);
        if (!s) return false;
        const fl = GameState.fleets.find(f => f.fleetId === s.fleetId);
        return (fl?.colorIndex === playerCi) || (s._factionColorIndex === playerCi);
      })
    : ids;
  GameState.selectedShipIds = filtered;
  const count = filtered.length;

  // Surbrillance visuelle des vaisseaux sélectionnés (anneau sur le canvas)
  renderer.selectedShipIds = filtered;

  const multiPanel = document.getElementById('multi-select-panel');
  if (count >= 1 && multiPanel) {
    // Le panneau est imbriqué dans #ship-panel (caché par défaut). Plutôt que de
    // dépendre de la visibilité du parent, on le détache en OVERLAY flottant la
    // première fois — ainsi il s'affiche toujours, quel que soit l'état du parent.
    if (!multiPanel._floated) {
      document.body.appendChild(multiPanel); // sort de #ship-panel
      multiPanel._floated = true;
      multiPanel.style.cssText = 'position:fixed;top:60px;left:12px;z-index:1500;'
        + 'width:240px;max-height:calc(100vh - 80px);overflow-y:auto;'
        + 'background:#0a0f1d;border:1px solid #4a9eff;border-radius:8px;'
        + 'padding:10px;box-shadow:0 4px 20px #000c';
      // Bouton de fermeture
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#8aa;cursor:pointer;font-size:14px';
      closeBtn.onclick = () => {
        multiPanel.classList.add('hidden');
        GameState.selectedShipIds = [];
        renderer.selectedShipIds  = [];
      };
      multiPanel.insertBefore(closeBtn, multiPanel.firstChild);
    }
    multiPanel.classList.remove('hidden');
    multiPanel.style.display = 'block';
    document.getElementById('ms-count').textContent = count;

    // Apply behavior to all selected ships AND clear previous orders
    const applyToAll = (mode) => {
      filtered.forEach(id => _applyShipOrder({ action:'setBehavior', shipId:id, mode }));
      addLog(`📋 Ordre « ${mode} » → ${count} vaisseaux`, 'move');
    };

    const orderBtns = {
      'ms-order-move':    () => {
        GameState.pendingOrder = { type:'move', shipIds: filtered };
        addLog('🎯 Cliquer destination pour les ' + count + ' vaisseaux', 'move');
      },
      'ms-order-attack':  () => {
        GameState.pendingOrder = { type:'attack', shipIds: filtered };
        addLog('⚔️ Cliquer cible pour les ' + count + ' vaisseaux', 'move');
      },
      'ms-order-retreat': () => applyToAll('retreat'),
      'ms-order-fuir':    () => applyToAll('fuir'),
      'ms-order-embark':  () => applyToAll('embarquement'),
      'ms-order-passive': () => applyToAll('passive'),
      'ms-order-ecran':   () => {
        // Écran : seulement les XS/S de la sélection
        const fighters = filtered.filter(id => {
          const s = GameState.ships.find(x => x.id === id);
          return s && ['XS','S'].includes(s.size);
        });
        fighters.forEach(id => _applyShipOrder({ action:'setBehavior', shipId:id, mode:'ecran' }));
        addLog(`🛡 Écran → ${fighters.length} chasseurs`, 'move');
      },
      'ms-order-escort':  () => {
        GameState.pendingOrder = { type:'escort', shipIds: filtered };
        addLog('🛡 Cliquer le vaisseau à escorter (pour les ' + count + ')', 'move');
      },
      'ms-order-kamikaze': () => {
        GameState.pendingOrder = { type:'kamikaze', shipIds: filtered };
        addLog('☠ Cliquer la cible kamikaze (pour les ' + count + ')', 'move');
      },
    };
    // Use .onclick to replace any previous handler (avoids listener stacking)
    Object.entries(orderBtns).forEach(([id, fn]) => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = fn;
    });

    // Use .onchange to replace (avoid addEventListener stacking)
    const behaviorSel = document.getElementById('ms-behavior');
    if (behaviorSel) {
      behaviorSel.onchange = (e) => {
        filtered.forEach(id => _applyShipOrder({ action:'setBehavior', shipId:id, mode: e.target.value }));
        addLog(`📋 Comportement « ${e.target.value} » → ${count} vaisseaux`, 'move');
      };
    }

    const energySel = document.getElementById('ms-energy');
    if (energySel) {
      energySel.onchange = (e) => {
        filtered.forEach(id => {
          const s = GameState.ships.find(x => x.id === id);
          if (s) s.energyPolicy = e.target.value;
        });
      };
    }

    const cpSel = document.getElementById('ms-combat-policy');
    if (cpSel) {
      cpSel.onchange = (e) => {
        filtered.forEach(id => {
          const s = GameState.ships.find(x => x.id === id);
          if (s) {
            const delay = (s.pilotLevel || 1) >= 5 ? 2 : 3;
            s._pendingCombatPolicy = e.target.value;
            s._combatPolicyTimer   = delay;
          }
        });
        addLog(`⚙ Politique combat "${e.target.value}" → ${count} vaisseaux (transition ${(GameState.ships.find(s=>s.id===filtered[0])?.pilotLevel||1)>=5?2:3} ticks)`, 'move');
      };
    }

  } else {
    multiPanel?.classList.add('hidden');
    const indicator = document.getElementById('multi-select-count');
    if (indicator) {
      indicator.textContent = count > 1 ? `${count} vaisseaux sélectionnés` : '';
      indicator.style.display = count > 1 ? 'block' : 'none';
    }
    if (filtered.length > 0) {
      ui.updateSelectedShip(filtered[filtered.length - 1]);
    }
  }
};

let engine     = null; // initialized after scenario load
let recorder   = null;
let replays    = loadReplays();

const ui = new UIManager(GameState, {
  onOrderMove:      (shipId) => { GameState.pendingOrder = { type: 'move',    shipId }; },
  onOrderAttack:    (shipId) => { GameState.pendingOrder = { type: 'attack',  shipId }; },
  onOrderEscort:    (shipId) => { GameState.pendingOrder = { type: 'escort',  shipId }; },
  onOrderBombard:   (shipId) => { GameState.pendingOrder = { type: 'bombard', shipId }; },
  onOrderKamikaze:  (shipId) => { GameState.pendingOrder = { type: 'kamikaze',shipId }; },
  onScanShort: (scannerId, targetId) => {
    const scanner = GameState.ships.find(s => s.id === scannerId && s.alive);
    const target  = GameState.ships.find(s => s.id === targetId  && s.alive);
    if (!scanner || !target || !scanner.scanner) return;
    const d = Math.hypot(target.position.x - scanner.position.x, target.position.y - scanner.position.y);
    if (d > scanner.scanner) { showToast(`📡 Hors de portée (${d.toFixed(0)}c / portée ${scanner.scanner}c)`, false); return; }
    const DROID_T = new Set(['droid_integrated','droid_integrated_advanced','droid_captain']);
    const isDroid = DROID_T.has(target.pilotType);
    const hasCargo = (target.cargoHold||[]).length > 0;
    const pR = target._paxRoster || {};
    const organicCrew = isDroid ? 0 : (pR.crew?.human || (target.crewCount||0));
    const extraOrg = (target.woundedCount||0)+(target.captiveCount||0)+(pR.pax?.human||0);
    const totalOrg = organicCrew + extraOrg;
    const lifeStr = isDroid && totalOrg === 0
      ? '▱ Aucune (équipage mécanique)'
      : totalOrg > 0 ? `▰ ~${totalOrg} signal(s) organique(s)`
        : `▰ Présentes (~${({XS:1,S:'2-5',M:'5-25',L:'25-150',XL:'150-700',XXL:'700+'}[target.size]||'?')})`;
    const lines = [
      `📡 <b>Scan court</b> — ${target.name}`,
      `Cale : ${hasCargo ? '▰ Présente' : '▱ Vide'}`,
      `Formes de vie : ${lifeStr}`,
    ];
    target._scanResult = lines.join('<br>');
    target._scanLongTick = null; target._scanHpExact = null;
    addLog(`📡 Scan court ${target.name} : cale ${hasCargo?'chargée':'vide'}, vie : ${lifeStr}`, 'move');
    showToast(`📡 Scan court — ${target.name}`, true);
    ui.updateSelectedShip(targetId);
  },

  onScanLong: (scannerId, targetId) => {
    const scanner = GameState.ships.find(s => s.id === scannerId && s.alive);
    const target  = GameState.ships.find(s => s.id === targetId  && s.alive);
    if (!scanner || !target || !scanner.scanner) return;
    const d = Math.hypot(target.position.x - scanner.position.x, target.position.y - scanner.position.y);
    if (d > scanner.scanner) { showToast(`📡 Hors de portée (${d.toFixed(0)}c / portée ${scanner.scanner}c)`, false); return; }
    const DROID_T = new Set(['droid_integrated','droid_integrated_advanced','droid_captain']);
    const isDroid = DROID_T.has(target.pilotType);
    const hold = target.cargoHold || [];
    const totalVol = hold.reduce((s,c)=>s+(CARGO_TYPES[c.type]?.unitVolume||1)*c.count,0);
    const hasCargo = totalVol > 0;
    const maxSig = hold.reduce((m,c)=>Math.max(m,CARGO_ENERGY_SIGNATURE[c.type]??0),0);
    const allOrg = hold.length > 0 && hold.every(c=>CARGO_IS_ORGANIC[c.type]);
    const allMin = hold.length > 0 && hold.every(c=>!CARGO_IS_ORGANIC[c.type]);
    const nature = !hasCargo ? '—' : allOrg ? '🌿 Organique' : allMin ? '🪨 Minérale' : '⚗ Mixte';
    const sigLabel = SIGNATURE_LABELS[maxSig] ?? '—';
    const volLabel = !hasCargo ? 'Vide' : `~${Math.round(totalVol/(target.cargoVolume||1)*100)}%`;
    const pR = target._paxRoster || {};
    const organicCrew = isDroid ? 0 : (pR.crew?.human || (target.crewCount||0));
    const extraOrg = (target.woundedCount||0)+(target.captiveCount||0)+(pR.pax?.human||0);
    const totalOrg = organicCrew + extraOrg;
    const lifeStr = totalOrg === 0 ? 'Aucune (mécanique)' : `~${totalOrg} organique(s)`;
    target._scanHpExact  = target.hp;
    target._scanLongTick = GameState.tick;
    const hpPct = Math.round(100 * target.hp / (target.maxHp || 1));
    const lines = [
      `🔬 <b>Long scan</b> — ${target.name}`,
      `PV : ${Math.round(target.hp)}/${target.maxHp} (${hpPct}%) ⟨valide 10 ticks⟩`,
      `Cale : ${volLabel} · sig. ${sigLabel} · ${nature}`,
      `Formes de vie : ${lifeStr}`,
    ];
    target._scanResult = lines.join('<br>');
    addLog(`🔬 Long scan ${target.name} : PV ${Math.round(target.hp)}/${target.maxHp}, cale ${volLabel}`, 'move');
    showToast(`🔬 Long scan effectué — ${target.name}`, true)
    ui.updateSelectedShip(targetId);
  },

  onGMEditShip: (shipId) => { _openGMEditModal(shipId); },

  onInitBoarding: (attackerShipId, defenderShipId) => {
    const attacker = GameState.ships.find(s => s.id === attackerShipId && s.alive);
    const defender = GameState.ships.find(s => s.id === defenderShipId && s.alive);
    if (!attacker || !defender) return;
    // Utiliser les troupes typées qui veulent combattre
    const troops = (attacker._troops || []).filter(t => t.willFight !== false && t.count > 0);
    if (!troops.length) {
      showToast('Aucune troupe combattante à bord pour mener l\'abordage', false);
      return;
    }
    const result = initBoarding(attacker, defender, troops);
    if (!result.ok) { showToast(`⚔ Abordage impossible : ${result.reason}`, false); return; }
    defender._boardingState.phase = 'fighting';
    addLog(`⚔ Abordage initié : ${attacker.name} → ${defender.name} (${troops.reduce((s,t)=>s+t.count,0)} troupes)`, 'death');
    showToast(`⚔ Abordage lancé contre ${defender.name}`, true);
    ui.updateSelectedShip(attackerShipId);
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
  },

  onShieldToggle: (shipId) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship?.shields) return;
    if (ship.shields.current > 0 && !ship.shields.disabled) {
      // Couper les boucliers
      ship.shields._manualOff = true;
      ship.shields.disabled   = true;
      ship.shields.current    = 0;
      addLog(`🔒 ${ship.name} — boucliers coupés manuellement.`, 'move');
      showToast(`🔒 Boucliers de ${ship.name} coupés`, true);
    } else {
      // Rallumer
      ship.shields._manualOff  = false;
      ship.shields.disabled    = false;
      ship.shields.current     = Math.min(ship.shields.max, 1); // commence à recharger
      addLog(`🔓 ${ship.name} — boucliers rallumés.`, 'move');
      showToast(`🔓 Boucliers de ${ship.name} rallumés`, true);
    }
    ui.updateSelectedShip(shipId);
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
  },

  onUndock: (shipId) => {
    const ship   = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    if (window._p2pSendOrder) {
      window._p2pSendOrder({ type:'order', subtype:'undock', shipId });
      return;
    }
    _applyUndock(ship);
  },
  onCargoEject: (shipId) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship?.cargoEject || !ship.cargoHold?.length) return;
    if (window._p2pSendOrder) {
      window._p2pSendOrder({ type:'order', subtype:'cargoEject', shipId });
      showToast('📦 Demande d\'éjection envoyée…', true);
      return;
    }
    _applyCargoEject(ship);
  },
  onCargoAdd: (shipId, cargoType, count) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship || !cargoType) return;
    const unitVol = CARGO_TYPES[cargoType]?.unitVolume || 1;
    const used = (ship.cargoHold || []).reduce((s,c) => s + (CARGO_TYPES[c.type]?.unitVolume||1)*c.count, 0);
    const needed = unitVol * count;
    if (used + needed > (ship.cargoVolume || 0)) {
      addLog(`✖ Cale insuffisante (besoin ${needed}, restant ${Math.max(0,(ship.cargoVolume||0)-used)}).`, 'move');
      showToast(`Cale insuffisante (besoin ${needed}, restant ${Math.max(0,(ship.cargoVolume||0)-used)})`, false);
      return;
    }
    ship.cargoHold = ship.cargoHold || [];
    const existing = ship.cargoHold.find(c => c.type === cargoType);
    if (existing) existing.count += count;
    else ship.cargoHold.push({ type: cargoType, count });
    addLog(`📦 ${count}× ${CARGO_TYPES[cargoType]?.label || cargoType} chargé(s) sur ${ship.name}.`, 'move');
    showToast(`📦 ${count}× ${CARGO_TYPES[cargoType]?.label || cargoType} chargé(s)`, true);
    // Blur l'élément actif pour lever le guard anti-re-render, puis forcer l'update
    document.activeElement?.blur();
    ui.updateSelectedShip(shipId);
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
  },
  onCargoRemove: (shipId, ci, qty = null) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship?.cargoHold?.[ci]) return;
    const entry = ship.cargoHold[ci];
    const removeQty = Math.min(Math.max(1, qty ?? entry.count), entry.count);
    if (removeQty >= entry.count) {
      ship.cargoHold.splice(ci, 1);
    } else {
      entry.count -= removeQty;
    }
    const label = CARGO_TYPES[entry.type]?.label || entry.type;
    addLog(`🗑 ${removeQty}× ${label} retiré(s) de ${ship.name}.`, 'move');
    showToast(`🗑 ${removeQty}× ${label} retiré(s)`, true);
    document.activeElement?.blur();
    ui.updateSelectedShip(shipId);
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
  },
  onCargoTransferStart: (shipId, ci) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    const entry = ship?.cargoHold?.[ci];
    if (!ship || !entry) return;
    GameState.pendingOrder = { type: 'cargoTransfer', shipId, cargoIndex: ci };
    addLog(`↪ Cliquez le vaisseau destinataire pour transférer ${CARGO_TYPES[entry.type]?.label || entry.type} (×${entry.count}).`, 'move');
    showToast(`↪ Cliquez le vaisseau destinataire`, true);
  },
  onOrderCapture:   (shipId) => {
    GameState.pendingOrder = { type: 'capture', shipId };
    const s = GameState.ships.find(x => x.id === shipId);
    addLog(`🪝 ${s?.name || 'Vaisseau'} : cliquez le vaisseau ennemi à capturer (plus petit, vulnérable).`, 'move');
  },
  onOrderDockStation: (shipId) => {
    GameState.pendingOrder = { type: 'dockStation', shipId };
    const s = GameState.ships.find(x => x.id === shipId);
    addLog(`🛬 ${s?.name || 'Vaisseau'} : cliquez la planète ou station où atterrir.`, 'move');
    showToast('🛬 Cliquez une planète ou station pour y atterrir', true);
    renderer._bodyTargetMode = true;
    renderer._bodyTargetKind = 'station';
  },
  onOrderRetreat:   (shipId) => {
    if (!engine) return;
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    const isLeft = ship.position.x < CONFIG.GRID_COLS / 2;
    _applyShipOrder({ action:'moveTo', shipId, position:{ x: isLeft ? -2 : CONFIG.GRID_COLS + 2, y: ship.position.y, z: ship.position.z } });
    _applyShipOrder({ action:'setBehavior', shipId, mode:'passive' });
  },
  onOrderFuir: (shipId) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    _applyShipOrder({ action:'setBehavior', shipId, mode:'fuir' });
    addLog(`🌀 ${ship.name} → Fuite vers zone hyperespace`, 'move');
  },
  onOrderEmbark: (shipId) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    _applyShipOrder({ action:'setBehavior', shipId, mode:'embarquement' });
    addLog(`⚓ ${ship.name} → Embarquement sur transporteur`, 'move');
  },

  // ─── Fleet-level orders (single sub-fleet) ──────────────────
  onFleetOrder: (fleetId, order) => {
    // If client (player), forward order to host via P2P
    if (window._p2pSendOrder) {
      window._p2pSendOrder({ type: 'order', subtype: 'fleetOrder', fleetId, order });
      const labels = { aggressive:'⚔ Agressif', ecran:'🛡 Écran', neutral:'🤝 Neutre', passive:'⏸ Passif', retreat:'↩ Retraite' };
      addLog(`${labels[order]||order} → envoyé au MJ`, 'move');
      return;
    }
    const fleet = GameState.fleets.find(f => f.fleetId === fleetId);
    if (!fleet) return;
    const ships = GameState.ships.filter(s => s.alive && s.fleetId === fleetId);
    ships.forEach(s => {
      s.orders   = null;
      s._fuirJitterX = undefined;
      s._fuirJitterY = undefined;
      if (order === 'retreat') {
        const isLeft = s.position.x < CONFIG.GRID_COLS / 2;
        s.moveTarget = { x: isLeft ? -5 : CONFIG.GRID_COLS + 5, y: s.position.y, z: s.position.z };
        s.behavior   = { ...s.behavior, mode: 'passive' };
      } else {
        s.behavior = { ...s.behavior, mode: order };
      }
    });
    const labels = { aggressive:'⚔ Agressif', neutral:'🤝 Neutre', passive:'⏸ Passif', retreat:'↩ Retraite', fuir:'🌀 Fuir', embarquement:'⚓ Embarquer' };
    addLog(`${labels[order]||order} → ${fleet.name} (${ships.length} vaisseaux)`, 'move');
    ui.updateFleetList();
  },

  // ─── Faction-level orders (all sub-fleets under a faction) ──
  onFactionOrder: (fleetIds, order) => {
    // If client (player), forward to host via P2P
    if (window._p2pSendOrder) {
      window._p2pSendOrder({ type: 'order', subtype: 'factionOrder', fleetIds, order });
      const labels = { aggressive:'⚔ Agressif', ecran:'🛡 Écran', neutral:'🤝 Neutre', passive:'⏸ Passif', retreat:'↩ Retraite' };
      addLog(`${labels[order]||order} → envoyé au MJ`, 'move');
      return;
    }
    let count = 0;
    for (const fid of (Array.isArray(fleetIds) ? fleetIds : [fleetIds])) {
      const fleet = GameState.fleets.find(f => f.fleetId === fid);
      if (!fleet) continue;
      GameState.ships.filter(s => s.alive && s.fleetId === fid).forEach(s => {
        // L'ordre Écran ne concerne que les chasseurs/canonnières —
        // les capitaux conservent leur comportement actuel
        if (order === 'ecran' && !['XS','S'].includes(s.size)) return;
        s.orders   = null;
        s._fuirJitterX = undefined;
        s._fuirJitterY = undefined;
        if (order === 'retreat') {
          const isLeft = s.position.x < CONFIG.GRID_COLS / 2;
          s.moveTarget = { x: isLeft ? -5 : CONFIG.GRID_COLS + 5, y: s.position.y, z: s.position.z };
          s.behavior   = { ...s.behavior, mode: 'passive' };
        } else {
          s.behavior = { ...s.behavior, mode: order };
        }
        count++;
      });
    }
    const labels = { aggressive:'⚔ Agressif', neutral:'🤝 Neutre', passive:'⏸ Passif', retreat:'↩ Retraite', fuir:'🌀 Fuir', embarquement:'⚓ Embarquer' };
    addLog(`${labels[order]||order} → Faction (${count} vaisseaux)`, 'move');
    ui.updateFleetList();
  },
  onBehaviorChange: (shipId, mode, params) => _applyShipOrder({ action:'setBehavior', shipId, mode, params }),
  onAltitudeChange: (shipId, delta) => {
    const s = GameState.ships.find(x => x.id === shipId && x.alive);
    if (s) {
      s.position.z = Math.max(CONFIG.ALTITUDE_MIN, Math.min(CONFIG.ALTITUDE_MAX, (s.position.z||3) + delta));
      s.moveTarget = { ...s.position };
    }
    if (window._p2pSendOrder) window._p2pSendOrder({ type:'order', subtype:'altitude', shipId, delta });
  },
  onAltFilterChange:(alt) => renderer.setAltFilter(alt),
  onShipSelect:     (ship) => selectShip(ship.id),

  // ─── Energy policy ────────────────────────
  onEnergyPolicyChange: (shipId, policy) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (ship) {
      ship.energyPolicy = policy;
      ship.autoEnergyPolicy = false; // manual override disables auto
      document.getElementById('auto-energy-toggle').checked = false;
      addLog(`${ship.name} → energy: ${policy}`, 'move');
    }
  },
  onAutoEnergyChange: (shipId, enabled) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (ship) { ship.autoEnergyPolicy = enabled; }
  },

  // ─── Named character ──────────────────────
  onNamedCharChange: (shipId, field, value) => {
    const ship = GameState.ships.find(s => s.id === shipId);
    if (!ship) return;
    if (!ship.namedCharacter) {
      ship.namedCharacter = { enabled: false, name: ship.name, performance: 5, plotArmor: true, _savesMade: 0 };
    }
    ship.namedCharacter[field] = value;
    if (field === 'enabled') {
      document.getElementById('named-char-form')?.classList.toggle('hidden', !value);
      if (value) addLog(`★ ${ship.name} — named character activated`, 'move');
    }
  },

  // ─── Carrier ──────────────────────────────
  onCarrierAutoFlag: (shipId, type, enabled) => {
    const ship = GameState.ships.find(s => s.id === shipId && s.alive);
    if (!ship?.carrier) return;
    if (type === 'fighters')     ship.carrier.autoFighters     = enabled;
    if (type === 'bombers')      ship.carrier.autoBombers      = enabled;
    if (type === 'interceptors') ship.carrier.autoInterceptors = enabled;
  },
  onDeploySquadron: (shipId) => showDeployMenu(shipId),

  // Carrier panel individual launch buttons
  onCarrierLaunch: (carrierId, classId, count) => {
    // Joueur P2P : transmettre l'ordre de lancement au MJ
    if (window._p2pSendOrder) {
      window._p2pSendOrder({ type:'order', subtype:'carrierLaunch', carrierId, classId, count });
      addLog(`🛫 Lancement demandé : ${count}× ${classId}`, 'move');
      return;
    }
    const carrier = GameState.ships.find(s => s.id === carrierId && s.alive);
    if (!carrier) return;
    // Route through the squadron deployer
    const c    = carrier.carrier;
    const slot = c?.reserves?.find(r => r.classId === classId);
    if (!slot) return;
    const avail = Math.max(0, slot.count - (slot.deployed || 0));
    const n     = Math.min(count, avail);
    if (n <= 0) return addLog(`No ${classId} available`, 'move');
    import('./presets.js?v=20250617c').then(({ PRESET_CLASSES, instantiatePreset }) => {
      import('./models.js?v=20250617c').then(({ createShip }) => {
        const isBomber  = slot.type === 'bomber';
        const isGunship = slot.type === 'gunship';
        for (let i = 0; i < n; i++) {
          const angle = (i / Math.max(n,1)) * Math.PI * 2;
          const sp = {
            x: carrier.position.x + Math.cos(angle) * 2,
            y: carrier.position.y + Math.sin(angle) * 2,
            z: carrier.position.z,
          };
          const beh = isBomber
            ? { mode:'bomber_assault', radius:25, targetId:null, points:[], patrolIndex:0, attackedBy:null, distance:5, authorizedFleets:[carrier.fleetId] }
            : { mode:'escort', radius:20, targetId:carrier.id, points:[], patrolIndex:0, attackedBy:null, distance:isGunship?4:3, authorizedFleets:[carrier.fleetId] };
          const ship = instantiatePreset(classId, {
            name: `${PRESET_CLASSES[classId]?.name?.split(' ')[0] || classId} ${String.fromCharCode(65+(slot.deployed||0)+i)}`,
            fleetId: carrier.fleetId, position: sp, behavior: beh,
            _prevX: sp.x, _prevY: sp.y, _prevHeading: carrier.heading ?? 0,
          }, createShip);
          GameState.ships.push(ship);
          const fleet = GameState.fleets.find(f => f.fleetId === carrier.fleetId);
          if (fleet) fleet.shipIds.push(ship.id);
        }
        slot.deployed = (slot.deployed || 0) + n;
        addLog(`✈ ${carrier.name} → ${n}× ${classId} launched`, 'move');
        ui.updateFleetList();
        ui.updateSelectedShip(carrierId);
      });
    });
  },

  // ─── Landing ──────────────────────────────
  onLandInCarrier: (shipId, carrierId) => {
    const ship    = GameState.ships.find(s => s.id === shipId    && s.alive);
    const carrier = GameState.ships.find(s => s.id === carrierId && s.alive);
    if (!ship || !carrier?.carrier) return;

    const slot = carrier.carrier.reserves?.find(r => r.classId === ship.classId);
    if (slot) slot.deployed = Math.max(0, (slot.deployed || 0) - 1);

    ship.alive   = false;
    ship.docked  = carrierId;
    addLog(`✈ ${ship.name} landed aboard ${carrier.name}`, 'move');
    ui.updateFleetList();
    selectShip(null);
  },
});

const editor = new EditorManager(GameState, {
  onScenarioLoad: (scenario) => loadScenario(scenario),
  onFleetUpdate:  ()         => ui.updateFleetList(),
  onDeployFleet:  (fleetTemplate, colorIndex) => {
    const fleet = createFleet({
      name: fleetTemplate.name, colorIndex: colorIndex ?? fleetTemplate.colorIndex ?? 0, active: true,
    });
    GameState.fleets.push(fleet);
    GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));
    const ships = fleetTemplate.ships || [];
    let placed = 0;
    import('./presets.js?v=20250617c').then(({ instantiatePreset }) => {
      import('./models.js?v=20250617c').then(({ createShip: cs }) => {
        ships.forEach(t => {
          for (let i = 0; i < (t.qty||1); i++) {
            const ship = instantiatePreset(t.classId, {
              name: (t.qty||1) > 1 ? `${t.name} ${i+1}` : t.name,
              fleetId: fleet.fleetId, pilotType: t.pilotType, pilotLevel: t.pilotLevel,
              position: { x: 240 + (placed % 10) * 4, y: 240 + Math.floor(placed / 10) * 4, z: 3 },
            }, cs);
            GameState.ships.push(ship); placed++;
          }
        });
        ui.updateFleetList(); _buildFactionUI();
        addLog(`🚀 Flotte "${fleet.name}" déployée (${placed} vaisseaux)`, 'move');
      });
    });
  },
});

const replayModal = new ReplayModal(replays, GameState, () => {
  ui.updateSelectedShip(GameState.selectedShipId);
  ui.updateFleetList();
});

// ─── Load persisted data ──────────────────────────────
GameState.scenarios = loadScenarios();

// ─── Wrapped log function (also records to replay) ───
/**
 * Toast visuel autonome — n'importe quelle partie du code peut l'appeler, y
 * compris avant que `renderer` soit pleinement initialisé. Crée/réutilise un
 * élément DOM dédié, indépendant de la classe Renderer, pour garantir que le
 * toast s'affiche toujours quel que soit le point d'appel.
 */
function showToast(text, ok = true) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:999999;'
      + 'background:#0a0f1d;border:1px solid #2a3550;border-radius:6px;padding:7px 14px;'
      + 'font-family:monospace;font-size:12px;color:#c8d8ff;box-shadow:0 2px 14px #000c;pointer-events:none;'
      + 'max-width:90vw;text-align:center;transition:opacity .15s';
    document.body.appendChild(el);
  }
  el.style.borderColor = ok ? '#33aa66' : '#ffaa44';
  el.style.color = ok ? '#88ddaa' : '#ffcc88';
  el.style.opacity = '1';
  el.textContent = (ok ? '✓ ' : '⚠ ') + text;
  el.style.display = 'block';
  clearTimeout(window._appToastTimer);
  window._appToastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function addLog(msg, type = 'info') {
  ui.addLog(msg, type);
  recorder?.addEvent(msg, type);
  // Sons contextuels : alerte sur perte, balayage sur hyperespace
  if (type === 'death' && msg.includes('💀')) SFX.alert();
  else if (msg.includes('hyperespace') && msg.includes('🌀')) SFX.hyperspace();
}

// ─── Initialize the engine with the log function ─────
function initEngine() {
  engine = new GameEngine(GameState, addLog);

  // Initialize diplomacy matrix from fleets
  GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));

  // Initialize vote manager
  window._voteManager = new VoteManager('demo', GameState.fleets, () => {
    engine?.tick();
    addLog('✓ Step avancé par vote unanime', 'move');
  });

  // Build faction UI
  _buildFactionUI();
}

// ═══════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════

let simInterval  = null;
let speedMult    = 1;

/**
 * Starts the simulation loop.
 * Calls GameEngine.tick() at a regular interval.
 */
/** Capture snapshot de positions pour l'animation tick */
function captureFrames() {
  return GameState.ships.map(s => ({
    id: s.id, alive: s.alive,
    x: s.position.x, y: s.position.y, z: s.position.z,
    heading: s.heading,
    ph: s._prevHeading ?? s.heading,
  }));
}

function startSimulation() {
  stopSimulation();
  simInterval = setInterval(() => {
    if (GameState.paused) return;
    if (!engine)           return;

    const tickMs = Math.round(CONFIG.TICK_INTERVAL_MS / speedMult);
    const tickStartTime = Date.now();

    // ── Historique pour le retour arrière MJ (10 derniers ticks) ──
    if (!GameState._tickHistory) GameState._tickHistory = [];
    GameState._tickHistory.push({
      tick:  GameState.tick,
      ships: GameState.ships.map(s => structuredClone
        ? structuredClone(s) : JSON.parse(JSON.stringify(s))),
      lostShips: (GameState.lostShips || []).slice(),
    });
    if (GameState._tickHistory.length > 10) GameState._tickHistory.shift();

    // Capture positions AVANT le tick
    const before = captureFrames();
    // Note which ships are alive BEFORE tick (for death detection on clients)
    const aliveBeforeIds = new Set(GameState.ships.filter(s => s.alive).map(s => s.id));

    // Save previous positions for local Bézier animation (host)
    GameState.ships.forEach(s => {
      s._prevX       = s.position.x;
      s._prevY       = s.position.y;
      s._prevHeading = s.heading ?? 0;
    });
    GameState.lastTickTime = tickStartTime;
    GameState.tickInterval = tickMs;

    engine.tick();
    recorder?.record(GameState.tick, GameState.ships);

    // ═══ ÉTOILE DE LA MORT : superlaser tous les 15 tics ═══
    try { _processDeathStars(); } catch(e) { console.warn('DeathStar:', e); }

    // ── Purge des effets visuels expirés (évite l'accumulation et le lag) ──
    const nowFx = Date.now();
    if (GameState.explosions) {
      GameState.explosions = GameState.explosions.filter(e => {
        const dur = e.type === 'death' ? 1800 : e.type === 'spark' ? 900 : 1200;
        return nowFx < e.startTime + dur;
      });
    }
    if (GameState.projectiles) {
      GameState.projectiles = GameState.projectiles.filter(p =>
        nowFx < p.startTime + (p.travelMs || 800)
      );
    }

    // Capture positions APRÈS le tick
    const after = captureFrames();

    // Ships that died during this tick (for death explosions on clients)
    const newlyDead = GameState.ships.filter(s =>
      !s.alive && aliveBeforeIds.has(s.id)
    ).map(s => ({
      id: s.id, name: s.name, fleetId: s.fleetId,
      x: s.position.x, y: s.position.y, z: s.position.z,
      size: s.size, type: s.type,
      escaped: s.escaped || !!s.boarded, // embarqué = sorti sain et sauf, pas une perte
      _factionColorIndex: s._factionColorIndex,
    }));

    // ── Pertes : enregistrement centralisé (couvre TOUS les chemins de mort)
    // + PURGE des morts de GameState.ships → perf (plus d'itération sur cadavres)
    if (!GameState.lostShips) GameState.lostShips = [];
    const _lostIds = new Set(GameState.lostShips.map(l => l.id));
    newlyDead.forEach(d => {
      if (!d.escaped && !_lostIds.has(d.id)) {
        GameState.lostShips.push({ ...d, tick: GameState.tick });
      }
    });
    if (GameState.lostShips.length > 300) GameState.lostShips = GameState.lostShips.slice(-300);

    // Broadcast l'animation du tick aux joueurs.
    // Snapshot COMPLET 1 tick sur 5 (armes/inventaire/pertes), état LÉGER sinon
    // → messages ~5-10× plus petits, fluidité réseau bien meilleure
    if (window._p2pBroadcast) {
      const fullSync = (GameState.tick % 5 === 0);
      window._p2pBroadcast({
        type:         'tickAnim',
        tick:          GameState.tick,
        duration:      tickMs,
        tickStartTime,
        before, after,
        newlyDead,
        projectiles: (GameState.projectiles || []).map(p => ({
          ...p, _offset: p.startTime - tickStartTime,
        })),
        explosions: (GameState.explosions || [])
          .filter(e => e.startTime >= tickStartTime - 200)
          .map(e => ({ ...e, _offset: e.startTime - tickStartTime })),
        ...(fullSync
          ? { snapshot: getGameSnapshot(GameState) }
          : { light: getLightState(GameState) }),
      });
    }

    // ── Purge : les morts deviennent de simples lignes dans Pertes,
    // plus des entités itérées par l'IA/le rendu/les snapshots ──
    if (newlyDead.length > 0) {
      // Sons de destruction différenciés
      const selectedDied = newlyDead.some(d => d.id === GameState.selectedShipId);
      const capitalDied  = newlyDead.some(d => d.namedCharacter?.enabled || ['XL','XXL','L'].includes(d.size));
      if (selectedDied)       SFX.selectedDestroyed?.();
      else if (capitalDied)   SFX.capitalDestroyed?.();
      else if (newlyDead.some(d => ['M','L'].includes(d.size))) SFX.explosionMedium?.();
      else                    SFX.explosion?.();

      GameState.ships = GameState.ships.filter(s => s.alive);
      if (GameState.selectedShipId && !GameState.ships.find(s => s.id === GameState.selectedShipId)) {
        GameState.selectedShipId = null;
        renderer.selectedShipId  = null;
      }
    }

    ui.updateSelectedShip(GameState.selectedShipId);
    ui.updateFleetList();
    document.getElementById('tick-counter').textContent = `Tick: ${GameState.tick}`;

    // ─── Traitement des abordages actifs ──────────────────
    GameState.ships.forEach(ship => {
      if (!ship._boardingState || ship._boardingState.phase === 'over') return;
      const result = tickBoarding(ship, GameState.tick);
      result.log.forEach(l => addLog(l, 'move'));
      if (result.over) {
        if (result.winner === 'attacker') {
          // L'abordage réussit : changer le fleetId du vaisseau capturé
          const attackerShip = GameState.ships.find(s => s.id === ship._boardingState.attackerShipId);
          if (attackerShip) {
            addLog(`🏴 ${ship.name} capturé par ${attackerShip.name} !`, 'death');
            showToast(`🏴 ${ship.name} capturé !`, true);
            ship.fleetId = attackerShip.fleetId;
            ship._factionColorIndex = attackerShip._factionColorIndex;
          }
        } else {
          addLog(`🛡 Abordage de ${ship.name} repoussé !`, 'move');
          showToast(`🛡 Abordage repoussé`, true);
        }
        ship._boardingState.phase = 'over';
      }
    });
  }, CONFIG.TICK_INTERVAL_MS / speedMult);
}

function stopSimulation() {
  clearInterval(simInterval);
  simInterval = null;
}

/** Render loop (requestAnimationFrame — ~60fps, indépendant de la simulation) */
let _lastUiRefresh = 0;
function renderLoop() {
  // Animation tick pour les CLIENTS : interpoler _rx/_ry entre before et after
  // Rien à faire ici — le renderer utilise _prevX/_prevY + lastTickTime
  // exactement comme côté MJ (courbes de Bézier cubiques automatiques)

  renderer.render();
  // Refresh UI at ~1fps (800ms) — reduces flickering while keeping HP/shields current
  const now = Date.now();
  // Update tick counter (for both host and clients)
  const tickEl = document.getElementById('tick-counter');
  if (tickEl) tickEl.textContent = `Tick: ${GameState.tick}`;
  if (now - _lastUiRefresh > 800) {
    _lastUiRefresh = now;
    if (GameState.selectedShipId) ui.updateSelectedShip(GameState.selectedShipId);
    ui.updateFleetList();
    _renderLossesTab();
  }
  requestAnimationFrame(renderLoop);
}

function _renderLossesTab() {
  const el = document.getElementById('losses-list');
  if (!el) return;
  const losses = GameState.lostShips;
  if (!losses?.length) {
    el.innerHTML = '<div style="color:#3a4a60;padding:6px">Aucune perte pour l\'instant.</div>';
    return;
  }
  const COLORS = FACTION_COLORS;
  el.innerHTML = losses.map(s => {
    const fleet = GameState.fleets.find(f => f.fleetId === s.fleetId);
    const color = COLORS[s._factionColorIndex] || '#9aafcc';
    return `<div style="display:flex;align-items:center;gap:4px;padding:3px 4px;border-bottom:1px solid #0e1520">
      <div style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <span style="color:${color};font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name}</span>
      <span style="color:#3a4a60;font-size:8px">T${s.tick}</span>
    </div>`;
  }).reverse().join('');  // most recent first
}

// ═══════════════════════════════════════════════════════
// SCENARIO LOADING
// ═══════════════════════════════════════════════════════

/**
 * Loads a scenario: replaces ships and fleets in GameState.
 * Restarts simulation and recording.
 *
 * @param {Scenario} scenario
 */
function loadScenario(scenario) {
  console.log('[loadScenario] start, ships in scenario:', scenario?.ships?.length);
  // Stop current simulation
  stopSimulation();
  if (recorder) recorder.finalize();

  // Reset state
  GameState.ships = scenario.ships.map(entry => ({
    ...entry.shipData,
    alive: true,
    _prevX:        entry.shipData.position?.x ?? 0,
    _prevY:        entry.shipData.position?.y ?? 0,
    _prevHeading:  entry.shipData.heading ?? 0,
    _rx:           entry.shipData.position?.x ?? 0,
    _ry:           entry.shipData.position?.y ?? 0,
    _trajectory:   null,
  }));
  GameState.fleets      = scenario.fleets.map(f => ({ ...f, active: true }));
  GameState.projectiles = [];
  GameState.explosions  = [];
  GameState.tick        = 0;
  GameState.selectedShipId = null;
  GameState.paused      = true;

  // Initialize diplomacy matrix for the loaded fleets
  GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));

  // ─── CENTER CAMERA on the scenario ───────────────────
  // Ships are at grid coords; multiply by CELL_SIZE for world pixels.
  if (GameState.ships.length > 0) {
    const avgX = GameState.ships.reduce((s, sh) => s + sh.position.x, 0) / GameState.ships.length;
    const avgY = GameState.ships.reduce((s, sh) => s + sh.position.y, 0) / GameState.ships.length;
    renderer.camera.x    = avgX * CONFIG.CELL_SIZE;
    renderer.camera.y    = avgY * CONFIG.CELL_SIZE;
    renderer.camera.zoom = 0.06;  // zoomed out for 480×480 grid
    renderer.camera.tilt = 15;    // nearly overhead
  }

  // New engine and recorder
  initEngine();
  recorder = new ReplayRecorder(scenario.name);

  // Initialize vote manager
  try {
    window._voteManager?.destroy?.();
    window._voteManager = new VoteManager('demo', GameState.fleets, () => {
      engine?.tick();
      addLog('✓ Step avancé par vote unanime', 'move');
    });
  } catch(e) { console.warn('VoteManager init failed:', e); }

  // Restart
  startSimulation();

  // Initial UI update
  ui.updateSelectedShip(null);
  ui.updateFleetList();
  btnPause.textContent = '▶ Play';
  addLog(`📂 Scenario loaded: ${scenario.name}`, 'move');
  addLog(`⏸ Paused — click ▶ Play or use Step to advance`, 'move');
  document.getElementById('tick-counter').textContent = `Tick: 0`;

  console.log('[loadScenario] done, ships:', GameState.ships.length, 'engine:', !!engine);
  // Build faction UI (wrapped to avoid crashing if DOM isn't ready)
  try { _buildFactionUI(); } catch(e) { console.warn('_buildFactionUI failed:', e); }
}

// ═══════════════════════════════════════════════════════
// TOPBAR BUTTON BINDINGS
// ═══════════════════════════════════════════════════════

// ─── Invite modal ───────────────────────────────────────
document.getElementById('btn-invite')?.addEventListener('click', () => {
  const modal = document.getElementById('invite-modal');
  if (modal) {
    modal.style.display = 'flex';
    try { _buildFactionUI(); } catch(e) {}
  }
});
document.getElementById('invite-modal-close')?.addEventListener('click', () => {
  const modal = document.getElementById('invite-modal');
  if (modal) modal.style.display = 'none';
});
document.getElementById('invite-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// ─── Pause / Resume ──────────────────────────────────
const btnPause = document.getElementById('btn-pause');
btnPause.textContent = '▶ Play';
btnPause?.addEventListener('click', () => {
  GameState.paused = !GameState.paused;
  btnPause.textContent = GameState.paused ? '▶ Play' : '⏸ Pause';
});

// ─── Step (advance one tick) ─────────────────────────
// ─── Vote counter display ─────────────────────────────────────
function _updateVoteCounter() {
  const vm    = window._voteManager;
  if (!vm) return;
  const total = (GameState.activeFactions || []).length || (GameState.fleets?.length) || 0;
  const votes = vm.votes?.size || 0;
  const el    = document.getElementById('vote-counter');
  if (el) el.textContent = total > 0 ? `${votes}/${total}` : '';
}
setInterval(_updateVoteCounter, 200);

document.getElementById('btn-undo')?.addEventListener('click', () => {
  if (!engine) return;
  const hist = GameState._tickHistory;
  if (!hist || hist.length === 0) {
    addLog('↶ Aucun tick précédent à restaurer', 'move');
    return;
  }
  const prev = hist.pop();
  // Restaurer l'état des vaisseaux et la liste des pertes
  GameState.ships     = prev.ships.map(s => ({ ...s }));
  GameState.lostShips = prev.lostShips.slice();
  GameState.tick      = prev.tick;
  // Purger les effets visuels résiduels (tirs/explosions du tick annulé)
  GameState.projectiles = [];
  GameState.explosions  = [];
  GameState.paused = true;
  btnPause.textContent = '▶ Play';
  // Diffuser l'état restauré aux joueurs
  if (window._p2pBroadcast) {
    window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
  }
  ui.updateFleetList();
  if (GameState.selectedShipId) ui.updateSelectedShip(GameState.selectedShipId);
  document.getElementById('tick-counter').textContent = `Tick: ${GameState.tick}`;
  addLog(`↶ Retour au tick ${prev.tick} (${hist.length} restaurations restantes)`, 'move');
  SFX?.click?.();
});

document.getElementById('btn-step')?.addEventListener('click', () => {
  if (!engine) return;
  GameState.paused = true;
  btnPause.textContent = '▶ Play';
  // Save state for Bézier arc animation — same as simulation loop
  GameState.ships.forEach(s => {
    s._prevX       = s.position.x;
    s._prevY       = s.position.y;
    s._prevHeading = s.heading ?? 0;
  });
  GameState.lastTickTime = Date.now();
  GameState.tickInterval = CONFIG.TICK_INTERVAL_MS;
  engine.tick();
  recorder?.record(GameState.tick, GameState.ships);
  ui.updateSelectedShip(GameState.selectedShipId);
  ui.updateFleetList();
  document.getElementById('tick-counter').textContent = `Tick: ${GameState.tick}`;
});

// ─── Speed ───────────────────────────────────────────
document.getElementById('speed-select')?.addEventListener('change', e => {
  speedMult = parseInt(e.target.value) || 1;
  if (simInterval) startSimulation(); // restart at new speed
});

// ─── Fin de bataille ─────────────────────────────────
document.getElementById('btn-end-battle')?.addEventListener('click', () => {
  _showBattleEndModal();
});

function _showBattleEndModal() {
  const modal = document.getElementById('battle-end-modal');
  if (!modal) return;

  // Pause the simulation
  GameState.paused = true;
  const btnPauseEl = document.getElementById('btn-pause');
  if (btnPauseEl) btnPauseEl.textContent = '▶ Play';

  // Build fleet status list for the modal
  const listEl = document.getElementById('battle-end-fleet-list');
  if (listEl) {
    listEl.innerHTML = GameState.fleets.map(fl => {
      const flShips = GameState.ships.filter(s => s.fleetId === fl.fleetId);
      const alive   = flShips.filter(s => s.alive).length;
      const dead    = flShips.filter(s => s.destroyed).length;
      const escaped = flShips.filter(s => s.escaped).length;
      const total   = flShips.length;
      return `
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px;background:#080d18;border-radius:4px;border:1px solid #1e2740;cursor:pointer">
          <input type="checkbox" class="battle-save-check" data-fleet-id="${fl.fleetId}" checked>
          <div>
            <div style="color:#c8d8ff;font-size:12px;font-weight:bold">${fl.name}</div>
            <div style="font-size:10px;color:#6b7a9e;margin-top:2px">
              ✅ ${alive} vivants · 💀 ${dead} détruits · 🌀 ${escaped} échappés · ${total} total
            </div>
          </div>
        </label>`;
    }).join('') || '<p style="color:#6b7a9e;font-size:12px">Aucune flotte déployée.</p>';
  }

  modal.style.display = 'flex';
}

document.getElementById('battle-end-cancel')?.addEventListener('click', () => {
  document.getElementById('battle-end-modal').style.display = 'none';
});

document.getElementById('battle-end-save')?.addEventListener('click', () => {
  const modal     = document.getElementById('battle-end-modal');
  const checks    = modal.querySelectorAll('.battle-save-check:checked');
  const savedIds  = new Set([...checks].map(c => c.dataset.fleetId));

  // Load existing preset fleets from storage
  const stored    = JSON.parse(localStorage.getItem('sts:presetFleets') || '[]');

  for (const fl of GameState.fleets) {
    if (!savedIds.has(fl.fleetId)) continue;
    const flShips = GameState.ships.filter(s => s.fleetId === fl.fleetId);

    // Update stored fleet definition with post-battle ship states
    const presetIdx = stored.findIndex(p => p.fleetId === fl.fleetId);
    const presetEntry = presetIdx >= 0 ? stored[presetIdx] : null;
    if (presetEntry) {
      presetEntry.deployed = false; // fleet returned — can be deployed again
      presetEntry.ships    = flShips.map(s => ({
        ...s,
        // Keep battle damage for future: reduce maxHp by destroyed ratio, clear alive
        hp:        s.destroyed ? 0 : (s.escaped ? s.hp : s.hp),
        alive:     false,  // reset for next deployment
        destroyed: s.destroyed,
        escaped:   s.escaped,
        _battleNote: s.destroyed ? 'destroyed' : s.escaped ? 'escaped' : 'survived',
      }));
      stored[presetIdx] = presetEntry;
    }
    addLog(`💾 ${fl.name} sauvegardée (état post-bataille)`, 'move');
  }

  localStorage.setItem('sts:presetFleets', JSON.stringify(stored));
  modal.style.display = 'none';
  addLog('✅ État des flottes sauvegardé. Les PV peuvent être restaurés dans l\'éditeur de flotte.', 'move');
});

// ─── GM Editor ───────────────────────────────────────
document.getElementById('btn-editor')?.addEventListener('click', () => editor.open());
document.getElementById('btn-join-p2p')?.addEventListener('click', () => {
  // Show join modal
  const existing = document.getElementById('join-modal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'join-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:4000;background:#000000aa;display:flex;align-items:center;justify-content:center;font-family:monospace';
  modal.innerHTML = `
    <div style="background:#0a0e1a;border:1px solid #aa44ff;border-radius:6px;padding:24px;max-width:400px;width:90%">
      <h2 style="color:#aa44ff;margin:0 0 12px;font-size:16px">🔌 Rejoindre une partie</h2>
      <p style="color:#6b7a9e;font-size:12px;margin-bottom:12px">
        Entrez le <b style="color:#cc88ff">Peer ID</b> du MJ (visible dans son onglet Factions).
      </p>
      <input id="join-peer-id" placeholder="Peer ID du MJ (ex: a1b2c3d4-...)"
        style="width:100%;box-sizing:border-box;background:#070c14;border:1px solid #aa44ff;color:#c8d8ff;
               padding:8px;border-radius:3px;font-family:monospace;font-size:12px;margin-bottom:8px">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="join-spectator-btn" class="btn" style="flex:1;background:#0a1020;border-color:#4a9eff;color:#4a9eff">
          👁 Spectateur
        </button>
        <button id="join-player-btn" class="btn btn-primary" style="flex:1">
          🎮 Joueur
        </button>
      </div>
      <button id="join-cancel" class="btn" style="width:100%;font-size:11px">✕ Annuler</button>
    </div>`;

  document.body.appendChild(modal);

  const joinAs = (role) => {
    const raw = document.getElementById('join-peer-id')?.value.trim() || '';
    // Accept full URL, ?join=..., or bare peer ID
    const m = raw.match(/join=([a-zA-Z0-9\-_]+)/);
    const u = raw.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    const peerId = m ? m[1] : (u ? u[0] : raw.replace(/^\?/, ''));
    if (!peerId) return alert('Entrez le Peer ID du MJ.');
    window.location.href = `${window.location.origin}${window.location.pathname}?join=${peerId}&role=${role}`;
  };
  document.getElementById('join-spectator-btn')?.addEventListener('click', () => joinAs('spectator'));
  document.getElementById('join-player-btn')?.addEventListener('click',    () => joinAs('player'));
  document.getElementById('join-cancel')?.addEventListener('click',        () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  // Auto-focus
  setTimeout(() => document.getElementById('join-peer-id')?.focus(), 50);
});

// Setup wizard opens fleet editor when GM clicks "Create/Edit fleet"
window.addEventListener('gm:openFleetEditor', (e) => {
  const { wizard } = e.detail || {};
  editor.open('tab-fleets');
  // When editor closes, refresh wizard's fleet list
  const origClose = editor.close.bind(editor);
  editor.close = () => { origClose(); wizard?.refreshFleetLib?.(); };
});

// ─── Save replay ─────────────────────────────────────
document.getElementById('btn-save-replay')?.addEventListener('click', () => {
  if (!recorder) return alert('No active game to save.');
  const replay = recorder.finalize();
  replays = addReplay(replay, replays);
  replayModal.updateReplays(replays);
  // Create a new recorder to continue recording
  const name = `Battle #${replay.battleId.slice(0,6)}`;
  recorder = new ReplayRecorder(name);
  alert(`Replay "${replay.meta.name}" saved! (${replay.ticks.length} ticks)`);
});

// ─── Replays ─────────────────────────────────────────
document.getElementById('btn-replay')?.addEventListener('click', () => replayModal.open());

// ─── Scenarios — replaced by Setup Wizard restart ──────────────────────────
document.getElementById('btn-load-scenario')?.addEventListener('click', () => {
  document.getElementById('scenario-modal').classList.remove('hidden');
  renderScenarioList();
});
document.getElementById('close-scenario')?.addEventListener('click', () => {
  document.getElementById('scenario-modal').classList.add('hidden');
});
// "Relancer" button → closes modal and restarts the setup wizard
document.getElementById('btn-new-scenario')?.addEventListener('click', () => {
  document.getElementById('scenario-modal').classList.add('hidden');
  // Stop current game cleanly
  stopSimulation();
  Object.assign(GameState, { ships:[], fleets:[], projectiles:[], explosions:[], tick:0, diplomacy:{} });
  ui.updateFleetList();
  // Restart setup wizard
  new SetupWizard(config => _startFromConfig(config));
});

function renderScenarioList() {
  const el = document.getElementById('scenario-list');
  el.innerHTML = `
    <div style="padding:12px">
      <p style="color:#6b7a9e;font-size:13px;margin-bottom:12px">
        Relancer l'assistant de configuration pour démarrer une nouvelle partie.
      </p>
    </div>`;
}

// ─── Camera rotation (A / E) now handled smoothly in renderer._processKeys() ─
window.addEventListener('keydown', e => {
  // Don't intercept keys when actively typing in a text field
  const focused = document.activeElement;
  if (focused) {
    const tag = focused.tagName;
    if (tag === 'TEXTAREA') return;
    if (tag === 'INPUT') {
      const type = focused.type || 'text';
      if (['text','number','password','search','email','url','tel'].includes(type)) return;
    }
    if (focused.isContentEditable) return;
  }

  // Escape → cancel pending order or GM placement
  if (e.key === 'Escape') {
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    cancelGmPlacement();
  }
});

// ═══════════════════════════════════════════════════════
// GM PLACEMENT MODE
// ═══════════════════════════════════════════════════════

/**
 * GM can place a ship directly on the map by clicking.
 * Activated via the Editor > Ships tab "Place on map" button.
 */
let gmPlacementShip = null; // { classId, fleetId, name } when placement mode is active

/**
 * Deploy squadrons from a carrier — shows formation options.
 * Squadrons deploy as coordinated groups (bombers + escort fighters together).
 */
function showDeployMenu(carrierId) {
  const carrier = GameState.ships.find(s => s.id === carrierId && s.alive);
  if (!carrier?.carrier?.reserves?.length) return;

  const c    = carrier.carrier;
  const maxS = c.maxSimultaneous || 30;
  const alreadyDeployed = c.reserves.reduce((s, r) => s + (r.deployed || 0), 0);
  const slotsLeft = maxS - alreadyDeployed;

  if (slotsLeft <= 0) {
    addLog(`${carrier.name}: simultaneous launch capacity full (${maxS} ships out)`, 'move');
    return;
  }

  // Count available by type
  const avail = {};
  c.reserves.forEach(r => { avail[r.type] = (avail[r.type] || 0) + Math.max(0, r.count - (r.deployed || 0)); });

  const fighters     = avail['fighter']       || 0;
  const heavyFighters= avail['heavy_fighter'] || 0;
  const bombers      = avail['bomber']        || 0;
  const gunships     = avail['gunship']       || 0;
  const interceptors = avail['interceptor']   || 0;

  // Build squadron options
  const options = [];

  // Strike Package: 3 bombers + 9 fighters (escort + bomber assault)
  if (bombers >= 3 && (fighters + heavyFighters) >= 6) {
    options.push({ label: `Strike Package — 3 bombers + 9 fighters`, bombers:3, fighters:9 });
  }
  // Heavy Strike: 6 bombers + 12 fighters
  if (bombers >= 6 && (fighters + heavyFighters) >= 12) {
    options.push({ label: `Heavy Strike — 6 bombers + 12 fighters`, bombers:6, fighters:12 });
  }
  // Escort Wing: fighters only
  if ((fighters + heavyFighters) >= 9) {
    const n = Math.min(12, fighters + heavyFighters, slotsLeft);
    options.push({ label: `Escort Wing — ${n} fighters (defend capital ship)`, bombers:0, fighters:n });
  }
  // Bomber Flight: bombers only
  if (bombers >= 3) {
    const n = Math.min(6, bombers, slotsLeft);
    options.push({ label: `Bomber Flight — ${n} bombers`, bombers:n, fighters:0 });
  }
  // Gunship sortie
  if (gunships >= 2) {
    const n = Math.min(4, gunships, slotsLeft);
    options.push({ label: `Gunship Sortie — ${n} LAAT gunships`, gunships:n });
  }
  // Full available
  if (slotsLeft > 0) {
    options.push({ label: `Launch all available (up to ${slotsLeft} ships)`, all: true });
  }

  if (!options.length) {
    addLog(`${carrier.name}: no ships available to deploy.`, 'move');
    return;
  }

  const optStr = options.map((o, i) => `${i}: ${o.label}`).join('\n');
  const raw = prompt(
    `${carrier.name} — ${slotsLeft}/${maxS} simultaneous slots free\n${alreadyDeployed} ships already deployed\n\n${optStr}\n\nEnter option number (or blank to cancel):`
  );
  if (!raw?.trim()) return;

  const idx = parseInt(raw.trim());
  const opt = options[idx];
  if (!opt) return;

  _deploySquadron(carrier, opt);
}

/**
 * Deploys a squadron from a carrier according to the chosen option.
 * Bombers deploy in bomber_assault mode, fighters escort the carrier.
 */
function _deploySquadron(carrier, opt) {
  import('./models.js?v=20250617c').then(({ createShip }) => {
    import('./presets.js?v=20250617c').then(({ PRESET_CLASSES, instantiatePreset }) => {
      const c = carrier.carrier;

      // Helper: spawn N ships of given type from reserves
      function spawnFromReserves(type, count, behaviorMode, targetId) {
        let remaining = count;
        for (const reserve of c.reserves) {
          if (remaining <= 0) break;
          if (!type.includes(reserve.type)) continue;
          const avail = Math.max(0, reserve.count - (reserve.deployed || 0));
          if (avail <= 0) continue;
          const n = Math.min(remaining, avail);

          for (let i = 0; i < n; i++) {
            // Carrier launch position:
            // - 75% from the TOP of the carrier (altitude z+1, spread around the heading)
            // - 12.5% from starboard side (same altitude)
            // - 12.5% from port side (same altitude)
            const heading    = carrier.heading ?? 0;
            const launchRoll = Math.random();
            let launchAngle, launchDist, spawnZ;

            if (launchRoll < 0.75) {
              // DORSAL: ships emerge from the top deck at altitude z+1
              launchAngle = heading + (Math.random() - 0.5) * (Math.PI / 2); // ±45° spread
              launchDist  = 1.5 + Math.random() * 2;
              spawnZ      = Math.min(5, carrier.position.z + 1); // one altitude level higher
            } else if (launchRoll < 0.875) {
              // STARBOARD: right side, same altitude
              launchAngle = heading + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
              launchDist  = 2 + Math.random();
              spawnZ      = carrier.position.z;
            } else {
              // PORT: left side, same altitude
              launchAngle = heading - Math.PI / 2 + (Math.random() - 0.5) * 0.5;
              launchDist  = 2 + Math.random();
              spawnZ      = carrier.position.z;
            }

            const spawnPos = {
              x: clamp(carrier.position.x + Math.cos(launchAngle) * launchDist, 0, CONFIG.GRID_COLS - 1),
              y: clamp(carrier.position.y + Math.sin(launchAngle) * launchDist, 0, CONFIG.GRID_ROWS - 1),
              z: spawnZ,
            };
            const cls  = PRESET_CLASSES[reserve.classId];
            if (!cls) continue;

            const isBomber  = reserve.type === 'bomber';
            const isGunship = reserve.type === 'gunship';
            const beh = isBomber
              ? { mode:'bomber_assault', radius:60, targetId:null, points:[], patrolIndex:0, attackedBy:null, distance:8, authorizedFleets:[carrier.fleetId] }
              : { mode:'escort', radius:40, targetId: targetId || carrier.id, points:[], patrolIndex:0, attackedBy:null, distance: isGunship?4:3, authorizedFleets:[carrier.fleetId] };

            const ship = instantiatePreset(reserve.classId, {
              name: `${cls.name} ${String.fromCharCode(65 + (reserve.deployed||0) + i)}`,
              fleetId: carrier.fleetId,
              position: spawnPos,
              behavior: beh,
              heading:  launchAngle,
              _prevX: spawnPos.x, _prevY: spawnPos.y, _prevHeading: launchAngle,
            }, createShip);

            // AI starts IMMEDIATELY — pre-assign a target so the ship acts on tick 1
            const enemies = GameState.ships.filter(s =>
              s.alive && s.fleetId !== carrier.fleetId
            );
            if (enemies.length > 0) {
              // Bombers target large ships; fighters target anything
              const validEnemies = isBomber
                ? enemies.filter(e => ['L','XL','XXL'].includes(e.size))
                : enemies;
              const tgt = (validEnemies.length ? validEnemies : enemies)
                .reduce((closest, e) => {
                  const d1 = (e.position.x-spawnPos.x)**2 + (e.position.y-spawnPos.y)**2;
                  const d2 = (closest.position.x-spawnPos.x)**2 + (closest.position.y-spawnPos.y)**2;
                  return d1 < d2 ? e : closest;
                });
              if (isBomber) {
                ship._bomberPhase = 'climb';
                ship._bomberPassTarget = tgt.id;
                ship.moveTarget = { x: spawnPos.x, y: spawnPos.y, z: Math.min(5, carrier.position.z + 2) };
              } else {
                ship.moveTarget = { ...tgt.position };
                ship.attacking  = tgt.id;
              }
            }

            GameState.ships.push(ship);
            const fleet = GameState.fleets.find(f => f.fleetId === carrier.fleetId);
            if (fleet) fleet.shipIds.push(ship.id);
          }
          reserve.deployed = (reserve.deployed || 0) + n;
          remaining -= n;
        }
        return count - remaining;
      }

      let totalDeployed = 0;

      if (opt.all) {
        const maxS = c.maxSimultaneous || 30;
        const alreadyOut = c.reserves.reduce((s, r) => s + (r.deployed || 0), 0);
        const slots = maxS - alreadyOut;
        // Deploy fighters first, then bombers
        totalDeployed += spawnFromReserves(['fighter','heavy_fighter','interceptor'], Math.floor(slots * 0.7), 'escort', carrier.id);
        totalDeployed += spawnFromReserves(['bomber'], Math.ceil(slots * 0.2), 'bomber_assault', null);
        totalDeployed += spawnFromReserves(['gunship'], Math.ceil(slots * 0.1), 'escort', carrier.id);
      } else {
        if (opt.fighters) totalDeployed += spawnFromReserves(['fighter','heavy_fighter','interceptor'], opt.fighters, 'escort', carrier.id);
        if (opt.bombers)  totalDeployed += spawnFromReserves(['bomber'], opt.bombers, 'bomber_assault', null);
        if (opt.gunships) totalDeployed += spawnFromReserves(['gunship'], opt.gunships, 'escort', carrier.id);
      }

      addLog(`✈ ${carrier.name} deploys ${totalDeployed} ships`, 'move');
      ui.updateFleetList();
      ui.updateSelectedShip(carrier.id);
    });
  });
}

function startGmPlacement(shipConfig) {
  gmPlacementShip = shipConfig;
  renderer.canvas.style.cursor = 'crosshair';
  addLog(`🖱 Click on the map to place: ${shipConfig.name}`, 'move');
  // Show visual hint
  const hint = document.getElementById('order-hint');
  if (hint) {
    hint.textContent = `📍 Click to place: ${shipConfig.name} — Esc to cancel`;
    hint.classList.remove('hidden');
  }
}

/**
 * Builds the faction panel UI: faction list, diplomacy matrix, invite links.
 */
/**
 * ÉTOILE DE LA MORT — superlaser. Ne tire JAMAIS automatiquement.
 * Le propriétaire (faction assignée, ou MJ si non assignée) donne un ordre de
 * tir sur une cible à tout moment ; l'ordre est mis en file (ds._fireOrder).
 * Deux modes de puissance :
 *   - 'low'  : recharge 15 tics — one-shot n'importe quel vaisseau OU frappe
 *              de surface sur une planète (façon Rogue One, planète survit).
 *   - 'high' : recharge 30 tics — détruit une planète entière ou une station.
 * Le superlaser ne décharge l'ordre QUE lorsqu'il est pleinement chargé.
 */
const DS_CHARGE_LOW = 15;
const DS_CHARGE_HIGH = 30;
function _dsChargeMax(ds) {
  return (ds._fireOrder?.power === 'high' || ds.power === 'high') ? DS_CHARGE_HIGH : DS_CHARGE_LOW;
}
function _processDeathStars() {
  const bg = GameState.background;
  if (!bg?.bodies?.length) return;

  for (const ds of bg.bodies) {
    if (ds.type !== 'death_star' && ds.type !== 'death_star_2') continue;
    if (ds.type === 'death_star_2' && !ds.operational) { ds._fireProgress = undefined; continue; }

    const chargeMax = _dsChargeMax(ds);
    ds._charge = Math.min(chargeMax, (ds._charge || 0) + 1);

    // Animation de tir en cours ?
    if (ds._firing) {
      ds._fireElapsed = (ds._fireElapsed || 0) + 1;
      ds._fireProgress = Math.min(1, ds._fireElapsed / 3);
      if (window._p2pBroadcast) window._p2pBroadcast({ type:'background', background: GameState.background });
      if (ds._fireElapsed >= 3) {
        _resolveDeathStarHit(ds);
        ds._firing = false;
        ds._fireProgress = undefined;
        ds._fireElapsed = 0;
        ds._charge = 0;
        ds._fireOrder = null;
      }
      continue;
    }

    // Ordre en attente ET superlaser chargé → décharger
    if (ds._fireOrder && ds._charge >= chargeMax) {
      // Direction ÉCRAN station → cible, pour orienter le rayon au rendu
      _computeDeathStarFireAngle(ds);
      ds._firing = true;
      ds._fireElapsed = 0;
      ds._fireProgress = 0;
      const pw = ds._fireOrder.power === 'high' ? 'HAUTE PUISSANCE' : 'basse puissance';
      addLog(`🟢 ${ds.name || 'Étoile de la Mort'} : DÉCHARGE DU SUPERLASER (${pw}) !`, 'death');
      SFX?.alert?.();
    }
  }
}

/** Calcule l'angle écran du tir (station → cible) via la projection courante */
function _computeDeathStarFireAngle(ds) {
  const proj = renderer._plateauProject;
  if (!proj) { ds._fireScreenAngle = 0; return; }
  const cs = CONFIG.CELL_SIZE, grid = CONFIG.GRID_COLS * cs;
  const dsWx = (ds.x - 0.5) * grid * 3.5 + grid / 2;
  const dsWy = (ds.y - 0.5) * grid * 3.5 + grid / 2;
  const o = ds._fireOrder;
  // Mémoriser la cible en coordonnées MONDE pour reprojeter le bout du rayon
  // à chaque frame → le rayon s'arrête TOUJOURS pile sur la cible.
  if (o.kind === 'ship') {
    const s = GameState.ships.find(x => x.id === o.targetId);
    if (s) {
      ds._fireTargetWorld = { x: s.position.x * cs, y: s.position.y * cs, kind: 'ship' };
    }
  } else if (o.kind === 'body') {
    const b = GameState.background.bodies.find(x => x.id === o.targetId);
    if (b) {
      ds._fireTargetWorld = { x: (b.x - 0.5) * grid * 3.5 + grid / 2, y: (b.y - 0.5) * grid * 3.5 + grid / 2, kind: 'body' };
    }
  }
  // Angle initial (sera recalculé au rendu, mais utile en repli)
  if (ds._fireTargetWorld) {
    const dsScreen = proj(dsWx, dsWy);
    const tw = ds._fireTargetWorld;
    const tgtScreen = (tw.kind === 'ship' && renderer._worldProject)
      ? renderer._worldProject(tw.x, tw.y) : proj(tw.x, tw.y);
    ds._fireScreenAngle = Math.atan2(tgtScreen.y - dsScreen.y, tgtScreen.x - dsScreen.x);
  }
}

/** Applique les dégâts du superlaser une fois l'animation terminée */
function _resolveDeathStarHit(ds) {
  const order = ds._fireOrder;
  if (!order) return;
  const high = order.power === 'high';

  if (order.kind === 'ship') {
    // Vaisseau : volatilisé quel que soit le mode (le superlaser surclasse tout)
    const s = GameState.ships.find(x => x.id === order.targetId && x.alive);
    if (s) {
      s.hp = -99999;
      s.shields = { current: 0, max: s.shields?.max || 0 };
      s.alive = false; s.destroyed = true;
      GameState.explosions = GameState.explosions || [];
      GameState.explosions.push({
        x: s.position.x, y: s.position.y, z: s.position.z || 3,
        startTime: Date.now(), radius: 30, color: '#33ff44', type: 'death',
      });
      addLog(`💥 ${s.name} VOLATILISÉ par le superlaser !`, 'death');
    }
  } else if (order.kind === 'body') {
    const target = GameState.background.bodies.find(b => b.id === order.targetId || b === order.targetRef);
    if (target) {
      const isStation = isStationType(target.type);
      if (high) {
        // HAUTE PUISSANCE : destruction totale (planète OU station)
        target._explosionStart = Date.now();
        target._explosionKind = 'destroy';   // grande explosion qui consume le corps
        addLog(`💀 ${target.name || 'La cible'} a été ${isStation ? 'DÉTRUITE' : 'PULVÉRISÉE'} par le superlaser !`, 'death');
        if (isStation) SFX?.capitalDestroyed?.();
        else           SFX?.planetDestroyed?.();
        setTimeout(() => {
          GameState.background.bodies = GameState.background.bodies.filter(b => b !== target);
          if (window._p2pBroadcast) window._p2pBroadcast({ type:'background', background: GameState.background });
        }, 2200);
      } else {
        // BASSE PUISSANCE : frappe de surface (la planète survit — Rogue One)
        target._explosionStart = Date.now();
        target._explosionKind = 'surface';   // petite explosion localisée
        target._surfaceStrike = Date.now();
        addLog(`🔥 Frappe de surface sur ${target.name || 'la planète'} — destruction localisée.`, 'death');
        SFX?.capitalDestroyed?.();
      }
    }
  }
  if (window._p2pBroadcast) window._p2pBroadcast({ type:'background', background: GameState.background });
}

function _initDecorUI() {
  if (!GameState.background) GameState.background = createBackground();
  const bg = GameState.background;

  // Remplir le sélecteur de types de planètes
  const typeSel = document.getElementById('decor-planet-type');
  if (typeSel && !typeSel._filled) {
    Object.entries(PLANET_TYPES).forEach(([id, t]) => {
      const o = document.createElement('option');
      o.value = id; o.textContent = t.name;
      typeSel.appendChild(o);
    });
    typeSel._filled = true;
  }

  const SUN_PALETTE_KEYS = Object.keys(SUN_PALETTES);

  const broadcast = () => {
    if (window._p2pBroadcast) {
      window._p2pBroadcast({ type:'background', background: GameState.background });
    }
  };

  const renderList = () => {
    const el = document.getElementById('decor-body-list');
    if (!el) return;
    const items = [];
    bg.suns.forEach((s, i) => items.push(`<div style="color:#ffd84a">☀ Soleil ${i+1} (${s.palette})</div>`));
    bg.bodies.forEach((b, i) => {
      if (isStationType(b.type)) return; // les stations ont leur propre onglet
      const t = PLANET_TYPES[b.type];
      const hasHangar = b.hangarVolume != null;
      items.push(`<div style="display:flex;flex-direction:column;gap:2px;color:#9aafcc;padding:3px 0;border-bottom:1px solid #16201c">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>${t?.name || b.type}${b.ring?' 💍':''}</span>
          <button class="decor-del-body btn btn-small" data-i="${i}" style="font-size:9px;padding:0 5px;border-color:#aa4444;color:#ff9090">✕</button>
        </div>
        <label style="display:flex;gap:5px;font-size:9px;color:#6b7a9e;cursor:pointer;align-items:center">
          <input type="checkbox" class="decor-planet-hangar" data-i="${i}" ${hasHangar?'checked':''}> 🛬 Vaisseaux peuvent s'y poser${hasHangar ? ` (cale ${b.hangarVolume}v)` : ''}</label>
      </div>`);
    });
    el.innerHTML = items.length ? items.join('') : '<div style="color:#3a4a60">Espace vide.</div>';
    el.querySelectorAll('.decor-del-body').forEach(btn => {
      btn.onclick = () => {
        bg.bodies.splice(parseInt(btn.dataset.i), 1);
        renderList(); broadcast();
      };
    });
    el.querySelectorAll('.decor-planet-hangar').forEach(cb => {
      cb.onchange = () => {
        const body = bg.bodies[parseInt(cb.dataset.i)];
        if (!body) return;
        if (cb.checked) {
          // Cale modeste par défaut pour une planète (un terrain d'atterrissage,
          // pas un hangar industriel — volume raisonnable, ajustable plus tard
          // si besoin via la même logique que les stations).
          body.hangarVolume = 300;
          body.hangarCargo = body.hangarCargo || [];
          addLog(`🛬 ${t_name(body)} accepte maintenant les atterrissages.`, 'move');
        } else {
          body.hangarVolume = null;
          addLog(`✖ ${t_name(body)} n'accepte plus les atterrissages.`, 'move');
        }
        renderList(); broadcast(); renderDS();
      };
    });
  };
  function t_name(body) { return PLANET_TYPES[body.type]?.name || body.type; }

  // Boutons de soleils : 0/1/2/3
  document.querySelectorAll('.decor-suns').forEach(btn => {
    btn.onclick = () => {
      const n = parseInt(btn.dataset.n);
      bg.suns = [];
      // Positions typiques : 1 soleil en haut-droite, 2 = binaire proche (Tatooine), 3 = triangle
      const presets = [
        [],
        [{ x:0.85, y:0.20, r:0.07, palette:'jaune' }],
        // Binaire : deux soleils proches dans le même secteur (au-delà du plateau)
        [{ x:0.86, y:0.18, r:0.065, palette:'orange' }, { x:0.94, y:0.26, r:0.045, palette:'rouge' }],
        [{ x:0.84, y:0.16, r:0.06, palette:'jaune' }, { x:0.93, y:0.22, r:0.04, palette:'orange' }, { x:0.78, y:0.28, r:0.035, palette:'rouge' }],
      ];
      bg.suns = presets[n].map(s => ({ ...s }));
      renderList(); broadcast();
      SFX?.click?.();
    };
  });

  // Ajouter une planète
  const addBtn = document.getElementById('decor-add-planet');
  if (addBtn) addBtn.onclick = () => {
    const type = document.getElementById('decor-planet-type')?.value || 'rocheux';
    const r    = parseFloat(document.getElementById('decor-planet-size')?.value) || 0.16;
    const ring = document.getElementById('decor-planet-ring')?.checked || false;
    // Position autour du plateau (fraction 0..1, étalée au-delà des bords).
    // Réparti sur le pourtour pour que chaque corps occupe un secteur distinct.
    const i = bg.bodies.length;
    const ang = (i * 0.618 + 0.1) * Math.PI * 2;   // angle d'or → bonne répartition
    const dist = 0.62 + Math.random() * 0.25;       // hors du plateau central
    const x = 0.5 + Math.cos(ang) * dist;
    const y = 0.5 + Math.sin(ang) * dist;
    bg.bodies.push({ id: 'body_' + Date.now() + '_' + bg.bodies.length, x, y, r, type, ring, _seed: Math.floor(Math.random() * 99999) });
    renderList(); broadcast();
    SFX?.order?.();
  };

  // Tout effacer
  const clearBtn = document.getElementById('decor-clear');
  if (clearBtn) clearBtn.onclick = () => {
    bg.suns = []; bg.bodies = [];
    renderList(); broadcast(); renderDS();
    SFX?.click?.();
  };

  // ═══ Contrôles ÉTOILE DE LA MORT ═══
  // Rôle courant : MJ voit/contrôle tout ; un joueur ne contrôle que les
  // stations de SA faction (colorIndex de sa flotte).
  const isGM = () => window.SESSION?.isGM !== false;
  // myFaction recalculée À CHAQUE APPEL (pas figée) : au moment de l'init,
  // GameState.fleets ou window.SESSION peuvent ne pas être prêts, et un joueur
  // peut recevoir sa flotte après coup. Une constante figée laissait le menu
  // de contrôle de station invisible pour le joueur même après assignation.
  const myFaction = () => {
    if (isGM()) return null;
    const myFleet = window.SESSION?.fleetId;
    const f = (GameState.fleets || []).find(fl => fl.fleetId === myFleet);
    return f ? f.colorIndex : null;
  };

  const renderDS = (force) => {
    const el = document.getElementById('decor-ds-controls');
    if (!el) return;
    // ── Protection anti-fermeture-de-menu ──
    // Si un <select>/<input> À L'INTÉRIEUR de la zone station a le focus (le
    // joueur est en train de choisir une classe, taper un nombre, ouvrir un
    // menu déroulant…), on NE RECONSTRUIT PAS le HTML maintenant — ça fermerait
    // le menu/perdrait la saisie en cours. On réessaiera au prochain appel
    // (intervalle, ou après l'action en cours). `force` outrepasse cette garde
    // pour les cas où ON SAIT que l'action vient de se terminer proprement
    // (ex: après un clic qui ferme lui-même le menu).
    if (!force && el.contains(document.activeElement) &&
        document.activeElement !== document.body &&
        document.activeElement?.tagName !== 'BUTTON') {
      el._pendingRender = true;
      return;
    }
    el._pendingRender = false;
    // Stations classiques + planètes dotées d'une cale (b.hangarVolume défini
    // par le MJ via la checkbox « Vaisseaux peuvent s'y poser »).
    const stars = bg.bodies.filter(b => isStationType(b.type) || b.hangarVolume != null);
    // Garantir un id stable (au cas où une station ait été créée avant ce système d'id)
    stars.forEach((s, i) => { if (!s.id) s.id = 'ds_legacy_' + Date.now() + '_' + i; });
    if (stars.length === 0) {
      el.innerHTML = '<div style="color:#3a4a60;padding:10px;text-align:center;font-size:10px">Aucune station déployée.</div>';
      return;
    }
    const factions = GameState.activeFactions || [];
    el.innerHTML = stars.map((ds) => {
      const idx = bg.bodies.indexOf(ds);
      const isRealStation = isStationType(ds.type);
      const def = isRealStation ? (STATION_TYPES[ds.type] || STATION_TYPES.death_star)
                                 : { label: PLANET_TYPES[ds.type]?.name || 'Planète', hasSuperlaser: false };
      const hasLaser = def.hasSuperlaser;
      const ds2 = ds.type === 'death_star_2';
      const charge = ds._charge || 0;
      const max = (ds.power === 'high') ? 30 : 15;
      const pct = Math.round(100 * charge / max);
      const ready = charge >= max;
      const myF = myFaction();
      const mine = isGM() || (myF != null && ds.faction === myF);
      const ownerName = ds.faction == null ? 'MJ' :
        (factions.find(f => f.colorIndex === ds.faction)?.name || `Faction ${ds.faction}`);
      const armed = ds._fireOrder ? '🎯 ordre en file' : '';
      const card = (inner) => `<div style="background:#0c1410;border:1px solid #233a26;border-radius:8px;padding:8px;margin-bottom:8px">${inner}</div>`;
      const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="color:#7de89a;font-weight:bold;font-size:11px">🛰 ${ds.name || def.label}</span>
        <div style="display:flex;align-items:center;gap:6px">
          ${ds2 && !ds.operational ? '<span style="font-size:8px;color:#caa84a">🚧 chantier</span>' : ''}
          <button class="ds-delete gm-only btn btn-small" data-id="${ds.id}" title="Supprimer cette station" style="font-size:9px;padding:1px 6px;border-color:#aa4444;color:#ff9090;background:transparent">✕</button>
        </div>
      </div>`;
      const gauge = hasLaser ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:9px;color:#6b7a9e;min-width:48px">Superlaser</span>
          <div style="flex:1;height:8px;background:#06140a;border-radius:4px;overflow:hidden;border:1px solid #1a3a1f">
            <div class="ds-charge-bar" style="width:${pct}%;height:100%;background:${ready?'linear-gradient(90deg,#33ff44,#7dffa0)':'#2a7a33'};transition:width .3s"></div>
          </div>
          <span class="ds-charge-label" style="font-size:9px;font-weight:bold;color:${ready?'#7dffa0':'#6b7a9e'};min-width:34px;text-align:right">${ready?'PRÊT':pct+'%'}</span>
        </div>` : '';

      // ── HANGAR : système de CALE PAR VOLUME ──
      // ds.hangarCargo = [{ classId, count }, ...] — le MJ ajoute des
      // vaisseaux un par un ; chaque classe consomme un volume selon sa
      // taille (SHIP_HANGAR_VOLUME). Un X-Wing prend très peu de place, un
      // croiseur presque toute la cale d'une petite station.
      const cargo = ds.hangarCargo || [];
      const hmax = ds.hangarVolume ?? 0;
      const usedVol = cargo.reduce((sum, c) => sum + (SHIP_HANGAR_VOLUME[c._size || _classSize(c.classId)] || 1) * c.count, 0);
      const hpct = hmax > 0 ? Math.min(100, Math.round(100 * usedVol / hmax)) : 0;
      const totalShips = cargo.reduce((s, c) => s + c.count, 0);
      const hangar = hmax > 0 ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:9px;color:#6b7a9e;min-width:48px">Cale</span>
          <div style="flex:1;height:8px;background:#0a1018;border-radius:4px;overflow:hidden;border:1px solid #1a2a3a">
            <div style="width:${hpct}%;height:100%;background:${hpct>=95?'#d68a3a':'#3a8fd6'}"></div>
          </div>
          <span style="font-size:9px;font-weight:bold;color:#7ab8ff;min-width:70px;text-align:right">${usedVol}/${hmax} (${totalShips})</span>
        </div>` : '';
      const myF2 = myFaction();
      const stationOwnerHere = isGM() || (myF2 != null && ds.faction === myF2);
      const lockOn = !!ds.lockForeignDeparture;
      const cargoList = (hmax > 0 && cargo.length) ? `<div style="font-size:9px;color:#cfe0f5;margin-bottom:6px;max-height:130px;overflow-y:auto">
          ${cargo.map((c,ci) => {
            const ownerFleet = c.ownerFleetId != null ? (GameState.fleets || []).find(f => f.fleetId === c.ownerFleetId) : null;
            const ownerFac = ownerFleet ? factions.find(f => f.colorIndex === ownerFleet.colorIndex) : null;
            const ownerLabel = ownerFac ? ownerFac.name : (c.ownerFleetId == null ? 'Station' : '?');
            const isMyShip = c.ownerFleetId != null && c.ownerFleetId === window.SESSION?.fleetId;
            const isForeignToStation = c.ownerFleetId != null && c.ownerFleetId !== (GameState.fleets || []).find(f => f.colorIndex === ds.faction)?.fleetId;
            // Le verrou bloque TOUT vaisseau étranger, y compris son propre
            // propriétaire — seul le propriétaire de la STATION peut
            // l'outrepasser (c'est l'intérêt même de pouvoir « retenir » un
            // vaisseau de force). Le bouton reste visible (MJ, propriétaire de
            // la station, ou propriétaire du vaisseau) mais désactivé si bloqué.
            const blocked = lockOn && isForeignToStation && !stationOwnerHere;
            const canDeploy = isGM() || stationOwnerHere || isMyShip;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #16201c">
              <span>${_classLabel(c.classId)} ×${c.count} <span style="color:#5a6a7a;font-size:8px">(${ownerLabel})</span></span>
              <span style="display:flex;gap:4px;align-items:center">
                <span style="color:#5a6a7a">${(SHIP_HANGAR_VOLUME[c._size || _classSize(c.classId)]||1)*c.count}v</span>
                ${canDeploy ? `<button class="ds-cargo-deploy btn btn-small" data-id="${ds.id}" data-ci="${ci}" title="${blocked?'Bloqué par le propriétaire de la station':'Faire décoller'}" style="font-size:8px;padding:0 4px;border-color:${blocked?'#5a5a5a':'#3a8fd6'};color:${blocked?'#7a7a7a':'#7ab8ff'}" ${blocked?'disabled':''}>${blocked?'🔒':'🚀'}</button>` : (blocked ? `<span title="Départ bloqué par le propriétaire de la station" style="font-size:9px">🔒</span>` : '')}
                <button class="ds-cargo-remove gm-only btn btn-small" data-id="${ds.id}" data-ci="${ci}" title="Retirer du hangar (MJ)" style="font-size:8px;padding:0 4px;border-color:#aa4444;color:#ff9090">✕</button>
              </span>
            </div>`;
          }).join('')}
        </div>` : (hmax > 0 ? `<div style="font-size:9px;color:#3a4a60;margin-bottom:6px">Cale vide.</div>` : '');
      // Verrou de station (propriétaire de la station ou MJ uniquement) :
      // bloque le décollage des vaisseaux qui ne lui appartiennent pas.
      const lockControl = (hmax > 0 && stationOwnerHere) ? `<label style="display:flex;gap:5px;font-size:9px;color:#6b7a9e;cursor:pointer;margin-bottom:6px;align-items:center">
          <input type="checkbox" class="ds-lock-departure" data-id="${ds.id}" ${lockOn?'checked':''}> 🔒 Bloquer le départ des vaisseaux étrangers</label>` : '';

      if (!mine) {
        return card(header + gauge + hangar + cargoList +
          `<div style="font-size:9px;color:#6b7a9e">Contrôle : ${ownerName}</div>`);
      }

      const skinOptions = Object.entries(STATION_TYPES)
        .map(([id, d]) => `<option value="${id}" ${ds.type===id?'selected':''}>${d.label}</option>`).join('');

      // ── Éditeur d'AJOUT à la cale (MJ uniquement) — choisir une classe de
      // vaisseau, une quantité, voir le volume que ça consommera avant de
      // valider. Le MJ peuple ainsi librement le hangar plutôt que de choisir
      // dans une liste figée de 2-3 chasseurs.
      const remainingVol = Math.max(0, hmax - usedVol);
      const hangarControls = hmax > 0 ? `<div class="gm-only" style="display:flex;gap:5px;align-items:center;margin-bottom:4px">
          <select class="ds-cargo-class select-small" data-id="${ds.id}" style="flex:1;font-size:9px">
            ${_HANGAR_CLASS_OPTIONS}
          </select>
          <input type="number" class="ds-cargo-count" data-id="${ds.id}" min="1" max="999" value="1" style="width:42px;font-size:9px;background:#0a1018;border:1px solid #1a2a3a;color:#cfe0f5;border-radius:4px;padding:3px">
          <button class="ds-cargo-add btn btn-small" data-id="${ds.id}" style="font-size:9px;background:#0c1f12;border-color:#3a8a44;color:#9dffb0;padding:5px">➕</button>
        </div>
        <div class="gm-only" style="font-size:8px;color:#5a6a7a;margin-bottom:6px">Volume restant : ${remainingVol}</div>` : '';

      const laserControls = hasLaser ? (
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:9px;color:#6b7a9e;min-width:48px">Puissance</span>
          <select class="ds-power select-small" data-id="${ds.id}" style="flex:1;font-size:9px">
            <option value="low" ${ds.power!=='high'?'selected':''}>Basse (15t) — vaisseau / surface</option>
            <option value="high" ${ds.power==='high'?'selected':''}>Haute (30t) — détruit la cible</option>
          </select>
        </div>` +
        `<div style="display:flex;gap:5px;margin-bottom:6px">
          <button class="ds-fire-ship btn btn-small" data-id="${ds.id}" style="flex:1;font-size:9px;background:#143a1a;border-color:#33aa44;color:#9dffb0;padding:5px">🎯 Vaisseau</button>
          <button class="ds-fire-body btn btn-small" data-id="${ds.id}" style="flex:1;font-size:9px;background:#3a2614;border-color:#aa7733;color:#ffcc99;padding:5px">🪐 Station/Planète</button>
        </div>` +
        (armed ? `<div style="font-size:8px;color:#caa84a;text-align:center;margin-bottom:4px">${armed}</div>` : '')
      ) : '';


      // ── TROUPES & PASSAGERS (station) ────────────────────────────
      // Miroir de l'onglet Économie des vaisseaux : troupes typées,
      // blessés (médical), prisonniers (cellules), civils (passagers).
      const stTroops  = ds._troops || [];
      const stMedMax  = ds.medicalCapacity  ?? 0;
      const stBrigMax = ds.brigCapacity     ?? 0;
      const stMedCur  = ds._woundedCount   ?? 0;
      const stBrigCur = ds._prisonerCount  ?? 0;
      const TROOP_DEFS_ST = Object.fromEntries(
        Object.entries(TROOP_TYPES).map(([id, t]) => [id, { icon: t.icon, label: t.label, color: t.color }])
      );
      const troopListHtml = stTroops.length
        ? stTroops.map((t, ti) => {
            const def = TROOP_DEFS_ST[t.type] || { icon: '?', label: t.type, color: '#888' };
            const fights = t.willFight !== false;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #16201c">
              <span style="color:${def.color};font-size:9px">${def.icon} ${def.label} ×${t.count} ${fights ? '' : '<span style="color:#6b7a9e">(non-combattant)</span>'}</span>
              <button class="st-troop-rem btn btn-small" data-id="${ds.id}" data-ti="${ti}" style="font-size:8px;padding:0 4px;border-color:#aa4444;color:#ff9090">✕</button>
            </div>`;
          }).join('')
        : `<div style="font-size:9px;color:#3a4a60">Aucune troupe embarquée.</div>`;

      const addTroopCtrl = mine ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          <select class="st-troop-type" data-id="${ds.id}" style="flex:2;font-size:9px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:2px">
            ${Object.entries(TROOP_DEFS_ST).map(([id,d])=>`<option value="${id}">${d.icon} ${d.label}</option>`).join('')}
          </select>
          <input type="number" class="st-troop-count" data-id="${ds.id}" min="1" max="99999" value="100" style="width:52px;font-size:9px;background:#0a1018;border:1px solid #1a2a3a;color:#cfe0f5;border-radius:4px;padding:3px">
          <button class="st-troop-add btn btn-small" data-id="${ds.id}" style="font-size:9px;padding:2px 5px;border-color:#3a8a44;color:#9dffb0">+</button>
        </div>` : '';

      const medBrigHtml = (stMedMax > 0 || stBrigMax > 0) ? `
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${stMedMax > 0 ? `<div style="flex:1;min-width:90px">
            <div style="font-size:9px;color:#27ae60;margin-bottom:2px">➕ Médical ${stMedCur}/${stMedMax}</div>
            <div style="height:6px;background:#06140a;border-radius:3px;overflow:hidden"><div style="width:${Math.min(100,Math.round(100*stMedCur/stMedMax))}%;height:100%;background:#27ae60"></div></div>
            ${mine ? `<div style="display:flex;gap:2px;margin-top:3px">
              <button class="st-med-adj btn btn-small" data-id="${ds.id}" data-delta="50"  style="font-size:8px;padding:0 3px;border-color:#27ae60;color:#9dffb0">+50</button>
              <button class="st-med-adj btn btn-small" data-id="${ds.id}" data-delta="-50" style="font-size:8px;padding:0 3px;border-color:#aa4444;color:#ff9090">-50</button>
            </div>` : ''}
          </div>` : ''}
          ${stBrigMax > 0 ? `<div style="flex:1;min-width:90px">
            <div style="font-size:9px;color:#e74c3c;margin-bottom:2px">⛓ Cellules ${stBrigCur}/${stBrigMax}</div>
            <div style="height:6px;background:#140606;border-radius:3px;overflow:hidden"><div style="width:${Math.min(100,Math.round(100*stBrigCur/stBrigMax))}%;height:100%;background:#e74c3c"></div></div>
            ${mine ? `<div style="display:flex;gap:2px;margin-top:3px">
              <button class="st-brig-adj btn btn-small" data-id="${ds.id}" data-delta="10"  style="font-size:8px;padding:0 3px;border-color:#e74c3c;color:#ff9090">+10</button>
              <button class="st-brig-adj btn btn-small" data-id="${ds.id}" data-delta="-10" style="font-size:8px;padding:0 3px;border-color:#aa4444;color:#ff9090">-10</button>
            </div>` : ''}
          </div>` : ''}
        </div>` : '';

      // ── MARCHANDISES STATION ────────────────────────────────────────
      // Les stations peuvent stocker des marchandises comme les vaisseaux.
      // Volume max fixé à 5000 (station = entrepôt géant).
      const stCargoMax  = def.cargoCapacity ?? 5000;
      const stCargo     = ds._stationCargo || [];
      const stCargoUsed = stCargo.reduce((s,c)=>(s + (CARGO_TYPES[c.type]?.unitVolume||1)*c.count), 0);
      const stCargoPct  = stCargoMax > 0 ? Math.min(100, Math.round(100*stCargoUsed/stCargoMax)) : 0;
      const stCargoListHtml = stCargo.length
        ? stCargo.map((c,ci2)=>{
            const ct = CARGO_TYPES[c.type] || {label:c.type, color:'#888', unitVolume:1};
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #16201c;font-size:9px">
              <span style="color:${ct.color}">${ct.label} ×${c.count}</span>
              ${mine?`<button class="st-cargo-rem btn btn-small" data-id="${ds.id}" data-ci="${ci2}" style="font-size:8px;padding:0 3px;border-color:#aa4444;color:#ff9090">✕</button>`:''}
            </div>`;
          }).join('')
        : `<div style="font-size:9px;color:#3a4a60">Aucune marchandise stockée.</div>`;
      const stCargoAddHtml = mine ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          <select class="st-cargo-type" data-id="${ds.id}" style="flex:2;font-size:9px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:2px">
            ${Object.entries(CARGO_TYPES).map(([id,c])=>`<option value="${id}">${c.label}</option>`).join('')}
          </select>
          <input type="number" class="st-cargo-count" data-id="${ds.id}" min="1" max="9999" value="10"
            style="width:48px;font-size:9px;background:#0a1018;border:1px solid #1a2a3a;color:#cfe0f5;border-radius:4px;padding:3px">
          <button class="st-cargo-add btn btn-small" data-id="${ds.id}" style="font-size:9px;padding:2px 5px;border-color:#3a8a44;color:#9dffb0">+</button>
        </div>` : '';

      // ── ONGLETS DE LA STATION ──────────────────────────────────────
      // ⚙ Fonction : superlaser (DS only), contrôle, DS-II opérationnel
      // 📦 Cale    : vaisseaux, marchandises, troupes, médical, cellules
      const tab = ds._uiTab || 'fonction';
      const tabBtnStyle = (t) => t === tab
        ? 'font-size:9px;padding:2px 7px;border-radius:3px 3px 0 0;border:1px solid #2a5530;border-bottom:none;background:#0c1e14;color:#7de89a;font-weight:bold;cursor:pointer'
        : 'font-size:9px;padding:2px 7px;border-radius:3px 3px 0 0;border:1px solid #1a2a20;border-bottom:none;background:#07100a;color:#4a7a5a;cursor:pointer';

      const tabBar = `<div style="display:flex;gap:2px;margin-bottom:-1px;margin-top:4px">
        <div class="st-tab-btn" data-id="${ds.id}" data-tab="fonction" style="${tabBtnStyle('fonction')}">⚙ Fonction</div>
        <div class="st-tab-btn" data-id="${ds.id}" data-tab="cale"     style="${tabBtnStyle('cale')}">📦 Cale & Troupes</div>
      </div>
      <div style="border:1px solid #2a5530;border-radius:0 4px 4px 4px;padding:6px;margin-bottom:4px;background:#070f09">`;

      // ── Onglet Fonction : superlaser + contrôle + DS-II opérationnel ──
      // Le sélecteur "Type" n'existe QUE pour alterner DS-I ↔ DS-II.
      const tabFonction = tab === 'fonction' ? (
        // Superlaser (DS uniquement)
        gauge +
        (hasLaser ? laserControls : '') +
        (armed ? `<div style="font-size:8px;color:#caa84a;text-align:center;margin-bottom:4px">${armed}</div>` : '') +
        // DS-I ↔ DS-II (sélecteur de type uniquement pour les Étoiles)
        (hasLaser ? `<div class="gm-only" style="display:flex;align-items:center;gap:6px;margin-bottom:5px;margin-top:4px">
          <span style="font-size:9px;color:#6b7a9e;min-width:48px">Version</span>
          <select class="ds-skin select-small" data-id="${ds.id}" style="flex:1;font-size:9px">
            <option value="death_star"   ${ds.type==='death_star'  ?'selected':''}>Étoile I (complète)</option>
            <option value="death_star_2" ${ds.type==='death_star_2'?'selected':''}>Étoile II (chantier)</option>
          </select>
        </div>` : '') +
        (ds2 ? `<label style="display:flex;gap:5px;font-size:9px;color:#6b7a9e;cursor:pointer;margin-bottom:5px;align-items:center">
          <input type="checkbox" class="ds-operational" data-id="${ds.id}" ${ds.operational?'checked':''}> Superlaser opérationnel</label>` : '') +
        // Contrôle de faction (toutes stations)
        `<div class="gm-only" style="display:flex;align-items:center;gap:6px;margin-bottom:5px;margin-top:4px">
          <span style="font-size:9px;color:#6b7a9e;min-width:48px">Contrôle</span>
          <select class="ds-owner select-small" data-id="${ds.id}" style="flex:1;font-size:9px">
            <option value="">MJ (aucune faction)</option>
            ${factions.map(f => `<option value="${f.colorIndex}" ${ds.faction===f.colorIndex?'selected':''}>${f.name}</option>`).join('')}
          </select>
        </div>`
      ) : '';

      // ── Onglet Cale : vaisseaux + marchandises + troupes + médical ──
      const tabCale = tab === 'cale' ? (
        // ─ Vaisseaux en hangar ─
        (hmax > 0 ? `<div style="font-size:9px;color:#7ab8ff;font-weight:bold;margin-bottom:4px">🚀 Vaisseaux en hangar</div>` + hangar + cargoList + lockControl + hangarControls : '') +
        // ─ Marchandises ─
        `<div style="font-size:9px;color:#fdcb6e;font-weight:bold;margin:${hmax>0?'8px':'0px'} 0 4px">📦 Marchandises</div>` +
        (stCargoMax > 0 ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <div style="flex:1;height:6px;background:#0a1018;border-radius:3px;overflow:hidden;border:1px solid #1a2a3a">
            <div style="width:${stCargoPct}%;height:100%;background:${stCargoPct>=95?'#d68a3a':'#fdcb6e'}"></div>
          </div>
          <span style="font-size:9px;color:#fdcb6e;min-width:60px;text-align:right">${stCargoUsed}/${stCargoMax}</span>
        </div>` : '') +
        stCargoListHtml + stCargoAddHtml +
        // ─ Troupes ─
        `<div style="font-size:9px;color:#7de89a;font-weight:bold;margin-top:8px;margin-bottom:4px">🪖 Troupes</div>` +
        troopListHtml + addTroopCtrl +
        medBrigHtml
      ) : '';

      return card(header + tabBar + (tab === 'fonction' ? tabFonction : tabCale) + `</div>`);
    }).join('');

    // ── Handlers onglets station ────────────────────────────────
    el.querySelectorAll('.st-tab-btn').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      ds._uiTab = btn.dataset.tab;
      renderDS();
    });

    // ── Handlers troupes station ────────────────────────────────
    el.querySelectorAll('.st-troop-add').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      const typeEl  = el.querySelector(`.st-troop-type[data-id="${ds.id}"]`);
      const countEl = el.querySelector(`.st-troop-count[data-id="${ds.id}"]`);
      const type  = typeEl?.value;
      const count = Math.max(1, parseInt(countEl?.value) || 1);
      if (!type) return;
      if (!ds._troops) ds._troops = [];
      const existing = ds._troops.find(t => t.type === type);
      if (existing) { existing.count += count; }
      else { ds._troops.push({ type, count, willFight: !['civilian','smuggler','clone_medic'].includes(type) }); }
      addLog(`🪖 ${count}× ${TROOP_TYPES[type]?.label || type} embarqué(s) sur ${ds.name || 'la station'}.`, 'move');
      broadcast(); renderDS();
    });

    el.querySelectorAll('.st-troop-rem').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds || !ds._troops) return;
      const ti = parseInt(btn.dataset.ti);
      const removed = ds._troops[ti];
      ds._troops.splice(ti, 1);
      addLog(`🗑 ${removed?.count}× ${TROOP_TYPES[removed?.type]?.label || removed?.type} retiré(s).`, 'move');
      broadcast(); renderDS();
    });

    el.querySelectorAll('.st-med-adj').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      const delta = parseInt(btn.dataset.delta);
      ds._woundedCount = Math.max(0, Math.min(ds.medicalCapacity ?? 0, (ds._woundedCount ?? 0) + delta));
      broadcast(); renderDS();
    });

    el.querySelectorAll('.st-brig-adj').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      const delta = parseInt(btn.dataset.delta);
      ds._prisonerCount = Math.max(0, Math.min(ds.brigCapacity ?? 0, (ds._prisonerCount ?? 0) + delta));
      broadcast(); renderDS();
    });

    el.querySelectorAll('.st-cargo-add').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      const typeEl  = el.querySelector(`.st-cargo-type[data-id="${ds.id}"]`);
      const countEl = el.querySelector(`.st-cargo-count[data-id="${ds.id}"]`);
      const type  = typeEl?.value; if (!type) return;
      const count = Math.max(1, parseInt(countEl?.value) || 1);
      const def2  = CARGO_TYPES[type] || { unitVolume: 1, label: type };
      const vol   = def2.unitVolume * count;
      const stCargoMax = (STATION_TYPES[ds.type]?.cargoCapacity ?? 5000);
      const used  = (ds._stationCargo||[]).reduce((s,c)=>(s+(CARGO_TYPES[c.type]?.unitVolume||1)*c.count),0);
      if (used + vol > stCargoMax) { showToast(`Volume insuffisant (besoin ${vol}, restant ${stCargoMax-used})`, false); return; }
      if (!ds._stationCargo) ds._stationCargo = [];
      const ex = ds._stationCargo.find(c => c.type === type);
      if (ex) ex.count += count; else ds._stationCargo.push({ type, count });
      addLog(`📦 ${count}× ${def2.label} stocké(s) sur ${ds.name || 'la station'}.`, 'move');
      broadcast(); renderDS();
    });
    el.querySelectorAll('.st-cargo-rem').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds || !ds._stationCargo) return;
      const ci3 = parseInt(btn.dataset.ci);
      const rem = ds._stationCargo[ci3];
      ds._stationCargo.splice(ci3, 1);
      addLog(`🗑 ${rem?.count}× ${CARGO_TYPES[rem?.type]?.label || rem?.type} retiré(s).`, 'move');
      broadcast(); renderDS();
    });

    el.querySelectorAll('.ds-skin').forEach(sel => sel.onchange = () => {
      const ds = bg.bodies.find(b => b.id === sel.dataset.id);
      if (!ds) return;
      const oldDef = STATION_TYPES[ds.type] || STATION_TYPES.death_star;
      ds.type = sel.value;
      const newDef = STATION_TYPES[sel.value] || STATION_TYPES.death_star;
      // Si le hangar n'avait jamais été configuré (station ancienne), l'initialiser
      if (ds.hangarVolume == null) { ds.hangarVolume = newDef.hangarVolume; ds.hangarCargo = []; }
      // DS-II non opérationnelle par défaut quand on bascule sur le chantier
      if (sel.value === 'death_star_2' && ds.operational === undefined) ds.operational = false;
      broadcast(); renderDS();
    });
    el.querySelectorAll('.ds-owner').forEach(sel => sel.onchange = () => {
      const ds = bg.bodies.find(b => b.id === sel.dataset.id);
      if (!ds) return;
      ds.faction = sel.value === '' ? null : parseInt(sel.value);
      broadcast(); renderDS();
    });
    el.querySelectorAll('.ds-operational').forEach(cb => cb.onchange = () => {
      const ds = bg.bodies.find(b => b.id === cb.dataset.id);
      if (!ds) return;
      ds.operational = cb.checked; broadcast(); renderDS();
    });
    el.querySelectorAll('.ds-lock-departure').forEach(cb => cb.onchange = () => {
      const ds = bg.bodies.find(b => b.id === cb.dataset.id);
      if (!ds) return;
      ds.lockForeignDeparture = cb.checked;
      addLog(`${cb.checked ? '🔒' : '🔓'} ${ds.name || STATION_TYPES[ds.type]?.label} : départs étrangers ${cb.checked ? 'bloqués' : 'autorisés'}.`, 'move');
      broadcast(); renderDS(true);
    });
    el.querySelectorAll('.ds-power').forEach(sel => sel.onchange = () => {
      const ds = bg.bodies.find(b => b.id === sel.dataset.id);
      if (!ds) return;
      ds.power = sel.value;
      // changer le mode remet la charge à zéro (capacité différente)
      ds._charge = 0;
      broadcast(); renderDS();
    });
    el.querySelectorAll('.ds-fire-ship').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (ds) _armDeathStarFire(ds, 'ship');
    });
    el.querySelectorAll('.ds-fire-body').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (ds) _armDeathStarFire(ds, 'body');
    });
    el.querySelectorAll('.ds-cargo-add').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      const classSel = el.querySelector(`.ds-cargo-class[data-id="${ds.id}"]`);
      const countInput = el.querySelector(`.ds-cargo-count[data-id="${ds.id}"]`);
      const classId = classSel?.value;
      const n = Math.max(1, parseInt(countInput?.value) || 1);
      if (!classId) return;
      const vol = (SHIP_HANGAR_VOLUME[_classSize(classId)] || 1) * n;
      const used = (ds.hangarCargo || []).reduce((s,c) => s + (SHIP_HANGAR_VOLUME[c._size || _classSize(c.classId)]||1)*c.count, 0);
      if (used + vol > (ds.hangarVolume || 0)) {
        addLog(`✖ Volume insuffisant dans la cale (besoin ${vol}, restant ${Math.max(0,(ds.hangarVolume||0)-used)}).`, 'move');
        showToast(`Volume insuffisant (besoin ${vol}, restant ${Math.max(0,(ds.hangarVolume||0)-used)})`, false);
        return;
      }
      ds.hangarCargo = ds.hangarCargo || [];
      const existing = ds.hangarCargo.find(c => c.classId === classId && c.ownerFleetId == null);
      if (existing) { existing.count += n; if (existing._size == null) existing._size = _classSize(classId); }
      else ds.hangarCargo.push({ classId, count: n, _size: _classSize(classId), ownerFleetId: null });
      addLog(`📦 ${n}× ${_classLabel(classId)} ajouté(s) à la cale de ${ds.name || STATION_TYPES[ds.type]?.label}.`, 'move');
      showToast(`📦 ${n}× ${_classLabel(classId)} ajouté(s) à la cale`, true);
      broadcast(); renderDS();
    });
    el.querySelectorAll('.ds-cargo-remove').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds || !ds.hangarCargo) return;
      const ci = parseInt(btn.dataset.ci);
      const entry = ds.hangarCargo[ci];
      if (!entry) return;
      ds.hangarCargo.splice(ci, 1);
      addLog(`🗑 ${_classLabel(entry.classId)} retiré(s) de la cale.`, 'move');
      showToast(`🗑 ${entry.count}× ${_classLabel(entry.classId)} retiré(s)`, true);
      broadcast(); renderDS();
    });
    el.querySelectorAll('.ds-cargo-deploy').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds || !ds.hangarCargo) return;
      const ci = parseInt(btn.dataset.ci);
      const entry = ds.hangarCargo[ci];
      if (!entry || entry.count <= 0) return;
      _deployFromHangar(ds, entry.classId, 1, entry.ownerFleetId);
    });
    el.querySelectorAll('.ds-delete').forEach(btn => btn.onclick = () => {
      const ds = bg.bodies.find(b => b.id === btn.dataset.id);
      if (!ds) return;
      const name = ds.name || (STATION_TYPES[ds.type]?.label) || 'cette station';
      if (!confirm(`Supprimer ${name} ? Cette action est irréversible.`)) return;
      bg.bodies = bg.bodies.filter(b => b !== ds);
      // Réassigner le tableau (la closure `bg` reste la même référence objet —
      // on mute la propriété bodies, pas l'objet bg lui-même)
      GameState.background.bodies = bg.bodies;
      addLog(`🗑 ${name} supprimée.`, 'move');
      renderList(); renderDS(); broadcast();
      SFX?.click?.();
    });
  };

  const addStation = (variant) => {
    const def = STATION_TYPES[variant] || STATION_TYPES.death_star;
    const i = bg.bodies.length;
    const ang = (i * 0.618 + 0.1) * Math.PI * 2;
    const x = 0.5 + Math.cos(ang) * 0.7, y = 0.5 + Math.sin(ang) * 0.7;
    bg.bodies.push({
      id: 'ds_' + Date.now() + '_' + bg.bodies.length,
      x, y, r: def.defaultRadius, type: variant, ring: false,
      name: def.label,
      faction: null, _charge: 0, power: 'low', _spin: Math.random() * Math.PI * 2,
      operational: variant !== 'death_star_2',
      _seed: 1,
      // ─── Hangar : éditeur de cale par VOLUME ───
      // hangarCargo = [{classId, count}] — vide au départ, le MJ remplit la
      // cale lui-même. Pas d'entités réelles tant que non déployées.
      hangarVolume: def.hangarVolume,
      hangarCargo: [],
    });
    renderList(); renderDS(); broadcast();
    SFX?.order?.();
  };
  // Compat : ancien id de bouton, ajoute toujours une Étoile de la Mort I
  document.getElementById('decor-add-ds1')?.addEventListener('click', () => addStation('death_star'));
  // Sélecteur de type pour les autres stations
  const stationTypeSel = document.getElementById('decor-station-type');
  const addStationBtn = document.getElementById('decor-add-station');
  if (addStationBtn) addStationBtn.onclick = () => addStation(stationTypeSel?.value || 'death_star');

  // ═══ Changement de terrain/scénario en direct (MJ) ═══
  const terrApply = document.getElementById('decor-terrain-apply');
  if (terrApply) terrApply.onclick = () => {
    const type = document.getElementById('decor-terrain-sel')?.value || 'empty';
    GameState.terrainConfig = (type === 'empty') ? null : { type };
    // Régénérer le terrain
    import('./terrain.js?v=20250617c').then(({ generateDebrisField, generateAsteroidField, generateNebulaClouds, generateIceField }) => {
      const C = CONFIG.GRID_COLS, R = CONFIG.GRID_ROWS;
      if (type === 'debris')             GameState.terrain = generateDebrisField(C, R, 0.35);
      else if (type === 'asteroid_field') GameState.terrain = generateAsteroidField(C, R);
      else if (type === 'nebula')         GameState.terrain = generateNebulaClouds(C, R);
      else if (type === 'ice_field')      GameState.terrain = generateIceField(C, R);
      else if (type === 'black_hole')     GameState.terrain = [{ id:'bh0', type:'black_hole_core', x:C/2, y:R/2, z:0, radius:3, mass:0, hp:999999, maxHp:999999, destroyed:false, vx:0, vy:0 }];
      else                                GameState.terrain = [];
      addLog(`🌌 Terrain changé : ${type === 'empty' ? 'espace vide' : type} (${GameState.terrain.length} objets)`, 'move');
      // Diffuser aux joueurs (terrain voyage dans le snapshot complet au prochain tick,
      // mais on force un broadcast immédiat de l'état)
      if (window._p2pBroadcastFullState) window._p2pBroadcastFullState();
    });
    SFX?.order?.();
  };

  // Mise à jour légère des jauges de charge SANS reconstruire le HTML (sinon
  // les menus déroulants ouverts se referment avant qu'on puisse cliquer).
  const updateDSCharges = () => {
    const el = document.getElementById('decor-ds-controls');
    if (!el) return;
    const stars = bg.bodies.filter(b => isStationType(b.type));
    const bars = el.querySelectorAll('.ds-charge-bar');
    const labels = el.querySelectorAll('.ds-charge-label');
    stars.forEach((ds, i) => {
      const max = (ds.power === 'high') ? 30 : 15;
      const pct = Math.round(100 * (ds._charge || 0) / max);
      const ready = (ds._charge || 0) >= max;
      if (bars[i]) {
        bars[i].style.width = pct + '%';
        bars[i].style.background = ready ? 'linear-gradient(90deg,#33ff44,#7dffa0)' : '#2a7a33';
      }
      if (labels[i]) {
        labels[i].textContent = ready ? 'PRÊT' : pct + '%';
        labels[i].style.color = ready ? '#7dffa0' : '#6b7a9e';
      }
    });
  };

  // Rafraîchir les jauges périodiquement (léger, ne casse pas les selects) ;
  // si une reconstruction complète était en attente (différée car un menu
  // était ouvert), on la retente ici dès que le focus est libéré.
  if (!window._dsChargeInterval) {
    window._dsChargeInterval = setInterval(() => {
      const st = document.getElementById('tab-station');
      if (st && !st.classList.contains('hidden')) {
        const el = document.getElementById('decor-ds-controls');
        if (el?._pendingRender) { renderDS(); return; }
        // Si le nombre de stations a changé, reconstruire ; sinon juste les jauges
        const shown = el ? el.querySelectorAll('.ds-charge-bar').length : 0;
        const actual = bg.bodies.filter(b => isStationType(b.type) || b.hangarVolume != null).length;
        if (shown !== actual) renderDS();
        else updateDSCharges();
      }
    }, 1000);
  }

  renderList();
  renderDS();
  window._renderDS = renderDS;
}

/** Arme un ordre de tir. kind 'ship' → cliquer un vaisseau ; 'body' → cliquer
 *  une planète d'arrière-plan. Le mode de puissance est lu sur la station. */
/** Taille d'une classe de vaisseau (pour le calcul de volume de cale) */
function _classSize(classId) {
  return PRESET_CLASSES[classId]?.size || 'M';
}
/** Nom affiché d'une classe de vaisseau dans l'éditeur de cale */
function _classLabel(classId) {
  return PRESET_CLASSES[classId]?.name || classId;
}
/** Liste d'options <option> pour le sélecteur de classe de l'éditeur de cale —
 *  toutes les classes connues, triées par taille puis nom (pas de liste figée
 *  : The Roost accueille des appareils variés de mercenaires, pas seulement
 *  une faction). Construite une fois (les classes ne changent pas en jeu). */
const _HANGAR_CLASS_OPTIONS = (() => {
  const SIZE_ORDER = ['XS','S','M','L','XL','XXL'];
  const ids = Object.keys(PRESET_CLASSES).sort((a, b) => {
    const sa = SIZE_ORDER.indexOf(PRESET_CLASSES[a].size || 'M');
    const sb = SIZE_ORDER.indexOf(PRESET_CLASSES[b].size || 'M');
    if (sa !== sb) return sa - sb;
    return (PRESET_CLASSES[a].name || a).localeCompare(PRESET_CLASSES[b].name || b);
  });
  return ids.map(id => `<option value="${id}">${PRESET_CLASSES[id].name || id} (${PRESET_CLASSES[id].size})</option>`).join('');
})();

/**
 * Déploie UN vaisseau RÉEL d'une classe donnée depuis la cale (cargaison) d'une
 * station. Le hangar est un éditeur de cale par VOLUME : le MJ y a placé des
 * classes de vaisseaux en quantité (ds.hangarCargo), chacune consommant un
 * volume selon sa taille. Tant qu'ils ne sont pas déployés, ils n'existent
 * qu'en tant que ligne de cargaison — pas d'entité simulée individuellement,
 * pour ne pas saturer la simulation avec des milliers d'unités inactives.
 *
 * Modèle d'autorité : seul l'HÔTE peut modifier GameState.ships/bg.bodies.
 * Un joueur (window._p2pSendOrder présent) envoie l'ordre à l'hôte au lieu
 * d'agir localement ; l'hôte applique et diffuse le résultat.
 */
function _deployFromHangar(ds, classId, count, ownerFleetId) {
  if (!ds || !ds.hangarCargo) return;
  const entry = ds.hangarCargo.find(c => c.classId === classId && (c.ownerFleetId ?? null) === (ownerFleetId ?? null));
  if (!entry || entry.count <= 0) return;
  const n = Math.max(1, Math.min(count, entry.count));

  // ── Vérification du verrou (côté client, pour message immédiat — la
  //    validation qui compte vraiment se fait côté hôte, voir plus bas).
  //    Le verrou bloque TOUT vaisseau étranger, y compris son propriétaire —
  //    seul le propriétaire de la STATION peut l'outrepasser. ──
  const stationOwnerFleet = ds.faction != null ? GameState.fleets?.find(f => f.colorIndex === ds.faction)?.fleetId : null;
  const isForeignToStation = entry.ownerFleetId != null && entry.ownerFleetId !== stationOwnerFleet;
  const iAmStationOwner = window.SESSION?.isGM || (window.SESSION?.fleetId === stationOwnerFleet);
  if (ds.lockForeignDeparture && isForeignToStation && !iAmStationOwner) {
    addLog(`🔒 Le propriétaire de ${ds.name || 'la station'} bloque ce départ.`, 'move');
    showToast('🔒 Départ bloqué par le propriétaire de la station', false);
    return;
  }

  if (window._p2pSendOrder) {
    window._p2pSendOrder({ type: 'hangar_deploy', dsId: ds.id, classId, count: n, ownerFleetId: entry.ownerFleetId ?? null });
    addLog(`🚀 Demande de décollage envoyée (${n}× ${_classLabel(classId)})…`, 'move');
    return;
  }
  _applyHangarDeploy(ds, classId, n, ownerFleetId);
}

/** Applique réellement le déploiement (HÔTE uniquement). */
function _applyHangarDeploy(ds, classId, n, ownerFleetId) {
  const entry = ds.hangarCargo?.find(c => c.classId === classId && (c.ownerFleetId ?? null) === (ownerFleetId ?? null));
  if (!entry || entry.count <= 0) return;
  n = Math.max(1, Math.min(n, entry.count));

  const cs = CONFIG.CELL_SIZE, grid = CONFIG.GRID_COLS * cs;
  const dsWx = (ds.x - 0.5) * grid * 3.5 + grid / 2;
  const dsWy = (ds.y - 0.5) * grid * 3.5 + grid / 2;
  const gx = clamp(dsWx / cs, 4, CONFIG.GRID_COLS - 4);
  const gy = clamp(dsWy / cs, 4, CONFIG.GRID_ROWS - 4);

  // Le vaisseau redevient la propriété de SON pilote d'origine (entry.ownerFleetId),
  // pas de la faction de la station — un vaisseau étranger garé ailleurs reste
  // celui de son propriétaire quand il redécolle.
  const targetFleetId = entry.ownerFleetId ?? (ds.faction != null ? GameState.fleets?.find(f => f.colorIndex === ds.faction)?.fleetId : null);

  const spawned = [];
  for (let i = 0; i < n; i++) {
    const offset = (i - n/2) * 1.4;
    try {
      const ship = instantiatePreset(classId, {
        fleetId: targetFleetId,
        position: { x: gx + offset, y: gy + (Math.random()-0.5)*2, z: 3 },
      }, createShip);
      if (ship.fleetId) { GameState.ships.push(ship); spawned.push(ship); }
    } catch (e) { /* classe inconnue — ignorer silencieusement */ }
  }
  if (spawned.length) {
    entry.count -= spawned.length;
    if (entry.count <= 0) ds.hangarCargo = ds.hangarCargo.filter(c => c !== entry);
    addLog(`🚀 ${ds.name || 'Station'} : décollage de ${spawned.length}× ${_classLabel(classId)} (${entry.count > 0 ? entry.count + ' restants' : 'classe épuisée'})`, 'move');
    showToast(`🚀 ${spawned.length}× ${_classLabel(classId)} décolle(nt) de ${ds.name || 'la station'}`, true);
    renderDSGlobalRefresh();
    if (window._p2pBroadcast) {
      window._p2pBroadcast({ type:'background', background: GameState.background });
      window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
    }
  }
}
/** Rafraîchit l'onglet station après un déploiement (si exposé) */
function renderDSGlobalRefresh() { if (window._renderDS) window._renderDS(); }

function _applyUndock(ship) {
  if (!ship._dockedInShipId) return;
  const host = GameState.ships.find(s => s.id === ship._dockedInShipId);
  applyUndock(ship, host);
  addLog(`🔓 ${ship.name} désamarré.`, 'move');
  showToast(`🔓 ${ship.name} désamarré`, true);
  ui.updateSelectedShip(ship.id);
  if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
}

/**
 * Modal MJ d'édition d'un vaisseau EN COURS DE PARTIE.
 * Permet de modifier nom, statistiques, équipement, équipage et cale
 * sans quitter la partie. Toutes les modifications sont immédiatement
 * diffusées aux joueurs connectés via broadcast.
 */
function _openGMEditModal(shipId) {
  const ship = GameState.ships.find(s => s.id === shipId);
  if (!ship) return;
  document.getElementById('gm-edit-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'gm-edit-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center';

  const card = document.createElement('div');
  card.style.cssText = 'background:#080d18;border:1px solid #2a3550;border-radius:8px;padding:16px;width:420px;max-width:95vw;max-height:90vh;overflow-y:auto;color:#c8d8ff;font-family:monospace;font-size:11px';

  const field = (id, label, value, type='number', extra='') =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <label style="min-width:130px;color:#6b7a9e">${label}</label>
      <input id="gm-f-${id}" type="${type}" value="${value}" ${extra} style="flex:1;background:#0a1018;border:1px solid #2a3550;color:#c8d8ff;border-radius:4px;padding:3px 6px;font-family:monospace;font-size:11px">
    </div>`;
  const check = (id, label, checked) =>
    `<label style="display:flex;gap:8px;align-items:center;margin-bottom:7px;cursor:pointer">
      <input id="gm-f-${id}" type="checkbox" ${checked?'checked':''}>
      <span style="color:#6b7a9e">${label}</span>
    </label>`;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="font-size:13px;color:#4a9eff;font-weight:bold">✏ Modifier — ${ship.name}</span>
      <button id="gm-edit-close" style="background:none;border:none;color:#6b7a9e;font-size:16px;cursor:pointer">✕</button>
    </div>
    <div style="color:#4a9eff;font-size:10px;letter-spacing:1px;margin-bottom:8px">IDENTITÉ</div>
    ${field('name','Nom',ship.name,'text')}
    <div style="color:#4a9eff;font-size:10px;letter-spacing:1px;margin:10px 0 8px">ÉTAT DE COMBAT</div>
    ${field('hp','PV actuels',Math.round(ship.hp),'number','min=0')}
    ${field('maxHp','PV max',ship.maxHp,'number','min=1')}
    ${field('shieldCurrent','Bouclier actuel',Math.round(ship.shields?.current??0),'number','min=0')}
    ${field('shieldMax','Bouclier max',ship.shields?.max??0,'number','min=0')}
    ${field('hullArmor','Blindage coque',ship.hullArmor||0,'number','min=0 max=90 step=5')}
    ${field('speed','Vitesse',(ship.speed||2).toFixed(2),'number','min=0.1 step=0.1')}
    <div style="color:#4a9eff;font-size:10px;letter-spacing:1px;margin:10px 0 8px">ÉQUIPAGE & PILOTE</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <label style="min-width:130px;color:#6b7a9e">Niveau pilote</label>
      <select id="gm-f-pilotLevel" style="flex:1;background:#0a1018;border:1px solid #2a3550;color:#c8d8ff;border-radius:4px;padding:3px 6px">
        ${[1,2,3,4,5].map(l=>`<option value="${l}" ${(ship.pilotLevel||1)===l?'selected':''}>${l} — ${{1:'Rookie',2:'Vétéran',3:'As',4:'Élite',5:'Légendaire'}[l]}</option>`).join('')}
      </select>
    </div>
    ${field('crewCapacity','Cap. équipage',ship.crewCapacity||0,'number','min=0')}
    ${field('crewCount','Équipage actuel',ship.crewCount||0,'number','min=0')}
    ${field('passengerCapacity','Cap. passagers',ship.passengerCapacity||0,'number','min=0')}
    ${field('passengerCount','Passagers actuels',ship.passengerCount||0,'number','min=0')}
    ${field('medicalCapacity','Cap. médicale',ship.medicalCapacity||0,'number','min=0')}
    ${field('brigCapacity','Cap. cellules',ship.brigCapacity||0,'number','min=0')}
    ${field('woundedCount','Blessés actuels',ship.woundedCount||0,'number','min=0')}
    ${field('captiveCount','Captifs actuels',ship.captiveCount||0,'number','min=0')}
    <div style="color:#4a9eff;font-size:10px;letter-spacing:1px;margin:10px 0 8px">ÉQUIPEMENT</div>
    ${field('scanner','Portée scanner (cases)',ship.scanner||0,'number','min=0')}
    ${field('tractorBeam','Rayon tracteur (cases)',ship.tractorBeam||0,'number','min=0')}
    ${field('gravityWell','Puits de gravité (cases)',ship.gravityWell||0,'number','min=0')}
    ${field('cargoVolume','Volume cale marchande',ship.cargoVolume||0,'number','min=0')}
    ${check('cargoEject','Éjection de cargaison', ship.cargoEject)}
    <div style="display:flex;gap:8px;margin-top:14px">
      <button id="gm-edit-save" style="flex:1;padding:8px;background:#1a3060;border:1px solid #4a9eff;color:#4a9eff;border-radius:4px;cursor:pointer;font-family:monospace">💾 Appliquer</button>
      <button id="gm-edit-cancel" style="padding:8px 16px;background:#1a1018;border:1px solid #aa4444;color:#ff9090;border-radius:4px;cursor:pointer;font-family:monospace">Annuler</button>
    </div>`;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('gm-edit-close').onclick   = close;
  document.getElementById('gm-edit-cancel').onclick  = close;

  document.getElementById('gm-edit-save').onclick = () => {
    const g = id => document.getElementById('gm-f-' + id);
    const num = (id, fallback=0) => Math.max(0, parseFloat(g(id)?.value) || fallback);
    const str = id => g(id)?.value?.trim() || ship.name;
    const chk = id => !!(g(id)?.checked);

    ship.name         = str('name');
    ship.hp           = Math.min(num('hp'), num('maxHp',1));
    ship.maxHp        = Math.max(1, num('maxHp',1));
    ship.hullArmor    = Math.min(90, num('hullArmor'));
    ship.speed        = Math.max(0.1, parseFloat(g('speed')?.value) || ship.speed);
    if (ship.shields) {
      ship.shields.max     = num('shieldMax');
      ship.shields.current = Math.min(num('shieldCurrent'), ship.shields.max);
    }
    ship.pilotLevel      = parseInt(g('pilotLevel')?.value) || 1;
    ship.medicalCapacity = num('medicalCapacity');
    ship.brigCapacity    = num('brigCapacity');
    ship.woundedCount    = Math.min(num('woundedCount'), ship.medicalCapacity);
    ship.captiveCount    = Math.min(num('captiveCount'),  ship.brigCapacity);
    ship.crewCapacity    = num('crewCapacity');
    ship.crewCount       = Math.min(num('crewCount'), ship.crewCapacity);
    ship.passengerCapacity = num('passengerCapacity');
    ship.passengerCount    = Math.min(num('passengerCount'), ship.passengerCapacity);
    ship.scanner         = num('scanner');
    ship.tractorBeam     = num('tractorBeam');
    ship.gravityWell     = num('gravityWell');
    ship.cargoVolume     = num('cargoVolume');
    ship.cargoEject      = chk('cargoEject');

    addLog(`✏ ${ship.name} modifié par le MJ.`, 'move');
    showToast(`✏ ${ship.name} modifié`, true);
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
    ui.updateSelectedShip(shipId);
    close();
  };
}

/**
 * Éjecte toute la cargaison d'un vaisseau dans l'espace sous forme de
 * conteneurs flottants. Chaque ligne de cargoHold devient un vaisseau inerte
 * de taille XS (« conteneur ») positionné autour de l'éjecteur, récupérable
 * via rayon tracteur. Le vaisseau source se retrouve avec une cale vide.
 */
function _applyCargoEject(ship) {
  if (!ship.cargoHold?.length) return;
  const spawned = [];
  ship.cargoHold.forEach((entry, i) => {
    const angle  = (i / ship.cargoHold.length) * Math.PI * 2;
    const spread = 1.5 + Math.random();
    const cx = clamp(ship.position.x + Math.cos(angle) * spread, 1, CONFIG.GRID_COLS - 2);
    const cy = clamp(ship.position.y + Math.sin(angle) * spread, 1, CONFIG.GRID_ROWS - 2);
    const container = createShip({
      classId: 'container', type: 'container',
      name: `📦 Conteneur (${CARGO_TYPES[entry.type]?.label || entry.type})`,
      fleetId: ship.fleetId, // appartient encore à l'éjecteur pour le fog of war
      size: 'XS', mass: 1, hp: 10, maxHp: 10,
      speed: 0, weapons: [],
      behavior: { mode: 'passive' },
      position: { x: cx, y: cy, z: ship.position.z },
      cargoVolume: 50, cargoHold: [{ type: entry.type, count: entry.count }],
      // Inerte : pas d'IA, ne tire pas, ne se déplace pas
      tractorBeam: 0, gravityWell: 0, scanner: 0, cargoEject: false,
    });
    container._isContainer = true; // marqueur pour l'UI/rendu
    GameState.ships.push(container);
    spawned.push(container);
  });
  const ejectedCount = ship.cargoHold.length;
  ship.cargoHold = [];
  addLog(`📦 ${ship.name} éjecte ${ejectedCount} conteneur(s) dans l'espace.`, 'move');
  showToast(`📦 ${ejectedCount} conteneur(s) éjecté(s)`, true);
  ui.updateSelectedShip(ship.id);
  if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
}

/**
 * Applique réellement un transfert de cargaison d'un vaisseau vers un autre
 * (HÔTE uniquement — fait autorité sur GameState). Vérifie l'espace
 * disponible dans la cale destinataire avant de déplacer la marchandise.
 * Retourne true si le transfert a eu lieu.
 */
function _applyCargoTransfer(source, cargoIndex, dest) {
  const entry = source?.cargoHold?.[cargoIndex];
  if (!source || !entry || !dest) return false;
  if ((dest.cargoVolume || 0) <= 0) {
    addLog(`✖ ${dest.name} n'a pas de cale marchande.`, 'move');
    showToast(`${dest.name} n'a pas de cale marchande`, false);
    return false;
  }
  const unitVol = CARGO_TYPES[entry.type]?.unitVolume || 1;
  const destUsed = (dest.cargoHold || []).reduce((s,c) => s + (CARGO_TYPES[c.type]?.unitVolume||1)*c.count, 0);
  const needed = unitVol * entry.count;
  if (destUsed + needed > (dest.cargoVolume || 0)) {
    addLog(`✖ Cale de ${dest.name} insuffisante pour ce transfert.`, 'move');
    showToast(`Cale de ${dest.name} insuffisante pour ce transfert`, false);
    return false;
  }
  dest.cargoHold = dest.cargoHold || [];
  const destExisting = dest.cargoHold.find(c => c.type === entry.type);
  if (destExisting) destExisting.count += entry.count;
  else dest.cargoHold.push({ type: entry.type, count: entry.count });
  source.cargoHold.splice(cargoIndex, 1);
  addLog(`↪ ${entry.count}× ${CARGO_TYPES[entry.type]?.label || entry.type} transféré(s) de ${source.name} vers ${dest.name}.`, 'move');
  showToast(`↪ Transfert vers ${dest.name} réussi`, true);
  ui.updateSelectedShip(dest.id);
  if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
  return true;
}


/**
 * Demande l'atterrissage d'un vaisseau sur une station ou planète. Si elle appartient
 * à une AUTRE faction que celle du vaisseau, demande confirmation (on ne sait
 * pas si on sera bien accueilli chez quelqu'un d'autre). Une fois confirmé,
 * l'ordre est posé sur le vaisseau ; sa résolution physique (approche puis
 * arrivée hors-grille) est gérée par processStationDocking() dans simulation.js.
 */
function _requestDockAtStation(shipId, station) {
  const ship = GameState.ships.find(s => s.id === shipId && s.alive);
  if (!ship) return;
  const isForeign = station.faction != null && station.faction !== _shipFactionColorIndex(ship);
  const stationLabel = station.name || STATION_TYPES[station.type]?.label || 'la station';

  const proceed = () => {
    if (window._p2pSendOrder) {
      window._p2pSendOrder({ type:'order', subtype:'dockStation', shipId, stationId: station.id });
    } else {
      _applyDockStationOrder(shipId, station.id);
    }
    addLog(`🛰 ${ship.name} se dirige vers ${stationLabel}.`, 'move');
    showToast(`🛬 Cap sur ${stationLabel}`, true);
  };

  if (isForeign) {
    const ownerName = (GameState.activeFactions || []).find(f => f.colorIndex === station.faction)?.name || 'une autre faction';
    if (!confirm(`${stationLabel} appartient à ${ownerName}. Demander l'autorisation d'amarrage ?`)) {
      addLog(`✖ Atterrissage annulé.`, 'move');
      return;
    }
  }
  proceed();
}

/** Faction (colorIndex) du vaisseau, via sa flotte */
function _shipFactionColorIndex(ship) {
  return (GameState.fleets || []).find(f => f.fleetId === ship.fleetId)?.colorIndex ?? null;
}

/** Pose l'ordre d'atterrissage sur un vaisseau (HÔTE — modifie GameState.ships). */
function _applyDockStationOrder(shipId, stationId) {
  const ship = GameState.ships.find(s => s.id === shipId && s.alive);
  if (!ship) return;
  ship.orders = { type: 'dockStation', stationId };
}


function _armDeathStarFire(ds, kind) {
  GameState.pendingOrder = { type: 'deathstar_fire', ds, kind: kind || 'ship' };
  if (kind === 'body') {
    addLog(`🪐 ${ds.name || 'Étoile de la Mort'} : cliquez la PLANÈTE cible (à l'arrière-plan).`, 'death');
    // Activer le mode de désignation de planète dans le renderer
    renderer._bodyTargetMode = true;
    renderer._bodyTargetKind = 'planet';
  } else {
    addLog(`🎯 ${ds.name || 'Étoile de la Mort'} : cliquez le VAISSEAU cible.`, 'death');
  }
  SFX?.click?.();
}

function _buildFactionUI() {
  const fleets    = GameState.fleets;
  const diplomacy = GameState.diplomacy || {};

  // GM faction selector
  const gmSel = document.getElementById('gm-active-faction');
  if (gmSel) {
    gmSel.innerHTML = '<option value="">— Toutes les factions (MJ) —</option>' +
      fleets.map(f =>
        `<option value="${f.fleetId}" style="color:${FACTION_COLORS[f.colorIndex] || '#aaa'}">${f.name || f.fleetId}</option>`
      ).join('');
    gmSel.onchange = () => { GameState.gmActiveFaction = gmSel.value || null; };
  }

  // 8 faction slots
  const listEl = document.getElementById('faction-list-container');
  if (listEl) {
    const playerCi = window._p2pFactionCi ?? -1;

    if (playerCi >= 0) {
      // ── Vue joueur : sa faction + diplomatie ────────────────────────
      const myFleet  = fleets.find(f => f.colorIndex === playerCi);
      const myColor  = FACTION_COLORS[playerCi] || '#aaa';
      const myName   = myFleet?.name || FACTION_NAMES_DEFAULT[playerCi] || `Faction ${playerCi}`;
      const diplRows = fleets.filter(f => f.colorIndex !== playerCi).map(f => {
        const color   = FACTION_COLORS[f.colorIndex] || '#aaa';
        const stance  = diplomacy[myFleet?.fleetId]?.[f.fleetId] || 'conflict';
        const stanceLabel = { conflict:'⚔ Conflit', neutral:'🤝 Neutre', allied:'🤝 Allié' }[stance] || stance;
        const stanceColor = { conflict:'#ff6666', neutral:'#aaa', allied:'#66ff88' }[stance] || '#aaa';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-bottom:1px solid #1e2740">
          <div style="display:flex;align-items:center;gap:5px">
            <div style="width:7px;height:7px;border-radius:50%;background:${color}"></div>
            <span style="color:${color};font-size:11px">${f.name || FACTION_NAMES_DEFAULT[f.colorIndex] || f.fleetId}</span>
          </div>
          <select data-diplo-from="${myFleet?.fleetId}" data-diplo-to="${f.fleetId}"
            style="background:#070c14;border:1px solid ${stanceColor}44;color:${stanceColor};font-size:10px;padding:1px 4px;border-radius:3px;cursor:pointer">
            <option value="conflict" ${stance==='conflict'?'selected':''}>⚔ Conflit</option>
            <option value="neutral"  ${stance==='neutral' ?'selected':''}>🤝 Neutre</option>
            <option value="allied"   ${stance==='allied'  ?'selected':''}>💚 Allié</option>
          </select>
        </div>`;
      }).join('');
      listEl.innerHTML = `
        <div style="border-left:4px solid ${myColor};padding:8px 10px;background:#080d18;border-radius:0 6px 6px 0;margin-bottom:10px">
          <div style="color:${myColor};font-weight:bold;font-size:13px">${myName}</div>
          <div style="color:#6b7a9e;font-size:10px;margin-top:2px">Votre faction</div>
        </div>
        <div style="color:#9aafcc;font-size:10px;font-weight:bold;padding:4px 6px;margin-bottom:4px">🤝 Diplomatie</div>
        ${diplRows || '<div style="color:#3a4a60;font-size:10px;padding:8px">Aucune autre faction active</div>'}`;

      // Bind diplomacy changes for player
      listEl.querySelectorAll('select[data-diplo-from]').forEach(sel => {
        sel.addEventListener('change', () => {
          if (window._p2pSendOrder) {
            window._p2pSendOrder({ type:'diplomacy', fromFleetId: sel.dataset.diploFrom, toFleetId: sel.dataset.diploTo, stance: sel.value });
          } else {
            setDiplomacy(diplomacy, sel.dataset.diploFrom, sel.dataset.diploTo, sel.value, false);
          }
        });
      });
    } else {
      // ── Vue MJ : toutes les factions ───────────────────────────────
      const rows = FACTION_COLORS.map((color, i) => {
      const fleet  = fleets.find(f => f.colorIndex === i);
      const active = !!fleet;
      const name   = fleet?.name || FACTION_NAMES_DEFAULT[i];
      // Safe URL: encode for use in HTML attribute
      let inviteHtml = '<div style="font-size:9px;color:#4b5a7a;font-style:italic">Activer pour générer le lien</div>';
      if (i === NEUTRAL_FACTION_INDEX) {
        // Le neutre n'est JAMAIS jouable par un client — pas de lien d'invitation,
        // contrôlé uniquement par le MJ depuis cette interface.
        inviteHtml = '<div style="font-size:9px;color:#6b7a9e;font-style:italic">🎭 Flotte(s) neutre(s) — contrôlées par le MJ uniquement, aucune invitation possible</div>';
      } else if (fleet) {
        try {
          // Only show P2P invite (LAN links are useless for remote play)
          if (window._p2pHostId) {
            const role    = `player&faction=${fleet.colorIndex}`;
            const peerUrl = `?join=${window._p2pHostId}&role=${role}`;
            inviteHtml = `
              <div style="font-size:9px;margin-top:3px;color:#6b7a9e">
                Params joueur :
                <code style="color:#cc88ff;font-size:8px">${peerUrl}</code>
                <button data-copy-text="${peerUrl}" class="p2p-copy-btn" style="font-size:8px;padding:0 3px;background:#1a0a2a;border:1px solid #aa44ff;color:#aa44ff;border-radius:2px;cursor:pointer">📋</button>
              </div>`;
          }
        } catch(e) {}
      }
      return `<div style="border-left:3px solid ${color};margin-bottom:6px;padding:5px 8px;background:#080d18;border-radius:0 4px 4px 0">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
          <span style="color:${color};font-size:11px">◆</span>
          <input value="${(name||'').replace(/"/g,'&quot;')}" data-faction-name-idx="${i}"
            style="flex:1;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;padding:2px 5px;font-size:11px;border-radius:3px">
          <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:#6b7a9e;white-space:nowrap">
            <input type="checkbox" data-faction-active-idx="${i}" ${active ? 'checked' : ''}> Active
          </label>
        </div>
        ${inviteHtml}
      </div>`;
    });
    listEl.innerHTML = rows.join('');

    // Bind copy buttons (works on HTTP, not just HTTPS)
    listEl.querySelectorAll('[data-copy-url],[data-copy-text],[class*="p2p-copy"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = btn.dataset.copyText || btn.dataset.copyUrl || btn.dataset.url || '';
        if (!text) return;
        _copyToClipboard(text, btn);
      });
    });
    listEl.querySelectorAll('[data-faction-active-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx   = parseInt(cb.dataset.factionActiveIdx);
        // Read the current name from the input
        const nameInput = listEl.querySelector(`[data-faction-name-idx="${idx}"]`);
        const name  = nameInput?.value.trim() || FACTION_NAMES_DEFAULT[idx];
        const existing = GameState.fleets.find(f => f.colorIndex === idx);

        if (cb.checked && !existing) {
          const fleet = createFleet({ name, colorIndex: idx, active: true });
          GameState.fleets.push(fleet);
          GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));
          // Track in activeFactions
          if (!GameState.activeFactions) GameState.activeFactions = [];
          const existing_af = GameState.activeFactions.find(f => f.colorIndex === idx);
          if (existing_af) { existing_af.name = name; }
          else GameState.activeFactions.push({ colorIndex: idx, name });
          addLog(`✅ Faction ${name} activée`, 'move');
        } else if (!cb.checked && existing) {
          GameState.fleets = GameState.fleets.filter(f => f.colorIndex !== idx);
          delete GameState.diplomacy[existing.fleetId];
          Object.values(GameState.diplomacy).forEach(d => delete d[existing.fleetId]);
          GameState.activeFactions = (GameState.activeFactions||[]).filter(f => f.colorIndex !== idx);
          addLog(`❌ Faction désactivée`, 'move');
        }
        ui.updateFleetList();
        setTimeout(_buildFactionUI, 50);
      });
    });

    // Bind name edits — update both fleet name AND activeFactions
    listEl.querySelectorAll('[data-faction-name-idx]').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx   = parseInt(inp.dataset.factionNameIdx);
        const fleet = fleets.find(f => f.colorIndex === idx);
        if (fleet) fleet.name = inp.value;
        const af = (GameState.activeFactions||[]).find(f => f.colorIndex === idx);
        if (af) af.name = inp.value;
      });
    });
    } // end else (GM view)
  }

  // Diplomacy matrix
  const matrixEl = document.getElementById('diplomacy-matrix');
  if (matrixEl && fleets.length > 1) {
    // Pass player's fleet ID to restrict editing to their own faction rows
    const playerFleetId = window._p2pFactionFleetId || null;
    try { _renderDiplomacyMatrix(fleets, diplomacy, matrixEl, playerFleetId); } catch(e) {}
  }

  // Vote buttons
  const btnForce = document.getElementById('btn-force-advance');
  if (btnForce && !btnForce._bound) {
    btnForce._bound = true;
    btnForce.addEventListener('click', () => {
      window._voteManager?.forceAdvance();
      addLog('⏩ Step forcé par le MJ', 'move');
    });
  }

  // ── Mid-game: Add fleet to terrain ───────────────────────
  const fleetSelEl   = document.getElementById('midgame-fleet-sel');
  const factionSelEl = document.getElementById('midgame-faction-sel');
  if (fleetSelEl && factionSelEl) {
    const fleetLib2 = loadFleetLibrary();
    // ── Sélecteur de flotte : toutes les flottes, sans contrainte de faction ──
    // La faction cible est choisie séparément dans midgame-faction-sel.
    // N'importe quelle flotte peut être assignée à n'importe quelle faction.
    while (fleetSelEl.firstChild) fleetSelEl.removeChild(fleetSelEl.firstChild);
    const fOpt0 = document.createElement('option');
    fOpt0.value = ''; fOpt0.textContent = '— Choisir une flotte —';
    fleetSelEl.appendChild(fOpt0);
    for (const f of fleetLib2) {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.name + ' (' + (f.ships ? f.ships.length : 0) + ' vaisseaux)';
      fleetSelEl.appendChild(o);
    }
    // Réafficher le sélecteur de faction (indépendant du choix de flotte)
    factionSelEl.style.display = '';
    fleetSelEl.style.flex = '';

    // Build faction options via DOM
    const afs = (GameState.activeFactions && GameState.activeFactions.length)
      ? GameState.activeFactions
      : FACTION_COLORS.map(function(c, i) { return { colorIndex: i, name: FACTION_NAMES_DEFAULT[i] }; });
    while (factionSelEl.firstChild) factionSelEl.removeChild(factionSelEl.firstChild);
    const fOpt1 = document.createElement('option'); fOpt1.value = ''; fOpt1.textContent = '— Faction cible —'; factionSelEl.appendChild(fOpt1);
    for (const f of afs) {
      const o = document.createElement('option');
      o.value = String(f.colorIndex);  // explicit string
      o.textContent = f.name;
      o.style.color = FACTION_COLORS[f.colorIndex] || '#aaa';
      factionSelEl.appendChild(o);
    }
    // Peupler le dropdown des points d'arrivée hyperespace
    const arrivalSel = document.getElementById('midgame-arrival-sel');
    if (arrivalSel) {
      while (arrivalSel.firstChild) arrivalSel.removeChild(arrivalSel.firstChild);
      const a0 = document.createElement('option');
      a0.value = ''; a0.textContent = '🌀 Point d\'arrivée : auto';
      arrivalSel.appendChild(a0);
      (GameState.hyperspaceRoutes || []).forEach((r, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `🌀 Point ${i + 1} (${Math.round(r.x)}, ${Math.round(r.y)})`;
        arrivalSel.appendChild(o);
      });
    }
  }

  // Clone button to remove stale listeners, then rebind fresh
  const btnAddFleetOld = document.getElementById('btn-midgame-add-fleet');
  if (btnAddFleetOld && btnAddFleetOld.parentNode) {
    const btnAddFleet = btnAddFleetOld.cloneNode(true);
    btnAddFleetOld.parentNode.replaceChild(btnAddFleet, btnAddFleetOld);
    btnAddFleet.addEventListener('click', async function() {
      const fSel  = document.getElementById('midgame-fleet-sel');
      const cSel  = document.getElementById('midgame-faction-sel');
      const fid   = fSel ? fSel.value : '';
      const ciStr = cSel ? cSel.value : '';
      const ci    = parseInt(ciStr, 10);
      if (!fid)      return alert('Choisir une flotte.');
      if (isNaN(ci)) return alert('Choisir une faction cible.');

      const libFleet = loadFleetLibrary().find(f => f.id === fid || f.fleetId === fid);
      if (!libFleet) return;

      // Point d'hyperespace d'arrivée choisi dans le menu déroulant
      const arrivalSel = document.getElementById('midgame-arrival-sel');
      const arrivalVal = arrivalSel?.value;
      const arrivalIdx = (arrivalVal !== '' && arrivalVal != null) ? parseInt(arrivalVal) : null;

      const placed = await _deployFleetToGame(libFleet, ci, arrivalIdx);
      ui.updateFleetList();
      _buildFactionUI();
      addLog(`🌀 ${placed} vaisseau(x) déployé(s)`, 'move');
    });
  }


  // ─── P2P Invite modal ────────────────────────────────────────
  const p2pEl = document.getElementById('p2p-info-box');
  if (!p2pEl) return;

  const pid = window._p2pHostId;
  if (!pid) {
    p2pEl.innerHTML = '<div style="color:#6b7a9e;font-size:10px;padding:8px">⏳ P2P en cours de démarrage…</div>';
    const inviteBtn = document.getElementById('btn-invite');
    if (inviteBtn) inviteBtn.style.display = '';
    return;
  }

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const factions = GameState.activeFactions || [];

  // Build link cards for a given base URL
  function buildLinkCards(base) {
    const makeCard = (label, url, color) =>
      `<div style="margin-bottom:10px;padding:10px;background:#0a1020;border:1px solid ${color}44;border-radius:6px">
        <div style="color:${color};font-size:11px;font-weight:bold;margin-bottom:5px">${label}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input readonly value="${url}" onclick="this.select()"
            style="flex:1;background:#070c14;border:1px solid ${color}66;color:#c8d8ff;font-size:9px;padding:4px 6px;border-radius:4px;font-family:monospace">
          <button class="p2p-copy-btn" data-text="${url}"
            style="white-space:nowrap;padding:4px 10px;background:#1a0a2a;border:1px solid ${color};color:${color};border-radius:4px;font-size:10px;cursor:pointer">
            📋
          </button>
        </div>
      </div>`;

    return factions.map(f =>
      makeCard('🎮 ' + f.name, base + '?join=' + pid + '&role=player&faction=' + f.colorIndex, FACTION_COLORS[f.colorIndex] || '#aaa')
    ).join('') + makeCard('👁 Spectateur', base + '?join=' + pid + '&role=spectator', '#4a9eff');
  }

  function bindCopyBtns() {
    p2pEl.querySelectorAll('.p2p-copy-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); _copyToClipboard(btn.dataset.text, btn); });
    });
  }

  // If already on a public URL (cloudflare tunnel detected), show links directly
  const isTunnel = location.hostname.endsWith('.trycloudflare.com')
                || location.hostname.endsWith('.serveo.net')
                || location.hostname.endsWith('.loca.lt');

  if (!isLocal || isTunnel) {
    const base2 = location.origin + location.pathname;
    p2pEl.innerHTML = `
      <div style="background:#0a1a0a;border:1px solid #44aa44;border-radius:6px;padding:8px 10px;margin-bottom:12px">
        <span style="color:#66cc66;font-size:11px">✅ Mode en ligne actif</span>
      </div>` + buildLinkCards(base2);
    bindCopyBtns();
    document.getElementById('btn-invite').style.display = '';
    return;
  }

  // Local mode — show Mode en ligne button
  const currentTunnelUrl = window._tunnelUrl || null;

  if (currentTunnelUrl) {
    // Tunnel already active — show links with cloudflare URL
    p2pEl.innerHTML = `
      <div style="background:#0a1a0a;border:1px solid #44aa44;border-radius:6px;padding:8px 10px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
        <span style="color:#66cc66;font-size:11px">✅ Tunnel actif</span>
        <button id="btn-tunnel-stop" style="padding:2px 8px;background:#1a0a0a;border:1px solid #aa4444;color:#ff6666;border-radius:4px;font-size:9px;cursor:pointer">⏹ Arrêter</button>
      </div>
      <div style="color:#6b7a9e;font-size:9px;margin-bottom:10px;word-break:break-all">🌐 ${currentTunnelUrl}</div>` +
      buildLinkCards(currentTunnelUrl + '/');
    bindCopyBtns();
    p2pEl.querySelector('#btn-tunnel-stop')?.addEventListener('click', async () => {
      await fetch('/api/tunnel/stop');
      window._tunnelUrl = null;
      try { _buildFactionUI(); } catch {}
    });
  } else {
    // No tunnel — show Mode en ligne button
    p2pEl.innerHTML = `
      <div style="margin-bottom:14px">
        <div style="color:#9aafcc;font-size:10px;line-height:1.5;margin-bottom:10px">
          Les liens locaux ne fonctionnent qu'en réseau local.<br>
          Cliquez sur <strong style="color:#cc88ff">Mode en ligne</strong> pour obtenir une URL publique sécurisée que vos amis pourront ouvrir depuis n'importe où.
        </div>
        <button id="btn-start-tunnel"
          style="width:100%;padding:10px;background:linear-gradient(135deg,#1a0a2a,#2a1040);border:1px solid #aa44ff;color:#cc88ff;border-radius:6px;font-size:13px;cursor:pointer;font-weight:bold;transition:all 0.2s">
          🌐 Mode en ligne
        </button>
        <div id="tunnel-status" style="margin-top:8px;font-size:9px;color:#6b7a9e;text-align:center"></div>
      </div>
      <div style="border-top:1px solid #1a2540;padding-top:10px;margin-top:4px">
        <div style="color:#6b7a9e;font-size:9px;margin-bottom:6px">Liens réseau local seulement :</div>` +
      buildLinkCards(location.origin + location.pathname) + '</div>';

    bindCopyBtns();

    p2pEl.querySelector('#btn-start-tunnel')?.addEventListener('click', async function() {
      const btn    = this;
      const status = p2pEl.querySelector('#tunnel-status');
      btn.disabled = true;
      btn.textContent = '⏳ Démarrage du tunnel…';
      btn.style.opacity = '0.6';
      if (status) status.textContent = 'Connexion à Cloudflare…';

      try {
        // Start tunnel (server auto-télécharge cloudflared si absent)
        await fetch('/api/tunnel/start');

        // Poll until URL is available (max 60s — includes potential download time)
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const r2 = await fetch('/api/tunnel/status');
            const d2 = await r2.json();

            if (d2.url) {
              clearInterval(poll);
              window._tunnelUrl = d2.url;
              try { _buildFactionUI(); } catch {}

            } else if (d2.status === 'downloading') {
              const pct = d2.progress || 0;
              btn.textContent = `⬇ Téléchargement… ${pct}%`;
              if (status) status.innerHTML =
                `<div style="background:#1a1a2a;border-radius:3px;height:4px;margin-top:4px">
                   <div style="background:#aa44ff;height:4px;border-radius:3px;width:${pct}%;transition:width 0.3s"></div>
                 </div>`;

            } else if (d2.status === 'starting') {
              btn.textContent = '⏳ Connexion à Cloudflare…';
              if (status) status.textContent = `Démarrage du tunnel… (${attempts}s)`;

            } else if (d2.error) {
              clearInterval(poll);
              btn.disabled = false; btn.textContent = '🌐 Mode en ligne'; btn.style.opacity = '1';
              if (status) status.textContent = `❌ ${d2.error}`;

            } else if (attempts > 60) {
              clearInterval(poll);
              btn.disabled = false; btn.textContent = '🌐 Mode en ligne'; btn.style.opacity = '1';
              if (status) status.textContent = '⚠ Délai dépassé — relancez le serveur';
            }
          } catch { clearInterval(poll); }
        }, 1000);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '🌐 Mode en ligne';
        btn.style.opacity = '1';
        if (status) status.textContent = '❌ Serveur inaccessible — utilisez node server.cjs';
      }
    });
  }

  document.getElementById('btn-invite').style.display = '';

  // Refresh connected-players display
  try { _updateConnectionStatus(window._p2pConnections); } catch {}

  // Transfer ship between fleets
  const shipSelEl  = document.getElementById('transfer-ship-sel');
  const fleetTgtEl = document.getElementById('transfer-fleet-sel');
  if (shipSelEl && fleetTgtEl) {
    shipSelEl.innerHTML = '<option value="">--- Vaisseau ---</option>'
      + GameState.ships.filter(function(s) { return s.alive; }).map(function(s) {
        const fl = GameState.fleets.find(function(f) { return f.fleetId === s.fleetId; });
        return '<option value="' + s.id + '">[' + (fl ? fl.name : '?') + '] ' + s.name + '</option>';
      }).join('');
    fleetTgtEl.innerHTML = '<option value="">Flotte cible</option>'
      + GameState.fleets.map(function(f) {
        const c = FACTION_COLORS[f.colorIndex % 8] || '#aaa';
        return '<option value="' + f.fleetId + '" style="color:' + c + '">' + f.name + '</option>';
      }).join('');
  }

  const btnTransfer = document.getElementById('btn-transfer-ship');
  if (btnTransfer) {
    // Always re-bind (remove previous listener by replacing button clone)
    const fresh = btnTransfer.cloneNode(true);
    btnTransfer.parentNode.replaceChild(fresh, btnTransfer);
    fresh.addEventListener('click', function() {
      const shipSel  = document.getElementById('transfer-ship-sel');
      const fleetSel = document.getElementById('transfer-fleet-sel');
      const sid = shipSel ? shipSel.value : '';
      const fid = fleetSel ? fleetSel.value : '';
      if (!sid || !fid) { alert('Choisir un vaisseau et une flotte.'); return; }
      const ship   = GameState.ships.find(function(s) { return s.id === sid; });
      const target = GameState.fleets.find(function(f) { return f.fleetId === fid; });
      if (!ship || !target) return;
      const oldFleet = GameState.fleets.find(function(f) { return f.fleetId === ship.fleetId; });
      ship.fleetId = fid;
      // Update faction color fallback
      ship._factionColorIndex = target.colorIndex;
      addLog(ship.name + ' transfere: ' + (oldFleet ? oldFleet.name : '?') + ' -> ' + target.name, 'move');
      ui.updateFleetList();
      _buildFactionUI();
    });
  }

  // ── Spawn d'un vaisseau individuel dans une faction ────────────
  const spawnClassSel   = document.getElementById('spawn-ship-class-sel');
  const spawnFactionSel = document.getElementById('spawn-ship-faction-sel');
  if (spawnClassSel && spawnFactionSel) {
    // Remplir le sélecteur de classes depuis PRESET_CLASSES
    while (spawnClassSel.firstChild) spawnClassSel.removeChild(spawnClassSel.firstChild);
    const d0 = document.createElement('option'); d0.value = ''; d0.textContent = '— Classe de vaisseau —';
    spawnClassSel.appendChild(d0);
    // Grouper par type
    const byType = {};
    Object.entries(PRESET_CLASSES || {}).forEach(([id, cls]) => {
      const t = cls.type || 'other';
      if (!byType[t]) byType[t] = [];
      byType[t].push({ id, cls });
    });
    const typeLabels = { fighter:'Chasseur', bomber:'Bombardier', gunship:'Canonnière',
      corvette:'Corvette', frigate:'Frégate', cruiser:'Croiseur',
      destroyer:'Destroyer', dreadnought:'Dreadnought', assault_ship:'Transport d\'assaut',
      transport:'Transport', shuttle:'Navette', other:'Autre' };
    Object.entries(byType).sort(([a],[b])=>a.localeCompare(b)).forEach(([type, ships]) => {
      const grp = document.createElement('optgroup');
      grp.label = typeLabels[type] || type;
      ships.sort((a,b)=>(a.cls.name||a.id).localeCompare(b.cls.name||b.id)).forEach(({id,cls}) => {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = (cls.name || id) + ' [' + (cls.size || '?') + ']';
        grp.appendChild(o);
      });
      spawnClassSel.appendChild(grp);
    });

    // Remplir le sélecteur de factions
    while (spawnFactionSel.firstChild) spawnFactionSel.removeChild(spawnFactionSel.firstChild);
    const sf0 = document.createElement('option'); sf0.value = ''; sf0.textContent = '— Faction —';
    spawnFactionSel.appendChild(sf0);
    const afs2 = (GameState.activeFactions && GameState.activeFactions.length)
      ? GameState.activeFactions
      : FACTION_COLORS.map((c, i) => ({ colorIndex: i, name: FACTION_NAMES_DEFAULT[i] }));
    afs2.forEach(f => {
      const o = document.createElement('option');
      o.value = String(f.colorIndex);
      o.textContent = f.name;
      o.style.color = FACTION_COLORS[f.colorIndex] || '#aaa';
      spawnFactionSel.appendChild(o);
    });
  }

  const btnSpawnShip = document.getElementById('btn-spawn-single-ship');
  if (btnSpawnShip) {
    const freshSpawn = btnSpawnShip.cloneNode(true);
    btnSpawnShip.parentNode.replaceChild(freshSpawn, btnSpawnShip);
    freshSpawn.addEventListener('click', async function() {
      const classSel   = document.getElementById('spawn-ship-class-sel');
      const facSel     = document.getElementById('spawn-ship-faction-sel');
      const nameInput  = document.getElementById('spawn-ship-name');
      const classId    = classSel?.value;
      const ciStr      = facSel?.value;
      const ci         = parseInt(ciStr, 10);
      if (!classId)    return alert('Choisir une classe de vaisseau.');
      if (isNaN(ci))   return alert('Choisir une faction cible.');

      const shipName = nameInput?.value.trim() || (PRESET_CLASSES[classId]?.name || classId);

      // Trouver ou créer la flotte de la faction cible
      let fleet = GameState.fleets.find(f => f.colorIndex === ci);
      if (!fleet) {
        const af = (GameState.activeFactions||[]).find(f => f.colorIndex === ci);
        fleet = createFleet({ name: af?.name || FACTION_NAMES_DEFAULT[ci], colorIndex: ci, active: true });
        GameState.fleets.push(fleet);
        GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));
      }

      // Point de spawn : hyperspace route de la faction, sinon centre
      const routes = GameState.hyperspaceRoutes || [];
      const afSorted = (GameState.activeFactions||[]).slice().sort((a,b)=>a.colorIndex-b.colorIndex);
      const rank = afSorted.findIndex(f => f.colorIndex === ci);
      const route = routes.length > 0 ? routes[(rank >= 0 ? rank : ci) % routes.length] : null;
      const cx = route?.x ?? Math.round(CONFIG.GRID_COLS / 2);
      const cy = route?.y ?? Math.round(CONFIG.GRID_ROWS / 2);

      const { instantiatePreset: ip } = await import('./presets.js?v=20250617c');
      try {
        const ship = ip(classId, {
          name:               shipName,
          fleetId:            fleet.fleetId,
          _factionColorIndex: ci,
          position:           { x: cx + (Math.random()-0.5)*3, y: cy + (Math.random()-0.5)*3, z: 0 },
        });
        GameState.ships.push(ship);
        if (fleet.shipIds && !fleet.shipIds.includes(ship.id)) fleet.shipIds.push(ship.id);
        if (nameInput) nameInput.value = '';
        addLog(`➕ ${shipName} [${classId}] déployé → ${fleet.name}`, 'move');
        ui.updateFleetList();
        _buildFactionUI();
        if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: window._getSnap?.() });
      } catch(e) {
        console.error('Spawn error:', e);
        alert('Erreur lors du spawn : ' + e.message);
      }
    });
  }
}
function _renderDiplomacyMatrix(fleets, diplomacy, container, playerFleetId = null) {
  const STANCE_LABELS = { conflict: '⚔ Conflit', neutral: '🤝 Neutre', allied: '🛡 Allié' };
  const STANCE_COLORS = { conflict: '#ff3333', neutral: '#9999aa', allied: '#44cc44' };

  // Group fleets by colorIndex → one "faction" per color
  const factionMap = {};
  for (const f of fleets) {
    const ci = f.colorIndex ?? 0;
    if (!factionMap[ci]) {
      const af = GameState.activeFactions?.find(a => a.colorIndex === ci);
      factionMap[ci] = {
        colorIndex: ci, name: f.name || af?.name || FACTION_NAMES_DEFAULT[ci],
        color: FACTION_COLORS[ci] || '#aaa', fleetIds: [],
      };
      if (af?.name) factionMap[ci].name = af.name;
    }
    factionMap[ci].fleetIds.push(f.fleetId);
  }
  const factions = Object.values(factionMap);

  // Show each DIRECTIONAL pair: A→B
  const rows = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = 0; j < factions.length; j++) {
      if (i === j) continue;
      const a = factions[i], b = factions[j];
      const fid_a = a.fleetIds[0], fid_b = b.fleetIds[0];
      const stance = getDiplomacy(diplomacy, fid_a, fid_b);

      // If playerFleetId is set, only allow editing that player's faction rows
      const isPlayerRow = !playerFleetId || a.fleetIds.includes(playerFleetId);
      const disabled    = !isPlayerRow ? 'disabled' : '';
      const opacity     = !isPlayerRow ? 'opacity:0.4;' : '';

      rows.push(`
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;${opacity}">
          <span style="color:${a.color};font-size:10px;font-weight:bold;width:70px;overflow:hidden;white-space:nowrap">${a.name}</span>
          <span style="color:#444;font-size:9px">→</span>
          <span style="color:${b.color};font-size:10px;font-weight:bold;width:70px;overflow:hidden;white-space:nowrap">${b.name}</span>
          <select data-diplo-a="${fid_a}" data-diplo-b="${fid_b}"
            data-all-a='${JSON.stringify(a.fleetIds)}' data-all-b='${JSON.stringify(b.fleetIds)}'
            ${disabled}
            style="flex:1;font-size:9px;background:#0e1520;border:1px solid #2a3550;color:${STANCE_COLORS[stance]};padding:2px;border-radius:2px${!isPlayerRow?';cursor:not-allowed':''}">
            ${Object.entries(STANCE_LABELS).map(([k,v]) =>
              `<option value="${k}" ${k===stance?'selected':''} style="color:${STANCE_COLORS[k]}">${v}</option>`
            ).join('')}
          </select>
        </div>`);
    }
    if (i < factions.length - 1) rows.push('<hr style="border:none;border-top:1px solid #1e2740;margin:3px 0">');
  }

  container.innerHTML = rows.join('') || '<div style="color:#6b7a9e;font-size:11px">Aucune relation.</div>';

  // Bind — only enabled rows (player's own faction)
  container.querySelectorAll('[data-diplo-a]:not([disabled])').forEach(sel => {
    sel.addEventListener('change', () => {
      const idsA = JSON.parse(sel.dataset.allA || '[]');
      const idsB = JSON.parse(sel.dataset.allB || '[]');
      // Only set A→B direction (asymmetric diplomacy)
      for (const fa of idsA) {
        for (const fb of idsB) {
          setDiplomacy(diplomacy, fa, fb, sel.value, false);
        }
      }
      sel.style.color = STANCE_COLORS[sel.value] || '#aaa';
      const fa = factions.find(f => f.fleetIds.includes(sel.dataset.diploA));
      const fb = factions.find(f => f.fleetIds.includes(sel.dataset.diploB));
      addLog(`${fa?.name||'?'} → ${fb?.name||'?'} : ${STANCE_LABELS[sel.value]}`, 'move');

      // If P2P player, broadcast the diplomacy change to host
      if (window._p2pSendOrder) {
        window._p2pSendOrder({
          type: 'diplomacy',
          fromFleetId: idsA[0],
          toFleetId:   idsB[0],
          stance:      sel.value,
        });
      }
    });
  });
}


/**
 * Called by the setup wizard when the GM clicks "Launch".
 * Initializes GameState from the wizard's configuration.
 */
/**
 * Applique un ordre sur un vaisseau :
 *  - Modifie IMMÉDIATEMENT GameState.ships (fonctionne côté joueur ET MJ)
 *  - Si joueur P2P, transmet aussi l'ordre au MJ pour confirmation autoritaire
 */
function _applyShipOrder(order) {
  // ── Application locale immédiate (joueur ET MJ) ──────────────────────
  const { action, shipId, mode, params, targetId, position } = order;
  const ship   = GameState.ships.find(s => s.id === shipId && s.alive);
  const target = targetId ? GameState.ships.find(s => s.id === targetId) : null;

  if (ship) {
    switch (action) {
      case 'setBehavior':
        ship.behavior.mode = mode;
        if (params) Object.assign(ship.behavior, params);
        break;
      case 'attack':
        if (target) {
          ship.permanentOrder = { type: 'attack', targetId };
          ship.attacking      = targetId;
          const maxRange = (ship.weapons?.length > 0)
            ? Math.max(...ship.weapons.map(w => w.range)) : 5;
          if (dist2D(ship.position, target.position) > maxRange * 0.85)
            ship.moveTarget = { ...target.position };
        }
        break;
      case 'moveTo':
        ship.moveTarget = { ...position };
        ship.orders     = { type: 'moveTo', targetPosition: position };
        break;
      case 'kamikaze':
        ship.behavior.mode     = 'kamikaze';
        ship.behavior.targetId = targetId;
        if (target) ship.moveTarget = { ...target.position };
        ship.rammingProfile = ship.rammingProfile || {};
        ship.rammingProfile.enabled     = true;
        ship.rammingProfile.bonusDamage = (ship.mass || 1) * 0.5;
        ship.rammingProfile.pushForce   = 3;
        break;
      case 'bombard':
        if (position) {
          ship.moveTarget     = { ...position };
          ship.orders         = { type: 'moveTo', targetPosition: position };
        }
        if (targetId) ship.permanentOrder = { type: 'attack', targetId };
        break;
    }
  }

  if (ship) SFX.order();

  // ── Transmission P2P au MJ (joueur uniquement) ──────────────────────
  if (window._p2pSendOrder) {
    window._p2pSendOrder({ type: 'order', subtype: 'shipOrder', ...order });
  }
}


/**
 * Deploys a library fleet for the given colorIndex faction.
 * Reuses existing faction fleet slot if available.
 * Applies staggered hyperspace arrival animation.
 */
async function _deployFleetToGame(libFleet, ci, arrivalRouteIdx = null) {
  let fleet = GameState.fleets.find(f => f.colorIndex === ci);
  if (!fleet) {
    const af = (GameState.activeFactions || []).find(f => f.colorIndex === ci);
    fleet = createFleet({ name: af?.name || libFleet.name, colorIndex: ci, active: true });
    GameState.fleets.push(fleet);
  } else {
    fleet.active = true;
  }
  GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));

  const afSorted = (GameState.activeFactions || []).slice().sort((a,b) => a.colorIndex - b.colorIndex);
  const rank   = afSorted.findIndex(f => f.colorIndex === ci);
  const routes = GameState.hyperspaceRoutes;
  // Point d'arrivée explicite si fourni, sinon répartition automatique par rang
  const route  = (arrivalRouteIdx !== null && routes[arrivalRouteIdx])
    ? routes[arrivalRouteIdx]
    : routes.length > 0 ? routes[(rank >= 0 ? rank : ci) % routes.length] : null;
  const cx     = route?.x ?? Math.round(CONFIG.GRID_COLS / 2);
  const cy     = route?.y ?? Math.round(CONFIG.GRID_ROWS / 2);

  const { instantiatePreset: ip } = await import('./presets.js?v=20250617c');
  const { createShip: cs }        = await import('./models.js?v=20250617c');

  let placed = 0;
  for (const tmpl of (libFleet.ships || [])) {
    for (let i = 0; i < (tmpl.qty || 1); i++) {
      try {
        const ship = ip(tmpl.classId, {
          name:               (tmpl.qty||1) > 1 ? `${tmpl.name} ${i+1}` : tmpl.name,
          fleetId:            fleet.fleetId,
          _factionColorIndex: ci,
          pilotType:          tmpl.pilotType,
          pilotLevel:         tmpl.pilotLevel,
          position:           { x: cx, y: cy, z: 3 },
          namedCharacter:     tmpl.namedCharacter,
          ...(tmpl.inventory ? { inventory: tmpl.inventory } : {}),
          ...(tmpl.troops    ? { _troops: tmpl.troops.map(t => ({...t})) } : {}),
        }, cs);
        if (!ship) continue;
        // Hangar personnalisé : remplace les réserves par défaut de la classe
        if (tmpl.hangar?.length && ship.carrier) {
          ship.carrier.reserves = tmpl.hangar.map(h => ({
            classId: h.classId,
            type:    'fighter',
            count:   h.count,
            deployed: 0,
          }));
        }
        ship._pendingArrival = true;
        ship._arrivalSize    = ['XXL','XL','L','M','S','XS'].indexOf(ship.size);
        GameState.ships.push(ship);
        placed++;
      } catch(e) { /* skip */ }
    }
  }

  // Staggered arrival
  const pending  = GameState.ships.filter(s => s.fleetId === fleet.fleetId && s._pendingArrival);
  pending.sort((a,b) => a._arrivalSize - b._arrivalSize);
  const totalDur = Math.min(8000, Math.max(2000, pending.length * 300));
  const perShip  = pending.length > 0 ? totalDur / pending.length : 400;
  const now2     = Date.now();
  const occupied = [];
  pending.forEach((s, idx) => {
    s._pendingArrival    = false;
    s._arrivingFromHyper = true;
    s._arriveStartTime   = now2 + idx * perShip;
    s._arriveDuration    = 1200;
    const ra = (['XXL','XL','L'].includes(s.size) ? 2.5 : s.size === 'M' ? 1.5 : 1.0);
    let bx = cx, by = cy, att = 0;
    while (att < 30) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * 12 + 2;
      bx = clamp(cx + Math.cos(angle) * dist, 2, CONFIG.GRID_COLS - 3);
      by = clamp(cy + Math.sin(angle) * dist, 2, CONFIG.GRID_ROWS - 3);
      if (occupied.every(o => Math.hypot(bx - o.x, by - o.y) > ra + o.ra)) break;
      att++;
    }
    occupied.push({ x: bx, y: by, ra });
    s.position = { x: bx, y: by, z: 3 };
    s.alive    = true;
  });
  return placed;
}

function _startFromConfig(config) {
  const { terrain, hypRoutes, factions } = config;

  // ─── Reset state ──────────────────────────────────────────
  GameState.fleets      = [];
  GameState.ships       = [];
  GameState.explosions  = [];
  GameState.projectiles = [];
  GameState.tick        = 0;
  GameState.paused      = true;
  GameState.activeFactions = (factions || []).map(f => ({
    colorIndex: f.colorIndex, name: f.name,
  }));

  // ─── Create empty fleet placeholder per faction ───────────
  // Ships are deployed by the GM via the fleet editor (Éditeur MJ → Flottes)
  for (const faction of (factions || [])) {
    const fleet = createFleet({ name: faction.name, colorIndex: faction.colorIndex });
    GameState.fleets.push(fleet);
  }
  GameState.diplomacy = createDiplomacyMatrix(GameState.fleets.map(f => f.fleetId));
  if (config.diplomacyMode === 'peace' && GameState.fleets.length > 1) {
    const ids = GameState.fleets.map(f => f.fleetId);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        setDiplomacy(GameState.diplomacy, ids[i], ids[j], 'neutral');
  }

  // ─── Terrain / environment ────────────────────────────────
  GameState.terrainConfig = terrain?.effect || null;
  GameState.terrain       = [];  // physical terrain bodies

  const tc = GameState.terrainConfig;
  if (tc) {
    import('./terrain.js?v=20250617c').then(({ generateDebrisField, generateAsteroidField, generateNebulaClouds, generateIceField }) => {
      const C = CONFIG.GRID_COLS, R = CONFIG.GRID_ROWS;
      if (tc.type === 'debris')       GameState.terrain = generateDebrisField(C, R, 0.35);
      if (tc.type === 'asteroid_field') GameState.terrain = generateAsteroidField(C, R);
      if (tc.type === 'nebula')       GameState.terrain = generateNebulaClouds(C, R);
      if (tc.type === 'ice_field')    GameState.terrain = generateIceField(C, R);
      if (tc.type === 'black_hole') {
        // Gravity well: no physical bodies but add a marker
        GameState.terrain = [{ id:'bh0', type:'black_hole_core', x:C/2, y:R/2, z:0,
          radius:3, mass:0, hp:999999, maxHp:999999, destroyed:false, vx:0, vy:0 }];
      }
      addLog(`🌌 Terrain généré: ${GameState.terrain.length} objets`, 'move');
    });
  }

  // ─── Hyperspace routes — evenly spaced in a ring ──────────
  GameState.hyperspaceRoutes = [];
  const GRID = CONFIG.GRID_COLS;
  for (let i = 0; i < (hypRoutes || 0); i++) {
    const angle = (i / Math.max(1, hypRoutes)) * Math.PI * 2;
    const ringR = GRID * 0.38;
    GameState.hyperspaceRoutes.push({
      id:    `hj${i}`,
      label: String(i + 1),
      x:     Math.round(GRID / 2 + Math.cos(angle) * ringR),
      y:     Math.round(GRID / 2 + Math.sin(angle) * ringR),
    });
  }

  // ─── Camera ──────────────────────────────────────────────
  if (GameState.ships.length) {
    const avgX = GameState.ships.reduce((s, sh) => s + sh.position.x, 0) / GameState.ships.length;
    const avgY = GameState.ships.reduce((s, sh) => s + sh.position.y, 0) / GameState.ships.length;
    renderer.camera.x    = avgX * CONFIG.CELL_SIZE;
    renderer.camera.y    = avgY * CONFIG.CELL_SIZE;
    renderer.camera.zoom = 0.06;
    renderer.camera.tilt = 15;
  }

  // ─── Engine & UI ─────────────────────────────────────────
  initEngine();
  startSimulation();

  window._voteManager = new VoteManager('game', GameState.fleets, () => {
    engine?.tick();
    addLog('✓ Step avancé par vote unanime', 'move');
  });

  ui.updateFleetList();
  // Delay faction UI build to ensure DOM tabs are ready
  setTimeout(() => {
    try { _buildFactionUI(); } catch(e) { console.warn('_buildFactionUI:', e); }
  }, 150);

  addLog(`🚀 Partie lancée — ${GameState.ships.length} vaisseaux / ${GameState.fleets.length} factions`, 'move');
  if (terrain.id !== 'open') addLog(`🌍 Terrain : ${terrain.name}`, 'move');
  if (hypRoutes > 0) addLog(`🌀 ${hypRoutes} route${hypRoutes>1?'s':''} hyperespace disponible${hypRoutes>1?'s':''}`, 'move');

  // ─── P2P hosting (cross-network, no server needed) ──────────
  initHost(
    // onPlayerInput — avec validation par faction du sender
    (orderData, senderMeta = {}) => {
      // ═══ SÉCURITÉ : un joueur ne peut commander QUE sa faction ═══
      const senderCi = senderMeta.faction;
      const senderFactionName = GameState.fleets.find(f => f.colorIndex === senderCi)?.name
        || (senderCi != null ? `Faction ${senderCi}` : 'Spectateur');

      const _ownsShip = (shipId) => {
        if (senderCi == null) return false; // spectateur : aucun ordre
        const s = GameState.ships.find(x => x.id === shipId);
        if (!s) return false;
        const fl = GameState.fleets.find(f => f.fleetId === s.fleetId);
        return (fl?.colorIndex === senderCi) || (s._factionColorIndex === senderCi);
      };
      const _ownsFleet = (fleetId) => {
        if (senderCi == null) return false;
        return GameState.fleets.find(f => f.fleetId === fleetId)?.colorIndex === senderCi;
      };
      const _reject = (what) => {
        addLog(`🚫 ${senderFactionName} : ordre refusé (${what} — pas votre faction)`, 'combat');
      };

      // ═══ Ordre de tir ÉTOILE DE LA MORT (joueur → hôte) ═══
      if (orderData.type === 'deathstar_fire' && orderData.dsId) {
        const ds = GameState.background?.bodies?.find(b => b.id === orderData.dsId);
        if (!ds) { _reject('station inconnue'); return; }
        if (ds.faction == null || ds.faction !== senderCi) { _reject('station'); return; }
        ds.power = orderData.power || 'low';
        ds._fireOrder = { kind: orderData.targetKind || 'ship', targetId: orderData.targetId, power: ds.power };
        if (orderData.targetKind === 'body') {
          ds._fireOrder.targetRef = GameState.background.bodies.find(b => b.id === orderData.targetId);
        }
        addLog(`📡 ${senderFactionName} : ordre de tir superlaser (${ds.power === 'high' ? 'haute' : 'basse'} puissance)`, 'death');
        return;
      }

      if (orderData.type === 'hangar_deploy' && orderData.dsId && orderData.classId) {
        const ds = GameState.background?.bodies?.find(b => b.id === orderData.dsId);
        if (!ds) { _reject('station inconnue'); return; }
        const senderFleetId = (GameState.fleets || []).find(f => f.colorIndex === senderCi)?.fleetId;
        const stationOwnerFleetId = ds.faction != null ? (GameState.fleets || []).find(f => f.colorIndex === ds.faction)?.fleetId : null;
        const ownerFleetId = orderData.ownerFleetId ?? null;
        const isStationOwner = ds.faction === senderCi;
        const isShipOwner = ownerFleetId != null && ownerFleetId === senderFleetId;
        // Autorisé si : MJ (pas de sender ici, géré ailleurs), propriétaire de
        // la station, OU propriétaire du vaisseau spécifique demandé.
        if (!isStationOwner && !isShipOwner) { _reject('station'); return; }
        // Si la station verrouille les départs étrangers, seul le propriétaire
        // de la station ou le propriétaire du vaisseau lui-même peut le sortir
        // (un tiers ne peut jamais forcer le départ du vaisseau d'un autre).
        const isForeign = ownerFleetId != null && ownerFleetId !== stationOwnerFleetId;
        // Le verrou de la station bloque le départ de TOUT vaisseau étranger,
        // y compris son propre propriétaire — c'est l'intérêt même du verrou
        // (le rayon tracteur de la fiction : on retient un vaisseau de force).
        // Seul le propriétaire de la STATION peut outrepasser son propre verrou.
        if (ds.lockForeignDeparture && isForeign && !isStationOwner) {
          _reject('verrou de station'); return;
        }
        const entry = ds.hangarCargo?.find(c => c.classId === orderData.classId && (c.ownerFleetId ?? null) === ownerFleetId);
        const n = Math.max(1, Math.min(orderData.count || 1, entry?.count || 0));
        if (n > 0) {
          addLog(`📡 ${senderFactionName} : décollage hangar (${n}× ${_classLabel(orderData.classId)})`, 'move');
          _applyHangarDeploy(ds, orderData.classId, n, ownerFleetId);
        }
        return;
      }

      // Individual ship behavior (ancien format)
      if (orderData.shipId && orderData.mode && !orderData.subtype) {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        _applyShipOrder({ action:'setBehavior', shipId:orderData.shipId, mode:orderData.mode });
        addLog(`📡 ${senderFactionName} : ${orderData.mode} → vaisseau`, 'move');
      }
      // Fleet-level order from a player
      if (orderData.subtype === 'fleetOrder' && orderData.fleetId && orderData.order) {
        if (!_ownsFleet(orderData.fleetId)) { _reject('flotte'); return; }
        const ships = GameState.ships.filter(s => s.alive && s.fleetId === orderData.fleetId);
        ships.forEach(s => {
          s.orders = null;
          s.behavior = { ...s.behavior, mode: orderData.order };
        });
        addLog(`⚔ Ordre flotte P2P → ${orderData.order} (${ships.length} vaisseaux)`, 'move');
        ui.updateFleetList();
      }
      // Lancement depuis un hangar (joueur)
      if (orderData.subtype === 'carrierLaunch' && orderData.carrierId) {
        if (!_ownsShip(orderData.carrierId)) { _reject('hangar'); return; }
        const _cname = GameState.ships.find(x => x.id === orderData.carrierId)?.name || '?';
        addLog(`📡 ${senderFactionName} : lancement ${orderData.count}× ${orderData.classId} depuis ${_cname}`, 'move');
        // Réutiliser le handler local (sans re-routage P2P)
        const saved = window._p2pSendOrder;
        window._p2pSendOrder = null;
        try { ui.callbacks.onCarrierLaunch?.(orderData.carrierId, orderData.classId, orderData.count); } catch {}
        window._p2pSendOrder = saved;
      }

      // Individual ship order from a player — apply via _applyShipOrder (same as MJ)
      if (orderData.subtype === 'shipOrder') {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const _sname = GameState.ships.find(x => x.id === orderData.shipId)?.name || '?';
        addLog(`📡 ${senderFactionName} : ${orderData.action} → ${_sname}`, 'move');
        // Temporarily clear _p2pSendOrder so _applyShipOrder doesn't re-forward to itself
        const savedSend = window._p2pSendOrder;
        window._p2pSendOrder = null;
        _applyShipOrder(orderData);
        window._p2pSendOrder = savedSend;
        // Broadcast updated state immediately so player sees the order applied
        if (window._p2pBroadcast) {
          window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
        }
      }
      if (orderData.subtype === 'dockStation' && orderData.shipId && orderData.stationId) {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const _sname = GameState.ships.find(x => x.id === orderData.shipId)?.name || '?';
        addLog(`📡 ${senderFactionName} : ${_sname} demande l'atterrissage`, 'move');
        _applyDockStationOrder(orderData.shipId, orderData.stationId);
        if (window._p2pBroadcast) {
          window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
        }
        return;
      }

      if (orderData.subtype === 'undock' && orderData.shipId) {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const ship = GameState.ships.find(s => s.id === orderData.shipId && s.alive);
        if (ship) { addLog(`📡 ${senderFactionName} : désamarrage de ${ship.name}`, 'move'); _applyUndock(ship); }
        return;
      }

      if (orderData.subtype === 'dock' && orderData.shipId && orderData.targetShipId) {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const source = GameState.ships.find(s => s.id === orderData.shipId && s.alive);
        const target = GameState.ships.find(s => s.id === orderData.targetShipId && s.alive);
        if (source && target) {
          const check = canDockTo(source, target);
          if (check.ok) {
            applyDock(source, target);
            addLog(`📡 ${senderFactionName} : ${source.name} s'amarre à ${target.name}`, 'move');
            if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
          } else {
            addLog(`📡 Amarrage refusé : ${check.reason}`, 'move');
          }
        }
        return;
      }

      if (orderData.subtype === 'cargoEject' && orderData.shipId) {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const ship = GameState.ships.find(s => s.id === orderData.shipId && s.alive);
        if (ship?.cargoEject && ship.cargoHold?.length) {
          addLog(`📡 ${senderFactionName} : éjection de cargaison (${ship.name})`, 'move');
          _applyCargoEject(ship);
        }
        return;
      }

      if (orderData.subtype === 'cargoTransfer' && orderData.shipId && orderData.targetShipId) {
        // Le joueur doit posséder le vaisseau SOURCE (celui qui donne sa
        // cargaison) — le destinataire peut appartenir à n'importe qui, on ne
        // restreint pas vers qui on peut transférer (cohérent avec le fait
        // qu'un vaisseau peut décharger dans n'importe quel vaisseau ayant
        // la place, allié ou non — c'est un acte volontaire du donneur).
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const source = GameState.ships.find(s => s.id === orderData.shipId && s.alive);
        const dest = GameState.ships.find(s => s.id === orderData.targetShipId && s.alive);
        if (source && dest) {
          addLog(`📡 ${senderFactionName} : transfert de cargaison ${source.name} → ${dest.name}`, 'move');
          _applyCargoTransfer(source, orderData.cargoIndex, dest);
        }
        return;
      }

      if (orderData.subtype === 'capture' && orderData.shipId && orderData.targetId) {
        if (!_ownsShip(orderData.shipId)) { _reject('vaisseau'); return; }
        const captor = GameState.ships.find(x => x.id === orderData.shipId && x.alive);
        const tgt = GameState.ships.find(x => x.id === orderData.targetId && x.alive);
        if (captor && tgt && (captor.tractorBeam || 0) > 0) {
          captor._captureTargetId = tgt.id;
          const savedSend = window._p2pSendOrder; window._p2pSendOrder = null;
          _applyShipOrder({ action:'attack', shipId: captor.id, targetId: tgt.id, params:{ capture:true } });
          window._p2pSendOrder = savedSend;
          addLog(`📡 ${senderFactionName} : capture → ${tgt.name}`, 'combat');
        }
      }
      if (orderData.subtype === 'factionOrder' && orderData.fleetIds && orderData.order) {
        // Ne garder que les flottes appartenant au sender
        orderData.fleetIds = orderData.fleetIds.filter(fid => _ownsFleet(fid));
        if (orderData.fleetIds.length === 0) { _reject('faction'); return; }
        addLog(`📡 ${senderFactionName} : ordre de faction « ${orderData.order} »`, 'move');
        let count = 0;
        for (const fid of orderData.fleetIds) {
          GameState.ships.filter(s => s.alive && s.fleetId === fid).forEach(s => {
            if (orderData.order === 'ecran' && !['XS','S'].includes(s.size)) return;
            s.orders = null;
            s.behavior = { ...s.behavior, mode: orderData.order };
            count++;
          });
        }
        addLog(`⚔ Ordre faction P2P → ${orderData.order} (${count} vaisseaux)`, 'move');
        ui.updateFleetList();
      }
      // Diplomacy change
      if (orderData.type === 'diplomacy' && orderData.fromFleetId && orderData.toFleetId) {
        if (!_ownsFleet(orderData.fromFleetId)) { _reject('diplomatie'); return; }
        setDiplomacy(GameState.diplomacy, orderData.fromFleetId, orderData.toFleetId, orderData.stance, false);
        addLog(`🤝 Diplomatie P2P: ${orderData.fromFleetId.slice(0,4)}→${orderData.toFleetId.slice(0,4)}: ${orderData.stance}`, 'move');
        try { _buildFactionUI(); } catch {}
      }
      // Vote pour avancer le tour
      if (orderData.type === 'vote' && orderData.fleetId) {
        if (!_ownsFleet(orderData.fleetId)) { _reject('vote'); return; }
        window._voteManager?.castVote(orderData.fleetId);
        addLog(`🗳 Vote reçu : ${GameState.fleets.find(f=>f.fleetId===orderData.fleetId)?.name || orderData.fleetId}`, 'move');
      }
    },
    // onConnectionChange — met à jour l'indicateur de joueurs connectés
    (connMeta) => {
      window._p2pConnections = connMeta;
      try { _updateConnectionStatus(connMeta); } catch {}
    },
    // onNewConn — envoyer l'état actuel immédiatement au nouveau joueur
    (conn) => {
      try {
        const snap = getGameSnapshot(GameState);
        conn.send({ type: 'state', snapshot: snap });
      } catch {}
    }
  ).then(({ id, broadcast }) => {
    window._p2pHostId      = id;
    window._p2pBroadcast   = broadcast;
    window._p2pShortCode   = shortCode(id);
    window._p2pConnections = null;
    // Les joueurs reçoivent des tickAnim à chaque tick (via startSimulation)
    addLog(`📡 Code partie : ${window._p2pShortCode} (onglet Factions pour les liens)`, 'move');
    try { setTimeout(_buildFactionUI, 200); } catch {}
  }).catch(() => addLog('⚠ P2P indisponible (pas de connexion internet)', 'move'));
}

/** Copy text to clipboard — works on HTTP (not just HTTPS) */
/** Updates the connected-players status bar in the Factions panel */
function _updateConnectionStatus(connMeta) {
  // Compteur visible dans la topbar : 👥 N
  let badge = document.getElementById('p2p-conn-count');
  if (!badge) {
    const anchor = document.getElementById('vote-counter');
    if (anchor) {
      badge = document.createElement('span');
      badge.id = 'p2p-conn-count';
      badge.style.cssText = 'font-size:10px;color:#cc88ff;margin-left:4px';
      badge.title = 'Joueurs connectés';
      anchor.after(badge);
    }
  }
  const n = connMeta?.size || 0;
  if (badge) badge.textContent = n > 0 ? `👥 ${n}` : '';

  const container = document.getElementById('p2p-connected-players');
  if (!container) return;

  if (!connMeta || connMeta.size === 0) {
    container.innerHTML = '<div style="color:#6b7a9e;font-size:9px;padding:6px 0">Aucun joueur connecté</div>';
    return;
  }

  const rows = [];
  connMeta.forEach((meta) => {
    const faction = GameState.activeFactions?.find(f => f.colorIndex === meta.faction);
    const color   = meta.faction != null ? (FACTION_COLORS[meta.faction] || '#aaa') : '#6b7a9e';
    const label   = meta.role === 'spectator' ? '👁 Spectateur'
                  : faction ? `🎮 ${faction.name}`
                  : meta.faction != null ? `🎮 Faction ${meta.faction}`
                  : '⏳ Identification…';
    const age     = Math.round((Date.now() - (meta.connectedAt || Date.now())) / 1000);
    const since   = age < 60 ? `${age}s` : `${Math.round(age/60)}min`;
    rows.push(
      `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1a2540">
        <div style="width:7px;height:7px;border-radius:50%;background:#44ff88;box-shadow:0 0 4px #44ff88;flex-shrink:0"></div>
        <span style="color:${color};font-size:10px;flex:1">${label}</span>
        <span style="color:#3a4a60;font-size:9px">${since}</span>
      </div>`
    );
  });

  container.innerHTML =
    `<div style="color:#9aafcc;font-size:9px;font-weight:bold;margin-bottom:4px">
       🟢 ${connMeta.size} joueur${connMeta.size > 1 ? 's' : ''} connecté${connMeta.size > 1 ? 's' : ''}
     </div>` + rows.join('');
}

function _copyToClipboard(text, btn) {
  const orig = btn ? btn.textContent : '';
  const done = () => { if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = orig, 2000); } };

  // Modern API (HTTPS/localhost)
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => _fallbackCopy(text, btn, orig));
  } else {
    _fallbackCopy(text, btn, orig);
  }
}

function _fallbackCopy(text, btn, orig) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try {
    document.execCommand('copy');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = orig, 2000); }
  } catch(e) {
    // Last resort: show the text
    prompt('Copier ce texte manuellement :', text);
  }
  document.body.removeChild(ta);
}
function _loadDemoAndStart() {
  const demo = buildDemoScenario(createShip, createFleet, createScenario);
  loadScenario(demo);
  addLog('🚀 Space Tactics Simulator — Mode Spectateur', 'move');
}

/** Connect to a P2P host as spectator or player */
async function _startAsClient(hostId, role) {
  const factionCi = parseInt(new URLSearchParams(window.location.search).get('faction') ?? '-1');

  // ── Apply client-mode UI immediately (hide GM controls) ────
  document.body.classList.add('client-mode');
  if (role === 'player')    document.body.classList.add('player-mode');
  if (role === 'spectator') document.body.classList.add('spectator-mode');

  // Show a compact status badge below topbar (left side, not overlapping right panel)
  const statusDiv = document.createElement('div');
  statusDiv.id    = 'p2p-status';
  statusDiv.style.cssText = 'position:fixed;top:54px;left:50%;transform:translateX(-50%);background:#070c14ee;border:1px solid #aa44ff;border-radius:20px;padding:5px 14px;font-size:11px;color:#cc88ff;font-family:monospace;z-index:1000;pointer-events:none;backdrop-filter:blur(4px)';
  statusDiv.textContent = '🔌 Connexion P2P…';
  document.body.appendChild(statusDiv);

  addLog(`🔌 Connexion P2P (${role})… l'hôte doit être actif.`, 'move');

  try {
    let firstSnap = true;
    const { sendOrder, sendRaw } = await connectToHost(hostId, (data) => {
      window._lastStateTime = Date.now();
      // ── Mise à jour du décor d'arrière-plan (MJ → joueurs) ──
      if (data.type === 'background') {
        // MUTATION en place (pas de remplacement de référence) : plusieurs
        // endroits du code (ex. l'onglet Station) capturent `GameState.background`
        // dans une closure au démarrage. Remplacer la référence les laissait
        // pointer vers un objet périmé, et l'attribution d'une station au
        // joueur n'apparaissait jamais dans son menu de contrôle.
        if (GameState.background && data.background) {
          GameState.background.suns = data.background.suns || [];
          GameState.background.bodies = data.background.bodies || [];
        } else {
          GameState.background = data.background;
        }
        // Rafraîchir l'onglet Station si ouvert (sinon le joueur ne voit pas
        // immédiatement qu'une station vient de lui être assignée)
        if (window._renderDS) window._renderDS();
        return;
      }
      // ── Nouvelle architecture : tick animation ──────────────────
      if (data.type === 'tickAnim') {
        const clientTickStart = Date.now();
        window._lastStateTime = clientTickStart;

        // État complet (1 tick / 5) ou léger (autres ticks)
        if (data.snapshot)   applyGameSnapshot(data.snapshot, GameState);
        else if (data.light) applyLightState(data.light, GameState);

        // Alimenter le système Bézier du renderer (_prevX/_prevY/_prevHeading)
        (data.before || []).forEach(f => {
          const ship = GameState.ships.find(s => s.id === f.id);
          if (!ship) return;
          ship._prevX       = f.x;
          ship._prevY       = f.y;
          ship._prevHeading = f.ph ?? f.heading ?? ship.heading ?? 0;
        });
        GameState.lastTickTime = clientTickStart;
        GameState.tickInterval = data.duration;

        // ── Projectiles (tirs) ────────────────────────────────────────
        if (data.projectiles?.length) {
          GameState.projectiles = GameState.projectiles || [];
          data.projectiles.forEach(p => {
            if (!GameState.projectiles.find(ep => ep.id === p.id)) {
              const adj = { ...p, startTime: clientTickStart + (p._offset || 0) };
              delete adj._offset;
              GameState.projectiles.push(adj);
            }
          });
        }

        // ── Explosions ────────────────────────────────────────────────
        if (data.explosions?.length) {
          GameState.explosions = GameState.explosions || [];
          data.explosions.forEach(e => {
            const adj = { ...e, startTime: clientTickStart + (e._offset || 0) };
            delete adj._offset;
            GameState.explosions.push(adj);
          });
        }

        // ── Sons côté client : évasions et pertes ───────────────────
        if ((data.newlyDead || []).some(d => d.escaped)) SFX.hyperspace();
        const deadReal = (data.newlyDead || []).filter(d => !d.escaped);
        if (deadReal.length > 0) {
          const selectedDied = deadReal.some(d => d.id === GameState.selectedShipId);
          const capitalDied  = deadReal.some(d => d.namedCharacter || ['XL','XXL','L'].includes(d.size));
          if (selectedDied)       SFX.selectedDestroyed?.();
          else if (capitalDied)   SFX.capitalDestroyed?.();
          else if (deadReal.some(d => ['M','L'].includes(d.size))) SFX.explosionMedium?.();
          else                    SFX.explosion?.();
        }

        // ── Pertes : enregistrer immédiatement dans l'onglet 💀 ────────
        if (!GameState.lostShips) GameState.lostShips = [];
        const lostIds = new Set(GameState.lostShips.map(l => l.id));
        (data.newlyDead || []).forEach(dead => {
          if (!dead.escaped && !lostIds.has(dead.id)) {
            GameState.lostShips.push({ ...dead, tick: data.tick });
          }
        });

        // ── Animations de mort : grosse explosion + debris ────────────
        const sizeR = { XS:1.5, S:2.5, M:4, L:6, XL:9, XXL:14 };
        (data.newlyDead || []).forEach(dead => {
          if (dead.escaped) return; // évasion hyperespace ≠ explosion
          GameState.explosions = GameState.explosions || [];
          const r = sizeR[dead.size] || 3;
          const t = clientTickStart + (data.duration * 0.5);
          // Boule de feu principale
          GameState.explosions.push({ x:dead.x, y:dead.y, z:dead.z??3, startTime:t, radius:r*1.8, color:'#ff6600', type:'death' });
          // Flash blanc
          GameState.explosions.push({ x:dead.x, y:dead.y, z:dead.z??3, startTime:t+80, radius:r*0.8, color:'#ffffff', type:'spark' });
          // Éclats secondaires
          for (let i=0;i<3;i++) {
            GameState.explosions.push({
              x: dead.x+(Math.random()-0.5)*r, y: dead.y+(Math.random()-0.5)*r, z:dead.z??3,
              startTime: t+100+i*120, radius:r*0.5, color:'#ffaa22', type:'spark',
            });
          }
        });
      } else {
        // Fallback : snapshot simple (connexion initiale ou compatibilité)
        applyGameSnapshot(data.snapshot ?? data, GameState);
        if (window._renderDS) window._renderDS();
      }

      // Centrer la caméra au premier snapshot
      if (firstSnap && GameState.ships.length > 0) {
        firstSnap = false;
        if (factionCi >= 0 && !window._p2pFactionFleetId) {
          const pFleet = GameState.fleets.find(f => f.colorIndex === factionCi);
          if (pFleet) window._p2pFactionFleetId = pFleet.fleetId;
        }
        const myShips = factionCi >= 0
          ? GameState.ships.filter(s => {
              const fl = GameState.fleets.find(f => f.fleetId === s.fleetId);
              return fl && (fl.colorIndex === factionCi || s._factionColorIndex === factionCi);
            })
          : GameState.ships;
        const targets = myShips.length ? myShips : GameState.ships;
        if (targets.length > 0) {
          const avgX = targets.reduce((s, sh) => s + (sh.position?.x || 0), 0) / targets.length;
          const avgY = targets.reduce((s, sh) => s + (sh.position?.y || 0), 0) / targets.length;
          renderer.camera.x    = avgX * CONFIG.CELL_SIZE;
          renderer.camera.y    = avgY * CONFIG.CELL_SIZE;
          renderer.camera.zoom = 0.08;
          renderer.camera.tilt = 15;
        }
        statusDiv.textContent = role === 'spectator'
          ? '👁 Spectateur — ' + GameState.ships.length + ' vaisseaux visibles'
          : '🎮 Joueur — ' + targets.length + ' vaisseaux dans votre faction';
        try { _buildFactionUI(); } catch(e) {}
      }
      ui.updateFleetList();
    }, role, factionCi >= 0 ? factionCi : null,
    // onStatus — affichage visible de l'état de connexion
    (status) => {
      const labels = {
        connecting:   '🔌 Connexion P2P…',
        connected:    null, // remplacé par le badge faction au 1er snapshot
        reconnecting: '🔄 Reconnexion en cours…',
        failed:       '❌ Connexion perdue — recharger la page',
      };
      if (status === 'connected') {
        statusDiv.style.borderColor = '#44ff88';
        if (statusDiv.textContent.startsWith('🔌') || statusDiv.textContent.startsWith('🔄')) {
          statusDiv.textContent = '✓ Connecté — en attente de l\'état du jeu…';
        }
      } else if (labels[status]) {
        statusDiv.textContent = labels[status];
        statusDiv.style.borderColor = status === 'failed' ? '#ff4444' : '#aa44ff';
      }
    });
    window._p2pSendOrder = sendOrder;
    window._p2pFactionCi = factionCi;
    window._isClient     = true; // enables client-side animation lerp
    // Hide GM-only controls for players
    document.getElementById('btn-invite')?.style.setProperty('display','none');
    document.getElementById('btn-end-battle')?.style.setProperty('display','none');
    document.querySelectorAll('.gm-only').forEach(el => el.style.display = 'none');
    ['Éditeur MJ','Scénario'].forEach(label => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent.includes('Éditeur') || b.textContent.includes('Scénario')) b.style.display='none';
      });
    });
    // Find the player's fleet ID from their colorIndex for diplomacy control
    if (factionCi >= 0) {
      const pFleet = GameState.fleets.find(f => f.colorIndex === factionCi);
      if (pFleet) window._p2pFactionFleetId = pFleet.fleetId;
    }

    // ── Watchdog : redemander l'état complet tant que rien ne vient ──
    // Couvre la perte du message initial, les races de connexion, etc.
    window._lastStateTime = 0;
    let _stateRetries = 0;
    const _stateWatchdog = setInterval(() => {
      const silent = Date.now() - (window._lastStateTime || 0);
      if (window._lastStateTime === 0 || silent > 6000) {
        if (_stateRetries < 20) {
          _stateRetries++;
          sendRaw({ type: 'requestState' });
          if (window._lastStateTime === 0) {
            statusDiv.textContent = `⏳ Demande de l'état du jeu… (${_stateRetries})`;
          }
        } else {
          statusDiv.textContent = '⚠ Aucune donnée de l\'hôte — vérifier que la partie est lancée';
          statusDiv.style.borderColor = '#ffaa44';
        }
      } else {
        _stateRetries = 0; // données reçues — reset
      }
    }, 3000);

    // ── Bouton "✓ Prêt" : vote du joueur pour avancer le tour ──
    const voteBtn = document.getElementById('btn-vote-ready');
    if (voteBtn && role === 'player') {
      voteBtn.style.display = '';
      voteBtn.addEventListener('click', () => {
        const fleetId = window._p2pFactionFleetId
          || GameState.fleets.find(f => f.colorIndex === factionCi)?.fleetId;
        if (!fleetId) { addLog('⚠ Flotte introuvable pour voter', 'move'); return; }
        sendOrder({ type: 'vote', fleetId });
        SFX.vote();
        voteBtn.textContent = '✓ Voté';
        voteBtn.disabled = true;
        setTimeout(() => { voteBtn.textContent = '✓ Prêt'; voteBtn.disabled = false; }, 3000);
      });
    }

    // ── Confirmation visuelle d'envoi d'ordre ──────────────────
    const origSend = window._p2pSendOrder;
    window._p2pSendOrder = (order) => {
      origSend(order);
      // Flash bref du badge de statut pour confirmer la transmission
      const badge = document.getElementById('p2p-status');
      if (badge) {
        const prev = badge.textContent;
        badge.textContent = '📡 Ordre transmis ✓';
        badge.style.borderColor = '#44ff88';
        setTimeout(() => { badge.textContent = prev; badge.style.borderColor = '#aa44ff'; }, 900);
      }
    };

    addLog(`✅ Connecté ! Mode : ${role === 'spectator' ? '👁 Spectateur' : '🎮 Joueur faction ' + factionCi}`, 'move');
  } catch(e) {
    statusDiv.style.borderColor = '#ff4444';
    statusDiv.style.color       = '#ff8888';
    statusDiv.textContent       = '❌ Connexion échouée';
    addLog(`❌ Connexion échouée : ${e.message}`, 'move');
    addLog('ℹ Vérifiez que le MJ a lancé sa partie et que le Peer ID est correct.', 'move');
    addLog('ℹ Les deux parties doivent avoir une connexion internet (signalisation PeerJS).', 'move');
  }
}

function cancelGmPlacement() {
  gmPlacementShip = null;
  renderer.canvas.style.cursor = 'crosshair';
  const hint = document.getElementById('order-hint');
  if (hint) hint.classList.add('hidden');
}

// ─── Force Retreat button ────────────────────────────
// Injected into the left panel after ship selection
function injectForceRetreatBtn() {
  // Only show for GM — add a "Force Retreat" button to the orders section
  const ordersSection = document.querySelector('.orders-section');
  if (!ordersSection || document.getElementById('btn-force-retreat')) return;
  const btn = document.createElement('button');
  btn.id        = 'btn-force-retreat';
  btn.className = 'btn btn-danger btn-order';
  btn.textContent = '🚀 Force Retreat';
  btn.style.marginTop = '4px';
  btn.style.width = '100%';
  btn.addEventListener('click', () => {
    if (!GameState.selectedShipId) return;
    const ship = GameState.ships.find(s => s.id === GameState.selectedShipId && s.alive);
    if (!ship) return;
    // Move ship to nearest edge
    const isLeft = ship.position.x < CONFIG.GRID_COLS / 2;
    _applyShipOrder({ action:'moveTo', shipId: ship.id, position:{
      x: isLeft ? -2 : CONFIG.GRID_COLS + 2,
      y: ship.position.y,
      z: ship.position.z,
    }});
    _applyShipOrder({ action:'setBehavior', shipId: ship.id, mode:'passive' });
    addLog(`🚀 ${ship.name} — forced retreat ordered`, 'move');
  });
  ordersSection.appendChild(btn);
}

// Call once on init
injectForceRetreatBtn();

// Listen for "Place on Map" event dispatched by the editor
window.addEventListener('gm:placeShip', e => {
  startGmPlacement(e.detail);
});

// ─── Fleet Rally Point ────────────────────────────────
document.getElementById('btn-rally-fleet')?.addEventListener('click', () => {
  const fleetId = document.getElementById('rally-fleet-select')?.value;
  if (!fleetId) { addLog('⚠ Select a fleet first in the dropdown.', 'move'); return; }
  const fleet = GameState.fleets.find(f => f.fleetId === fleetId);
  if (!fleet) return;
  GameState.pendingOrder = { type: 'rally', fleetId };
  const hint = document.getElementById('order-hint');
  if (hint) {
    hint.textContent = `📍 Click the map to rally fleet: ${fleet.name}`;
    hint.classList.remove('hidden');
  }
  addLog(`📍 Click the map to set rally point for ${fleet.name}`, 'move');
});

// ─── Carrier auto-launch event ────────────────────────
// Dispatched by simulation._launchFromCarrier()
window.addEventListener('carrier:launch', e => {
  const { carrierId, classId, count, name } = e.detail;
  const carrier = GameState.ships.find(s => s.id === carrierId && s.alive);
  if (!carrier) return;
  _doLaunchFromCarrier(carrier, classId, count);
});

/**
 * Physically spawns ships from a carrier reserve near the carrier.
 */
function _doLaunchFromCarrier(carrier, classId, count) {
  import('./models.js?v=20250617c').then(({ createShip }) => {
    import('./presets.js?v=20250617c').then(({ instantiatePreset, PRESET_CLASSES }) => {
      const cls = PRESET_CLASSES[classId];
      const isBomber = ['bomber'].includes(cls?.type);
      const isGunship= cls?.type === 'gunship';

      for (let i = 0; i < count; i++) {
        const angle  = (i / Math.max(count, 1)) * Math.PI * 2;
        const offset = 1.5 + Math.random() * 0.5;

        // Bombers → bomber_assault (seek big targets)
        // Gunships → escort the carrier
        // Fighters/interceptors → escort the carrier
        const launchBehavior = isBomber
          ? { mode: 'bomber_assault', radius: 25, targetId: null, points: [],
              authorizedFleets: [carrier.fleetId], patrolIndex: 0, attackedBy: null, distance: 5 }
          : { mode: 'escort', radius: 15, targetId: carrier.id, points: [],
              authorizedFleets: [carrier.fleetId], patrolIndex: 0, attackedBy: null,
              distance: isGunship ? 4 : 3 };

        const ship = instantiatePreset(classId, {
          name:     `${(cls?.name || classId).split(' ')[0]}-${Math.random().toString(36).slice(2,4).toUpperCase()}`,
          fleetId:  carrier.fleetId,
          position: {
            x: carrier.position.x + Math.cos(angle) * offset,
            y: carrier.position.y + Math.sin(angle) * offset,
            z: carrier.position.z,
          },
          behavior:     launchBehavior,
          _prevX:       carrier.position.x,
          _prevY:       carrier.position.y,
          _prevHeading: carrier.heading ?? 0,
        }, createShip);

        GameState.ships.push(ship);
        const fleet = GameState.fleets.find(f => f.fleetId === carrier.fleetId);
        if (fleet) fleet.shipIds.push(ship.id);
      }
      addLog(`✈ ${carrier.name} → launched ${count}× ${cls?.name || classId}`, 'move');
      ui.updateFleetList();
    });
  });
}

/** Selects a ship and updates the left panel */
function selectShip(shipId) {
  if (shipId && shipId !== GameState.selectedShipId) SFX.select();
  GameState.selectedShipId = shipId;
  renderer.selectedShipId  = shipId;
  // Toujours effacer la multi-sélection lasso — que l'on sélectionne un
  // vaisseau unique OU que l'on clique dans le vide (shipId === null)
  GameState.selectedShipIds = [];
  renderer.selectedShipIds  = [];
  const mp = document.getElementById('multi-select-panel');
  if (mp) { mp.classList.add('hidden'); if (mp._floated) mp.style.display = 'none'; }
  ui.updateSelectedShip(shipId);

  // Cancel pending order on selection change
  if (GameState.pendingOrder?.shipId !== shipId) {
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
  }
}

// Ship click handler
// ═══ Désignation d'une PLANÈTE comme cible du superlaser ═══
// ═══ Clic générique sur un corps d'arrière-plan (info + toast) ═══
renderer.onBackgroundBodyInfoClick = (body) => {
  if (!body) return;
  const isStation = isStationType(body.type);
  if (isStation || body.hangarVolume != null) {
    // Clic sur une station (ou planète dotée d'une cale) → ouvrir directement
    // l'onglet Station pour voir/gérer ses contrôles.
    window._switchToTab?.('tab-station');
  }
  if (isStation) {
    const def = STATION_TYPES[body.type] || {};
    const ownerName = body.faction == null ? 'MJ (aucune faction)' :
      (GameState.activeFactions || []).find(f => f.colorIndex === body.faction)?.name || `Faction ${body.faction}`;
    const cargoCount = (body.hangarCargo || []).reduce((s,c) => s + c.count, 0);
    showToast(`🛰 ${body.name || def.label} — ${ownerName}${body.hangarVolume ? ` · cale ${cargoCount} vaisseau(x)` : ''}`, true);
  } else {
    const planetName = body.name || PLANET_TYPES?.[body.type]?.name || 'Planète';
    showToast(`🪐 ${planetName}`, true);
  }
};

renderer.onBodyClick = (body) => {
  const pending = GameState.pendingOrder;
  if (pending?.type === 'deathstar_fire' && pending.ds && pending.kind === 'body') {
    if (body) {
      pending.ds._fireOrder = { kind: 'body', targetId: body.id, targetRef: body, power: pending.ds.power || 'low' };
      const high = pending.ds.power === 'high';
      const max = high ? 30 : 15;
      const ready = (pending.ds._charge || 0) >= max;
      const action = high ? 'DESTRUCTION TOTALE' : 'frappe de surface';
      addLog(`🪐 ${pending.ds.name || 'Étoile de la Mort'} cible ${body.name || 'la planète'} (${action})${ready ? ' — tir imminent !' : ' — tir dès rechargement.'}`, 'death');
      showToast(`🎯 Planète ciblée — ${action}${ready ? ' (tir imminent)' : ' (charge en cours)'}`, true);
      if (window._p2pSendOrder) window._p2pSendOrder({ type:'deathstar_fire', dsId: pending.ds.id, targetKind:'body', targetId: body.id, power: pending.ds.power || 'low' });
    } else {
      addLog(`✖ Tir annulé (aucune planète sous le curseur).`, 'move');
      showToast('✖ Aucune planète sous le curseur', false);
    }
    GameState.pendingOrder = null;
    ui.cancelPendingOrder?.();
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'background', background: GameState.background });
    return;
  }

  // ═══ Désignation d'une STATION/PLANÈTE pour y atterrir ═══
  if (pending?.type === 'dockStation' && pending.shipId) {
    if (body) {
      _requestDockAtStation(pending.shipId, body);
    } else {
      addLog(`✖ Atterrissage annulé (aucune cible sous le curseur).`, 'move');
      showToast('✖ Aucune station sous le curseur', false);
    }
    GameState.pendingOrder = null;
    ui.cancelPendingOrder?.();
  }
};

renderer.onShipClick = (ship) => {
  const pending = GameState.pendingOrder;

  // ═══ Ordre de tir ÉTOILE DE LA MORT sur un vaisseau ═══
  if (pending?.type === 'deathstar_fire' && pending.ds && pending.kind === 'ship') {
    pending.ds._fireOrder = { kind: 'ship', targetId: ship.id, power: pending.ds.power || 'low' };
    const max = pending.ds.power === 'high' ? 30 : 15;
    const ready = (pending.ds._charge || 0) >= max;
    addLog(`🎯 ${pending.ds.name || 'Étoile de la Mort'} cible ${ship.name}${ready ? ' — tir imminent !' : ' — tir dès rechargement.'}`, 'death');
    GameState.pendingOrder = null;
    ui.cancelPendingOrder?.();
    renderer._bodyTargetMode = false;
    if (window._p2pBroadcast) window._p2pBroadcast({ type:'background', background: GameState.background });
    // Forwarder l'ordre à l'hôte si on est un joueur
    if (window._p2pSendOrder) window._p2pSendOrder({ type:'deathstar_fire', dsId: pending.ds.id, targetKind:'ship', targetId: ship.id, power: pending.ds.power || 'low' });
    return;
  }

  // ═══ Ordres MULTI-SÉLECTION : appliquer à tous les shipIds ═══
  if (pending?.shipIds?.length) {
    const ids = pending.shipIds.filter(id => id !== ship.id);
    if (pending.type === 'attack') {
      ids.forEach(id => _applyShipOrder({ action:'attack', shipId:id, targetId: ship.id }));
      addLog(`⚔ ${ids.length} vaisseaux → attaque ${ship.name}`, 'combat');
    } else if (pending.type === 'escort') {
      ids.forEach(id => _applyShipOrder({ action:'setBehavior', shipId:id, mode:'escort', params:{ targetId: ship.id } }));
      addLog(`🛡 ${ids.length} vaisseaux escortent ${ship.name}`, 'move');
    } else if (pending.type === 'kamikaze') {
      ids.forEach(id => _applyShipOrder({ action:'kamikaze', shipId:id, targetId: ship.id }));
      addLog(`☠ ${ids.length} vaisseaux → KAMIKAZE sur ${ship.name} !`, 'death');
    } else if (pending.type === 'move') {
      // Clic sur un vaisseau pendant un move multi → converger vers sa position
      ids.forEach(id => _applyShipOrder({ action:'moveTo', shipId:id, position:{ ...ship.position } }));
      addLog(`🎯 ${ids.length} vaisseaux → position de ${ship.name}`, 'move');
    }
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    return;
  }

  if (pending?.type === 'dock') {
    const source = GameState.ships.find(s => s.id === pending.shipId && s.alive);
    if (!source || ship.id === source.id) {
      GameState.pendingOrder = null; ui.cancelPendingOrder(); return;
    }
    const check = canDockTo(source, ship);
    if (!check.ok) {
      showToast(`🔗 Amarrage impossible : ${check.reason}`, false);
      addLog(`🔗 Amarrage impossible : ${check.reason}`, 'move');
    } else if (window._p2pSendOrder) {
      window._p2pSendOrder({ type:'order', subtype:'dock', shipId: source.id, targetShipId: ship.id });
      showToast(`🔗 Demande d'amarrage vers ${ship.name}`, true);
    } else {
      applyDock(source, ship);
      addLog(`🔗 ${source.name} s'amarre à ${ship.name}.`, 'move');
      showToast(`🔗 Amarré à ${ship.name}`, true);
      ui.updateSelectedShip(source.id);
      if (window._p2pBroadcast) window._p2pBroadcast({ type:'state', snapshot: getGameSnapshot(GameState) });
    }
    GameState.pendingOrder = null; ui.cancelPendingOrder(); return;
  }

  if (pending?.type === 'cargoTransfer') {
    const source = GameState.ships.find(s => s.id === pending.shipId && s.alive);
    const entry = source?.cargoHold?.[pending.cargoIndex];
    if (!source || !entry) { GameState.pendingOrder = null; ui.cancelPendingOrder(); return; }
    if (ship.id === source.id) {
      addLog(`✖ Impossible de transférer vers soi-même.`, 'move');
      showToast('Impossible de transférer vers soi-même', false);
    } else {
      // ── Vérification proximité physique ────────────────────────────
      // Le transfert de cargaison n'est pas possible par wifi. Il faut :
      // (a) que le vaisseau source soit docké dans le hangar du destinataire
      // (b) que le vaisseau destinataire soit docké dans le hangar du source
      // (c) que les deux vaisseaux soient à bord de la même station
      // (d) qu'ils soient dans le même hangar-station (stationId identique)
      // (e) adjacent sur la grille (distance ≤ 2 cases — amarrage en vol)
      const srcPos  = source.position;
      const dstPos  = ship.position;
      const gridDist = Math.hypot(dstPos.x - srcPos.x, dstPos.y - srcPos.y);
      const srcDockedInDst = source._dockedInShipId === ship.id;
      const dstDockedInSrc = ship._dockedInShipId === source.id;
      const sameStation    = source._dockedStationId && source._dockedStationId === ship._dockedStationId;
      const isAdjacent     = gridDist <= 2.0;
      const canTransfer    = srcDockedInDst || dstDockedInSrc || sameStation || isAdjacent;
      if (!canTransfer) {
        addLog(`✖ Transfert impossible : ${source.name} doit être adjacent ou à bord de ${ship.name}.`, 'move');
        showToast(`✖ Transfert impossible — trop loin (${gridDist.toFixed(1)} cases)`, false);
      } else if (window._p2pSendOrder) {
        window._p2pSendOrder({ type:'order', subtype:'cargoTransfer', shipId: source.id, cargoIndex: pending.cargoIndex, targetShipId: ship.id });
        addLog(`↪ Demande de transfert envoyée vers ${ship.name}…`, 'move');
        showToast(`↪ Demande de transfert envoyée vers ${ship.name}`, true);
      } else {
        _applyCargoTransfer(source, pending.cargoIndex, ship);
      }
    }
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    return;
  }

  if (pending?.type === 'capture') {
    if (pending.shipId && ship.id !== pending.shipId) {
      const captor = GameState.ships.find(s => s.id === pending.shipId && s.alive);
      if (captor) {
        if (ship.fleetId === captor.fleetId) {
          addLog(`✖ Impossible de capturer un allié.`, 'move');
        } else {
          const ORDER = ['XS','S','M','L','XL','XXL'];
          if (ORDER.indexOf(ship.size) >= ORDER.indexOf(captor.size)) {
            addLog(`✖ ${ship.name} est trop gros pour être capturé par ${captor.name}.`, 'move');
          } else {
            // Le capteur poursuit la cible ; la capture s'effectue quand la cible
            // est vulnérable et à portée (géré par processTractorBeams).
            captor._captureTargetId = ship.id;
            _applyShipOrder({ action:'attack', shipId: captor.id, targetId: ship.id, params:{ capture:true } });
            addLog(`🪝 ${captor.name} → CAPTURE de ${ship.name} (poursuite ; capture si vulnérable et à portée)`, 'combat');
            if (window._p2pSendOrder) window._p2pSendOrder({ type:'order', subtype:'capture', shipId: captor.id, targetId: ship.id });
          }
        }
      }
      GameState.pendingOrder = null;
      ui.cancelPendingOrder();
      return;
    }
  }

  if (pending?.type === 'attack') {
    if (pending.shipId && ship.id !== pending.shipId) {
      _applyShipOrder({ action:'attack', shipId: pending.shipId, targetId: ship.id });
      addLog(`⚔ Ordre : attaque ${ship.name}`, 'combat');
      GameState.pendingOrder = null;
      ui.cancelPendingOrder();
      return;
    }
  }

  if (pending?.type === 'bombard') {
    // Bomber climbs above target and bombs it
    if (pending.shipId && ship.id !== pending.shipId) {
      const bomber = GameState.ships.find(s => s.id === pending.shipId && s.alive);
      if (bomber) {
        const targetZ = Math.min(ship.position.z + 2, CONFIG.ALTITUDE_MAX);
        _applyShipOrder({ action:'moveTo', shipId: pending.shipId, position:{ x: ship.position.x, y: ship.position.y, z: targetZ } });
        bomber.permanentOrder = { type: 'attack', targetId: ship.id };
        addLog(`💣 ${bomber.name} → bombing run on ${ship.name}`, 'combat');
      }
      GameState.pendingOrder = null;
      ui.cancelPendingOrder();
      return;
    }
  }

  if (pending?.type === 'kamikaze') {
    if (pending.shipId && ship.id !== pending.shipId) {
      _applyShipOrder({ action:'kamikaze', shipId: pending.shipId, targetId: ship.id });
      addLog(`☠ Kamikaze → ${ship.name}!`, 'death');
      GameState.pendingOrder = null;
      ui.cancelPendingOrder();
      return;
    }
  }

  if (pending?.type === 'escort') {
    if (pending.shipId && ship.id !== pending.shipId) {
      _applyShipOrder({ action:'setBehavior', shipId: pending.shipId, mode:'escort', params:{ targetId: ship.id } });
      GameState.pendingOrder = null;
      ui.cancelPendingOrder();
      return;
    }
  }

  selectShip(ship.id);
};

// Grid click handler (empty cell)
renderer.onGridClick = (worldPos) => {
  // ═══ Déplacement MULTI-SÉLECTION en formation ═══
  const _mp = GameState.pendingOrder;
  if (_mp?.type === 'move' && _mp.shipIds?.length) {
    const sel = _mp.shipIds.map(id => GameState.ships.find(s => s.id === id && s.alive)).filter(Boolean);
    if (sel.length) {
      // Centre actuel du groupe → offset préservé = la formation se déplace en bloc
      const cx = sel.reduce((a,s)=>a+s.position.x,0)/sel.length;
      const cy = sel.reduce((a,s)=>a+s.position.y,0)/sel.length;
      sel.forEach(s => {
        _applyShipOrder({ action:'moveTo', shipId:s.id, position:{
          x: clamp(worldPos.x + (s.position.x - cx), 0, CONFIG.GRID_COLS - 1),
          y: clamp(worldPos.y + (s.position.y - cy), 0, CONFIG.GRID_ROWS - 1),
          z: s.position.z,
        }});
      });
      addLog(`🎯 ${sel.length} vaisseaux → formation vers (${Math.round(worldPos.x)}, ${Math.round(worldPos.y)})`, 'move');
    }
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    return;
  }

  // GM placement mode
  if (gmPlacementShip) {
    import('./models.js?v=20250617c').then(({ createShip }) => {
      import('./presets.js?v=20250617c').then(({ instantiatePreset, PRESET_CLASSES }) => {
        const allClasses = { ...PRESET_CLASSES };
        editor.shipClasses?.forEach(c => { allClasses[c.classId] = c; });
        const tmpl = gmPlacementShip.template || {};
        const overrides = {
          name:     gmPlacementShip.name,
          fleetId:  gmPlacementShip.fleetId,
          position: { x: Math.floor(worldPos.x), y: Math.floor(worldPos.y), z: gmPlacementShip.z || 3 },
          // Pilote
          ...(tmpl.pilotType  && { pilotType:  tmpl.pilotType }),
          ...(tmpl.pilotLevel && { pilotLevel: tmpl.pilotLevel }),
          ...(tmpl.namedCharacter && { namedCharacter: tmpl.namedCharacter }),
          // Équipement supplémentaire défini dans l'éditeur
          ...(tmpl.scanner         != null && { scanner:         tmpl.scanner }),
          ...(tmpl.tractorBeam     != null && { tractorBeam:     tmpl.tractorBeam }),
          ...(tmpl.gravityWell     != null && { gravityWell:     tmpl.gravityWell }),
          ...(tmpl.cargoVolume     != null && { cargoVolume:     tmpl.cargoVolume }),
          ...(tmpl.cargoEject               && { cargoEject:      tmpl.cargoEject }),
          ...(tmpl.medicalCapacity != null && { medicalCapacity: tmpl.medicalCapacity }),
          ...(tmpl.brigCapacity    != null && { brigCapacity:    tmpl.brigCapacity }),
        };
        const ship = instantiatePreset(gmPlacementShip.classId, overrides, createShip);
        // Appliquer les armes supplémentaires après instanciation
        if (tmpl.extraWeapons?.length) {
          tmpl.extraWeapons.forEach(w => ship.weapons.push(createWeapon(w)));
        }
        GameState.ships.push(ship);
        const fleet = GameState.fleets.find(f => f.fleetId === gmPlacementShip.fleetId);
        if (fleet) fleet.shipIds.push(ship.id);
        addLog(`📍 ${ship.name} placed at (${Math.floor(worldPos.x)}, ${Math.floor(worldPos.y)})`, 'move');
        ui.updateFleetList();
        cancelGmPlacement();
      });
    });
    return;
  }

  const pending = GameState.pendingOrder;

  // Fleet rally point
  if (pending?.type === 'rally' && pending.fleetId) {
    const fleetShips = GameState.ships.filter(s => s.fleetId === pending.fleetId && s.alive);
    const cx = worldPos.x;
    const cy = worldPos.y;
    const spread = Math.max(2, Math.sqrt(fleetShips.length) * 1.5);
    fleetShips.forEach((ship, i) => {
      const angle  = (i / Math.max(fleetShips.length, 1)) * Math.PI * 2;
      const radius = i === 0 ? 0 : spread * (0.6 + Math.floor(i / 6) * 0.5);
      _applyShipOrder({ action:'moveTo', shipId: ship.id, position:{
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        z: ship.position.z,
      }});
    });
    addLog(`📍 ${fleetShips.length} ships rallying to (${Math.round(cx)}, ${Math.round(cy)})`, 'move');
    GameState.pendingOrder = null;
    document.getElementById('order-hint')?.classList.add('hidden');
    return;
  }

  if (pending?.type === 'dock') {
    // Dock order on empty space → cancel
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    return;
  }
  if (pending?.type === 'move' && pending.shipId) {
    const z = GameState.ships.find(s => s.id === pending.shipId)?.position.z || 3;
    _applyShipOrder({ action:'moveTo', shipId: pending.shipId, position:{ x: worldPos.x, y: worldPos.y, z } });
    addLog(`🚀 Déplacement → (${Math.round(worldPos.x)}, ${Math.round(worldPos.y)})`, 'move');
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    return;
  }

  // Ordre multi à cible en attente (attack/escort/kamikaze) + clic dans le vide → annuler l'ordre
  if (pending?.shipIds?.length && (pending.type === 'attack' || pending.type === 'escort' || pending.type === 'kamikaze')) {
    GameState.pendingOrder = null;
    ui.cancelPendingOrder();
    addLog('✖ Ordre annulé', 'move');
    return;
  }

  // Click on empty cell → deselect (efface aussi la multi-sélection)
  selectShip(null);
};

// ═══════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════

/**
 * On page load:
 *  1. Start the render loop (always active)
 *  2. Automatically load the demo scenario
 */
// ─── Global error handler — shows errors visibly ────────
window.onerror = (msg, src, line, col, err) => {
  const banner = document.getElementById('js-error-banner');
  const msgEl  = document.getElementById('js-error-msg');
  if (banner && msgEl) {
    msgEl.textContent = `${msg} (${src?.split('/').pop()}:${line})`;
    banner.style.display = 'block';
  }
  console.error('App error:', msg, src, line, err);
};
window.addEventListener('unhandledrejection', e => {
  const banner = document.getElementById('js-error-banner');
  const msgEl  = document.getElementById('js-error-msg');
  if (banner && msgEl) {
    msgEl.textContent = `Unhandled promise: ${e.reason}`;
    banner.style.display = 'block';
  }
  console.error('Unhandled rejection:', e.reason);
});

(function init() {
  try {
    // ─── Session mode (GM vs Player) ──────────────
    const session = readFactionFromUrl();
    window.SESSION = session || { isGM: true, fleetId: null, isSpectator: false };
    if (!window.SESSION.isGM) {
      document.body.classList.add('player-mode');
    }
    if (window.SESSION.isSpectator) {
      document.body.classList.add('spectator-mode');
      // Add visible badge
      const badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1a3a2a;border:1px solid #3ddc84;color:#3ddc84;padding:4px 12px;border-radius:12px;font-size:11px;z-index:1000;pointer-events:none';
      badge.textContent = '👁 MODE SPECTATEUR';
      document.body.appendChild(badge);
    }

    // ─── Right panel tab switching ─────────────────
    function switchToTab(targetId) {
      document.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.right-tab-content').forEach(c => c.classList.add('hidden'));
      const tabBtn = document.querySelector(`.right-tab[data-target="${targetId}"]`);
      tabBtn?.classList.add('active');
      const target = document.getElementById(targetId);
      target?.classList.remove('hidden');
      if (targetId === 'tab-station' && window._renderDS) window._renderDS();
    }
    window._switchToTab = switchToTab;
    document.querySelectorAll('.right-tab').forEach(tab => {
      tab.addEventListener('click', () => switchToTab(tab.dataset.target));
    });

    // ─── Ship panel sub-tabs: Combat / Économie ───────────────
    function switchShipTab(tabId) {
      const combat = document.getElementById('sp-content-combat');
      const eco    = document.getElementById('sp-content-eco');
      const btnC   = document.getElementById('sp-tab-combat');
      const btnE   = document.getElementById('sp-tab-eco');
      if (tabId === 'eco') {
        combat?.style && (combat.style.display = 'none');
        eco   ?.style && (eco.style.display    = '');
        if (btnC) { btnC.style.borderBottomColor = 'transparent'; btnC.style.color = '#6b7a9e'; }
        if (btnE) { btnE.style.borderBottomColor = '#4a9eff';     btnE.style.color = '#4a9eff'; }
        // Force re-render des panels économie quand l'onglet devient visible
        if (GameState.selectedShipId) {
          const ship = GameState.ships.find(s => s.id === GameState.selectedShipId && s.alive);
          if (ship) ui._renderEcoTab(ship);
        }
      } else {
        combat?.style && (combat.style.display = '');
        eco   ?.style && (eco.style.display    = 'none');
        if (btnC) { btnC.style.borderBottomColor = '#4a9eff'; btnC.style.color = '#4a9eff'; }
        if (btnE) { btnE.style.borderBottomColor = 'transparent'; btnE.style.color = '#6b7a9e'; }
      }
    }
    window._switchShipTab = switchShipTab;
    window._getSnap = () => getGameSnapshot(GameState);
    document.getElementById('sp-tab-combat')?.addEventListener('click', () => switchShipTab('combat'));
    document.getElementById('sp-tab-eco')   ?.addEventListener('click', () => switchShipTab('eco'));

    // ─── Collapsible left-panel sections ──────────
    document.querySelectorAll('.section-block h3, .section-block h2').forEach(h => {
      // Only wrap if parent section has content worth collapsing
      const section = h.parentElement;
      const body    = section.querySelector('.collapsible-body') || _wrapCollapsible(h, section);
      if (!body) return;
      h.classList.add('collapsible-header');
      h.addEventListener('click', () => {
        h.classList.toggle('collapsed');
        body.classList.toggle('collapsed');
      });
    });

    // ─── Player Ready button ───────────────────────
    document.getElementById('btn-ready')?.addEventListener('click', () => {
      const faction = window.SESSION?.fleetId;
      if (faction) {
        window._voteManager?.castVote(faction);
        addLog(`✓ ${faction} est prêt`, 'move');
        document.getElementById('btn-ready').textContent = '✓ Prêt (en attente...)';
        document.getElementById('btn-ready').disabled = true;
      }
    });

    // ─── Multi-select indicator ────────────────────
    const indicator = document.createElement('div');
    indicator.id = 'multi-select-count';
    document.body.appendChild(indicator);

    // Start rendering
    renderLoop();

    // Sons d'interface (style Battlefront II 2005)
    try { initSoundUI(); } catch(e) { console.warn('Sound init:', e); }
    try { _initDecorUI(); } catch(e) { console.warn('Decor init:', e); }

    // Remove startup loading screen
    const probe = document.getElementById('startup-probe');
    if (probe) probe.style.display = 'none';

    // Ensure preset fleet library exists on first load
    ensurePresetFleets();

    // ─── SESSION / JOIN MODE — derived directly from URL ─────────
    const params     = new URLSearchParams(window.location.search);
    // Sanitize peer ID — accept "bae9…", "?join=bae9…", full URL with ?join=
    function _cleanPeerId(raw) {
      if (!raw) return '';
      const m = raw.match(/join=([a-zA-Z0-9\-_]+)/);
      if (m) return m[1];
      // UUID-like
      const u = raw.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      if (u) return u[0];
      return raw.trim().replace(/^\?/, '');
    }
    const joinPeerId = _cleanPeerId(params.get('join'));
    const isSpectator = params.has('spectator') || params.get('role') === 'spectator';
    const isPlayer    = params.has('faction') && params.has('token');
    const isJoining   = !!joinPeerId;

    // P2P join: ?join=<peerId>&role=spectator|player
    if (isJoining) {
      _startAsClient(joinPeerId, params.get('role') || 'spectator');
      return;
    }

    // Old-style spectator: ?spectator=1
    if (isSpectator && !isJoining) {
      addLog('👁 Mode Spectateur — utilisez "🔌 Rejoindre" pour rejoindre une partie P2P.', 'move');
      return;
    }

    // Old-style player with faction token: ?faction=...&token=...
    if (isPlayer && !isSpectator) {
      addLog('🎮 Mode Joueur — en attente de la partie…', 'move');
      return;
    }

    // ─── Default: GM — show setup wizard ─────────────────────────
    new SetupWizard((config) => {
      _startFromConfig(config);
    });

    document.getElementById('js-error-banner')?.style && (document.getElementById('js-error-banner').style.display = 'none');
  } catch (e) {
    console.error('Init failed:', e);
    const probe = document.getElementById('startup-probe');
    if (probe) {
      probe.innerHTML = `<div style="color:#ff4444;font-size:16px">⚠️ Erreur d'initialisation</div>
        <div style="color:#ff8888;font-size:12px;max-width:500px;text-align:center;font-family:monospace">${e.message}</div>
        <div style="color:#6b7a9e;font-size:11px">Ouvrez F12 → Console pour plus de détails</div>`;
    }
    const banner = document.getElementById('js-error-banner');
    const msgEl  = document.getElementById('js-error-msg');
    if (banner && msgEl) {
      msgEl.textContent = e.message + ' — See F12 Console for full stack trace';
      banner.style.display = 'block';
    }
  }
})();

/** Wraps section content after the header into a .collapsible-body div */
function _wrapCollapsible(header, section) {
  const children = [...section.childNodes].filter(n =>
    n !== header && (n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))
  );
  if (!children.length) return null;
  const body = document.createElement('div');
  body.className = 'collapsible-body';
  children.forEach(c => body.appendChild(c));
  section.appendChild(body);
  return body;
}
