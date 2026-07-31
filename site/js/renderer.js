/**
 * RENDERER — 2.5D Rendering Engine
 *
 * Draws everything on an HTML5 Canvas.
 *
 * 2.5D Effect:
 *   Ships at higher altitude appear shifted up-right and are more opaque.
 *   Lower altitudes are semi-transparent. The altitude filter can isolate
 *   a specific level.
 *
 * Camera:
 *   - Pan   : WASD/ZQSD or mouse drag (middle/right button)
 *   - Zoom  : mouse wheel
 *   - Rotate: A/E keys (45° steps)
 *
 * The canvas is redrawn every frame via requestAnimationFrame.
 */

import CONFIG from './config.js?v=20250617c';
import { clamp, TYPE_ICONS, SIZE_RADIUS, FLEET_COLORS } from './utils.js?v=20250617c';
import { isStationType } from './background.js?v=20250617c';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {GameState}         state   - Shared state (ships, fleets, projectiles…)
   */
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.state  = state;

    // ─── Camera ───────────────────────────────
    this.camera = {
      x:        0,
      y:        0,
      zoom:     0.12,   // zoomed out for 240x240 grid (loadScenario centers it)
      rotation: 0,
      tilt:     15,     // nearly overhead by default
    };

    // ─── Altitude filter ──────────────────────
    this.altFilter = 'all';  // 'all' | 1 | 2 | 3 | 4 | 5

    // ─── Selection ────────────────────────────
    this.selectedShipId = null;
    this.hoveredShipId  = null;

    // ─── Callbacks ────────────────────────────
    this.onShipClick   = null;   // (ship) => void
    this.onGridClick   = null;   // ({x,y,z}) => void

    // ─── Active keys ──────────────────────────
    this._keys = {};

    // ─── Mouse drag ───────────────────────────
    this._drag = null;

    this._bindEvents();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    // Also resize after full page load (flex layout might not be settled at module load)
    window.addEventListener('load', () => this._resize());
  }

  // ═══════════════════════════════════════════════════════
  // RESIZE
  // ═══════════════════════════════════════════════════════

  _resize() {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth  || window.innerWidth  - 260; // 260 = left+right panels
    const h = parent?.clientHeight || window.innerHeight - 48;  // 48 = topbar height
    if (w > 0) this.canvas.width  = w;
    if (h > 0) this.canvas.height = h;
    // Note: camera position is managed externally (loadScenario centers it)
    // Do NOT reset camera.x/y here — that would override loadScenario's positioning
  }

  // ═══════════════════════════════════════════════════════
  // MAIN RENDER LOOP
  // ═══════════════════════════════════════════════════════

  /** Called by app.js via requestAnimationFrame */
  render() {
    this._processKeys();

    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // If canvas has no pixels yet, force resize and skip frame
    if (!W || !H) { this._resize(); return; }

    // ─── Background ───────────────────────────
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, W, H);

    // camera.tilt: angle from vertical (10°=overhead, 88°=near-horizontal), default 15°
    if (!this.camera.tilt) this.camera.tilt = 15;
    const perspY = Math.cos(this.camera.tilt * Math.PI / 180);

    // ─── Projection MONDE → écran (identique à la grille/aux vaisseaux) ──
    // Un corps placé à une coordonnée monde y reste collé sous tous les angles.
    const worldProject = (wx, wy) => {
      let x = (wx - this.camera.x - W / 2) * this.camera.zoom;
      let y = (wy - this.camera.y - H / 2) * this.camera.zoom;
      const rot = this.camera.rotation * Math.PI / 180;
      const rx = x * Math.cos(rot) - y * Math.sin(rot);
      const ry = x * Math.sin(rot) + y * Math.cos(rot);
      return { x: rx + W / 2, y: (ry * perspY) + H / 2 };
    };
    this._worldProject = worldProject;

    // ─── Projection CIEL LOINTAIN (étoiles, planètes, soleils) ──
    // Champ céleste en coordonnées ÉCRAN normalisées (-1..1 = bord d'écran),
    // ancré à la caméra. Il TOURNE pleinement avec la vue (on passe autour des
    // astres) et DÉRIVE légèrement avec la translation/le zoom (parallaxe), mais
    // couvre TOUJOURS tout l'écran quelle que soit la profondeur — fini le petit
    // carré central. nx,ny ∈ [-1,1] ; depth>1 = plus loin (dérive plus faible).
    const skyRot = this.camera.rotation * Math.PI / 180;
    const skyCos = Math.cos(skyRot), skySin = Math.sin(skyRot);
    const skyPersp = (1 + perspY) / 2;
    // Dérive de parallaxe en fraction d'écran (la caméra translate → le ciel
    // glisse un peu). Normalisée par une grande distance pour rester subtile.
    // Dérive de parallaxe douce (le ciel glisse un peu quand la caméra translate).
    // Réduite à 0.15 pour que les corps proches restent dans le cadre.
    const skyDriftX = ((this.camera.x % 80000) / 80000) * 0.15;
    const skyDriftY = ((this.camera.y % 80000) / 80000) * 0.15;
    const skyProject = (nx, ny, depth = 1) => {
      // Étalement : 0.8× la grande dimension écran → couvre tout le cadre + marge
      const spread = Math.max(W, H) * 0.8;
      let x = (nx - skyDriftX / depth) * spread;
      let y = (ny - skyDriftY / depth) * spread;
      const rx = x * skyCos - y * skySin;
      const ry = x * skySin + y * skyCos;
      return { x: rx + W / 2, y: ry * skyPersp + H / 2 };
    };
    this._skyProject = skyProject;

    // ─── Projection ANCRÉE AU PLATEAU (planètes, soleils) ──
    // Les corps sont solidaires du plateau : ils tournent EXACTEMENT dans le
    // même sens (même séquence scale perspY → rotate que la transform monde),
    // mais sont placés LOIN et suivent la translation à parallaxe réduit pour
    // donner la distance. Un corps « au-dessus du coin nord » y reste collé
    // quand on pivote, juste plus loin → impression de profondeur.
    const plateauRot = this.camera.rotation * Math.PI / 180;
    const pCos = Math.cos(plateauRot), pSin = Math.sin(plateauRot);
    const PARALLAX = 0.22;   // plus lointain → translation plus faible
    // Les corps célestes flottent AU-DESSUS du plan de la grille (vers
    // l'horizon), pas dessus. On réduit leur perspY (moins écrasés au sol) et on
    // les remonte d'un offset vertical → ils sont clairement « derrière/au loin »
    // et ne se confondent plus avec le plateau couvert par la grille.
    const skyPerspY = (perspY + 1) / 2;        // moitié moins écrasé que le sol
    const horizonLift = H * 0.12;              // remontée vers l'horizon
    const plateauProject = (wx, wy) => {
      let x = (wx - this.camera.x - W / 2) * this.camera.zoom * PARALLAX;
      let y = (wy - this.camera.y - H / 2) * this.camera.zoom * PARALLAX;
      const rx = x * pCos - y * pSin;
      const ry = x * pSin + y * pCos;
      return { x: rx + W / 2, y: ry * skyPerspY + H / 2 - horizonLift };
    };
    this._plateauProject = plateauProject;

    // ─── Étoiles (ciel qui entoure — toujours visibles) ──
    this._drawStars(skyProject);

    // ─── Arrière-plan configurable (planètes/soleils ancrés au plateau) ──
    if (this._drawBackgroundFn) {
      const terrType = this.state.terrainConfig?.type || null;
      // Pour chaque Étoile de la Mort en tir, calculer le point ÉCRAN de la
      // cible (reprojeté chaque frame) → le rayon s'arrêtera exactement dessus.
      const bg = this.state.background;
      if (bg?.bodies) {
        for (const b of bg.bodies) {
          if (isStationType(b.type) && b._fireTargetWorld && b._fireProgress != null) {
            const tw = b._fireTargetWorld;
            b._fireTargetScreen = (tw.kind === 'ship')
              ? worldProject(tw.x, tw.y)
              : plateauProject(tw.x, tw.y);
          } else if (b._fireTargetScreen && b._fireProgress == null) {
            b._fireTargetScreen = null;
          }
        }
      }
      this._drawBackgroundFn(ctx, this.state.background, this.camera, W, H, terrType, skyProject, plateauProject);

      // ── Surbrillance des planètes ciblables (mode tir Étoile de la Mort) ──
      if (this._bodyTargetMode && bg?.bodies) {
        const cs = CONFIG.CELL_SIZE, grid = CONFIG.GRID_COLS * cs;
        const REF_ZOOM = 0.05, zoomRatio = this.camera.zoom / REF_ZOOM;
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
        for (const b of bg.bodies) {
          if (isStationType(b.type)) continue;
          const wx = (b.x - 0.5) * grid * 3.5 + grid / 2;
          const wy = (b.y - 0.5) * grid * 3.5 + grid / 2;
          const p = plateauProject(wx, wy);
          const rr = Math.max(14, b.r * H * zoomRatio);
          ctx.save();
          ctx.strokeStyle = `rgba(255,180,80,${0.5 + pulse * 0.5})`;
          ctx.lineWidth = 2 + pulse * 2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath(); ctx.arc(p.x, p.y, rr * 1.25, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(255,200,120,0.9)';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('🎯 CIBLE', p.x, p.y - rr * 1.4);
          ctx.restore();
        }
      }
    }

    // ─── Camera transform ─────────────────────
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, perspY);
    ctx.rotate(this.camera.rotation * Math.PI / 180);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(
      -this.camera.x - W / 2,
      -this.camera.y - H / 2
    );

    // ─── Grid ─────────────────────────────────
    this._drawGrid();

    // ─── Terrain (nebula, debris, asteroids) ──
    this._drawTerrain();

    // ─── Ships (sorted by altitude for correct overlap) ─
    this._drawShips();

    // ─── Projectiles ──────────────────────────
    this._drawProjectiles();
    this._drawExplosions();
    this._drawHyperspaceRoutes();

    ctx.restore();

    // ─── Superlaser au PREMIER PLAN (par-dessus les vaisseaux) ──
    // Le rayon part de la station (arrière-plan) et frappe la cible (vaisseau ou
    // planète). Dessiné ici pour passer DEVANT le champ de bataille et finir
    // pile sur la cible avec un impact visible.
    const fgBg = this.state.background;
    if (this._drawSuperlaserFn && fgBg?.bodies && this._plateauProject && this._worldProject) {
      const fgGrid = CONFIG.GRID_COLS * CONFIG.CELL_SIZE;
      for (const b of fgBg.bodies) {
        if (isStationType(b.type) && b._fireProgress != null && b._fireProgress >= 0.45) {
          const wx = (b.x - 0.5) * fgGrid * 3.5 + fgGrid / 2;
          const wy = (b.y - 0.5) * fgGrid * 3.5 + fgGrid / 2;
          const origin = this._plateauProject(wx, wy);
          let tgt = b._fireTargetScreen;
          if (b._fireTargetWorld) {
            const tw = b._fireTargetWorld;
            tgt = (tw.kind === 'ship') ? this._worldProject(tw.x, tw.y) : this._plateauProject(tw.x, tw.y);
          }
          if (tgt) this._drawSuperlaserFn(ctx, origin, tgt, b._fireProgress);
        }
      }
    }

    if (this.state.terrainConfig?.type === 'ice_field') {
      const t = Date.now() / 1000;
      // 3 nappes de brume qui dérivent à des vitesses différentes (profondeur)
      for (let i = 0; i < 3; i++) {
        const drift = (t * (8 + i * 5)) % (W + 400) - 200;
        const yy = H * (0.2 + i * 0.3) + Math.sin(t * 0.3 + i) * 30;
        const g = ctx.createRadialGradient(drift, yy, 0, drift, yy, W * 0.5);
        g.addColorStop(0, `rgba(180,215,240,${0.05 - i * 0.008})`);
        g.addColorStop(1, 'rgba(180,215,240,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // Voile bleu froid uniforme très léger
      ctx.fillStyle = 'rgba(150,195,230,0.04)';
      ctx.fillRect(0, 0, W, H);
    }

    // L.* sont en px CSS (souris) ; le canvas dessine en px bitmap.
    // On convertit CSS→bitmap pour que le rectangle s'affiche au bon endroit.
    if (this._lasso) {
      const L = this._lasso;
      const sX = (this.canvas.width  || 1) / (this.canvas.clientWidth  || 1);
      const sY = (this.canvas.height || 1) / (this.canvas.clientHeight || 1);
      const x = Math.min(L.x0, L.x1) * sX, y = Math.min(L.y0, L.y1) * sY;
      const w = Math.abs(L.x1 - L.x0) * sX, h = Math.abs(L.y1 - L.y0) * sY;
      ctx.save();
      ctx.strokeStyle = '#ffdd00';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle   = 'rgba(255,221,0,0.10)';
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ─── HUD overlay (always on top) ──────────
    this._drawCameraInfo();

    // ─── DEBUG OVERLAY — shows state even if nothing else works ─────
    const shipCount = this.state.ships?.filter(s => s.alive)?.length ?? 0;
    if (shipCount === 0) {
      ctx.fillStyle = 'rgba(255,100,100,0.85)';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ No ships loaded — canvas ${W}×${H} zoom:${this.camera.zoom.toFixed(3)}`, W / 2, H / 2);
      ctx.fillText(`cam: (${this.camera.x.toFixed(0)}, ${this.camera.y.toFixed(0)})`, W / 2, H / 2 + 20);
      ctx.textAlign = 'left';
    }
  }

  // ═══════════════════════════════════════════════════════
  // STARS (BACKGROUND)
  // ═══════════════════════════════════════════════════════

  _drawStars(skyProject) {
    // Étoiles en coordonnées CIEL normalisées (-1.3..1.3, marge pour la rotation)
    // → couvrent tout l'écran de bord à bord, plus le débord des coins.
    if (!this._stars) {
      this._stars = Array.from({ length: 500 }, () => ({
        nx: (Math.random() - 0.5) * 2.6,
        ny: (Math.random() - 0.5) * 2.6,
        r:  Math.random() * 1.3 + 0.2,
        a:  Math.random() * 0.7 + 0.2,
      }));
    }
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    for (const s of this._stars) {
      const p = skyProject(s.nx, s.ny, 3.2);  // couche la plus lointaine (dérive minime)
      if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,220,255,${s.a})`;
      ctx.fill();
    }
  }

  // ═══════════════════════════════════════════════════════
  // GRID
  // ═══════════════════════════════════════════════════════

  _drawGrid() {
    const ctx  = this.ctx;
    const cs   = CONFIG.CELL_SIZE;
    const cols = CONFIG.GRID_COLS;
    const rows = CONFIG.GRID_ROWS;

    // Semi-transparent grid — stars show through
    ctx.fillStyle = 'rgba(16, 22, 42, 0.35)';
    ctx.fillRect(0, 0, cols * cs, rows * cs);

    // Grid lines — subtle
    ctx.strokeStyle = 'rgba(50, 70, 120, 0.4)';
    ctx.lineWidth   = 0.5;

    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cs, 0);
      ctx.lineTo(c * cs, rows * cs);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cs);
      ctx.lineTo(cols * cs, r * cs);
      ctx.stroke();
    }

    // Coordinates every 5 cells
    ctx.fillStyle = 'rgba(60, 90, 160, 0.5)';
    ctx.font      = '9px monospace';
    for (let c = 0; c < cols; c += 5) {
      for (let r = 0; r < rows; r += 5) {
        ctx.fillText(`${c},${r}`, c * cs + 3, r * cs + 10);
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // SHIPS
  // ═══════════════════════════════════════════════════════

  _drawShips() {
    const ctx      = this.ctx;
    const cs       = CONFIG.CELL_SIZE;
    const allAlive = [...this.state.ships].filter(s => s.alive).sort((a, b) => a.position.z - b.position.z);

    // ─── Fog of War: player mode only sees ships within allied vision ──
    // OPTIMISATION : ce calcul est O(alliés × tous les vaisseaux). Il était
    // refait à CHAQUE FRAME (jusqu'à 60×/s) alors que les positions ne
    // changent qu'une fois par TIC (toutes les ~3.5s, interpolées visuellement
    // entre les deux). On le met en cache et on ne le recalcule qu'au
    // changement de tic (ou après 300ms en secours).
    const session = window.SESSION;
    let visibleIds = null; // null = show all (GM mode)
    if (session && !session.isGM && !session.isSpectator && session.fleetId) {
      const now0 = Date.now();
      const fogStale = !this._fogCache ||
        this._fogCache.tick !== this.state.tick ||
        (now0 - this._fogCache.computedAt) > 300;
      if (fogStale) {
        const ids = new Set();
        const allies = allAlive.filter(s => s.fleetId === session.fleetId);
        for (const s of allAlive) {
          if (s.fleetId === session.fleetId) { ids.add(s.id); continue; }
          for (const ally of allies) {
            const vr = ally.visionRange ?? (CONFIG.VISION_RANGE?.[ally.size] ?? 20);
            const dx = s.position.x - ally.position.x;
            const dy = s.position.y - ally.position.y;
            if (dx*dx + dy*dy <= vr*vr) { ids.add(s.id); break; }
          }
        }
        this._fogCache = { tick: this.state.tick, computedAt: now0, ids };
      }
      visibleIds = this._fogCache.ids;
    }

    const ships = visibleIds ? allAlive.filter(s => visibleIds.has(s.id)) : allAlive;

    // Time-based progress for animation (0=start of tick, 1=end)
    const now      = Date.now();
    const elapsed  = now - (this.state.lastTickTime || now);
    const interval = this.state.tickInterval || CONFIG.TICK_INTERVAL_MS;
    const progress = Math.min(1, Math.max(0, elapsed / interval));

    for (const ship of ships) {
      const z = Math.round(ship.position.z);

      // Initialise prev pos on first appearance
      if (ship._prevX === undefined || ship._prevX === null) {
        ship._prevX    = ship.position.x;
        ship._prevY    = ship.position.y;
        ship._prevHeading = ship.heading ?? 0;
      }

      // ── Cubic Bézier arc using heading tangents ──────────────────────────
      // Ships follow a curved arc matching the actual simulation path.
      const prevX = ship._prevX;
      const prevY = ship._prevY;
      const dist  = Math.sqrt((ship.position.x - prevX)**2 + (ship.position.y - prevY)**2);

      let rx, ry;
      if (dist < 0.05) {
        rx = ship.position.x;
        ry = ship.position.y;
      } else {
        const ph    = ship._prevHeading ?? 0;
        const ch    = ship.heading      ?? 0;
        const scale = dist * 0.45 * cs; // tangent length

        const p0x = prevX * cs + cs/2;
        const p0y = prevY * cs + cs/2;
        const p3x = ship.position.x * cs + cs/2;
        const p3y = ship.position.y * cs + cs/2;
        // Control points along the heading vectors
        const cp1x = p0x + Math.cos(ph) * scale;
        const cp1y = p0y + Math.sin(ph) * scale;
        const cp2x = p3x - Math.cos(ch) * scale;
        const cp2y = p3y - Math.sin(ch) * scale;

        const mt  = 1 - progress;
        const bx  = mt**3 * p0x + 3*mt**2*progress*cp1x + 3*mt*progress**2*cp2x + progress**3*p3x;
        const by  = mt**3 * p0y + 3*mt**2*progress*cp1y + 3*mt*progress**2*cp2y + progress**3*p3y;
        rx = (bx - cs/2) / cs;
        ry = (by - cs/2) / cs;
      }
      ship._rx = rx;
      ship._ry = ry;

      // ALL ships always visible — filter is opacity-only
      let opacity;
      if (this.altFilter === 'all') {
        opacity = CONFIG.ALTITUDE_OPACITY[z] || 0.5;
      } else if (z === this.altFilter) {
        opacity = 1.0;
      } else {
        opacity = Math.max(0.12, CONFIG.ALTITUDE_OPACITY[z] * 0.35);
      }

      ctx.globalAlpha = opacity;
      this._drawShip(ship, z, rx, ry);
      ctx.globalAlpha = 1;
    }
  }

  /** Draws a single ship on the canvas using interpolated render positions */
  _drawShip(ship, z, rx, ry) {
    // Safety guard
    if (!ship?.position || typeof ship.position.x !== 'number') return;
    const ctx = this.ctx;
    const cs  = CONFIG.CELL_SIZE;

    // ─── Smooth altitude transition animation ─────────────────────────
    if (ship._displayZ === undefined || ship._displayZ === null) {
      ship._displayZ = ship.position.z;
    } else {
      const diff = ship.position.z - ship._displayZ;
      if (Math.abs(diff) > 0.01) {
        ship._displayZ += Math.sign(diff) * Math.min(Math.abs(diff), 0.05);
      } else {
        ship._displayZ = ship.position.z;
      }
    }

    const altOffset = ship._displayZ - 1;
    const sx = rx * cs + cs / 2 + altOffset * CONFIG.ALTITUDE_X_OFFSET;
    const sy = ry * cs + cs / 2 - altOffset * CONFIG.ALTITUDE_Y_OFFSET;

    const radius = SIZE_RADIUS[ship.size] || 10;

    // ── Position ÉCRAN réelle (source de vérité pour clic + lasso) ──
    // Calcul EXPLICITE de la transform caméra (identique à render()) :
    //   translate(W/2,H/2) → scale(1,perspY) → rotate → scale(zoom) → translate(-camX-W/2, -camY-H/2)
    // Plus fiable que getTransform() qui dépend du timing de la pile de contexte.
    {
      const W = this.canvas.width, H = this.canvas.height;
      const perspY = Math.cos((this.camera.tilt || 15) * Math.PI / 180);
      const rot    = this.camera.rotation * Math.PI / 180;
      const zoom   = this.camera.zoom;
      // Appliquer dans l'ordre inverse de la pile (du plus interne au plus externe)
      let wx = sx - this.camera.x - W / 2;
      let wy = sy - this.camera.y - H / 2;
      wx *= zoom; wy *= zoom;                          // scale(zoom)
      const rxr = wx * Math.cos(rot) - wy * Math.sin(rot); // rotate
      const ryr = wx * Math.sin(rot) + wy * Math.cos(rot);
      let px = rxr;
      let py = ryr * perspY;                            // scale(1, perspY)
      px += W / 2; py += H / 2;                         // translate(W/2, H/2)
      // bitmap px → CSS px
      const scaleX = this.canvas.clientWidth  / (W || 1);
      const scaleY = this.canvas.clientHeight / (H || 1);
      ship._screenX = px * scaleX;
      ship._screenY = py * scaleY;
      ship._screenR = Math.max(10, radius * zoom * perspY * scaleX + 4);
    }
    const fleet  = this.state.fleets.find(f => f.fleetId === ship.fleetId);
    // Color priority: fleet.colorIndex → ship._factionColorIndex → default blue
    const rawCi  = fleet?.colorIndex ?? ship._factionColorIndex;
    const ci     = (typeof rawCi === 'number' && !isNaN(rawCi)) ? rawCi : 0;
    const color  = FLEET_COLORS[ci % FLEET_COLORS.length] || '#4488ff';

    // Adaptive radius: cell-based but never smaller than 2 screen pixels
    const minWorldR = 2 / Math.max(0.001, this.camera.zoom);
    const r         = Math.max(radius, minWorldR);
    const heading   = ship._displayHeading ?? (ship.heading || 0);
    const isSelected = ship.id === this.selectedShipId ||
      (this.selectedShipIds && this.selectedShipIds.includes(ship.id));
    const isHovered  = ship.id === this.hoveredShipId;

    // ─── Hyperspace ARRIVAL animation ────────────────────────
    // ── Puits de gravité (interdicteur) : cercle violet pulsant ──
    if ((ship.gravityWell || 0) > 0 && ship.alive) {
      const pulse = 0.5 + 0.2 * Math.sin(Date.now() / 600);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, ship.gravityWell * CONFIG.CELL_SIZE, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(170, 68, 255, ${0.10 + pulse * 0.10})`;
      ctx.lineWidth   = 2 / Math.max(0.01, this.camera.zoom);
      ctx.setLineDash([12, 18]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Remplissage très léger
      ctx.fillStyle = `rgba(170, 68, 255, 0.03)`;
      ctx.fill();
      ctx.restore();
    }

    // ── Animation de DÉPART hyperespace (inverse de l'arrivée) ──
    if (ship._departingToHyper) {
      const elapsed  = Date.now() - (ship._departStartTime || 0);
      const progress = Math.min(1, elapsed / (ship._departDuration || 1200));
      ctx.save();
      // Le vaisseau s'étire dans sa direction (pseudo-motion blur) puis disparaît
      const stretch = 1 + progress * 6;          // étirement croissant
      const alpha   = 1 - progress;              // fondu sortant
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      ctx.rotate(ship.heading ?? 0);
      ctx.scale(stretch, Math.max(0.2, 1 - progress * 0.8)); // long et fin
      ctx.translate(-sx, -sy);
      // Trainée lumineuse violette derrière
      ctx.beginPath();
      ctx.moveTo(sx - r * stretch * 1.5, sy);
      ctx.lineTo(sx + r, sy);
      ctx.strokeStyle = '#aa44ff';
      ctx.lineWidth   = Math.max(1.5, r * 0.25);
      ctx.shadowBlur  = 18; ctx.shadowColor = '#aa44ff';
      ctx.globalAlpha = alpha * 0.7;
      ctx.stroke();
      ctx.restore();
      // Anneau blanc en expansion (inverse de l'anneau contractant d'arrivée)
      ctx.save();
      ctx.globalAlpha = (1 - progress) * 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, r * (1 + progress * 3.5), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = Math.max(1.5, r * 0.2);
      ctx.shadowBlur  = 14; ctx.shadowColor = '#aa44ff';
      ctx.stroke();
      ctx.restore();
      if (progress >= 0.55) return; // le vaisseau lui-même disparaît à mi-animation
    }

    if (ship._arrivingFromHyper) {
      const elapsed  = Date.now() - (ship._arriveStartTime || 0);
      // Ship hasn't started arriving yet — show as tiny purple dot
      if (elapsed < 0) {
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(Date.now() / 200);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#aa44ff';
        ctx.fill();
        ctx.restore();
        return; // don't render full ship yet
      }
      const progress = Math.min(1, elapsed / (ship._arriveDuration || 1500));
      if (progress >= 1) {
        ship._arrivingFromHyper = false; // animation done
      } else {
        // Streak / flash effect — white ring contracting inward
        const streakR = r * (4 - progress * 3);
        ctx.save();
        ctx.globalAlpha = 1 - progress;
        ctx.beginPath();
        ctx.arc(sx, sy, streakR, 0, Math.PI * 2);
        ctx.strokeStyle = '#aa44ff';
        ctx.lineWidth   = Math.max(2, r * 0.3);
        ctx.shadowBlur  = 20; ctx.shadowColor = '#aa44ff';
        ctx.stroke();
        // Bright white flash
        ctx.beginPath();
        ctx.arc(sx, sy, r * (1 + (1 - progress) * 2), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(1 - progress) * 0.6})`;
        ctx.fill();
        ctx.restore();
        ctx.shadowBlur = 0;
      }
    }

    // ─── Hyperspace jump charging effect ─────────────────────
    if (ship._jumpingToHyperspace) {
      const elapsed  = Date.now() - (ship._jumpStartTime || 0);
      const progress = Math.min(1, elapsed / (ship._jumpDuration || 2500));
      const ringR    = r * (1 + progress * 3);
      ctx.beginPath();
      ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(170,68,255,${0.9 - progress * 0.6})`;
      ctx.lineWidth   = Math.max(2, r * 0.2);
      ctx.shadowBlur  = 20; ctx.shadowColor = '#aa44ff';
      ctx.stroke(); ctx.shadowBlur = 0;
      // Bright white center
      ctx.beginPath();
      ctx.arc(sx, sy, r * (0.5 + progress * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${progress * 0.9})`;
      ctx.fill();
    }

    // ─── Selection ring ─────────────────────
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = CONFIG.SELECTION_COLOR;
      ctx.lineWidth   = 2; ctx.stroke();
      const pulsR = r + 9 + Math.sin(Date.now() / 300) * 3;
      ctx.beginPath();
      ctx.arc(sx, sy, pulsR, 0, Math.PI * 2);
      ctx.strokeStyle = CONFIG.SELECTION_COLOR + '55';
      ctx.lineWidth   = 1.5; ctx.stroke();
    }
    if (isHovered && !isSelected) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth   = 1; ctx.stroke();
    }

    // ─── Named character halo ───────────────
    if (ship.namedCharacter?.enabled) {
      const perf = ship.namedCharacter.performance || 10;
      const halo = r + 12 + Math.sin(Date.now() / 800) * 3;
      const hColors = [null,'#00ffff','#00ffff','#ffdd00','#ffdd00',
        '#ffdd00','#ff8800','#ff8800','#ff3300','#ff3300','#ffffff'];
      const hc = hColors[Math.min(perf, 10)] || '#00ffff';
      ctx.beginPath(); ctx.arc(sx, sy, halo, 0, Math.PI * 2);
      ctx.strokeStyle = hc; ctx.lineWidth = 2;
      ctx.shadowColor = hc; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
    }

    // ─── Shield arc ──────────────────────────
    if (ship.shields?.max > 0) {
      const shieldPct = Math.max(0, (ship.shields.current || 0) / ship.shields.max);
      if (shieldPct > 0.01) {
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shieldPct);
        ctx.strokeStyle = `rgba(100,200,255,${0.4 + shieldPct * 0.5})`;
        ctx.lineWidth = 3; ctx.shadowBlur = 6; ctx.shadowColor = '#64c8ff';
        ctx.stroke(); ctx.shadowBlur = 0;
      }
    }

    // ─── Ship hull — circle ──────────────────
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle   = color + 'cc';
    ctx.shadowBlur  = 6; ctx.shadowColor = color;
    ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.shadowBlur  = 0;

    // ─── Chevron direction indicator ─────────────────────────
    // Single chevron at normal speed, double if engines boosted
    const isBoosted = ship.energyPolicy === 'engines' ||
                      (ship.velocity && Math.hypot(ship.velocity.x, ship.velocity.y) > (ship.speed || 1) * 1.15);
    const armLen  = Math.max(r * 0.6, 3);
    const armA    = 0.52;          // angle of chevron arms (~30°)
    const tipDist = r + Math.max(r * 0.7, 4);
    const lw      = Math.max(1.5, r * 0.12);

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(heading);
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    const drawChevron = (tip) => {
      const bx = tip - armLen * Math.cos(armA);
      const by = armLen * Math.sin(armA);
      ctx.beginPath();
      ctx.moveTo(bx, -by);
      ctx.lineTo(tip, 0);
      ctx.lineTo(bx,  by);
      ctx.stroke();
    };

    drawChevron(tipDist);
    if (isBoosted) {
      const gap = armLen * Math.cos(armA) * 0.9;
      ctx.globalAlpha = 0.7;
      drawChevron(tipDist - gap);
      ctx.globalAlpha = 1;
    }
    ctx.restore();


    // ─── Type icon ──────────────────────────
    const icon = TYPE_ICONS[ship.type] || '?';
    ctx.fillStyle    = '#ffffff';
    ctx.font         = `${Math.max(8, r * 0.9)}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, sx, sy);

    // ─── Ship name (below ship, counter-rotated for readability) ──
    if (!['XS', 'S'].includes(ship.size) || isSelected) {
      ctx.save();
      ctx.translate(sx, sy + r + 4);
      ctx.rotate(-this.camera.rotation * Math.PI / 180);
      ctx.fillStyle    = '#c8d8ff';
      ctx.font         = '10px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(ship.name, 0, 0);
      ctx.restore();
    }

    // ─── Altitude badge (top-right corner of ship bounding box) ──
    if (this.altFilter === 'all') {
      const bx = sx + r * 0.7 + 4;
      const by = sy - r * 0.7 - 4;
      ctx.fillStyle   = '#1a2535';
      ctx.strokeStyle = color;
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle    = color;
      ctx.font         = 'bold 8px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z, bx, by);
    }

    // ─── HP bar (capital ships only) ────────
    if (['L', 'XL', 'XXL'].includes(ship.size)) {
      const barW = Math.max(r * 2.5, 30);
      const barH = 4;
      const bx   = sx - barW / 2;
      const by   = sy - r - barH - 4;
      const pct  = ship.hp / ship.maxHp;

      ctx.fillStyle = '#0a0c10';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = pct > 0.5 ? '#3ddc84' : pct > 0.25 ? '#ffa726' : '#ff4a4a';
      ctx.fillRect(bx, by, barW * pct, barH);
    }

    // ─── Movement indicator ──────────────────
    if (ship.moveTarget) {
      const tx = ship.moveTarget.x * cs + cs / 2;
      const ty = ship.moveTarget.y * cs + cs / 2;
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = color + '55';
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Destination cross
      ctx.beginPath();
      ctx.arc(tx, ty, 3, 0, Math.PI * 2);
      ctx.fillStyle = color + '88';
      ctx.fill();
    }

    // ─── Ion disabled lightning arcs ─────────────────────
    if (ship.ionDisabled || (ship._ionHitTime && Date.now() - ship._ionHitTime < 900)) {
      const now  = Date.now();
      const age  = ship._ionHitTime ? (now - ship._ionHitTime) / 900 : 0;
      const flicker = Math.sin(now / 40) * 0.5 + 0.5;
      const alpha   = ship.ionDisabled ? (0.6 + flicker * 0.4) : Math.max(0, 1 - age);
      ctx.globalAlpha = alpha;

      // Draw 4-6 random sparks around the ship
      const sparks = ship.ionDisabled ? 6 : 4;
      for (let i = 0; i < sparks; i++) {
        const angle1 = (i / sparks) * Math.PI * 2 + now * 0.003;
        const r1  = r * (0.3 + Math.random() * 0.8);
        const ax1 = sx + Math.cos(angle1) * r1;
        const ay1 = sy + Math.sin(angle1) * r1;
        const angle2 = angle1 + (Math.random() - 0.5) * 1.5;
        const r2  = r * (0.4 + Math.random() * 0.7);
        const ax2 = sx + Math.cos(angle2) * r2;
        const ay2 = sy + Math.sin(angle2) * r2;

        ctx.beginPath();
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(sx + (Math.random() - 0.5) * r * 0.5, sy + (Math.random() - 0.5) * r * 0.5);
        ctx.lineTo(ax2, ay2);
        ctx.strokeStyle = '#44aaff';
        ctx.lineWidth   = 0.8;
        ctx.shadowBlur  = 6;
        ctx.shadowColor = '#4488ff';
        ctx.stroke();
      }
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
    }

    // ─── Named character halo ─────────────────────────
    if (ship.namedCharacter?.enabled) {
      const perf = ship.namedCharacter.performance || 1;
      // Color gradient: lv1-5 teal, 6-10 gold, 11-15 orange, 16-19 red, 20 white
      const haloColor = perf >= 20 ? '#ffffff' : perf >= 16 ? '#ff6644' :
                        perf >= 11 ? '#ffaa22' : perf >= 6  ? '#ffdd44' : '#44ddff';
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 500 + ship._id?.charCodeAt(0) || 0);

      // Animated pulsing outer ring
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4 + perf * 0.15, 0, Math.PI * 2);
      ctx.strokeStyle = haloColor;
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.6 * pulse;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = haloColor;
      ctx.stroke();
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;

      // Performance number
      ctx.save();
      ctx.translate(sx, sy - r - 8);
      ctx.rotate(-this.camera.rotation * Math.PI / 180);
      ctx.fillStyle   = haloColor;
      ctx.font        = 'bold 9px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'bottom';
      ctx.fillText(`★${ship.namedCharacter.name || ship.name} P${perf}`, 0, 0);
      ctx.restore();
    }

    // ─── Heading arrow (direction the ship is facing) ────
    this._drawHeadingArrow(ctx, sx, sy, r, ship.heading ?? 0, color);

    // ─── Persistent attack target indicator ─────────────
    if (ship.permanentOrder?.type === 'attack') {
      const tgt = this.state.ships.find(s => s.id === ship.permanentOrder.targetId && s.alive);
      if (tgt) {
        const tz  = Math.round(tgt.position.z);
        const tao = tz - 1;
        const tx  = tgt.position.x * cs + cs / 2 + tao * CONFIG.ALTITUDE_X_OFFSET;
        const ty  = tgt.position.y * cs + cs / 2 - tao * CONFIG.ALTITUDE_Y_OFFSET;
        ctx.beginPath();
        ctx.setLineDash([4, 5]);
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = '#ff4a4a88';
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Reset text alignment
    ctx.textAlign   = 'left';
    ctx.textBaseline= 'alphabetic';
  }

  /**
   * Draws a chevron arrow indicating ship heading direction.
   * Arrow points in the direction of `heading` (radians).
   */
  _drawHeadingArrow(ctx, cx, cy, shipRadius, heading, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(heading);

    const d  = shipRadius + 4;   // distance from ship center to arrow base
    const hw = shipRadius * 0.45; // half-width of the chevron
    const hl = shipRadius * 0.7;  // length of the chevron

    // Draw a chevron (like image 2 — two angled lines forming >)
    ctx.beginPath();
    ctx.moveTo(d + hl, 0);          // tip
    ctx.lineTo(d,      -hw);        // top-left
    ctx.lineTo(d + hl * 0.35, 0);   // inner notch
    ctx.lineTo(d,       hw);        // bottom-left
    ctx.closePath();

    ctx.fillStyle   = color + 'dd';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  /** Draws a hexagon centered at (x,y) with radius r */
  _drawHex(ctx, x, y, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + r * Math.cos(angle);
      const py = y + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle   = color + 'aa';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // ═══════════════════════════════════════════════════════
  // PROJECTILES
  // ═══════════════════════════════════════════════════════

  _drawProjectiles() {
    const ctx = this.ctx;
    const cs  = CONFIG.CELL_SIZE;
    const now = Date.now();

    this.state.projectiles = this.state.projectiles.filter(p => {
      const age = now - p.startTime;
      const expired = age >= p.travelMs;
      if (expired) {
        // Missed torpedo/missile: spawn explosion at endpoint
        if (p.missExplosion) {
          const tz  = Math.round(p.to.z || 3);
          this.state.explosions = this.state.explosions || [];
          this.state.explosions.push({
            x: p.to.x, y: p.to.y, z: tz,
            startTime: Date.now(),
            radius: 1.2,
            color: '#ff7722',
          });
        }
        // Ion: no explosion, just disappears
        return false;
      }
      return age < p.travelMs + 600; // keep laser/energy a bit for fade
    });

    for (const proj of this.state.projectiles) {
      const age   = now - proj.startTime;
      const t     = Math.min(1, age / proj.travelMs);
      const alpha = t > 1 ? Math.max(0, 1 - (t - 1) / 0.6) : 1;

      const fz  = Math.round(proj.from.z || 3);
      const fao = fz - 1;
      const fx  = proj.from.x * cs + cs/2 + fao * CONFIG.ALTITUDE_X_OFFSET;
      const fy  = proj.from.y * cs + cs/2 - fao * CONFIG.ALTITUDE_Y_OFFSET;

      // Hit shots track the target's live interpolated position
      let tx_, ty_;
      const tz  = Math.round(proj.to.z || 3);
      const tao = tz - 1;
      if (proj.targetId) {
        const tShip = this.state.ships.find(s => s.id === proj.targetId && s.alive);
        if (tShip) {
          const tas = Math.round(tShip.position.z || 3) - 1;
          tx_ = (tShip._rx ?? tShip.position.x) * cs + cs/2 + tas * CONFIG.ALTITUDE_X_OFFSET;
          ty_ = (tShip._ry ?? tShip.position.y) * cs + cs/2 - tas * CONFIG.ALTITUDE_Y_OFFSET;
        } else {
          tx_ = proj.to.x * cs + cs/2 + tao * CONFIG.ALTITUDE_X_OFFSET;
          ty_ = proj.to.y * cs + cs/2 - tao * CONFIG.ALTITUDE_Y_OFFSET;
        }
      } else {
        tx_ = proj.to.x * cs + cs/2 + tao * CONFIG.ALTITUDE_X_OFFSET;
        ty_ = proj.to.y * cs + cs/2 - tao * CONFIG.ALTITUDE_Y_OFFSET;
      }

      // Missed shots fade out gracefully
      const ea = proj.missed
        ? alpha * (t < 0.85 ? 1 : Math.max(0.05, 1 - (t - 0.85) / 0.5))
        : alpha;
      ctx.globalAlpha = Math.max(0.05, ea);

      const angle    = Math.atan2(ty_ - fy, tx_ - fx);
      const totalLen = Math.sqrt((tx_ - fx) ** 2 + (ty_ - fy) ** 2);

      if (proj.continuous) {
        // ─── Sustained beam ─────────────────────────────
        const pulse = 0.6 + 0.4 * Math.sin(now / 40 + proj.startTime);
        ctx.globalAlpha = ea * pulse;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx_, ty_);
        ctx.strokeStyle = proj.color; ctx.lineWidth = (proj.boltWidth || 1) * 2.5;
        ctx.shadowBlur = 12; ctx.shadowColor = proj.color; ctx.stroke();
        ctx.lineWidth = (proj.boltWidth || 1) * 0.5; ctx.strokeStyle = '#ffffff';
        ctx.shadowBlur = 0; ctx.stroke();

      } else if (proj.type === 'ion') {
        // ─── Ion bolt: small blue energy ball + tiny trail ──
        for (let b = 0; b < (proj.count || 1); b++) {
          const bt = Math.min(1, Math.max(0, t - b * 0.05));
          if (bt <= 0) continue;
          const bx = fx + (tx_ - fx) * bt;
          const by = fy + (ty_ - fy) * bt;

          // Short crackling trail
          const trailLen = Math.min(cs * 0.6, totalLen * bt * 0.3);
          const txT = bx - Math.cos(angle) * trailLen;
          const tyT = by - Math.sin(angle) * trailLen;
          if (trailLen > 2) {
            const tg = ctx.createLinearGradient(txT, tyT, bx, by);
            tg.addColorStop(0, 'rgba(68,136,255,0)');
            tg.addColorStop(1, 'rgba(100,180,255,0.6)');
            ctx.beginPath(); ctx.moveTo(txT, tyT); ctx.lineTo(bx, by);
            ctx.strokeStyle = tg; ctx.lineWidth = 2; ctx.lineCap = 'round';
            ctx.shadowBlur = 4; ctx.shadowColor = '#4488ff'; ctx.stroke();
          }

          // Small glowing ball (ion charge)
          const br  = 2.5 + (proj.boltWidth || 0.75);
          const grd = ctx.createRadialGradient(bx, by, 0, bx, by, br * 2);
          grd.addColorStop(0, '#ddeeff');
          grd.addColorStop(0.4, '#4499ff');
          grd.addColorStop(1, 'transparent');
          ctx.beginPath(); ctx.arc(bx, by, br * 2, 0, Math.PI * 2);
          ctx.fillStyle = grd; ctx.shadowBlur = 10; ctx.shadowColor = '#4488ff';
          ctx.fill(); ctx.shadowBlur = 0;
        }

      } else if (proj.type === 'torpedo' || proj.type === 'missile' || proj.type === 'bomb') {
        // ─── Torpedo / Missile: smoke trail + glowing ball ──
        for (let b = 0; b < (proj.count || 1); b++) {
          const bt = Math.min(1, Math.max(0, t - b * 0.06));
          if (bt <= 0) continue;
          const bx = fx + (tx_ - fx) * bt;
          const by = fy + (ty_ - fy) * bt;
          const trailLen = Math.min(cs * 3.5, totalLen * bt);
          const txT = bx - Math.cos(angle) * trailLen;
          const tyT = by - Math.sin(angle) * trailLen;

          if (trailLen > 3) {
            // Smoke (grey, wide)
            const sg = ctx.createLinearGradient(txT, tyT, bx, by);
            sg.addColorStop(0, 'rgba(60,60,60,0)');
            sg.addColorStop(0.5, 'rgba(140,140,140,0.3)');
            sg.addColorStop(1, 'rgba(200,200,200,0.5)');
            ctx.beginPath(); ctx.moveTo(txT, tyT); ctx.lineTo(bx, by);
            ctx.strokeStyle = sg; ctx.lineWidth = 5; ctx.lineCap = 'round';
            ctx.shadowBlur = 0; ctx.stroke();
            // Hot core exhaust
            const cg = ctx.createLinearGradient(txT, tyT, bx, by);
            cg.addColorStop(0, 'transparent');
            cg.addColorStop(1, proj.color + 'bb');
            ctx.beginPath(); ctx.moveTo(txT + (bx-txT)*0.4, tyT + (by-tyT)*0.4);
            ctx.lineTo(bx, by); ctx.strokeStyle = cg; ctx.lineWidth = 2; ctx.stroke();
          }
          // Glowing warhead ball
          const br  = (proj.boltWidth || 0.75) * 4;
          const grd = ctx.createRadialGradient(bx, by, 0, bx, by, br * 2.5);
          grd.addColorStop(0, '#ffffff');
          grd.addColorStop(0.25, proj.color === '#ff8833' ? '#ffcc55' : proj.color);
          grd.addColorStop(0.7, proj.color + '66');
          grd.addColorStop(1, 'transparent');
          ctx.beginPath(); ctx.arc(bx, by, br * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = grd; ctx.shadowBlur = 18; ctx.shadowColor = proj.color;
          ctx.fill(); ctx.shadowBlur = 0;
        }

      } else {
        // ─── Energy bolt (laser / ion) ──────────────────
        const count     = proj.count || 1;
        const boltLenPx = (proj.boltLen || 0.15) * cs;
        const boltWidth = proj.boltWidth || 0.75;

        for (let b = 0; b < count; b++) {
          const bt = Math.min(1, Math.max(0, t - b / count * 0.12));
          if (bt <= 0) continue;
          const sideOff = count > 1 ? (b % 2 === 0 ? 1 : -1) * Math.ceil(b / 2) * 2 : 0;
          const px  = fx + (tx_ - fx) * bt - Math.sin(angle) * sideOff;
          const py  = fy + (ty_ - fy) * bt + Math.cos(angle) * sideOff;
          const td  = Math.min(boltLenPx, totalLen * bt);
          const px2 = px - Math.cos(angle) * td;
          const py2 = py - Math.sin(angle) * td;

          // Ion: disintegrates — crackle + fade at end of range
          if (proj.type === 'ion' && proj.missed) {
            const fadeAlpha = Math.max(0, 1 - bt * 1.1);
            ctx.globalAlpha = ea * fadeAlpha;
            // Random crackle sparks near bolt head
            if (fadeAlpha < 0.6) {
              for (let s = 0; s < 3; s++) {
                const sa = angle + (Math.random() - 0.5) * 1.2;
                const sr = (1 - fadeAlpha) * boltLenPx * 1.5 * Math.random();
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + Math.cos(sa) * sr, py + Math.sin(sa) * sr);
                ctx.strokeStyle = '#88ccff'; ctx.lineWidth = 0.8;
                ctx.shadowBlur = 4; ctx.shadowColor = '#4488ff';
                ctx.stroke();
              }
            }
          } else if (proj.type === 'laser' && proj.missed && proj.weaponRange && proj.fromDist) {
            // Laser miss: fade linearly from target-distance to 3× weapon range past
            const travelledCells = bt * totalLen / cs;
            const fadeStart = proj.fromDist;
            const fadeEnd   = proj.fromDist + proj.weaponRange * 2;
            const fadeFactor = Math.max(0.02, 1 - Math.max(0, travelledCells - fadeStart) / Math.max(1, fadeEnd - fadeStart));
            ctx.globalAlpha = ea * fadeFactor;
          } else {
            ctx.globalAlpha = Math.max(0.02, ea);
          }

          // Outer glow
          ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px, py);
          ctx.strokeStyle = proj.color + '55';
          ctx.lineWidth = boltWidth * 4; ctx.shadowBlur = 6;
          ctx.shadowColor = proj.color; ctx.lineCap = 'round'; ctx.stroke();
          // Core
          ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px, py);
          ctx.strokeStyle = proj.color; ctx.lineWidth = boltWidth * 1.8;
          ctx.shadowBlur = 3; ctx.stroke();
          // White tip
          ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px, py);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = boltWidth * 0.55;
          ctx.shadowBlur = 0; ctx.stroke();
        }
        ctx.lineCap = 'butt';
        ctx.globalAlpha = Math.max(0.02, ea);
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
  }

  /**
   * Draws hyperspace ZONES — large circular entry areas.
   * Ships with hyperdrive that are inside can use the "Fuir" order to jump.
   */
  _drawHyperspaceRoutes() {
    const routes = this.state.hyperspaceRoutes;
    if (!routes?.length) return;
    const ctx = this.ctx;
    const cs  = CONFIG.CELL_SIZE;
    const now = Date.now();
    const ZONE_RADIUS_CELLS = 18; // 18-cell radius zone

    for (const route of routes) {
      const wx = route.x * cs + cs / 2;
      const wy = route.y * cs + cs / 2;
      const wr = ZONE_RADIUS_CELLS * cs; // world pixels
      const pulse = 0.85 + 0.15 * Math.sin(now / 800 + route.x);

      // Zone fill (subtle)
      ctx.beginPath();
      ctx.arc(wx, wy, wr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(170,68,255,0.06)';
      ctx.fill();

      // Zone border (pulsing dashes)
      ctx.beginPath();
      ctx.arc(wx, wy, wr * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(170,68,255,0.55)';
      ctx.lineWidth   = 2;
      ctx.setLineDash([12, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Central beacon
      ctx.beginPath();
      ctx.arc(wx, wy, 10, 0, Math.PI * 2);
      ctx.fillStyle   = '#aa44ffcc';
      ctx.shadowBlur  = 15;
      ctx.shadowColor = '#aa44ff';
      ctx.fill();
      ctx.shadowBlur  = 0;

      // Label
      ctx.fillStyle    = '#cc88ff';
      ctx.font         = `bold ${Math.max(12, cs * 0.22)}px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`⚡ HJ ${route.label || ''}`, wx, wy - 14);

      // "Zone d'hyper" sub-label
      ctx.font         = `${Math.max(9, cs * 0.16)}px monospace`;
      ctx.fillStyle    = '#9966cc';
      ctx.fillText('Zone Hyperespace', wx, wy + 18);
    }
  }

  /**
   * Returns the screen position of a ship for lasso hit testing.
   * Uses the cached _rx, _ry and _displayZ from the last render frame.
   */
  _shipScreenPos(ship) {
    const cs   = CONFIG.CELL_SIZE;
    const rx   = ship._rx ?? ship.position.x;
    const ry   = ship._ry ?? ship.position.y;
    const ao   = (ship._displayZ ?? ship.position.z ?? 3) - 1;
    const wx   = rx * cs + cs/2 + ao * CONFIG.ALTITUDE_X_OFFSET;
    const wy   = ry * cs + cs/2 - ao * CONFIG.ALTITUDE_Y_OFFSET;
    const W    = this.canvas.width, H = this.canvas.height;
    const z    = this.camera.zoom;
    const tilt = Math.cos((this.camera.tilt || 15) * Math.PI / 180);
    const rot  = ((this.camera.rotation ?? 0) * Math.PI) / 180;
    const dx   = wx - this.camera.x;
    const dy   = wy - this.camera.y;
    // Full camera transform matching actual rendering pipeline
    const rx2  = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry2  = dx * Math.sin(rot) + dy * Math.cos(rot);
    return { x: rx2 * z + W/2, y: ry2 * z * tilt + H/2 };
  }

  /** Render terrain bodies: nebula clouds, asteroids, debris, black hole */
  _drawTerrain() {
    const terrain = this.state.terrain;
    if (!terrain?.length) return;
    const ctx  = this.ctx;
    const cs   = CONFIG.CELL_SIZE;
    const tc   = this.state.terrainConfig;

    for (const body of terrain) {
      if (body.destroyed) continue;
      const sx = body.x * cs + cs / 2;
      const sy = body.y * cs + cs / 2;
      const r  = body.radius * cs;

      ctx.save();

      if (body.type === 'nebula_cloud') {
        // Couleurs de la palette de l'amas (variées selon la nébuleuse)
        const c0 = body._c0 || [100,60,200];
        const c1 = body._c1 || [60,30,150];
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grad.addColorStop(0,   `rgba(${c0[0]},${c0[1]},${c0[2]},0.24)`);
        grad.addColorStop(0.5, `rgba(${c1[0]},${c1[1]},${c1[2]},0.13)`);
        grad.addColorStop(1,   `rgba(${c1[0]},${c1[1]},${c1[2]},0)`);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        // Bordure tamisée de la même teinte
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${c0[0]},${c0[1]},${c0[2]},0.15)`;
        ctx.lineWidth = 2;
        ctx.stroke();

      } else if (body.type === 'black_hole_core') {
        // Black hole — animated event horizon
        const t  = Date.now() / 1000;
        const rr = r; // r est DÉJÀ en px monde (radius × cs) — double × cs = map entière
        // Dark accretion disk
        const gBH = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr * 3);
        gBH.addColorStop(0,   '#000000');
        gBH.addColorStop(0.35,'rgba(20,0,0,0.95)');
        gBH.addColorStop(0.6, 'rgba(80,20,0,0.5)');
        gBH.addColorStop(1,   'rgba(80,20,0,0)');
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 3, 0, Math.PI * 2);
        ctx.fillStyle = gBH;
        ctx.fill();
        // Photon ring
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 1.4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,${80+40*Math.sin(t*2)},0,0.8)`;
        ctx.lineWidth   = rr * 0.4;
        ctx.shadowBlur  = 20; ctx.shadowColor = '#ff6600';
        ctx.stroke();
        ctx.shadowBlur  = 0;

      } else if (body.type === 'ice_shard') {
        // Petit fragment de glace : éclat anguleux translucide bleu-blanc
        const seed = (body.id || '').split('').reduce((a,ch)=>a+ch.charCodeAt(0),0);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(body._spin || (seed % 628)/100);
        ctx.beginPath();
        // Petit losange/éclat irrégulier
        const rr = r;
        ctx.moveTo(0, -rr);
        ctx.lineTo(rr*0.5, 0);
        ctx.lineTo(0, rr*0.8);
        ctx.lineTo(-rr*0.4, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(190,225,255,0.55)';
        ctx.strokeStyle = 'rgba(230,245,255,0.7)';
        ctx.lineWidth = Math.max(0.4, rr*0.15);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

      } else if (body.type === 'debris' || body.type === 'explosive_debris') {
        // ── Débris de vaisseaux : carcasses anguleuses métalliques ──
        const hpr = body.hp / body.maxHp;
        const seed = (body.id || '').split('').reduce((a,ch)=>a+ch.charCodeAt(0),0);
        const rot  = (seed % 628) / 100; // orientation stable par débris
        ctx.translate(sx, sy);
        ctx.rotate(rot);
        // Forme : fragment de coque allongé et irrégulier (pseudo-aléatoire stable)
        ctx.beginPath();
        const pts = 6 + (seed % 3);
        for (let i = 0; i < pts; i++) {
          const a  = (i / pts) * Math.PI * 2;
          // Rayon irrégulier + élongation (les coques sont longues)
          const rv = r * (0.45 + ((seed * (i+3)) % 100) / 160) * (1 + 0.7 * Math.abs(Math.cos(a)));
          const px = Math.cos(a) * rv, py = Math.sin(a) * rv * 0.55;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        // Coque métallique gris-bleuté, plus sombre si endommagé
        const grad = ctx.createLinearGradient(-r, -r, r, r);
        grad.addColorStop(0, body.type === 'explosive_debris' ? '#4a3020' : '#3a4250');
        grad.addColorStop(1, body.type === 'explosive_debris' ? '#2a1810' : '#1e242e');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = body.type === 'explosive_debris' ? '#aa5522' : '#5a6878';
        ctx.lineWidth = Math.max(1, r * 0.06);
        ctx.stroke();
        // Détails : lignes de structure (poutres, plaques arrachées)
        ctx.strokeStyle = 'rgba(120,140,170,0.35)';
        ctx.lineWidth = Math.max(0.5, r * 0.03);
        ctx.beginPath();
        ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.7, 0);
        ctx.moveTo(-r * 0.3, -r * 0.3); ctx.lineTo(-r * 0.3, r * 0.3);
        ctx.moveTo(r * 0.25, -r * 0.25); ctx.lineTo(r * 0.25, r * 0.25);
        ctx.stroke();
        // Lueur orange des débris explosifs (réacteurs instables)
        if (body.type === 'explosive_debris') {
          const pulse = 0.4 + 0.3 * Math.sin(Date.now()/400 + seed);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,120,30,${pulse})`;
          ctx.shadowBlur = 10; ctx.shadowColor = '#ff6600';
          ctx.fill(); ctx.shadowBlur = 0;
        }
        ctx.rotate(-rot);
        ctx.translate(-sx, -sy);

      } else {
        // Asteroid / debris
        const hp_ratio = body.hp / body.maxHp;
        const color    = body.isExplosive ? '#ff6600' :
                         body.type === 'asteroid' ? '#887766' : '#556677';
        const pulse    = body.isExplosive ? 0.7 + 0.3 * Math.sin(Date.now() / 300) : 1;
        ctx.globalAlpha = 0.85 * pulse;
        ctx.beginPath();
        // Irregular shape via bezier (seed from id)
        const seed = body.id.split('_')[1] | 0;
        const pts  = 7;
        for (let i = 0; i <= pts; i++) {
          const a  = (i / pts) * Math.PI * 2;
          const rr = r * (0.65 + 0.35 * Math.sin(a * 3 + seed) * Math.cos(a * 2 + seed * 0.7));
          i === 0 ? ctx.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr)
                  : ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle   = color;
        ctx.strokeStyle = body.isExplosive ? '#ff4400' : '#99887755';
        ctx.lineWidth   = 1.5;
        ctx.shadowBlur  = body.isExplosive ? 8 : 0;
        ctx.shadowColor = '#ff4400';
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur  = 0;

        // HP damage cracks
        if (hp_ratio < 0.5) {
          ctx.globalAlpha = 0.4 * (1 - hp_ratio);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(sx - r * 0.3, sy - r * 0.2);
          ctx.lineTo(sx + r * 0.1, sy + r * 0.4);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  /** Each explosion: expanding ring + flash bloom at the impact site. */
  _drawExplosions() {
    const ctx  = this.ctx;
    const cs   = CONFIG.CELL_SIZE;
    const now  = Date.now();

    if (!this.state.explosions?.length) return;

    // Clean up expired
    const maxDur = { impact: 400, spark: 300, default: 1200 };
    this.state.explosions = this.state.explosions.filter(e => {
      const dur = maxDur[e.type] || maxDur.default;
      return Date.now() < e.startTime + dur;
    });

    for (const ex of this.state.explosions) {
      const age = Date.now() - ex.startTime;
      if (age < 0) continue;

      const z   = Math.round(ex.z || 3);
      const ao  = z - 1;
      const cx  = ex.x * cs + cs/2 + ao * CONFIG.ALTITUDE_X_OFFSET;
      const cy  = ex.y * cs + cs/2 - ao * CONFIG.ALTITUDE_Y_OFFSET;

      // ─── Impact/spark particles (fast, small) ─────────────
      const dur = maxDur[ex.type] || maxDur.default;
      if (ex.type === 'impact' || ex.type === 'spark') {
        const t   = age / dur;
        const r   = ex.radius * cs * (0.3 + t * 1.5);
        const a   = Math.max(0, 1 - t * 1.4);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = ex.color || '#ffaa44';
        ctx.shadowBlur  = 8;
        ctx.shadowColor = ex.color || '#ffaa44';
        ctx.fill();
        if (t < 0.4) {
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
        continue;
      }

      const t   = age / dur;       // 0→1
      const r   = ex.radius * cs * t * 1.4;   // expanding radius
      const a   = Math.max(0, 1 - t * 1.2);   // fading alpha

      ctx.save();
      ctx.globalAlpha = a;

      // Outer shockwave ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = ex.color || '#ff6622';
      ctx.lineWidth   = cs * 0.08 * (1 - t * 0.8);
      ctx.shadowBlur  = 18;
      ctx.shadowColor = ex.color || '#ff6622';
      ctx.stroke();

      // Inner flash (only in first 30% of animation)
      if (t < 0.35) {
        const flashT = t / 0.35;
        const flashR = ex.radius * cs * 0.6 * (1 - flashT);
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, flashR);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.3, '#ffdd88');
        grd.addColorStop(0.7, ex.color || '#ff6622');
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(cx, cy, flashR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.shadowBlur  = 25;
        ctx.shadowColor = '#ffffff';
        ctx.fill();
      }

      // Secondary smaller rings (debris)
      for (let i = 0; i < 3; i++) {
        const offset = (i + 1) * 0.28;
        const tr = Math.max(0, t - offset);
        if (tr <= 0) continue;
        const sr = ex.radius * cs * 0.5 * tr;
        const sa = Math.max(0, (1 - tr / 0.7) * 0.6);
        ctx.globalAlpha = a * sa;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(i * 2.1) * r * 0.3, cy + Math.sin(i * 2.1) * r * 0.3, sr, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff9944';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8;
        ctx.stroke();
      }

      ctx.restore();
    }
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
  }

  // ═══════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════

  _drawCameraInfo() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(74,158,255,0.6)';
    ctx.font      = '11px monospace';
    ctx.fillText(
      `zoom: ${this.camera.zoom.toFixed(2)}  rot: ${this.camera.rotation.toFixed(0)}°  tilt: ${(this.camera.tilt || 49).toFixed(0)}°`,
      this.canvas.width - 160,
      this.canvas.height - 20
    );
  }

  // ═══════════════════════════════════════════════════════
  // CAMERA CONTROLS
  // ═══════════════════════════════════════════════════════

  _processKeys() {
    // Don't process movement keys when actively typing in a text field
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

    const speed = (CONFIG.CAMERA_PAN_SPEED / this.camera.zoom) * (this._shiftHeld ? 2.0 : 1.0);
    const rot   = -(this.camera.rotation * Math.PI / 180);

    let dx = 0, dy = 0;
    // ZQSD (AZERTY) and WASD (QWERTY) — pan only, no arrow keys
    // Physical key codes — layout-independent (KeyW = AZERTY-Z = QWERTY-W)
    if (this._keys['KeyW']) dy -= 1;   // AZERTY: Z, QWERTY: W
    if (this._keys['KeyS']) dy += 1;   // S on both
    if (this._keys['KeyA']) dx -= 1;   // AZERTY: Q, QWERTY: A
    if (this._keys['KeyD']) dx += 1;   // D on both

    if (dx !== 0 || dy !== 0) {
      this.camera.x += (Math.cos(rot) * dx - Math.sin(rot) * dy) * speed;
      this.camera.y += (Math.sin(rot) * dx + Math.cos(rot) * dy) * speed;
    }

    // Arrow keys: Left/Right = horizontal rotation, Up/Down = vertical tilt (camera pitch)
    if (this._keys['ArrowLeft'])  this.camera.rotation -= CONFIG.ROTATION_SPEED;
    if (this._keys['ArrowRight']) this.camera.rotation += CONFIG.ROTATION_SPEED;
    // Vertical tilt: 10° = nearly overhead, 88° = nearly horizontal
    if (this._keys['ArrowUp'])    this.camera.tilt = Math.max(10, (this.camera.tilt || 49) - 0.8);
    if (this._keys['ArrowDown'])  this.camera.tilt = Math.min(88, (this.camera.tilt || 49) + 0.8);

    // A/E also rotate (alternative)
    if (this._keys['KeyQ']) this.camera.rotation -= CONFIG.ROTATION_SPEED; // AZERTY: A
    if (this._keys['KeyE']) this.camera.rotation += CONFIG.ROTATION_SPEED; // E

    // Keep rotation in [0, 360)
    this.camera.rotation = ((this.camera.rotation % 360) + 360) % 360;
  }

  // ═══════════════════════════════════════════════════════
  // EVENT BINDING
  // ═══════════════════════════════════════════════════════

  _bindEvents() {
    const canvas = this.canvas;

    // ─── Lasso selection (clic gauche maintenu sur zone vide) ──────
    this._lasso = null;
    this._dragStart = null;

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      this._dragStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: Date.now(),
      };
    });

    // mousemove sur WINDOW : le lasso continue même si le curseur sort du canvas
    window.addEventListener('mousemove', e => {
      if (!this._dragStart) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (Math.abs(cx - this._dragStart.x) > 5 || Math.abs(cy - this._dragStart.y) > 5) {
        this._lasso = { x0: this._dragStart.x, y0: this._dragStart.y, x1: cx, y1: cy };
      }
    });

    // mouseup sur WINDOW : capture le relâchement où qu'il arrive
    window.addEventListener('mouseup', e => {
      if (e.button !== 0) { return; }
      if (this._lasso) {
        const L = this._lasso;
        const xMin = Math.min(L.x0, L.x1), xMax = Math.max(L.x0, L.x1);
        const yMin = Math.min(L.y0, L.y1), yMax = Math.max(L.y0, L.y1);
        const alive = this.state.ships.filter(s => s.alive);
        // Recalculer les positions écran MAINTENANT (indépendant du dernier frame dessiné)
        const selected = alive.filter(s => {
          const p = this._worldToScreen(s._rx ?? s.position.x, s._ry ?? s.position.y, s.position.z);
          s._screenX = p.x; s._screenY = p.y;
          const r = s._screenR || 14;
          return (p.x + r >= xMin && p.x - r <= xMax && p.y + r >= yMin && p.y - r <= yMax);
        });
        if (selected.length > 0) this._showLassoToast(`${selected.length} vaisseaux sélectionnés`, true);

        if (selected.length > 0 && this._onLassoSelect) {
          this._onLassoSelect(selected.map(s => s.id));
        }
        this._suppressNextClick = true;
        this._didDrag = true;
      }
      this._lasso     = null;
      this._dragStart = null;
    });

    canvas.addEventListener('click', e => {
      if (this._suppressNextClick) { this._suppressNextClick = false; return; }
      if (this._didDrag) { this._didDrag = false; return; }
      const worldPos = this._screenToWorld(e.offsetX, e.offsetY);
      this._handleClick(worldPos, e);
    });

    window.addEventListener('keydown', e => {
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
      // Use e.code (physical key) so modifier keys don't cause stuck keys
      this._keys[e.code] = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._shiftHeld = true;
    });
    window.addEventListener('keyup', e => {
      this._keys[e.code] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._shiftHeld = false;
    });
    window.addEventListener('blur', () => {
      // Clear all held keys when window loses focus (prevents stuck keys)
      Object.keys(this._keys).forEach(k => { this._keys[k] = false; });
      this._shiftHeld = false;
    });

    // ─── Wheel (zoom) ─────────────────────────────────────────────────────────
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.09;
      this.camera.zoom = clamp(this.camera.zoom * factor, CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX);
    }, { passive: false });

    // ─── Mouse drag (middle/right button) ────────────────────────────────────
    canvas.addEventListener('mousedown', e => {
      if (e.button === 1 || e.button === 2) {
        this._drag = { sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y };
        this._didDrag = false;
        e.preventDefault();
      }
    });
    window.addEventListener('mousemove', e => {
      if (this._drag) {
        const dx = (e.clientX - this._drag.sx) / this.camera.zoom;
        const dy = (e.clientY - this._drag.sy) / this.camera.zoom;
        this.camera.x = this._drag.cx - dx;
        this.camera.y = this._drag.cy - dy;
        this._didDrag = true;
      }
      // Hover detection
      const worldPos = this._screenToWorld(e.offsetX, e.offsetY);
      this._updateHover(worldPos, e);
    });
    window.addEventListener('mouseup', () => { this._drag = null; });

    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Projette une position monde (cases) → coordonnées écran CSS px.
   *  Méthode unique réutilisée par le rendu ET le lasso : zéro divergence possible. */
  _worldToScreen(rxCells, ryCells, zAlt = 3) {
    const cs = CONFIG.CELL_SIZE;
    const W = this.canvas.width, H = this.canvas.height;
    const perspY = Math.cos((this.camera.tilt || 15) * Math.PI / 180);
    const rot    = this.camera.rotation * Math.PI / 180;
    const zoom   = this.camera.zoom;
    const ao = zAlt - 1;
    const sx = rxCells * cs + cs/2 + ao * CONFIG.ALTITUDE_X_OFFSET;
    const sy = ryCells * cs + cs/2 - ao * CONFIG.ALTITUDE_Y_OFFSET;
    let wx = sx - this.camera.x - W/2;
    let wy = sy - this.camera.y - H/2;
    wx *= zoom; wy *= zoom;
    const rxr = wx * Math.cos(rot) - wy * Math.sin(rot);
    const ryr = wx * Math.sin(rot) + wy * Math.cos(rot);
    const px = rxr + W/2;
    const py = ryr * perspY + H/2;
    const scaleX = this.canvas.clientWidth  / (W || 1);
    const scaleY = this.canvas.clientHeight / (H || 1);
    return { x: px * scaleX, y: py * scaleY };
  }

  /** Toast de diagnostic lasso affiché à l'écran (pas dans la console) */
  _showLassoToast(text, ok) {
    let el = document.getElementById('lasso-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lasso-toast';
      el.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:99999;'
        + 'background:#0a0f1d;border:1px solid #2a3550;border-radius:6px;padding:6px 12px;'
        + 'font-family:monospace;font-size:11px;color:#c8d8ff;box-shadow:0 2px 10px #000a;pointer-events:none;max-width:90vw';
      document.body.appendChild(el);
    }
    el.style.borderColor = ok ? '#33aa66' : '#ffaa44';
    el.style.color = ok ? '#88ddaa' : '#ffcc88';
    el.textContent = (ok ? '✓ ' : '⚠ ') + text;
    el.style.display = 'block';
    clearTimeout(this._lassoToastTimer);
    this._lassoToastTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  _rotateCamera(deg) {
    this.camera.rotation = (this.camera.rotation + deg) % 360;
  }

  /** Converts screen coordinates to world grid position {x, y} */
  _screenToWorld(sx, sy) {
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const cs  = CONFIG.CELL_SIZE;
    const rot = -this.camera.rotation * Math.PI / 180;

    // Inverse of: translate(W/2,H/2) → scale(1,PERSP_Y) → rotate(rot) → scale(zoom) → translate(-cx,-cy)
    // Step 1: undo translate(W/2, H/2)
    const sx_c = sx - W / 2;
    const sy_c = sy - H / 2;
    // Step 2: undo scale(1, PERSP_Y) — Y was compressed in screen space
    const sx_p = sx_c;
    const sy_p = sy_c / CONFIG.PERSPECTIVE_Y;
    // Step 3: undo scale(zoom, zoom)
    const sx_z = sx_p / this.camera.zoom;
    const sy_z = sy_p / this.camera.zoom;
    // Step 4: undo rotate(rot) — apply inverse rotation
    const wx = (Math.cos(rot) * sx_z - Math.sin(rot) * sy_z) + this.camera.x + W / 2;
    const wy = (Math.sin(rot) * sx_z + Math.cos(rot) * sy_z) + this.camera.y + H / 2;

    return {
      x: wx / cs,
      y: wy / cs,
      z: this.state.ships.find(s => s.id === this.selectedShipId)?.position.z || 1,
    };
  }

  /** Handles a click on the canvas */
  _handleClick(worldPos, _evt) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = _evt ? _evt.clientX - rect.left : undefined;
    const sy = _evt ? _evt.clientY - rect.top  : undefined;

    // ── Mode désignation de CORPS (planète pour tir DS, ou station pour docking) ──
    if (this._bodyTargetMode && this._plateauProject && sx !== undefined) {
      const W = this.canvas.width, H = this.canvas.height;
      const scaleX = W / (this.canvas.clientWidth || 1), scaleY = H / (this.canvas.clientHeight || 1);
      const bx = sx * scaleX, by = sy * scaleY;
      const cs = CONFIG.CELL_SIZE, grid = CONFIG.GRID_COLS * cs;
      const REF_ZOOM = 0.05, zoomRatio = this.camera.zoom / REF_ZOOM;
      const bodies = this.state.background?.bodies || [];
      const wantStation = this._bodyTargetKind === 'station';
      for (const b of bodies) {
        const bodyIsStation = isStationType(b.type);
        if (wantStation) {
          // Docking : station OU planète dotée d'une cale (hangarVolume défini
          // par le MJ) — une planète peut accueillir des vaisseaux au sol.
          if (!bodyIsStation && b.hangarVolume == null) continue;
        } else {
          if (bodyIsStation) continue;    // cible planète (tir DS) : ignorer stations
        }
        const wx = (b.x - 0.5) * grid * 3.5 + grid / 2;
        const wy = (b.y - 0.5) * grid * 3.5 + grid / 2;
        const p = this._plateauProject(wx, wy);
        const r = Math.max(14, b.r * H * zoomRatio);
        if (Math.hypot(bx - p.x, by - p.y) <= r) {
          this._bodyTargetMode = false;
          this.onBodyClick?.(b);
          return;
        }
      }
      // Clic à côté : annuler le mode
      this._bodyTargetMode = false;
      this.onBodyClick?.(null);
      return;
    }

    const hit = this._shipAtPos(worldPos, sx, sy);
    if (hit) {
      this.selectedShipId = hit.id;
      this.onShipClick?.(hit);
      return;
    }

    // ── Clic GÉNÉRIQUE sur une planète/station d'arrière-plan (hors mode de
    //    ciblage spécial) : affiche un toast d'info. Permet d'identifier
    //    n'importe quel corps en jeu sans avoir à passer par un ordre. ──
    if (this._plateauProject && sx !== undefined) {
      const W = this.canvas.width, H = this.canvas.height;
      const scaleX = W / (this.canvas.clientWidth || 1), scaleY = H / (this.canvas.clientHeight || 1);
      const bx = sx * scaleX, by = sy * scaleY;
      const cs = CONFIG.CELL_SIZE, grid = CONFIG.GRID_COLS * cs;
      const REF_ZOOM = 0.05, zoomRatio = this.camera.zoom / REF_ZOOM;
      const bodies = this.state.background?.bodies || [];
      for (const b of bodies) {
        const wx = (b.x - 0.5) * grid * 3.5 + grid / 2;
        const wy = (b.y - 0.5) * grid * 3.5 + grid / 2;
        const p = this._plateauProject(wx, wy);
        const r = Math.max(14, b.r * H * zoomRatio);
        if (Math.hypot(bx - p.x, by - p.y) <= r) {
          this.onBackgroundBodyInfoClick?.(b);
          return;
        }
      }
    }

    this.onGridClick?.({
      x: Math.floor(worldPos.x),
      y: Math.floor(worldPos.y),
      z: worldPos.z,
    });
  }

  _updateHover(worldPos, evt) {
    const rect = this.canvas.getBoundingClientRect();
    const hit  = this._shipAtPos(worldPos,
      evt ? evt.clientX - rect.left : undefined,
      evt ? evt.clientY - rect.top  : undefined);
    this.hoveredShipId = hit?.id || null;
    this.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  }

  /** Returns the ship at a world position, or null */
  /** Hit test en coordonnées ÉCRAN (CSS px) — utilise les positions stockées au dessin.
   *  Cliquable partout sur le cercle visible du vaisseau, peu importe zoom/rotation/animation. */
  _shipAtScreen(cx, cy) {
    let closest = null, minDist = Infinity;
    for (const ship of this.state.ships) {
      if (!ship.alive || ship._screenX === undefined) continue;
      const d = Math.hypot(cx - ship._screenX, cy - ship._screenY);
      const hitR = Math.max(12, ship._screenR * 1.15); // tout le cercle + petite marge
      if (d <= hitR && d < minDist) { minDist = d; closest = ship; }
    }
    return closest;
  }

  /** Ancien hit test monde — conservé pour compat, délègue à l'écran si possible */
  _shipAtPos(worldPos, screenX, screenY) {
    if (screenX !== undefined) return this._shipAtScreen(screenX, screenY);
    const cs = CONFIG.CELL_SIZE;
    let closest = null;
    let minDist  = Infinity;
    for (const ship of this.state.ships) {
      if (!ship.alive) continue;
      const z  = Math.round(ship.position.z);
      const ao = z - 1;
      const sx = (ship._rx ?? ship.position.x) + ao * CONFIG.ALTITUDE_X_OFFSET / cs;
      const sy = (ship._ry ?? ship.position.y) - ao * CONFIG.ALTITUDE_Y_OFFSET / cs;
      const d  = Math.sqrt((worldPos.x - sx) ** 2 + (worldPos.y - sy) ** 2);
      const hitRadius = Math.max(0.8, (SIZE_RADIUS[ship.size] || 10) / cs * 2.2);
      if (d < hitRadius && d < minDist) {
        minDist  = d;
        closest = ship;
      }
    }
    return closest;
  }

  // ═══════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════

  /** Updates the altitude filter */
  setAltFilter(alt) {
    this.altFilter = alt === 'all' ? 'all' : parseInt(alt);
    this._stars = null; // regenerate background on next frame
  }

  /** Centers the camera on a ship */
  centerOnShip(shipId) {
    const ship = this.state.ships.find(s => s.id === shipId);
    if (!ship) return;
    this.camera.x = ship.position.x * CONFIG.CELL_SIZE - this.canvas.width  / 2 + CONFIG.CELL_SIZE / 2;
    this.camera.y = ship.position.y * CONFIG.CELL_SIZE - this.canvas.height / 2 + CONFIG.CELL_SIZE / 2;
  }
}
