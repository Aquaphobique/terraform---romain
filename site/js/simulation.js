/**
 * SIMULATION — Game Engine
 *
 * Handles the tick loop, movement, AI decisions, combat,
 * and physics (collisions, explosions, ion effects).
 *
 * Architecture:
 *   GameEngine.tick() → called at regular intervals by app.js
 *   Execution order per tick:
 *     1. processIonDecay        — decay ion stacks
 *     2. processShieldRegen     — recharge shields
 *     3. processAI              — AI decisions
 *     4. processOrders          — execute orders (movement)
 *     5. processWeapons         — fire weapons
 *     6. detectCollisions       — detect and resolve collisions
 *     7. processDeaths          — remove destroyed ships
 */

import CONFIG  from './config.js?v=20250617c';
import { clamp, dist2D, dist3D, dirTo, roll, BOMBARDMENT_SIZE_MOD, SIZE_DEFAULT_SPEED, SIZE_RADIUS, SHIP_HANGAR_VOLUME } from './utils.js?v=20250617c';
import { getEnergyMods, autoAdaptEnergy } from './energy.js?v=20250617c';
import { getPilotCombatMods, checkPlotArmor } from './pilot.js?v=20250617c';
import { getDiplomacy } from './faction.js?v=20250617c';
import { getCombatPolicyMods, COMBAT_POLICIES, getPolicyChangeDelay, getAvailablePolicies } from './combat_policy.js?v=20250617c';

// Terrain module — loaded lazily so it can't block startup
let _terrainMod = null;
async function getTerrainMod() {
  if (!_terrainMod) _terrainMod = await import('./terrain.js?v=20250617c');
  return _terrainMod;
}
// Stubs used synchronously — resolved once module loads
let resolveShipTerrainCollision = () => {};
let applyGravityWell = () => {};
let updateTerrainPhysics = () => {};
let inNebula = () => false;
import('./terrain.js?v=20250617c').then(mod => {
  resolveShipTerrainCollision = mod.resolveShipTerrainCollision;
  applyGravityWell            = mod.applyGravityWell;
  updateTerrainPhysics        = mod.updateTerrainPhysics;
  inNebula                    = mod.inNebula;
}).catch(err => console.warn('terrain.js failed to load:', err));

export class GameEngine {
  /**
   * @param {GameState} state - The shared global state (see app.js)
   * @param {Function}  logFn - Function to record events (e.g. addLog)
   */
  constructor(state, logFn) {
    this.state = state;
    this.log   = logFn || (() => {});
  }

  // ═══════════════════════════════════════════════════════
  // ENTRY POINT: ONE TICK
  // ═══════════════════════════════════════════════════════

  tick() {
    const ships = this.state.ships.filter(s => s.alive && !s.docked);
    const N     = CONFIG.SIM_SUB_STEPS;

    // ═══ OPTIMISATION PERFORMANCE ═══
    // getEnemies/getAllies/getNeutrals étaient appelées PAR VAISSEAU PAR TIC et
    // refaisaient un .filter() sur TOUT le tableau (O(n²) sur le nombre de
    // vaisseaux). Avec des centaines d'unités ça devient le principal coût du
    // tic. On précalcule ici, UNE FOIS par tic, le regroupement par flotte —
    // les méthodes getEnemies/getAllies/getNeutrals piochent dedans ensuite
    // (le résultat final est identique, juste calculé sans repasser sur tout
    // le tableau à chaque vaisseau).
    this._shipsByFleet = new Map();
    for (const s of ships) {
      if (!this._shipsByFleet.has(s.fleetId)) this._shipsByFleet.set(s.fleetId, []);
      this._shipsByFleet.get(s.fleetId).push(s);
    }
    // Lookup O(1) par id : remplace les `this.state.ships.find(s => s.id === X)`
    // qui étaient appelés PAR ARME, PAR VAISSEAU, PAR SOUS-TIC (×16) — le plus
    // gros goulot à grande échelle (des centaines de vaisseaux × armes × 16).
    this._shipsById = new Map();
    for (const s of this.state.ships) this._shipsById.set(s.id, s);

    // Save previous altitude for dive mechanics
    ships.forEach(s => { s._prevAltitude = s.position.z; });

    // Auto-adapt energy policy (before AI decisions)
    ships.forEach(s => { try { autoAdaptEnergy(s); } catch(e) {} });

    this.processIonDecay(ships);
    this.processShieldRegen(ships);
    this.processAstromechHeal(ships, this.state.tick);
    this.processForceDodgeCooldown(ships);
    this.processCombatPolicyChanges(ships);
    this.processTerrainEffects(ships);
    this.processTractorBeams(ships);
    this.processAI(ships);
    this.processCarrierAutoDeploy(ships);

    for (let sub = 0; sub < N; sub++) {
      this.processOrdersSubStep(ships, 1 / N);
      this.processAllyAvoidance(ships, 1 / N);
      this.processWeaponsSubStep(ships, sub);
    }

    this.processDocking(ships);      // check for ships reaching a carrier
    this.processStationDocking(ships); // check for ships reaching a station
    this.detectCollisions(ships);
    this.processDeaths();
    this.state.tick++;
  }

  /**
   * Auto-deploy: carriers in combat launch squadrons up to maxSimultaneous cap.
   * Fighters escort the carrier; bombers go to bomber_assault mode.
   * Rate-limited to once per 5 ticks.
   */
  processCarrierAutoDeploy(ships) {
    for (const carrier of ships) {
      const c = carrier.carrier;
      if (!c?.reserves?.length) continue;

      // ── Condition : mode agressif ET permission de décoller ──────────────
      // Le déploiement auto ne se fait qu'en mode agressif (pas passif, pas
      // en retraite). La permission de décoller peut être bloquée par le MJ
      // (via c.launchLocked = true, configurable dans l'éditeur carrier).
      const behaviorMode = carrier.behavior?.mode || 'aggressive';
      const isAggressive = behaviorMode === 'aggressive';
      const launchAllowed = !c.launchLocked;
      if (!isAggressive || !launchAllowed) continue;

      const enemies = this.getEnemies(carrier, ships);
      if (!enemies.length) continue;

      const maxS     = c.maxSimultaneous || 30;
      const deployed = c.reserves.reduce((s, r) => s + (r.deployed || 0), 0);
      const slots    = maxS - deployed;
      if (slots <= 0) continue;

      // ── Reactive deployment: enemy fighter approaching from ABOVE → launch matching fighter ──
      // (enemies approaching from below are stealthier — harder to detect at range)
      const carrierZ = carrier.position.z || 3;
      const incomingFighters = enemies.filter(e => {
        if (!['fighter','heavy_fighter','interceptor'].includes(e.type)) return false;
        const d    = dist2D(e.position, carrier.position);
        const below = carrierZ - (e.position.z || 3);
        // Apply same stealth modifier: ships below us are harder to detect reactively
        const mod  = below > 0 ? Math.max(0.4, 1 - below * 0.20) : 1.0;
        return d < 30 * mod;
      });
      const reactiveCount = Math.min(incomingFighters.length, Math.floor(slots * 0.5), 3);
      if (reactiveCount > 0) {
        for (const r of c.reserves) {
          if (['fighter','heavy_fighter','interceptor'].includes(r.type)) {
            const avail = Math.max(0, r.count - (r.deployed || 0));
            if (avail > 0) { this._launchFromCarrier(carrier, r, Math.min(reactiveCount, avail)); break; }
          }
        }
      }

      // ── Periodic sortie every 5 ticks ──────────────────────
      if (this.state.tick % 5 !== 0) continue;

      let launched = 0;

      const launchType = (types, max, auto) => {
        if (!auto || launched >= max) return;
        for (const r of c.reserves) {
          if (launched >= max) break;
          if (!types.includes(r.type)) continue;
          const avail = Math.max(0, r.count - (r.deployed || 0));
          if (avail <= 0) continue;
          const n = Math.min(3, avail, max - launched, slots - launched);
          if (n > 0) { this._launchFromCarrier(carrier, r, n); launched += n; }
        }
      };

      // Coordinated bomber+escort wave: deploy 3 bombers + 6 escort fighters together
      if (c.autoBombers && slots >= 9) {
        let bombersLaunched = 0;
        for (const r of c.reserves) {
          if (r.type === 'bomber') {
            const avail = Math.max(0, r.count - (r.deployed || 0));
            if (avail >= 3) {
              this._launchFromCarrier(carrier, r, 3); bombersLaunched = 3; launched += 3; break;
            }
          }
        }
        if (bombersLaunched > 0) {
          // Launch escorts for the bombers
          const escortN = Math.min(6, slots - launched);
          launchType(['fighter','heavy_fighter'], escortN, true);
        }
      } else {
        // Standard auto-deploy
        launchType(['fighter','heavy_fighter'], 9, c.autoFighters);
        launchType(['interceptor'],             6, c.autoInterceptors);
        launchType(['gunship'],                 2, c.autoGunships);
      }

      if (launched > 0) this.log(`✈ ${carrier.name} +${launched} ships`, 'move');
    }
  }

  /** Processes ships that have a dock order and reached a carrier */
  processDocking(ships) {
    for (const ship of ships) {
      if (ship.orders?.type !== 'dock') continue;
      const carrierId = ship.orders.carrierId;
      const carrier   = this.state.ships.find(s => s.id === carrierId && s.alive);
      if (!carrier?.carrier) { ship.orders = null; continue; }

      // Check if in docking range
      if (dist2D(ship.position, carrier.position) < 1.5) {
        const usedSlots = carrier.carrier.carriedShips.length;
        if (usedSlots >= carrier.carrier.maxSlots) {
          this.log(`${ship.name} — hangar bay full on ${carrier.name}!`, 'move');
          ship.orders = null;
          continue;
        }
        // Dock the ship
        ship.alive  = false;
        ship.docked = carrierId;
        carrier.carrier.carriedShips.push(ship.id);
        // Add back to reserves for future launch
        const existing = carrier.carrier.reserves.find(r => r.classId === ship.classId);
        if (existing) existing.count++;
        else carrier.carrier.reserves.push({ classId: ship.classId, count: 1, name: ship.name });
        this.log(`${ship.name} — docked in ${carrier.name} (${carrier.carrier.carriedShips.length}/${carrier.carrier.maxSlots} slots)`, 'move');
      }
    }
  }

  /**
   * Processes ships ordered to dock at a SPATIAL STATION (Roost, Death Star…).
   * Modeled on processDocking() but the destination is a background body
   * (GameState.background.bodies), not a carrier ship. On arrival, the ship
   * is removed from play and added back as a line of cargo in the station's
   * abstract hangar (ds.hangarCargo) — symmetrical with the deploy mechanic.
   */
  /**
   * Processes ships ordered to LAND at a station or planet (atterrissage).
   * Modeled on processDocking() but the destination is a background body
   * (GameState.background.bodies), not a carrier ship. Background bodies live
   * far OUTSIDE the playable grid (×3.5 spread for visual depth) — a ship
   * can never actually reach their world position. Instead: the ship heads
   * toward the GRID EDGE in the body's direction, and landing completes as
   * soon as the ship actually EXITS the grid boundary on that side (matching
   * the player's mental model: "leaving the battlefield toward that body").
   * On arrival, the ship is removed from play and added back as a line of
   * cargo in the body's abstract hangar (ds.hangarCargo) — symmetrical with
   * the deploy/takeoff mechanic.
   */
  processStationDocking(ships) {
    const bodies = this.state.background?.bodies;
    if (!bodies?.length) return;
    const SIZE_VOL = SHIP_HANGAR_VOLUME;
    const cs = CONFIG.CELL_SIZE, grid = CONFIG.GRID_COLS * cs;
    const maxX = CONFIG.GRID_COLS - 1, maxY = CONFIG.GRID_ROWS - 1;

    for (const ship of ships) {
      if (ship.orders?.type !== 'dockStation') continue;
      const station = bodies.find(b => b.id === ship.orders.stationId);
      if (!station) { ship.orders = null; continue; }

      // Position monde du corps → grille (même conversion que le reste du
      // système de stations, étalement ×3.5 — donc loin hors plateau).
      const bodyGx = ((station.x - 0.5) * grid * 3.5 + grid / 2) / cs;
      const bodyGy = ((station.y - 0.5) * grid * 3.5 + grid / 2) / cs;

      // Direction du centre de la grille vers le corps → point de sortie sur
      // le bord du plateau dans cette direction (pas le centre du corps,
      // inatteignable). On vise LÉGÈREMENT au-delà du bord pour que le
      // vaisseau sorte franchement plutôt que de longer la limite.
      if (!ship._dockingTargetSet) {
        const cx = maxX / 2, cy = maxY / 2;
        const dx = bodyGx - cx, dy = bodyGy - cy;
        const dlen = Math.hypot(dx, dy) || 1;
        const dirX = dx / dlen, dirY = dy / dlen;
        ship.moveTarget = {
          x: clamp(cx + dirX * (maxX), -4, maxX + 8),
          y: clamp(cy + dirY * (maxY), -4, maxY + 8),
          z: ship.position.z,
        };
        ship._dockingDir = { x: dirX, y: dirY };
        ship._dockingTargetSet = true;
      }

      // Atterrissage validé dès que le vaisseau a effectivement QUITTÉ la
      // grille jouable (pas besoin d'atteindre une position lointaine) —
      // plus de boucle au bord du plateau.
      const exited = ship.position.x < -0.5 || ship.position.x > maxX + 0.5 ||
                     ship.position.y < -0.5 || ship.position.y > maxY + 0.5;
      if (exited) {
        const vol = SIZE_VOL[ship.size] || 12;
        const used = (station.hangarCargo || []).reduce((s, c) => s + (SIZE_VOL[c._size] || 12) * c.count, 0);
        if (used + vol > (station.hangarVolume || 0)) {
          this.log(`${ship.name} — cale de ${station.name || 'la station'} pleine, atterrissage refusé.`, 'move');
          ship.orders = null;
          ship._dockingTargetSet = false;
          // Le ramener doucement dans la grille plutôt que de le laisser
          // dériver indéfiniment hors plateau
          ship.moveTarget = { x: clamp(ship.position.x, 0, maxX), y: clamp(ship.position.y, 0, maxY), z: ship.position.z };
          continue;
        }
        // Atterrir : retirer le vaisseau du jeu, l'ajouter à la cargaison.
        // ownerFleetId trace QUI a le droit de le refaire décoller (le pilote
        // d'origine, pas forcément la faction de la station — un vaisseau
        // étranger reste la propriété de son pilote).
        ship.alive  = false;
        ship.docked = station.id;
        station.hangarCargo = station.hangarCargo || [];
        const existing = station.hangarCargo.find(c => c.classId === ship.classId && c.ownerFleetId === ship.fleetId);
        if (existing) { existing.count++; if (existing._size == null) existing._size = ship.size; }
        else station.hangarCargo.push({ classId: ship.classId, count: 1, _size: ship.size, ownerFleetId: ship.fleetId });
        this.log(`${ship.name} — atterri sur ${station.name || 'la station'}.`, 'move');
      }
    }
  }

  /** Launch N ships from a carrier reserve */
  _launchFromCarrier(carrier, reserve, count) {
    const { instantiatePreset } = this._lazyImports || {};
    // Dispatch event for app.js to handle (since createShip is in models.js)
    const event = new CustomEvent('carrier:launch', {
      detail: { carrierId: carrier.id, classId: reserve.classId, count, name: reserve.name }
    });
    if (typeof window !== 'undefined') window.dispatchEvent(event);
    reserve.count = Math.max(0, reserve.count - count);
  }

  _getClass(classId) {
    const TYPES = {
      fighter:        { type: 'fighter' },
      heavy_fighter:  { type: 'heavy_fighter' },
      interceptor:    { type: 'interceptor' },
      bomber:         { type: 'bomber' },
      gunship:        { type: 'gunship' },
      arc170:         { type: 'heavy_fighter' },
      ywing:          { type: 'bomber' },
      v19:            { type: 'fighter' },
      vulture_droid:  { type: 'fighter' },      // Separatist droid
      tri_droid:      { type: 'heavy_fighter' }, // Separatist tri-droid
    };
    return TYPES[classId] || null;
  }

  // ═══════════════════════════════════════════════════════
  // 1. ION DECAY
  // ═══════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════
  // RAYON TRACTEUR — capture de vaisseaux vulnérables
  // ═══════════════════════════════════════════════════════
  /**
   * Un vaisseau doté d'un rayon tracteur peut CAPTURER un ennemi qui est :
   *   - dans son rayon (tractorBeam, en cases),
   *   - de taille STRICTEMENT inférieure d'au moins un cran,
   *   - vulnérable : désactivé aux ions OU coque très basse (<20%) OU déjà en
   *     reddition. Capture = passage sous la faction du capteur.
   * On l'attire progressivement, puis on le capture une fois immobilisé.
   */
  processTractorBeams(ships) {
    const ORDER = ['XS','S','M','L','XL','XXL'];
    const rank = s => ORDER.indexOf(s);
    for (const captor of ships) {
      const reach = captor.tractorBeam || 0;
      if (reach <= 0 || captor.ionDisabled) continue;
      const captorRank = rank(captor.size);
      for (const tgt of ships) {
        if (tgt === captor || !tgt.alive) continue;
        if (tgt.fleetId === captor.fleetId) continue;   // pas les alliés
        if (tgt._captured) continue;
        // Plus petit d'au moins un cran
        if (rank(tgt.size) >= captorRank) continue;
        // Cible de capture explicitement désignée par le joueur ?
        const isDesignated = captor._captureTargetId === tgt.id;
        // Vulnérable ?
        const hpFrac = tgt.hp / (tgt.maxHp || tgt.hp || 1);
        const vulnerable = tgt.ionDisabled || hpFrac < 0.20 || tgt._surrendering;
        // Sans désignation, on ne capture QUE les cibles vulnérables ; avec
        // désignation, on attire dès qu'elle est à portée (et on capture quand
        // elle devient vulnérable).
        if (!isDesignated && !vulnerable) continue;
        // Dans le rayon ?
        const d = dist2D(captor.position, tgt.position);
        if (d > reach) continue;
        // Attirer la cible vers le capteur (immobilisation progressive)
        tgt._tractoredBy = captor.id;
        const pull = Math.min(1, (CONFIG.TICK_TIME_SCALE || 1) * 0.5);
        tgt.position.x += (captor.position.x - tgt.position.x) * 0.04 * pull;
        tgt.position.y += (captor.position.y - tgt.position.y) * 0.04 * pull;
        tgt.speed = 0;
        // Capture quand suffisamment proche ET vulnérable
        if (vulnerable && d < (SIZE_RADIUS[captor.size] || 56) / CONFIG.CELL_SIZE + 1.5) {
          tgt._captured = true;
          tgt.fleetId = captor.fleetId;
          tgt.faction = captor.faction;
          tgt.behavior = 'passive';
          tgt.orders = null;
          tgt.ionDisabled = false; tgt.ionStacks = 0;
          captor._captureTargetId = null;
          this.log(`🪝 ${tgt.name} CAPTURÉ par ${captor.name} !`, 'combat');
        }
      }
    }
  }

  processIonDecay(ships) {
    for (const ship of ships) {
      if (ship.ionStacks > 0) {
        ship.ionStacks = Math.max(0, ship.ionStacks - CONFIG.ION_DECAY_PER_TICK);
      }
      // Restore engines
      if (ship.driveOff > 0) {
        ship.driveOff--;
        if (ship.driveOff === 0) this.log(`${ship.name} — engines restored.`, 'ion');
      }
      // Restore systems
      if (ship.ionDisabled) {
        ship.ionStacks < CONFIG.ION_STACK_SYSTEMS_OFF && (ship.ionDisabled = false);
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // 2. SHIELD RECHARGE
  // ═══════════════════════════════════════════════════════

  processShieldRegen(ships) {
    for (const ship of ships) {
      const sh = ship.shields;
      if (!sh || sh.max <= 0) continue;

      if (sh.disabled) {
        // Count down to restart
        sh.restartCounter++;
        if (sh.restartCounter >= sh.restartDelay) {
          sh.disabled       = false;
          sh.restartCounter = 0;
          sh._inBurstMode   = true;   // fast burst recharge begins
          this.log(`${ship.name} — boucliers redémarrés (recharge rapide).`, 'shield');
        }
        continue;
      }

      if (sh.current >= sh.max) { sh._inBurstMode = false; continue; }

      // Ion penalty
      if (ship.ionStacks >= CONFIG.ION_STACK_SHIELD_OFF) {
        sh.disabled = true; sh.restartCounter = 0; sh._inBurstMode = false; continue;
      }
      let rate;
      if (sh._inBurstMode) {
        // Fast burst recharge after restart — use burstRechargeRate
        rate = sh.burstRechargeRate ?? 0.04;
        if (ship.ionStacks >= CONFIG.ION_STACK_SHIELD_REGEN) rate *= 0.5;
        // Exit burst mode once shields are full
        if (sh.current + rate * sh.max >= sh.max) sh._inBurstMode = false;
      } else {
        // Slow passive regen while shields are up
        rate = sh.rechargeRate ?? 0.003;
        if (ship.ionStacks >= CONFIG.ION_STACK_SHIELD_REGEN) rate *= 0.5;
      }

      // Energy policy modifier
      const em = getEnergyMods(ship);
      const cpShield = getCombatPolicyMods(ship, false);
      const effectiveMax = sh.max * em.shieldMaxMult;
      sh.current = Math.min(effectiveMax, sh.current + rate * em.shieldRegenMult * cpShield.shieldRegenMult * sh.max);
    }
  }

  // ═══════════════════════════════════════════════════════
  // 2b. ASTROMECH HEALING
  // ═══════════════════════════════════════════════════════

  processCombatPolicyChanges(ships) {
    for (const ship of ships) {
      if (!ship._pendingCombatPolicy) continue;

      // Validate: is the pending policy actually available for this ship?
      const available = getAvailablePolicies(ship);
      if (!available.has(ship._pendingCombatPolicy)) {
        ship._pendingCombatPolicy = null;
        ship._combatPolicyTimer   = 0;
        this.log(`⚠ ${ship.name} — politique indisponible (niveau trop bas), annulé.`, 'move');
        continue;
      }

      ship._combatPolicyTimer = (ship._combatPolicyTimer ?? 0) - 1;
      if (ship._combatPolicyTimer <= 0) {
        ship.combatPolicy         = ship._pendingCombatPolicy;
        ship._pendingCombatPolicy = null;
        ship._combatPolicyTimer   = 0;
        this.log(`⚙ ${ship.name} — politique de combat: ${ship.combatPolicy}`, 'move');
      }
    }
  }

  processTerrainEffects(ships) {
    const terrain  = this.state.terrain;
    if (!terrain || !Array.isArray(terrain)) return;

    const tc = this.state.terrainConfig || {};
    const cx = CONFIG.GRID_COLS / 2, cy = CONFIG.GRID_ROWS / 2;

    // Update terrain body drift from impacts
    updateTerrainPhysics(terrain);

    for (const ship of ships) {
      // ─── Gravity well ───────────────────────────────────────
      if (tc.type === 'black_hole') {
        applyGravityWell(ship, cx, cy, tc.pullStrength || 0.3);
      }

      // ─── Debris/asteroid collisions ─────────────────────────
      for (const body of terrain) {
        if (body.destroyed || body.type === 'nebula_cloud' || body.type === 'ice_shard') continue;
        resolveShipTerrainCollision(ship, body, (pos) => {
          // Trigger explosion in game state
          this.state.explosions = this.state.explosions || [];
          this.state.explosions.push({
            x: pos.x, y: pos.y, z: pos.z || 3,
            radius: pos.radius || 3, color: '#ff8800',
            startTime: Date.now(), type: 'explosion',
          });
          // Area damage to nearby ships
          this._applyAreaDamage(pos, pos.radius, 25, [ship.id]);
          this.log(`💥 Débris explosif !`, 'combat');
        });
      }

      // ─── Champ de GLACE : dégâts proportionnels à la vitesse ────
      // Petits fragments inévitables. À vitesse basse, presque rien ;
      // à pleine vitesse, l'usure devient significative → inciter à ralentir.
      if (tc.type === 'ice_field') {
        const speed = ship.speed || 0;
        const maxSpeed = (SIZE_DEFAULT_SPEED?.[ship.size]) || 3;
        const ratio = speed / Math.max(0.1, maxSpeed);          // 0 → 1+
        // Dégâts ∝ vitesse² : négligeable lent, mordant rapide
        const iceDmg = ratio * ratio * 1.4;
        if (iceDmg > 0.02 && !ship.ionDisabled) {
          // Boucliers d'abord, puis coque
          if (ship.shields && ship.shields.current > 0) {
            ship.shields.current = Math.max(0, ship.shields.current - iceDmg);
          } else {
            ship.hp -= iceDmg;
          }
          ship._iceScraping = ratio > 0.4; // pour les étincelles côté rendu
        } else {
          ship._iceScraping = false;
        }
      }

      // ─── Nebula effects (speed/sensor reduction) ────────────
      if (tc.type === 'nebula' && inNebula(ship.position.x, ship.position.y, terrain)) {
        // Speed and accuracy penalties applied via modifier in combat system
        ship._inNebula = true;
      } else {
        ship._inNebula = false;
      }
    }

    // Clean up destroyed non-explosive debris (they fade)
    // (kept in array so renderer can show destruction animation)
  }

  processForceDodgeCooldown(ships) {
    for (const ship of ships) {
      if (ship._forceDodgeCooldown > 0) ship._forceDodgeCooldown--;
    }
  }

  processAstromechHeal(ships, tick) {
    if (tick % 5 !== 0) return;
    const ASTROMECH_HEAL_CAP = 2 / 3;  // 66.6% of max HP
    for (const ship of ships) {
      if (!ship.inventory?.astromech || ship.inventory.astromech < 1) continue;
      if (ship._recentlyHit) continue;
      const cap = ship.maxHp * ASTROMECH_HEAL_CAP;
      if (ship.hp >= cap) continue;       // already at or above 66.6% — no healing
      ship.hp = Math.min(cap, ship.hp + 1);
    }
    for (const ship of ships) { ship._recentlyHit = false; }
  }

  // ═══════════════════════════════════════════════════════
  // 3. AI — DECISIONS
  // ═══════════════════════════════════════════════════════

  processAI(ships) {
    for (const ship of ships) {
      if (ship.ionDisabled) continue;

      // ═══ ABSOLUTE PRIORITY: hyperspace jump overrides ALL other logic ═══
      if (ship._jumpingToHyperspace) {
        // Un interdicteur qui arrive à portée INTERROMPT le warmup
        if (!ship._departingToHyper) {
          const trap = ships.find(s =>
            s.alive && s.fleetId !== ship.fleetId &&
            (s.gravityWell || 0) > 0 && !s.ionDisabled &&
            dist2D(s.position, ship.position) < s.gravityWell
          );
          if (trap) {
            ship._jumpingToHyperspace = false;
            ship._jumpStartTime = null;
            this.log(`🕸 ${ship.name} : saut interrompu par le puits de gravité !`, 'combat');
            continue;
          }
        }
        ship.velocity = { x: 0, y: 0 };
        ship.speed    = 0;
        const elapsed     = Date.now() - (ship._jumpStartTime || 0);
        const ticksWaited = this.state.tick - (ship._jumpStartTick || 0);

        // Phase 2 : warmup terminé → lancer l'animation de départ (inverse de l'arrivée)
        if (!ship._departingToHyper && (elapsed >= 2500 || ticksWaited >= 2)) {
          ship._departingToHyper = true;
          ship._departStartTime  = Date.now();
          ship._departDuration   = 1200;
          this.log(`🌀 ${ship.name} : saut en hyperespace…`, 'move');
        }
        // Phase 3 : animation finie → évadé (retiré de la partie, PAS détruit)
        if (ship._departingToHyper && Date.now() - ship._departStartTime >= ship._departDuration) {
          ship.alive     = false;
          ship.escaped   = true;
          ship.destroyed = false;
          // Mémoriser l'évasion dans la flotte (pour fin de bataille)
          const fleet = this.state.fleets?.find(f => f.fleetId === ship.fleetId);
          if (fleet) {
            fleet.escapedShips = fleet.escapedShips || [];
            fleet.escapedShips.push({ id: ship.id, name: ship.name, classId: ship.classId });
          }
          this.log(`✦ ${ship.name} a sauté en hyperespace — évadé !`, 'move');
        }
        continue; // priorité absolue — aucune autre IA
      }
      // Mode 'fuir' : priorité absolue sur les anciens ordres joueur —
      // sans ça un moveTo résiduel court-circuite la fuite ('continue' plus bas)
      // et le vaisseau orbite son ancien point de destination pour toujours
      if (ship.behavior?.mode === 'fuir' || ship.behavior?.mode === 'embarquement') {
        ship.orders = null;
      }
      // If a player gave a move/attack/escort order (stored in ship.orders),
      // AI only handles firing — it does NOT override movement or targeting.
      if (ship.orders && ship.orders.type !== 'none') {
        // Keep current attack target if set, but don't override player's moveTarget
        if (ship.orders.type === 'moveTo') {
          // Just make sure heading points roughly toward enemy for firing
          const firstEnemy = this.getEnemies(ship, ships)[0];
          if (firstEnemy && !ship.attacking) ship.attacking = firstEnemy.id;
          continue; // skip AI movement decisions
        }
        if (ship.orders.type === 'attack' && ship.orders.targetId) {
          const tgt = (this._shipsById?.get(ship.orders.targetId)?.alive ? this._shipsById.get(ship.orders.targetId) : null);
          if (tgt) { ship.attacking = tgt.id; }
          continue;
        }
        if (ship.orders.type === 'dockStation') {
          // Le déplacement est géré par processStationDocking() qui pose
          // moveTarget directement. Ici on laisse juste le vaisseau riposter
          // s'il est attaqué en chemin, sans laisser l'IA par défaut
          // recalculer une destination/cible qui annulerait le docking.
          const firstEnemy = this.getEnemies(ship, ships)[0];
          if (firstEnemy && ship.attackedBy) ship.attacking = firstEnemy.id;
          continue;
        }
      }

      // ─── Permanent order (GM) takes priority ─────────────
      if (ship.permanentOrder) {
        const po  = ship.permanentOrder;
        const tgt = (this._shipsById?.get(po.targetId)?.alive ? this._shipsById.get(po.targetId) : null);
        if (!tgt) {
          ship.permanentOrder = null;
        } else if (po.type === 'attack') {
          this._doAttackBehavior(ship, tgt);
          continue;
        } else if (po.type === 'escort') {
          this._doEscortBehavior(ship, tgt, ships);
          continue;
        }
      }

      const beh      = ship.behavior;
      const enemies  = this.getEnemies(ship, ships);
      const allies   = this.getAllies(ship, ships);
      const neutrals = this.getNeutrals(ship, ships);

      // ─── BLOCKADE RUNNER: only move toward waypoint, weapons auto-defense ──
      if (ship.combatPolicy === 'blockade_runner' && !ship._pendingCombatPolicy) {
        // Weapons fire automatically at ships attacking this ship (defensive turret mode)
        ship.attacking = ship.defensiveTarget || null;
        // Just move toward moveTarget if set — no AI decisions
        continue;
      }

      // ─── Neutral standoff: maintain minimum distance from neutral factions ──
      if (neutrals.length && !ship.moveTarget) {
        const STANDOFF = 6; // cells
        for (const n of neutrals) {
          const d = dist2D(ship.position, n.position);
          if (d < STANDOFF && d > 0.1) {
            const a = Math.atan2(ship.position.y - n.position.y, ship.position.x - n.position.x);
            ship.moveTarget = {
              x: clamp(ship.position.x + Math.cos(a) * STANDOFF, 0, CONFIG.GRID_COLS - 1),
              y: clamp(ship.position.y + Math.sin(a) * STANDOFF, 0, CONFIG.GRID_ROWS - 1),
              z: ship.position.z,
            };
            break;
          }
        }
      }

      // ─── Allied defense: intercept threats to allies ─────────────────────
      if (beh.mode === 'aggressive' && !enemies.length && allies.length) {
        const threatenedAlly = allies.find(a => a.defending && enemies.find(e => e.id === a.defending));
        if (threatenedAlly) {
          const threat = (this._shipsById?.get(threatenedAlly.defending)?.alive ? this._shipsById.get(threatenedAlly.defending) : null);
          if (threat && dist2D(ship.position, threat.position) < beh.radius * 1.5) {
            this._doAttackBehavior(ship, threat, ships);
          }
        }
      }

      switch (beh.mode) {

        case 'passive': break;

        case 'fuir': {
          // Find nearest hyperspace zone
          const routes = this.state.hyperspaceRoutes || [];
          const ZONE_R  = 18; // cells radius

          if (routes.length === 0) {
            // No zones — retreat off-map
            const isLeft = ship.position.x < CONFIG.GRID_COLS / 2;
            ship.moveTarget = { x: isLeft ? -5 : CONFIG.GRID_COLS + 5, y: ship.position.y, z: ship.position.z };
            break;
          }

          let nearestRoute = null, nearestDist = Infinity;
          for (const route of routes) {
            const d = dist2D(ship.position, { x: route.x, y: route.y });
            if (d < nearestDist) { nearestDist = d; nearestRoute = route; }
          }

          // ═══ PUITS DE GRAVITÉ : un interdicteur ennemi à portée
          // rend le saut hyperespace physiquement impossible ═══
          const interdictor = ships.find(s =>
            s.alive && s.fleetId !== ship.fleetId &&
            (s.gravityWell || 0) > 0 && !s.ionDisabled &&
            dist2D(s.position, ship.position) < s.gravityWell
          );
          if (interdictor && nearestDist <= ZONE_R) {
            // Piégé ! Le vaisseau ne peut pas sauter — il doit fuir le puits
            // ou détruire l'interdicteur. Log une seule fois par interdicteur.
            if (ship._gravLockBy !== interdictor.id) {
              ship._gravLockBy = interdictor.id;
              this.log(`🕸 ${ship.name} : saut impossible — puits de gravité de ${interdictor.name} !`, 'combat');
            }
            // Fuir dans la direction opposée à l'interdicteur
            const away = dirTo(interdictor.position, ship.position);
            ship.moveTarget = {
              x: clamp(ship.position.x + away.dx * 15, 0, CONFIG.GRID_COLS - 1),
              y: clamp(ship.position.y + away.dy * 15, 0, CONFIG.GRID_ROWS - 1),
              z: ship.position.z,
            };
            break;
          }
          ship._gravLockBy = null;

          if (nearestDist <= ZONE_R && ship.hyperdrive && !ship._jumpingToHyperspace) {
            // Clear any pending player orders so jump takes absolute priority
            ship.orders = null;
            // Enter jump zone — begin warmup ONCE
            ship._jumpingToHyperspace = true;
            ship._jumpStartTime       = Date.now();
            ship._jumpStartTick       = this.state.tick;
            ship.velocity = { x: 0, y: 0 };
            ship.speed    = 0;
            this.log(`⚡ ${ship.name} : activation hyperespace…`, 'move');
          } else if (nearestDist <= ZONE_R && !ship.hyperdrive) {
            // No hyperdrive — switch to boarding instead
            ship.behavior = { ...ship.behavior, mode: 'embarquement' };
          } else if (nearestRoute) {
            // Spread ships across the zone — strong jitter prevents pile-ups
            if (!ship._fuirJitterX) {
              ship._fuirJitterX = (Math.random() - 0.5) * 12;
              ship._fuirJitterY = (Math.random() - 0.5) * 12;
            }
            ship.moveTarget = {
              x: clamp(nearestRoute.x + ship._fuirJitterX, 0, CONFIG.GRID_COLS - 1),
              y: clamp(nearestRoute.y + ship._fuirJitterY, 0, CONFIG.GRID_ROWS - 1),
              z: ship.position.z
            };
            const threat = this._closestInRadius(enemies, ship.position, beh.radius * 0.5);
            if (threat && Math.random() > 0.5) this._doAttackBehavior(ship, threat, ships);
          }
          break;
        }

        case 'embarquement': {
          // Board nearest transport/carrier that has space
          const carriers = allies.filter(a =>
            a.carrier?.reserves && a.carrier.reserves.some(r => r.deployed < r.count) &&
            dist2D(a.position, ship.position) < 30
          ).sort((a, b) => dist2D(a.position, ship.position) - dist2D(b.position, ship.position));

          const target = carriers[0];
          if (target) {
            ship.moveTarget = { ...target.position };
            const d = dist2D(ship.position, target.position);
            if (d < 3) {
              // ── Embarquer RÉELLEMENT dans le hangar ──
              ship.alive   = false;
              ship.boarded = target.id;
              const res = target.carrier.reserves;
              // Slot existant pour cette classe, sinon en créer un
              let slot = res.find(r => r.classId === ship.classId);
              if (slot) {
                slot.count += 1; // un appareil de plus en réserve
              } else {
                res.push({ classId: ship.classId, type: ship.type, count: 1, deployed: 0 });
              }
              this.log(`⚓ ${ship.name} a embarqué sur ${target.name} (hangar : +1 ${ship.classId})`, 'move');
            }
          } else {
            // No carrier nearby — wait or move to nearest friendly
            const anyCarrier = allies.find(a => a.carrier?.reserves?.length > 0);
            if (anyCarrier) ship.moveTarget = { ...anyCarrier.position };
          }
          break;
        }

        case 'neutral':
          if (beh.attackedBy) {
            const att = (this._shipsById?.get(beh.attackedBy)?.alive ? this._shipsById.get(beh.attackedBy) : null);
            if (att) this._doAttackBehavior(ship, att);
            else beh.attackedBy = null;
          }
          break;

        case 'kamikaze': {
          // Rush directly at target — no firing, just collision
          const kTgt = (this._shipsById?.get(beh.targetId)?.alive ? this._shipsById.get(beh.targetId) : null)
                    || this._closestInRadius(enemies, ship.position, 999);
          if (kTgt) {
            ship.moveTarget = { ...kTgt.position };
            ship.attacking  = null; // no shooting — ramming only
            ship.rammingProfile = ship.rammingProfile || {};
            ship.rammingProfile.enabled     = true;
            ship.rammingProfile.bonusDamage = (ship.mass || 1) * 0.5;
            ship.rammingProfile.pushForce   = 3;
          }
          break;
        }

        // Dying kamikaze — keep moving toward last target
        case undefined: {
          if (ship._kamikazeDying && ship.moveTarget) {
            // Already heading somewhere, just keep going at full speed
          }
          break;
        }

        case 'bomber_assault': {
          // Bombers seek large capital ships and do strafing passes
          const target = this._bestBomberTarget(ship, enemies, beh.radius || 25);
          if (target) {
            this._doBomberPass(ship, target);
          } else {
            ship._bomberPhase = null;
            this._idleMove(ship, enemies);
          }
          // Track who is attacking this ship for defensive weapons
          const attacker = ships.find(s => s.attacking === ship.id && s.alive && s.fleetId !== ship.fleetId);
          ship.defensiveTarget = attacker?.id || null;
          break;
        }

        case 'aggressive': {
          const smallTypes = ['fighter','heavy_fighter','interceptor','bomber','gunship'];
          const isFighter  = smallTypes.includes(ship.type);
          const isBomber   = ship.type === 'bomber';

          let target = null;

          if (isBomber) {
            // Bombers seek large capital ships — no radius cap in aggressive mode
            target = this._bestBomberTarget(ship, enemies, Infinity)
                  || enemies[0];
          } else if (isFighter) {
            // Intercept enemy bombers first
            const enemyBombers = enemies.filter(e => e.type === 'bomber' || e.behavior?.mode === 'bomber_assault');
            if (enemyBombers.length) target = this._closest(enemyBombers, ship.position);

            // Auto-escort nearby friendly bombers
            if (!target) {
              const fBombers = ships.filter(s =>
                s.fleetId === ship.fleetId && s.type === 'bomber' &&
                (s._bomberPhase === 'dropping' || s._bomberPhase === 'approach') &&
                dist2D(s.position, ship.position) < 18
              );
              if (fBombers.length) {
                const threats = enemies.filter(e => dist2D(e.position, fBombers[0].position) < 18);
                if (threats.length) target = this._closest(threats, ship.position);
              }
            }
            // Fallback: closest enemy of any type
            // ═══ OPTIMISATION « HORDE » ═══
            // Sans ça, CHAQUE chasseur recalcule indépendamment « qui est le
            // plus proche parmi TOUS les ennemis » — avec des centaines de
            // chasseurs identiques ça devient des dizaines de milliers de
            // comparaisons par tic pour un résultat presque toujours regroupé
            // de toute façon (les chasseurs alliés proches finissent sur des
            // cibles proches). On regroupe les chasseurs du même type/flotte
            // proches les uns des autres en « escadrille » ; un seul calcul
            // de proximité par escadrille, partagé entre ses membres (chacun
            // garde sa cible déjà engagée si elle est encore valide, pour ne
            // pas faire « sauter » les tirs en cours).
            if (!target) target = this._squadClosestEnemy(ship, enemies);

          } else {
            // Capital ships: prefer large targets, always attack (no radius limit)
            const large = enemies.filter(e => ['M','L','XL','XXL'].includes(e.size));
            target = large.length
              ? this._closest(large, ship.position)
              : this._closest(enemies, ship.position);
          }

          if (target) {
            if (isBomber) this._doBomberPass(ship, target);
            else          this._doAttackBehavior(ship, target);
          }
          break;
        }

        case 'target': {
          const tgt = (this._shipsById?.get(beh.targetId)?.alive && this._shipsById.get(beh.targetId).fleetId !== ship.fleetId ? this._shipsById.get(beh.targetId) : null);
          if (tgt) {
            this._doAttackBehavior(ship, tgt);
          } else {
            const fallback = this._closestInRadius(enemies, ship.position, beh.radius);
            if (fallback) this._doAttackBehavior(ship, fallback);
            else ship.attacking = null;
          }
          break;
        }

        case 'ecran': {
          // ÉCRAN DE CHASSEURS (doctrine SW) : orbite défensive autour du
          // capital allié le plus proche. N'engage QUE les chasseurs et
          // bombardiers ennemis qui pénètrent le périmètre — jamais les
          // capitaux, et ne quitte jamais son poste de garde.
          const SCREEN_R = beh.radius || 14;        // rayon de l'écran
          const capitals = ships.filter(s =>
            s.alive && s.fleetId === ship.fleetId &&
            ['M','L','XL','XXL'].includes(s.size)
          );
          if (capitals.length === 0) {
            // Plus de capital à protéger → bascule en agressif
            ship.behavior = { ...beh, mode: 'aggressive' };
            break;
          }
          // Garder le capital désigné, sinon le plus proche
          let guarded = beh.targetId ? capitals.find(s => s.id === beh.targetId) : null;
          if (!guarded) {
            guarded = this._closestInRadius(capitals, ship.position, Infinity);
            ship.behavior = { ...beh, targetId: guarded.id };
          }

          // Menaces : uniquement XS/S ennemis (chasseurs, bombardiers,
          // canonnières) à l'intérieur du périmètre élargi du capital
          const intruders = enemies.filter(e =>
            ['XS','S'].includes(e.size) &&
            dist2D(e.position, guarded.position) < SCREEN_R * 1.4
          );
          // Priorité aux bombardiers (la menace principale contre les capitaux)
          const bombers = intruders.filter(e =>
            e.type === 'bomber' || (e.inventory?.torpedoes > 0) || (e.inventory?.bombs > 0)
          );
          const threat = bombers.length
            ? this._closestInRadius(bombers, ship.position, Infinity)
            : intruders.length
              ? this._closestInRadius(intruders, ship.position, Infinity)
              : null;

          if (threat) {
            // Intercepter — mais sans jamais sortir du périmètre ×2
            const tDist = dist2D(threat.position, guarded.position);
            if (tDist < SCREEN_R * 2) {
              ship.attacking  = threat.id;
              ship.moveTarget = { x: threat.position.x, y: threat.position.y, z: threat.position.z };
            } else {
              ship.attacking = null;
            }
          }
          if (!threat || !ship.attacking) {
            // Pas de menace → patrouille orbitale autour du capital
            if (ship._screenAngle === undefined) ship._screenAngle = Math.random() * Math.PI * 2;
            ship._screenAngle += 0.25; // vitesse orbitale (rad/tick)
            ship.moveTarget = {
              x: clamp(guarded.position.x + Math.cos(ship._screenAngle) * SCREEN_R, 0, CONFIG.GRID_COLS - 1),
              y: clamp(guarded.position.y + Math.sin(ship._screenAngle) * SCREEN_R, 0, CONFIG.GRID_ROWS - 1),
              z: guarded.position.z,
            };
            ship.attacking = null;
          }
          break;
        }

        case 'escort': {
          // AGGRESSIVE escort: follow escortTarget but actively hunt nearby enemies
          const escorted = (this._shipsById?.get(beh.targetId)?.alive ? this._shipsById.get(beh.targetId) : null);
          if (!escorted) { ship.behavior = { ...beh, mode:'aggressive' }; break; }

          const toEscort = dist2D(ship.position, escorted.position);

          // Priority 1: any enemy targeting the escort target
          // Priority 2: bombers within range of escort target
          // Priority 3: any enemy within aggressive engagement range (fight!)
          const directThreats = enemies.filter(e =>
            e.attacking === escorted.id ||
            ((e.type === 'bomber' || e.behavior?.mode === 'bomber_assault') &&
             dist2D(e.position, escorted.position) < (beh.radius || 25))
          );

          const nearby = enemies.filter(e =>
            dist2D(e.position, ship.position) < Math.min(beh.radius || 25, 22)
          );

          const target = directThreats.length
            ? this._closestInRadius(directThreats, ship.position, Infinity)
            : nearby.length
              ? this._closestInRadius(nearby, ship.position, 22)
              : null;

          if (target) {
            this._doAttackBehavior(ship, target);
          } else {
            // No enemy — position between escort target and nearest enemy
            ship.attacking = null;
            const closestEnemy = this._closestInRadius(enemies, escorted.position, beh.radius || 25);
            if (closestEnemy && toEscort < (beh.distance || 4) * 3) {
              const midX = (escorted.position.x + closestEnemy.position.x) / 2;
              const midY = (escorted.position.y + closestEnemy.position.y) / 2;
              ship.moveTarget = { x: midX, y: midY, z: escorted.position.z };
            } else if (toEscort > (beh.distance || 4)) {
              ship.moveTarget = {
                x: escorted.position.x + (Math.random() - 0.5) * 4,
                y: escorted.position.y + (Math.random() - 0.5) * 4,
                z: escorted.position.z,
              };
            }
          }
          ship.defensiveTarget = ships.find(s => s.attacking === ship.id && s.alive && s.fleetId !== ship.fleetId)?.id || null;
          break;
        }

        case 'patrol': {
          if (beh.points?.length > 0) {
            const pt = beh.points[beh.patrolIndex];
            if (dist2D(ship.position, pt) < 1) {
              beh.patrolIndex = (beh.patrolIndex + 1) % beh.points.length;
            } else {
              ship.moveTarget = { ...pt };
            }
          }
          const intruder = enemies.find(e =>
            !beh.authorizedFleets.includes(e.fleetId) &&
            dist2D(e.position, ship.position) <= beh.radius
          );
          if (intruder) this._doAttackBehavior(ship, intruder);
          break;
        }
      }
    }
  }

  /**
   * Attack behavior: approach to optimal range, hold position, fire.
   * Broadside ships (Venator) approach perpendicular to present their flanks.
   */
  _doAttackBehavior(ship, target) {
    ship.attacking = target.id;

    const dist     = dist2D(ship.position, target.position);
    const maxRange = ship.weapons.length > 0
      ? Math.max(...ship.weapons.map(w => w.range)) : 5;
    // Capital ships keep more distance; apply combat policy range
    const cpMods   = getCombatPolicyMods(ship, true);
    const isCapital = ['M','L','XL','XXL'].includes(ship.size);
    const engageRangeMult = isCapital ? 0.88 : 0.72; // capitals fight at longer range
    const optRange = maxRange * engageRangeMult * cpMods.rangeMult;
    const minRange = isCapital ? maxRange * 0.55 : maxRange * 0.35; // capitals stay further back

    // Detect broadside-only weapons
    const broadsideWeapon = ship.weapons.find(w => Math.abs(w.arcOffset || 0) > 0.3);

    // ─── Tactical flanking for capitals (M+) ─────────────────
    // Angle de flanc MIS EN CACHE par cible : recalculé seulement quand la
    // cible change, sinon le mouvement devient erratique (jitter chaque tick)
    const flankedAngle = (() => {
      if (!isCapital || cpMods.holdPosition) return null;
      if (ship._flankTargetId !== target.id || ship._flankAngle === undefined) {
        ship._flankTargetId = target.id;
        ship._flankAngle    = (Math.random() - 0.5) * 0.8; // offset fixe par cible
      }
      const tHeading = target.heading ?? 0;
      return tHeading + Math.PI + ship._flankAngle;
    })();

    if (dist > optRange * 1.15) {
      if (broadsideWeapon) {
        const angleToTarget = Math.atan2(
          target.position.y - ship.position.y,
          target.position.x - ship.position.x
        );
        const approachAngle = angleToTarget + Math.PI / 2;
        ship.moveTarget = {
          x: clamp(target.position.x + Math.cos(approachAngle) * optRange, 0, CONFIG.GRID_COLS - 1),
          y: clamp(target.position.y + Math.sin(approachAngle) * optRange, 0, CONFIG.GRID_ROWS - 1),
          z: ship.position.z,
        };
      } else if (flankedAngle !== null) {
        // Move to flanking position behind target
        const tRearX = clamp(target.position.x + Math.cos(flankedAngle) * optRange, 0, CONFIG.GRID_COLS - 1);
        const tRearY = clamp(target.position.y + Math.sin(flankedAngle) * optRange, 0, CONFIG.GRID_ROWS - 1);
        ship.moveTarget = { x: tRearX, y: tRearY, z: ship.position.z };
      } else {
        ship.moveTarget = { ...target.position };
      }
    } else if (dist < minRange) {
      // Too close — back off (capitals never brawl at contact range)
      const away = dirTo(target.position, ship.position);
      ship.moveTarget = {
        x: clamp(ship.position.x + away.dx * (minRange - dist + 2.0), 0, CONFIG.GRID_COLS - 1),
        y: clamp(ship.position.y + away.dy * (minRange - dist + 2.0), 0, CONFIG.GRID_ROWS - 1),
        z: ship.position.z,
      };
    } else {
      // In optimal range — blockade holds position, others maneuver
      ship.moveTarget = cpMods.holdPosition ? null : (flankedAngle !== null ? {
        x: clamp(target.position.x + Math.cos(flankedAngle) * optRange * 0.95, 0, CONFIG.GRID_COLS - 1),
        y: clamp(target.position.y + Math.sin(flankedAngle) * optRange * 0.95, 0, CONFIG.GRID_ROWS - 1),
        z: ship.position.z,
      } : null);
      let desiredHeading;
      if (broadsideWeapon) {
        const angleToTarget = Math.atan2(
          target.position.y - ship.position.y,
          target.position.x - ship.position.x
        );
        desiredHeading = angleToTarget - Math.PI / 2;
      } else {
        desiredHeading = Math.atan2(
          target.position.y - ship.position.y,
          target.position.x - ship.position.x
        );
      }
      // Turn toward target heading
      const maxTurnAI = CONFIG.TURN_RATES[ship.size] || 0.1;
      const pilotMods = getPilotCombatMods(ship);
      const gTurnMult = pilotMods.gTurnMult || 1.0;
      const energyMods = getEnergyMods(ship);
      let diff = desiredHeading - (ship.heading ?? 0);
      diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
      ship.heading += Math.min(Math.abs(diff), maxTurnAI * gTurnMult) * Math.sign(diff);
    }

    // Small ships: consider altitude advantage (climb above for dive bonus)
    if (['XS', 'S'].includes(ship.size)) {
      const altDiff = target.position.z - ship.position.z;
      // If we're at the same or lower altitude and within combat range, try to climb above
      if (altDiff >= 0 && dist < maxRange * 2 && ship.position.z < CONFIG.ALTITUDE_MAX) {
        if (ship.moveTarget) {
          ship.moveTarget.z = Math.min(CONFIG.ALTITUDE_MAX, target.position.z + 1);
        }
      }
      // If well above the target, keep altitude advantage (dive bonus)
      if (altDiff < -1) {
        if (ship.moveTarget) ship.moveTarget.z = ship.position.z; // maintain altitude
      }
    }

    // Small ships: ALWAYS keep moving (evasive maneuvering, even in combat)
    if (['XS', 'S'].includes(ship.size) && !ship.moveTarget) {
      const jink = (Math.random() - 0.5) * 1.5; // small random offset
      const angle = (ship.heading ?? 0) + jink;
      ship.moveTarget = {
        x: clamp(ship.position.x + Math.cos(angle) * (ship.speed * 1.5), 0, CONFIG.GRID_COLS - 1),
        y: clamp(ship.position.y + Math.sin(angle) * (ship.speed * 1.5), 0, CONFIG.GRID_ROWS - 1),
        z: ship.position.z,
      };
    }
  }

  /**
   * Escort behavior: intercept threats BEFORE they reach the protected ship.
   * Priority order:
   *  1. Rush ships already attacking or targeting the escorted vessel
   *  2. Intercept ships approaching within the safety perimeter
   *  3. Stay in formation near the escorted ship
   *  4. Patrol for threats within patrol radius
   */
  _doEscortBehavior(ship, escorted, ships) {
    const beh      = ship.behavior;
    const enemies  = this.getEnemies(ship, ships);
    const safeZone = Math.max(ship.weapons.length > 0 ? Math.max(...ship.weapons.map(w=>w.range)) * 0.8 : 4, 4);

    // Priority 1: Someone is actively attacking the escorted ship → rush to intercept
    const attackers = enemies.filter(e =>
      e.attacking === escorted.id ||
      e.permanentOrder?.targetId === escorted.id
    );
    if (attackers.length > 0) {
      const threat = this._closestInRadius(attackers, ship.position, 999);
      if (threat) {
        // Move to the point between threat and escorted ship (closer to threat)
        const ix = threat.position.x * 0.5 + escorted.position.x * 0.5;
        const iy = threat.position.y * 0.5 + escorted.position.y * 0.5;
        ship.moveTarget = { x: ix, y: iy, z: escorted.position.z };
        ship.attacking  = threat.id;
        return;
      }
    }

    // Priority 2: Enemy approaching the safe zone → intercept on approach vector
    const approaching = enemies.filter(e => {
      const d = dist2D(e.position, escorted.position);
      if (d > safeZone * 2.5) return false;
      // Check if moving toward escorted ship
      if (e.moveTarget) {
        const dAfter = dist2D(e.moveTarget, escorted.position);
        return dAfter < d; // getting closer
      }
      return d < safeZone * 1.5;
    });
    if (approaching.length > 0) {
      const threat = this._closestInRadius(approaching, escorted.position, 999);
      if (threat) {
        // Intercept between current enemy position and escorted ship
        const intercept = {
          x: threat.position.x * 0.35 + escorted.position.x * 0.65,
          y: threat.position.y * 0.35 + escorted.position.y * 0.65,
          z: ship.position.z,
        };
        ship.moveTarget = intercept;
        ship.attacking  = threat.id;
        return;
      }
    }

    // Priority 3: Stay in formation
    const d = dist2D(ship.position, escorted.position);
    if (d > (beh.distance || 2.5) + 2) {
      ship.moveTarget = {
        x: escorted.position.x + (Math.random() - 0.5) * 2,
        y: escorted.position.y + (Math.random() - 0.5) * 2,
        z: escorted.position.z,
      };
      ship.attacking = null;
      return;
    }

    // Priority 4: Patrol for any threats within radius
    const nearby = this._closestInRadius(enemies, escorted.position, beh.radius || 10);
    if (nearby) this._doAttackBehavior(ship, nearby);
    else ship.attacking = null;
  }

  /**
   * Bombers seek large, distracted, or weakly-shielded targets.
   * Prefer to attack from above (higher altitude = bombardment bonus).
   */
  _bestBomberTarget(bomber, enemies, radius) {
    const largeTypes = ['corvette','frigate','cruiser','destroyer','dreadnought'];
    const inRadius   = enemies.filter(e => dist2D(e.position, bomber.position) <= radius);
    if (!inRadius.length) return null;

    // Score: prefer large ships, weakened shields, lower altitude than bomber
    const scored = inRadius.map(e => {
      const sizeScore   = ['XS','S','M','L','XL','XXL'].indexOf(e.size);
      const shieldScore = e.shields.max > 0 ? (1 - e.shields.current / e.shields.max) * 3 : 2;
      const altScore    = bomber.position.z > e.position.z ? 2 : 0; // above = bombardment
      return { ship: e, score: sizeScore + shieldScore + altScore };
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0].ship;
    // Try to position above target for bombardment
    if (bomber.position.z <= best.position.z) {
      bomber.moveTarget = { ...best.position, z: Math.min(best.position.z + 2, CONFIG.ALTITUDE_MAX) };
    }
    return best;
  }

  /**
   * Idle movement: ships in aggressive mode drift toward enemy cluster.
   * Small ships (XS/S) use STEALTH APPROACH from below when far from enemies:
   *   Phase 1 (far): descend to low altitude → approach under enemy radar
   *   Phase 2 (close): climb above target → dive-bomb with accuracy bonus
   */
  _idleMove(ship, enemies) {
    const isSmall = ['XS', 'S'].includes(ship.size);

    if (!enemies.length) {
      if (isSmall && !ship.moveTarget) {
        const jink = (Math.random() - 0.5) * 2.5;
        const angle = (ship.heading ?? 0) + jink;
        ship.moveTarget = {
          x: clamp(ship.position.x + Math.cos(angle) * ship.speed * 2, 0, CONFIG.GRID_COLS - 1),
          y: clamp(ship.position.y + Math.sin(angle) * ship.speed * 2, 0, CONFIG.GRID_ROWS - 1),
          z: ship.position.z,
        };
      }
      return;
    }

    // Center of enemy mass
    const cx = enemies.reduce((s, e) => s + e.position.x, 0) / enemies.length;
    const cy = enemies.reduce((s, e) => s + e.position.y, 0) / enemies.length;
    const cz = enemies.reduce((s, e) => s + (e.position.z || 3), 0) / enemies.length;

    if (isSmall) {
      const distToEnemies = dist2D(ship.position, { x: cx, y: cy });

      // STEALTH APPROACH: if far, fly at low altitude (exploit detection penalty)
      if (distToEnemies > 25 && ship.position.z > CONFIG.ALTITUDE_MIN) {
        ship.moveTarget = {
          x: cx, y: cy,
          z: Math.max(CONFIG.ALTITUDE_MIN, ship.position.z - 1),
        };
        return;
      }
      // SURPRISE CLIMB: within strike range, climb above target for dive bonus
      if (distToEnemies <= 20 && ship.position.z < cz + 1) {
        ship.moveTarget = {
          x: cx, y: cy,
          z: Math.min(CONFIG.ALTITUDE_MAX, Math.ceil(cz) + 1),
        };
        return;
      }
    }

    if (!isSmall || !ship.moveTarget) {
      ship.moveTarget = { x: cx, y: cy, z: ship.position.z };
    }
  }

  /**
   * Bomber pass behavior: bomber climbs above target, makes a strafing pass,
   * drops bombs at closest approach, then pulls away and loops back.
   * Uses ship._bomberPhase to track the phase: 'climb' | 'pass' | 'pullaway'
   */
  /**
   * Bomber pass: the lead bomber coordinates a V-formation squad.
   * - Recruits nearby friendly bombers into the same run
   * - Calls nearby fighters to escort the formation
   * - Flies in V-formation through the target, then loops back
   *
   * V-formation positions (relative to approach direction):
   *   [0]: lead  [1]: left-1  [2]: right-1  [3]: left-2  [4]: right-2 ...
   */
  _doBomberPass(ship, target) {
    const V_OFFSETS = [
      { perp: 0, back: 0 },       // lead
      { perp: -2.5, back: 1.5 },  // left wing
      { perp:  2.5, back: 1.5 },  // right wing
      { perp: -5,   back: 3 },    // left outer
      { perp:  5,   back: 3 },    // right outer
      { perp: -7.5, back: 4.5 },  // left far
      { perp:  7.5, back: 4.5 },  // right far
    ];

    // Only the LEAD bomber runs the full squad logic
    const isLead = !ship._squadLeader;

    if (isLead) {
      ship._bomberPassTarget = target.id;

      if (!ship._bomberPhase || ship._bomberPhase === 'regroup') {
        ship._bomberPhase = 'climb';

        // RECRUIT nearby friendly bombers into the squad (up to 6 wingmen = 7 total)
        const candidates = (this.state.ships || []).filter(s =>
          s.alive && s.fleetId === ship.fleetId && s.type === 'bomber' &&
          s.id !== ship.id && !s._squadLeader &&
          dist2D(s.position, ship.position) < 22
        ).slice(0, 6);

        candidates.forEach((b, i) => {
          b._squadLeader          = ship.id;
          b._squadFormationIndex  = i + 1; // 1-6
          b._bomberPassTarget     = target.id;
          b._bomberPhase          = 'climb'; // sync phase
          b.attacking             = null;
        });

        // CALL nearby fighters to escort the formation
        const nearFighters = (this.state.ships || []).filter(s =>
          s.alive && s.fleetId === ship.fleetId &&
          ['fighter','heavy_fighter','interceptor','gunship'].includes(s.type) &&
          dist2D(s.position, ship.position) < 20 &&
          s.behavior?.mode !== 'bomber_assault'
        ).slice(0, 8);

        nearFighters.forEach(f => {
          f.behavior = {
            mode:    'escort',
            radius:  25,
            targetId: ship.id, // escort the lead bomber
            points:  [], patrolIndex: 0, attackedBy: null,
            distance: 3, authorizedFleets: [ship.fleetId],
          };
        });
        if (nearFighters.length) {
          this.log(`📡 ${ship.name} calls ${nearFighters.length} fighters to escort`, 'move');
        }
      }
    } else {
      // WINGMAN: sync phase from leader
      const leader = (this.state.ships || []).find(s => s.id === ship._squadLeader && s.alive);
      if (!leader) {
        // Leader gone — become independent
        ship._squadLeader = null;
        ship._squadFormationIndex = null;
        return;
      }
      ship._bomberPhase     = leader._bomberPhase;
      ship._bomberPassTarget = leader._bomberPassTarget;
      target = (this.state.ships || []).find(s => s.id === ship._bomberPassTarget && s.alive) || target;
      if (!target) return;
    }

    // Calculate formation offset for this specific ship
    const formIdx = ship._squadFormationIndex || 0;
    const fOff    = V_OFFSETS[formIdx] || { perp: 0, back: 0 };
    const dist    = dist2D(ship.position, target.position);

    switch (ship._bomberPhase) {

      case 'climb':
        if (ship.position.z < target.position.z + 1.8) {
          ship.moveTarget = {
            x: ship.position.x + Math.cos(ship.heading ?? 0) * 1,
            y: ship.position.y + Math.sin(ship.heading ?? 0) * 1,
            z: Math.min(CONFIG.ALTITUDE_MAX, target.position.z + 2),
          };
        } else {
          ship._bomberPhase = 'approach';
        }
        break;

      case 'approach': {
        const approachDir = Math.atan2(target.position.y - ship.position.y, target.position.x - ship.position.x);
        const perpDir     = approachDir + Math.PI / 2;
        // V-formation: offset perpendicular + lag behind lead
        const fx = target.position.x + Math.cos(approachDir) * 8
                 + Math.cos(perpDir) * fOff.perp
                 - Math.cos(approachDir) * fOff.back;
        const fy = target.position.y + Math.sin(approachDir) * 8
                 + Math.sin(perpDir) * fOff.perp
                 - Math.sin(approachDir) * fOff.back;
        ship.moveTarget = {
          x: clamp(fx, 0, CONFIG.GRID_COLS - 1),
          y: clamp(fy, 0, CONFIG.GRID_ROWS - 1),
          z: ship.position.z,
        };
        if (dist <= 4 + Math.abs(fOff.back)) ship._bomberPhase = 'dropping';
        break;
      }

      case 'dropping':
        ship.attacking = target.id;
        {
          const dir = Math.atan2(target.position.y - ship.position.y, target.position.x - ship.position.x);
          ship.moveTarget = {
            x: clamp(target.position.x + Math.cos(dir) * 12, 0, CONFIG.GRID_COLS - 1),
            y: clamp(target.position.y + Math.sin(dir) * 12, 0, CONFIG.GRID_ROWS - 1),
            z: ship.position.z,
          };
        }
        if (dist > 5 && ship.moveTarget) {
          ship._bomberPhase = 'pullaway';
          ship.attacking    = null;
        }
        break;

      case 'pullaway': {
        const awayDir = (ship.heading ?? 0) + Math.PI;
        ship.moveTarget = {
          x: clamp(ship.position.x + Math.cos(awayDir) * 14, 0, CONFIG.GRID_COLS - 1),
          y: clamp(ship.position.y + Math.sin(awayDir) * 14, 0, CONFIG.GRID_ROWS - 1),
          z: ship.position.z,
        };
        if (dist > 16) {
          ship._bomberPhase = 'regroup';
          ship.attacking    = null;
          // Wingmen also release from squad on regroup so lead can re-form next pass
          if (!isLead) ship._squadLeader = null;
        }
        break;
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  // 4. ORDER EXECUTION (MOVEMENT)
  // ═══════════════════════════════════════════════════════

  /**
   * Movement sub-step (fraction = 1/SIM_SUB_STEPS).
   * Ships advance in their current heading direction each sub-step,
   * turning gradually toward destination — produces visible curved arcs.
   */
  processOrdersSubStep(ships, fraction) {
    for (const ship of ships) {
      if (ship.driveOff > 0) continue;

      const dest = ship.moveTarget;
      if (!dest) continue;

      // ─── Terrain obstacle avoidance ───────────────────────
      const terrain = this.state.terrain;
      if (terrain?.length) {
        for (const body of terrain) {
          if (body.destroyed || body.type === 'nebula_cloud' || body.type === 'black_hole_core') continue;
          if (body.z !== 0 && Math.abs(body.z - Math.round(ship.position.z)) > 1) continue;
          const bx = body.x - ship.position.x;
          const by = body.y - ship.position.y;
          const bd = Math.hypot(bx, by);
          const avoidR = body.radius + 1.8;
          if (bd < avoidR && bd > 0.1) {
            const perp = { x: -by / bd, y: bx / bd };
            ship.moveTarget = {
              x: clamp(dest.x + perp.x * (avoidR - bd) * 1.2, 0, CONFIG.GRID_COLS - 1),
              y: clamp(dest.y + perp.y * (avoidR - bd) * 1.2, 0, CONFIG.GRID_ROWS - 1),
              z: dest.z,
            };
          }
        }
      }

      const d2D = dist2D(ship.position, dest);
      if (d2D < 0.2) {
        ship.position.x = dest.x;
        ship.position.y = dest.y;
        if (dest.z !== undefined) ship.position.z = dest.z;
        ship.moveTarget = null;
        if (ship.orders?.type === 'moveTo') ship.orders = null;
        continue;
      }

      // Turn toward destination — rate spread across sub-steps
      const desiredHeading = Math.atan2(dest.y - ship.position.y, dest.x - ship.position.x);
      let headingDiff = desiredHeading - (ship.heading ?? 0);
      headingDiff = ((headingDiff + Math.PI) % (2 * Math.PI)) - Math.PI;

      const maxTurnPerSub = (CONFIG.TURN_RATES[ship.size] || 0.1) / CONFIG.SIM_SUB_STEPS
        * (CONFIG.TICK_TIME_SCALE || 1)
        * (getPilotCombatMods(ship).gTurnMult || 1.0);
      ship.heading = (ship.heading ?? 0) + Math.min(Math.abs(headingDiff), maxTurnPerSub) * Math.sign(headingDiff);

      // Move forward in current heading — pivoting creates natural arcs
      const turnRatio   = Math.min(1, Math.abs(headingDiff) / (Math.PI * 0.75));
      const energyMods  = getEnergyMods(ship);
      // Dive speed bonus: descending toward target = gravity-assist speed
      const diveMult    = (dest.z < ship.position.z)
        ? [1.0, 1.03, 1.07, 1.13][Math.min(3, ship.pilotLevel || 1)]
        : 1.0;
      const cpMoveMods  = getCombatPolicyMods(ship, true);
      const speedMult   = Math.max(CONFIG.TURN_SPEED_PENALTY, 1 - turnRatio * 0.35) * energyMods.speedMult * diveMult * cpMoveMods.speedMult;
      const step = Math.min(ship.speed * fraction * speedMult * (CONFIG.SPEED_MULT || 2.0) * (CONFIG.TICK_TIME_SCALE || 1), d2D);

      ship.position.x += Math.cos(ship.heading) * step;
      ship.position.y += Math.sin(ship.heading) * step;

      // Record waypoint for smooth curved animation in renderer
      if (!ship._trajectory) ship._trajectory = [];
      ship._trajectory.push({ x: ship.position.x, y: ship.position.y });

      if (dest.z !== undefined && dest.z !== ship.position.z) {
        const dz = dest.z - ship.position.z;
        ship.position.z = clamp(
          ship.position.z + Math.sign(dz) * Math.min(0.06, Math.abs(dz)),
          CONFIG.ALTITUDE_MIN, CONFIG.ALTITUDE_MAX
        );
      }
    }
  }

  // Keep alias for external calls
  processOrders(ships) { this.processOrdersSubStep(ships, 1); }

  /**
   * Ally collision avoidance: smaller ships yield to larger ones.
   * Ships gently push away from nearby friendlies to prevent pileups.
   * Priority: XS/S dodge M/L/XL/XXL; same-size ships share space.
   */
  processAllyAvoidance(ships, fraction) {
    const SIZE_RANK = { XS: 0, S: 1, M: 2, L: 3, XL: 4, XXL: 5 };
    const SAFE_DIST = { XS: 0.6, S: 0.9, M: 1.6, L: 2.8, XL: 4.5, XXL: 7 };

    // ═══ OPTIMISATION « GRILLE SPATIALE » ═══
    // Cette fonction tourne À CHAQUE SOUS-TIC (×16 par tic) et ne compare
    // utilement les vaisseaux qu'à courte portée (≤ ~21 cases, closeRange).
    // L'ancienne version testait CHAQUE PAIRE (ships × ships) — O(n²) par
    // sous-tic, donc O(n²×16) par tic. Avec des centaines de vaisseaux c'est
    // le principal goulot mesuré. On découpe le plateau en cellules de
    // hachage spatial (CELL ~ portée max de détection) : un vaisseau ne
    // teste plus que les vaisseaux des cellules adjacentes (9 cellules),
    // pas le reste de la flotte. Résultat identique, complexité ~O(n).
    const CELL = 22; // un peu plus que closeRange max (XXL safe*3 = 21)
    const grid = new Map();
    const cellKey = (cx, cy) => cx * 100000 + cy; // entier unique, rapide
    for (const s of ships) {
      const cx = Math.floor(s.position.x / CELL);
      const cy = Math.floor(s.position.y / CELL);
      const k = cellKey(cx, cy);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(s);
    }

    for (const ship of ships) {
      if (ship.ionDisabled) continue;
      const myRank = SIZE_RANK[ship.size] || 0;
      const mySafe = SAFE_DIST[ship.size] || 1;

      const cx = Math.floor(ship.position.x / CELL);
      const cy = Math.floor(ship.position.y / CELL);

      for (let dxC = -1; dxC <= 1; dxC++) {
        for (let dyC = -1; dyC <= 1; dyC++) {
          const neighbors = grid.get(cellKey(cx + dxC, cy + dyC));
          if (!neighbors) continue;

          for (const other of neighbors) {
            if (other.id === ship.id || !other.alive) continue;

            // ── ALLIES : évitement horizontal + altitude ────────────────
            if (other.fleetId === ship.fleetId) {
              const altDiff = Math.abs((other.position.z || 3) - (ship.position.z || 3));
              if (altDiff > 0.5) continue; // already separated by altitude

              const otherSafe = SAFE_DIST[other.size] || 1;
              const minDist   = mySafe + otherSafe;
              const dx = ship.position.x - other.position.x;
              const dy = ship.position.y - other.position.y;
              const d  = Math.sqrt(dx*dx + dy*dy);
              if (d >= minDist || d < 0.01) continue;

              const otherRank = SIZE_RANK[other.size] || 0;
              if (myRank > otherRank + 1) continue;

              // Priorité : changer d'altitude plutôt que de pousser horizontalement
              // Les petits vaisseaux montent/descendent pour éviter les grands
              const overlap = (minDist - d) / minDist;
              if (overlap > 0.3 && ['XS','S'].includes(ship.size)) {
                // Change d'altitude pour s'écarter
                const targetZ  = (ship.position.z || 3) + (myRank % 2 === 0 ? 1 : -1);
                const clampedZ = clamp(targetZ, CONFIG.ALTITUDE_MIN, CONFIG.ALTITUDE_MAX);
                ship.position.z = ship.position.z + (clampedZ - ship.position.z) * 0.15;
              } else {
                // Push horizontal léger
                const pushFactor = Math.min(0.7, overlap);
                ship.position.x += (dx / d) * pushFactor * ship.speed * fraction * 0.4;
                ship.position.y += (dy / d) * pushFactor * ship.speed * fraction * 0.4;
                ship.position.x  = clamp(ship.position.x, 0, CONFIG.GRID_COLS - 1);
                ship.position.y  = clamp(ship.position.y, 0, CONFIG.GRID_ROWS - 1);
              }

            // ── ENNEMIS proches : essayer de tirer plutôt que de percuter ──
            } else if (other.fleetId !== ship.fleetId) {
              // Jamais pour les vaisseaux en fuite ou en saut — leur seul objectif
              // est de partir, pas de se faire happer dans un combat de proximité
              if (ship.behavior?.mode === 'fuir' || ship._jumpingToHyperspace) continue;
              const altDiff = Math.abs((other.position.z || 3) - (ship.position.z || 3));
              if (altDiff > 1) continue;
              const dx = ship.position.x - other.position.x;
              const dy = ship.position.y - other.position.y;
              const d  = Math.sqrt(dx*dx + dy*dy);
              const closeRange = (SAFE_DIST[ship.size] || 1) * 3;
              if (d < closeRange) {
                // Si ennemi très proche, engager plutôt que percuter
                ship.attacking = other.id;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Weapon sub-step. Cooldowns are in sub-steps so fast weapons
   * fire multiple times per tick — fighters feel snappy.
   */
  processWeaponsSubStep(ships) {
    for (const ship of ships) {
      if (ship.ionDisabled) continue;
      // Skip ships with nothing to do (no main target AND no defensive target)
      if (!ship.attacking && !ship.defensiveTarget) continue;

      for (const weapon of ship.weapons) {
        // ── Cooldown tick ──
        if (weapon.currentCooldown > 0) { weapon.currentCooldown--; continue; }

        // ── Choose target ──
        // Defensive weapons fire at attackers; regular weapons fire at main target
        const targetId = (weapon.defensive && ship.defensiveTarget)
          ? ship.defensiveTarget
          : ship.attacking;
        if (!targetId) continue;

        const target = (this._shipsById ? this._shipsById.get(targetId) : null) || this.state.ships.find(s => s.id === targetId);
        if (!target || !target.alive) {
          if (weapon.defensive) ship.defensiveTarget = null;
          else ship.attacking = null;
          continue;
        }

        const dist = dist2D(ship.position, target.position);

        // ── Range check (with combat policy range bonus) ──
        const cpRangeMods = getCombatPolicyMods(ship, ship.speed > 0.05);
        if (dist > weapon.range * cpRangeMods.rangeMult) continue;

        // ── Firing arc ──
        if (weapon.firingArc < 360) {
          const angleToTarget = Math.atan2(
            target.position.y - ship.position.y,
            target.position.x - ship.position.x
          );
          const weaponDir = (ship.heading ?? 0) + (weapon.arcOffset ?? 0);
          let angleDiff   = Math.abs(angleToTarget - weaponDir) % (2 * Math.PI);
          if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
          if (angleDiff > (weapon.firingArc * Math.PI / 180) / 2) continue;
        }

        // ── Ammo check ──
        if (weapon.ammoUsage > 0) {
          const ammoKey = this._ammoKey(weapon.type);
          if (ammoKey && ship.inventory[ammoKey] < weapon.ammoUsage) continue;
          if (ammoKey) ship.inventory[ammoKey] -= weapon.ammoUsage;
        }

        // ── Weapon size vs target size restriction ──────────────────
        // Heavy/capital weapons don't waste shots on tiny fighters (they can't track them well).
        // Light turrets are specifically for anti-fighter work.
        const targetSizeRank = { XS:0, S:1, M:2, L:3, XL:4, XXL:5 }[target.size] ?? 2;
        if (weapon.size === 'heavy'   && targetSizeRank < 2) continue; // heavy skips XS/S
        if (weapon.size === 'capital' && targetSizeRank < 2) continue; // capital skips XS/S
        if (weapon.size === 'superheavy' && targetSizeRank < 3) continue; // superheavy skips XS/S/M

        // ── Evasion: moving targets harder to hit, speed matters ──
        let accuracy = weapon.accuracy;
        if (target.moveTarget) {
          const maxSpeed = 3.5;
          const evasion  = Math.min(0.45, (target.speed / maxSpeed) * 0.40);
          accuracy = Math.max(0.08, accuracy - evasion);
        }

        // ── Pilot type combat modifiers ──
        const attackerMods = getPilotCombatMods(ship);
        const targetMods   = getPilotCombatMods(target);
        accuracy = Math.min(0.97, accuracy + attackerMods.accuracyMod);
        accuracy = Math.max(0.04, accuracy - targetMods.evasionMod);

        // ── Dive attack (piqué): attacker descending = more accurate & harder to hit ──
        // More experienced pilots extract more benefit from dive angle.
        if (ship._prevAltitude !== undefined && ship.position.z < ship._prevAltitude) {
          const diveDelta = ship._prevAltitude - ship.position.z;
          const pilotMod  = [0, 0.5, 0.8, 1.0][Math.min(3, ship.pilotLevel || 1)];
          accuracy = Math.min(0.97, accuracy + diveDelta * 0.07 * pilotMod);
        }
        // Diving target is harder to hit (speed advantage)
        if (target._prevAltitude !== undefined && target.position.z < target._prevAltitude) {
          const diveDelta = target._prevAltitude - target.position.z;
          const pilotMod  = [0, 0.5, 0.8, 1.0][Math.min(3, target.pilotLevel || 1)];
          accuracy = Math.max(0.05, accuracy - diveDelta * 0.06 * pilotMod);
        }

        // ── Altitude range: short weapons can't fire across large altitude gaps ──
        // light: ±1 band max, medium: ±2 bands max, heavy/capital: no restriction
        const maxAltBands = weapon.size === 'light' ? 1 : weapon.size === 'medium' ? 2 : 99;
        const altDiff = Math.abs(target.position.z - ship.position.z);
        if (altDiff > maxAltBands) {
          // Out of vertical range — nudge attacker toward target altitude
          if (!ship.moveTarget || Math.abs((ship.moveTarget.z || 3) - target.position.z) > 1) {
            ship.moveTarget = {
              x: ship.position.x + Math.cos(ship.heading ?? 0) * 0.5,
              y: ship.position.y + Math.sin(ship.heading ?? 0) * 0.5,
              z: clamp(ship.position.z + Math.sign(target.position.z - ship.position.z),
                       CONFIG.ALTITUDE_MIN, CONFIG.ALTITUDE_MAX),
            };
          }
          weapon.currentCooldown = 2;
          continue;
        }

        // ── Fire (always create projectile — misses continue past target) ──
        const em           = getEnergyMods(ship);
        const dmgMult      = weapon.ammoUsage > 0 ? 1.0 : em.weaponDamageMult;
        const hit          = roll(accuracy);
        const angle        = Math.atan2(target.position.y - ship.position.y, target.position.x - ship.position.x);
        const visualSpeed  = (weapon.travelSpeed || 20) * 0.25;
        const travelDist   = dist; // used for travel time

        let toPos;
        if (hit) {
          this._applyDamage(ship, target, weapon, dmgMult);
          toPos = { x: target.position.x, y: target.position.y, z: target.position.z };

          // Torpedo/bomb hits create an explosion visual at the impact site
          if (weapon.type === 'torpedo' || weapon.type === 'bomb') {
            const sizeScale = { XS:0.8, S:1.2, M:1.8, L:2.5, XL:3.5, XXL:5 }[target.size] || 2;
            this.state.explosions = this.state.explosions || [];
            this.state.explosions.push({
              x: target.position.x, y: target.position.y, z: target.position.z,
              startTime: Date.now() + Math.max(200, Math.round(travelDist / visualSpeed * 1000)),
              radius:    sizeScale * 1.2,
              color:     '#ff7722',
            });
          }
        } else {
          // MISS — behavior depends on weapon type:
          // - Ion: travels exactly to weapon.range, then disintegrates
          // - Torpedo/missile/bomb: travels to ~range, then EXPLODES (visible)
          // - Laser: travels to grid edge, fading gradually (handled in renderer)
          if (weapon.type === 'ion') {
            // Ion: fixed range, no grid edge travel
            toPos = {
              x: clamp(ship.position.x + Math.cos(angle) * weapon.range, 0, CONFIG.GRID_COLS - 1),
              y: clamp(ship.position.y + Math.sin(angle) * weapon.range, 0, CONFIG.GRID_ROWS - 1),
              z: target.position.z,
            };
          } else if (weapon.type === 'torpedo' || weapon.type === 'missile' || weapon.type === 'bomb') {
            // Rocket: travels range + small overshoot, then explodes at endpoint
            const r = weapon.range * 1.3;
            toPos = {
              x: clamp(ship.position.x + Math.cos(angle) * r, 0, CONFIG.GRID_COLS - 1),
              y: clamp(ship.position.y + Math.sin(angle) * r, 0, CONFIG.GRID_ROWS - 1),
              z: target.position.z,
            };
            // Will explode when it expires in renderer (missExplosion flag)
          } else {
            // Laser / energy: continues to grid edge, then fades in renderer
            const dx  = Math.cos(angle), dy = Math.sin(angle);
            const tX  = dx > 0 ? (CONFIG.GRID_COLS - 1 - ship.position.x) / dx : dx < 0 ? -ship.position.x / dx : Infinity;
            const tY  = dy > 0 ? (CONFIG.GRID_ROWS - 1 - ship.position.y) / dy : dy < 0 ? -ship.position.y / dy : Infinity;
            const tMax = Math.min(tX, tY);
            toPos = {
              x: clamp(ship.position.x + dx * tMax, 0, CONFIG.GRID_COLS - 1),
              y: clamp(ship.position.y + dy * tMax, 0, CONFIG.GRID_ROWS - 1),
              z: target.position.z,
            };
          }
          this._checkStrayShot(ship, ships, ship.position, angle, weapon.range * 1.5, weapon, dmgMult * 0.7);
        }

        // Visual travel: use already-computed visualSpeed and travelDist
        const travelMsDist = Math.sqrt((toPos.x - ship.position.x)**2 + (toPos.y - ship.position.y)**2);
        const travelMs    = Math.max(200, Math.round((travelMsDist / visualSpeed) * 1000));
        const count       = weapon.mode === 'quad' ? 4 : weapon.mode === 'twin' ? 2 : 1;

        this.state.projectiles.push({
          id:        Math.random().toString(36).slice(2),
          from:      { ...ship.position },
          to:        toPos,
          targetId:  hit ? target.id : null,
          type:      weapon.type,
          color:     weapon.color || '#ff3333',
          continuous: weapon.continuous || false,
          missed:    !hit,
          missExplosion: !hit && (weapon.type === 'torpedo' || weapon.type === 'missile' || weapon.type === 'bomb'),
          weaponRange:  weapon.range,          // for laser fade + ion disintegration
          fromDist:     dist,                  // original target distance (for laser fade start)
          count,
          boltLen:   weapon.size === 'capital' ? 0.5 : weapon.size === 'superheavy' ? 0.38 : weapon.size === 'heavy' ? 0.25 : 0.15,
          boltWidth: weapon.size === 'capital' ? 2   : weapon.size === 'superheavy' ? 1.5  : weapon.size === 'heavy' ? 1   : 0.75,
          startTime: Date.now(),
          travelMs,
        });

        // ═══ FEU CROISÉ (doctrine SW) ═══════════════════════════════
        // Les tirs perdus de turbolasers lourds vaporisent les chasseurs
        // pris dans le couloir de tir — AMIS COMME ENNEMIS. Garder ses
        // escadrons hors de la mêlée des capitaux est vital.
        if (weapon.size === 'capital' || weapon.size === 'superheavy') {
          const fx = ship.position.x, fy = ship.position.y;
          const tx = toPos.x, ty = toPos.y;
          const segLen2 = (tx-fx)**2 + (ty-fy)**2;
          if (segLen2 > 1) {
            for (const bystander of ships) {
              if (!bystander.alive || bystander.id === ship.id || bystander.id === target.id) continue;
              if (!['XS','S'].includes(bystander.size)) continue;
              if (Math.abs((bystander.position.z||3) - (ship.position.z||3)) > 1) continue;
              // Distance perpendiculaire au segment de tir
              const t = Math.max(0, Math.min(1,
                ((bystander.position.x-fx)*(tx-fx) + (bystander.position.y-fy)*(ty-fy)) / segLen2));
              const px = fx + t*(tx-fx), py = fy + t*(ty-fy);
              const d  = Math.sqrt((bystander.position.x-px)**2 + (bystander.position.y-py)**2);
              // Couloir de 1.2 case, 7% de chance par bolt — rare mais dévastateur
              if (d < 1.2 && Math.random() < 0.07) {
                bystander.hp -= weapon.damage; // un turbolaser vaporise un chasseur
                const ami = bystander.fleetId === ship.fleetId;
                this.log(`💥 ${bystander.name} pris dans le feu croisé de ${ship.name}${ami ? ' (TIR AMI !)' : ''} !`, 'death');
                break; // un seul malchanceux par bolt
              }
            }
          }
        }

        // ── Reset cooldown (faster with FIRE_RATE_MULT) ──
        const coolMult = weapon.ammoUsage > 0 ? 1.0 : em.weaponCooldownMult;
        weapon.currentCooldown = Math.max(1, Math.round(
          weapon.cooldown * CONFIG.SIM_SUB_STEPS * coolMult / CONFIG.FIRE_RATE_MULT / (CONFIG.TICK_TIME_SCALE || 1)
        ));
      }
    }
  }

  processWeapons(ships) { this.processWeaponsSubStep(ships); }

  /**
   * Checks if a missed shot hits any other ship along its flight path.
   * Uses point-to-ray distance for each candidate ship.
   */
  _checkStrayShot(shooter, ships, fromPos, angle, range, weapon, dmgMult) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let   closestT = range;
    let   hitShip  = null;

    for (const s of ships) {
      if (!s.alive || s.id === shooter.id) continue;
      if (s.fleetId === shooter.fleetId) continue; // no friendly fire (prototype)

      const ex = s.position.x - fromPos.x;
      const ey = s.position.y - fromPos.y;
      const t  = ex * dx + ey * dy;                // projection along ray
      if (t < 0.5 || t > range) continue;          // behind shooter or too far

      // Perpendicular distance from ray to ship center
      const perp = Math.abs(ex * dy - ey * dx);
      if (perp < 0.7 && t < closestT) {            // within half-cell of ray
        closestT = t;
        hitShip  = s;
      }
    }

    if (hitShip) {
      this._applyDamage(shooter, hitShip, weapon, dmgMult);
      this.log(`💥 Stray shot: ${shooter.name} → ${hitShip.name}`, 'combat');
    }
  }

  /** Applies weapon damage to a target */
  _applyDamage(attacker, target, weapon, dmgMult = 1.0) {
    // ─── Force dodge (force_user: block one hit every 10 ticks) ──
    const pilotMods = getPilotCombatMods(target);
    if (pilotMods.forceDodge && !(target._forceDodgeCooldown > 0)) {
      target._forceDodgeCooldown = 10;
      this.log(`✨ ${target.name} — Force déflexion !`, 'shield');
      return; // hit completely negated
    }

    // ─── Nebula accuracy penalty ────────────────────────────
    const nebulaHit = !attacker._inNebula || Math.random() > 0.35; // 35% chance miss in nebula
    if (!nebulaHit) {
      this.log(`🌫 Tir raté (nébuleuse) — ${attacker.name}`, 'combat');
      return;
    }

    let dmg = weapon.damage * dmgMult;

    // ─── Combat policy modifier (attacker) ────────────────
    const isMoving  = (attacker.speed > 0.05);
    const cpMods    = getCombatPolicyMods(attacker, isMoving);
    dmg *= cpMods.damageDealMult;

    // ─── Combat policy damage reduction (defender) ────────
    const cpDef     = getCombatPolicyMods(target, false);
    let   defMult   = cpDef.damageReceiveMult;

    // Frontal damage reduction (assault mode: -5% from the front)
    if (cpDef.frontDamageReduction > 0) {
      const attackAngle   = Math.atan2(target.position.y - attacker.position.y, target.position.x - attacker.position.x);
      const facingDiff    = ((attackAngle - (target.heading ?? 0) + Math.PI) % (2 * Math.PI)) - Math.PI;
      if (Math.abs(facingDiff) < Math.PI / 2) { // within 90° forward arc
        defMult *= (1 - cpDef.frontDamageReduction);
      }
    }

    // Color-based damage modifier (Star Wars lore)
    const COLOR_MOD = {
      '#ff3333': 1.00,   // red — standard
      '#33cc55': 1.10,   // green — premium gas
      '#4488ff': 1.00,   // blue — ion-based (bonus vs shields below)
      '#ff8833': 0.75,   // orange — low power
      '#ffee44': 1.05,   // yellow — high energy
      '#cc44ff': 1.15,   // purple — specialized
      '#ffffff': 1.30,   // white — superlaser
    };
    dmg *= (COLOR_MOD[weapon.color] ?? 1.0);

    // Color-based damage modifier (lore-accurate quality tiers)
    if (weapon.type === 'laser') {
      if (weapon.color === '#33cc55') dmg *= 1.10;       // green: quality gas +10%
      else if (weapon.color === '#4488ff') dmg *= 0.95;  // blue: ion-optimised, -5%
      else if (weapon.color === '#ff8833') dmg *= 0.70;  // orange: low power
      else if (weapon.color === '#cc44ff') dmg *= 1.25;  // purple: rare, powerful
    }

    // ─── Shields ───────────────────────────
    if (!target.shields.disabled && target.shields.current > 0) {
      const effective = dmg * (1 - weapon.ignoreShields);
      const blocked   = Math.min(target.shields.current, effective);
      target.shields.current -= blocked;
      dmg -= blocked;

      // Bleed-through: powerful weapons punch a small fraction through shields
      // capital: 6%, heavy: 3%, light: 0% — forces gradual hull damage even under shields
      const bleedPct = weapon.size === 'capital' ? 0.06 : weapon.size === 'heavy' ? 0.03 : 0;
      if (bleedPct > 0 && blocked > 0) {
        const bleed = blocked * bleedPct;
        target.hp = Math.max(0, target.hp - bleed);
      }

      // Shields at zero → start restart delay
      if (target.shields.current <= 0) {
        target.shields.current  = 0;
        target.shields.disabled = true;
        target.shields.restartCounter = 0;
        if ((target.lengthM||0) >= 60 || target.namedCharacter?.enabled) this.log(`🛡 ${target.name} — boucliers enfoncés!`, 'shield');
      }
    }

    if (dmg <= 0) return; // shields absorbed everything

    // ─── Hull armor reduction ──────────────
    // armor = integer value, reduction = armor / (armor + 40), capped at 80%
    if (weapon.type !== 'ion') {
      const armor = target.hullArmor || 0;
      const reduction = Math.min(0.80, armor / (armor + 40));
      dmg = Math.max(1, dmg * (1 - reduction));
    }

    // ─── Bombardment bonus ─────────────────
    if (weapon.type === 'bombardment' || weapon.type === 'torpedo') {
      const altDiff = attacker.position.z - target.position.z;
      if (altDiff > 0) {
        const sizeMod = BOMBARDMENT_SIZE_MOD[target.size] || 1;
        dmg *= (1 + (sizeMod - 1) * 0.5);
      }
    }

    // ─── Ion effects ───────────────────────
    if (weapon.type === 'ion' && weapon.ionStacks > 0) {
      target.ionStacks   += weapon.ionStacks;
      target._ionHitTime  = Date.now(); // triggers visual arcs in renderer
      this._processIonEffects(target);
      this.log(`${target.name} — ionized (${target.ionStacks.toFixed(1)} stacks)`, 'ion');
    }

    // ─── Hull damage ───────────────────────
    target.hp = Math.max(0, target.hp - dmg * defMult);
    target._recentlyHit = true;  // blocks astromech healing for the next 5-tick window

    this.log(
      `${attacker.name} → ${target.name}: ${Math.round(dmg)} dmg [${weapon.name}]`,
      'combat'
    );

    // Notify neutral mode of the attack
    if (target.behavior.mode === 'neutral') {
      target.behavior.attackedBy = attacker.id;
    }

    // ─── Area damage ───────────────────────
    if (weapon.areaRadius > 0) {
      this._applyAreaDamage(target.position, weapon.areaRadius, weapon.damage * 0.5, [attacker.id, target.id]);
    }
  }

  /** Applies ion stack effects to a ship */
  _processIonEffects(ship) {
    const stacks = ship.ionStacks;
    if (stacks >= CONFIG.ION_STACK_DRIVE_OFF && ship.driveOff === 0) {
      ship.driveOff = 1;
      this.log(`${ship.name} — engines knocked offline for 1 tick!`, 'ion');
    }
    if (stacks >= CONFIG.ION_STACK_SHIELD_OFF) {
      ship.shields.disabled = true;
      ship.shields.restartCounter = 0;
    }
    if (stacks >= CONFIG.ION_STACK_SYSTEMS_OFF) {
      ship.ionDisabled = true;
      this.log(`${ship.name} — ALL SYSTEMS OFFLINE!`, 'ion');
    }
  }

  /** Applies area damage around a point */
  _applyAreaDamage(center, radius, baseDmg, excludeIds = []) {
    for (const ship of this.state.ships) {
      if (!ship.alive) continue;
      if (excludeIds.includes(ship.id)) continue;
      const d = dist2D(ship.position, center);
      if (d <= radius) {
        const falloff = 1 - (d / radius);
        ship.hp = Math.max(0, ship.hp - baseDmg * falloff);
      }
    }
  }

  /** Returns the inventory key for a given weapon type */
  _ammoKey(weaponType) {
    const map = {
      torpedo:     'torpedoes',
      missile:     'missiles',
      mine:        'mines',
      bomb:        'bombs',
      bombardment: 'bombs',
    };
    return map[weaponType] || null;
  }

  // ═══════════════════════════════════════════════════════
  // 6. COLLISIONS
  // ═══════════════════════════════════════════════════════

  // Visual hull radius in cells (SIZE_RADIUS_PX / 56 * collision_factor)
  static CELL_RADIUS = { XS:0.19, S:0.38, M:0.75, L:1.5, XL:2.25, XXL:3.38 };

  detectCollisions(ships) {
    // Include dying kamikaze ships (they can still ram for 1 tick)
    const active = ships.filter(s => s.alive || s._kamikazeDying);
    for (let i = 0; i < active.length - 1; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];

        const d = dist2D(a.position, b.position);
        const ra = GameEngine.CELL_RADIUS[a.size] || 0.25;
        const rb = GameEngine.CELL_RADIUS[b.size] || 0.25;
        if (d >= ra + rb) continue;
        if (Math.abs(a.position.z - b.position.z) > 1) continue;

        this._resolveCollision(a, b);
      }
    }
  }

  /** Resolves a collision between two ships, with kamikaze and Hammerhead logic */
  _resolveCollision(a, b) {
    // ─── Same fleet: no damage, just separate ────────────────
    if (a.fleetId && a.fleetId === b.fleetId) {
      const sep = dirTo(a.position, b.position);
      const ra  = GameEngine.CELL_RADIUS[a.size] || 0.25;
      const rb  = GameEngine.CELL_RADIUS[b.size] || 0.25;
      const overlap = (ra + rb) - dist2D(a.position, b.position);
      if (overlap > 0) {
        a.position.x = clamp(a.position.x - sep.dx * overlap * 0.5, 0, CONFIG.GRID_COLS - 1);
        a.position.y = clamp(a.position.y - sep.dy * overlap * 0.5, 0, CONFIG.GRID_ROWS - 1);
        b.position.x = clamp(b.position.x + sep.dx * overlap * 0.5, 0, CONFIG.GRID_COLS - 1);
        b.position.y = clamp(b.position.y + sep.dy * overlap * 0.5, 0, CONFIG.GRID_ROWS - 1);
      }
      return; // no damage between allies
    }
    const totalMass   = (a.mass || 1) + (b.mass || 1);
    const isRamA      = a.rammingProfile?.enabled || a._kamikazeDying;
    const isRamB      = b.rammingProfile?.enabled || b._kamikazeDying;
    const isHammerA   = a.classId === 'hammerhead';
    const isHammerB   = b.classId === 'hammerhead';

    // Base collision damage: relative mass × factor
    let rawDmg = totalMass * CONFIG.COLLISION_DAMAGE_FACTOR;
    if (isRamA || isRamB) rawDmg *= CONFIG.RAMMING_DAMAGE_MULT;

    // Identify rammer and rammed
    let rammer = null, rammed = null;
    if (isRamA && !isRamB)      { rammer = a; rammed = b; }
    else if (isRamB && !isRamA) { rammer = b; rammed = a; }
    else if (isRamA && isRamB)  { rammer = a.mass >= b.mass ? a : b; rammed = rammer === a ? b : a; }

    // Rammer bonus damage
    if (rammer) rawDmg += rammer.rammingProfile?.bonusDamage || 0;

    // Armor reduction (new percentage formula)
    const armorRedA = Math.min(0.80, (a.hullArmor || 0) / ((a.hullArmor || 0) + 40));
    const armorRedB = Math.min(0.80, (b.hullArmor || 0) / ((b.hullArmor || 0) + 40));
    let dmgA = rawDmg * (1 - armorRedA) * ((b.mass || 1) / totalMass);
    let dmgB = rawDmg * (1 - armorRedB) * ((a.mass || 1) / totalMass);

    // ─── HAMMERHEAD EXCEPTION ─────────────────────────────────
    const isHammerRam = (isRamA && isHammerA) || (isRamB && isHammerB);
    if (isHammerRam) {
      const hammer = isHammerA ? a : b;
      const target = hammer === a ? b : a;
      // Hammerhead takes no self-damage
      if (hammer === a) dmgA = 0; else dmgB = 0;
      // +5% extra damage on target
      if (hammer === a) dmgB *= 1.05; else dmgA *= 1.05;
      // Push target strongly
      const pushStrength = Math.max(1.5, hammer.mass / 50);
      const dir = dirTo(hammer.position, target.position);
      target.position.x = clamp(target.position.x + dir.dx * pushStrength, 0, CONFIG.GRID_COLS - 1);
      target.position.y = clamp(target.position.y + dir.dy * pushStrength, 0, CONFIG.GRID_ROWS - 1);
      // ─── Chain reaction: ships behind target ─────────────────
      const chainRange = (GameEngine.CELL_RADIUS[target.size] || 0.5) * 3;
      for (const other of this.state.ships.filter(s => s.alive && s !== hammer && s !== target)) {
        const distToTarget = dist2D(other.position, target.position);
        if (distToTarget > chainRange) continue;
        // Check if "behind" target (dot product with push direction)
        const dx = other.position.x - target.position.x;
        const dy = other.position.y - target.position.y;
        const dot = dx * dir.dx + dy * dir.dy;
        if (dot < 0) continue; // not behind
        // Chain push
        const chainPush = pushStrength * 0.5;
        other.position.x = clamp(other.position.x + dir.dx * chainPush, 0, CONFIG.GRID_COLS - 1);
        other.position.y = clamp(other.position.y + dir.dy * chainPush, 0, CONFIG.GRID_ROWS - 1);
        const chainDmg = dmgB * 0.4 * (1 - distToTarget / chainRange);
        other.hp = Math.max(0, other.hp - chainDmg);
        this.log(`💥 Réaction en chaîne: ${other.name} poussé par ${target.name} (${Math.round(chainDmg)} dmg)`, 'combat');
        this._spawnImpactParticles(other.position, '#ff8800');
      }
    } else if (rammer) {
      // Normal ramming push
      const push = (rammer.rammingProfile?.pushForce || 0) - ((rammed.mass || 1) / 500);
      if (push > 0) {
        const dir = dirTo(rammer.position, rammed.position);
        rammed.position.x = clamp(rammed.position.x + dir.dx * push, 0, CONFIG.GRID_COLS - 1);
        rammed.position.y = clamp(rammed.position.y + dir.dy * push, 0, CONFIG.GRID_ROWS - 1);
      }
    }

    // ─── Apply damage ──────────────────────────────────────────
    // Rammer takes damage that the target "deals" (proportional to target mass)
    // No special protection — if HP too low, rammer dies
    a.hp = Math.max(0, (a.hp || 0) - dmgA);
    b.hp = Math.max(0, (b.hp || 0) - dmgB);
    a._recentlyHit = true;
    b._recentlyHit = true;

    // ─── Kamikaze resolution ───────────────────────────────────
    if (rammer?._kamikazeDying) {
      if ((rammer.mass || 1) > (rammed.mass || 1) * 2 && rammer.hp > 0) {
        // Significantly heavier → survives at very low HP
        rammer._kamikazeDying = false;
        rammer.hp = Math.max(1, Math.round(rammer.maxHp * 0.03));
        this.log(`☠ ${rammer.name} survit à l'impact (masse supérieure) !`, 'combat');
      } else {
        // Rammer dies (from damage or from the crash itself)
        rammer.hp    = 0;
        rammer.alive = false;
        this.log(`☠ ${rammer.name} — mort à l'impact !`, 'death');
      }
    }

    this.log(`💥 Collision: ${a.name} ↔ ${b.name} (${Math.round(dmgA)}/${Math.round(dmgB)} dmg)`, 'combat');

    // ─── Impact particles ──────────────────────────────────────
    const impactPos = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2, z: a.position.z };
    this._spawnImpactParticles(impactPos, isHammerRam ? '#ff4400' : '#ffaa44');

    // Slight separation to avoid looping collisions
    const sep = dirTo(a.position, b.position);
    b.position.x += sep.dx * 0.4;
    b.position.y += sep.dy * 0.4;
  }

  /** Spawns a burst of impact spark particles at a position */
  _spawnImpactParticles(pos, color) {
    const state = this.state;
    state.explosions = state.explosions || [];
    // Main impact flash
    state.explosions.push({
      x: pos.x, y: pos.y, z: pos.z || 3,
      radius: 0.4, color,
      startTime: Date.now(),
      type: 'impact',
    });
    // 3 smaller sparks in random directions
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 0.2 + Math.random() * 0.4;
      state.explosions.push({
        x: pos.x + Math.cos(angle) * dist,
        y: pos.y + Math.sin(angle) * dist,
        z: pos.z || 3,
        radius: 0.15 + Math.random() * 0.15,
        color: '#ffffff',
        startTime: Date.now() + Math.random() * 80,
        type: 'spark',
      });
    }
  }

  // ═══════════════════════════════════════════════════════
  // 7. DEATHS & CHAIN EXPLOSIONS
  // ═══════════════════════════════════════════════════════

  processDeaths() {
    for (const ship of this.state.ships) {
      if (!ship.alive) continue;

      // ─── ABSOLUTE: escaping ships are saved even if HP → 0 ───
      if (ship._jumpingToHyperspace) {
        if (ship.hp <= 0) {
          ship.alive     = false;
          ship.escaped   = true;
          ship.destroyed = false;
          ship.hp        = 0;
          this.log(`🌀 ${ship.name} a sauté in extremis !`, 'move');
        }
        continue; // jumping ships are never "destroyed"
      }

      // ─── Dying kamikaze completes its run ──────────────────
      if (ship._kamikazeDying) {
        ship.alive          = false;
        ship._kamikazeDying = false;
        this.log(`☠ ${ship.name} — mort au combat !`, 'death');
        continue;
      }

      if (ship.hp > 0) continue;

      // ─── Kamikaze posthumous: continue 1 tick after HP=0 ────
      if (ship.behavior?.mode === 'kamikaze' && !ship._kamikazeDying) {
        ship._kamikazeDying     = true;
        ship.rammingProfile     = ship.rammingProfile || {};
        ship.rammingProfile.enabled    = true;
        ship.rammingProfile.bonusDamage = (ship.mass || 1) * 1.5; // crash bonus
        ship.rammingProfile.pushForce   = 4;
        this.log(`☠ ${ship.name} — dernier assaut !`, 'death');
        continue; // don't die yet
      }

      // Named character plot armor
      if (ship.namedCharacter?.enabled && ship.namedCharacter.plotArmor) {
        if (checkPlotArmor(ship, this.log.bind(this))) {
          ship.shields.current  = 0;
          ship.shields.disabled = true;
          continue;
        }
      }

      ship.alive     = false;
      ship.destroyed = true;
      ship.hp        = 0;
      // Log only significant losses (named characters or large ships)
      if (ship.namedCharacter?.enabled || (ship.lengthM || 0) >= 60) {
        this.log(`💀 ${ship.name} — détruit ! (${ship.size})`, 'death');
      }
      // Track in lostShips for Pertes tab
      this.state.lostShips = this.state.lostShips || [];
      this.state.lostShips.push({
        id: ship.id, name: ship.name, fleetId: ship.fleetId,
        size: ship.size, type: ship.type,
        tick: this.state.tick,
        x: ship.position.x, y: ship.position.y,
        _factionColorIndex: ship._factionColorIndex,
        lengthM: ship.lengthM || 0,
        namedCharacter: ship.namedCharacter?.enabled || false,
      });

      // ─── Visual death explosion ──────────────────────────
      const sizeR = { XS:1.5, S:2.5, M:4, L:6, XL:9, XXL:14 };
      const r = sizeR[ship.size] || 3;
      this.state.explosions = this.state.explosions || [];
      this.state.explosions.push({ x:ship.position.x, y:ship.position.y, z:ship.position.z, startTime:Date.now(), radius:r*1.8, color:'#ff6600', type:'death' });
      this.state.explosions.push({ x:ship.position.x, y:ship.position.y, z:ship.position.z, startTime:Date.now()+80, radius:r*0.8, color:'#ffffff', type:'spark' });
      for (let i=0;i<3;i++) this.state.explosions.push({
        x:ship.position.x+(Math.random()-0.5)*r, y:ship.position.y+(Math.random()-0.5)*r, z:ship.position.z,
        startTime:Date.now()+100+i*150, radius:r*0.5, color:'#ffaa22', type:'spark',
      });

      // Chain explosion
      if (ship.explosionOnDeath?.enabled) {
        const expDmg = CONFIG.EXPLOSION_BASE_DAMAGE + ship.mass * 0.1;
        this._applyAreaDamage(
          ship.position,
          ship.explosionOnDeath.radius,
          expDmg,
          [ship.id]
        );
        this.log(`💥 Chain explosion: ${ship.name} (${Math.round(expDmg)} dmg, r=${ship.explosionOnDeath.radius})`, 'death');
      }

      // ─── Cargaison EXPLOSIVE : explosion en chaîne ────────────
      const explosiveCount = (ship.cargoHold || [])
        .filter(c => c.type === 'explosifs' || c.type === 'matieres_dangereuses')
        .reduce((s, c) => s + c.count, 0);
      if (explosiveCount > 0) {
        // Rayon et dégâts proportionnels à la quantité d'explosifs
        const expR   = Math.min(12, 2 + explosiveCount * 0.4);
        const expDmg = 15 + explosiveCount * 3;
        this._applyAreaDamage(ship.position, expR, expDmg, [ship.id]);
        this.state.explosions.push({
          x: ship.position.x, y: ship.position.y, z: ship.position.z,
          startTime: Date.now() + 120, radius: expR * 2.5,
          color: '#ff4400', type: 'death',
        });
        this.state.explosions.push({
          x: ship.position.x, y: ship.position.y, z: ship.position.z,
          startTime: Date.now() + 80, radius: expR * 1.2,
          color: '#ffee00', type: 'death',
        });
        this.log(`💥💥 ${ship.name} — EXPLOSION CARGO ! (${explosiveCount} unités, ${Math.round(expDmg)} dmg, r=${expR.toFixed(1)})`, 'death');
      }

      // Update fleet ship list
      const fleet = this.state.fleets.find(f => f.fleetId === ship.fleetId);
      if (fleet) fleet.shipIds = fleet.shipIds.filter(id => id !== ship.id);
    }
  }

  // ═══════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════

  /** Returns enemy ships (conflict stance in diplomacy) */
  getEnemies(ship, ships) {
    // Utilise le regroupement par flotte précalculé une fois par tic (voir
    // tick()) : on ne teste la diplomatie qu'UNE FOIS PAR FLOTTE adverse
    // (quelques flottes), puis on concatène leurs listes déjà filtrées par
    // alive/docked — au lieu de re-tester chaque vaisseau individuellement.
    const byFleet = this._shipsByFleet;
    if (!byFleet) {
      // Repli (hors tick() — ex. appels de test) : ancien comportement
      const diplomacy = this.state.diplomacy;
      return ships.filter(s => {
        if (!s.alive || s.fleetId === ship.fleetId) return false;
        const stance = diplomacy ? getDiplomacy(diplomacy, ship.fleetId, s.fleetId) : 'conflict';
        return stance === 'conflict';
      });
    }
    const diplomacy = this.state.diplomacy;
    const cacheKey = '_enemyCache';
    ship[cacheKey] = ship[cacheKey] || {};
    const cache = ship[cacheKey];
    if (cache.tick === this.state.tick) return cache.list;
    const out = [];
    for (const [fleetId, list] of byFleet) {
      if (fleetId === ship.fleetId) continue;
      const stance = diplomacy ? getDiplomacy(diplomacy, ship.fleetId, fleetId) : 'conflict';
      if (stance === 'conflict') out.push(...list);
    }
    cache.tick = this.state.tick;
    cache.list = out;
    return out;
  }

  /** Returns allied ships (same fleet OR allied stance) */
  getAllies(ship, ships) {
    const byFleet = this._shipsByFleet;
    if (!byFleet) {
      const diplomacy = this.state.diplomacy;
      return ships.filter(s => {
        if (!s.alive || s.id === ship.id) return false;
        if (s.fleetId === ship.fleetId) return true;
        const stance = diplomacy ? getDiplomacy(diplomacy, ship.fleetId, s.fleetId) : 'conflict';
        return stance === 'allied';
      });
    }
    const diplomacy = this.state.diplomacy;
    const cacheKey = '_allyCache';
    ship[cacheKey] = ship[cacheKey] || {};
    const cache = ship[cacheKey];
    if (cache.tick === this.state.tick) return cache.list;
    const out = [];
    for (const [fleetId, list] of byFleet) {
      if (fleetId === ship.fleetId) {
        for (const s of list) if (s.id !== ship.id) out.push(s);
        continue;
      }
      const stance = diplomacy ? getDiplomacy(diplomacy, ship.fleetId, fleetId) : 'conflict';
      if (stance === 'allied') out.push(...list);
    }
    cache.tick = this.state.tick;
    cache.list = out;
    return out;
  }

  /** Returns neutral ships (non-enemy, non-ally) — ships that should be avoided */
  getNeutrals(ship, ships) {
    const diplomacy = this.state.diplomacy;
    return ships.filter(s => {
      if (!s.alive || s.fleetId === ship.fleetId) return false;
      const stance = diplomacy ? getDiplomacy(diplomacy, ship.fleetId, s.fleetId) : 'conflict';
      return stance === 'neutral';
    });
  }

  /**
   * Returns the closest ship within a radius, accounting for ALTITUDE STEALTH.
   *
   * Ships below the searcher (positive altDiff) are harder to detect:
   *   - 1 level below → detection range × 0.80
   *   - 2 levels below → detection range × 0.60
   *   - 3+ levels below → detection range × 0.40 (minimum)
   *
   * This creates the tactical approach-from-below mechanic:
   * a ship at z=1 approaching an enemy at z=3 can get much closer
   * before being detected. The enemy only spots them at 40% normal range.
   */
  /** Returns closest ship regardless of distance */
  _closest(candidates, pos) {
    let best = null, bestD = Infinity;
    for (const s of candidates) {
      if (!s.alive) continue;
      const d = dist2D(s.position, pos);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  /**
   * Variante « horde » de _closest pour les chasseurs en mode aggressive
   * sans cible prioritaire. Regroupe les chasseurs alliés de même classe
   * dans un rayon de proximité (SQUAD_RADIUS) ; le premier membre traité
   * dans le tic fait le calcul complet (coût O(ennemis)) et le résultat
   * est partagé avec le reste du groupe pour ce tic — réduisant le nombre
   * de recherches de O(chasseurs) à O(escadrilles).
   * Si le vaisseau attaque déjà une cible vivante, on la garde (continuité
   * visuelle — évite que les tirs « sautent » de cible sans raison).
   */
  _squadClosestEnemy(ship, enemies) {
    if (!enemies.length) return null;

    // Garder la cible actuelle si elle est encore une cible valide
    if (ship.attacking) {
      const cur = enemies.find(e => e.id === ship.attacking && e.alive);
      if (cur) return cur;
    }

    const SQUAD_RADIUS = 12; // cases — rayon de regroupement en escadrille
    this._squadCache = this._squadCache || { tick: -1, byKey: new Map() };
    if (this._squadCache.tick !== this.state.tick) {
      this._squadCache.tick = this.state.tick;
      this._squadCache.byKey.clear();
    }
    // Clé d'escadrille : flotte + classe + cellule de grille grossière (quantifie
    // la position pour regrouper les chasseurs proches sans calcul de distance)
    const cellX = Math.floor(ship.position.x / SQUAD_RADIUS);
    const cellY = Math.floor(ship.position.y / SQUAD_RADIUS);
    const key = `${ship.fleetId}|${ship.classId || ship.type}|${cellX}|${cellY}`;
    const cache = this._squadCache.byKey;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const target = this._closest(enemies, ship.position);
    cache.set(key, target);
    return target;
  }

  _closestInRadius(candidates, pos, radius) {
    let closest = null, minDist = Infinity;
    const searcherZ = pos.z || 3;

    for (const c of candidates) {
      const d      = dist2D(c.position, pos);
      // How many altitude levels is this candidate BELOW the searcher?
      const below  = searcherZ - (c.position.z || 3);
      // Apply stealth modifier: each level below reduces detection range 20%
      const mod    = below > 0 ? Math.max(0.40, 1 - below * 0.20) : 1.0;
      if (d <= radius * mod && d < minDist) {
        minDist = d;
        closest = c;
      }
    }
    return closest;
  }

  /** Moves a ship to a position (GM order) */
  orderMoveTo(shipId, position) {
    const ship = this.state.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    ship.moveTarget = { ...position };
    ship.orders     = { type: 'moveTo', targetPosition: position };
    this.log(`${ship.name} → moving to (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, z${position.z})`, 'move');
  }

  /** Attack order (GM) — volatile, overridden by next AI tick */
  orderAttack(shipId, targetId) {
    const ship = this.state.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    ship.attacking = targetId;
    ship.orders    = { type: 'attack', targetId };
    this.log(`${ship.name} → attacking ${targetId}`, 'combat');
  }

  /**
   * Persistent attack order — ship keeps targeting until the enemy is destroyed
   * or a new explicit order is given. Works in any behavior mode.
   */
  orderAttackPersistent(shipId, targetId) {
    const ship   = this.state.ships.find(s => s.id === shipId && s.alive);
    const target = this.state.ships.find(s => s.id === targetId && s.alive);
    if (!ship || !target) return;
    ship.permanentOrder = { type: 'attack', targetId };
    ship.attacking      = targetId;
    // Immediately start moving toward target
    const maxRange = ship.weapons.length > 0
      ? Math.max(...ship.weapons.map(w => w.range))
      : 5;
    if (dist2D(ship.position, target.position) > maxRange * 0.85) {
      ship.moveTarget = { ...target.position };
    }
    this.log(`${ship.name} → locked on ${target.name} (persistent order)`, 'combat');
  }

  /** Changes the AI behavior of a ship */
  setBehavior(shipId, mode, extraParams = {}) {
    const ship = this.state.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    ship.behavior.mode = mode;
    Object.assign(ship.behavior, extraParams);
  }

  /** Changes the altitude of a ship */
  changeAltitude(shipId, delta) {
    const ship = this.state.ships.find(s => s.id === shipId && s.alive);
    if (!ship) return;
    ship.position.z = clamp(ship.position.z + delta, CONFIG.ALTITUDE_MIN, CONFIG.ALTITUDE_MAX);
    ship.moveTarget = { ...ship.position };
  }
}
