/**
 * NETWORK.JS — PeerJS-based P2P game sync (no server needed)
 *
 * Uses PeerJS free signaling (api.peerjs.com) for initial handshake only.
 * All game data flows directly peer-to-peer via WebRTC.
 *
 * Roles:
 *   host     = GM — broadcasts state, receives player inputs
 *   player   = player faction — receives state, sends orders
 *   spectator= read-only — receives state only
 */

let _peerLib = null;

async function ensurePeer() {
  if (_peerLib) return _peerLib;
  if (window.Peer) { _peerLib = window.Peer; return _peerLib; }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
    s.onload  = () => { _peerLib = window.Peer; resolve(_peerLib); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}


/** Config PeerJS : STUN publics multiples pour fiabiliser le NAT traversal */
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

/** Compact game snapshot (stripped for transfer) */
export function getGameSnapshot(state) {
  return {
    tick:              state.tick,
    paused:            state.paused,
    activeFactions:    state.activeFactions || [],
    hyperspaceRoutes:  state.hyperspaceRoutes || [],
    terrain:           state.terrain,
    background:        state.background || null,
    fleets: (state.fleets || []).map(f => ({
      fleetId: f.fleetId, name: f.name, colorIndex: f.colorIndex,
      escapedShips: f.escapedShips || [],
    })),
    ships: (state.ships || []).filter(s => s.alive || s.escaped || s.destroyed).map(s => ({
      // Identity
      id: s.id, name: s.name, fleetId: s.fleetId,
      size: s.size, type: s.type, classId: s.classId,
      mass: s.mass,
      // Position + movement
      position: s.position, heading: s.heading,
      speed: s.speed,
      moveTarget: s.moveTarget || null,
      // Combat state
      hp: s.hp, maxHp: s.maxHp, hullArmor: s.hullArmor || 0,
      shields: s.shields ? {
        current: s.shields.current, max: s.shields.max,
        disabled: s.shields.disabled || false,
      } : null,
      // Weapons (simplified for display + range calculation)
      weapons: (s.weapons || []).map(w => ({
        id: w.id, name: w.name, type: w.type, size: w.size,
        damage: w.damage, range: w.range, accuracy: w.accuracy,
        cooldown: w.cooldown, currentCooldown: w.currentCooldown || 0,
        ammoUsage: w.ammoUsage || 0,
      })),
      // Inventory (cale)
      inventory: s.inventory || {},
      // Orders + behavior
      behavior: {
        mode: s.behavior?.mode,
        targetId: s.behavior?.targetId,
        radius: s.behavior?.radius,
      },
      orders:         s.orders || null,
      permanentOrder: s.permanentOrder || null,
      attacking:      s.attacking || null,
      // Pilot + crew
      pilotType:  s.pilotType  || null,
      pilotLevel: s.pilotLevel || 1,
      crew:       s.crew       || 1,
      // Policies
      combatPolicy: s.combatPolicy || 'standard',
      energyPolicy: s.energyPolicy || 'balanced',
      // Status
      alive: s.alive, escaped: s.escaped, destroyed: s.destroyed,
      ionDisabled: s.ionDisabled || false,
      docked: s.docked || false,
      gravityWell: s.gravityWell || 0,
      tractorBeam: s.tractorBeam || 0,
      // Cargaison : cale marchande + compartiments médical/détention. Inclus
      // dans le snapshot pour que les joueurs voient et gèrent leur cargo
      // (sinon ces champs n'existeraient que côté hôte).
      cargoVolume: s.cargoVolume || 0,
      cargoHold: (s.cargoHold || []).map(c => ({ type: c.type, count: c.count })),
      medicalCapacity: s.medicalCapacity || 0,
      woundedCount: s.woundedCount || 0,
      brigCapacity: s.brigCapacity || 0,
      captiveCount: s.captiveCount || 0,
      scanner: s.scanner || 0,
      cargoEject: s.cargoEject || false,
      _isContainer: s._isContainer || false,
      crewCapacity:      s.crewCapacity      || 0,
      crewCount:         s.crewCount         || 0,
      passengerCapacity: s.passengerCapacity  || 0,
      passengerCount:    s.passengerCount     || 0,
      _troops:           s._troops           ? s._troops.map(t=>({...t})) : [],
      // Résultats de scan (visibles par le joueur qui a scanné — côté client seulement,
      // non diffusés à tous les joueurs, mais inclus pour cohérence de l'état local)
      _scanResult:   s._scanResult   || null,
      _scanLongTick: s._scanLongTick ?? null,
      _scanHpExact:  s._scanHpExact  ?? null,
      // Amarrage
      _dockedInShipId:  s._dockedInShipId  || null,
      _dockedShipIds:   s._dockedShipIds   ? [...s._dockedShipIds] : [],
      _dockedStationId: s._dockedStationId || null,
      // Abordage (état simplifié)
      _boardingState: s._boardingState ? { phase: s._boardingState.phase, tick: s._boardingState.tick,
        attackerShipId: s._boardingState.attackerShipId } : null,
      // Hangar (réserves de chasseurs) — affichage et ordres de lancement joueur
      carrier: s.carrier ? {
        maxSlots: s.carrier.maxSlots, maxSimultaneous: s.carrier.maxSimultaneous,
        autoFighters: s.carrier.autoFighters, autoBombers: s.carrier.autoBombers,
        reserves: (s.carrier.reserves || []).map(r => ({
          classId: r.classId, type: r.type, count: r.count, deployed: r.deployed || 0,
        })),
      } : null,
      _jumpingToHyperspace: s._jumpingToHyperspace || false,
      _arrivingFromHyper:   s._arrivingFromHyper   || false,
      _arriveStartTime:     s._arriveStartTime      || 0,
      _arriveDuration:      s._arriveDuration       || 1500,
      namedCharacter: s.namedCharacter?.enabled ? s.namedCharacter : null,
      _factionColorIndex: s._factionColorIndex,
    })),
    diplomacy:  state.diplomacy  || {},
    lostShips:  (state.lostShips  || []).slice(-100), // last 100 losses
  };
}

/** Apply a received snapshot to the local GameState (client-side) */
export function applyGameSnapshot(snapshot, GameState) {
  GameState.tick            = snapshot.tick;
  GameState.paused          = snapshot.paused;
  GameState.hyperspaceRoutes = snapshot.hyperspaceRoutes || [];
  GameState.terrain         = snapshot.terrain;
  // MUTATION en place : voir commentaire équivalent dans app.js (handler
  // 'background') — préserve les closures qui capturent GameState.background.
  if (snapshot.background) {
    if (GameState.background) {
      GameState.background.suns = snapshot.background.suns || [];
      GameState.background.bodies = snapshot.background.bodies || [];
    } else {
      GameState.background = snapshot.background;
    }
  }
  GameState.diplomacy       = snapshot.diplomacy || {};
  GameState.activeFactions  = snapshot.activeFactions || [];
  // Liste de pertes : celle de l'hôte fait autorité (dédupliquée par id)
  if (snapshot.lostShips) {
    const seen = new Set();
    GameState.lostShips = snapshot.lostShips.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id); return true;
    });
  } else if (!GameState.lostShips) GameState.lostShips = [];

  // Fleets
  GameState.fleets = snapshot.fleets.map(f => ({
    fleetId: f.fleetId, name: f.name, colorIndex: f.colorIndex,
    shipIds: [], active: true, escapedShips: f.escapedShips || [],
  }));

  // ── Pertes : détecter les nouveaux morts avant de remplacer les ships ──
  const prevAliveIds = new Set(GameState.ships.filter(s => s.alive).map(s => s.id));
  const snapshotAliveIds = new Set(snapshot.ships.filter(s => s.alive).map(s => s.id));

  // Ships that just died — add to lostShips log
  if (!GameState.lostShips) GameState.lostShips = [];
  const lostIds = new Set(GameState.lostShips.map(l => l.id));
  for (const prev of GameState.ships) {
    if (prev.alive && !snapshotAliveIds.has(prev.id) && !lostIds.has(prev.id)) {
      GameState.lostShips.push({
        id: prev.id, name: prev.name, fleetId: prev.fleetId,
        size: prev.size, type: prev.type,
        tick: snapshot.tick,
        x: prev.position.x, y: prev.position.y,
        _factionColorIndex: prev._factionColorIndex,
      });
    }
  }

  // Ships — only ALIVE ships kept in GameState.ships
  const prevShipMap = new Map(GameState.ships.map(s => [s.id, s]));
  GameState.ships = snapshot.ships
    .filter(s => s.alive)   // ← morts supprimés définitivement
    .map(s => {
      const prev = prevShipMap.get(s.id);
      return {
        ...s,
        alive:    true,
        velocity: { x: 0, y: 0 },
        behavior: s.behavior || { mode: 'passive' },
        shields:  s.shields || null,
        _rx: prev?._rx ?? s.position.x,
        _ry: prev?._ry ?? s.position.y,
        _prevX: prev?._rx ?? s.position.x,
        _prevY: prev?._ry ?? s.position.y,
      };
    });

  // ── Purge des effets visuels expirés (cause principale de lag) ──
  const now = Date.now();
  if (GameState.explosions) {
    GameState.explosions = GameState.explosions.filter(e => {
      const dur = e.type === 'death' ? 1800 : e.type === 'spark' ? 900 : 1200;
      return now < e.startTime + dur;
    });
  }
  if (GameState.projectiles) {
    GameState.projectiles = GameState.projectiles.filter(p =>
      now < p.startTime + (p.travelMs || 800)
    );
  }
}


/** État LÉGER par tick : uniquement les champs dynamiques (~5-10× plus petit qu'un snapshot) */
export function getLightState(state) {
  return {
    tick:   state.tick,
    paused: state.paused,
    ships: (state.ships || []).filter(s => s.alive).map(s => ({
      id: s.id,
      x: s.position.x, y: s.position.y, z: s.position.z,
      h: s.heading, hp: s.hp,
      sc: s.shields?.current ?? null,
      m:  s.behavior?.mode, at: s.attacking || null,
      mt: s.moveTarget ? { x: s.moveTarget.x, y: s.moveTarget.y, z: s.moveTarget.z } : null,
      io: s.ionDisabled || false,
      jh: s._jumpingToHyperspace || false,
      dh: s._departingToHyper ? { st: s._departStartTime, du: s._departDuration } : null,
    })),
  };
}

/** Applique un état léger : met à jour les vaisseaux existants, retire les absents */
export function applyLightState(light, GameState) {
  GameState.tick   = light.tick;
  GameState.paused = light.paused;
  const liveIds = new Set(light.ships.map(s => s.id));
  // Retirer les vaisseaux qui ne sont plus vivants (morts/évadés)
  GameState.ships = GameState.ships.filter(s => liveIds.has(s.id));
  const byId = new Map(GameState.ships.map(s => [s.id, s]));
  for (const ls of light.ships) {
    const s = byId.get(ls.id);
    if (!s) continue; // nouveau vaisseau inconnu — arrivera au prochain snapshot complet
    s.position.x = ls.x; s.position.y = ls.y; s.position.z = ls.z;
    s.heading = ls.h; s.hp = ls.hp;
    if (s.shields && ls.sc !== null) s.shields.current = ls.sc;
    if (s.behavior) s.behavior.mode = ls.m;
    s.attacking   = ls.at;
    s.moveTarget  = ls.mt;
    s.ionDisabled = ls.io;
    s._jumpingToHyperspace = ls.jh;
    if (ls.dh) { s._departingToHyper = true; s._departStartTime = ls.dh.st; s._departDuration = ls.dh.du; }
    else s._departingToHyper = false;
  }
}

/** HOST: Initialize P2P host, return peer ID */
export async function initHost(onPlayerInput, onConnectionChange, onNewConn) {
  const PeerJS = await ensurePeer();
  const peer   = new PeerJS(undefined, PEER_CONFIG);
  const conns  = [];
  const connMeta = new Map();

  return new Promise((resolve, reject) => {
    const failTimer = setTimeout(() => reject(new Error('Signalisation PeerJS inaccessible (timeout 15s)')), 15000);

    peer.on('error', err => {
      // Les erreurs par-connexion ne doivent pas tuer l'hôte entier
      console.warn('[P2P host] error:', err.type, err.message);
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        clearTimeout(failTimer);
        reject(err);
      }
    });

    peer.on('open', id => {
      clearTimeout(failTimer);
      peer._connections_list = conns;
      peer._conn_meta        = connMeta;

      peer.on('connection', conn => {
        // Attacher les listeners IMMÉDIATEMENT (avant 'open') —
        // évite la course où le 'hello' du client arrive avant l'écoute
        conn.on('data', data => {
          if (!data || typeof data !== 'object') return;
          if (data.type === 'hello') {
            connMeta.set(conn, {
              role:        data.role || 'spectator',
              faction:     data.faction ?? null,
              name:        data.name   || null,
              connectedAt: connMeta.get(conn)?.connectedAt || Date.now(),
            });
            onConnectionChange?.(connMeta);
          } else if (data.type === 'requestState') {
            // Récupération : le client n'a pas reçu l'état initial — renvoyer
            try { onNewConn?.(conn); } catch (e) { console.warn('[P2P] requestState:', e); }
          } else if (data.type === 'order' || data.type === 'diplomacy' || data.type === 'vote') {
            onPlayerInput?.(data, connMeta.get(conn) || {});
          }
        });

        conn.on('open', () => {
          conns.push(conn);
          if (!connMeta.has(conn)) {
            connMeta.set(conn, { role: 'unknown', faction: null, connectedAt: Date.now() });
          }
          onConnectionChange?.(connMeta);
          // État initial envoyé immédiatement au nouveau joueur
          try { onNewConn?.(conn); } catch (e) { console.warn('[P2P] onNewConn:', e); }
        });

        conn.on('close', () => {
          const i = conns.indexOf(conn);
          if (i >= 0) conns.splice(i, 1);
          connMeta.delete(conn);
          onConnectionChange?.(connMeta);
        });

        conn.on('error', err => console.warn('[P2P host] conn error:', err));
      });

      resolve({ peer, id, broadcast: (msg) => {
        const toSend = (msg && msg.type) ? msg : { type: 'state', snapshot: msg };
        conns.forEach(c => { if (c.open) { try { c.send(toSend); } catch (e) { console.error('[P2P] send échoué:', e.message, '— taille:', JSON.stringify(toSend).length); } } });
      }});
    });
  });
}

/**
 * CLIENT: Connect to host with auto-reconnect.
 * onStatus(status) — 'connecting' | 'connected' | 'reconnecting' | 'failed'
 */
export async function connectToHost(hostId, onSnapshot, role, faction, onStatus) {
  const PeerJS = await ensurePeer();

  let peer       = null;
  let conn       = null;
  let destroyed  = false;
  let retryCount = 0;
  const MAX_RETRIES = 5;

  function attemptConnection() {
    return new Promise((resolve, reject) => {
      onStatus?.(retryCount === 0 ? 'connecting' : 'reconnecting');
      peer = new PeerJS(undefined, PEER_CONFIG);

      const failTimer = setTimeout(() => {
        try { peer.destroy(); } catch {}
        reject(new Error('Timeout de connexion (15s)'));
      }, 15000);

      peer.on('error', err => {
        clearTimeout(failTimer);
        reject(err);
      });

      peer.on('open', () => {
        // reliable: true — OBLIGATOIRE : les snapshots dépassent la limite
        // des canaux non-fiables (~16 KB) et seraient silencieusement perdus
        // binarypack (défaut) : chunking automatique des messages >16 KB —
        // 'json' ne chunke PAS et tue le canal au-delà de ~64-256 KB (limite SCTP)
        conn = peer.connect(hostId, { reliable: true });

        conn.on('error', err => { clearTimeout(failTimer); reject(err); });

        // Listener attaché AVANT 'open' — aucun message ne peut être manqué
        conn.on('data', data => {
          if (!data || typeof data !== 'object') return;
          if (data.type === 'state') onSnapshot?.({ type: 'state', snapshot: data.snapshot });
          else onSnapshot?.(data);
        });

        conn.on('open', () => {
          clearTimeout(failTimer);
          retryCount = 0;
          onStatus?.('connected');
          try {
            conn.send({ type: 'hello', role: role || 'spectator', faction: faction ?? null });
          } catch {}
          resolve();
        });

        conn.on('close', () => {
          if (destroyed) return;
          onStatus?.('reconnecting');
          scheduleReconnect();
        });
      });
    });
  }

  async function scheduleReconnect() {
    if (destroyed || retryCount >= MAX_RETRIES) {
      onStatus?.('failed');
      return;
    }
    retryCount++;
    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 8000); // 1s,2s,4s,8s,8s
    await new Promise(r => setTimeout(r, delay));
    if (destroyed) return;
    try { peer?.destroy(); } catch {}
    try {
      await attemptConnection();
    } catch (e) {
      console.warn('[P2P client] reconnexion échouée:', e.message);
      scheduleReconnect();
    }
  }

  await attemptConnection();

  return {
    get peer() { return peer; },
    get conn() { return conn; },
    sendOrder: (order) => {
      if (conn?.open) { try { conn.send({ type: 'order', ...order }); } catch {} }
    },
    sendRaw: (msg) => {
      if (conn?.open) { try { conn.send(msg); } catch {} }
    },
    destroy: () => { destroyed = true; try { peer?.destroy(); } catch {} },
  };
}

/** Generate short invite code from peer ID (6 chars from hash) */
export function shortCode(peerId) {
  let h = 0;
  for (const c of peerId) h = ((h << 5) - h) + c.charCodeAt(0) | 0;
  return Math.abs(h).toString(36).toUpperCase().padStart(6, '0').slice(-6);
}
