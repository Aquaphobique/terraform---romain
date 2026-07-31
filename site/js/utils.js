/**
 * UTILS — Common utility functions
 */

/** Generates a short unique ID (8 hex chars) */
export function nanoid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Clamps a value between min and max */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Euclidean 2D distance between two positions {x, y} */
export function dist2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** 3D distance between two positions {x, y, z} */
export function dist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Returns the normalized direction vector from A to B (2D)
 * @returns {{dx: number, dy: number}}
 */
export function dirTo(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

/** Rolls a random chance [0-1], returns true if hit */
export function roll(chance) {
  return Math.random() < chance;
}

/** Formats a number with at most 1 decimal place */
export function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number.isInteger(n) ? n : Number(n).toFixed(1);
}

/** Returns percentage [0-100] for a progress bar */
export function pct(current, max) {
  if (max <= 0) return 0;
  return clamp((current / max) * 100, 0, 100);
}

/** Human-readable labels for ship types */
export const TYPE_LABELS = {
  fighter:       '🛸 Fighter',
  heavy_fighter: '🛸 Heavy Fighter',
  interceptor:   '⚡ Interceptor',
  bomber:        '💣 Bomber',
  gunship:       '🔫 Gunship',
  transport:     '📦 Transport',
  corvette:      '🚢 Corvette',
  frigate:       '⚓ Frigate',
  cruiser:       '🛳 Cruiser',
  destroyer:     '⚔️ Destroyer',
  dreadnought:   '🏴‍☠️ Dreadnought',
  other:         '🔧 Other',
};

/** Icons for the grid based on ship type */
export const TYPE_ICONS = {
  fighter:       '✦',
  heavy_fighter: '◈',
  interceptor:   '▸',
  bomber:        '◉',
  gunship:       '⬡',
  transport:     '▭',
  corvette:      '⬟',
  frigate:       '⬢',
  cruiser:       '⬣',
  destroyer:     '⬛',
  dreadnought:   '⬤',
  other:         '?',
};

/** Ship size → display radius on canvas (px) */
// Ship radii in world-pixels. CELL_SIZE=56.
// XS = 0.5 cell diameter, S = 1 cell, M = 2 cells, L = 4 cells, XL = 6 cells
export const SIZE_RADIUS = {
  XS:  14,   // 0.25 × 56 — half a cell radius
  S:   28,   // 0.50 × 56 — one cell radius
  M:   56,   // 1.00 × 56 — two cells diameter
  L:  112,   // 2.00 × 56 — four cells diameter
  XL: 168,   // 3.00 × 56 — six cells diameter
  XXL:252,   // 4.50 × 56 — nine cells diameter
};

/**
 * Volume de cale consommé par un vaisseau selon sa taille, pour le système
 * de hangar des stations (éditeur de cale du MJ). Un X-Wing (XS) prend très
 * peu de place ; un croiseur (XXL) prend toute la cale d'une petite station.
 * Échelle volumique (≈ taille³) plutôt que linéaire, pour refléter qu'on
 * peut vraiment stocker BEAUCOUP de petits chasseurs dans un grand hangar.
 */
export const SHIP_HANGAR_VOLUME = {
  XS: 1,
  S:  3,
  M:  12,
  L:  50,
  XL: 160,
  XXL: 500,
};

/**
 * Volume de CALE MARCHANDE par taille de vaisseau (cargo de marchandises —
 * matériel médical, épice, minéraux, contrebande, etc. — voir CARGO_TYPES
 * dans models.js). Échelle distincte du hangar de chasseurs : un vaisseau
 * de combat a très peu de cale (juste des fournitures de bord), un cargo/
 * freighter en a beaucoup. Le MJ peut ajuster manuellement par vaisseau.
 */
/**
 * Capacité de cargaison par défaut selon la TAILLE, en TONNES.
 * Valeurs de fallback — les classes avec données canoniques overrident en presets.
 * Référence : YT-1300 = 100t, Gozanti = 75t, ISD ~36 000t, Acclamator ~5 000t.
 */
export const CARGO_HOLD_VOLUME = {
  XS: 0,      // chasseurs : pas de soute marchande
  S:  100,    // petits cargos / navettes (ref: YT-1300 = 100t)
  M:  800,    // corvettes / cargos moyens (ref: Gozanti 75t, CR90 ~500t)
  L:  3000,   // frégates / transports moyens
  XL: 20000,  // croiseurs (ref: ISD ~36 000t, Venator ~15 000t cargo)
  XXL: 80000, // super-cuirassés / lucrehulk
};

/**
 * Capacité de base pour BLESSÉS (espace médical) — tout vaisseau peut en
 * transporter quelques-uns par défaut, indépendamment de tout équipement
 * spécial. Une frégate médicale dédiée aura une capacité bien supérieure,
 * configurée manuellement par le MJ (overrides.medicalCapacity).
 */
export const MEDICAL_BAY_CAPACITY = {
  XS: 0,   // pas de place à bord d'un chasseur monoplace
  S:  1,
  M:  3,
  L:  6,
  XL: 12,
  XXL: 25,
};

/**
 * Capacité de base pour CAPTIFS (cellules de détention) — 1 à 5 selon la
 * taille si le vaisseau est assez grand pour en avoir ; les chasseurs n'en
 * ont aucune. Un vaisseau équipé de cellules dédiées (prison/transport
 * pénitentiaire) aura une capacité bien supérieure, configurée par le MJ.
 */
export const BRIG_CAPACITY = {
  XS: 0,
  S:  0,
  M:  1,
  L:  3,
  XL: 5,
  XXL: 5,
};

/**
 * Types de cargaison → SIGNATURE ÉNERGÉTIQUE pour le scanner long.
 * 0 = inexistante | 1 = basse | 2 = haute
 */
export const CARGO_ENERGY_SIGNATURE = {
  vivres: 0, eau: 0, textiles: 0, detritus: 0, betail: 0,
  carburant: 1, composants: 1, pieces_droides: 1, medical: 1,
  mineraux: 0, mineraux_precieux: 0, kyber_brut: 0, artefacts: 0,
  carbonite: 1, armes_civiles: 1,
  explosifs: 2, matieres_dangereuses: 2, armes_guerre: 2,
  epice: 1, contrebande: 1, contrebande_precieuse: 1,
  donnees_classifiees: 2,
};

/** Libellés de signature pour affichage scanner */
export const SIGNATURE_LABELS = ['◌ Inexistante', '◎ Basse', '● Haute'];

/**
 * Types de cargaison → nature ORGANIQUE (true) ou MINÉRALE (false).
 * Organique : liquides, gaz, matières vivantes, alimentaire, drogues.
 * Minérale : solide inerte, métal, cristal, données.
 */
export const CARGO_IS_ORGANIC = {
  vivres: true, eau: true, betail: true, epice: true, carburant: true,
  matieres_dangereuses: true,  // gaz/produits chimiques
  pieces_droides: false, composants: false, textiles: false,
  medical: true,  // produits biologiques
  mineraux: false, mineraux_precieux: false, kyber_brut: false,
  carbonite: false, explosifs: false, armes_civiles: false, armes_guerre: false,
  artefacts: false, contrebande: false, contrebande_precieuse: false,
  donnees_classifiees: false, detritus: true,  // déchets organiques
};

/** Fleet color palette (index → hex) */
// 8 official faction colors (matches faction.js FACTION_COLORS)
export const FLEET_COLORS = [
  '#4488ff',   // 0 — Faction Bleue
  '#ff3333',   // 1 — Faction Rouge
  '#228822',   // 2 — Faction Verte (foncée)
  '#cc22cc',   // 3 — Faction Magenta
  '#ff8800',   // 4 — Faction Orange
  '#44cc44',   // 5 — Faction Vert Clair
  '#ffdd00',   // 6 — Faction Jaune
  '#ff88bb',   // 7 — Faction Rose
  '#888888',   // 8 — Neutre (gris, contrôlé par le MJ uniquement)
];

/** Ship size → default HP */
export const SIZE_DEFAULT_HP = {
  XS:  25,    // chasseurs : fragiles (2-4 tirs selon l'arme)
  S:   60,    // canonnières légères
  M:   300,
  L:   700,
  XL:  2000,
  XXL: 6000,
};

/** Ship size → default speed (cells/tick) — increased for lively combat */
export const SIZE_DEFAULT_SPEED = {
  XS:  3.5,   // fighters: fast and agile
  S:   2.5,
  M:   1.6,
  L:   1.1,
  XL:  0.75,
  XXL: 0.45,
};

/** Bombardment damage modifier by target size */
export const BOMBARDMENT_SIZE_MOD = {
  XS:  0.5,
  S:   0.75,
  M:   1.0,
  L:   1.25,
  XL:  1.5,
  XXL: 2.0,
};
