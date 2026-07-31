/**
 * UI — User interface manager
 *
 * Responsibilities:
 *   - Update the left panel (selected ship info)
 *   - Update the right panel (fleets, event log)
 *   - Handle order buttons (move, attack, escort…)
 *   - Modal interactions (tabs, altitude filter)
 *
 * Principle: the UI reads state but does NOT modify it directly.
 * It calls callbacks (onOrder*, onBehaviorChange) provided by app.js.
 */

import { pct, fmt, TYPE_LABELS, FLEET_COLORS, CARGO_ENERGY_SIGNATURE, CARGO_IS_ORGANIC, SIGNATURE_LABELS } from './utils.js?v=20250617c';
import { PRESET_CLASSES } from './presets.js?v=20250617c';
import { COMBAT_POLICIES } from './combat_policy.js?v=20250617c';
import { CARGO_TYPES } from './models.js?v=20250617c';
import { TROOP_TYPES } from './boarding.js';

// getAvailablePolicies is loaded after first use (avoids blocking startup)
let getAvailablePolicies = (ship) => {
  // Default: all policies available (safe fallback)
  return new Set(Object.keys(COMBAT_POLICIES));
};
import('./combat_policy.js?v=20250617c').then(mod => {
  if (mod.getAvailablePolicies) getAvailablePolicies = mod.getAvailablePolicies;
}).catch(() => {});

export class UIManager {
  /**
   * @param {GameState} state
   * @param {object}    callbacks - { onOrderMove, onOrderAttack, onOrderEscort, onOrderRetreat,
   *                                  onBehaviorChange, onAltitudeChange, onShipSelect }
   */
  constructor(state, callbacks = {}) {
    this.state     = state;
    this.callbacks = callbacks;

    // ─── DOM references ───────────────────────
    this.$noSel    = document.getElementById('no-selection');
    this.$panel    = document.getElementById('ship-panel');
    this.$fleetList= document.getElementById('fleet-list');
    this.$logEntries=document.getElementById('log-entries');

    // HP / shield bars
    this.$hpBar     = document.getElementById('hp-bar');
    this.$hpText    = document.getElementById('hp-text');
    this.$shieldBar = document.getElementById('shield-bar');
    this.$shieldText= document.getElementById('shield-text');

    // Info fields
    this.$shipName    = document.getElementById('ship-name');
    this.$shipClass   = document.getElementById('ship-class');
    this.$shipType    = document.getElementById('ship-type');
    this.$shipSize    = document.getElementById('ship-size');
    this.$shipMass    = document.getElementById('ship-mass');
    this.$shipArmor   = document.getElementById('ship-armor');
    this.$shipPos     = document.getElementById('ship-pos');
    this.$shipAlt     = document.getElementById('ship-altitude');
    this.$shipSpeed   = document.getElementById('ship-speed');
    this.$weaponsList = document.getElementById('ship-weapons-list');
    this.$invList     = document.getElementById('ship-inventory-list');
    this.$behaviorSel = document.getElementById('behavior-select');
    this.$behaviorTargetRow  = document.getElementById('behavior-target-row');
    this.$behaviorTargetInput= document.getElementById('behavior-target-input');

    // Orders
    this.$orderHint = document.getElementById('order-hint');

    // State tracking
    this.pendingOrder  = null;  // 'move' | 'attack' | 'escort'
    this.selectedShipId= null;

    this._bindEvents();
  }

  // ═══════════════════════════════════════════════════════
  // UPDATE SHIP PANEL
  // ═══════════════════════════════════════════════════════

  /** Called by app.js each frame or tick */
  updateSelectedShip(shipId) {
    this.selectedShipId = shipId;
    const ship = shipId ? this.state.ships.find(s => s.id === shipId && s.alive) : null;

    if (!ship) {
      this.$noSel.classList.remove('hidden');
      this.$panel.classList.add('hidden');
      // Réafficher le placeholder de l'onglet Économie
      const ph = document.getElementById('sp-eco-placeholder');
      if (ph) ph.style.display = '';
      return;
    }

    this.$noSel.classList.add('hidden');
    this.$panel.classList.remove('hidden');

    // ═══ Lecture seule pour les vaisseaux d'autres factions ═══
    // Le joueur peut INSPECTER tous les vaisseaux mais ne commander que les siens.
    // (Le host re-valide chaque ordre de toute façon — ceci est l'UX.)
    const playerCi = window._p2pFactionCi ?? -1;
    let readOnly = false;
    if (playerCi >= 0) {
      const fl = this.state.fleets.find(f => f.fleetId === ship.fleetId);
      const shipCi = fl?.colorIndex ?? ship._factionColorIndex;
      readOnly = (shipCi !== playerCi);
    }
    // Masquer/afficher tous les contrôles interactifs du panneau
    this.$panel.querySelectorAll('button, select, input').forEach(el => {
      // Le bouton de fermeture du panneau reste toujours actif
      if (el.id === 'close-ship-panel' || el.classList.contains('btn-close')) return;
      el.style.display = readOnly ? 'none' : '';
    });
    // Bandeau d'information en mode lecture seule
    let roBanner = document.getElementById('ship-readonly-banner');
    if (readOnly) {
      if (!roBanner) {
        roBanner = document.createElement('div');
        roBanner.id = 'ship-readonly-banner';
        roBanner.style.cssText = 'background:#1a0f0a;border:1px solid #aa6633;color:#cc9966;font-size:10px;padding:4px 8px;border-radius:4px;margin:4px 0;text-align:center';
        roBanner.textContent = '🔒 Vaisseau adverse — observation seule';
        this.$shipName?.parentElement?.after(roBanner);
      }
      roBanner.style.display = '';
    } else if (roBanner) {
      roBanner.style.display = 'none';
    }

    // ─── Basic info ───────────────────────────
    this.$shipName.textContent  = ship.name;
    // Class = the ship's real name (ARC-170, Venator, Y-Wing…)
    // Look up in presets first, then custom classes, fallback to classId
    const customClasses = JSON.parse(localStorage.getItem('sts:shipClasses') || '[]');
    const classObj = PRESET_CLASSES[ship.classId] || customClasses.find(c => c.classId === ship.classId);
    this.$shipClass.textContent = classObj?.name || ship.classId || '—';
    // Type = the role category (Cruiser, Gunship, Bomber…)
    this.$shipType.textContent  = TYPE_LABELS[ship.type] || ship.type;
    this.$shipSize.textContent  = ship.size;
    this.$shipMass.textContent  = fmt(ship.mass);
    this.$shipArmor.textContent = `${ship.hullArmor} (−${(ship.hullArmor - 1) * 10}% dmg)`;
    this.$shipPos.textContent   = `(${ship.position.x.toFixed(1)}, ${ship.position.y.toFixed(1)})`;
    this.$shipAlt.textContent   = `z${Math.round(ship.position.z)}`;
    this.$shipSpeed.textContent = fmt(ship.speed);

    // ─── HP bar ───────────────────────────────
    const hpPct = pct(ship.hp, ship.maxHp);
    this.$hpBar.style.width   = hpPct + '%';
    this.$hpBar.style.background = hpPct > 50 ? '#3ddc84' : hpPct > 25 ? '#ffa726' : '#ff4a4a';
    if (readOnly) {
      // Scan long récent (moins de 10 ticks) → PV exacts connus
      const currentTick = this.state?.tick ?? 0;
      const scanAge = currentTick - (ship._scanLongTick ?? -999);
      if (ship._scanHpExact != null && scanAge <= 10) {
        this.$hpText.textContent = `${Math.round(ship._scanHpExact)} / ${ship.maxHp} ⟨scan ${scanAge}t⟩`;
      } else {
        // Sans scan récent : 6 tiers (plus granulaire que 3)
        const tier =
          hpPct > 83 ? '██████ Intègre'     :
          hpPct > 66 ? '█████▱ Bonne forme' :
          hpPct > 50 ? '████▱▱ Endommagé'   :
          hpPct > 33 ? '███▱▱▱ Sérieux'     :
          hpPct > 16 ? '██▱▱▱▱ Critique'    :
          hpPct > 0  ? '█▱▱▱▱▱ Agonisant'   :
                       '▱▱▱▱▱▱ Hors combat';
        this.$hpText.textContent = tier;
      }
    } else {
      this.$hpText.textContent = `${Math.round(ship.hp)} / ${ship.maxHp}`;
    }

    // ─── Shield bar ───────────────────────────
    const sh     = ship.shields;
    const shPct  = sh.max > 0 ? pct(sh.current, sh.max) : 0;
    this.$shieldBar.style.width = shPct + '%';
    if (readOnly) {
      const shTier =
        sh.max <= 0    ? 'Aucun bouclier'     :
        sh.disabled    ? '⚠ Bouclier hors ligne' :
        shPct > 83     ? '██████ Plein'        :
        shPct > 66     ? '█████▱ Fort'         :
        shPct > 50     ? '████▱▱ Bon'          :
        shPct > 33     ? '███▱▱▱ Faible'       :
        shPct > 16     ? '██▱▱▱▱ Presque tombé':
        shPct > 0      ? '█▱▱▱▱▱ Quasi tombé'  :
                         '▱▱▱▱▱▱ Tombé';
      this.$shieldText.textContent = shTier;
    } else {
      this.$shieldText.textContent = sh.max > 0
        ? (sh.disabled ? `⚠ Offline (restart in ${sh.restartDelay - sh.restartCounter} ticks)` : `${Math.round(sh.current)} / ${sh.max}`)
        : 'None';
    }

    // ─── Ion stacks ───────────────────────────
    if (ship.ionStacks > 0) {
      this.$shieldText.textContent += ` ⚡ ions: ${ship.ionStacks.toFixed(1)}`;
    }

    // ─── Weapons list ─────────────────────────
    const _weapons = ship.weapons || [];
    this.$weaponsList.innerHTML = _weapons.length === 0
      ? '<div class="item">No weapons</div>'
      : _weapons.map(w => `
          <div class="item">
            ${w.name}
            <span> ${w.damage}dmg | range ${w.range} | ${(w.accuracy * 100).toFixed(0)}%</span>
            ${w.currentCooldown > 0 ? `<span style="color:#ff9a2a"> ⏳${w.currentCooldown}</span>` : ''}
            ${w.ammoUsage > 0 ? `<span> | ${this._ammoCount(ship, w.type)} ammo</span>` : ''}
          </div>
        `).join('');

    // ─── Inventory list ───────────────────────
    const inv = ship.inventory || {};
    const invItems = [];
    if (inv.torpedoes      > 0) invItems.push(`Torpedoes: ${inv.torpedoes}`);
    if (inv.heavyTorpedoes > 0) invItems.push(`Heavy Torpedoes: ${inv.heavyTorpedoes}`);
    if (inv.ionTorpedoes   > 0) invItems.push(`Ion Torpedoes: ${inv.ionTorpedoes}`);
    if (inv.missiles       > 0) invItems.push(`Missiles: ${inv.missiles}`);
    if (inv.mines          > 0) invItems.push(`Mines: ${inv.mines}`);
    if (inv.bombs          > 0) invItems.push(`Bombs: ${inv.bombs}`);
    this.$invList.innerHTML = invItems.length === 0
      ? '<div class="item">Empty inventory</div>'
      : invItems.map(i => `<div class="item">${i}</div>`).join('');

    // ─── Energy policy ────────────────────────
    // ─── Named character panel ────────────────
    const nc        = ship.namedCharacter;
    const ncToggle  = document.getElementById('named-char-toggle');
    const ncForm    = document.getElementById('named-char-form');
    const ncName    = document.getElementById('named-char-name');
    const ncPerf    = document.getElementById('named-char-perf');
    const ncArmor   = document.getElementById('named-char-armor');
    const perfDisp  = document.getElementById('perf-display');
    const perfLabel = document.getElementById('perf-label');
    const PERF_LABELS = ['','Novice','Novice','Novice','Novice','Competent','Competent','Competent','Competent','Competent','Expert','Expert','Expert','Expert','Expert','Elite','Elite','Elite','Elite','Legendary'];

    if (ncToggle) {
      ncToggle.checked = nc?.enabled || false;
      ncForm?.classList.toggle('hidden', !nc?.enabled);
      if (nc?.enabled) {
        if (ncName)    ncName.value   = nc.name || ship.name;
        if (ncPerf)    ncPerf.value   = nc.performance || 5;
        if (ncArmor)   ncArmor.checked = nc.plotArmor ?? true;
        if (perfDisp)  perfDisp.textContent = nc.performance || 5;
        if (perfLabel) perfLabel.textContent = PERF_LABELS[nc.performance || 5] || '';
      }
    }

    // ─── Pilot type and named character ──────────────
    import('./pilot.js?v=20250617c').then(({ PILOT_TYPES, pilotLevelLabel }) => {
      const el = document.getElementById('pilot-info');
      if (!el) return;
      if (readOnly) {
        // Vaisseau adverse : pilote masqué — on ne connaît pas l'équipage ennemi
        el.innerHTML = `<span style="color:#4a4a6a;font-style:italic">👤 Pilote inconnu</span>`;
        return;
      }
      const typeDef = PILOT_TYPES[ship.pilotType || 'imperial'];
      const lvLabel = pilotLevelLabel(ship.pilotLevel || 1);
      el.innerHTML = `
        <span style="color:#4a9eff">${typeDef?.icon || '👤'} ${typeDef?.label || ship.pilotType || '—'}</span>
        <span style="color:#3ddc84;margin-left:6px">Lv${ship.pilotLevel} ${lvLabel}</span>
        ${ship.namedCharacter?.enabled ? `<span style="color:#ffdd44;margin-left:6px">★ ${ship.namedCharacter.name || ship.name} P${ship.namedCharacter.performance}</span>` : ''}
      `;
    }).catch(() => {});

    const LEVEL_LABELS = ['', 'Rookie', 'Veteran', 'Ace', 'Elite', 'Legendary'];
    const pilotLv = ship.pilotLevel || 1;
    const epSelect = document.getElementById('energy-policy-select');
    const epDesc   = document.getElementById('energy-desc');
    const epAuto   = document.getElementById('auto-energy-toggle');

    if (epSelect) {
      epSelect.value = ship.energyPolicy || 'balanced';
      // Disable options the pilot can't use
      Array.from(epSelect.options).forEach(opt => {
        const minLv = { balanced:1, reactor:2, shields:2, weapons:2, assault:3, retreat:3 }[opt.value] || 1;
        opt.disabled = pilotLv < minLv;
      });
    }
    if (epAuto) epAuto.checked = ship.autoEnergyPolicy ?? true;

    const POLICY_DESC = {
      balanced: 'Default — equal distribution',
      reactor:  '+35% speed & agility | −25% shields | −40% weapon rate',
      shields:  '+50% shields & regen | −30% speed | −40% weapon rate',
      weapons:  '+35% damage & rate | −20% speed | −30% shields',
      assault:  '+front shields & weapons | −speed | −rear shields',
      retreat:  '+40% speed | +rear shields | −40% weapons',
    };
    if (epDesc) epDesc.textContent = POLICY_DESC[ship.energyPolicy || 'balanced'] || '';

    // ─── Combat policy selector + progress bar ───────────────
    const cpSelect   = document.getElementById('combat-policy-select');
    const cpDesc     = document.getElementById('combat-policy-desc');
    const cpProgress = document.getElementById('policy-change-progress');
    const cpBar      = document.getElementById('policy-prog-bar');
    const cpTicksLeft= document.getElementById('policy-ticks-left');
    const cpTargetLbl= document.getElementById('policy-target-label');

    const CP_DESC = {
      standard:        'Mode équilibré — aucun bonus ni malus',
      hit_and_run:     '+5% dmg & évasion en mouvement | +3% vitesse',
      blockade:        '-25% vitesse | +7% dmg infligés | -10% dmg subits',
      assault:         '+8% dmg infligés | +3% portée | -5% dmg frontaux',
      blockade_runner: '+5% vitesse | +10% regen boucliers | défensif uniquement',
    };

    if (cpSelect) {
      // Rebuild options dynamically with availability
      const available = getAvailablePolicies(ship);
      cpSelect.innerHTML = Object.entries(COMBAT_POLICIES).map(([k, pol]) => {
        const avail   = available.has(k);
        const current = k === (ship._pendingCombatPolicy || ship.combatPolicy || 'standard');
        return `<option value="${k}" ${current?'selected':''} ${avail?'':'disabled'}
          style="color:${avail?'':'#444'}">${avail ? pol.label : '🔒 ' + pol.label}</option>`;
      }).join('');
    }

    if (ship._pendingCombatPolicy && (ship._combatPolicyTimer || 0) > 0) {
      if (cpProgress) cpProgress.style.display = 'block';
      const delay   = (ship.pilotLevel || 1) >= 5 ? 2 : 3;
      const elapsed = delay - (ship._combatPolicyTimer || 0);
      const pct2    = Math.round(elapsed / delay * 100);
      if (cpBar)       cpBar.style.width = pct2 + '%';
      if (cpTicksLeft) cpTicksLeft.textContent = (ship._combatPolicyTimer || 0) + ' tick(s)';
      if (cpTargetLbl) cpTargetLbl.textContent = '→ ' + (CP_DESC[ship._pendingCombatPolicy] || ship._pendingCombatPolicy);
      if (cpDesc)      cpDesc.textContent = '⏳ Transition en cours…';
    } else {
      if (cpProgress) cpProgress.style.display = 'none';
      if (cpDesc)     cpDesc.textContent = CP_DESC[ship.combatPolicy || 'standard'] || '';
    }

    const lvBadge = document.getElementById('pilot-level-display');
    const lvLabel = document.getElementById('pilot-level-badge');
    if (lvBadge) lvBadge.textContent = pilotLv;
    if (lvLabel) {
      lvLabel.textContent = LEVEL_LABELS[pilotLv] || `Lv${pilotLv}`;
      lvLabel.style.background = pilotLv >= 3 ? '#2a1a40' : pilotLv >= 2 ? '#1a2a1a' : '#1a2535';
      lvLabel.style.borderColor= pilotLv >= 3 ? '#cc44ff' : pilotLv >= 2 ? '#3ddc84' : '#2a3550';
      lvLabel.style.color      = pilotLv >= 3 ? '#cc44ff' : pilotLv >= 2 ? '#3ddc84' : '#7a8ab0';
    }

    const hasTarget = ['target', 'escort', 'kamikaze'].includes(ship.behavior.mode);
    this.$behaviorTargetRow?.classList.toggle('hidden', !hasTarget);
    if (hasTarget && this.$behaviorTargetInput) this.$behaviorTargetInput.value = ship.behavior.targetId || '';

    // ─── Bombard button — only for bombers ───
    const bombardBtn = document.getElementById('btn-order-bombard');
    if (ship.type === 'bomber' || ship.type === 'gunship') {
      if (bombardBtn) bombardBtn.classList.remove('hidden');
    } else {
      if (bombardBtn) bombardBtn.classList.add('hidden');
    }

    // ─── Dock button — small ships only ──────
    // ─── Taille petite pour certains boutons contextuels ────
    const smallEnough = ['XS','S'].includes(ship.size);

    // ─── Atterrir — visible pour tous, label adaptatif ─────────────────────
    // XS/S : peut atterrir dans un porteur OU une station/planète
    // M+ : seulement stations et planètes
    const dockStationBtn = document.getElementById('btn-order-dock-station');
    if (dockStationBtn) {
      dockStationBtn.classList.remove('hidden');
      if (smallEnough) {
        dockStationBtn.title   = 'Atterrir dans un porteur, une station ou une planète';
        dockStationBtn.textContent = '🛬 Atterrir';
      } else {
        dockStationBtn.title   = 'Atterrir sur une station ou une planète';
        dockStationBtn.textContent = '🛬 Atterrir';
      }
    }

    // ─── Capture — rayon tracteur seulement ─────────────────
    const captureBtn = document.getElementById('btn-order-capture');
    if (captureBtn) {
      (ship.tractorBeam||0)>0 ? captureBtn.classList.remove('hidden') : captureBtn.classList.add('hidden');
    }

    // ─── Cargo eject ─────────────────────────────────────────
    const ejectBtn = document.getElementById('btn-order-cargo-eject');
    if (ejectBtn) {
      ship.cargoEject && (ship.cargoHold?.length??0)>0
        ? ejectBtn.classList.remove('hidden')
        : ejectBtn.classList.add('hidden');
    }

    // ─── Dock/Undock (amarrage à un vaisseau adverse) ────────
    const dockShipBtn = document.getElementById('btn-order-dock-ship');
    const undockBtn   = document.getElementById('btn-order-undock');
    const isDocked    = !!(ship._dockedInShipId);
    if (dockShipBtn) isDocked ? dockShipBtn.classList.add('hidden')    : dockShipBtn.classList.remove('hidden');
    if (undockBtn)   isDocked ? undockBtn.classList.remove('hidden')   : undockBtn.classList.add('hidden');

    // ─── Toggle bouclier — inline sous la barre (pas dans les ordres) ──
    const shieldRow    = document.getElementById('shield-toggle-row');
    const shieldCheck  = document.getElementById('shield-toggle-check');
    const shieldLabel  = document.getElementById('shield-toggle-label');
    const hasSh = (ship.shields?.max ?? 0) > 0;
    if (shieldRow) {
      if (hasSh && !readOnly) {
        shieldRow.style.display = '';
        const isDown = ship.shields.current <= 0 || ship.shields.disabled;
        if (shieldCheck) shieldCheck.checked = isDown;
        if (shieldLabel) {
          shieldLabel.textContent = isDown ? 'Boucliers coupés (amarrage possible)' : 'Couper les boucliers';
          shieldLabel.style.color = isDown ? '#ff7675' : '#6b7a9e';
        }
      } else {
        shieldRow.style.display = 'none';
      }
    }

    // ─── Onglet Économie — rendu direct dans sp-content-eco ───────────────
    const ecoEl = document.getElementById('sp-content-eco');
    const ecoHasFocus = ecoEl && ecoEl.contains(document.activeElement);
    if (!ecoHasFocus) {
      this._renderEcoTab(ship);
    }

    // ─── Ship image / icon ────────────────────
    const imgEl  = document.getElementById('ship-image');
    const iconEl = document.getElementById('ship-icon-fallback');
    if (imgEl && iconEl) {
      if (ship.image) {
        imgEl.src = ship.image;
        imgEl.classList.remove('hidden');
        iconEl.classList.add('hidden');
      } else {
        const icons = { fighter:'🛸', heavy_fighter:'🛸', interceptor:'⚡', bomber:'💣',
                        gunship:'🔫', transport:'📦', corvette:'⛵', frigate:'⚓',
                        cruiser:'🛳', destroyer:'⚔️', dreadnought:'🏴‍☠️', other:'🔧' };
        iconEl.textContent = icons[ship.type] || '?';
        imgEl.classList.add('hidden');
        iconEl.classList.remove('hidden');
      }
    }
  }

  /** Renders the carrier launch bay panel if the selected ship is a carrier */
  // ═══════════════════════════════════════════════════════
  // ONGLET ÉCONOMIE — rendu unifié
  // ═══════════════════════════════════════════════════════

  _renderEcoTab(ship) {
    const eco = document.getElementById('sp-content-eco');
    if (!eco) return;
    if (!ship) { eco.innerHTML = '<div style="font-size:10px;color:#3a4a60;padding:8px 0">Sélectionner un vaisseau.</div>'; return; }
    try {
      this._renderEcoTabInner(ship, eco);
    } catch(e) {
      // Afficher l'erreur directement dans l'onglet pour diagnostic
      eco.innerHTML = `<div style="font-size:10px;color:#ff4444;padding:6px;background:#1a0808;border:1px solid #ff4444;border-radius:4px;word-break:break-all">⚠ Erreur rendu éco: ${e.message}<br><small style="color:#aa6666">${e.stack?.split('\n')[1]||''}</small></div>`;
      console.error('[EcoTab]', e);
    }
  }

  _renderEcoTabInner(ship, eco) {
    const isMine = !!(window.SESSION?.isGM)
      || ((this.state.fleets.find(f=>f.fleetId===ship.fleetId)?.colorIndex
           ?? ship._factionColorIndex) === (window._p2pFactionCi??-1));
    const isGM = !!(window.SESSION?.isGM);
    const CREW_EST = {XS:'1',S:'2-5',M:'5-25',L:'25-150',XL:'150-700',XXL:'700+'};
    const crewEst  = CREW_EST[ship.size] || '?';
    let html = '';

    // ── HANGAR ────────────────────────────────────────────
    if (ship.carrier?.reserves?.length) {
      const c = ship.carrier;
      const deployed = c.reserves.reduce((s,r)=>s+(r.deployed||0),0);
      const total    = c.maxSlots||42;
      const pct      = Math.min(100,Math.round(deployed/total*100));
      const rows     = c.reserves.map(r=>{
        const cls=PRESET_CLASSES[r.classId]; const nm=cls?.name||r.classId; const av=r.count-(r.deployed||0);
        return `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;border-bottom:1px solid #1e2740;font-size:10px">
          <span style="flex:1;color:#c8d8ff">${nm}</span>
          <span style="color:${av>0?'#3ddc84':'#6b7a9e'};min-width:45px;text-align:right">${av}/${r.count}</span>
          ${isMine?`<button class="btn btn-small eco-launch" data-cid="${r.classId}" data-sid="${ship.id}" style="font-size:9px;padding:1px 6px" ${av<=0?'disabled':''}>✈</button>`:''}
        </div>`;
      }).join('');
      html += `<div class="section-block" style="margin-bottom:6px">
        <h3 style="margin-bottom:4px">✈ Hangar</h3>
        <div class="bar-bg" style="margin-bottom:2px"><div class="bar" style="width:${pct}%;background:#ffa726"></div></div>
        <div style="font-size:9px;color:#6b7a9e;margin-bottom:4px">${deployed} déployés / ${total} slots</div>
        ${rows}
        ${isMine?`<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          <label style="font-size:9px;display:flex;gap:3px;color:#6b7a9e"><input type="checkbox" class="eco-auto" data-auto="autoFighters" ${c.autoFighters?'checked':''}> Fighters</label>
          <label style="font-size:9px;display:flex;gap:3px;color:#6b7a9e"><input type="checkbox" class="eco-auto" data-auto="autoBombers" ${c.autoBombers?'checked':''}> Bombers</label>
          <label style="font-size:9px;display:flex;gap:3px;color:#6b7a9e"><input type="checkbox" class="eco-auto" data-auto="autoInterceptors" ${c.autoInterceptors?'checked':''}> Intercept.</label>
          <label style="font-size:9px;display:flex;gap:3px;color:#e84393"><input type="checkbox" class="eco-auto" data-auto="launchLocked" ${c.launchLocked?'checked':''}> 🔒 Décollage bloqué</label>
        </div>`:''}
      </div>`;
    }

    // ── CALE MARCHANDE ────────────────────────────────────
    {
      const hold = ship.cargoHold || [];
      const cap  = ship.cargoVolume || 0;
      const used = hold.reduce((s,c)=>s+(CARGO_TYPES[c.type]?.unitVolume||1)*c.count, 0);
      const pct  = cap > 0 ? Math.min(100,Math.round(100*used/cap)) : 0;
      const selShip   = this.state.ships.find(s=>s.id===this.selectedShipId&&s.alive);
      const hasScanner= !isMine && (selShip?.scanner??0)>0;
      const scanFresh = ship._scanLongTick!=null && ((this.state?.tick??0)-ship._scanLongTick)<=10;
      const scanResult= ship._scanResult||'';
      html += `<div class="section-block" style="margin-bottom:6px"><h3 style="margin-bottom:4px">📦 Cale marchande (t)</h3>`;
      if (cap <= 0) {
        html += `<div style="font-size:10px;color:#3a4a60;font-style:italic">Aucune cale sur ce vaisseau (${ship.size}).</div>`;
      } else if (!isMine) {
        if (!scanResult && !scanFresh) {
          html += `<div style="font-size:10px;color:#3a4a6a;font-style:italic;margin-bottom:4px">🔒 Cale non identifiée</div>`;
        } else {
          // Grille cargo (vue scanner)
          {
            const CELLS=30; const m3pc=Math.max(1,cap/CELLS);
            const used2=hold.reduce((s,c)=>s+(CARGO_TYPES[c.type]?.unitVolume||1)*c.count,0);
            const filled=Math.round(used2/m3pc);
            const sigB=['#333','#ffa726','#ff4444'];
            const sColor=(type)=>(CARGO_ENERGY_SIGNATURE[type]??0)>=2?'#e74c3c':CARGO_IS_ORGANIC[type]?'#6ab04c':'#636e72';
            let g=`<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:5px;padding:4px;background:#060c14;border-radius:4px;border:1px solid #1a2535">`;
            let ci=0;
            if(scanFresh){
              hold.forEach(entry=>{
                const vol=(CARGO_TYPES[entry.type]?.unitVolume||1)*entry.count;
                const n=Math.max(1,Math.round(vol/m3pc)); const col=sColor(entry.type); const sig=CARGO_ENERGY_SIGNATURE[entry.type]??0;
                for(let i=0;i<n&&ci<CELLS;i++,ci++) g+=`<div style="width:10px;height:10px;border-radius:2px;background:${col};border:1px solid ${sigB[sig]};opacity:0.85"></div>`;
              });
            } else {
              for(let i=0;i<Math.min(filled,CELLS);i++,ci++) g+=`<div style="width:10px;height:10px;border-radius:2px;background:#3a4a6a;border:1px solid #2a3550"></div>`;
            }
            for(;ci<CELLS;ci++) g+=`<div style="width:10px;height:10px;border-radius:2px;background:#060c14;border:1px solid #1a2535"></div>`;
            g+=`</div>`;
            const volPct2=cap>0?Math.round(100*used2/cap):0;
            let leg=scanFresh
              ?`<div style="font-size:9px;color:#b8c8e8;padding:3px 5px;background:#0a1018;border:1px solid #2a3550;border-radius:3px;margin-bottom:3px">🔬 ~${volPct2}%
                  ${hold.some(c=>CARGO_IS_ORGANIC[c.type])?'<span style="color:#6ab04c;margin-left:5px">● Org.</span>':''}
                  ${hold.some(c=>!CARGO_IS_ORGANIC[c.type])?'<span style="color:#636e72;margin-left:5px">● Min.</span>':''}
                  ${hold.some(c=>(CARGO_ENERGY_SIGNATURE[c.type]??0)>=2)?'<span style="color:#e74c3c;margin-left:5px">⚡ Haute sig.</span>':''}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:3px;font-size:9px">
                  <span><span style="display:inline-block;width:8px;height:8px;background:#6ab04c;border-radius:1px;margin-right:2px"></span>Organique</span>
                  <span><span style="display:inline-block;width:8px;height:8px;background:#636e72;border-radius:1px;margin-right:2px"></span>Minérale</span>
                  <span><span style="display:inline-block;width:8px;height:8px;background:#e74c3c;border-radius:1px;margin-right:2px"></span>Énergie élevée</span>
                </div>`
              :`<div style="font-size:9px;color:#6b7a9e;font-style:italic;margin-bottom:3px">📡 Scan court — présence confirmée (~${volPct2}% plein)</div>`;
            html += leg + g;
          }
        }
        if (hasScanner) html += `<div style="display:flex;gap:4px;margin-top:4px">
          <button class="btn btn-small eco-scan-short" style="flex:1;font-size:9px;padding:3px;border-color:#3a5a8a;color:#7aa8d8">📡 Scan court</button>
          <button class="btn btn-small eco-scan-long"  style="flex:1;font-size:9px;padding:3px;border-color:#5a3a8a;color:#a87ad8">🔬 Long scan</button>
        </div>`;
        else if (!scanResult) html += `<div style="font-size:9px;color:#3a4a6a">Aucun scanner à bord.</div>`;
      } else {
        html += `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
          <div class="bar-bg" style="flex:1"><div class="bar" style="width:${pct}%;background:${pct>=95?'#d68a3a':'#3a8fd6'}"></div></div>
          <span style="font-size:10px;color:#7ab8ff;white-space:nowrap">${used}/${cap} t</span>
        </div>`;
        // ── Grille cargo (vue propriétaire) ──
        {
          // Nombre de cases adaptatif : 1 case = 1 tonne (cap = 90 cases = 9 lignes de 10)
          // Pour les petites cales (≤ 90t) : 1 case = 1t — affichage précis
          // Pour les grandes cales : 1 case = cap/90t — affichage proportionnel
          const CELLS = Math.min(90, Math.max(5, cap));
          const m3pc  = cap / CELLS; // tonnes par case
          const sigB=['#333','#ffa726','#ff4444'];
          let cells=[];
          hold.forEach((entry,ei)=>{
            // unitVolume est le poids en tonnes d'UNE unité du type
            // count = nombre d'unités → volume total = unitVolume * count
            const vol=(CARGO_TYPES[entry.type]?.unitVolume||1)*entry.count;
            const n=Math.max(1,Math.round(vol/m3pc));
            const col=CARGO_TYPES[entry.type]?.color||'#555';
            const sig=CARGO_ENERGY_SIGNATURE[entry.type]??0;
            for(let i=0;i<n&&cells.length<CELLS;i++) cells.push({color:col,sig,idx:ei,label:CARGO_TYPES[entry.type]?.label||entry.type,count:entry.count});
          });
          let g=`<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:5px;padding:4px;background:#060c14;border-radius:4px;border:1px solid #1a2535">`;
          for(let i=0;i<CELLS;i++){
            const c=cells[i];
            g+=c?`<div class="eco-cargo-cell" data-i="${c.idx}" title="${c.label} ×${c.count}" style="width:11px;height:11px;border-radius:2px;background:${c.color};border:1px solid ${sigB[c.sig]};cursor:pointer"></div>`
                :`<div style="width:11px;height:11px;border-radius:2px;background:#0a1018;border:1px solid #1a2535"></div>`;
          }
          g+=`</div>`;
          // Liste items
          let list=hold.length?`<div style="font-size:10px;max-height:80px;overflow-y:auto;margin-bottom:4px">`:`<div style="color:#3a4a60;font-size:10px;padding:3px 0">Cale vide.</div>`;
          hold.forEach((entry,ci2)=>{
            const def=CARGO_TYPES[entry.type]||{};
            list+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #1e2740">
              <span style="color:${def.color||'#c8d8ff'};font-size:10px;flex:1">${def.label||entry.type} <span style="color:#888">×${entry.count}</span></span>
              <span style="display:flex;gap:2px;align-items:center">
                <button class="eco-cargo-transfer btn btn-small" data-i="${ci2}" style="font-size:8px;padding:0 4px;border-color:#3a8fd6;color:#7ab8ff" title="Transférer">↪</button>
                ${isGM?`<input type="number" class="eco-cargo-remove-qty" data-i="${ci2}" min="1" max="${entry.count}" value="1"
                  style="width:32px;font-size:8px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:1px;text-align:center">
                <button class="eco-cargo-remove btn btn-small" data-i="${ci2}" style="font-size:8px;padding:0 4px;border-color:#aa4444;color:#ff9090" title="Retirer">✕</button>`:''}
              </span>
            </div>`;
          });
          if(hold.length) list+=`</div>`;
          html += g + list;
          // Légende
          if(hold.length){
            const SL=['◌','◎','●'];
            let leg=`<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:3px;padding:3px;background:#060c14;border-radius:3px;border:1px solid #1a2535">`;
            hold.forEach(entry=>{
              const def=CARGO_TYPES[entry.type]; if(!def) return;
              const sig=CARGO_ENERGY_SIGNATURE[entry.type]??0;
              leg+=`<span style="display:flex;align-items:center;gap:2px;font-size:9px;color:#a0b0c0;background:#0e1820;padding:1px 4px;border-radius:3px;border:1px solid ${def.color}50">
                <span style="display:inline-block;width:7px;height:7px;background:${def.color};border-radius:1px;flex-shrink:0"></span>
                ${(def.label||entry.type).replace(/^[^\s]+\s*/,'')} <span style="color:#555">${SL[sig]}</span>
              </span>`;
            });
            html += leg+`</div>`;
          }
        }
        if (ship.cargoEject && hold.length) html += `<button class="btn btn-small eco-eject" style="margin-top:4px;font-size:10px;border-color:#d4a844;color:#d4a844;width:100%">📦 Éjecter</button>`;
        if (isGM) html += `<div style="display:flex;gap:4px;align-items:center;margin-top:4px">
          <select class="eco-add-type" style="flex:1;font-size:9px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:2px">
            ${Object.entries(CARGO_TYPES).map(([id,d])=>`<option value="${id}">${d.label}</option>`).join('')}
          </select>
          <input type="number" class="eco-add-count" min="1" value="1" style="width:36px;font-size:9px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:2px">
          <button class="btn btn-small eco-add-btn" style="font-size:9px;padding:2px 5px;border-color:#3a8a44;color:#9dffb0">➕</button>
        </div>`;
      }
      html += `</div>`;
    }

    // ── FORMES DE VIE ─────────────────────────────────────
    {
      html += `<div class="section-block" style="margin-bottom:4px"><h3 style="margin-bottom:4px">👥 Formes de vie</h3>`;
      if (!isMine) {
        const scanOk = (ship._scanResult||'').toLowerCase().includes('formes de vie');
        html += `<div style="font-size:10px;color:${scanOk?'#b8e8b8':'#3a4a6a'};font-style:${scanOk?'normal':'italic'}">
          ${scanOk?`🔍 Formes de vie ~${crewEst}`:'👁 Indéterminé (scanner requis)'}
        </div>`;
      } else {
        // ── Équipage (lecture seule, canonique) ──
        const crewCap = ship.crewCapacity||0;
        const crewCnt = ship.crewCount||0;
        const crewPct = crewCap>0?Math.min(100,Math.round(100*crewCnt/crewCap)):0;
        const crewR   = (ship._paxRoster?.crew)||{human:crewCnt,droid:0};
        html += `<div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:10px;color:${crewCap>0?'#4a9eff':'#3a4a6a'}">🧑‍✈️ Équipage
              <span style="font-size:9px;color:#3a5070">(${crewR.human||0}H ${crewR.droid||0}D)</span></span>
            <span style="font-size:10px;color:${crewCap>0?'#4a9eff':'#3a4a6a'}">${crewCnt}${crewCap>0?'/'+crewCap:' —'}</span>
          </div>
          <div class="bar-bg"><div class="bar" style="width:${crewPct}%;background:#4a9eff"></div></div>
          <div style="font-size:9px;color:#2a3a50;margin-top:1px">Non modifiable</div>
        </div>`;

        // ── Blessés ──
        const wndCap = ship.medicalCapacity||0;
        const wndCnt = ship.woundedCount||0;
        const wndPct = wndCap>0?Math.min(100,Math.round(100*wndCnt/wndCap)):0;
        if (wndCap>0) html += `<div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:10px;color:#e84393">🩹 Blessés</span>
            <span style="font-size:10px;color:#e84393">${wndCnt}/${wndCap}</span>
          </div>
          <div class="bar-bg"><div class="bar" style="width:${wndPct}%;background:#e84393"></div></div>
          ${isGM?`<div style="display:flex;gap:3px;margin-top:3px">
            <button class="btn btn-small eco-adj-add" data-key="wnd" data-type="human" style="font-size:9px;padding:1px 5px" ${wndCnt>=wndCap?'disabled':''}>+1</button>
            <button class="btn btn-small eco-adj-rem" data-key="wnd" style="font-size:9px;padding:1px 5px;border-color:#aa4444;color:#ff9090" ${wndCnt<=0?'disabled':''}>-1</button>
          </div>`:''}
        </div>`;

        // ── Prisonniers ──
        const priCap = ship.brigCapacity||0;
        const priCnt = ship.captiveCount||0;
        const priPct = priCap>0?Math.min(100,Math.round(100*priCnt/priCap)):0;
        const priR   = (ship._paxRoster?.pri)||{human:0,droid:0};
        if (priCap>0) html += `<div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:10px;color:#b08a3a">⛓ Prisonniers
              <span style="font-size:9px;color:#665020">(${priR.human||0}H ${priR.droid||0}D)</span></span>
            <span style="font-size:10px;color:#b08a3a">${priCnt}/${priCap}</span>
          </div>
          <div class="bar-bg"><div class="bar" style="width:${priPct}%;background:#b08a3a"></div></div>
          ${isGM?`<div style="display:flex;gap:3px;margin-top:3px;flex-wrap:wrap">
            <button class="btn btn-small eco-adj-add" data-key="pri" data-type="human" style="font-size:9px;padding:1px 5px" ${priCnt>=priCap?'disabled':''}>+1 H</button>
            <button class="btn btn-small eco-adj-add" data-key="pri" data-type="droid" style="font-size:9px;padding:1px 5px;border-color:#888fa0;color:#b2bec3" ${priCnt>=priCap?'disabled':''}>+1 D</button>
            <button class="btn btn-small eco-adj-rem" data-key="pri" style="font-size:9px;padding:1px 5px;border-color:#aa4444;color:#ff9090" ${priCnt<=0?'disabled':''}>-1</button>
          </div>`:''}
        </div>`;

        // ── Combattants embarqués (troupes typées) ──
        // Généré dynamiquement depuis TROOP_TYPES (boarding.js) — toujours synchrone avec les définitions
        const TROOP_DEFS = Object.fromEntries(
          Object.entries(TROOP_TYPES).map(([id, t]) => [id, { icon: t.icon, label: t.label, color: t.color }])
        );
        // Non-combattants passifs par défaut (willFight=false) — les autres combattent
        const NON_COMBATANTS = new Set(['civilian', 'smuggler', 'clone_medic']);
        const FIGHT_TYPES = new Set(Object.keys(TROOP_TYPES).filter(k => !NON_COMBATANTS.has(k)));
        const troops = ship._troops || [];  // [{ type, count, willFight }]
        const totalTroops = troops.reduce((s,t)=>s+t.count,0);
        const paxCap = ship.passengerCapacity||0;
        html += `<div style="margin-bottom:5px;border-top:1px solid #1e2740;padding-top:5px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:10px;color:#74b9ff">🪖 Combattants / Passagers</span>
            <span style="font-size:10px;color:#74b9ff">${totalTroops}${paxCap>0?'/'+paxCap:''}</span>
          </div>`;
        if (troops.length) {
          troops.forEach((t,ti) => {
            const def = TROOP_DEFS[t.type]||{icon:'?',label:t.type,color:'#888'};
            const fights = t.willFight ?? FIGHT_TYPES.has(t.type);
            html += `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;border-bottom:1px solid #1a2535;font-size:10px">
              <span style="color:${def.color};min-width:20px">${def.icon}</span>
              <span style="flex:1;color:${def.color}">${def.label}</span>
              <span style="color:#888;min-width:28px;text-align:right">×${t.count}</span>
              <span style="font-size:9px;color:${fights?'#e84393':'#3a4a6a'};min-width:50px">${fights?'⚔ Combat':'🕊 Passif'}</span>
              ${isGM?`<button class="eco-troop-toggle btn btn-small" data-ti="${ti}" title="${fights?'Passer en passif':'Activer combat'}"
                style="font-size:9px;padding:0 4px;border-color:${fights?'#e84393':'#3a5a3a'};color:${fights?'#ff9090':'#6ab04c'}">
                ${fights?'🕊':'⚔'}</button>
              <input type="number" class="eco-troop-rem-qty" data-ti="${ti}" min="1" max="${t.count}" value="1"
                style="width:32px;font-size:8px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:1px;text-align:center">
              <button class="eco-troop-rem btn btn-small" data-ti="${ti}" style="font-size:9px;padding:0 4px;border-color:#aa4444;color:#ff9090" title="Retirer">✕</button>
              `:''}
            </div>`;
          });
        } else {
          html += `<div style="font-size:9px;color:#3a4a60;padding:2px 0">Aucune troupe embarquée.</div>`;
        }
        if (isGM) {
          html += `<div style="display:flex;gap:3px;align-items:center;margin-top:4px;flex-wrap:wrap">
            <select class="eco-troop-type" style="font-size:9px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:2px;flex:1">
              ${Object.entries(TROOP_DEFS).map(([id,d])=>`<option value="${id}">${d.icon} ${d.label}</option>`).join('')}
            </select>
            <input type="number" class="eco-troop-count" min="1" value="1" style="width:40px;font-size:9px;background:#0e1520;border:1px solid #2a3550;color:#c8d8ff;border-radius:3px;padding:2px">
            <button class="btn btn-small eco-troop-add" style="font-size:9px;padding:2px 5px;border-color:#3a8a44;color:#9dffb0">+</button>
          </div>`;
        }
        html += `</div>`;

        const hasCarb = (ship.cargoHold||[]).some(c=>c.type==='carbonite');
        if (hasCarb) html += `<div style="font-size:9px;color:#636e72;margin-top:2px">🧊 Blocs de carbonite dans la cale</div>`;
      }
      html += `</div>`;
    }

    // ── AMARRAGE & ABORDAGE ───────────────────────────────
    const dockedShips = (ship._dockedShipIds||[]).map(id => this.state.ships.find(s=>s.id===id&&s.alive)).filter(Boolean);
    const dockedIn    = ship._dockedInShipId ? this.state.ships.find(s=>s.id===ship._dockedInShipId&&s.alive) : null;
    const boarding    = ship._boardingState;

    if (dockedIn || dockedShips.length || boarding) {
      html += `<div class="section-block" style="margin-bottom:6px"><h3 style="margin-bottom:4px">🔗 Amarrage</h3>`;
      if (dockedIn) {
        html += `<div style="font-size:10px;color:#a29bfe;margin-bottom:4px">✓ Amarré à <b>${dockedIn.name}</b></div>`;
      }
      if (dockedShips.length) {
        html += `<div style="font-size:10px;color:#6b7a9e;margin-bottom:4px">Vaisseaux amarrés :</div>`;
        dockedShips.forEach(ds => {
          const sameFaction = ds.fleetId === ship.fleetId;
          const boardingActive = ds._boardingState?.phase === 'fighting' || ds._boardingState?.phase === 'breach';
          html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #1e2740;font-size:10px">
            <span style="color:${sameFaction?'#3ddc84':'#e84393'}">${ds.name}</span>
            ${boardingActive ? '<span style="color:#e84393;font-size:9px">⚔ Abordage</span>' : ''}
            ${isMine && isGM && !sameFaction && !boardingActive
              ? `<button class="btn btn-small eco-initboard" data-sid="${ds.id}" style="font-size:9px;padding:1px 6px;border-color:#e84393;color:#ff9090">⚔ Aborder</button>`
              : ''}
          </div>`;
        });
      }
      if (boarding && boarding.phase !== 'over') {
        const atkAlive = (boarding.attackerTroops||[]).reduce((s,t)=>s+t.count,0);
        const defAlive = (boarding.defenderTroops||[]).reduce((s,t)=>s+t.count,0);
        html += `<div style="margin-top:5px;padding:4px;background:#1a0808;border:1px solid #e84393;border-radius:3px;font-size:9px">
          <div style="color:#e84393;font-weight:bold">⚔ ABORDAGE EN COURS (tick ${boarding.tick})</div>
          <div style="color:#ff9090">Assaillants : ${atkAlive} | Défenseurs : ${defAlive}</div>
        </div>`;
      }
      html += `</div>`;
    }

    eco.innerHTML = html;

    // ── BINDINGS ─────────────────────────────────────────
    eco.querySelectorAll('.eco-initboard').forEach(b => b.onclick = () => {
      this.callbacks.onInitBoarding?.(ship.id, b.dataset.sid);
    });
    // Gestion des troupes
    eco.querySelectorAll('.eco-troop-toggle').forEach(b => b.onclick = () => {
      const ti = parseInt(b.dataset.ti);
      if (!ship._troops?.[ti]) return;
      ship._troops[ti].willFight = !ship._troops[ti].willFight;
      document.activeElement?.blur();
      this._renderEcoTab(ship);
    });
    eco.querySelectorAll('.eco-troop-rem').forEach(b => b.onclick = () => {
      const ti = parseInt(b.dataset.ti);
      if (!ship._troops?.[ti]) return;
      const qtyInput = eco.querySelector(`.eco-troop-rem-qty[data-ti="${ti}"]`);
      const qty = parseInt(qtyInput?.value) || 1;
      ship._troops[ti].count = Math.max(0, ship._troops[ti].count - qty);
      if (ship._troops[ti].count <= 0) ship._troops.splice(ti, 1);
      document.activeElement?.blur();
      this._renderEcoTab(ship);
      if(window._p2pBroadcast) window._p2pBroadcast({type:'state',snapshot:window._getSnap?.()});
    });
    eco.querySelector('.eco-troop-add')?.addEventListener('click', () => {
      const type  = eco.querySelector('.eco-troop-type')?.value;
      const count = parseInt(eco.querySelector('.eco-troop-count')?.value)||1;
      if (!type) return;
      if (!ship._troops) ship._troops = [];
      const existing = ship._troops.find(t=>t.type===type);
      if (existing) existing.count += count;
      else ship._troops.push({ type, count, willFight: !['civilian','smuggler','clone_medic'].includes(type) });
      document.activeElement?.blur();
      this._renderEcoTab(ship);
      if(window._p2pBroadcast) window._p2pBroadcast({type:'state',snapshot:window._getSnap?.()});
    });
    eco.querySelectorAll('.eco-auto').forEach(cb=>cb.onchange=()=>this.callbacks.onCarrierAutoChange?.(ship.id,cb.dataset.auto,cb.checked));
    eco.querySelectorAll('.eco-scan-short').forEach(b=>b.onclick=()=>this.callbacks.onScanShort?.(this.selectedShipId,ship.id));
    eco.querySelectorAll('.eco-scan-long').forEach(b=>b.onclick=()=>this.callbacks.onScanLong?.(this.selectedShipId,ship.id));
    eco.querySelector('.eco-eject')?.addEventListener('click',()=>this.callbacks.onCargoEject?.(ship.id));
    eco.querySelectorAll('.eco-cargo-remove').forEach(b => b.onclick = () => {
      const ci3 = parseInt(b.dataset.i);
      // Lire la quantité depuis l'input adjacent
      const qtyInput = eco.querySelector(`.eco-cargo-remove-qty[data-i="${ci3}"]`);
      const qty = parseInt(qtyInput?.value) || 1;
      this.callbacks.onCargoRemove?.(ship.id, ci3, qty);
    });
    eco.querySelectorAll('.eco-cargo-transfer').forEach(b=>b.onclick=()=>this.callbacks.onCargoTransferStart?.(ship.id,parseInt(b.dataset.i)));
    eco.querySelector('.eco-add-btn')?.addEventListener('click',()=>{
      const t=eco.querySelector('.eco-add-type')?.value;
      const n=parseInt(eco.querySelector('.eco-add-count')?.value)||1;
      if(t) this.callbacks.onCargoAdd?.(ship.id,t,n);
    });
    const adjField = {pax:'passengerCount',wnd:'woundedCount',pri:'captiveCount'};
    const adjCap   = {pax:'passengerCapacity',wnd:'medicalCapacity',pri:'brigCapacity'};
    eco.querySelectorAll('.eco-adj-add,.eco-adj-rem').forEach(btn=>{
      btn.onclick=()=>{
        const k=btn.dataset.key; const f=adjField[k]; const cf=adjCap[k]; if(!f) return;
        const isAdd = btn.classList.contains('eco-adj-add');
        const pType = btn.dataset.type || 'human'; // 'human' | 'droid'
        const d = isAdd ? 1 : -1;
        ship[f] = Math.max(0, Math.min(ship[cf]||0, (ship[f]||0)+d));
        // Mettre à jour le roster humain/droïde
        if (!ship._paxRoster) ship._paxRoster = {};
        if (!ship._paxRoster[k]) ship._paxRoster[k] = {human:0, droid:0};
        const r = ship._paxRoster[k];
        if (isAdd) {
          if (pType==='droid') r.droid = (r.droid||0)+1;
          else                  r.human = (r.human||0)+1;
        } else {
          // Retirer : priorité aux droïdes si existants, sinon humains
          if (r.droid > 0)      r.droid--;
          else if (r.human > 0) r.human--;
        }
        document.activeElement?.blur();
        this._renderEcoTab(ship);
        if(window._p2pBroadcast) window._p2pBroadcast({type:'state',snapshot:window._getSnap?.()});
      };
    });
  }

  // ═══════════════════════════════════════════════════════
  // UPDATE FLEET PANEL (RIGHT)
  // ═══════════════════════════════════════════════════════

  /** Called after each tick to refresh the fleet list */
  updateFleetList() {
    const state    = this.state;
    const fleets   = state.fleets || [];
    const ships    = state.ships  || [];

    // ─── Group fleets by colorIndex (faction) ────────────────
    const factionMap = {};
    for (const fl of fleets) {
      const ci = fl.colorIndex ?? 0;
      if (!factionMap[ci]) {
        const af   = state.activeFactions?.find(f => f.colorIndex === ci);
        factionMap[ci] = {
          ci, color: FLEET_COLORS[ci] || '#aaa',
          name: fl.name,  // faction name = fleet name for primary fleet
          subFleets: [],
          totalAlive: 0, totalShips: 0,
        };
        if (af?.name) factionMap[ci].name = af.name;
      }
      const alive     = ships.filter(s => s.fleetId === fl.fleetId && s.alive);
      const dead      = ships.filter(s => s.fleetId === fl.fleetId && !s.alive && s.destroyed);
      const escaped   = ships.filter(s => s.fleetId === fl.fleetId && !s.alive && s.escaped);
      factionMap[ci].subFleets.push({ fleet: fl, alive, dead, escaped, all: ships.filter(s => s.fleetId === fl.fleetId && s.alive) });
      factionMap[ci].totalAlive += alive.length;
      factionMap[ci].totalShips += ships.filter(s => s.fleetId === fl.fleetId && s.alive).length;
    }

    const factions = Object.values(factionMap);

    const html = factions.map(fac => {
      const { ci, color, name, subFleets, totalAlive, totalShips } = fac;
      // All fleet IDs under this faction
      const allFids = subFleets.map(sf => sf.fleet.fleetId);

      const subFleetHtml = subFleets
        .filter(({ alive, dead, escaped }) => alive.length > 0 || dead.length > 0 || escaped.length > 0)
        .map(({ fleet: fl, alive, dead, escaped }) => {
        const shipsHtml = alive.map(s => `
          <div class="fleet-ship-entry ${s.id === this.selectedShipId ? 'selected' : ''}"
               data-ship-id="${s.id}" style="padding:2px 8px;font-size:10px;color:#c8d8ff">
            ${s.name}
            <span style="color:${s.hp/s.maxHp > 0.5 ? '#3ddc84' : '#ff6666'}">${Math.round(s.hp)}/${s.maxHp} HP</span>
            ${s._pendingCombatPolicy ? `<span style="color:#ffaa44;font-size:9px"> ⚙${s._combatPolicyTimer}t</span>` : ''}
          </div>`).join('');

        const deadHtml = dead.map(s => `
          <div style="padding:2px 8px;font-size:10px;color:#664444;display:flex;align-items:center;gap:4px">
            <span>💀 ${s.name}</span>
            <button class="btn btn-small revive-ship-btn" data-ship-id="${s.id}"
              style="font-size:8px;padding:0 3px;background:#1a0a0a;border-color:#ff4444;color:#ff6666">+HP</button>
          </div>`).join('');

        const escapedHtml = escaped.map(s => `
          <div style="padding:2px 8px;font-size:10px;color:#446688">
            🌀 ${s.name} <span style="font-size:9px">(hyperespace)</span>
          </div>`).join('');

        if (subFleets.length === 1) return shipsHtml + deadHtml + escapedHtml;

        return `
          <div style="margin-top:4px;border-left:2px solid ${color}44;margin-left:4px;padding-left:6px">
            <div style="font-size:10px;color:${color};margin:2px 0;font-weight:bold">
              ▸ ${fl.name} (${alive.length}/${fl.shipIds?.length||alive.length} vaisseaux)
            </div>
            <!-- Sub-fleet orders -->
            <div style="display:flex;gap:2px;margin:2px 0;flex-wrap:wrap">
              ${['aggressive','neutral','passive','retreat','fuir','embarquement'].map(order => {
                const labels = {aggressive:'⚔',neutral:'🤝',passive:'⏸',retreat:'↩',fuir:'🌀',embarquement:'⚓'};
                const styles = {aggressive:'background:#2a0a0a;border-color:#ff6666;color:#ff9090',
                               fuir:'background:#1a0a2a;border-color:#aa44ff;color:#cc88ff',
                               embarquement:'background:#0a1a2a;border-color:#4fc3f7;color:#4fc3f7'};
                return `<button class="btn fleet-order-btn" data-fleet-order="${order}" data-fid="${fl.fleetId}"
                  style="font-size:8px;padding:1px 4px;${styles[order]||''}">${labels[order]}</button>`;
              }).join('')}
            </div>
            ${shipsHtml}
            ${deadHtml}${escapedHtml}
          </div>`;
      }).join('');

      // Only show order buttons for this player's faction (or all if GM)
      const playerCi  = window._p2pFactionCi ?? -1; // -1 = MJ, no restriction
      const isMyFaction = playerCi < 0 || parseInt(ci) === playerCi;

      return `
        <div class="fleet-item" style="border-left:3px solid ${color};margin-bottom:8px;padding:6px 8px;background:#080d18;border-radius:0 4px 4px 0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="color:${color};font-weight:bold;font-size:12px">◆ ${name}</span>
            <span style="color:#6b7a9e;font-size:10px">${totalAlive}/${totalShips} vaisseaux</span>
          </div>
          <!-- Faction-level orders -->
          ${isMyFaction ? `<div style="display:flex;gap:2px;margin-bottom:4px;flex-wrap:wrap" data-faction-ci="${ci}">
            <button class="btn faction-order-btn" data-order="aggressive" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px;background:#2a0a0a;border-color:#ff6666;color:#ff9090">⚔ Agressif</button>
            <button class="btn faction-order-btn" data-order="ecran" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px;background:#0a1a2a;border-color:#4a9eff;color:#7ab8ff"
              title="Écran de chasseurs : les XS/S protègent les capitaux, n'engagent que les intrus">🛡 Écran</button>
            <button class="btn faction-order-btn" data-order="neutral" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px">🤝 Neutre</button>
            <button class="btn faction-order-btn" data-order="passive" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px">⏸ Passif</button>
            <button class="btn faction-order-btn" data-order="retreat" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px">↩ Retraite</button>
            <button class="btn faction-order-btn" data-order="fuir" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px;background:#1a0a2a;border-color:#aa44ff;color:#cc88ff">🌀 Fuir</button>
            <button class="btn faction-order-btn" data-order="embarquement" data-ci="${ci}"
              style="font-size:9px;padding:2px 5px;background:#0a1a2a;border-color:#4fc3f7;color:#4fc3f7">⚓ Embarquer</button>
          </div>` : `<div style="font-size:9px;color:#3a4a60;padding:2px 0 4px;font-style:italic">🔒 Faction adverse</div>`}
          ${subFleetHtml}
        </div>`;
    }).join('');

    this.$fleetList.innerHTML = html || '<p style="color:#6b7a9e;font-size:12px;padding:8px">Aucune faction active.<br>Ajoutez des flottes via l\'onglet Factions.</p>';

    // Update rally fleet dropdown
    const rallySelect = document.getElementById('rally-fleet-select');
    if (rallySelect) {
      const prev = rallySelect.value;
      rallySelect.innerHTML = '<option value="">— Fleet —</option>' +
        fleets.map(f => `<option value="${f.fleetId}">${f.name}</option>`).join('');
      if (prev) rallySelect.value = prev;
    }

    // Click on a ship → select it
    this.$fleetList.querySelectorAll('[data-ship-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('revive-ship-btn')) return; // handled below
        const ship = state.ships.find(s => s.id === el.dataset.shipId);
        if (ship && ship.alive) this.callbacks.onShipSelect?.(ship);
      });
    });

    // Revive destroyed ship — prompt for HP amount
    this.$fleetList.querySelectorAll('.revive-ship-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ship = state.ships.find(s => s.id === btn.dataset.shipId);
        if (!ship) return;
        const hpStr = prompt(`Redonner des PV à ${ship.name} (max ${ship.maxHp}) :`, Math.round(ship.maxHp * 0.25));
        const hp    = parseInt(hpStr);
        if (isNaN(hp) || hp <= 0) return;
        ship.hp        = Math.min(ship.maxHp, hp);
        ship.alive     = true;
        ship.destroyed = false;
        // Reset shields
        if (ship.shields) { ship.shields.current = 0; ship.shields.disabled = true; ship.shields.restartCounter = 0; }
        this.callbacks.onReviveShip?.(ship.id, hp);
        this.updateFleetList();
      });
    });

    // Faction-level order buttons (applies to all sub-fleets)
    this.$fleetList.querySelectorAll('.faction-order-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const ci    = parseInt(btn.dataset.ci);
        const order = btn.dataset.order;
        // Get all fleet IDs for this faction
        const fids  = fleets.filter(f => f.colorIndex === ci).map(f => f.fleetId);
        this.callbacks.onFactionOrder?.(fids, order);
      });
    });

    // Sub-fleet order buttons (single fleet)
    this.$fleetList.querySelectorAll('.fleet-order-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.callbacks.onFleetOrder?.(btn.dataset.fid, btn.dataset.fleetOrder);
      });
    });
  }
  // EVENT LOG
  // ═══════════════════════════════════════════════════════

  addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${this.state.tick}] ${message}`;
    this.$logEntries.prepend(entry);

    // Limit displayed entries
    const entries = this.$logEntries.querySelectorAll('.log-entry');
    if (entries.length > 60) entries[entries.length - 1].remove();
  }

  // ═══════════════════════════════════════════════════════
  // ORDER MANAGEMENT
  // ═══════════════════════════════════════════════════════

  /** Activates "waiting for click" mode for an order */
  setPendingOrder(type) {
    this.pendingOrder = type;
    if (type) {
      const hints = {
        move:   '🎯 Click on the grid to move',
        attack: '⚔️ Click on the target to attack',
        escort: '🛡 Click on the ally to escort',
      };
      this.$orderHint.textContent = hints[type] || 'Click…';
      this.$orderHint.classList.remove('hidden');
    } else {
      this.$orderHint.classList.add('hidden');
    }
  }

  /** Cancels the pending order */
  cancelPendingOrder() {
    this.pendingOrder = null;
    this.$orderHint.classList.add('hidden');
    document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
  }

  // ═══════════════════════════════════════════════════════
  // EVENT BINDINGS
  // ═══════════════════════════════════════════════════════

  _bindEvents() {
    // ─── Order buttons ────────────────────────
    const orderMap = {
      'btn-order-move':    'move',
      'btn-order-attack':  'attack',
      'btn-order-escort':  'escort',
    };
    Object.entries(orderMap).forEach(([btnId, orderType]) => {
      document.getElementById(btnId)?.addEventListener('click', () => {
        if (this.pendingOrder === orderType) {
          this.cancelPendingOrder();
        } else {
          if (!this.selectedShipId) return;
          document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
          document.getElementById(btnId).classList.add('active');
          this.setPendingOrder(orderType);
          if (orderType === 'move')   this.callbacks.onOrderMove?.(this.selectedShipId);
          if (orderType === 'attack') this.callbacks.onOrderAttack?.(this.selectedShipId);
          if (orderType === 'escort') this.callbacks.onOrderEscort?.(this.selectedShipId);
        }
      });
    });

    // Retreat button
    document.getElementById('btn-order-retreat')?.addEventListener('click', () => {
      if (this.selectedShipId) {
        this.callbacks.onOrderRetreat?.(this.selectedShipId);
        this.cancelPendingOrder();
      }
    });

    // Fuir (flee to hyperspace zone)
    document.getElementById('btn-order-fuir')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      this.callbacks.onOrderFuir?.(this.selectedShipId);
      this.cancelPendingOrder();
    });

    // Bombard button (bombers only — shown/hidden by updateSelectedShip)
    document.getElementById('btn-order-bombard')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-order-bombard').classList.add('active');
      this.setPendingOrder('bombard');
      this.callbacks.onOrderBombard?.(this.selectedShipId);
    });

    // Kamikaze button
    document.getElementById('btn-order-kamikaze')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-order-kamikaze').classList.add('active');
      this.setPendingOrder('kamikaze');
      this.callbacks.onOrderKamikaze?.(this.selectedShipId);
    });

    // Dock button (small ships only)
    document.getElementById('btn-order-dock')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-order-dock')?.classList.add('active');
      this.setPendingOrder('dock');
      this.callbacks.onOrderDock?.(this.selectedShipId);
    });

    // Capture button (tractor-equipped ships only) — pick an enemy to capture
    document.getElementById('btn-order-capture')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-order-capture')?.classList.add('active');
      this.setPendingOrder('capture');
      this.callbacks.onOrderCapture?.(this.selectedShipId);
    });

    // Dock-at-station button — pick a station to fly into
    document.getElementById('btn-order-dock-station')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-order-dock-station')?.classList.add('active');
      this.setPendingOrder('dockStation');
      this.callbacks.onOrderDockStation?.(this.selectedShipId);
    });

    document.getElementById('btn-order-cargo-eject')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      this.callbacks.onCargoEject?.(this.selectedShipId);
    });

    document.getElementById('shield-toggle-check')?.addEventListener('change', (e) => {
      if (!this.selectedShipId) return;
      this.callbacks.onShieldToggle?.(this.selectedShipId);
    });

    document.getElementById('btn-order-dock-ship')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      document.querySelectorAll('.btn-order').forEach(b => b.classList.remove('active'));
      document.getElementById('btn-order-dock-ship')?.classList.add('active');
      this.setPendingOrder('dock');
    });

    document.getElementById('btn-order-undock')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      this.callbacks.onUndock?.(this.selectedShipId);
    });

    document.getElementById('btn-gm-edit-ship')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      this.callbacks.onGMEditShip?.(this.selectedShipId);
    });

    // ─── Behavior select ──────────────────────
    this.$behaviorSel?.addEventListener('change', () => {
      if (!this.selectedShipId) return;
      const mode = this.$behaviorSel.value;
      const hasTarget = ['target', 'escort'].includes(mode);
      this.$behaviorTargetRow?.classList.toggle('hidden', !hasTarget);
      this.callbacks.onBehaviorChange?.(this.selectedShipId, mode, {
        targetId: hasTarget ? (this.$behaviorTargetInput?.value || null) : null,
      });
    });

    this.$behaviorTargetInput?.addEventListener('change', () => {
      if (!this.selectedShipId) return;
      const mode = this.$behaviorSel.value;
      if (['target','escort'].includes(mode)) {
        this.callbacks.onBehaviorChange?.(this.selectedShipId, mode, {
          targetId: this.$behaviorTargetInput.value || null,
        });
      }
    });

    // ─── Named character ──────────────────────
    document.getElementById('named-char-toggle')?.addEventListener('change', e => {
      if (!this.selectedShipId) return;
      this.callbacks.onNamedCharChange?.(this.selectedShipId, 'enabled', e.target.checked);
    });
    document.getElementById('named-char-name')?.addEventListener('input', e => {
      if (!this.selectedShipId) return;
      this.callbacks.onNamedCharChange?.(this.selectedShipId, 'name', e.target.value);
    });
    document.getElementById('named-char-armor')?.addEventListener('change', e => {
      if (!this.selectedShipId) return;
      this.callbacks.onNamedCharChange?.(this.selectedShipId, 'plotArmor', e.target.checked);
    });
    const perfSlider = document.getElementById('named-char-perf');
    const PERF_LABELS = ['','Novice','Novice','Novice','Novice','Competent','Competent','Competent','Competent','Competent','Expert','Expert','Expert','Expert','Expert','Elite','Elite','Elite','Elite','Legendary'];
    perfSlider?.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      const el = document.getElementById('perf-display');
      if (el) el.textContent = v;
      const lbl = document.getElementById('perf-label');
      if (lbl) lbl.textContent = PERF_LABELS[v] || '';
      if (!this.selectedShipId) return;
      this.callbacks.onNamedCharChange?.(this.selectedShipId, 'performance', v);
    });

    // ─── Altitude buttons ─────────────────────
    document.getElementById('btn-alt-up')?.addEventListener('click', () => {
      if (this.selectedShipId) this.callbacks.onAltitudeChange?.(this.selectedShipId, +1);
    });
    document.getElementById('btn-alt-down')?.addEventListener('click', () => {
      if (this.selectedShipId) this.callbacks.onAltitudeChange?.(this.selectedShipId, -1);
    });

    // ─── Energy policy ────────────────────────
    document.getElementById('energy-policy-select')?.addEventListener('change', e => {
      if (!this.selectedShipId) return;
      this.callbacks.onEnergyPolicyChange?.(this.selectedShipId, e.target.value);
    });

    // ─── Combat policy ────────────────────────
    document.getElementById('combat-policy-select')?.addEventListener('change', e => {
      if (!this.selectedShipId) return;
      const ship = this.state?.ships?.find(s => s.id === this.selectedShipId);
      if (!ship) return;
      const newPolicy = e.target.value;
      if (newPolicy === ship.combatPolicy && !ship._pendingCombatPolicy) return;

      const delay = (ship.pilotLevel || 1) >= 5 ? 2 : 3;
      ship._pendingCombatPolicy = newPolicy;
      ship._combatPolicyTimer   = delay;

      const CP_DESC = {
        standard:        'Mode équilibré — aucun bonus ni malus',
        hit_and_run:     '+5% dmg & évasion en mouvement | +3% vitesse',
        blockade:        '-25% vitesse | +7% dmg infligés | -10% dmg subits',
        assault:         '+8% dmg infligés | +3% portée | -5% dmg frontaux',
        blockade_runner: '+5% vitesse | +10% regen boucliers | défensif uniquement',
      };
      const cpProg = document.getElementById('policy-change-progress');
      const cpBar  = document.getElementById('policy-prog-bar');
      const cpTgt  = document.getElementById('policy-target-label');
      const cpDesc = document.getElementById('combat-policy-desc');
      if (cpProg) cpProg.style.display = 'block';
      if (cpBar)  cpBar.style.width = '0%';
      if (cpTgt)  cpTgt.textContent = '→ ' + (CP_DESC[newPolicy] || newPolicy);
      if (cpDesc) cpDesc.textContent = '⏳ Transition (' + delay + ' ticks)…';
    });
    document.getElementById('auto-energy-toggle')?.addEventListener('change', e => {
      if (!this.selectedShipId) return;
      this.callbacks.onAutoEnergyChange?.(this.selectedShipId, e.target.checked);
    });

    // ─── Carrier auto-deploy flags ────────────
    ['fighters','bombers','interceptors'].forEach(type => {
      document.getElementById(`auto-${type}`)?.addEventListener('change', e => {
        if (!this.selectedShipId) return;
        this.callbacks.onCarrierAutoFlag?.(this.selectedShipId, type, e.target.checked);
      });
    });

    // ─── Deploy squadron ──────────────────────
    document.getElementById('btn-deploy-squad')?.addEventListener('click', () => {
      if (!this.selectedShipId) return;
      this.callbacks.onDeploySquadron?.(this.selectedShipId);
    });

    // ─── Altitude filter ──────────────────────
    document.querySelectorAll('.alt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.alt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.callbacks.onAltFilterChange?.(btn.dataset.alt);
      });
    });
  }

  // ─── Helpers ──────────────────────────────────────────
  _ammoCount(ship, weaponType) {
    const map = { torpedo:'torpedoes', missile:'missiles', mine:'mines', bomb:'bombs', bombardment:'bombs' };
    return ship.inventory[map[weaponType]] ?? 0;
  }
}

export default UIManager;
