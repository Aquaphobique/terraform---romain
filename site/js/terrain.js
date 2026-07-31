/**
 * terrain.js — Physical terrain bodies for scenario effects
 *
 * Types: asteroid, debris, explosive_debris, nebula_cloud
 * - All have position, radius (cells), hp, mass
 * - Destructible: hp → 0 → destroyed (explosive_debris triggers area explosion)
 * - Pushable: collision shifts position
 * - Ships try to avoid them (AI obstacle avoidance)
 * - All z-levels (z 1–5, or z_all)
 */

import CONFIG from './config.js';
import { clamp } from './utils.js';

export const TERRAIN_RADIUS = { tiny: 0.5, small: 0.8, medium: 1.4, large: 2.2 };

/** Generate a debris/asteroid field */
export function generateDebrisField(cols, rows, density = 0.3) {
  const objects = [];
  const count = Math.round(density * cols * 0.6);
  for (let i = 0; i < count; i++) {
    const isExplosive = Math.random() < 0.06;   // 6% chance explosive
    const sizeKey     = ['tiny','small','small','medium','medium','large'][Math.floor(Math.random()*6)];
    const r           = TERRAIN_RADIUS[sizeKey] || 0.8;
    objects.push({
      id:          'debris_' + i,
      type:        isExplosive ? 'explosive_debris' : (Math.random() < 0.05 ? 'asteroid' : 'debris'), // ~5% astéroïdes seulement
      x:           3 + Math.random() * (cols - 6),
      y:           3 + Math.random() * (rows - 6),
      z:           Math.ceil(Math.random() * 5),  // random altitude 1-5
      radius:      r,
      mass:        r * r * 8,
      hp:          Math.round(r * 30),
      maxHp:       Math.round(r * 30),
      isExplosive,
      destroyed:   false,
      vx: 0, vy: 0,  // velocity for push physics
    });
  }
  return objects;
}

/** Generate sparse asteroid field (less dense, bigger rocks) */
export function generateAsteroidField(cols, rows) {
  return generateDebrisField(cols, rows, 0.2);
}


/** Champ de GLACE : très nombreux petits fragments inévitables.
 *  Dégâts faibles mais PROPORTIONNELS À LA VITESSE — pousse à ralentir. */
export function generateIceField(cols, rows) {
  const objects = [];
  const count = Math.round(cols * 2.2); // TRÈS dense (~1000 fragments sur 480)
  for (let i = 0; i < count; i++) {
    const r = 0.15 + Math.random() * 0.35; // minuscules (0.15-0.5 case)
    objects.push({
      id:        'ice_' + i,
      type:      'ice_shard',
      x:         Math.random() * cols,
      y:         Math.random() * rows,
      z:         Math.ceil(Math.random() * 5),
      radius:    r,
      mass:      0.2,
      hp:        999999, maxHp: 999999, // indestructibles (trop petits) — valeur finie : Infinity ne survit pas à la sérialisation P2P (JSON/binarypack → null), ce qui cassait la connexion des joueurs sur ce terrain
      destroyed: false,
      vx: 0, vy: 0,
      _spin: Math.random() * Math.PI * 2,
    });
  }
  return objects;
}

/** Generate nebula clouds — amas organiques façon nébuleuse de la Carène :
 *  5-8 AMAS, chacun composé de 4-9 blobs qui se chevauchent le long d'une
 *  dérive directionnelle → formes filamenteuses irrégulières couvrant
 *  une large portion de la carte, avec des couloirs dégagés entre les amas. */
export function generateNebulaClouds(cols, rows) {
  const clouds  = [];
  let   id      = 0;
  const nAmas   = 5 + Math.floor(Math.random() * 4); // 5-8 amas

  // Palettes inspirées de vraies nébuleuses (Carène, Orion, Aigle, Lagune…)
  const PALETTES = [
    { name:'violet',  c0:[140,70,220], c1:[70,30,150] },   // violet/magenta (Carène)
    { name:'cyan',    c0:[40,160,200], c1:[20,80,140] },    // bleu-cyan (reflets gazeux)
    { name:'rose',    c0:[220,90,150], c1:[150,40,90] },    // rose/rouge (hydrogène)
    { name:'or',      c0:[210,150,60], c1:[140,90,30] },    // or/ambre (poussière chaude)
    { name:'vert',    c0:[80,180,120], c1:[40,110,70] },    // vert-émeraude (oxygène)
    { name:'orange',  c0:[230,120,50], c1:[150,60,20] },    // orange (piliers de la Création)
  ];
  for (let a = 0; a < nAmas; a++) {
    // Cœur de l'amas
    let cx = 15 + Math.random() * (cols - 30);
    let cy = 15 + Math.random() * (rows - 30);
    const drift   = Math.random() * Math.PI * 2;
    const nBlobs  = 4 + Math.floor(Math.random() * 6); // 4-9 blobs par amas
    // Une palette par amas, avec légère variation de teinte entre blobs
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];

    for (let b = 0; b < nBlobs; b++) {
      // Variation de luminosité par blob pour un rendu organique
      const v = 0.75 + Math.random() * 0.5;
      clouds.push({
        id:     'nebula_' + (id++),
        type:   'nebula_cloud',
        x:      Math.max(5, Math.min(cols - 5, cx)),
        y:      Math.max(5, Math.min(rows - 5, cy)),
        z:      0,
        radius: 10 + Math.random() * 22,
        mass:   0, hp: 999999, maxHp: 999999, // valeur finie (voir ice_field)
        destroyed: false,
        vx: 0, vy: 0,
        // Couleurs de la palette de l'amas, avec variation de luminosité
        _c0: [Math.round(pal.c0[0]*v), Math.round(pal.c0[1]*v), Math.round(pal.c0[2]*v)],
        _c1: [Math.round(pal.c1[0]*v), Math.round(pal.c1[1]*v), Math.round(pal.c1[2]*v)],
      });
      // Marche le long de la dérive avec dispersion latérale
      const step = 12 + Math.random() * 16;
      const wob  = (Math.random() - 0.5) * 1.4;
      cx += Math.cos(drift + wob) * step;
      cy += Math.sin(drift + wob) * step;
    }
  }
  return clouds;
}

/** Check if a position is inside a nebula cloud */
export function inNebula(x, y, terrain) {
  if (!terrain?.length) return false;
  return terrain.some(t => t.type === 'nebula_cloud' && !t.destroyed &&
    Math.hypot(x - t.x, y - t.y) < t.radius);
}

/** Resolve collision between a ship and a terrain body */
export function resolveShipTerrainCollision(ship, body, explosionCallback) {
  if (body.destroyed || body.type === 'nebula_cloud') return;

  // Only collide if z matches (or body is on all levels)
  const bz = Math.round(ship.position.z);
  if (body.z !== 0 && Math.abs(body.z - bz) > 1) return;

  const d = Math.hypot(ship.position.x - body.x, ship.position.y - body.y);
  const ra = body.radius;
  const rb = 0.3; // ship effective collision radius (small)
  if (d >= ra + rb) return;

  // Push ship away
  if (d > 0.01) {
    const nx   = (ship.position.x - body.x) / d;
    const ny   = (ship.position.y - body.y) / d;
    const push = (ra + rb - d) * 0.8;
    ship.position.x = clamp(ship.position.x + nx * push, 0, CONFIG.GRID_COLS - 1);
    ship.position.y = clamp(ship.position.y + ny * push, 0, CONFIG.GRID_ROWS - 1);
    // Slight push to body too (mass ratio)
    const massRatio  = (ship.mass || 1) / (body.mass || 100);
    body.vx -= nx * push * massRatio * 0.4;
    body.vy -= ny * push * massRatio * 0.4;
  }

  // Damage ship from impact
  const impactDmg = Math.round(body.mass * 0.04 * (1 - Math.min(0.5, (ship.hullArmor || 0) / 100)));
  ship.hp = Math.max(0, ship.hp - impactDmg);
  ship._recentlyHit = true;

  // Damage body from impact
  body.hp = Math.max(0, body.hp - Math.round((ship.mass || 1) * 0.6));
  if (body.hp <= 0 && !body.destroyed) {
    body.destroyed = true;
    if (body.isExplosive) {
      explosionCallback?.({ x: body.x, y: body.y, z: body.z, radius: body.radius * 3 + 2 });
    }
  }
}

/** Apply gravity well pull to a ship (black hole at center) */
export function applyGravityWell(ship, cx, cy, strength) {
  const dx   = cx - ship.position.x;
  const dy   = cy - ship.position.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const force = (strength || 0.3) / (dist * dist) * 400;
  ship.position.x = clamp(ship.position.x + (dx / dist) * force, 0, CONFIG.GRID_COLS - 1);
  ship.position.y = clamp(ship.position.y + (dy / dist) * force, 0, CONFIG.GRID_ROWS - 1);
  // Ships too close → spaghettification (heavy damage)
  if (dist < 4) {
    ship.hp = Math.max(0, ship.hp - dist < 2 ? 20 : 3);
    ship._recentlyHit = true;
  }
}

/** Update terrain body velocities/positions (drift from impacts) */
export function updateTerrainPhysics(terrain) {
  for (const body of terrain) {
    if (body.destroyed || body.type === 'nebula_cloud') continue;
    if (Math.abs(body.vx) < 0.001 && Math.abs(body.vy) < 0.001) continue;
    body.x  = clamp(body.x + body.vx, 0, CONFIG.GRID_COLS - 1);
    body.y  = clamp(body.y + body.vy, 0, CONFIG.GRID_ROWS - 1);
    body.vx *= 0.92; // friction
    body.vy *= 0.92;
  }
}
