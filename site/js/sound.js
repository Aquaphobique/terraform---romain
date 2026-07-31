/**
 * SOUND.JS — Sons d'interface style Battlefront II (2005)
 *
 * Sons 100% synthétisés via Web Audio API (aucun fichier audio).
 *
 * API :
 *   SFX.click()          — clic d'interface générique
 *   SFX.order()          — ordre donné
 *   SFX.select()         — sélection d'un vaisseau
 *   SFX.tab()            — changement d'onglet
 *   SFX.deny()           — action refusée
 *   SFX.vote()           — vote/validation
 *   SFX.alert()          — alerte (perte de vaisseau)
 *   SFX.hyperspace()     — saut hyperespace
 *   SFX.explosion()      — explosion vaisseau ordinaire
 *   SFX.capitalDestroyed() — destruction vaisseau capital / nommé
 *   SFX.planetDestroyed()  — Étoile de la Mort détruit une planète
 *   SFX.selectedDestroyed()— vaisseau SÉLECTIONNÉ vient d'être détruit
 */

let _ctx = null;
function ctx() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

const SFX = {
  enabled: localStorage.getItem('sts-sound-on') !== '0',
  volume:  parseFloat(localStorage.getItem('sts-sound-vol') ?? '0.5'),

  _lastPlayed: {},
  _throttled(key, windowMs) {
    const now = Date.now();
    if (now - (this._lastPlayed[key] || 0) < windowMs) return true;
    this._lastPlayed[key] = now;
    return false;
  },

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('sts-sound-on', on ? '1' : '0');
  },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('sts-sound-vol', String(this.volume));
  },

  /** Oscillateur générique */
  _tone(freqStart, freqEnd, dur, type = 'square', vol = 1, delay = 0) {
    if (!this.enabled || this.volume <= 0) return;
    const ac = ctx(); if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== freqStart) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    const peak = 0.18 * this.volume * vol;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  },

  /** Bruit blanc filtré — pour les explosions */
  _noise(dur, freq, q, vol = 1, delay = 0) {
    if (!this.enabled || this.volume <= 0) return;
    const ac = ctx(); if (!ac) return;
    const t0 = ac.currentTime + delay;
    const bufSize = Math.ceil(ac.sampleRate * dur);
    const buf  = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src    = ac.createBufferSource();
    src.buffer   = buf;
    const filter = ac.createBiquadFilter();
    filter.type  = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.setValueAtTime(q, t0);
    const gain   = ac.createGain();
    const peak   = 0.28 * this.volume * vol;
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
    src.start(t0); src.stop(t0 + dur);
  },

  // ── Sons d'interface ──────────────────────────────────────────

  click()  { this._tone(1400, 1400, 0.045, 'square', 0.7); },

  select() {
    this._tone(880,  880,  0.05, 'square', 0.8);
    this._tone(1760, 1760, 0.04, 'sine',   0.4, 0.02);
  },

  order() {
    this._tone(740,  740,  0.06, 'square', 0.9);
    this._tone(1108, 1108, 0.08, 'square', 0.9, 0.07);
  },

  tab()  { this._tone(600, 1500, 0.08, 'sine', 0.6); },

  deny() {
    this._tone(220, 160, 0.12, 'sawtooth', 0.8);
    this._tone(110,  90, 0.12, 'square',   0.5, 0.01);
  },

  vote() {
    this._tone(1046, 1046, 0.08, 'sine', 0.8);
    this._tone(1568, 1568, 0.12, 'sine', 0.8, 0.09);
  },

  /** Alerte générique — perte de vaisseau */
  alert() {
    if (this._throttled('alert', 1200)) return;
    this._tone(440, 440, 0.10, 'square', 0.9);
    this._tone(349, 349, 0.14, 'square', 0.9, 0.12);
  },

  /** Saut hyperespace */
  hyperspace() {
    if (this._throttled('hyperspace', 1500)) return;
    this._tone(200, 2400, 0.5, 'sawtooth', 0.5);
    this._tone(800, 3200, 0.35, 'sine',    0.35, 0.12);
  },

  // ── Sons d'explosion — style Star Wars ────────────────────────
  //
  // Signature sonore SW :
  //   1. "Crack" métallique initial très court (impact)
  //   2. Montée en fréquence (boule de feu)
  //   3. Sub-basse "whomp" dominante (onde de choc)
  //   4. Queue de réverbération grave décroissante
  //   5. Silence abrupt (le vide ne transmet pas le son)

  /** Crack d'impact SW — commun à toutes les explosions */
  _crack(vol, delay) {
    vol = vol ?? 1.0; delay = delay ?? 0;
    this._noise(0.04, 3000, 0.8, vol * 0.8, delay);
    this._noise(0.08, 600,  1.5, vol * 0.6, delay);
  },

  /** Explosion petite (XS–S) : chasseur, torpille */
  explosion() {
    if (this._throttled('explosion', 350)) return;
    this._crack(1.0);
    this._noise(0.22, 180, 1.0, 1.1, 0.03);
    this._noise(0.18, 80,  0.8, 0.9, 0.05);
    this._tone(55, 22, 0.40, 'sine', 1.2, 0.04);
    this._tone(85, 35, 0.28, 'sawtooth', 0.7, 0.03);
    this._noise(0.25, 60, 0.5, 0.5, 0.18);
  },

  /** Explosion moyenne (M–L) : frégate, croiseur léger */
  explosionMedium() {
    if (this._throttled('explosionMed', 600)) return;
    this._crack(1.2);
    this._noise(0.35, 220, 0.9, 1.3, 0.02);
    this._noise(0.28, 100, 0.7, 1.1, 0.05);
    this._noise(0.20, 55,  0.5, 0.9, 0.10);
    this._tone(45, 18, 0.65, 'sine', 1.5, 0.05);
    this._tone(70, 28, 0.50, 'sawtooth', 1.0, 0.04);
    this._noise(0.40, 50, 0.4, 0.6, 0.30);
    this._tone(35, 15, 0.55, 'sine', 0.5, 0.35);
  },

  /** Destruction vaisseau capital ou nommé — 4 phases */
  capitalDestroyed() {
    if (this._throttled('capital', 2000)) return;
    this._crack(1.5);
    this._noise(0.12, 2000, 1.0, 1.0, 0.01);
    this._noise(0.55, 250, 0.8, 1.6, 0.02);
    this._noise(0.45, 120, 0.7, 1.4, 0.05);
    this._noise(0.35, 60,  0.5, 1.2, 0.10);
    this._tone(1200, 80, 0.30, 'sawtooth', 0.8, 0.02);
    this._tone(38, 15, 1.00, 'sine', 2.0, 0.05);
    this._tone(60, 22, 0.80, 'sawtooth', 1.5, 0.04);
    this._tone(90, 35, 0.60, 'sine', 1.2, 0.06);
    this._noise(0.70, 55, 0.4, 0.9, 0.30);
    this._noise(0.50, 80, 0.3, 0.7, 0.50);
    this._tone(28, 12, 0.90, 'sine', 0.8, 0.40);
    this._tone(349, 349, 0.14, 'square', 0.7, 1.10);
    this._tone(262, 262, 0.18, 'square', 0.7, 1.27);
  },

  /** Étoile de la Mort détruit une planète — 5 phases */
  planetDestroyed() {
    if (this._throttled('planet', 3000)) return;
    this._tone(400, 4000, 0.35, 'sawtooth', 0.6, 0.00);
    this._tone(200, 2000, 0.40, 'sine', 0.5, 0.05);
    this._crack(2.5, 0.40);
    this._noise(0.08, 8000, 0.5, 1.2, 0.40);
    this._noise(0.80, 300, 0.6, 2.0, 0.42);
    this._noise(0.65, 150, 0.5, 1.8, 0.48);
    this._noise(0.55, 70,  0.4, 1.6, 0.55);
    this._tone(800, 40, 0.60, 'sawtooth', 1.5, 0.42);
    this._tone(32, 12, 1.80, 'sine', 2.5, 0.50);
    this._tone(50, 18, 1.60, 'sawtooth', 2.0, 0.52);
    this._tone(75, 28, 1.30, 'sine', 1.8, 0.55);
    this._noise(1.20, 45, 0.35, 1.4, 0.60);
    this._noise(0.80, 90,  0.3, 1.0, 1.00);
    this._noise(0.60, 200, 0.4, 0.8, 1.20);
    this._tone(25, 10, 1.50, 'sine', 1.0, 1.20);
    this._noise(0.50, 60,  0.3, 0.6, 1.60);
    this._tone(20,  8, 1.20, 'sine', 0.7, 1.80);
    this._tone(523, 523, 0.10, 'square', 0.7, 2.50);
    this._tone(392, 392, 0.14, 'square', 0.7, 2.63);
    this._tone(523, 523, 0.10, 'square', 0.7, 2.80);
  },

  /** Vaisseau sélectionné détruit — son personnel de deuil */
  selectedDestroyed() {
    this._crack(0.8);
    this._noise(0.20, 200, 1.0, 0.9, 0.01);
    this._tone(45, 18, 0.55, 'sine', 1.0, 0.03);
    this._tone(440, 440, 0.10, 'sine', 0.9, 0.25);
    this._tone(330, 330, 0.12, 'sine', 0.9, 0.37);
    this._tone(220, 220, 0.18, 'sine', 1.0, 0.51);
    this._tone(165, 110, 0.35, 'sine', 0.8, 0.71);
    this._noise(0.45, 70, 0.5, 0.6, 0.35);
    this._tone(40, 18, 0.60, 'sawtooth', 0.5, 0.45);
  },

};

/** Branche les sons sur les éléments d'interface */
export function initSoundUI() {
  const right = document.querySelector('.topbar-right');
  if (right && !document.getElementById('btn-sound')) {
    const btn = document.createElement('button');
    btn.id = 'btn-sound';
    btn.className = 'btn';
    btn.style.cssText = 'padding:4px 8px;font-size:13px';
    btn.title = 'Sons d\'interface';
    btn.textContent = SFX.enabled ? '🔊' : '🔇';

    const panel = document.createElement('div');
    panel.id = 'sound-panel';
    panel.style.cssText = 'display:none;position:fixed;top:46px;right:8px;background:#0a0f1d;border:1px solid #2a3550;border-radius:6px;padding:10px 12px;z-index:2000;box-shadow:0 4px 16px #000a';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <label style="font-size:11px;color:#9aafcc;display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="sound-toggle" ${SFX.enabled ? 'checked' : ''}> Sons activés
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:10px;color:#6b7a9e">Vol.</span>
        <input type="range" id="sound-vol" min="0" max="100" value="${Math.round(SFX.volume * 100)}" style="width:110px;accent-color:#4a9eff">
        <span id="sound-vol-label" style="font-size:10px;color:#9aafcc;min-width:28px">${Math.round(SFX.volume * 100)}%</span>
      </div>`;
    document.body.appendChild(panel);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      SFX.click();
    });
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
    });
    panel.querySelector('#sound-toggle').addEventListener('change', (e) => {
      SFX.setEnabled(e.target.checked);
      btn.textContent = SFX.enabled ? '🔊' : '🔇';
      if (SFX.enabled) SFX.vote();
    });
    panel.querySelector('#sound-vol').addEventListener('input', (e) => {
      SFX.setVolume(parseInt(e.target.value) / 100);
      panel.querySelector('#sound-vol-label').textContent = e.target.value + '%';
    });
    panel.querySelector('#sound-vol').addEventListener('change', () => SFX.click());
    right.insertBefore(btn, right.firstChild);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .right-tab, .tab-btn, select');
    if (!el) return;
    if (el.classList.contains('right-tab') || el.classList.contains('tab-btn')) SFX.tab();
    else if (el.tagName === 'BUTTON' && !el.dataset.sfxHandled) SFX.click();
  }, true);
}

export default SFX;
