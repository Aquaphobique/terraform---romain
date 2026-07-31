/**
 * SETUP WIZARD — 3 étapes : Terrain → Hyperespace → Factions
 * Rewritten with DOM construction (no complex template literals) for reliability.
 */

import { FACTION_COLORS, FACTION_NAMES_DEFAULT, NEUTRAL_FACTION_INDEX } from './faction.js';

export const TERRAIN_PRESETS = [
  { id:'open',     icon:'🌌', name:'Espace standard',       desc:'Aucun effet particulier.',                    effect:null },
  { id:'asteroid', icon:'☄️', name:"Champ d'astéroïdes",    desc:'Précision -15%, risque de collision.',        effect:{type:'asteroid_field',accuracyMod:-0.15,movePenalty:0.15} },
  { id:'nebula',   icon:'🌫', name:'Nébuleuse',              desc:'Vision -40%, capteurs perturbés.',            effect:{type:'nebula',visionMod:-0.40,sensorBlock:true} },
  { id:'gravity',  icon:'⚫', name:'Masse gravitationnelle', desc:'Trou noir : attraction vers le centre.',      effect:{type:'black_hole',pullStrength:0.8} },
  { id:'debris',   icon:'💥', name:'Champ de débris',        desc:'Couvert tactique, vitesse -20%.',             effect:{type:'debris',coverBonus:0.20,movePenalty:0.20} },
  { id:'ice',      icon:'❄', name:'Champ de glace',         desc:'Fragments inévitables — dégâts ∝ vitesse. Ralentir !', effect:{type:'ice_field'} },
];

// ── CSS injected once ──────────────────────────────────────────────────────
const WIZARD_CSS = `
  #setup-wizard { position:fixed;inset:0;z-index:9999;background:#050608;
    display:flex;align-items:center;justify-content:center;font-family:monospace;color:#c8d8ff; }
  #setup-wizard .wz-card { max-width:600px;width:92%;background:#080d18;border:1px solid #2a3550;
    border-radius:8px;padding:28px;box-sizing:border-box; }
  #setup-wizard .wz-title { font-size:18px;color:#4a9eff;letter-spacing:2px;margin:0 0 2px; }
  #setup-wizard .wz-sub   { font-size:11px;color:#6b7a9e;margin:0 0 16px; }
  #setup-wizard .wz-bar   { height:3px;background:#1e2740;border-radius:2px;margin-bottom:24px; }
  #setup-wizard .wz-progress { height:3px;background:#4a9eff;border-radius:2px;transition:width .3s; }
  #setup-wizard .wz-actions { display:flex;gap:10px;margin-top:20px; }
  #setup-wizard .wz-btn  { flex:1;padding:10px;border-radius:4px;cursor:pointer;font-family:monospace;
    font-size:13px;border:1px solid #2a3550;background:#0e1520;color:#c8d8ff; }
  #setup-wizard .wz-btn-primary { background:#1a3060;border-color:#4a9eff;color:#4a9eff; }
  #setup-wizard .wz-btn-launch  { background:#1a3a2a;border-color:#3ddc84;color:#3ddc84;font-size:14px; }
  #setup-wizard .wz-opt  { border:1px solid #1e2740;background:#070c14;border-radius:4px;
    padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:12px;margin-bottom:6px;transition:all .15s; }
  #setup-wizard .wz-opt:hover     { border-color:#4a9eff55; }
  #setup-wizard .wz-opt.selected  { border-color:#4a9eff;background:#0a1628; }
  #setup-wizard .wz-opt .icon     { font-size:20px; }
  #setup-wizard .wz-opt .name     { font-size:13px;font-weight:bold; }
  #setup-wizard .wz-opt .desc     { font-size:11px;color:#6b7a9e; }
  #setup-wizard .wz-slider        { accent-color:#aa44ff;width:100%;margin:8px 0; }
  #setup-wizard .wz-fac-row       { display:flex;align-items:center;gap:8px;padding:6px 10px;
    background:#080d18;border-radius:4px;margin-bottom:5px;border-left:3px solid transparent; }
  #setup-wizard .wz-fac-cb        { width:18px;height:18px;cursor:pointer; }
  #setup-wizard .wz-fac-dot       { font-size:16px; }
  #setup-wizard .wz-fac-input     { flex:1;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;
    padding:4px 8px;border-radius:3px;font-family:monospace;font-size:12px;font-weight:bold; }
`;

function injectCSS() {
  if (document.getElementById('wz-style')) return;
  const s = document.createElement('style');
  s.id = 'wz-style';
  s.textContent = WIZARD_CSS;
  document.head.appendChild(s);
}

function el(tag, attrs={}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class')    e.className  = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'html')  e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

export class SetupWizard {
  constructor(onComplete) {
    this.onComplete  = onComplete;
    this.totalSteps  = 3;
    this.step        = 1;
    this.terrain     = TERRAIN_PRESETS[0];
    this.hypRoutes   = 2;
    this.diplomacyMode = 'conflict'; // 'conflict' | 'peace'
    this.factions    = [{ colorIndex: 0, name: FACTION_NAMES_DEFAULT[0] }];

    injectCSS();
    document.getElementById('setup-wizard')?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'setup-wizard';

    // Force visible immediately before _render() in case _render() throws
    this.overlay.style.cssText = 'position:fixed !important;inset:0 !important;z-index:999999 !important;background:#050608;color:#4a9eff;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:18px';
    this.overlay.textContent = '⏳ Initialisation…';

    if (!document.body) {
      console.error('[SetupWizard] document.body is null!');
      return;
    }
    document.body.appendChild(this.overlay);
    console.log('[SetupWizard] overlay appended to body, id=', this.overlay.id);

    this._render();
  }

  _render() {
    try {
      const overlay = this.overlay;
      overlay.innerHTML = '';
      // Debug: red border to confirm element exists and is positioned
      overlay.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:999999 !important;background:#050608 !important;display:flex !important;align-items:center !important;justify-content:center !important;font-family:monospace;color:#c8d8ff';

      // Temporary loading text (replaced once card is built)
      overlay.textContent = '⏳ Chargement du wizard…';

      const card = el('div', {class:'wz-card'});

      // Header
      card.appendChild(el('h1', {class:'wz-title'}, '🚀 SPACE TACTICS SIMULATOR'));
      card.appendChild(el('p',  {class:'wz-sub'},   'Initialisation — Étape ' + this.step + ' / ' + this.totalSteps));

      // Progress bar
      const bar = el('div', {class:'wz-bar'});
      bar.appendChild(el('div', {class:'wz-progress', style:'width:' + Math.round(this.step/this.totalSteps*100) + '%'}));
      card.appendChild(bar);

      // Step content
      const stepDiv = document.createElement('div');
      stepDiv.style.minHeight = '280px';
      this._buildStep(stepDiv);
      card.appendChild(stepDiv);

      // Actions
      const actions = el('div', {class:'wz-actions'});
      if (this.step > 1) {
        const back = el('button', {class:'wz-btn'}, '◀ Précédent');
        back.addEventListener('click', () => { this.step--; this._render(); });
        actions.appendChild(back);
      }
      if (this.step < this.totalSteps) {
        const next = el('button', {class:'wz-btn wz-btn-primary'}, 'Suivant ▶');
        next.addEventListener('click', () => {
          if (this._validate()) { this.step++; this._render(); }
        });
        actions.appendChild(next);
      } else {
        const launch = el('button', {class:'wz-btn wz-btn-launch'}, '🚀 LANCER LA PARTIE');
        launch.addEventListener('click', () => {
          if (this._validate()) {
            this.overlay.remove();
            this.onComplete({
              terrain:   this.terrain,
              hypRoutes: this.hypRoutes,
              factions:  this.factions.map(f => ({colorIndex:f.colorIndex, name:f.name})),
              diplomacyMode: this.diplomacyMode,
            });
          }
        });
        actions.appendChild(launch);
      }
      card.appendChild(actions);
      overlay.textContent = ''; // Clear loading text
      overlay.appendChild(card);
    } catch(err) {
      console.error('SetupWizard _render error:', err);
      this.overlay.innerHTML = '<div style="color:red;padding:40px;font-family:monospace">Erreur wizard: ' + err.message + '</div>';
    }
  }

  _buildStep(container) {
    switch (this.step) {
      case 1: this._buildTerrain(container);    break;
      case 2: this._buildHyperspace(container); break;
      case 3: this._buildFactions(container);   break;
    }
  }

  _buildTerrain(container) {
    container.appendChild(el('h2', {style:'font-size:14px;margin-bottom:8px'}, 'Étape 1 — Environnement'));
    container.appendChild(el('p', {style:'font-size:11px;color:#6b7a9e;margin-bottom:12px'},
      'Choisir le terrain qui modifiera les règles de la bataille.'));

    for (const t of TERRAIN_PRESETS) {
      const div = el('div', {class:'wz-opt' + (t.id===this.terrain.id?' selected':'')});
      div.appendChild(el('span', {class:'icon'}, t.icon));
      const info = el('div');
      info.appendChild(el('div', {class:'name', style:'color:' + (t.id===this.terrain.id?'#4a9eff':'#c8d8ff')}, t.name));
      info.appendChild(el('div', {class:'desc'}, t.desc));
      div.appendChild(info);
      if (t.id === this.terrain.id) div.appendChild(el('span', {style:'margin-left:auto;color:#4a9eff'}, '✓'));
      div.addEventListener('click', () => { this.terrain = t; this._render(); });
      container.appendChild(div);
    }
  }

  _buildHyperspace(container) {
    const n = this.hypRoutes;
    container.appendChild(el('h2', {style:'font-size:14px;margin-bottom:8px'}, 'Étape 2 — Routes Hyperespace'));
    container.appendChild(el('p', {style:'font-size:11px;color:#6b7a9e;margin-bottom:16px'},
      "Définir les zones d'extraction. Les vaisseaux avec hyperdrive peuvent s'échapper via ces zones."));

    const row = el('div', {style:'display:flex;align-items:center;gap:16px;margin-bottom:12px'});
    const slider = el('input', {type:'range', class:'wz-slider', min:'2', max:'8', value:String(n)});
    const countEl = el('div', {style:'font-size:28px;font-weight:bold;color:#aa44ff;min-width:40px;text-align:center'}, String(n));
    slider.addEventListener('input', () => {
      this.hypRoutes = parseInt(slider.value);
      countEl.textContent = slider.value;
      info.textContent = this.hypRoutes === 0
        ? '⚠ Aucune route — pas de fuite possible.'
        : '✅ ' + this.hypRoutes + ' zone' + (this.hypRoutes>1?'s':'') + ' de saut seront placées sur la carte.';
    });
    row.appendChild(slider);
    row.appendChild(countEl);
    container.appendChild(row);

    const info = el('div', {style:'font-size:11px;color:#6b7a9e;background:#0a0e1a;border:1px solid #1e2740;border-radius:4px;padding:10px'});
    info.textContent = n === 0
      ? '⚠ Aucune route — pas de fuite possible.'
      : '✅ ' + n + ' zone' + (n>1?'s':'') + ' de saut seront placées sur la carte.';
    container.appendChild(info);
  }

  _buildFactions(container) {
    container.appendChild(el('h2', {style:'font-size:14px;margin-bottom:8px'}, 'Étape 3 — Factions & diplomatie'));
    container.appendChild(el('p', {style:'font-size:11px;color:#6b7a9e;margin-bottom:12px'},
      'Activer et nommer les factions (minimum 1). Vous pouvez compléter avec des flottes neutres (MJ) en partie.'));

    // ── Mode diplomatique initial ──
    const dipBlock = el('div', {style:'margin-bottom:14px;padding:10px;background:#0a1018;border:1px solid #2a3550;border-radius:6px'});
    dipBlock.appendChild(el('div', {style:'font-size:11px;color:#4a9eff;margin-bottom:8px;letter-spacing:1px'}, 'MODE POLITIQUE INITIAL'));
    const modes = [
      { id:'conflict', icon:'⚔', label:'Conflit', desc:'Factions hostiles entre elles par défaut — état de guerre initial. Chaque faction peut attaquer librement les autres.' },
      { id:'peace',    icon:'🕊', label:'Paix',    desc:'Factions en neutralité diplomatique — elles coexistent sans se tirer dessus. Le MJ peut déclarer la guerre en cours de partie.' },
    ];
    for (const m of modes) {
      const row = el('label', {style:'display:flex;gap:8px;align-items:flex-start;cursor:pointer;padding:5px;border-radius:4px;' + (this.diplomacyMode===m.id?'background:#1a2038;border:1px solid #3a5088;':'border:1px solid transparent;')});
      const radio = el('input');
      radio.type = 'radio'; radio.name = 'dipMode'; radio.value = m.id;
      radio.checked = this.diplomacyMode === m.id;
      const txt = el('div');
      txt.appendChild(el('div', {style:'font-size:12px;color:#c8d8ff;font-weight:bold'}, m.icon + ' ' + m.label));
      txt.appendChild(el('div', {style:'font-size:10px;color:#6b7a9e;margin-top:2px'}, m.desc));
      row.appendChild(radio); row.appendChild(txt);
      radio.addEventListener('change', () => { this.diplomacyMode = m.id; this._render(); });
      dipBlock.appendChild(row);
    }
    container.appendChild(dipBlock);

    this._countEl = el('div', {style:'font-size:11px;color:#6b7a9e;margin-bottom:8px'});
    this._countEl.textContent = this.factions.length < 1
      ? '⚠ Sélectionner au moins 1 faction.'
      : '✅ ' + this.factions.length + ' faction(s) activée(s).';
    container.appendChild(this._countEl);

    for (let i = 0; i < FACTION_COLORS.length; i++) {
      if (i === NEUTRAL_FACTION_INDEX) continue; // le neutre se gère via le MJ en partie, pas au setup
      const color   = FACTION_COLORS[i];
      const faction = this.factions.find(f => f.colorIndex === i);
      const active  = !!faction;
      const name    = faction?.name || FACTION_NAMES_DEFAULT[i];

      const row = el('div', {class:'wz-fac-row', style:'border-left-color:' + color + (active?';background:#0a1628':'')});

      const cb = el('input', {type:'checkbox', class:'wz-fac-cb'});
      cb.style.accentColor = color;
      if (active) cb.checked = true;

      const dot = el('span', {class:'wz-fac-dot'}, '◆');
      dot.style.color = color;

      const nameInput = el('input', {class:'wz-fac-input', placeholder:'Nom de la faction'});
      nameInput.value = name;
      nameInput.style.color = active ? color : '#6b7a9e';
      nameInput.style.borderColor = active ? color + '66' : '#2a3550';

      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!this.factions.find(f => f.colorIndex === i)) {
            this.factions.push({colorIndex:i, name:nameInput.value||FACTION_NAMES_DEFAULT[i]});
          }
          nameInput.style.color = color;
          nameInput.style.borderColor = color + '66';
          row.style.background = '#0a1628';
        } else {
          this.factions = this.factions.filter(f => f.colorIndex !== i);
          nameInput.style.color = '#6b7a9e';
          nameInput.style.borderColor = '#2a3550';
          row.style.background = '';
        }
        const count = this.factions.length;
        this._countEl.textContent = count < 1
          ? '⚠ Sélectionner au moins 1 faction.'
          : '✅ ' + count + ' faction(s) activée(s).';
      });

      nameInput.addEventListener('input', () => {
        const f = this.factions.find(f => f.colorIndex === i);
        if (f) f.name = nameInput.value;
      });

      row.appendChild(cb);
      row.appendChild(dot);
      row.appendChild(nameInput);
      container.appendChild(row);
    }
  }

  _validate() {
    if (this.step === 3 && this.factions.length < 1) {
      alert('Sélectionner au moins 1 faction.');
      return false;
    }
    return true;
  }

  refreshFleetLib() {}
}
