/**
 * REPLAY — Battle recording and playback
 *
 * ReplayRecorder : records the full state on every tick.
 * ReplayPlayer   : replays a recorded battle (speed ×1/2/4, scrubber).
 *
 * Storage format (see models.js → createReplay):
 *   { battleId, meta: { name, createdAt }, ticks: [ { tick, ships, events } ] }
 *
 * The replay is kept in memory during the battle and can be
 * exported via JSON.stringify for saving to localStorage.
 *
 * TODO (developer):
 *   - Optimize storage size: encode only deltas between ticks
 *   - Add JSON file export/import (Blob + <a download>)
 *   - Fully wire the scrubber to live canvas rendering
 */

import { createReplay } from './models.js';
import CONFIG from './config.js';

// ═══════════════════════════════════════════════════════
// RECORDER
// ═══════════════════════════════════════════════════════

export class ReplayRecorder {
  /**
   * @param {string} name - Battle name (shown in the replay list)
   */
  constructor(name = 'Unnamed Battle') {
    this.replay   = createReplay({ name });
    this.recording= true;
    this._pendingEvents = [];
  }

  /**
   * Records the state at the end of a tick.
   * Called by GameEngine each tick (see app.js).
   *
   * @param {number}  tick   - Tick number
   * @param {Ship[]}  ships  - Current ship states
   */
  record(tick, ships) {
    if (!this.recording) return;
    if (this.replay.ticks.length >= CONFIG.REPLAY_MAX_TICKS) return;

    // Lightweight ship snapshot (only what's needed for playback)
    const snapshot = ships.map(s => ({
      id:        s.id,
      name:      s.name,
      alive:     s.alive,
      fleetId:   s.fleetId,
      type:      s.type,
      size:      s.size,
      position:  { ...s.position },
      hp:        s.hp,
      maxHp:     s.maxHp,
      shields: {
        current: s.shields.current,
        max:     s.shields.max,
        disabled:s.shields.disabled,
      },
      ionStacks: s.ionStacks,
      attacking: s.attacking,
      moveTarget:s.moveTarget ? { ...s.moveTarget } : null,
    }));

    this.replay.ticks.push({
      tick,
      ships:  snapshot,
      events: [...this._pendingEvents],
    });
    this._pendingEvents = [];
  }

  /** Adds an event to the current tick (called by the log function) */
  addEvent(message, type) {
    this._pendingEvents.push({ message, type, tick: this.replay.ticks.length });
  }

  /** Stops recording and returns the finalized replay */
  finalize() {
    this.recording = false;
    return this.replay;
  }

  get tickCount() { return this.replay.ticks.length; }
}

// ═══════════════════════════════════════════════════════
// PLAYER
// ═══════════════════════════════════════════════════════

export class ReplayPlayer {
  /**
   * @param {Replay}    replay   - Replay data
   * @param {GameState} state    - Shared state (ships are replaced each frame)
   * @param {Function}  onUpdate - Callback called on each playback tick
   */
  constructor(replay, state, onUpdate) {
    this.replay    = replay;
    this.state     = state;
    this.onUpdate  = onUpdate || (() => {});

    this.currentTick = 0;
    this.speed       = 1;       // 1, 2 or 4
    this.playing     = false;
    this._timer      = null;

    // UI elements
    this._scrubber  = document.getElementById('replay-scrubber');
    this._tickLabel = document.getElementById('replay-tick-display');

    if (this._scrubber) {
      this._scrubber.max   = replay.ticks.length - 1;
      this._scrubber.value = 0;
      this._scrubber.addEventListener('input', () => {
        this.goTo(parseInt(this._scrubber.value));
      });
    }

    this._bindControls();
  }

  _bindControls() {
    document.getElementById('replay-play')?.addEventListener('click',  () => this.play());
    document.getElementById('replay-pause')?.addEventListener('click', () => this.pause());
    document.getElementById('replay-stop')?.addEventListener('click',  () => this.stop());
    document.getElementById('replay-speed')?.addEventListener('change', e => {
      this.speed = parseInt(e.target.value) || 1;
      if (this.playing) { this.pause(); this.play(); }
    });
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    const interval = CONFIG.TICK_INTERVAL_MS / this.speed;
    this._timer = setInterval(() => {
      if (this.currentTick >= this.replay.ticks.length - 1) {
        this.pause();
        return;
      }
      this.currentTick++;
      this._applyTick(this.currentTick);
    }, interval);
  }

  pause() {
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
  }

  stop() {
    this.pause();
    this.goTo(0);
  }

  goTo(tick) {
    this.currentTick = Math.max(0, Math.min(tick, this.replay.ticks.length - 1));
    this._applyTick(this.currentTick);
  }

  /** Applies a tick's state to the GameState for rendering */
  _applyTick(tickIdx) {
    const frame = this.replay.ticks[tickIdx];
    if (!frame) return;

    // Replace ships in the state with the snapshot
    this.state.ships = frame.ships.map(s => ({
      ...s,
      // Fill in missing fields so the renderer works correctly
      shields:      s.shields || { max: 0, current: 0, disabled: false },
      weapons:      [],
      inventory:    {},
      behavior:     { mode: 'passive' },
      orders:       null,
      ionStacks:    s.ionStacks || 0,
      driveOff:     0,
      ionDisabled:  false,
      rammingProfile: { enabled: false },
      explosionOnDeath: { enabled: false },
      squadron:     null,
    }));
    this.state.tick = frame.tick;

    // Update scrubber UI
    if (this._scrubber) this._scrubber.value = tickIdx;
    if (this._tickLabel) this._tickLabel.textContent = `${tickIdx} / ${this.replay.ticks.length - 1}`;

    this.onUpdate(frame);
  }

  get isPlaying() { return this.playing; }
}

// ═══════════════════════════════════════════════════════
// REPLAY MODAL
// ═══════════════════════════════════════════════════════

/**
 * Manages the replay list display and playback controls.
 */
export class ReplayModal {
  /**
   * @param {Replay[]}  replays  - Replay list (from localStorage)
   * @param {GameState} state
   * @param {Function}  onUpdate - Render update callback
   */
  constructor(replays, state, onUpdate) {
    this.replays   = replays;
    this.state     = state;
    this.onUpdate  = onUpdate;
    this.player    = null;

    this._bindModal();
  }

  open() {
    document.getElementById('replay-modal').classList.remove('hidden');
    this._renderList();
  }

  close() {
    if (this.player) { this.player.stop(); this.player = null; }
    document.getElementById('replay-modal').classList.add('hidden');
  }

  _bindModal() {
    document.getElementById('close-replay')?.addEventListener('click', () => this.close());
    document.getElementById('replay-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('replay-modal')) this.close();
    });
  }

  _renderList() {
    const listEl = document.getElementById('replay-list');
    const playerEl = document.getElementById('replay-player');
    playerEl.classList.add('hidden');

    if (this.replays.length === 0) {
      listEl.innerHTML = '<p style="padding:16px;color:#6b7a9e;font-size:13px">No saved replays.<br>Click 💾 Save during or after a battle.</p>';
      return;
    }

    listEl.innerHTML = `<div class="replay-list">` +
      this.replays.map(r => `
        <div class="replay-item">
          <div>
            <div style="font-size:13px;color:#f0f4ff">${r.meta.name}</div>
            <div class="replay-meta">${new Date(r.meta.createdAt).toLocaleString()} — ${r.ticks.length} ticks</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary" data-play="${r.battleId}">▶ Play</button>
            <button class="btn btn-danger"  data-del="${r.battleId}">🗑</button>
          </div>
        </div>
      `).join('') + `</div>`;

    listEl.querySelectorAll('[data-play]').forEach(btn => {
      btn.addEventListener('click', () => {
        const replay = this.replays.find(r => r.battleId === btn.dataset.play);
        if (replay) this._startPlayer(replay);
      });
    });

    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.replays = this.replays.filter(r => r.battleId !== btn.dataset.del);
        import('./storage.js').then(({ saveReplays }) => saveReplays(this.replays));
        this._renderList();
      });
    });
  }

  _startPlayer(replay) {
    document.getElementById('replay-title').textContent = replay.meta.name;
    document.getElementById('replay-player').classList.remove('hidden');

    if (this.player) this.player.stop();
    this.player = new ReplayPlayer(replay, this.state, this.onUpdate);
    this.player.goTo(0);
  }

  /** Updates the replay list from outside (after saving) */
  updateReplays(replays) {
    this.replays = replays;
  }
}
