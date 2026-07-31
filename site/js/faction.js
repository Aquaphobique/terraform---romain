/**
 * FACTION — Multi-faction system (up to 8)
 *
 * Handles:
 *  - Faction colors, roles, invite links
 *  - Diplomacy matrix: conflict / neutral / allied
 *  - GM faction control (can control any faction)
 *  - Vote-to-advance mechanic
 *  - Player dashboard (URL token based)
 */

// ═══════════════════════════════════════════════════════
// FACTION COLORS  (indexed 0–7)
// ═══════════════════════════════════════════════════════

export const FACTION_COLORS = [
  '#4488ff',   // 0 — Blue
  '#ff3333',   // 1 — Red
  '#228822',   // 2 — Dark green
  '#cc22cc',   // 3 — Magenta
  '#ff8800',   // 4 — Orange
  '#44cc44',   // 5 — Light green
  '#ffdd00',   // 6 — Yellow
  '#ff88bb',   // 7 — Pink
  '#888888',   // 8 — Neutre (gris) — contrôlable uniquement par le MJ
];

export const FACTION_NAMES_DEFAULT = [
  'Faction Bleue', 'Faction Rouge', 'Faction Verte', 'Faction Magenta',
  'Faction Orange', 'Faction Vert Clair', 'Faction Jaune', 'Faction Rose',
  'Neutre (MJ)',
];

/** Index de la faction neutre — flottes sans propriétaire, grises, jouées
 *  uniquement par le MJ (pirates, civils, forces tierces…). */
export const NEUTRAL_FACTION_INDEX = 8;

// ═══════════════════════════════════════════════════════
// DIPLOMACY
// ═══════════════════════════════════════════════════════

export const DIPLOMACY_STATES = ['conflict', 'neutral', 'allied'];

/**
 * Creates an initial diplomacy matrix for N factions.
 * All factions default to 'conflict' with each other.
 * @param {string[]} fleetIds
 * @returns {Object} { [fleetA]: { [fleetB]: 'conflict'|'neutral'|'allied' } }
 */
export function createDiplomacyMatrix(fleetIds) {
  const matrix = {};
  for (const a of fleetIds) {
    matrix[a] = {};
    for (const b of fleetIds) {
      if (a !== b) matrix[a][b] = 'conflict';
    }
  }
  return matrix;
}

/**
 * Returns the diplomacy stance of faction A toward faction B.
 * @returns {'conflict'|'neutral'|'allied'}
 */
export function getDiplomacy(matrix, fleetA, fleetB) {
  if (fleetA === fleetB) return 'allied'; // same faction = always allied
  return matrix?.[fleetA]?.[fleetB] ?? 'conflict';
}

/**
 * Sets the diplomacy stance of faction A toward faction B.
 * Optionally mirrors the change (mutual) — default true.
 */
export function setDiplomacy(matrix, fleetA, fleetB, stance, mutual = false) {
  if (!matrix[fleetA]) matrix[fleetA] = {};
  matrix[fleetA][fleetB] = stance;
  if (mutual) {
    if (!matrix[fleetB]) matrix[fleetB] = {};
    matrix[fleetB][fleetA] = stance;
  }
}

// ═══════════════════════════════════════════════════════
// PLAYER TOKENS / INVITE LINKS
// ═══════════════════════════════════════════════════════

/** Generates a deterministic token for a faction (based on fleet ID). */
export function generateFactionToken(fleetId) {
  // Simple but not secret — sufficient for a tabletop aid
  let hash = 0;
  for (const c of fleetId) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36).padStart(6, '0');
}

/**
 * Returns the invite URL for a faction.
 * Example: https://example.com/game/?faction=fleet_rep&token=abc123
 */
export function getFactionInviteUrl(fleetId, baseUrl) {
  const token = generateFactionToken(fleetId);
  const u = new URL(baseUrl || window.location.href);
  u.searchParams.set('faction', fleetId);
  u.searchParams.set('token', token);
  return u.toString();
}

/**
 * Reads the faction token from the current URL.
 * Returns { fleetId, isGM, isSpectator } or null (= GM mode).
 */
export function readFactionFromUrl() {
  try {
    const params     = new URLSearchParams(window.location.search);
    const faction    = params.get('faction');
    const token      = params.get('token');
    const spectator  = params.get('spectator') === '1';

    if (spectator) return { fleetId: null, isGM: false, isSpectator: true };

    if (faction && token && token === generateFactionToken(faction)) {
      return { fleetId: faction, isGM: false, isSpectator: false };
    }
    if (params.get('gm') === '1') return { fleetId: null, isGM: true, isSpectator: false };
  } catch {}
  return null; // no URL params → GM mode
}

// ═══════════════════════════════════════════════════════
// VOTE TO ADVANCE
// ═══════════════════════════════════════════════════════

/**
 * Vote manager — uses BroadcastChannel so all browser tabs sync.
 * Falls back to localStorage if BroadcastChannel unavailable.
 */
export class VoteManager {
  constructor(gameId, fleets, onAdvance) {
    this.gameId    = gameId;
    this.fleets    = fleets; // active fleet IDs
    this.onAdvance = onAdvance;
    this.votes     = new Set();

    // BroadcastChannel for cross-tab communication
    try {
      this._channel = new BroadcastChannel(`sts-${gameId}`);
      this._channel.onmessage = e => this._handleMessage(e.data);
    } catch {
      this._channel = null;
    }
  }

  /** A faction casts a vote to advance. */
  castVote(fleetId) {
    this.votes.add(fleetId);
    this._broadcast({ type: 'vote', fleetId });
    this._checkAllVoted();
  }

  /** GM forces an advance (bypass voting). */
  forceAdvance() {
    this.votes.clear();
    this._broadcast({ type: 'advance' });
    this.onAdvance?.();
  }

  /** GM resets votes without advancing. */
  resetVotes() {
    this.votes.clear();
    this._broadcast({ type: 'reset' });
  }

  _handleMessage(data) {
    if (data.type === 'vote') {
      this.votes.add(data.fleetId);
      this._checkAllVoted();
    } else if (data.type === 'advance') {
      this.votes.clear();
      this.onAdvance?.();
    } else if (data.type === 'reset') {
      this.votes.clear();
    }
  }

  _checkAllVoted() {
    const activeFleets = this.fleets.filter(f => f.active);
    if (activeFleets.length > 0 && activeFleets.every(f => this.votes.has(f.fleetId))) {
      this.forceAdvance();
    }
  }

  _broadcast(data) {
    this._channel?.postMessage(data);
    // Also store in localStorage for persistence
    try {
      localStorage.setItem(`sts-votes-${this.gameId}`, JSON.stringify([...this.votes]));
    } catch {}
  }

  destroy() {
    this._channel?.close();
  }
}

export default { FACTION_COLORS, FACTION_NAMES_DEFAULT, DIPLOMACY_STATES };
