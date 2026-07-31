/**
 * BACKGROUND.JS — Arrière-plan configurable (soleils + corps planétaires)
 *
 * Le MJ peut composer le décor d'une bataille : 0 à 3 soleils (binaire de
 * Tatooine, etc.) et des corps planétaires de types variés inspirés de
 * l'univers Star Wars (forêt, rocheux, glace, océan, cendre, industriel,
 * lave, soufre, gazeux, désert).
 *
 * Le décor est rendu en ESPACE ÉCRAN avec un léger parallaxe (il dérive
 * lentement avec la caméra mais reste « lointain »). Il n'a aucun effet
 * de gameplay — purement visuel — et est transmis aux joueurs via snapshot.
 *
 * Structure stockée dans GameState.background :
 *   { suns: [{ x, y, r, palette }], bodies: [{ x, y, r, type, ring }] }
 *   (x, y sont en fraction d'écran 0..1 ; r en fraction de la hauteur)
 */

/**
 * Catalogue des STATIONS SPATIALES déployables (onglet Station, MJ).
 * Chaque type définit : son skin de rendu, s'il dispose d'un superlaser, et
 * sa capacité de CALE en VOLUME (hangarVolume) — pas un nombre fixe de
 * vaisseaux : le MJ remplit la cale lui-même en y ajoutant des vaisseaux un
 * par un, chacun consommant un volume selon sa taille (XS en prend peu, XXL
 * beaucoup). Voir SHIP_HANGAR_VOLUME dans utils.js pour le coût par taille.
 */
export const STATION_TYPES = {
  death_star: {
    label: 'Étoile de la Mort I (complète)',
    skin: 'death_star', hasSuperlaser: true,
    defaultRadius: 0.13, hangarVolume: 8000,
  },
  death_star_2: {
    label: 'Étoile de la Mort II (chantier)',
    skin: 'death_star_2', hasSuperlaser: true,
    defaultRadius: 0.13, hangarVolume: 6000,
  },
  the_roost: {
    label: 'The Roost (shadowport)',
    skin: 'the_roost', hasSuperlaser: false,
    defaultRadius: 0.045, hangarVolume: 12,
  },
  // ── Station Médicale Haven-class (651m de diamètre) ─────────
  // Canon : fabriquée par VenteX Construction Yards — 20 exemplaires
  // pour la GAR, 1 par armée de secteur. Non armée, totalement civile.
  // Silhouette : axe central + 8 bras radiaux en couronne (crest République).
  // Capacité : 80 000 patients, 8 000 personnels médicaux, 150 crew.
  // Hangar : 8 baies Pelta-class + navettes d'évacuation.
  haven_medical: {
    label: 'Station Médicale Haven-class (République)',
    skin: 'haven_medical', hasSuperlaser: false,
    defaultRadius: 0.11,
    hangarVolume:    400,   // 8 baies × Pelta ~50 vol. chacune
    medicalCapacity: 80000,
    brigCapacity:    500,   // quelques cellules de sécurité (prisonniers CIS blessés)
  },
};

/** Ensemble des types de corps qui sont des STATIONS (pas des planètes). */
export const STATION_TYPE_IDS = new Set(Object.keys(STATION_TYPES));
/** Vrai si `body.type` correspond à une station spatiale (tout type). */
export function isStationType(type) { return STATION_TYPE_IDS.has(type); }

/** Palettes de soleils (teinte du disque + halo) */
export const SUN_PALETTES = {
  jaune:  { core:'#fff6d0', mid:'#ffd84a', halo:'rgba(255,210,90,' },   // standard
  orange: { core:'#ffe2b0', mid:'#ff9d3c', halo:'rgba(255,150,60,' },   // Tatooine 1
  rouge:  { core:'#ffd0b0', mid:'#ff5a3c', halo:'rgba(255,90,60,'  },   // Tatooine 2 (naine rouge)
  blanc:  { core:'#ffffff', mid:'#cfe4ff', halo:'rgba(200,225,255,' },  // bleu-blanc chaud
  bleu:   { core:'#dce9ff', mid:'#5a9dff', halo:'rgba(90,157,255,' },   // géante bleue
};

/** Types de corps planétaires — chacun avec ses couleurs et son ambiance */
export const PLANET_TYPES = {
  foret:      { name:'🌲 Forestière',  base:'#3a6b3a', land:'#5a8f4a', sea:'#2a5f6f', clouds:true,  ice:false },
  rocheux:    { name:'🪨 Rocheuse',    base:'#8a7a66', land:'#a89478', sea:null,      clouds:false, ice:false },
  glace:      { name:'❄ De glace',     base:'#cfe4f5', land:'#e8f4ff', sea:'#9fc4dd', clouds:true,  ice:true  },
  ocean:      { name:'🌊 Aquatique',   base:'#2a6fb5', land:'#3a8f5a', sea:'#1e5a9a', clouds:true,  ice:false },
  cendre:     { name:'🌋 De cendre',   base:'#3a2e2a', land:'#5a4038', sea:null,      clouds:false, ice:false }, // Nevarro
  industriel: { name:'🏙 Industrielle', base:'#5a6470', land:'#7a8696', sea:null,      clouds:false, ice:false, lights:true }, // Coruscant léger
  ruche:      { name:'🌆 Cité-ruche',  base:'#6a6258', land:'#8a8070', sea:null,      clouds:false, ice:false, lights:true, hive:true }, // Coruscant dense / Nar Shaddaa
  lave:       { name:'🔥 De lave',     base:'#3a1208', land:'#ff5a1e', sea:'#7a1c08', clouds:false, ice:false, glow:'#ff6a2a' }, // Mustafar
  soufre:     { name:'☣ De soufre',    base:'#8a7820', land:'#d4b830', sea:'#6a5a18', clouds:true,  ice:false }, // Sullust/Kessel
  gazeux:     { name:'🪐 Gazeuse',     base:'#c89860', land:'#e0b878', sea:null,      clouds:false, ice:false, bands:true }, // Bespin
  gazeux_vert:{ name:'🟢 Gazeuse verte', base:'#5a8a4a', land:'#7ab85a', sea:null,    clouds:false, ice:false, bands:true }, // Felucia-like
  desert:     { name:'🏜 Désertique',  base:'#c8a060', land:'#dcb878', sea:null,      clouds:false, ice:false }, // Tatooine
  desert_orange:{ name:'🟠 Désert orangé', base:'#c86a28', land:'#e89040', sea:null, clouds:false, ice:false }, // Geonosis/Jakku roux
  tempere:    { name:'🌍 Tempérée',    base:'#4a7a8a', land:'#5a9a5a', sea:'#2a6a9a', clouds:true,  ice:true  }, // Alderaan/Naboo
  cristal:    { name:'💎 De cristal',  base:'#7a9ab5', land:'#aaccdd', sea:'#5a7a9a', clouds:false, ice:true, glow:'#bfe4ff' }, // Ilum
  cite_eau:   { name:'🌧 Océan-cité',  base:'#5a6a7a', land:'#8a9aaa', sea:'#3a5a7a', clouds:true,  ice:false, lights:true }, // Kamino
  volcanique: { name:'🌑 Volcanique',  base:'#2a2422', land:'#4a3028', sea:null,      clouds:false, ice:false, glow:'#cc4422' }, // sombre, veines rouges
};

/** Crée une config d'arrière-plan vide */
export function createBackground() {
  return { suns: [], bodies: [] };
}

/** Hash déterministe à partir d'une seed (pour des détails stables par corps) */
function seeded(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Dessine l'arrière-plan en espace écran (appelé AVANT la transform caméra).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} bg  GameState.background
 * @param {object} camera  pour le parallaxe
 * @param {number} W, H  dimensions du canvas
 */
export function drawBackground(ctx, bg, camera, W, H, terrainType, skyProject, plateauProject) {
  const cs = 56, grid = 480 * cs;
  // Position fraction (0..1) → coordonnée MONDE, étalée ×2.2 autour du plateau :
  // les corps entourent le champ de bataille (au-delà de ses bords) et lui sont
  // SOLIDAIRES — ils tournent dans le même sens, juste plus loin (parallaxe).
  const toWorld = (fx, fy) => ({ wx: (fx - 0.5) * grid * 3.5 + grid / 2, wy: (fy - 0.5) * grid * 3.5 + grid / 2 });

  // L'ambiance de terrain reste un voile qui entoure (projection ciel).
  const toSky = (fx, fy) => ({ nx: (fx - 0.5) * 1.0, ny: (fy - 0.5) * 1.0 });
  if (terrainType && skyProject) _drawTerrainAmbience(ctx, terrainType, W, H, skyProject, toSky);

  if (!bg || !plateauProject) return;

  // Taille : b.r × ratio de zoom → grandit à l'approche, comme un vrai astre.
  const REF_ZOOM = 0.05;
  const zoomRatio = camera.zoom / REF_ZOOM;

  for (const b of (bg.bodies || [])) {
    const w = toWorld(b.x, b.y);
    const p = plateauProject(w.wx, w.wy);
    const r = Math.max(14, b.r * H * zoomRatio);
    if (p.x < -r * 2 || p.x > W + r * 2 || p.y < -r * 2 || p.y > H + r * 2) continue;
    if (b.type === 'death_star' || b.type === 'death_star_2') {
      // Orientation FIXE (l'Étoile ne tourne pas sur elle-même) — elle suit
      // seulement la rotation de la caméra via la projection plateau.
      const spin = 0;
      drawDeathStar(ctx, p.x, p.y, r,
        b.type === 'death_star_2' ? 'ds2' : 'ds1',
        spin,
        (typeof b._fireProgress === 'number') ? b._fireProgress : null,
        (typeof b._fireScreenAngle === 'number') ? b._fireScreenAngle : 0,
        W, H, b._fireTargetScreen || null);
    } else if (isStationType(b.type)) {
      drawStation(ctx, p.x, p.y, r, b.type);
    } else {
      drawPlanet(ctx, b, p.x, p.y, r);
    }
    // Explosion sur le corps (frappe de surface ou destruction totale)
    if (b._explosionStart) _drawBodyExplosion(ctx, p.x, p.y, r, b);
  }
  for (const su of (bg.suns || [])) {
    const w = toWorld(su.x, su.y);
    const p = plateauProject(w.wx, w.wy);
    const r = Math.max(8, su.r * H * zoomRatio);
    if (p.x < -r * 3 || p.x > W + r * 3 || p.y < -r * 3 || p.y > H + r * 3) continue;
    drawSun(ctx, su, p.x, p.y, r);
  }
}

/** Cache mémoïsé des éléments d'ambiance (générés une fois par type) */
let _ambienceCache = null;
let _ambienceType = null;

function _drawTerrainAmbience(ctx, type, W, H, skyProject, toSky) {
  if (_ambienceType !== type) {
    _ambienceCache = null;
    _ambienceType = type;
  }
  // Voile le plus reculé (depth 2.4). Positions = fractions 0..1 étalées ×2
  // pour couvrir au-delà des bords d'écran via la projection ciel.
  const project = (fx, fy) => skyProject((fx - 0.5) * 2, (fy - 0.5) * 2, 2.4);

  ctx.save();

  if (type === 'nebula') {
    // Voiles de nébuleuse lointains qui teintent tout l'horizon
    if (!_ambienceCache) {
      const rng = seeded(777);
      _ambienceCache = Array.from({ length: 7 }, () => ({
        fx: rng(), fy: rng(), r: H * (0.4 + rng() * 0.6),
        pal: [[140,70,220],[70,40,160],[100,50,180],[160,80,200]][Math.floor(rng()*4)],
        a: 0.05 + rng() * 0.06,
      }));
    }
    for (const c of _ambienceCache) {
      const p = project(c.fx, c.fy);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, c.r);
      g.addColorStop(0, `rgba(${c.pal[0]},${c.pal[1]},${c.pal[2]},${c.a})`);
      g.addColorStop(1, `rgba(${c.pal[0]},${c.pal[1]},${c.pal[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.r, 0, Math.PI * 2); ctx.fill();
    }
  } else if (type === 'debris' || type === 'asteroid_field') {
    // Silhouettes d'astéroïdes lointains, sombres, dérivant en fond
    if (!_ambienceCache) {
      const rng = seeded(555);
      _ambienceCache = Array.from({ length: 40 }, () => ({
        fx: rng() * 1.2 - 0.1, fy: rng() * 1.2 - 0.1,
        r: 2 + rng() * 7, rot: rng() * Math.PI * 2, verts: 6 + Math.floor(rng() * 3),
        a: 0.15 + rng() * 0.25,
      }));
    }
    for (const a of _ambienceCache) {
      const p = project(a.fx, a.fy);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      for (let i = 0; i < a.verts; i++) {
        const ang = (i / a.verts) * Math.PI * 2;
        const rr = a.r * (0.7 + ((i * 37) % 10) / 20);
        const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(60,60,70,${a.a})`;
      ctx.fill();
      ctx.restore();
    }
  } else if (type === 'ice_field') {
    // Brume glacée bleutée + scintillements lointains
    if (!_ambienceCache) {
      const rng = seeded(333);
      _ambienceCache = Array.from({ length: 60 }, () => ({
        fx: rng(), fy: rng(), r: 0.5 + rng() * 1.5, a: 0.2 + rng() * 0.4,
      }));
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(150,200,235,0.05)');
    g.addColorStop(1, 'rgba(120,170,210,0.02)');
    ctx.fillStyle = g; ctx.fillRect(-W*0.2, -H*0.2, W*1.4, H*1.4);
    for (const s of _ambienceCache) {
      const p = project(s.fx, s.fy);
      ctx.beginPath(); ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210,235,255,${s.a})`; ctx.fill();
    }
  } else if (type === 'black_hole') {
    // Halo de lentille gravitationnelle lointain
    const g = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, H*0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(20,10,40,0.15)');
    g.addColorStop(0.85, 'rgba(120,80,200,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Rayon du superlaser au PREMIER PLAN : de la station (origin) à la cible
 *  (target), avec impact. fireProgress ∈ [0.45,1]. Dessiné en espace écran. */
export function drawSuperlaserBeam(ctx, origin, target, fireProgress) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Lueur externe
  ctx.strokeStyle = 'rgba(60,255,80,0.4)';
  ctx.lineWidth = 14;
  ctx.shadowBlur = 30; ctx.shadowColor = '#33ff44';
  ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(target.x, target.y); ctx.stroke();
  // Cœur du rayon
  ctx.strokeStyle = '#ddffdd'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(target.x, target.y); ctx.stroke();
  ctx.shadowBlur = 0;
  // Flash à l'origine
  const fl = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 30);
  fl.addColorStop(0, 'rgba(220,255,220,0.9)'); fl.addColorStop(1, 'rgba(60,255,80,0)');
  ctx.fillStyle = fl;
  ctx.beginPath(); ctx.arc(origin.x, origin.y, 30, 0, Math.PI*2); ctx.fill();
  // Impact à la cible — boule qui gonfle
  const t = (fireProgress - 0.45) / 0.55;
  const impR = 20 + t * 60;
  const imp = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, impR);
  imp.addColorStop(0,   `rgba(255,255,235,${0.95*(1-t*0.3)})`);
  imp.addColorStop(0.35,`rgba(120,255,140,${0.8*(1-t*0.3)})`);
  imp.addColorStop(0.7, `rgba(40,200,70,${0.4*(1-t)})`);
  imp.addColorStop(1,   'rgba(20,120,40,0)');
  ctx.fillStyle = imp;
  ctx.beginPath(); ctx.arc(target.x, target.y, impR, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/** Animation d'explosion sur un corps : 'surface' (petite, localisée) ou
 *  'destroy' (grande, qui consume la planète). Basée sur le temps écoulé. */
function _drawBodyExplosion(ctx, cx, cy, r, body) {
  const elapsed = Date.now() - body._explosionStart;
  const surface = body._explosionKind === 'surface';
  const DUR = surface ? 1400 : 2200;
  if (elapsed > DUR) {
    if (surface) { body._explosionStart = null; }
    return;
  }
  const t = elapsed / DUR;
  ctx.save();
  if (surface) {
    const ix = cx - r * 0.2, iy = cy - r * 0.1;
    const grow = Math.sin(Math.min(1, t * 2) * Math.PI / 2);
    const fade = 1 - Math.max(0, (t - 0.4) / 0.6);
    const er = r * (0.15 + grow * 0.35);
    const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, er);
    g.addColorStop(0,   `rgba(255,255,235,${0.95 * fade})`);
    g.addColorStop(0.4, `rgba(255,200,120,${0.7 * fade})`);
    g.addColorStop(0.7, `rgba(255,120,60,${0.45 * fade})`);
    g.addColorStop(1,   'rgba(120,40,20,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ix, iy, er, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(40,20,10,${0.5 * Math.min(1, t * 3)})`;
    ctx.beginPath(); ctx.arc(ix, iy, r * 0.12, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.globalCompositeOperation = 'lighter';
    const shockR = r * (1 + t * 2.5);
    ctx.strokeStyle = `rgba(255,220,150,${0.6 * (1 - t)})`;
    ctx.lineWidth = Math.max(0.5, r * 0.08 * (1 - t));
    ctx.beginPath(); ctx.arc(cx, cy, shockR, 0, Math.PI * 2); ctx.stroke();
    const fbR = r * (1.1 + Math.sin(Math.min(1, t * 1.5) * Math.PI / 2) * 0.6);
    const fade = 1 - Math.max(0, (t - 0.3) / 0.7);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fbR);
    g.addColorStop(0,   `rgba(255,255,240,${0.95 * fade})`);
    g.addColorStop(0.3, `rgba(255,210,120,${0.85 * fade})`);
    g.addColorStop(0.6, `rgba(255,110,50,${0.6 * fade})`);
    g.addColorStop(1,   'rgba(120,30,15,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, fbR, 0, Math.PI * 2); ctx.fill();
    const rng = seeded(Math.floor(body._explosionStart));
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2;
      const dist = r * (0.5 + t * 2.2) * (0.6 + rng() * 0.6);
      const dx = cx + Math.cos(a) * dist, dy = cy + Math.sin(a) * dist;
      const dsz = Math.max(0.5, r * 0.04 * (1 - t));
      ctx.fillStyle = `rgba(${180 + (rng()*60|0)},${100 + (rng()*60|0)},60,${0.7 * (1 - t)})`;
      ctx.beginPath(); ctx.arc(dx, dy, dsz, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Dessine une Étoile de la Mort (corps spécial / station).
 * @param variant 'ds1' (complète) | 'ds2' (en construction)
 * @param spin rotation propre de la station en radians
 * @param fireProgress 0..1 si en train de tirer, sinon null
 * @param fireAngle direction du tir à l'écran (radians) — vers la cible
 * @param W,H dimensions canvas (pour la longueur du rayon)
 */
function drawDeathStar(ctx, cx, cy, r, variant, spin, fireProgress, fireAngle, W, H, targetScreen) {
  ctx.save();

  // ── Sphère de base (gris métallique, ombrage sphérique fixe : la lumière
  //    vient toujours du haut-gauche, indépendamment de la rotation) ──
  const base = ctx.createRadialGradient(cx - r*0.35, cy - r*0.35, r*0.1, cx, cy, r*1.1);
  base.addColorStop(0,   '#9aa3ad');
  base.addColorStop(0.5, '#6e757e');
  base.addColorStop(0.82, '#3e444b');
  base.addColorStop(1,   '#181c20');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = base; ctx.fill();

  // ── Surface qui TOURNE avec la station (clip au disque, puis on applique
  //    la rotation propre `spin` aux détails de surface) ──
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(spin);              // ← la station pivote sur elle-même

  // Bandes de panneaux : lignes de LATITUDE (horizontales, courbées en ellipses
  // de plus en plus plates vers l'équateur — sens « globe » correct).
  ctx.strokeStyle = 'rgba(30,34,38,0.5)';
  ctx.lineWidth = Math.max(0.5, r*0.008);
  for (let i = 1; i <= 5; i++) {
    const ry2 = r * (i/6);
    // deux ellipses symétriques (hémisphère nord + sud)
    ctx.beginPath(); ctx.ellipse(0, 0, r, ry2, 0, 0, Math.PI*2); ctx.stroke();
  }
  // Méridiens : lignes de LONGITUDE (verticales, courbées) — l'autre sens
  for (let i = 1; i <= 5; i++) {
    const rx2 = r * (i/6);
    ctx.beginPath(); ctx.ellipse(0, 0, rx2, r, 0, 0, Math.PI*2);
    ctx.globalAlpha = 0.28; ctx.stroke(); ctx.globalAlpha = 1;
  }

  // Tranchée équatoriale (ligne médiane caractéristique)
  ctx.strokeStyle = 'rgba(20,24,28,0.9)';
  ctx.lineWidth = Math.max(1.2, r*0.03);
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(180,190,200,0.3)';
  ctx.lineWidth = Math.max(0.5, r*0.01);
  ctx.beginPath(); ctx.moveTo(-r, r*0.04); ctx.lineTo(r, r*0.04); ctx.stroke();

  if (variant === 'ds2') {
    // DS-II : coque LARGEMENT COMPLÈTE. Deux zones de chantier seulement :
    //  (1) une petite zone en HAUT-DROITE,
    //  (2) une large bande médiane/basse irrégulière qui traverse,
    // le BAS-GAUCHE restant fini. (fidèle aux plans Lucasfilm)
    const rng3 = seeded(909);
    // Helper : remplit une zone-chantier clippée par un polygone + treillis
    const buildZone = (ptsFn, beamSeed) => {
      ctx.save();
      ctx.beginPath();
      ptsFn();
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(-r, -r, r*2, r*2);
      // Strates de poutres exposées
      const rb = seeded(beamSeed);
      ctx.strokeStyle = 'rgba(140,150,160,0.5)';
      ctx.lineWidth = Math.max(0.4, r*0.006);
      for (let k = 0; k < 50; k++) {
        const ly = -r + rb() * r * 2;
        const lx = -r + rb() * r * 2;
        const len = r * (0.05 + rb() * 0.25);
        ctx.globalAlpha = 0.3 + rb() * 0.4;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + len, ly); ctx.stroke();
        if (rb() > 0.6) { ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly + (rb()-0.5)*r*0.12); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      // Lumières de chantier
      for (let k = 0; k < 14; k++) {
        const px = -r + rb()*r*2, py = -r + rb()*r*2;
        ctx.beginPath(); ctx.arc(px, py, r*0.006, 0, Math.PI*2);
        ctx.fillStyle = rb() > 0.65 ? 'rgba(255,210,140,0.7)' : 'rgba(180,195,210,0.55)';
        ctx.fill();
      }
      ctx.restore();
    };

    // (1) Petite zone HAUT-DROITE : tache déchiquetée
    buildZone(() => {
      const r1 = seeded(111);
      // de (0.15r, -0.95r) descendant en dents jusqu'à (0.45r, -0.25r), bord droit
      ctx.moveTo(r*0.12, -r*0.98);
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const ty = -r*0.95 + (i/n) * r*0.7;
        const edge = r*0.30 + (r1()-0.4)*r*0.22;
        ctx.lineTo(edge, ty);
      }
      ctx.lineTo(r*1.1, -r*0.25); ctx.lineTo(r*1.1, -r*1.1);
    }, 222);

    // (2) Large bande MÉDIANE/BASSE irrégulière (traverse, bas-gauche fini)
    buildZone(() => {
      const r2 = seeded(333);
      // frontière supérieure déchiquetée de gauche (haut) vers droite
      const n = 16;
      ctx.moveTo(-r*0.55, r*0.18);
      for (let i = 0; i <= n; i++) {
        const tx = -r*0.55 + (i/n) * r*1.7;
        const ty = r*0.18 + (r2()-0.45)*r*0.30 + (i/n)*r*0.10;
        ctx.lineTo(tx, ty);
      }
      // descend à droite puis revient en bas, en laissant le coin bas-gauche fini
      ctx.lineTo(r*1.15, r*1.15);
      ctx.lineTo(-r*0.05, r*1.15);
      // frontière basse-gauche qui remonte (le bas-gauche reste coque finie)
      const m = 6;
      for (let i = 0; i <= m; i++) {
        const tx = -r*0.05 - (i/m) * r*0.5;
        const ty = r*1.15 - (i/m) * r*0.55 + (r2()-0.5)*r*0.12;
        ctx.lineTo(tx, ty);
      }
    }, 444);
  }

  ctx.restore(); // fin rotation + clip surface (le disque suit en repère écran)

  // ── Le superlaser concave : position FIXE sur la sphère. DS-I : hémisphère
  //    nord, un peu à gauche. DS-II : plus haut et à gauche (zone achevée).
  //    Dessiné en coordonnées ÉCRAN absolues (cx/cy + offset local) car on est
  //    ici APRÈS le restore du repère translaté.
  const dishLocalX = variant === 'ds2' ? -r * 0.40 : -r * 0.32;
  const dishLocalY = variant === 'ds2' ? -r * 0.30 : -r * 0.34;
  const dishCX = cx + dishLocalX, dishCY = cy + dishLocalY;
  const dishR = r * 0.26;
  const charging = fireProgress != null;
  const dishGrad = ctx.createRadialGradient(dishCX, dishCY, 0, dishCX, dishCY, dishR);
  if (charging) {
    dishGrad.addColorStop(0, '#aaffaa');
    dishGrad.addColorStop(0.4, '#33cc44');
    dishGrad.addColorStop(1, '#0a3a12');
  } else {
    dishGrad.addColorStop(0, '#4a525a');
    dishGrad.addColorStop(0.6, '#2e343a');
    dishGrad.addColorStop(1, '#1a1e22');
  }
  ctx.beginPath(); ctx.arc(dishCX, dishCY, dishR, 0, Math.PI*2);
  ctx.fillStyle = dishGrad; ctx.fill();
  ctx.strokeStyle = 'rgba(20,24,28,0.8)'; ctx.lineWidth = Math.max(1, r*0.02); ctx.stroke();
  ctx.strokeStyle = charging ? 'rgba(120,255,140,0.6)' : 'rgba(60,68,76,0.7)';
  ctx.lineWidth = Math.max(0.5, r*0.008);
  for (let rr = 0.25; rr < 1; rr += 0.25) {
    ctx.beginPath(); ctx.arc(dishCX, dishCY, dishR*rr, 0, Math.PI*2); ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i/8) * Math.PI*2;
    const ex = dishCX + Math.cos(a)*dishR*0.82, ey = dishCY + Math.sin(a)*dishR*0.82;
    ctx.beginPath(); ctx.arc(ex, ey, dishR*0.07, 0, Math.PI*2);
    ctx.fillStyle = charging ? '#ccffcc' : '#5a6068'; ctx.fill();
  }

  // ── Terminateur (ombre du côté nuit, FIXE — repère écran) ──
  const term = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, r*0.2, cx + r*0.3, cy + r*0.3, r*1.2);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.6, 'rgba(0,0,0,0)');
  term.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = term; ctx.fill();

  // ── ANIMATION DE TIR : le rayon part de la position ÉCRAN du disque vers la
  //    cible (fireAngle), indépendamment de la rotation de surface. ──
  if (charging) {
    // Position écran du disque = centre + offset local tourné de `spin`
    const ddx = cx + (dishLocalX * Math.cos(spin) - dishLocalY * Math.sin(spin));
    const ddy = cy + (dishLocalX * Math.sin(spin) + dishLocalY * Math.cos(spin));
    const ang = (typeof fireAngle === 'number') ? fireAngle : 0;
    const scrW = W || 1280, scrH = H || 720;
    if (fireProgress < 0.45) {
      // Phase de convergence : 8 faisceaux verts convergent sur le disque
      const conv = Math.min(1, fireProgress / 0.45);
      ctx.strokeStyle = '#88ff99'; ctx.lineWidth = Math.max(1, r*0.015);
      ctx.shadowBlur = 12; ctx.shadowColor = '#33ff44';
      for (let i = 0; i < 8; i++) {
        const a = (i/8) * Math.PI*2;
        const ex = ddx + Math.cos(a)*dishR*0.82, ey = ddy + Math.sin(a)*dishR*0.82;
        const convDist = dishR + conv * r * 0.6;
        const tx = ddx + Math.cos(ang) * convDist, ty = ddy + Math.sin(ang) * convDist;
        ctx.globalAlpha = conv;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    } else {
      // Phase de décharge : flash d'émission au disque (le RAYON lui-même est
      // dessiné au premier plan par drawSuperlaserBeam, pour passer devant les
      // vaisseaux et finir pile sur la cible).
      const bx = ddx + Math.cos(ang) * dishR, by = ddy + Math.sin(ang) * dishR;
      const flash = ctx.createRadialGradient(bx, by, 0, bx, by, dishR*1.5);
      flash.addColorStop(0, 'rgba(220,255,220,0.9)');
      flash.addColorStop(1, 'rgba(60,255,80,0)');
      ctx.fillStyle = flash;
      ctx.beginPath(); ctx.arc(bx, by, dishR*1.5, 0, Math.PI*2); ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Dessine une station spatiale « générique » (pas Étoile de la Mort) : chantier
 * orbital, base de ravitaillement, station de commandement. Design simple en
 * silhouette industrielle — anneau/armature + corps central, sans la coque
 * sphérique des Étoiles de la Mort.
 */
/**
 * Dessine THE ROOST — shadowport criminel RKDA-class (The Mandalorian, ch.6).
 * Design : plateforme trapézoïdale industrielle hérissée d'antennes, grande
 * baie d'amarrage rectangulaire bleu cyan lumineuse au centre, panneaux
 * rouillés/rapiécés (chop-shop, pas militaire propre), suspendue à une longue
 * tige verticale qui descend vers un petit module d'amarrage tout en bas —
 * silhouette élancée façon Cloud City en plus brut.
 */
/**
 * Dessine THE ROOST — shadowport criminel RKDA-class (The Mandalorian, ch.6).
 * Design : coque en forme de BOL RETOURNÉ vue de profil (dôme bombé convexe
 * sur le dessus, base plate dessous — silhouette de soucoupe inversée, pas un
 * trapèze à facettes), hérissée d'antennes, avec un grand hangar RECTANGULAIRE
 * simple (pas biseauté) découpé sur le flanc, illuminé cyan. Suspendue à une
 * longue tige verticale qui descend vers un petit module d'amarrage.
 */
export function drawStation(ctx, cx, cy, r, skin) {
  if (skin === 'haven_medical') { drawHavenMedical(ctx, cx, cy, r); return; }
  if (skin !== 'the_roost') return; // seul skin de station générique restant
  ctx.save();
  ctx.translate(cx, cy);

  const domeW = r * 3.0, domeH = r * 0.95;   // largeur/hauteur du dôme
  const rng = seeded(7331);

  // ── Longue tige verticale (mât d'amarrage) ──
  ctx.strokeStyle = '#5a5650'; ctx.lineWidth = Math.max(1, r*0.07);
  ctx.beginPath(); ctx.moveTo(0, domeH*0.42); ctx.lineTo(0, r*5.2); ctx.stroke();
  ctx.strokeStyle = 'rgba(70,65,58,0.6)'; ctx.lineWidth = Math.max(0.5, r*0.025);
  ctx.beginPath(); ctx.moveTo(0, domeH*0.42); ctx.lineTo(0, r*5.2); ctx.stroke();
  // Module d'amarrage tout en bas de la tige
  ctx.fillStyle = '#4a4640';
  ctx.fillRect(-r*0.22, r*5.0, r*0.44, r*0.4);
  ctx.strokeStyle = '#2a2722'; ctx.lineWidth = Math.max(0.5, r*0.02); ctx.strokeRect(-r*0.22, r*5.0, r*0.44, r*0.4);

  // ── Coque en BOL RETOURNÉ : base plate horizontale + dôme convexe au-dessus ──
  // (silhouette : un rectangle fin pour le bord plat, surmonté d'une grande
  // ellipse tronquée qui ne dessine que sa moitié supérieure — exactement le
  // profil d'une soucoupe/bol renversé, pas un polygone à facettes.)
  ctx.beginPath();
  ctx.moveTo(-domeW*0.5, domeH*0.40);
  // arc supérieur convexe (le "bol")
  ctx.ellipse(0, domeH*0.40, domeW*0.5, domeH*0.92, 0, Math.PI, 0, false);
  ctx.lineTo(domeW*0.5, domeH*0.40);
  ctx.closePath();
  const bodyG = ctx.createLinearGradient(0, -domeH*0.5, 0, domeH*0.4);
  bodyG.addColorStop(0,   '#8a7c66'); // sommet éclairé
  bodyG.addColorStop(0.5, '#695d4c');
  bodyG.addColorStop(1,   '#3e3830'); // base dans l'ombre
  ctx.fillStyle = bodyG; ctx.fill();
  ctx.strokeStyle = '#1e1b16'; ctx.lineWidth = Math.max(0.6, r*0.02); ctx.stroke();

  // Base plate (tranche fine, donne l'épaisseur du "bol")
  ctx.fillStyle = '#332e27';
  ctx.fillRect(-domeW*0.5, domeH*0.38, domeW, domeH*0.08);
  ctx.strokeStyle = '#1a1712'; ctx.lineWidth = Math.max(0.5, r*0.015);
  ctx.strokeRect(-domeW*0.5, domeH*0.38, domeW, domeH*0.08);

  // Lignes de structure courbes (suivent la courbure du dôme, façon coque rivetée)
  ctx.strokeStyle = 'rgba(30,27,22,0.35)'; ctx.lineWidth = Math.max(0.5, r*0.012);
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    ctx.beginPath();
    ctx.ellipse(0, domeH*0.40, domeW*0.5*(1-t*0.08), domeH*0.92*(1-t), 0, Math.PI, 0, false);
    ctx.stroke();
  }

  // Panneaux rapiécés / rouillés (clippés à la silhouette du dôme)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-domeW*0.5, domeH*0.40);
  ctx.ellipse(0, domeH*0.40, domeW*0.5, domeH*0.92, 0, Math.PI, 0, false);
  ctx.lineTo(domeW*0.5, domeH*0.40);
  ctx.closePath(); ctx.clip();
  for (let i = 0; i < 10; i++) {
    const px = -domeW*0.42 + rng()*domeW*0.84;
    const py = -domeH*0.45 + rng()*domeH*0.8;
    const pw = domeW * (0.05 + rng()*0.09), ph = domeH * (0.10 + rng()*0.18);
    ctx.fillStyle = rng() > 0.5 ? 'rgba(120,70,40,0.3)' : 'rgba(30,27,22,0.35)';
    ctx.fillRect(px, py, pw, ph);
  }
  ctx.restore();

  // ── HANGAR : simple RECTANGLE net (pas de biseau), comme la référence ──
  const bayW = domeW*0.30, bayH = domeH*0.34, bayX = domeW*0.06, bayY = domeH*0.04;
  const bayGrad = ctx.createLinearGradient(bayX, bayY-bayH/2, bayX, bayY+bayH/2);
  bayGrad.addColorStop(0, '#cdf8ff'); bayGrad.addColorStop(0.5, '#3ad6f0'); bayGrad.addColorStop(1,'#0c4a58');
  ctx.fillStyle = bayGrad;
  ctx.fillRect(bayX - bayW/2, bayY - bayH/2, bayW, bayH);
  ctx.save();
  ctx.shadowBlur = r*0.5; ctx.shadowColor = '#3ad6f0';
  ctx.strokeStyle = 'rgba(160,240,255,0.85)'; ctx.lineWidth = Math.max(0.7, r*0.02);
  ctx.strokeRect(bayX - bayW/2, bayY - bayH/2, bayW, bayH);
  ctx.restore();
  // Cadre intérieur sombre (épaisseur de la coque autour de la baie)
  ctx.strokeStyle = '#1a1712'; ctx.lineWidth = Math.max(1, r*0.035);
  ctx.strokeRect(bayX - bayW/2 - r*0.03, bayY - bayH/2 - r*0.03, bayW + r*0.06, bayH + r*0.06);

  // Petits points lumineux rouges (feux de balisage, façon image de référence)
  const beacons = [[-domeW*0.4,-domeH*0.05],[domeW*0.42,-domeH*0.15],[-domeW*0.05,-domeH*0.55]];
  for (const [bx,by] of beacons) {
    ctx.beginPath(); ctx.arc(bx,by,r*0.045,0,Math.PI*2);
    ctx.fillStyle = 'rgba(255,70,50,0.9)'; ctx.fill();
  }

  // ── Antennes hérissées sur le dessus (silhouette caractéristique) ──
  ctx.strokeStyle = '#4a4640'; ctx.lineWidth = Math.max(0.5, r*0.018);
  const antennas = [-domeW*0.3,-domeW*0.16,-domeW*0.02, domeW*0.08, domeW*0.2, domeW*0.32];
  for (let i = 0; i < antennas.length; i++) {
    const ax = antennas[i];
    // hauteur de départ sur la courbe du dôme à cette abscisse
    const tNorm = ax / (domeW*0.5);
    const startY = domeH*0.40 - domeH*0.92*Math.sqrt(Math.max(0, 1 - tNorm*tNorm));
    const ah = r * (0.5 + rng()*0.9);
    ctx.beginPath(); ctx.moveTo(ax, startY); ctx.lineTo(ax + (rng()-0.5)*r*0.15, startY - ah); ctx.stroke();
  }
  // Mât central plus haut (le plus visible sur l'image de référence)
  ctx.lineWidth = Math.max(0.7, r*0.025);
  ctx.beginPath(); ctx.moveTo(domeW*0.02, -domeH*0.5); ctx.lineTo(domeW*0.02, -domeH*0.5 - r*1.6); ctx.stroke();
  ctx.beginPath(); ctx.arc(domeW*0.02, -domeH*0.5 - r*1.6, r*0.04, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,120,80,0.85)'; ctx.fill();

  // Soutènements sous la base (vers la tige)
  ctx.strokeStyle = '#3a3630'; ctx.lineWidth = Math.max(0.5, r*0.02);
  for (const dx of [-domeW*0.1, domeW*0.1]) {
    ctx.beginPath(); ctx.moveTo(dx, domeH*0.42); ctx.lineTo(dx*0.3, domeH*0.65); ctx.stroke();
  }

  ctx.restore();
}

function drawSun(ctx, sun, cx, cy, r) {
  const pal = SUN_PALETTES[sun.palette] || SUN_PALETTES.jaune;
  ctx.save();
  // Halo large
  const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 4);
  halo.addColorStop(0,   pal.halo + '0.5)');
  halo.addColorStop(0.3, pal.halo + '0.18)');
  halo.addColorStop(1,   pal.halo + '0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 4, 0, Math.PI * 2);
  ctx.fill();
  // Disque
  const disk = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, r*0.1, cx, cy, r);
  disk.addColorStop(0, pal.core);
  disk.addColorStop(1, pal.mid);
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlanet(ctx, body, cx, cy, r) {
  const t = PLANET_TYPES[body.type] || PLANET_TYPES.rocheux;
  const rng = seeded((body._seed || 1) + 1);
  ctx.save();

  // ── Disque de base : dégradé sphérique (lumière haut-gauche) ──
  const lx = cx - r * 0.4, ly = cy - r * 0.4; // point de lumière
  const base = ctx.createRadialGradient(lx, ly, r * 0.05, cx, cy, r * 1.15);
  base.addColorStop(0,   _lighten(t.base, 0.35));
  base.addColorStop(0.45, t.base);
  base.addColorStop(0.82, _darken(t.base, 0.4));
  base.addColorStop(1,   _darken(t.base, 0.75));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = base;
  ctx.fill();

  // Clip au disque pour toute la surface
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // ── Texture de surface : champ de cellules cohérent (type Voronoï léger) ──
  // Bien plus crédible que des ellipses translucides empilées.
  if (t.bands) {
    // Géante gazeuse : bandes horizontales ondulées (Bespin/Jupiter)
    const nBands = 9 + Math.floor(rng() * 5);
    for (let i = 0; i < nBands; i++) {
      const yy = cy - r + (i / nBands) * r * 2;
      const h  = (r * 2 / nBands) * (0.7 + rng() * 0.8);
      const shade = rng();
      ctx.fillStyle = shade > 0.5
        ? _lighten(t.land || t.base, 0.15 * rng())
        : _darken(t.base, 0.2 * rng());
      ctx.globalAlpha = 0.55;
      // Bande légèrement ondulée
      ctx.beginPath();
      ctx.moveTo(cx - r, yy);
      for (let x = -r; x <= r; x += r / 6) {
        ctx.lineTo(cx + x, yy + Math.sin(x / r * 3 + i) * h * 0.15);
      }
      ctx.lineTo(cx + r, yy + h);
      ctx.lineTo(cx - r, yy + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // Surface solide : taches de terrain par cellules réparties uniformément.
    // Bords plus nets (gradient resserré) pour éviter l'effet « flou/bouillie ».
    const cells = 32 + Math.floor(rng() * 16);
    for (let i = 0; i < cells; i++) {
      const a  = rng() * Math.PI * 2;
      const d  = Math.sqrt(rng()) * r * 0.98;
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d;
      const br = r * (0.10 + rng() * 0.16);
      let col;
      const k = rng();
      if (t.sea && k < 0.4)      col = t.sea;
      else if (k < 0.72)         col = t.land || t.base;
      else                       col = _darken(t.base, 0.18 + rng() * 0.22);
      // Gradient resserré : cœur net jusqu'à 65%, fondu seulement sur le bord
      const g = ctx.createRadialGradient(bx, by, br * 0.2, bx, by, br);
      g.addColorStop(0,    col);
      g.addColorStop(0.65, col);
      g.addColorStop(1,    _toRgba(col, 0));
      ctx.globalAlpha = 0.65 + rng() * 0.3;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }
    // Couche de petits détails fins par-dessus (taches/cratères) — donne du grain
    const detail = 40 + Math.floor(rng() * 30);
    for (let i = 0; i < detail; i++) {
      const a  = rng() * Math.PI * 2;
      const d  = Math.sqrt(rng()) * r * 0.96;
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d;
      const dr = r * (0.02 + rng() * 0.05);
      ctx.beginPath();
      ctx.arc(bx, by, dr, 0, Math.PI * 2);
      ctx.fillStyle = rng() > 0.5 ? _lighten(t.base, 0.25) : _darken(t.base, 0.3);
      ctx.globalAlpha = 0.3 + rng() * 0.3;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Veines de lave incandescentes (Mustafar)
  if (t.glow) {
    ctx.strokeStyle = t.glow;
    ctx.lineWidth = Math.max(1, r * 0.02);
    ctx.shadowBlur = 8; ctx.shadowColor = t.glow;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      let vx = cx + (rng() - 0.5) * r * 1.6;
      let vy = cy + (rng() - 0.5) * r * 1.6;
      ctx.moveTo(vx, vy);
      for (let j = 0; j < 5; j++) {
        vx += (rng() - 0.5) * r * 0.4;
        vy += (rng() - 0.5) * r * 0.4;
        ctx.lineTo(vx, vy);
      }
      ctx.globalAlpha = 0.55;
      ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  // Lumières urbaines (Coruscant) — denses sur le côté nuit
  if (t.lights) {
    const nLights = t.hive ? 140 : 70; // cité-ruche : beaucoup plus dense
    for (let i = 0; i < nLights; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r * 0.95;
      const px2 = cx + Math.cos(a) * d, py2 = cy + Math.sin(a) * d;
      const nightFactor = (( px2 - cx) + (py2 - cy)) / (2 * r) + 0.5;
      ctx.beginPath();
      ctx.arc(px2, py2, r * (t.hive ? 0.006 : 0.008), 0, Math.PI * 2);
      ctx.fillStyle = rng() > 0.5 ? '#ffe080' : '#aad4ff';
      ctx.globalAlpha = (0.2 + rng() * 0.5) * Math.max(0.2, nightFactor);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Cité-ruche : trame de « blocs urbains » (lignes orthogonales subtiles)
    if (t.hive) {
      ctx.strokeStyle = 'rgba(180,160,120,0.12)';
      ctx.lineWidth = Math.max(0.4, r * 0.006);
      const step = r * 0.18;
      for (let gx = -r; gx <= r; gx += step) {
        ctx.beginPath(); ctx.moveTo(cx + gx, cy - r); ctx.lineTo(cx + gx, cy + r); ctx.stroke();
      }
      for (let gy = -r; gy <= r; gy += step) {
        ctx.beginPath(); ctx.moveTo(cx - r, cy + gy); ctx.lineTo(cx + r, cy + gy); ctx.stroke();
      }
      // Quelques foyers lumineux denses (mégastructures)
      for (let i = 0; i < 8; i++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r * 0.8;
        const gx = cx + Math.cos(a)*d, gy = cy + Math.sin(a)*d;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r*0.12);
        g.addColorStop(0, 'rgba(255,220,150,0.4)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(gx, gy, r*0.12, 0, Math.PI*2); ctx.fill();
      }
    }
  }

  // Calottes polaires (glace)
  if (t.ice) {
    const cap = ctx.createRadialGradient(cx, cy - r * 0.92, 0, cx, cy - r * 0.92, r * 0.6);
    cap.addColorStop(0, 'rgba(255,255,255,0.85)');
    cap.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cap;
    ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.88, r * 0.55, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    const cap2 = ctx.createRadialGradient(cx, cy + r * 0.92, 0, cx, cy + r * 0.92, r * 0.6);
    cap2.addColorStop(0, 'rgba(255,255,255,0.85)');
    cap2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cap2;
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.88, r * 0.55, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Nuages : voile diffus suivant la courbure (pas d'ellipses flottantes nettes)
  if (t.clouds) {
    const cl = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < cl; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r * 0.8;
      const wx = cx + Math.cos(a) * d, wy = cy + Math.sin(a) * d;
      const wr = r * (0.2 + rng() * 0.3);
      const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
      g.addColorStop(0, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(wx, wy, wr, wr * 0.55, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore(); // fin du clip

  // ── Atmosphère : halo lumineux au limbe (côté éclairé) ──
  if (t.clouds || t.sea || t.glow) {
    const atmoCol = t.glow ? '255,120,60'
      : t.ice ? '180,220,255'
      : t.sea ? '120,180,255'
      : '150,200,255';
    const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.12);
    atmo.addColorStop(0, `rgba(${atmoCol},0)`);
    atmo.addColorStop(0.6, `rgba(${atmoCol},0.18)`);
    atmo.addColorStop(1, `rgba(${atmoCol},0)`);
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
    ctx.fillStyle = atmo; ctx.fill();
  }

  // ── Terminateur : ombre nette du côté nuit (dégradé directionnel) ──
  const term = ctx.createRadialGradient(lx, ly, r * 0.3, cx + r * 0.3, cy + r * 0.3, r * 1.3);
  term.addColorStop(0,    'rgba(0,0,0,0)');
  term.addColorStop(0.55, 'rgba(0,0,0,0)');
  term.addColorStop(1,    'rgba(0,0,0,0.6)');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = term; ctx.fill();

  // ── Anneau planétaire (avant + arrière pour l'effet 3D) ──
  if (body.ring) {
    const tilt = -0.32;
    // Arc arrière (derrière la planète) — dessiné avant, masqué par le disque déjà peint… on le pose par-dessus en demi
    ctx.strokeStyle = 'rgba(210,200,180,0.45)';
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.8, r * 0.5, tilt, Math.PI, Math.PI * 2);
    ctx.stroke();
    // Bande d'ombre de la planète sur l'anneau
    ctx.strokeStyle = 'rgba(160,150,130,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.8, r * 0.5, tilt, 0, Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}

/** Éclaircit une couleur hex de `amt` (0..1) */
function _lighten(hex, amt) {
  const c = _hexToRgb(hex); if (!c) return hex;
  return `rgb(${Math.min(255, c[0] + (255 - c[0]) * amt | 0)},${Math.min(255, c[1] + (255 - c[1]) * amt | 0)},${Math.min(255, c[2] + (255 - c[2]) * amt | 0)})`;
}
/** Assombrit une couleur hex de `amt` (0..1) */
function _darken(hex, amt) {
  const c = _hexToRgb(hex); if (!c) return hex;
  return `rgb(${c[0] * (1 - amt) | 0},${c[1] * (1 - amt) | 0},${c[2] * (1 - amt) | 0})`;
}
function _hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
/** Convertit hex OU rgb() en rgba avec alpha donné */
function _toRgba(col, alpha) {
  if (col.startsWith('#')) {
    const c = _hexToRgb(col);
    return c ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : col;
  }
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(col);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : col;
}

// ═══════════════════════════════════════════════════════════════════
// STATION MÉDICALE HAVEN-CLASS
// Approche flat-design : on trace exactement ce qu'on voit dans l'image,
// sans géométrie 3D. Coordonnées mesurées pixel par pixel sur l'artwork.
// Tout est en multiples de `r` (= crown_r en pixels écran).
// Origine = centre du hub. Y+ = bas (convention Canvas).
//
// Mesures (image 1080×1080, hub=(548,415), crown_r=339px) :
//   8 modules : positions, dimensions et angles dans MODULES[]
//   Hub : anneau extérieur r=0.50, anneau bleu r=0.38, trou r=0.28
//   Mât  : large en haut (±0.19r), fin en bas (±0.06r), longueur 1.75r
// ═══════════════════════════════════════════════════════════════════
function drawHavenMedical(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);

  // ─────────────────────────────────────────────────────────────────
  // 8 MODULES — données mesurées sur l'image de référence.
  // Format : { cx, cy, angle, w, h, topW }
  //   cx, cy  : centre du module (en r) depuis hub
  //   angle   : rotation en radians (0 = face vers droite)
  //   w       : largeur du module (perpendiculaire à l'angle)
  //   h       : hauteur du module (dans l'axe de l'angle)
  //   topW    : facteur de rétrécissement côté hub (trapèze)
  // -----------------------------------------------------------------
  const MODS = [
    // Angle de la direction hub→module (en radians, 0=droite)
    // On dessine chaque module centré à (cx*r, cy*r), orienté selon l'angle
    { a: -Math.PI/2,    cx:  0.000, cy: -0.575, w: 0.60, h: 0.38, tw: 0.70 }, // top
    { a: -Math.PI/4,    cx:  0.620, cy: -0.457, w: 0.58, h: 0.38, tw: 0.68 }, // top-right
    { a:  0,            cx:  0.950, cy:  0.000, w: 0.55, h: 0.36, tw: 0.68 }, // right
    { a:  Math.PI/4,    cx:  0.650, cy:  0.428, w: 0.58, h: 0.38, tw: 0.68 }, // bottom-right
    { a:  Math.PI/2,    cx:  0.000, cy:  0.487, w: 0.60, h: 0.36, tw: 0.70 }, // bottom
    { a:  3*Math.PI/4,  cx: -0.643, cy:  0.428, w: 0.58, h: 0.38, tw: 0.68 }, // bottom-left
    { a:  Math.PI,      cx: -0.950, cy:  0.000, w: 0.55, h: 0.36, tw: 0.68 }, // left
    { a: -3*Math.PI/4,  cx: -0.628, cy: -0.457, w: 0.58, h: 0.38, tw: 0.68 }, // top-left
  ];

  // Trier back-to-front (plus cy grand = plus devant)
  const sorted = [...MODS].sort((a, b) => a.cy - b.cy);

  // ─────────────────────────────────────────────────────────────────
  // MÂT — dessiné en premier (derrière tout)
  // Section large (sous le hub → junction avec modules bas)
  // Section fine (shaft) → pointe
  // -----------------------------------------------------------------
  const mTW   = r * 0.19;   // demi-largeur en haut du mât (±)
  const mBotW = r * 0.06;   // demi-largeur en bas
  const mY0   = r * 0.16;   // haut du mât (sous hub)
  const mMid  = r * 0.47;   // jonction large→fine
  const mBot  = r * 1.75;   // bas du mât

  // Section large (entre les modules bas et le shaft)
  const mG1 = ctx.createLinearGradient(-mTW, mY0, mTW, mMid);
  mG1.addColorStop(0,   '#d5daea');
  mG1.addColorStop(0.5, '#b0b8cc');
  mG1.addColorStop(1,   '#8892a8');
  ctx.beginPath();
  ctx.moveTo(-mTW,   mY0);
  ctx.lineTo( mTW,   mY0);
  ctx.lineTo( mTW * 0.55, mMid);
  ctx.lineTo(-mTW * 0.55, mMid);
  ctx.closePath();
  ctx.fillStyle = mG1; ctx.fill();
  ctx.strokeStyle = '#1a2235'; ctx.lineWidth = Math.max(0.5, r*0.012); ctx.stroke();

  // Shaft fin
  const mG2 = ctx.createLinearGradient(0, mMid, 0, mBot);
  mG2.addColorStop(0,   '#b8c0d2');
  mG2.addColorStop(0.4, '#909ab0');
  mG2.addColorStop(0.8, '#70788a');
  mG2.addColorStop(1,   '#505868');
  ctx.beginPath();
  ctx.moveTo(-mTW * 0.55, mMid);
  ctx.lineTo( mTW * 0.55, mMid);
  ctx.lineTo( mBotW, mBot);
  ctx.lineTo(-mBotW, mBot);
  ctx.closePath();
  ctx.fillStyle = mG2; ctx.fill();
  ctx.strokeStyle = '#18202e'; ctx.lineWidth = Math.max(0.4, r*0.010); ctx.stroke();

  // Lignes horizontales sur le shaft
  ctx.strokeStyle = 'rgba(55,80,135,0.20)'; ctx.lineWidth = Math.max(0.3, r*0.008);
  for (let i = 1; i <= 6; i++) {
    const t  = i / 7;
    const py = mMid + (mBot - mMid) * t;
    const pw = mTW * 0.55 + (mBotW - mTW * 0.55) * t;
    ctx.beginPath(); ctx.moveTo(-pw, py); ctx.lineTo(pw, py); ctx.stroke();
  }

  // Bande rouge médiane
  const bY2 = mMid + (mBot - mMid) * 0.50, bW2 = mTW * 0.50;
  ctx.fillStyle = 'rgba(188,38,46,0.70)';
  ctx.fillRect(-bW2, bY2 - r*0.035, bW2*2, r*0.080);

  // Anneaux bleus sur le shaft
  ctx.save();
  ctx.shadowBlur = r*0.7; ctx.shadowColor = 'rgba(60,155,255,0.85)';
  ctx.strokeStyle = 'rgba(80,190,255,0.90)'; ctx.lineWidth = Math.max(0.7, r*0.022);
  for (const t of [0.25, 0.58]) {
    const ry3 = mMid + (mBot - mMid) * t;
    const rw3 = (mTW*0.55 + (mBotW - mTW*0.55)*t) * 0.85;
    ctx.beginPath();
    // Ellipse très aplatie (on voit le shaft de dessus)
    ctx.ellipse(0, ry3, rw3, rw3 * 0.22, 0, 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.restore();

  // Culot du mât
  const tW3 = mBotW * 2.5, tH3 = r * 0.16;
  ctx.fillStyle = '#484e60';
  ctx.fillRect(-tW3, mBot, tW3*2, tH3);
  ctx.strokeStyle = '#1c2030'; ctx.lineWidth = Math.max(0.3, r*0.010); ctx.stroke();
  ctx.save(); ctx.shadowBlur = r*0.35; ctx.shadowColor='rgba(80,200,255,0.85)';
  for (const dx of [-tW3*0.45, 0, tW3*0.45]) {
    ctx.beginPath(); ctx.arc(dx, mBot+tH3*0.70, r*0.028, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(80,200,255,0.92)'; ctx.fill();
  }
  ctx.shadowBlur = 0; ctx.restore();

  // ─────────────────────────────────────────────────────────────────
  // 8 MODULES (back to front)
  // ─────────────────────────────────────────────────────────────────
  for (const mod of sorted) {
    const isBack = mod.cy < 0;
    const fade   = isBack ? 0.75 : 1.00;

    ctx.save();
    ctx.translate(mod.cx * r, mod.cy * r);
    ctx.rotate(mod.a + Math.PI/2);  // face "bas" du trapèze = vers l'extérieur

    const hw  = mod.w * r / 2;         // demi-largeur extérieure
    const hwT = hw * mod.tw;           // demi-largeur intérieure (côté hub)
    const hH  = mod.h * r / 2;        // demi-hauteur

    // Trapèze principal
    const modG = ctx.createLinearGradient(0, -hH, 0, hH);
    modG.addColorStop(0,    `rgba(222,228,244,${fade})`);
    modG.addColorStop(0.50, `rgba(195,203,220,${fade})`);
    modG.addColorStop(1,    `rgba(162,172,192,${fade})`);

    ctx.beginPath();
    ctx.moveTo(-hwT, -hH);
    ctx.lineTo( hwT, -hH);
    ctx.lineTo( hw,   hH);
    ctx.lineTo(-hw,   hH);
    ctx.closePath();
    ctx.fillStyle = modG; ctx.fill();
    ctx.strokeStyle = `rgba(16,22,42,${fade*0.70})`; ctx.lineWidth = Math.max(0.5, r*0.015); ctx.stroke();

    // Bande rouge supérieure (côté hub)
    ctx.fillStyle = `rgba(190,40,48,${fade*0.92})`;
    ctx.beginPath();
    ctx.moveTo(-hwT,      -hH);
    ctx.lineTo( hwT,      -hH);
    ctx.lineTo( hw*0.95,  -hH + mod.h*r*0.20);
    ctx.lineTo(-hw*0.95,  -hH + mod.h*r*0.20);
    ctx.closePath(); ctx.fill();

    // Bande rouge inférieure (côté extérieur)
    ctx.beginPath();
    ctx.moveTo(-hw*0.96,   hH - mod.h*r*0.14);
    ctx.lineTo( hw*0.96,   hH - mod.h*r*0.14);
    ctx.lineTo( hw,        hH);
    ctx.lineTo(-hw,        hH);
    ctx.closePath(); ctx.fill();

    // 3 fenêtres bacta bleues (zone centrale)
    ctx.save();
    ctx.shadowBlur = r*0.45; ctx.shadowColor = 'rgba(48,148,255,0.75)';
    const wY0 = -hH + mod.h*r*0.22, wH4 = mod.h*r*0.50;
    const wW4 = mod.w*r*0.16;
    for (let i = 0; i < 3; i++) {
      const wx = (i - 1) * mod.w*r*0.27;
      ctx.fillStyle = `rgba(40,145,255,${fade*0.78})`;
      ctx.fillRect(wx - wW4/2, wY0, wW4, wH4);
      ctx.strokeStyle = `rgba(135,210,255,${fade*0.92})`;
      ctx.lineWidth = Math.max(0.4, r*0.011);
      ctx.strokeRect(wx - wW4/2, wY0, wW4, wH4);
    }
    ctx.shadowBlur = 0; ctx.restore();

    // Dôme sommital (côté hub)
    ctx.beginPath();
    ctx.arc(0, -hH, hw * 0.25, Math.PI, 0, false);
    ctx.closePath();
    const dGm = ctx.createRadialGradient(0,-hH,0, 0,-hH, hw*0.25);
    dGm.addColorStop(0, `rgba(238,244,255,${fade})`);
    dGm.addColorStop(1, `rgba(185,196,218,${fade})`);
    ctx.fillStyle = dGm; ctx.fill();
    ctx.strokeStyle = `rgba(40,55,88,${fade*0.45})`; ctx.lineWidth = Math.max(0.3, r*0.009); ctx.stroke();

    // Petits modules coins (sous-structures extérieures)
    for (const kx of [-hw*0.80, hw*0.80]) {
      ctx.fillStyle = `rgba(205,215,235,${fade*0.78})`;
      ctx.fillRect(kx - r*0.040, hH - mod.h*r*0.38, r*0.080, r*0.055);
      ctx.strokeStyle = `rgba(30,42,68,${fade*0.45})`; ctx.lineWidth = Math.max(0.2, r*0.008); ctx.stroke();
    }

    // Feux de navigation
    const bNav = isBack ? 0.58 : 0.95;
    ctx.save(); ctx.shadowBlur = r*0.25;
    ctx.shadowColor = 'rgba(255,55,45,0.80)';
    ctx.beginPath(); ctx.arc(-hw*0.85, hH*0.90, r*0.028, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,52,42,${bNav})`; ctx.fill();
    ctx.shadowColor = 'rgba(255,225,180,0.80)';
    ctx.beginPath(); ctx.arc( hw*0.85, hH*0.90, r*0.028, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,225,180,${bNav})`; ctx.fill();
    ctx.shadowBlur = 0; ctx.restore();

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────
  // HUB CENTRAL
  // Anneau extérieur blanc/gris, trou sombre, anneau bleu lumineux
  // ─────────────────────────────────────────────────────────────────
  const HR  = r * 0.50;   // rayon anneau extérieur
  const BLR = r * 0.38;   // rayon anneau bleu
  const INR = r * 0.26;   // rayon trou central
  // Tout est vu légèrement de côté → ellipses aplatisses (ry < rx)
  const HFY = 0.42;       // aplatissement (mesuré sur l'image)
  const HY  = -HR * HFY * 0.28;  // décalage vertical (hub légèrement au-dessus centre)

  // Corps du hub
  const hubG2 = ctx.createRadialGradient(0, HY, INR, 0, HY, HR);
  hubG2.addColorStop(0,    '#e8ecf8');
  hubG2.addColorStop(0.55, '#bcc4d8');
  hubG2.addColorStop(1,    '#82889e');
  ctx.beginPath(); ctx.ellipse(0, HY, HR, HR*HFY, 0, 0, Math.PI*2);
  ctx.fillStyle = hubG2; ctx.fill();
  ctx.strokeStyle = '#1a2238'; ctx.lineWidth = Math.max(0.8, r*0.020); ctx.stroke();

  // Bande rouge sur le hub
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, HY, HR, HR*HFY, 0, 0, Math.PI*2); ctx.clip();
  ctx.fillStyle = 'rgba(190,40,48,0.74)';
  ctx.fillRect(-HR, HY - r*0.026, HR*2, r*0.072);
  ctx.restore();

  // Trou central (espace sombre — le mât émerge ici)
  ctx.beginPath(); ctx.ellipse(0, HY, INR, INR*HFY, 0, 0, Math.PI*2);
  ctx.fillStyle = '#090c18'; ctx.fill();
  ctx.strokeStyle = '#22283a'; ctx.lineWidth = Math.max(0.4, r*0.012); ctx.stroke();

  // Anneau bleu lumineux (signature principale)
  ctx.save();
  ctx.shadowBlur  = r * 2.2; ctx.shadowColor = 'rgba(48,148,255,0.95)';
  ctx.strokeStyle = 'rgba(78,192,255,0.98)';
  ctx.lineWidth   = Math.max(2.0, r * 0.062);
  ctx.beginPath(); ctx.ellipse(0, HY, BLR, BLR*HFY, 0, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur  = r * 0.6;
  ctx.strokeStyle = 'rgba(168,228,255,0.58)';
  ctx.lineWidth   = Math.max(0.6, r * 0.018);
  ctx.beginPath(); ctx.ellipse(0, HY, BLR*0.80, BLR*0.80*HFY, 0, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur  = 0; ctx.restore();

  // Dôme central au-dessus du hub
  const DR3 = HR * 0.45, DRY3 = HR * HFY * 0.36;
  ctx.beginPath(); ctx.ellipse(0, HY - DRY3*0.18, DR3, DRY3, 0, Math.PI, 0, true);
  const dGh = ctx.createLinearGradient(0, HY-DRY3, 0, HY);
  dGh.addColorStop(0, '#edf1fa'); dGh.addColorStop(1, '#b4bccf');
  ctx.fillStyle = dGh; ctx.fill();
  ctx.strokeStyle = '#1e2840'; ctx.lineWidth = Math.max(0.5, r*0.014); ctx.stroke();

  // Croix médicale blanche
  const CS4 = DR3*0.28, CT4 = DR3*0.09, CY4 = HY - DRY3*0.28;
  ctx.fillStyle = 'rgba(238,244,255,0.82)';
  ctx.fillRect(-CT4/2, CY4-CS4, CT4, CS4*2);
  ctx.fillRect(-CS4, CY4-CT4/2, CS4*2, CT4);

  // Antenne
  ctx.strokeStyle = '#98a2b5'; ctx.lineWidth = Math.max(0.6, r*0.018);
  ctx.beginPath(); ctx.moveTo(0, HY-DRY3*1.05); ctx.lineTo(0, HY-DRY3*2.50); ctx.stroke();
  ctx.save(); ctx.shadowBlur = r*0.70; ctx.shadowColor = 'rgba(72,172,255,0.90)';
  ctx.beginPath(); ctx.arc(0, HY-DRY3*2.50, r*0.048, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(98,192,255,0.95)'; ctx.fill();
  ctx.shadowBlur = 0; ctx.restore();

  ctx.restore();
}
