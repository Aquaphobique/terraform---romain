/**
 * EDITOR — GM Editor
 *
 * Interface to create and modify:
 *   - Ship classes (templates)
 *   - Individual ships (instances)
 *   - Fleets
 *   - Scenarios
 *
 * Everything is persisted to localStorage via storage.js.
 * Changes can be applied to an ongoing game session.
 *
 * UI structure:
 *   Modal > Tabs > [List | Form]
 */

import { createShipClass, createFleet, createScenario, createWeapon,
         createInventory, SHIP_TYPES, SHIP_SIZES, WEAPON_TYPES } from './models.js?v=20250617c';
import { PRESET_CLASSES, instantiatePreset } from './presets.js?v=20250617c';
import { saveShipClasses, loadShipClasses, saveFleets, saveScenarios, upsertScenario,
         loadShipLibrary, saveShipLibrary, loadFleetLibrary, saveFleetLibrary } from './storage.js?v=20250617c';
import { nanoid, FLEET_COLORS } from './utils.js?v=20250617c';

export class EditorManager {
  /**
   * @param {GameState} state
   * @param {object}    callbacks - { onScenarioLoad, onFleetUpdate }
   */
  constructor(state, callbacks = {}) {
    this.state     = state;
    this.callbacks = callbacks;

    this.shipClasses = loadShipClasses();
    // Persistent libraries — ships/fleets NOT yet placed on battlefield
    this.shipLib  = loadShipLibrary();
    this.fleetLib = loadFleetLibrary();

    this._activeTab          = 'tab-classes';
    this._selectedClassId    = null;
    this._selectedFleetId    = null;
    this._selectedLibFleetId = null;
    this._selectedScenarioId = null;
    this._svType  = '';
    this._svClass = '';

    this._bindModal();
  }

  // ═══════════════════════════════════════════════════════
  // MODAL
  // ═══════════════════════════════════════════════════════

  open(tab = null) {
    if (tab) {
      this._activeTab = tab;
      document.querySelectorAll('#editor-modal .tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      document.querySelectorAll('#editor-modal .tab-content').forEach(t => {
        t.classList.toggle('active',  t.id === tab);
        t.classList.toggle('hidden', t.id !== tab);
      });
    }
    document.getElementById('editor-modal').classList.remove('hidden');
    this._renderActiveTab();
  }

  close() {
    document.getElementById('editor-modal').classList.add('hidden');
  }

  _bindModal() {
    document.getElementById('close-editor')?.addEventListener('click', () => this.close());

    // Tabs
    document.querySelectorAll('#editor-modal .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editor-modal .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#editor-modal .tab-content').forEach(t => {
          const isActive = t.id === btn.dataset.tab;
          t.classList.toggle('active',  isActive);
          t.classList.toggle('hidden', !isActive);
        });
        this._activeTab = btn.dataset.tab;
        this._renderActiveTab();
      });
    });

    // Close on backdrop click
    document.getElementById('editor-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('editor-modal')) this.close();
    });
  }

  _renderActiveTab() {
    switch (this._activeTab) {
      case 'tab-classes':   this._renderClassesTab();   break;
      case 'tab-ships':     this._renderShipsTab();     break;
      case 'tab-fleets':    this._renderFleetsTab();    break;
      case 'tab-scenarios': this._renderScenariosTab(); break;
    }
  }

  // ═══════════════════════════════════════════════════════
  // TAB: CLASSES
  // ═══════════════════════════════════════════════════════

  _renderClassesTab() {
    const el = document.getElementById('tab-classes');

    // Merge presets + custom classes
    const allClasses = [
      ...Object.values(PRESET_CLASSES).map(c => ({ ...c, _preset: true })),
      ...this.shipClasses,
    ];

    el.innerHTML = `
      <div class="editor-layout">
        <div class="editor-list" id="class-list">
          <div style="padding:6px;font-size:11px;color:#6b7a9e;border-bottom:1px solid #2a3550">
            📦 Presets (${Object.keys(PRESET_CLASSES).length}) + Custom (${this.shipClasses.length})
          </div>
          ${allClasses.map(c => `
            <div class="editor-list-item ${c.classId === this._selectedClassId ? 'selected' : ''}"
                 data-class-id="${c.classId}">
              ${c._preset ? '🔒 ' : '✏️ '}${c.name}
              <span style="color:#6b7a9e;font-size:10px"> [${c.size}]</span>
            </div>
          `).join('')}
          <div class="editor-list-item" data-class-id="__new__" style="color:#4a9eff">
            ➕ New Class
          </div>
        </div>
        <div id="class-form-container" class="editor-form">
          <p style="color:#6b7a9e">Select a class on the left or create a new one.</p>
        </div>
      </div>
    `;

    // Bind list clicks
    el.querySelectorAll('[data-class-id]').forEach(item => {
      item.addEventListener('click', () => {
        const cid = item.dataset.classId;
        if (cid === '__new__') {
          this._selectedClassId = '__new__';
          this._renderClassForm(null);
        } else {
          this._selectedClassId = cid;
          const cls = allClasses.find(c => c.classId === cid);
          this._renderClassForm(cls);
        }
      });
    });
  }

  _renderClassForm(cls) {
    const isPreset = cls?._preset;
    const isNew    = !cls;
    const container= document.getElementById('class-form-container');

    container.innerHTML = `
      <h3>${isNew ? '➕ New Class' : (isPreset ? `🔒 ${cls.name} (Preset — read only)` : `✏️ Edit: ${cls.name}`)}</h3>

      ${isPreset ? '' : `
      <div style="background:#0e1520;border:1px solid #2a3550;border-radius:4px;padding:6px 8px;margin-bottom:8px;font-size:10px;color:#6b7a9e;line-height:1.7">
        📋 <strong style="color:#4a9eff">Stat guide:</strong>
        <strong style="color:#c8d8ff">Name</strong> = ship class name (e.g. ARC-170) ·
        <strong style="color:#c8d8ff">Type</strong> = role (fighter, cruiser…) ·
        <strong style="color:#c8d8ff">Size</strong>: XS=fighters, S=gunships, M=corvettes, L=frigates, XL=cruisers/destroyers, XXL=dreadnoughts ·
        <strong style="color:#c8d8ff">Mass</strong>: fighter=1-3, corvette=50, frigate=200, cruiser=1500, destroyer=3000, dreadnought=10000 ·
        <strong style="color:#c8d8ff">Armor 1-5</strong>: 1=-10% dmg taken, 5=-50% ·
        <strong style="color:#c8d8ff">Shields</strong>: 0=none, fighter~25-40, capital~1200-8000
      </div>`}

      <div class="form-row">
        <label title="The ship's proper name, e.g. 'ARC-170 Starfighter'">Name</label>
        <input class="form-input" id="cf-name" value="${cls?.name || ''}" ${isPreset ? 'disabled' : ''}>
      </div>
      <div class="form-row">
        <label title="Role category: fighter, bomber, cruiser, destroyer…">Type</label>
        <select class="form-select" id="cf-type" ${isPreset ? 'disabled' : ''}>
          ${SHIP_TYPES.map(t => `<option value="${t}" ${cls?.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label title="Physical size: XS=5-15m, S=15-30m, M=100-200m, L=200-400m, XL=400-1000m, XXL=1-5km">Size</label>
        <select class="form-select" id="cf-size" ${isPreset ? 'disabled' : ''}>
          ${SHIP_SIZES.map(s => `<option value="${s}" ${cls?.size === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label title="Abstract mass: affects collision damage, ramming physics, torpedo lock-on">Mass</label>
        <input class="form-input" id="cf-mass" type="number" value="${cls?.mass ?? 1}" min="0.1" step="0.1" ${isPreset ? 'disabled' : ''}>
      </div>
      <div class="form-row">
        <label title="Hull armor 1-5: reduces physical damage taken. 1=-10%, 3=-30%, 5=-50%. Does NOT reduce ion damage.">Armor (1–5)</label>
        <input class="form-input" id="cf-armor" type="number" value="${cls?.hullArmor ?? 1}" min="1" max="5" ${isPreset ? 'disabled' : ''}>
      </div>
      <div class="form-row">
        <label title="Max shield strength. 0=no shields. Shields recharge at rate/tick. Breached shields restart after a delay.">Max Shields</label>
        <input class="form-input" id="cf-sh-max" type="number" value="${cls?.defaultShields?.max ?? 0}" min="0" ${isPreset ? 'disabled' : ''}>
      </div>
      <div class="form-row">
        <label title="Default pilot level for ships of this class. Level 2+ unlocks energy policies. Level 3 unlocks assault/retreat.">Pilot Lv (1–3)</label>
        <input class="form-input" id="cf-pilot" type="number" value="${cls?.defaultPilotLevel ?? 1}" min="1" max="3" ${isPreset ? 'disabled' : ''}>
      </div>

      ${isPreset && cls?.defaultWeapons?.length ? `
        <div style="margin-top:8px;border-top:1px solid #2a3550;padding-top:6px">
          <div style="font-size:11px;color:#6b7a9e;margin-bottom:4px">🔫 Default Weapons</div>
          ${cls.defaultWeapons.map(w => `
            <div style="font-size:11px;background:#0e1520;border:1px solid #1e2740;border-radius:3px;padding:4px 6px;margin-bottom:3px">
              <span style="color:#c8d8ff">${w.name}</span>
              <span style="color:#6b7a9e"> | ${w.type} ${w.size}</span>
              <span style="color:#3ddc84"> ${w.damage}dmg</span>
              <span style="color:#6b7a9e"> range:${w.range} acc:${Math.round(w.accuracy*100)}% cd:${w.cooldown}</span>
              ${w.defensive ? '<span style="color:#cc44ff"> [defensive turret]</span>' : ''}
              ${w.firingArc < 360 ? '<span style="color:#ffa726"> ['+w.firingArc+'° arc]</span>' : ''}
              <span style="display:inline-block;width:10px;height:10px;background:${w.color||'#ff3333'};border-radius:50%;margin-left:4px;vertical-align:middle"></span>
            </div>`).join('')}
        </div>` : ''}

      ${!isPreset ? `
        <div class="weapons-editor">
          <h4 style="font-size:12px;color:#7a8ab0;margin-bottom:4px">Default Weapons
            <span style="font-weight:normal;font-size:10px;color:#4b5a7a"> · Dmg = base damage · Range = cells · CD = cooldown in ticks</span>
          </h4>
          <div id="cf-weapons-list">
            ${(cls?.defaultWeapons || []).map((w, i) => this._weaponRow(w, i)).join('')}
          </div>
          <button id="cf-add-weapon" class="btn btn-small" style="margin-top:4px">➕ Add Weapon</button>
        </div>

        <div class="form-actions">
          <button id="cf-save" class="btn btn-primary">💾 Save</button>
          ${!isNew ? `<button id="cf-delete" class="btn btn-danger">🗑 Delete</button>` : ''}
        </div>
      ` : `
        <div class="form-actions">
          <button id="cf-use-preset" class="btn btn-primary">📋 Copy as Custom Class</button>
        </div>
      `}
    `;

    // Bind buttons
    document.getElementById('cf-add-weapon')?.addEventListener('click', () => {
      const list = document.getElementById('cf-weapons-list');
      const idx  = list.querySelectorAll('.weapon-row').length;
      const div  = document.createElement('div');
      div.innerHTML = this._weaponRow(createWeapon(), idx);
      list.appendChild(div.firstElementChild);
    });

    document.getElementById('cf-save')?.addEventListener('click', () => this._saveClass(cls));
    document.getElementById('cf-delete')?.addEventListener('click', () => {
      if (cls && confirm(`Delete class "${cls.name}"?`)) {
        this.shipClasses = this.shipClasses.filter(c => c.classId !== cls.classId);
        saveShipClasses(this.shipClasses);
        this._selectedClassId = null;
        this._renderClassesTab();
      }
    });

    document.getElementById('cf-use-preset')?.addEventListener('click', () => {
      // Copy preset as a custom class
      const copy = { ...cls, classId: nanoid(), name: cls.name + ' (copy)', _preset: false };
      delete copy._preset;
      this.shipClasses.push(copy);
      saveShipClasses(this.shipClasses);
      this._renderClassesTab();
    });
  }

  _weaponRow(w, idx) {
    return `
      <div class="weapon-row" data-idx="${idx}">
        <input class="form-input" placeholder="Name" value="${w.name}" data-field="name">
        <select data-field="type">
          ${WEAPON_TYPES.map(t => `<option value="${t}" ${w.type===t?'selected':''}>${t}</option>`).join('')}
        </select>
        <input class="form-input" type="number" placeholder="Dmg"   value="${w.damage}"   min="0" data-field="damage"   style="width:60px">
        <input class="form-input" type="number" placeholder="Range" value="${w.range}"    min="1" data-field="range"    style="width:50px">
        <input class="form-input" type="number" placeholder="CD"    value="${w.cooldown}" min="1" data-field="cooldown" style="width:45px">
        <button class="btn btn-small btn-danger" onclick="this.closest('.weapon-row').remove()">✕</button>
      </div>
    `;
  }

  _saveClass(existing) {
    const name  = document.getElementById('cf-name')?.value.trim();
    if (!name) return alert('Name is required.');

    const weaponRows = document.querySelectorAll('#cf-weapons-list .weapon-row');
    const weapons = Array.from(weaponRows).map(row => createWeapon({
      name:     row.querySelector('[data-field="name"]')?.value || 'Weapon',
      type:     row.querySelector('[data-field="type"]')?.value || 'laser',
      damage:   parseFloat(row.querySelector('[data-field="damage"]')?.value)   || 10,
      range:    parseFloat(row.querySelector('[data-field="range"]')?.value)    || 5,
      cooldown: parseInt  (row.querySelector('[data-field="cooldown"]')?.value) || 2,
    }));

    const cls = createShipClass({
      classId:   existing?.classId || nanoid(),
      name,
      type:      document.getElementById('cf-type')?.value,
      size:      document.getElementById('cf-size')?.value,
      mass:      parseFloat(document.getElementById('cf-mass')?.value)  || 1,
      hullArmor: parseInt  (document.getElementById('cf-armor')?.value) || 1,
      defaultPilotLevel: parseInt(document.getElementById('cf-pilot')?.value) || 1,
      defaultShields: { max: parseInt(document.getElementById('cf-sh-max')?.value) || 0, rechargeRate: 0.03, restartDelay: 3 },
      defaultWeapons: weapons,
    });

    const idx = this.shipClasses.findIndex(c => c.classId === cls.classId);
    if (idx >= 0) this.shipClasses[idx] = cls;
    else this.shipClasses.push(cls);

    saveShipClasses(this.shipClasses);
    this._selectedClassId = cls.classId;
    this._renderClassesTab();
  }

  // ═══════════════════════════════════════════════════════
  // TAB: SHIPS
  // ═══════════════════════════════════════════════════════

  _renderShipsTab() {
    const el = document.getElementById('tab-ships');
    const allClasses = { ...PRESET_CLASSES };
    this.shipClasses.forEach(c => { allClasses[c.classId] = c; });

    const TYPES = [
      'fighter','heavy_fighter','interceptor','bomber','gunship',
      'corvette','frigate','cruiser','destroyer','dreadnought',
    ];
    const TYPE_ICONS_MAP = {
      fighter:'🚀', heavy_fighter:'⚡', interceptor:'💨', bomber:'💣',
      gunship:'🔫', corvette:'🚢', frigate:'🛳', cruiser:'⚓',
      destroyer:'🗡', dreadnought:'💥',
    };

    const selectedType = this._svType || '';
    const selectedClass = this._svClass || '';

    // Filter classes by selected type
    const filteredClasses = selectedType
      ? Object.values(allClasses).filter(c => c.type === selectedType)
      : Object.values(allClasses);

    el.innerHTML = `
      <h3 style="margin-bottom:10px;font-size:13px">➕ Créer un vaisseau nommé</h3>

      <!-- ÉTAPE 1: Type -->
      <div style="margin-bottom:10px">
        <div style="font-size:10px;color:#6b7a9e;margin-bottom:4px">ÉTAPE 1 — TYPE</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${TYPES.map(t => `
            <button class="sv-type-btn btn btn-small ${selectedType===t?'btn-primary':''}" data-type="${t}"
              style="font-size:10px;padding:3px 7px">
              ${TYPE_ICONS_MAP[t]||'?'} ${t.replace('_',' ')}
            </button>`).join('')}
        </div>
      </div>

      <!-- ÉTAPE 2: Classe -->
      <div style="margin-bottom:10px">
        <div style="font-size:10px;color:#6b7a9e;margin-bottom:4px">ÉTAPE 2 — CLASSE</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${filteredClasses.map(c => `
            <button class="sv-class-btn btn btn-small ${selectedClass===c.classId?'btn-primary':''}"
              data-classid="${c.classId}" style="font-size:10px;padding:3px 7px"
              title="${c.lengthM||'?'}m × ${c.widthM||'?'}m — HP: auto">
              ${c.name}
            </button>`).join('')}
          <button class="sv-class-btn btn btn-small ${selectedClass==='__custom'?'btn-primary':''}"
            data-classid="__custom" style="font-size:10px;padding:3px 7px;border-style:dashed">
            ✦ Autre (custom)
          </button>
        </div>
      </div>

      <!-- ÉTAPE 3: Personnalisation -->
      <div id="sv-customize" style="${selectedClass?'':'opacity:0.4;pointer-events:none'}">
        <div style="font-size:10px;color:#6b7a9e;margin-bottom:6px">ÉTAPE 3 — PERSONNALISATION (laisser vide = standard)</div>
        <div class="editor-form" style="gap:5px">
          <div class="form-row"><label>Nom</label>
            <input class="form-input" id="sv-name" placeholder="${selectedClass ? (allClasses[selectedClass]?.name||'Custom') : ''}"></div>
          <div class="form-row"><label>Flotte</label>
            <select class="form-select" id="sv-fleet">
              <option value="">— Sélectionner —</option>
              ${this.state.fleets.map(f=>`<option value="${f.fleetId}">${f.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-row"><label>Type pilote</label>
            <select class="form-select" id="sv-pilot-type">
              <option value="">— Standard —</option>
              ${['clone','droid_integrated','droid_integrated_advanced','clone_commander','force_user',
                'imperial','rebel','bounty_hunter','pirate','militia'].map(p=>`<option value="${p}">${p}</option>`).join('')}
            </select>
          </div>
          <div class="form-row"><label>Niveau pilote</label>
            <input class="form-input" id="sv-pilot-lv" type="number" min="1" max="5" placeholder="Standard">
          </div>
          <div class="form-row"><label>Position X</label>
            <input class="form-input" id="sv-x" type="number" value="120" min="0" max="239">
          </div>
          <div class="form-row"><label>Position Y</label>
            <input class="form-input" id="sv-y" type="number" value="120" min="0" max="239">
          </div>
          <div class="form-row"><label>Altitude</label>
            <input class="form-input" id="sv-z" type="number" value="3" min="1" max="5">
          </div>
          <div class="form-row"><label>Personnage nommé</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11px">
              <input type="checkbox" id="sv-named"> Activer
              <span style="color:#6b7a9e">Performance:</span>
              <input class="form-input" id="sv-perf" type="number" min="1" max="20" value="10" style="width:45px">
            </label>
          </div>

          <!-- ── Technologies / équipement ── -->
          <div style="border-top:1px solid #1e2740;margin:6px 0 4px;font-size:10px;color:#4a9eff;letter-spacing:1px">ÉQUIPEMENT</div>
          <div class="form-row"><label>Scanner (cases)</label>
            <input class="form-input" id="sv-scanner" type="number" min="0" value="0" placeholder="0 = aucun" style="width:70px">
          </div>
          <div class="form-row"><label>Rayon tracteur (c)</label>
            <input class="form-input" id="sv-tractor" type="number" min="0" value="0" style="width:70px">
          </div>
          <div class="form-row"><label>Puits gravité (c)</label>
            <input class="form-input" id="sv-gravity" type="number" min="0" value="0" style="width:70px">
          </div>
          <div class="form-row"><label>Volume cale</label>
            <input class="form-input" id="sv-cargo-vol" type="number" min="0" value="0" placeholder="Défaut taille" style="width:70px">
          </div>
          <div class="form-row"><label style="color:#c8d8ff">Éjection cargo</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11px">
              <input type="checkbox" id="sv-cargo-eject">
              <span style="color:#6b7a9e;font-size:10px">Capacité d'éjection</span>
            </label>
          </div>
          <div class="form-row"><label>Cap. médicale</label>
            <input class="form-input" id="sv-medical" type="number" min="0" value="" placeholder="Défaut taille" style="width:70px">
          </div>
          <div class="form-row"><label>Cap. cellules</label>
            <input class="form-input" id="sv-brig" type="number" min="0" value="" placeholder="Défaut taille" style="width:70px">
          </div>

          <!-- ── Armes supplémentaires (surcharge la liste par défaut) ── -->
          <div id="sv-weapons-section" style="border-top:1px solid #1e2740;margin:6px 0 4px">
            <div style="font-size:10px;color:#4a9eff;letter-spacing:1px;margin-bottom:4px">ARMES (surcharge si renseigné)</div>
            <div id="sv-weapon-rows" style="max-height:140px;overflow-y:auto;font-size:10px">
              <!-- Ligne vide par défaut -->
              <div class="sv-weapon-row" style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
                <select class="sv-w-type form-select" style="width:90px;font-size:10px">
                  <option value="">— type —</option>
                  <option value="laser">Laser</option>
                  <option value="ion">Ion</option>
                  <option value="torpedo">Torpille</option>
                  <option value="missile">Missile</option>
                  <option value="bomb">Bombe</option>
                </select>
                <select class="sv-w-size form-select" style="width:65px;font-size:10px">
                  <option value="light">Léger</option>
                  <option value="medium">Moyen</option>
                  <option value="heavy">Lourd</option>
                  <option value="capital">Capital</option>
                </select>
                <input class="sv-w-dmg form-input" type="number" min="1" placeholder="Dmg" style="width:44px;font-size:10px">
                <input class="sv-w-rng form-input" type="number" min="1" placeholder="Rg" style="width:36px;font-size:10px">
                <input class="sv-w-cnt form-input" type="number" min="1" max="100" value="1" placeholder="×n" style="width:36px;font-size:10px">
                <button class="sv-w-del btn btn-small" style="font-size:9px;padding:0 4px;border-color:#aa4444;color:#ff9090">✕</button>
              </div>
            </div>
            <button id="sv-weapon-add" class="btn btn-small" style="font-size:10px;margin-top:2px;border-color:#3a8a44;color:#9dffb0">+ Arme</button>
          </div>
        </div>
        <div class="form-actions" style="margin-top:8px">
          <button id="sv-add" class="btn btn-primary">➕ Ajouter coords</button>
          <button id="sv-place-map" class="btn" style="background:#1a3a2a;border-color:#3ddc84;color:#3ddc84">🖱 Placer sur carte</button>
        </div>
      </div>

      <hr style="border-color:#2a3550;margin:12px 0">
      <div style="font-size:11px;color:#6b7a9e;margin-bottom:4px">📚 Bibliothèque de vaisseaux (${this.shipLib.length})</div>
      <div style="max-height:160px;overflow-y:auto;font-size:11px;margin-bottom:6px">
        ${this.shipLib.map(s => `
          <div style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-bottom:1px solid #1e2740">
            <span style="flex:1;color:#c8d8ff">${s.name}</span>
            <span style="color:#6b7a9e;font-size:9px">${s.classId}</span>
            <button class="btn btn-small" data-deploy-lib="${s.id}" style="font-size:9px;padding:1px 5px;background:#1a3a2a;border-color:#3ddc84;color:#3ddc84">🚀 Déployer</button>
            <button class="btn btn-small" data-del-lib="${s.id}" style="font-size:9px;padding:1px 4px;background:#2a1a1a;border-color:#ff4a4a;color:#ff4a4a">✕</button>
          </div>`).join('') || '<div style="color:#6b7a9e;padding:6px">Aucun vaisseau en bibliothèque.</div>'}
      </div>
    `;

    // Type selection
    el.querySelectorAll('.sv-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._svType  = btn.dataset.type;
        this._svClass = '';
        this._renderShipsTab();
      });
    });

    // Class selection
    el.querySelectorAll('.sv-class-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._svClass = btn.dataset.classid;
        this._renderShipsTab();
      });
    });

    document.getElementById('sv-add')?.addEventListener('click', () => this._addShipToGame());
    document.getElementById('sv-weapon-add')?.addEventListener('click', () => {
      const container = document.getElementById('sv-weapon-rows');
      if (!container) return;
      const row = document.createElement('div');
      row.className = 'sv-weapon-row';
      row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:3px';
      row.innerHTML = `
        <select class="sv-w-type form-select" style="width:90px;font-size:10px">
          <option value="">— type —</option>
          <option value="laser">Laser</option><option value="ion">Ion</option>
          <option value="torpedo">Torpille</option><option value="missile">Missile</option>
          <option value="bomb">Bombe</option>
        </select>
        <select class="sv-w-size form-select" style="width:65px;font-size:10px">
          <option value="light">Léger</option><option value="medium" selected>Moyen</option>
          <option value="heavy">Lourd</option><option value="capital">Capital</option>
        </select>
        <input class="sv-w-dmg form-input" type="number" min="1" placeholder="Dmg" style="width:44px;font-size:10px">
        <input class="sv-w-rng form-input" type="number" min="1" placeholder="Rg" style="width:36px;font-size:10px">
        <input class="sv-w-cnt form-input" type="number" min="1" max="100" value="1" placeholder="×n" style="width:36px;font-size:10px">
        <button class="sv-w-del btn btn-small" style="font-size:9px;padding:0 4px;border-color:#aa4444;color:#ff9090">✕</button>`;
      row.querySelector('.sv-w-del').onclick = () => row.remove();
      container.appendChild(row);
    });
    document.getElementById('sv-weapon-rows')?.addEventListener('click', e => {
      if (e.target.classList.contains('sv-w-del')) e.target.closest('.sv-weapon-row')?.remove();
    });
    document.getElementById('sv-place-map')?.addEventListener('click', () => {
      const cls = allClasses[this._svClass];
      const fleetId = document.getElementById('sv-fleet')?.value;
      const z       = parseInt(document.getElementById('sv-z')?.value) || 3;
      if (!this._svClass || this._svClass === '__custom') return alert('Sélectionner une classe.');
      if (!fleetId) return alert('Sélectionner une flotte.');
      window.dispatchEvent(new CustomEvent('gm:placeShip', {
        detail: { classId: this._svClass, name: document.getElementById('sv-name')?.value || cls?.name, fleetId, z }
      }));
      this.close();
    });

    // Library deploy/delete
    el.querySelectorAll('[data-deploy-lib]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ship = this.shipLib.find(s => s.id === btn.dataset.deployLib);
        if (!ship) return;
        const fleetId = this.state.fleets[0]?.fleetId;
        window.dispatchEvent(new CustomEvent('gm:placeShip', {
          detail: { classId: ship.classId, name: ship.name, fleetId, z: 3, template: ship }
        }));
        this.close();
      });
    });

    el.querySelectorAll('[data-del-lib]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.shipLib = this.shipLib.filter(s => s.id !== btn.dataset.delLib);
        saveShipLibrary(this.shipLib);
        this._renderShipsTab();
      });
    });

    el.querySelectorAll('[data-remove-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ship = this.state.ships.find(s => s.id === btn.dataset.removeId);
        if (ship && confirm(`Supprimer ${ship.name}?`)) { ship.alive = false; this._renderShipsTab(); }
      });
    });
  }

  _addShipToGame() {
    const classId   = this._svClass;
    const name      = document.getElementById('sv-name')?.value.trim();
    const pilotType = document.getElementById('sv-pilot-type')?.value || null;
    const pilotLv   = parseInt(document.getElementById('sv-pilot-lv')?.value) || null;
    const isNamed   = document.getElementById('sv-named')?.checked;
    const perf      = parseInt(document.getElementById('sv-perf')?.value) || 10;

    // ── Équipement / technologies ──
    const scanner    = parseInt(document.getElementById('sv-scanner')?.value) || 0;
    const tractorB   = parseInt(document.getElementById('sv-tractor')?.value) || 0;
    const gravityW   = parseInt(document.getElementById('sv-gravity')?.value) || 0;
    const cargoVol   = parseInt(document.getElementById('sv-cargo-vol')?.value) || undefined;
    const cargoEject = document.getElementById('sv-cargo-eject')?.checked || false;
    const medCap     = parseInt(document.getElementById('sv-medical')?.value) || undefined;
    const brigCap    = parseInt(document.getElementById('sv-brig')?.value)    || undefined;

    // ── Armes supplémentaires (si au moins une est renseignée) ──
    const weaponRows = document.querySelectorAll('#sv-weapon-rows .sv-weapon-row');
    const extraWeapons = [];
    let wIdx = 0;
    weaponRows.forEach(row => {
      const wType = row.querySelector('.sv-w-type')?.value;
      const wSize = row.querySelector('.sv-w-size')?.value || 'medium';
      const wDmg  = parseFloat(row.querySelector('.sv-w-dmg')?.value);
      const wRng  = parseInt(row.querySelector('.sv-w-rng')?.value);
      const wCnt  = parseInt(row.querySelector('.sv-w-cnt')?.value) || 1;
      if (wType && wDmg > 0 && wRng > 0) {
        extraWeapons.push({ id:`sv_w${wIdx++}`, name:`${wSize} ${wType}`, type:wType, size:wSize,
          damage:wDmg, range:wRng, accuracy:0.72, cooldown:wType==='torpedo'?8:wType==='missile'?6:1,
          ammoUsage: (wType==='torpedo'||wType==='missile'||wType==='bomb')?1:0,
          count: wCnt, color: wType==='ion'?'#44aaff':wType==='laser'?'#ff4444':'#ff8800' });
      }
    });

    if (!classId || classId === '__custom') return alert('Sélectionner une classe.');
    const allClasses = { ...PRESET_CLASSES };
    this.shipClasses.forEach(c => { allClasses[c.classId] = c; });
    const cls = allClasses[classId];
    if (!cls) return alert('Classe introuvable.');

    const template = {
      id:       Date.now().toString(36) + Math.random().toString(36).slice(2,5),
      classId,
      name:     name || cls.name,
      pilotType: pilotType || cls.defaultPilotType,
      pilotLevel: pilotLv || cls.defaultPilotLevel || 1,
      namedCharacter: isNamed
        ? { enabled: true, name: name || cls.name, performance: perf, plotArmor: perf > 10, _savesMade: 0 }
        : { enabled: false },
      // Équipement supplémentaire (overrides des valeurs par défaut de la classe)
      ...(scanner   > 0        && { scanner }),
      ...(tractorB  > 0        && { tractorBeam: tractorB }),
      ...(gravityW  > 0        && { gravityWell: gravityW }),
      ...(cargoVol  != null    && { cargoVolume: cargoVol }),
      ...(cargoEject            && { cargoEject: true }),
      ...(medCap    != null    && { medicalCapacity: medCap }),
      ...(brigCap   != null    && { brigCapacity: brigCap }),
      ...(extraWeapons.length  && { extraWeapons }),
    };

    this.shipLib.push(template);
    saveShipLibrary(this.shipLib);

    // Confirm and show deploy option
    const deploy = confirm(`"${template.name}" sauvegardé en bibliothèque.\n\nDéployer sur le terrain maintenant ? (vous pourrez cliquer sur la carte pour le placer)`);
    if (deploy) {
      window.dispatchEvent(new CustomEvent('gm:placeShip', {
        detail: { classId, name: template.name, fleetId: document.getElementById('sv-fleet')?.value, z: parseInt(document.getElementById('sv-z')?.value)||3, template }
      }));
      this.close();
    } else {
      this._renderShipsTab(); // Refresh to show updated library
    }
  }

  // ═══════════════════════════════════════════════════════
  // TAB: FLEETS
  // ═══════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════
  // TAB: FLEETS  —  complet fleet editor with class browser
  // ═══════════════════════════════════════════════════════

  _renderFleetsTab() {
    const el  = document.getElementById('tab-fleets');
    const lib = this.fleetLib;

    el.innerHTML = `
      <div class="editor-layout">
        <div class="editor-list" id="flt-list">
          <div style="font-size:10px;color:#6b7a9e;padding:6px 8px;border-bottom:1px solid #1e2740">FLOTTES</div>
          ${lib.map(f => `
            <div class="editor-list-item ${f.id===this._selectedLibFleetId?'selected':''}"
                 data-lib-fleet="${f.id}" style="border-left:3px solid ${FLEET_COLORS[f.colorIndex%FLEET_COLORS.length]||'#aaa'}">
              <div style="font-weight:bold;font-size:12px">${f.name}</div>
              <div style="font-size:10px;color:#6b7a9e">${f.ships?.length||0} vaisseaux</div>
            </div>`).join('')}
          <div class="editor-list-item" id="flt-new" style="color:#3ddc84;border-left:3px solid #3ddc84">
            ➕ Nouvelle flotte
          </div>
        </div>
        <div id="flt-form">
          <p style="color:#6b7a9e;font-size:12px;padding:12px">
            Sélectionner ou créer une flotte.
          </p>
        </div>
      </div>`;

    el.querySelectorAll('[data-lib-fleet]').forEach(item =>
      item.addEventListener('click', () => {
        this._selectedLibFleetId = item.dataset.libFleet;
        this._renderFleetForm(lib.find(f => f.id === item.dataset.libFleet));
      })
    );
    document.getElementById('flt-new')?.addEventListener('click', () => {
      this._selectedLibFleetId = null;
      this._renderFleetForm(null);
    });
  }

  _renderFleetForm(fleet) {
    const c = document.getElementById('flt-form');
    if (!c) return;

    const colors = FLEET_COLORS.map((col, i) => `
      <span data-ci="${i}" title="Couleur ${i+1}"
        style="display:inline-block;width:16px;height:16px;background:${col};border-radius:50%;
               cursor:pointer;margin:2px;border:2px solid ${fleet?.colorIndex===i?'white':'transparent'};
               vertical-align:middle"></span>`).join('');

    c.innerHTML = `
      <div style="padding:10px;height:100%;display:flex;flex-direction:column;overflow:hidden">
        <h3 style="font-size:13px;margin:0 0 8px">${fleet?`✏️ ${fleet.name}`:'➕ Nouvelle Flotte'}</h3>

        <div class="editor-form" style="gap:5px;margin-bottom:8px">
          <div class="form-row"><label>Nom</label>
            <input class="form-input" id="ff-name" value="${fleet?.name||''}">
          </div>
          <div class="form-row"><label>Couleur par défaut</label>
            <div id="ff-colors">${colors}</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <div style="font-size:11px;color:#6b7a9e">${fleet?.ships?.length||0} vaisseau(x)</div>
          <button id="ff-add-ship" class="btn btn-small" style="background:#1a3a2a;border-color:#3ddc84;color:#3ddc84;font-size:10px">
            ➕ Ajouter vaisseau
          </button>
        </div>

        <!-- Ship list -->
        <div id="ff-ship-list" style="flex:1;overflow-y:auto;min-height:80px;border:1px solid #1e2740;border-radius:3px;padding:4px">
          ${(fleet?.ships||[]).map((s,i) => {
            const status = s._postBattleStatus;
            const hpInfo = s._postBattleHp != null
              ? ` <span style="font-size:9px;color:${status==='destroyed'?'#ff4444':status==='escaped'?'#aa66ff':'#3ddc84'}">${
                  status==='destroyed'?'💀':status==='escaped'?'🌀':'✅'} ${Math.round(s._postBattleHp)}/${s._postBattleMaxHp||'?'} HP</span>`
              : '';
            return `
            <div style="display:flex;align-items:center;gap:4px;padding:3px 4px;border-bottom:1px solid #1e2740;font-size:11px;${status==='destroyed'?'opacity:0.5':''}">
              <span style="flex:1;color:#c8d8ff">${s.qty>1?s.qty+'×  ':''}<b>${s.name||s.classId}</b>${hpInfo}</span>
              <span style="color:#6b7a9e;font-size:9px">${s.classId}</span>
              <button data-edit-ship="${i}" class="btn btn-small" style="font-size:9px;padding:1px 4px">✏</button>
              <button data-rm-ship="${i}"   class="btn btn-small" style="font-size:9px;padding:1px 4px;background:#2a1a1a;border-color:#ff4a4a;color:#ff4a4a">✕</button>
            </div>`; }).join('')||'<div style="color:#6b7a9e;font-size:11px;padding:6px">Aucun vaisseau.</div>'}
        </div>

        <!-- Ship selector (hidden until "Add") -->
        <div id="ff-ship-picker" style="display:none;margin-top:8px;border:1px solid #2a3550;border-radius:4px;padding:8px;background:#0a0e1a;overflow-y:auto;max-height:340px">
        </div>

        <div class="form-actions" style="margin-top:8px;gap:6px;flex-wrap:wrap">
          <button id="ff-save" class="btn btn-primary" style="flex:1">💾 Sauvegarder</button>
          ${fleet ? (fleet.deployed
            ? `<button id="ff-recall" class="btn" style="background:#2a1a0a;border-color:#ffaa44;color:#ffaa44;flex:1" title="Flotte déployée — rappeler pour permettre un nouveau déploiement">🔄 Rappeler</button>`
            : `<button id="ff-deploy" class="btn" style="background:#1a3a2a;border-color:#3ddc84;color:#3ddc84;flex:1">🚀 Déployer</button>`)
          : ''}
          ${fleet?`<button id="ff-del" class="btn" style="background:#2a1a1a;border-color:#ff4a4a;color:#ff4a4a">🗑</button>`:''}
        </div>
      </div>`;

    let selColor = fleet?.colorIndex ?? 0;
    c.querySelectorAll('[data-ci]').forEach(s => {
      s.addEventListener('click', () => {
        c.querySelectorAll('[data-ci]').forEach(x => x.style.border='2px solid transparent');
        s.style.border = '2px solid white'; selColor = parseInt(s.dataset.ci);
      });
    });

    document.getElementById('ff-add-ship')?.addEventListener('click', () => {
      const picker = document.getElementById('ff-ship-picker');
      // Auto-create fleet if not saved yet
      let currentFleet = fleet;
      if (!currentFleet) {
        const name = document.getElementById('ff-name')?.value.trim();
        if (!name) { alert('Entrer un nom pour la flotte avant d\'ajouter des vaisseaux.'); return; }
        currentFleet = { id: Date.now().toString(36), name, colorIndex: selColor, ships: [] };
        this.fleetLib.push(currentFleet);
        this._selectedLibFleetId = currentFleet.id;
        saveFleetLibrary(this.fleetLib);
        // Refresh left list without losing the form
        document.querySelectorAll('[data-lib-fleet]').forEach(el => el.classList.remove('selected'));
      }

      if (picker.style.display === 'none') {
        this._renderShipPicker(picker, (shipSpec) => {
          currentFleet.ships = currentFleet.ships || [];
          currentFleet.ships.push(shipSpec);
          saveFleetLibrary(this.fleetLib);
          this._renderFleetForm(currentFleet);
        });
        picker.style.display = 'block';
        picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        picker.style.display = 'none';
      }
    });

    c.querySelectorAll('[data-rm-ship]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!fleet) return;
        fleet.ships.splice(parseInt(btn.dataset.rmShip), 1);
        saveFleetLibrary(this.fleetLib);
        this._renderFleetForm(fleet);
      });
    });

    c.querySelectorAll('[data-edit-ship]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.editShip);
        const picker = document.getElementById('ff-ship-picker');
        this._renderShipPicker(picker, (updated) => {
          if (!fleet) return;
          fleet.ships[i] = updated;
          saveFleetLibrary(this.fleetLib);
          this._renderFleetForm(fleet);
        }, fleet.ships[i]);
        picker.style.display = 'block';
      });
    });

    document.getElementById('ff-save')?.addEventListener('click', () => {
      const name = document.getElementById('ff-name')?.value.trim();
      if (!name) return alert('Nom requis.');
      if (fleet) { fleet.name = name; fleet.colorIndex = selColor; }
      else {
        const nf = { id: Date.now().toString(36), name, colorIndex: selColor, ships: [] };
        this.fleetLib.push(nf);
        this._selectedLibFleetId = nf.id;
        this.fleetLib.find(f => f.id === nf.id) || this.fleetLib.push(nf);
      }
      saveFleetLibrary(this.fleetLib);
      this._renderFleetsTab();
    });

    document.getElementById('ff-deploy')?.addEventListener('click', () => {
      if (!fleet?.ships?.length) return alert('La flotte est vide.');
      if (fleet.deployed) return alert('Cette flotte est déjà déployée. Rappellez-la d\'abord.');
      fleet.deployed = true;
      saveFleetLibrary(this.fleetLib);
      this.callbacks.onDeployFleet?.(fleet, selColor);
      this.close();
    });

    // Recall deployed fleet (allows re-deployment, saves post-battle state)
    document.getElementById('ff-recall')?.addEventListener('click', () => {
      if (!fleet) return;
      const save = confirm(`Rappeler "${fleet.name}" ?\n\nSauvegarder l'état post-bataille des vaisseaux (HP, détruits, échappés) dans la définition de flotte ?`);
      if (save) {
        // Find ships from GameState that belong to this fleet (by matching names)
        const liveFleet = window.GameState?.fleets?.find(f => f.name === fleet.name);
        if (liveFleet) {
          const liveShips = window.GameState.ships.filter(s => s.fleetId === liveFleet.fleetId);
          // Update each ship template in fleet.ships with post-battle HP
          fleet.ships = fleet.ships.map((tmpl, i) => {
            const live = liveShips[i];
            if (!live) return tmpl;
            return {
              ...tmpl,
              _postBattleHp:       live.hp,
              _postBattleStatus:   live.destroyed ? 'destroyed' : live.escaped ? 'escaped' : 'alive',
              _postBattleMaxHp:    live.maxHp,
            };
          });
        }
      }
      fleet.deployed = false;
      saveFleetLibrary(this.fleetLib);
      this._renderFleetsTab();
      alert(`${fleet.name} rappelée.${save ? '\nÉtat de bataille sauvegardé.' : ''}`);
    });

    document.getElementById('ff-del')?.addEventListener('click', () => {
      if (fleet && confirm(`Supprimer "${fleet.name}" ?`)) {
        this.fleetLib = this.fleetLib.filter(f => f.id !== fleet.id);
        saveFleetLibrary(this.fleetLib);
        this._selectedLibFleetId = null;
        this._renderFleetsTab();
      }
    });
  }

  /**
   * Ship picker — full class browser with editable fields.
   * onAdd(spec) is called with the final ship specification.
   * If `editing` is provided, pre-fills the form with that spec.
   */
  _renderShipPicker(container, onAdd, editing = null) {
    const allClasses = { ...PRESET_CLASSES, ...Object.fromEntries(this.shipClasses.map(c => [c.classId, c])) };
    const types = [...new Set(Object.values(allClasses).map(c => c.type))].sort();
    const sizes = ['XS','S','M','L','XL','XXL'];

    let selectedClassId = editing?.classId || null;
    let filterType      = '';
    let filterSize      = '';
    let filterSearch    = '';
    let isCustom        = editing?.isCustom || false;

    const render = () => {
      const filtered = Object.values(allClasses).filter(c => {
        if (filterType   && c.type !== filterType) return false;
        if (filterSize   && c.size !== filterSize)  return false;
        if (filterSearch && !c.name.toLowerCase().includes(filterSearch.toLowerCase())) return false;
        return true;
      });
      const cls = selectedClassId ? allClasses[selectedClassId] : null;

      container.innerHTML = `
        <div style="font-size:11px;color:#4a9eff;margin-bottom:6px;font-weight:bold">Sélecteur de vaisseau</div>

        <!-- Filters -->
        <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
          <input id="sp-search" placeholder="Rechercher…" value="${filterSearch}"
            style="flex:2;min-width:80px;background:#070c14;border:1px solid #2a3550;color:#c8d8ff;padding:3px 6px;font-size:11px;border-radius:3px">
          <select id="sp-type" style="flex:1;min-width:70px;background:#070c14;border:1px solid #2a3550;color:#c8d8ff;padding:3px;font-size:10px;border-radius:3px">
            <option value="">Type</option>
            ${types.map(t => `<option value="${t}" ${t===filterType?'selected':''}>${t}</option>`).join('')}
          </select>
          <select id="sp-size" style="flex:1;min-width:50px;background:#070c14;border:1px solid #2a3550;color:#c8d8ff;padding:3px;font-size:10px;border-radius:3px">
            <option value="">Taille</option>
            ${sizes.map(s => `<option value="${s}" ${s===filterSize?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>

        <!-- Class grid -->
        <div style="display:flex;flex-wrap:wrap;gap:3px;max-height:120px;overflow-y:auto;margin-bottom:8px;padding:4px;background:#070c14;border:1px solid #1e2740;border-radius:3px">
          ${filtered.length === 0
            ? '<div style="color:#6b7a9e;font-size:11px;padding:4px">Aucun résultat.</div>'
            : filtered.map(c => `
            <div data-cls="${c.classId}"
              style="padding:3px 6px;border-radius:3px;font-size:10px;cursor:pointer;
                     background:${c.classId===selectedClassId?'#1e3a5f':'#0e1520'};
                     border:1px solid ${c.classId===selectedClassId?'#4a9eff':'#2a3550'};
                     color:${c.classId===selectedClassId?'#4a9eff':'#c8d8ff'};
                     white-space:nowrap">
              ${c.name.length>22?c.name.slice(0,20)+'…':c.name}
              <span style="color:#6b7a9e;font-size:8px">[${c.size}]</span>
            </div>`).join('')}
        </div>

        ${cls ? `
        <!-- Customization form -->
        <div style="border-top:1px solid #1e2740;padding-top:8px">
          <div style="font-size:10px;color:#3ddc84;margin-bottom:6px">
            ✅ ${cls.name} — ${cls.lengthM||'?'}m × ${cls.widthM||'?'}m | HP≈${Math.round(Math.pow((cls.lengthM||10)*(cls.widthM||10),0.4)*cls.hullArmor*12/10)*10}
          </div>
          <div class="editor-form" style="gap:4px">
            <div class="form-row"><label>Nom</label>
              <input id="sp-name" class="form-input" placeholder="${cls.name}" value="${editing?.name!==cls.name?editing?.name||'':''}">
            </div>
            <div class="form-row"><label>Quantité</label>
              <input id="sp-qty" class="form-input" type="number" min="1" max="100" value="${editing?.qty||1}" style="width:60px">
            </div>
            <div class="form-row"><label>Pilote</label>
              <select id="sp-pilot" class="form-select" style="font-size:11px">
                ${['','clone','droid_integrated','droid_integrated_advanced','clone_commander','force_user',
                   'imperial','rebel','bounty_hunter','pirate','smuggler','militia','civilian'].map(p =>
                  `<option value="${p}" ${(editing?.pilotType||cls.defaultPilotType||'')===(p)?'selected':''}>${p||'(standard)'}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-row"><label>Niveau</label>
              <input id="sp-level" class="form-input" type="number" min="1" max="5" value="${editing?.pilotLevel||cls.defaultPilotLevel||1}" style="width:50px">
            </div>
            ${cls.defaultInventory ? `
            <div class="form-row"><label>Torpilles</label>
              <input id="sp-torp" class="form-input" type="number" min="0" max="200" value="${editing?.inventory?.torpedoes ?? cls.defaultInventory?.torpedoes ?? 0}" style="width:60px">
            </div>
            <div class="form-row"><label>Missiles</label>
              <input id="sp-miss" class="form-input" type="number" min="0" max="200" value="${editing?.inventory?.missiles ?? cls.defaultInventory?.missiles ?? 0}" style="width:60px">
            </div>
            <div class="form-row"><label>Bombes</label>
              <input id="sp-bomb" class="form-input" type="number" min="0" max="200" value="${editing?.inventory?.bombs ?? cls.defaultInventory?.bombs ?? 0}" style="width:60px">
            </div>` : ''}
            <div class="form-row"><label>Personnage nommé</label>
              <label style="display:flex;align-items:center;gap:4px;font-size:11px">
                <input type="checkbox" id="sp-named" ${editing?.namedCharacter?.enabled?'checked':''}> Activer
                <span style="color:#6b7a9e">Perf:</span>
                <input id="sp-perf" type="number" min="1" max="20" value="${editing?.namedCharacter?.performance||10}" style="width:40px;background:#070c14;border:1px solid #2a3550;color:#c8d8ff;padding:1px 3px;border-radius:2px;font-size:11px">
              </label>
            </div>
            ${cls.defaultCarrier ? `
            <div style="border-top:1px solid #2a3550;margin:6px 0;padding-top:6px">
              <div style="color:#4fc3f7;font-size:11px;margin-bottom:4px">🛩 Contenu du hangar</div>
              <div style="color:#6b7a9e;font-size:9px;margin-bottom:4px">Un pirate qui vole un porteur n'aura pas forcément des TIE — choisir les escadrons embarqués.</div>
              <div id="sp-hangar-rows">
                ${(() => {
                  const cur = editing?.hangar || cls.defaultCarrier.reserves.map(r => ({ classId:r.classId, count:r.count }));
                  const fighterClasses = Object.entries(PRESET_CLASSES)
                    .filter(([id,k]) => ['fighter','bomber','interceptor'].includes(k.type) || ['XS','S'].includes(k.size))
                    .map(([id,k]) => ({ id, name:k.name }));
                  const maxSlots = cls.defaultCarrier.maxSlots || 8;
                  // 1 à 3 lignes de configuration
                  return [0,1,2].map(i => {
                    const slot = cur[i] || { classId:'', count:0 };
                    return `<div class="form-row" style="gap:4px">
                      <select id="sp-hangar-cls-${i}" class="form-input" style="flex:1;font-size:10px">
                        <option value="">— vide —</option>
                        ${fighterClasses.map(fc => `<option value="${fc.id}" ${slot.classId===fc.id?'selected':''}>${fc.name}</option>`).join('')}
                      </select>
                      <input id="sp-hangar-cnt-${i}" class="form-input" type="number" min="0" max="${maxSlots}" value="${slot.count||0}" style="width:50px;font-size:10px">
                    </div>`;
                  }).join('');
                })()}
              </div>
              <div style="color:#6b7a9e;font-size:9px">Capacité max : ${cls.defaultCarrier.maxSlots} appareils</div>
            </div>` : ''}
          </div>

          <!-- Custom ship toggle -->
          <label style="display:flex;align-items:center;gap:6px;margin:8px 0;font-size:11px;cursor:pointer">
            <input type="checkbox" id="sp-custom" ${isCustom?'checked':''}>
            <span style="color:#ffdd00">☆ Vaisseau personnalisé</span>
            <span style="color:#6b7a9e;font-size:9px">(modifier armement, boucliers, stats)</span>
          </label>

          ${isCustom ? `
          <div style="background:#0e1520;border:1px solid #2a3550;border-radius:3px;padding:8px;font-size:11px">
            <div style="color:#ffdd00;margin-bottom:6px">Stats personnalisées</div>
            <div class="editor-form" style="gap:4px">
              <div class="form-row"><label>PV max</label>
                <input id="sp-hp" class="form-input" type="number" value="${editing?.maxHp||Math.round(Math.pow((cls.lengthM||10)*(cls.widthM||10),0.4)*cls.hullArmor*12/10)*10}" style="width:70px">
              </div>
              <div class="form-row"><label>Boucliers</label>
                <input id="sp-shields" class="form-input" type="number" value="${editing?.shieldsMax||cls.defaultShields?.max||0}" style="width:70px">
              </div>
              <div class="form-row"><label>Vitesse</label>
                <input id="sp-speed" class="form-input" type="number" step="0.1" value="${editing?.speed||2.0}" style="width:70px">
              </div>
              <div class="form-row"><label>Vision</label>
                <input id="sp-vision" class="form-input" type="number" value="${editing?.visionRange||20}" style="width:70px">
              </div>
            </div>
            <div style="color:#6b7a9e;font-size:9px;margin-top:4px">Pour modifier l'armement, utiliser l'Éditeur MJ → Onglet Classes.</div>
          </div>` : ''}

          <button id="sp-confirm" class="btn btn-primary" style="margin-top:8px;width:100%">
            ${editing ? '✓ Mettre à jour' : '➕ Ajouter à la flotte'}
          </button>
        </div>` : '<div style="font-size:11px;color:#6b7a9e;padding:6px">Cliquer sur un vaisseau ci-dessus pour le configurer.</div>'}
      `;

      // Bind filters
      document.getElementById('sp-search')?.addEventListener('input', e => { filterSearch = e.target.value; render(); });
      document.getElementById('sp-type')?.addEventListener('change', e => { filterType = e.target.value; render(); });
      document.getElementById('sp-size')?.addEventListener('change', e => { filterSize = e.target.value; render(); });

      // Bind class selection
      container.querySelectorAll('[data-cls]').forEach(div => {
        div.addEventListener('click', () => { selectedClassId = div.dataset.cls; isCustom = false; render(); });
      });

      // Custom toggle
      document.getElementById('sp-custom')?.addEventListener('change', e => { isCustom = e.target.checked; render(); });

      // Confirm
      document.getElementById('sp-confirm')?.addEventListener('click', () => {
        if (!selectedClassId) return;
        const spec = {
          classId:    selectedClassId,
          name:       document.getElementById('sp-name')?.value.trim() || cls.name,
          qty:        parseInt(document.getElementById('sp-qty')?.value) || 1,
          pilotType:  document.getElementById('sp-pilot')?.value || null,
          pilotLevel: parseInt(document.getElementById('sp-level')?.value) || cls.defaultPilotLevel || 1,
          isCustom,
          // Cargo / munitions
          inventory: {
            torpedoes: parseInt(document.getElementById('sp-torp')?.value) || 0,
            missiles:  parseInt(document.getElementById('sp-miss')?.value) || 0,
            bombs:     parseInt(document.getElementById('sp-bomb')?.value) || 0,
          },
        };
        // Configuration du hangar (si la classe est un porteur)
        if (cls.defaultCarrier) {
          const hangar = [];
          [0,1,2].forEach(i => {
            const cid = document.getElementById(`sp-hangar-cls-${i}`)?.value;
            const cnt = parseInt(document.getElementById(`sp-hangar-cnt-${i}`)?.value) || 0;
            if (cid && cnt > 0) hangar.push({ classId: cid, count: cnt });
          });
          if (hangar.length) spec.hangar = hangar;
        }
        if (document.getElementById('sp-named')?.checked) {
          spec.namedCharacter = {
            enabled:     true,
            name:        spec.name,
            performance: parseInt(document.getElementById('sp-perf')?.value) || 10,
            plotArmor:   true,
            _savesMade:  0,
          };
        }
        if (isCustom) {
          spec.maxHp      = parseInt(document.getElementById('sp-hp')?.value);
          spec.shieldsMax = parseInt(document.getElementById('sp-shields')?.value);
          spec.speed      = parseFloat(document.getElementById('sp-speed')?.value);
          spec.visionRange = parseInt(document.getElementById('sp-vision')?.value);
        }
        onAdd(spec);
        container.style.display = 'none';
      });
    };

    render();
  }


  // ═══════════════════════════════════════════════════════
  // TAB: SCENARIOS
  // ═══════════════════════════════════════════════════════

  _renderScenariosTab() {
    const el = document.getElementById('tab-scenarios');
    if (!el) return;

    // Terrain presets — imported via a local copy to avoid async import
    const TERRAINS = [
      { id:'open',     icon:'🌌', name:'Espace standard',        desc:'Aucun effet particulier.',                          effect: null },
      { id:'asteroid', icon:'☄️', name:"Champ d'astéroïdes",     desc:'Précision -15 %, risque de collision.',             effect:{ type:'asteroid_field', accuracyMod:-0.15, movePenalty:0.15 } },
      { id:'nebula',   icon:'🌫', name:'Nébuleuse',               desc:'Vision -40 %, capteurs perturbés.',                 effect:{ type:'nebula', visionMod:-0.40, sensorBlock:true } },
      { id:'gravity',  icon:'⚫', name:'Masse gravitationnelle',  desc:'Trou noir : attraction permanente vers le centre.',  effect:{ type:'black_hole', pullStrength:0.8 } },
      { id:'debris',   icon:'💥', name:'Champ de débris',         desc:'Couvert tactique, vitesse -20 %.',                  effect:{ type:'debris', coverBonus:0.20, movePenalty:0.20 } },
      { id:'ice',      icon:'❄', name:'Champ de glace',          desc:'Fragments inévitables — dégâts proportionnels à la vitesse.', effect:{ type:'ice_field' } },
    ];

    // Saved terrain scenarios
    const saved = (() => { try { return JSON.parse(localStorage.getItem('sts:terrainScenarios')||'[]'); } catch { return []; } })();
    const cur   = this._terrainId || 'open';
    const curName = this._terrainScenarioName || '';

    el.innerHTML = `
      <div style="padding:10px;overflow-y:auto;height:100%">

        <!-- Saved terrain scenarios -->
        <div style="margin-bottom:12px">
          <h3 style="font-size:12px;color:#6b7a9e;margin-bottom:6px">📂 Scénarios de terrain sauvegardés</h3>
          ${saved.length === 0
            ? '<div style="color:#6b7a9e;font-size:11px;font-style:italic">Aucun scénario sauvegardé.</div>'
            : saved.map(s => `
              <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#0e1520;border:1px solid #2a3550;border-radius:3px;margin-bottom:4px;font-size:11px">
                <span>${TERRAINS.find(t=>t.id===s.terrainId)?.icon||'🌌'}</span>
                <span style="flex:1;color:#c8d8ff">${s.name}</span>
                <span style="color:#6b7a9e;font-size:9px">${s.terrainId}</span>
                <button data-load-terrain="${s.id}" class="btn btn-small" style="font-size:9px;padding:1px 5px">▶ Charger</button>
                <button data-del-terrain="${s.id}"  class="btn btn-small" style="font-size:9px;padding:1px 4px;background:#2a1a1a;border-color:#ff4a4a;color:#ff4a4a">✕</button>
              </div>`).join('')}
        </div>

        <hr style="border-color:#1e2740;margin-bottom:12px">

        <!-- Terrain picker -->
        <h3 style="font-size:12px;color:#6b7a9e;margin-bottom:8px">🌍 Choisir un terrain</h3>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
          ${TERRAINS.map(t => `
            <div class="terrain-opt" data-terrain-id="${t.id}"
              style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                     border:1px solid ${t.id===cur?'#4a9eff':'#1e2740'};
                     background:${t.id===cur?'#0a1628':'#080d18'};
                     border-radius:4px;cursor:pointer">
              <span style="font-size:18px">${t.icon}</span>
              <div>
                <div style="font-size:12px;color:${t.id===cur?'#4a9eff':'#c8d8ff'};font-weight:bold">${t.name}</div>
                <div style="font-size:10px;color:#6b7a9e">${t.desc}</div>
              </div>
              ${t.id===cur?'<span style="margin-left:auto;color:#4a9eff;font-size:12px">✓</span>':''}
            </div>`).join('')}
        </div>

        <!-- Save form -->
        <div style="border-top:1px solid #1e2740;padding-top:10px">
          <h3 style="font-size:12px;color:#6b7a9e;margin-bottom:6px">💾 Sauvegarder ce terrain</h3>
          <div class="form-row" style="margin-bottom:8px"><label>Nom</label>
            <input id="sc-save-name" class="form-input" placeholder="Ex. Bataille de Geonosis" value="${curName}">
          </div>
          <div style="display:flex;gap:6px">
            <button id="sc-save-btn" class="btn btn-primary" style="flex:1">💾 Sauvegarder</button>
            <button id="sc-apply-btn" class="btn" style="flex:1;background:#1a3a2a;border-color:#3ddc84;color:#3ddc84">✅ Appliquer à la partie</button>
          </div>
        </div>
      </div>
    `;

    // Terrain selection
    el.querySelectorAll('.terrain-opt').forEach(div => {
      div.addEventListener('click', () => {
        this._terrainId = div.dataset.terrainId;
        this._renderScenariosTab();
      });
    });

    // Save
    document.getElementById('sc-save-btn')?.addEventListener('click', () => {
      const name = document.getElementById('sc-save-name')?.value.trim();
      if (!name) return alert('Entrer un nom.');
      const entry = { id: Date.now().toString(36), name, terrainId: this._terrainId || 'open' };
      saved.push(entry);
      try { localStorage.setItem('sts:terrainScenarios', JSON.stringify(saved)); } catch {}
      this._terrainScenarioName = name;
      this._renderScenariosTab();
    });

    // Apply to current game
    document.getElementById('sc-apply-btn')?.addEventListener('click', () => {
      const terrain = TERRAINS.find(t => t.id === (this._terrainId||'open'));
      if (this.state) this.state.terrain = terrain?.effect || null;
      window.dispatchEvent(new CustomEvent('game:terrainChanged', { detail: terrain }));
      alert(`Terrain "${terrain?.name}" appliqué à la partie en cours.`);
    });

    // Load saved
    el.querySelectorAll('[data-load-terrain]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = saved.find(x => x.id === btn.dataset.loadTerrain);
        if (s) { this._terrainId = s.terrainId; this._terrainScenarioName = s.name; this._renderScenariosTab(); }
      });
    });

    // Delete saved
    el.querySelectorAll('[data-del-terrain]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = saved.findIndex(x => x.id === btn.dataset.delTerrain);
        if (idx >= 0) {
          saved.splice(idx, 1);
          try { localStorage.setItem('sts:terrainScenarios', JSON.stringify(saved)); } catch {}
          this._renderScenariosTab();
        }
      });
    });
  }


}
