/**
 * CONFIG — Global constants for the simulator
 *
 * Modify these values to adjust game behavior.
 * All tunable values are centralized here for easy balancing.
 */
const CONFIG = {

  // ─── GRID ─────────────────────────────────
  GRID_COLS: 480,   // 1 cell = 20m → 480×480 = 9.6km × 9.6km battle space
  GRID_ROWS: 480,
  CELL_SIZE:  56,           // px per cell at zoom 1.0
  M_PER_CELL: 20,           // 1 grid cell = 20 real metres
  SPEED_MULT: 2.0,          // global speed multiplier

  // Vision ranges per size class (in cells, for fog of war)
  VISION_RANGE: { XS: 15, S: 18, M: 22, L: 28, XL: 35, XXL: 40 },

  // Hyperspace: ships within this range of a route point can jump
  HYPERSPACE_DOCK_RANGE: 5,

  // ─── ALTITUDES ────────────────────────────
  ALTITUDE_MIN: 1,
  ALTITUDE_MAX: 5,
  /**
   * Vertical offset per altitude level (px).
   * Creates the 2.5D effect: ships at higher altitude appear "above".
   */
  ALTITUDE_Y_OFFSET: 56,   // 1 full CELL_SIZE per level — clearly legible
  ALTITUDE_X_OFFSET: 20,   // slight horizontal drift per level
  /**
   * Opacity per altitude level [index = z, 0 unused]
   * Inactive altitudes are semi-transparent to keep the view readable.
   */
  ALTITUDE_OPACITY: [0, 0.22, 0.42, 0.62, 0.82, 1.0],

  // ─── SIMULATION ───────────────────────────
  TICK_RATE: 1,
  TICK_INTERVAL_MS: 3500,   // 3.5 s d'animation par tic

  /**
   * Sub-steps per tick: micro-étapes de simulation par tic (fluidité des courbes).
   */
  SIM_SUB_STEPS: 16,

  /**
   * Échelle de temps par tic : chaque tic représente PLUS de temps de jeu.
   * 1.0 = comportement d'origine. 1.8 = un tic couvre ~1.8× plus de déplacement
   * et de tirs → on donne des ordres moins souvent (moins de micro-management)
   * pour un même résultat tactique. Appliqué au mouvement et aux cadences de tir.
   */
  TICK_TIME_SCALE: 1.8,
  /**
   * Fire rate multiplier — applied to weapon cooldowns.
   * 3 = weapons fire 3× as fast (more action per tick).
   */
  FIRE_RATE_MULT: 3,

  // ─── CAMERA ───────────────────────────────
  CAMERA_PAN_SPEED: 8,      // px per frame (key held)
  ZOOM_MIN: 0.03,   // much further out
  ZOOM_MAX: 6.0,   // closer up
  ZOOM_STEP: 0.05,  // smoother steps
  ROTATION_STEP: 45,        // degrees per A/E key press

  // ─── COMBAT ───────────────────────────────
  COLLISION_DAMAGE_FACTOR: 0.01,  // réduit x5 — les collisions accidentelles ne tuent plus
  EXPLOSION_BASE_DAMAGE:   20,
  RAMMING_DAMAGE_MULT:     2,
  SHIELD_RESTART_DELAY:    3,         // ticks before shield restarts
  /**
   * Damage reduction per armor level (hullArmor 1–5).
   * hullArmor 1 = 10%, 2 = 20%, … 5 = 50%
   */
  HULL_ARMOR_REDUCTION: 0.10,

  // ─── ION ──────────────────────────────────
  ION_STACK_SHIELD_REGEN: 3,  // stacks → -50% shield recharge rate
  ION_STACK_DRIVE_OFF:    5,  // stacks → engines offline 1 tick
  ION_STACK_SHIELD_OFF:   7,  // stacks → shields offline 1–2 ticks
  ION_STACK_SYSTEMS_OFF:  10, // stacks → all systems offline 1 tick
  ION_DECAY_PER_TICK: 0.2,    // ion stacks lost per tick (natural decay)

  // ─── RENDERING ────────────────────────────
  GRID_COLOR:       '#1a2035',
  GRID_LINE_COLOR:  '#1e2740',
  SELECTION_COLOR:  '#ffe566',
  PROJECTILE_SPEED: 3,
  /**
   * Perspective Y compression applied in SCREEN SPACE (before world rotation).
   * 1.0 = flat top-down; 0.6 = strong plunging view. No distortion on rotation.
   */
  PERSPECTIVE_Y: 0.65,

  // ─── TURN RATES (radians per tick) ────────
  // Larger ships turn slower. Turning at full rate reduces forward speed.
  TURN_RATES: {
    XS:  0.64,   // ×2 — fighters turn much faster
    S:   0.50,
    M:   0.32,
    L:   0.21,
    XL:  0.13,
    XXL: 0.07,
  },
  TURN_SPEED_PENALTY: 0.65,   // max speed reduction when turning sharply (0=stop, 1=no penalty)
  ROTATION_SPEED: 1.8,        // camera rotation degrees per frame (smooth, any angle)

  // ─── REPLAY ───────────────────────────────
  REPLAY_MAX_TICKS: 5000,     // safety limit

  // ─── MULTIPLAYER (stub) ───────────────────
  // TODO: replace with your WebSocket server URL
  WS_SERVER_URL: 'ws://localhost:8080',
};

export default CONFIG;
