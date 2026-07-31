/**
 * boarding.js — Amarrage & Abordage
 *
 * Système en trois couches :
 *   1. AMARRAGE : vaisseau adverse à bouclier coupé → order 'dock'
 *   2. TROUPES  : passagers typés (clone, droïde, stormtrooper, etc.)
 *   3. ABORDAGE : combat interne tick-par-tick avec efficacité individuelle
 *
 * PHILOSOPHIE D'ÉQUILIBRE (lore-accurate) :
 *   offense = puissance de feu d'UNE unité intelligente avec ses stratégies propres
 *             (flanquement, couverture, visée ciblée — pas juste "nb de tirs")
 *   armor   = survivabilité combinée (équipement + esquive + tactiques défensives)
 *   morale  = résistance à la déroute (droïdes = 1.0, élites ~0.95+)
 *
 * HIÉRARCHIE DE PUISSANCE (Tier SSS → D) :
 *   SSS : Maître Jedi / Sith Lord (Yoda, Mace, Vader, Sidious)      → off 3.0–3.5
 *   SS  : Jedi Knight, Sith Apprenti, Inquisiteur puissant           → off 2.0–2.5
 *   S   : Clone Commando RC, MagnaGarde, Dark Trooper                → off 0.75–1.10
 *   A   : ARC Trooper, Clone Heavy/Shock, Droideka, Mandalorian      → off 0.45–0.80
 *   B   : Clone standard, Death Trooper, Commando droïde, Wookiee    → off 0.25–0.45
 *   C   : Stormtrooper, Rebel, ARF Scout, B2, Snowtrooper            → off 0.12–0.20
 *   D   : B1 Droïde, Milice, Pirate, Garde Naboo                     → off 0.006–0.10
 *   E   : Civil, Contrebandier, Droïde de service                    → off 0.01–0.05
 *
 * ÉQUILIBRES CANON VÉRIFIÉS :
 *   • 100 clones gagnent contre 1 000 B1 (10:1), perdent à 1 200 (12:1)
 *   • 3 B1 écrasent 1 milicien ordinaire (sans matchMod)
 *   • 1 Droideka = ~10 clones standards (bouclier quasi-infranchissable)
 *   • 1 MagnaGarde nécessite 4–5 clones standards ou 1 Clone Commando
 *   • 1 Mandalorien (beskar) bat ~10 stormtroopers grâce à l'armure
 *   • 1 Jedi maîtrisé bat des dizaines de stormtroopers seul
 */

// ═══════════════════════════════════════════════════════
// TYPES DE TROUPES
// ═══════════════════════════════════════════════════════

export const TROOP_TYPES = {

  // ════════════════════════════════════════════════════
  // FORCE-SENSITIVES — Tier SSS/SS
  // ════════════════════════════════════════════════════

  // Jedi : Force + vitesse + prédiction = destroys infantry, malus vs civils (Code)
  jedi:               { label: 'Jedi',                       icon: '🔵', color: '#00cec9', armor: 0.60, offense: 3.00, morale: 1.00 },
  // Sith : Force + rage + aucune retenue = encore plus dévastateur
  sith:               { label: 'Sith',                       icon: '🔴', color: '#d63031', armor: 0.65, offense: 3.50, morale: 1.00 },
  // Inquisiteur : Force + entraînement de combat, moins maîtrisé qu'un Jedi Knight
  inquisitor:         { label: 'Inquisiteur',                icon: '⚡', color: '#6c5ce7', armor: 0.55, offense: 2.00, morale: 1.00 },

  // ════════════════════════════════════════════════════
  // CLONES — République Galactique
  // Tier S–B selon la spécialisation
  // ════════════════════════════════════════════════════

  // Clone standard : armure Katarn + formation Kamino — bat 10 B1 en espace confiné
  clone:              { label: 'Clone Trooper',              icon: '🪖', color: '#4a9eff', armor: 0.46, offense: 0.45, morale: 0.95 },
  // Clone Commando (RC) : Delta Squad, Omega Squad — élite absolue des clones
  // Canon : chacun vaut plusieurs clones standards, can beat magnaguard alone
  clone_commando:     { label: 'Clone Commando (RC)',        icon: '💠', color: '#0984e3', armor: 0.58, offense: 1.10, morale: 0.98 },
  // ARC Trooper : Advanced Recon Commando — armement lourd, autonomie totale
  // Canon : 1 ARC vaut ~10 soldats ordinaires, mission solo derrière les lignes
  clone_arc:          { label: 'ARC Trooper',                icon: '🎖', color: '#2980b9', armor: 0.52, offense: 0.80, morale: 0.97 },
  // Heavy Clone : Z-6 Rotary Cannon — suppression de masse, efficace en couloirs
  clone_heavy:        { label: 'Clone Lourd (Z-6)',          icon: '🔫', color: '#3498db', armor: 0.45, offense: 0.60, morale: 0.95 },
  // Shock Trooper : Coruscant Guard — combat urbain, armure renforcée rouge
  clone_shock:        { label: 'Shock Trooper',              icon: '🛡', color: '#e74c3c', armor: 0.50, offense: 0.52, morale: 0.96 },
  // ARF Trooper : scout camouflagé, mobilité > protection
  clone_arf:          { label: 'ARF Scout Trooper',          icon: '👁', color: '#5dade2', armor: 0.28, offense: 0.32, morale: 0.92 },
  // SCUBA Clone : combat sous-marin — efficace en aquatique, passable à sec
  clone_scuba:        { label: 'Clone SCUBA',                icon: '🌊', color: '#1abc9c', armor: 0.35, offense: 0.28, morale: 0.93 },
  // Medic Clone : soutien, non-combattant principal
  clone_medic:        { label: 'Clone Médic',                icon: '➕', color: '#27ae60', armor: 0.35, offense: 0.15, morale: 0.90 },

  // ════════════════════════════════════════════════════
  // SÉPARATISTES — Droïdes CIS
  // ════════════════════════════════════════════════════

  // B1 Battle Droid : canon de base — faible solo, dévastateur en masse
  // offense 0.008 : 300 B1 écrasent 100 miliciens; 1 000 B1 débordent 100 clones
  droid:              { label: 'Droïde B1',                  icon: '🤖', color: '#888fa0', armor: 0.05, offense: 0.008, morale: 1.00 },
  // B2 Super Battle Droid : armure intégrée + bras-blasters doubles — nécessite plusieurs clones
  droid_b2:           { label: 'Super Droïde B2',            icon: '🦾', color: '#5d6d7e', armor: 0.38, offense: 0.060, morale: 1.00 },
  // Droideka (Destroyer Droid) : bouclier générateur + double répéteurs — quasi-indestructible
  // Canon : "Droïdes détruire !" — nécessite explosifs, flanquement, ou Force pour les arrêter
  droideka:           { label: 'Droideka (Destroyer)',       icon: '🔄', color: '#e74c3c', armor: 0.72, offense: 0.220, morale: 1.00 },
  // BX Commando Droid : furtif, vibroblades, désactivation électronique
  // Canon : niveau d'un clone d'élite, surpasse largement stormtroopers
  droid_commando:     { label: 'Droïde Commando BX',        icon: '🗡', color: '#c0392b', armor: 0.28, offense: 0.380, morale: 1.00 },
  // MagnaGarde (IG-100) : bâtons electrostaff résistant aux sabres-laser, phrik armor
  // Canon : conçus PAR Grievous pour combattre les Jedi — surpasse largement un clone
  magnaguard:         { label: 'MagnaGarde (IG-100)',        icon: '⚡', color: '#f39c12', armor: 0.55, offense: 0.900, morale: 1.00 },
  // Droïde Aqua (SCUBA) : jetpacks aquatiques, amphibie — standard hors eau
  droid_aqua:         { label: 'Droïde Aquatique',          icon: '🌊', color: '#3498db', armor: 0.12, offense: 0.025, morale: 1.00 },
  // Droïde Araignée (OG-9 Homing) : artillerie mobile, arme anti-fortification
  droid_spider:       { label: 'Droïde Araignée',           icon: '🕷', color: '#7f8c8d', armor: 0.35, offense: 0.700, morale: 1.00 },
  // NR-N99 (Dwarf Spider Droid) : mitrailleuses, roulant — terreur en masse à couvert
  droid_nrn:          { label: 'Droïde NR-N99',             icon: '⚙', color: '#95a5a6', armor: 0.15, offense: 0.040, morale: 1.00 },

  // ════════════════════════════════════════════════════
  // EMPIRE GALACTIQUE
  // ════════════════════════════════════════════════════

  // Stormtrooper standard : armure blast-plastoid, entraînement académique
  // ~2-3 stormtroopers = 1 clone en combat; battent rebelles/milice facilement
  stormtrooper:       { label: 'Stormtrooper',               icon: '⬛', color: '#dddddd', armor: 0.30, offense: 0.14, morale: 0.80 },
  // Death Trooper (ISB) : bioamélioré, armure renforcée, entraînement spécial
  // Canon : Rogue One — nettement supérieur au stormtrooper standard
  death_trooper:      { label: 'Death Trooper (ISB)',        icon: '💀', color: '#2c3e50', armor: 0.45, offense: 0.42, morale: 0.90 },
  // Scout Trooper : reconnaissance, embuscade — armure légère, mobilité
  scout_trooper:      { label: 'Scout Trooper',              icon: '🏍', color: '#bdc3c7', armor: 0.18, offense: 0.12, morale: 0.75 },
  // Snowtrooper : conditions extrêmes, équipement thermique — bon en environnements hostiles
  snowtrooper:        { label: 'Snowtrooper',                icon: '❄', color: '#ecf0f1', armor: 0.32, offense: 0.16, morale: 0.82 },
  // Dark Trooper Phase III : robot-soldat impérial — force monstrueuse, résiste au vide spatial
  // Canon : The Mandalorian — nécessite un Jedi ou des explosifs pour l'arrêter
  dark_trooper:       { label: 'Dark Trooper (Phase III)',   icon: '🤖', color: '#1a252f', armor: 0.62, offense: 0.75, morale: 1.00 },
  // Imperial Royal Guard : garde Palatin — entraînement extrême, combattants redoutables
  // Canon : entraînés pour protéger l'Empereur — surpassent les clones en duel
  royal_guard:        { label: 'Garde Impérial Royal',       icon: '🔴', color: '#c0392b', armor: 0.55, offense: 0.65, morale: 0.98 },
  // Compforce : milice impériale d'occupation — faible mais nombreuse
  compforce:          { label: 'Compforce (Occupation)',     icon: '🔶', color: '#e67e22', armor: 0.18, offense: 0.09, morale: 0.65 },

  // ════════════════════════════════════════════════════
  // ALLIANCE REBELLE / NOUVELLE RÉPUBLIQUE
  // ════════════════════════════════════════════════════

  // Rebel standard : équipement récupéré, motivation élevée, guérilla
  rebel:              { label: 'Soldat Rebelle',             icon: '🟠', color: '#e67e22', armor: 0.15, offense: 0.12, morale: 0.85 },
  // Rebel Pathfinder : Endor-era, terrain, furtivité, explosifs
  rebel_pathfinder:   { label: 'Pathfinder Rebelle',        icon: '🌿', color: '#27ae60', armor: 0.20, offense: 0.22, morale: 0.88 },
  // SpecForces NR : New Republic Special Forces — entraînement post-guerre
  specforce:          { label: 'SpecForces NR',              icon: '⭐', color: '#f39c12', armor: 0.25, offense: 0.30, morale: 0.90 },

  // ════════════════════════════════════════════════════
  // MANDALORIENS
  // Beskar : quasi-immunité aux blasters → armor très élevée
  // ════════════════════════════════════════════════════

  // Mandalorian Warrior : beskar + jetpack + Whistling Bird = dévastateur vs infanterie
  // Canon : 1 Mando seul bat un peloton de storm (The Mandalorian S1)
  mandalorian:        { label: 'Guerrier Mandalorien',       icon: '🪬', color: '#74b9ff', armor: 0.72, offense: 0.60, morale: 0.98 },
  // Mandalorian Supercommando / Death Watch : élite, jetpacks améliorés
  mandalorian_elite:  { label: 'Supercommando Mand.',       icon: '💎', color: '#0984e3', armor: 0.78, offense: 0.80, morale: 0.99 },
  // Night Owl : garde Bo-Katan — très élite, commandos aguerris
  night_owl:          { label: 'Night Owl (Bo-Katan)',       icon: '🦉', color: '#6c5ce7', armor: 0.75, offense: 0.65, morale: 0.98 },

  // ════════════════════════════════════════════════════
  // SOLDATS NEUTRES / FACTIONS DIVERSES
  // ════════════════════════════════════════════════════

  // Chasseur de primes : équipement varié, instinct de survie, efficace
  bounty_hunter:      { label: 'Chasseur de Primes',        icon: '🎯', color: '#d4a844', armor: 0.25, offense: 0.25, morale: 0.95 },
  // Garde Sénatorial : formation défensive, discipline, escorte
  senate_guard:       { label: 'Garde Sénatorial',           icon: '🔵', color: '#3498db', armor: 0.25, offense: 0.12, morale: 0.85 },
  // Garde Naboo : formation classique, uniforme, équipement standard
  naboo_guard:        { label: 'Garde Naboo',                icon: '💛', color: '#f1c40f', armor: 0.15, offense: 0.10, morale: 0.75 },
  // Guerrier Géonosien : armure chitineuse naturelle, ailes, combat en nuée
  geonosian:          { label: 'Guerrier Géonosien',         icon: '🪲', color: '#8e6b3e', armor: 0.12, offense: 0.06, morale: 0.70 },
  // Wookiee : force brute légendaire, arbalétrières, résistance physique
  // Canon : un Wookiee seul peut neutraliser plusieurs soldats ordinaires
  wookiee:            { label: 'Guerrier Wookiee',           icon: '🌳', color: '#8B4513', armor: 0.30, offense: 0.35, morale: 0.92 },
  // Garde Gamorrean : force brute, armure naturelle, sans cerveau
  gamorrean:          { label: 'Garde Gamorrean',            icon: '🐗', color: '#2ecc71', armor: 0.20, offense: 0.08, morale: 0.75 },
  // Pirate : brutalité, imprévisible, efficace contre non-combattants
  pirate:             { label: 'Pirate',                     icon: '💀', color: '#8e44ad', armor: 0.08, offense: 0.09, morale: 0.65 },
  // Milice : équipement bas de gamme, connaissance du terrain
  militia:            { label: 'Milice Locale',              icon: '🔫', color: '#6ab04c', armor: 0.05, offense: 0.07, morale: 0.60 },
  // Contrebandier : esquive et fuite > combat frontal
  smuggler:           { label: 'Contrebandier',              icon: '🚬', color: '#636e72', armor: 0.05, offense: 0.06, morale: 0.55 },

  // ════════════════════════════════════════════════════
  // DROÏDES NON-SÉPARATISTES
  // ════════════════════════════════════════════════════

  // IG-11 : droïde bounty hunter reprogrammé — précision parfaite, mode sacrifice
  // Canon : The Mandalorian — tient tête à un peloton entier, immunité à la douleur
  ig11:               { label: 'IG-11',                      icon: '🤖', color: '#c8b88a', armor: 0.28, offense: 0.55, morale: 1.00 },
  // IG-88 : chasseur de primes droïde assassin Tier S — 4 armes simultanées
  // Canon : Empire contre-attaque — conçu pour tuer, égal à Boba Fett
  ig88:               { label: 'IG-88 (Assassin)',           icon: '🎯', color: '#a09060', armor: 0.32, offense: 0.65, morale: 1.00 },
  // K-2SO : droïde impérial reprogrammé — force brute + analyse tactique instantanée
  // Canon : Rogue One — un seul K-2SO tient une salle entière
  k2so:               { label: 'K-2SO',                      icon: '⬛', color: '#7a8a9a', armor: 0.35, offense: 0.35, morale: 1.00 },
  // Droïde Sonde Viper : reconnaissance, peu de combat, mais laser discret
  droid_probe:        { label: 'Droïde Sonde Viper',         icon: '👁', color: '#6a7a8a', armor: 0.12, offense: 0.08, morale: 1.00 },
  // IG-RM : droïde de sécurité Hutt / Maz — robuste, gardien de couloir
  droid_igrm:         { label: 'IG-RM (Garde Sécurité)',     icon: '🛡', color: '#8a9a7a', armor: 0.30, offense: 0.22, morale: 1.00 },
  // HK-47 : droïde assassin era Sith — "meatbag" protocol, tirs chirurgicaux
  hk47:               { label: 'HK-47 (Droïde Assassin)',    icon: '💀', color: '#c03030', armor: 0.25, offense: 0.70, morale: 1.00 },

  // ════════════════════════════════════════════════════
  // CHASSEURS DE PRIMES NOMMÉS
  // Chacun a un profil distinct — du débutant au légendaire
  // ════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════
  // CHASSEURS DE PRIMES — 4 ARCHÉTYPES (indépendants des noms propres)
  // ════════════════════════════════════════════════════

  // ARCHÉTYPE 1 — PISTOLERO LÉGENDAIRE
  // Armure légère, vitesse de dégaine extrême, imprévisible.
  // Off. élevée = tirs ultra-précis à très courte portée.
  // Représente : Cad Bane, duellistes de classe Jedi.
  // Bat un clone standard seul; perd contre ARC ou Commando.
  bh_pistolero:   { label: 'Chasseur Pistolero (Légendaire)', icon: '🎩', color: '#5a7a9a', armor: 0.25, offense: 0.68, morale: 0.97 },

  // ARCHÉTYPE 2 — TIREUR D'ÉLITE
  // Armure minimale (mobilité totale), précision chirurgicale, discret.
  // Dangereux depuis couverture, vulnérable en corps-à-corps.
  // Représente : Aurra Sing, Fennec Shand, snipers professionnels.
  bh_sniper:      { label: "Tireur d'Élite (Chasseur)",       icon: '🔭', color: '#c04060', armor: 0.15, offense: 0.58, morale: 0.90 },

  // ARCHÉTYPE 3 — CHASSEUR CUIRASSÉ
  // Armure beskar ou équivalent, polyvalent, endurant.
  // Le profil le plus équilibré — survie + efficacité.
  // Représente : Boba Fett, Jango Fett, Mandalorien équipé.
  bh_armored:     { label: 'Chasseur Cuirassé (Vétéran)',     icon: '🪬', color: '#6a8a5a', armor: 0.65, offense: 0.62, morale: 0.98 },

  // ARCHÉTYPE 4 — MERCENAIRE NOVICE
  // Peu entraîné, armes de récupération, motivation pécuniaire.
  // Panique facilement, légèrement supérieur à la milice locale.
  // Représente : petits criminels, chasseurs débutants.
  bh_rookie:      { label: 'Mercenaire Novice',               icon: '🔰', color: '#a8a840', armor: 0.12, offense: 0.18, morale: 0.62 },

  // ════════════════════════════════════════════════════
  // MILICES PAR NIVEAU DE RICHESSE / ÉQUIPEMENT
  // ════════════════════════════════════════════════════

  // Milice Paysanne : fourches, peur, équipement de fortune
  militia_poor:       { label: 'Milice Paysanne',            icon: '🌾', color: '#8a6a3a', armor: 0.02, offense: 0.04, morale: 0.40 },
  // Milice Locale standard (valeur actuelle — terrain connu)
  militia:            { label: 'Milice Locale',              icon: '🔫', color: '#6ab04c', armor: 0.05, offense: 0.07, morale: 0.60 },
  // Milice Équipée : armement militaire récupéré, organisation basique
  militia_equipped:   { label: 'Milice Équipée',             icon: '⚙',  color: '#4a8a3c', armor: 0.12, offense: 0.11, morale: 0.70 },
  // Garde Privée Riche : plastoid armor, vibrolances, motivation pécuniaire
  militia_guard:      { label: 'Garde Privée (Équipée)',     icon: '🛡', color: '#d4a830', armor: 0.22, offense: 0.16, morale: 0.75 },

  // Civil : aucune formation combat
  civilian:           { label: 'Civil',                      icon: '👤', color: '#b2bec3', armor: 0.00, offense: 0.01, morale: 0.20 },
};

// ═══════════════════════════════════════════════════════
// MATCHUPS — Modificateurs de combat situationnels
//
// Format : { attacker: { defender: +bonus_offense } }
// Justification lore pour chaque entrée.
// ═══════════════════════════════════════════════════════

export const TROOP_MATCHUPS = {

  // ── CLONES ────────────────────────────────────────────
  // Formation Kamino : protocoles anti-droïdes intégrés depuis naissance
  // Ordre 66 encodé : protocoles anti-Jedi activables
  clone: {
    droid:          +0.060,  // protocoles anti-droïde Kamino, visée ciblée joints
    droid_b2:       +0.040,  // connaissent les points faibles B2 (genoux, colonne)
    droid_commando: +0.050,  // reconnaissent les patterns furtifs BX
    droideka:       +0.080,  // concentrent le feu aux articulat. du bouclier
    magnaguard:     +0.030,  // forment les groupes pour saturer la défense
    jedi:           +0.060,  // Ordre 66 = protocole anti-Jedi spécifique
    militia:        +0.010,  // discipline vs improvisation
  },
  clone_commando: {
    droid:          +0.120,  // R.C. = anti-droïdes spécialisés, charges Deece
    droid_b2:       +0.100,  // connaissent chaque faiblesse des droïdes CIS
    droid_commando: +0.100,  // contre-espionnage vs BX — entraînement symétrique
    droideka:       +0.140,  // grenades EMP, tirs dans les trappes de ventilation
    magnaguard:     +0.080,  // combattent en coordination, épuisent le MagnaGarde
  },
  clone_arc: {
    droid:          +0.100,  // armement lourd anti-droïde (WESTAR-M5)
    droid_b2:       +0.080,  // connaissent la grille d'armure B2
    droid_commando: +0.100,  // entraînement supérieur aux commandos BX
    droideka:       +0.120,  // grenades ad hoc, charge frontale calculée
    magnaguard:     +0.060,  // expérience vs IG — points faibles identifiés
  },
  clone_heavy: {
    droid:          +0.080,  // Z-6 détruit des files entières de B1
    droid_b2:       +0.050,  // cadence accable même l'armure B2
    droideka:       +0.100,  // saturation du bouclier par cadence de tir
  },
  clone_shock: {
    droid:          +0.060,  // Coruscant Guard : anti-émeute, espaces confinés
    droid_b2:       +0.040,
    militia:        +0.015,  // discipline urbaine vs guérilla
  },
  clone_arf: {
    droid:          +0.040,  // embuscades aux B1 (reconnaissance)
    droid_commando: +0.030,  // détectent les BX avant d'être détectés
    militia:        +0.020,  // scout vs guerrilla : terrain maîtrisé
  },

  // ── SÉPARATISTES ──────────────────────────────────────
  droid: {
    civilian:       +0.020,  // aucune résistance organisée
    militia:        +0.015,  // armes standardisées vs équipement artisanal
    smuggler:       +0.010,  // les tirs B1 saturent une esquive de contrebandier
  },
  droid_b2: {
    clone:          +0.020,  // armure absorbe ripostes tout en avançant
    militia:        +0.030,  // écrase la milice sans ralentir
    rebel:          +0.030,  // équipement rebelle ne perce pas l'armure B2
    civilian:       +0.040,
  },
  droid_commando: {
    clone:          +0.040,  // furtivité surprend même les clones entraînés
    stormtrooper:   +0.060,  // stormtroopers moins vigilants que clones
    rebel:          +0.040,
  },
  droideka: {
    clone:          +0.050,  // le bouclier annule l'avantage de précision clone
    stormtrooper:   +0.100,  // dévaste la formation standard impériale
    militia:        +0.080,  // la milice ne peut pas percer le bouclier
    rebel:          +0.060,
  },
  magnaguard: {
    clone:          +0.150,  // conçus PAR Grievous pour neutraliser soldats
    jedi:           +0.200,  // electrostaff = contre-sabre parfait
    clone_arc:      +0.100,  // même les ARC souffrent du electrostaff
    stormtrooper:   +0.200,  // stormtroopers n'ont pas la formation anti-IG
    rebel:          +0.150,
  },
  droid_aqua: {
    clone_scuba:    +0.030,  // terrain aquatique = avantage droïde (amphibie)
    civilian:       +0.020,
  },

  // ── IMPERIALS ─────────────────────────────────────────
  stormtrooper: {
    rebel:          +0.030,  // doctrine anti-rébellion, équipement anti-guerrilla
    civilian:       +0.020,
    smuggler:       +0.020,
    pirate:         +0.020,
    militia:        +0.030,  // armure + équipement > milice
    droid:          +0.020,  // canon impériaux récupèrent des anti-droïdes (post-guerre)
    compforce:      +0.040,  // élite vs milice impériale
  },
  death_trooper: {
    rebel:          +0.050,  // ISB = anti-rébellion spécialisé
    droid:          +0.030,
    clone:          +0.020,  // expérience de guerre asymétrique vs entraînement Kamino
    smuggler:       +0.030,
    militia:        +0.040,
  },
  dark_trooper: {
    clone:          +0.050,  // force mécanique dépasse l'armure Katarn
    stormtrooper:   +0.080,  // même faction mais robot vs humain
    rebel:          +0.060,
    militia:        +0.080,
    civilian:       +0.100,
  },
  royal_guard: {
    clone:          +0.060,  // entraînement extrême, fann-blade et force pike
    rebel:          +0.080,
    stormtrooper:   +0.040,  // élite vs standard impérial
    jedi:           -0.050,  // malgré l'entraînement, la Force prime
  },
  scout_trooper: {
    militia:        +0.030,  // embuscade, terrain connu
    rebel:          +0.020,  // harcèlement à distance
    civilian:       +0.020,
  },
  snowtrooper: {
    militia:        +0.025,
    rebel:          +0.020,
  },

  // ── REBELLES / NOUVELLE RÉPUBLIQUE ────────────────────
  rebel: {
    stormtrooper:   +0.020,  // guérilla, terrain, surprise
    droid:          +0.005,
    compforce:      +0.030,  // rebelles plus motivés que milice impériale
  },
  rebel_pathfinder: {
    stormtrooper:   +0.040,  // Endor-style, sabotage + guérilla dense
    clone:          +0.010,  // terrain et furtivité
    droid:          +0.010,
    scout_trooper:  +0.030,  // contre-reco
  },
  specforce: {
    stormtrooper:   +0.040,
    droid:          +0.020,
    militia:        +0.030,
    pirate:         +0.030,
  },

  // ── MANDALORIENS ──────────────────────────────────────
  mandalorian: {
    stormtrooper:   +0.080,  // beskar absorbe tout blaster Imperial
    clone:          +0.030,  // armure beskar vs armure Katarn
    pirate:         +0.050,  // Mandalorian expérience de survie
    bounty_hunter:  +0.020,  // les mando sont les meilleurs BH
  },
  mandalorian_elite: {
    stormtrooper:   +0.100,
    clone:          +0.050,
    death_trooper:  +0.040,
    rebel:          +0.060,
    bounty_hunter:  +0.040,
  },
  night_owl: {
    stormtrooper:   +0.090,
    clone:          +0.040,
    death_trooper:  +0.030,
  },

  // ── FORCE-USERS ───────────────────────────────────────
  jedi: {
    civilian:       -0.300,  // Code Jedi : ne pas nuire aux innocents
    stormtrooper:   +0.200,  // sabre + Force deflection pulvérise formation
    droid:          +0.300,  // démembrements à la chaîne, Force push
    droid_commando: +0.150,  // furtivité inutile contre perception Force
    magnaguard:     -0.100,  // electrostaff = kryptonite vs sabre
    sith:           +0.100,  // discipline Jedi (léger avantage si nombreux)
    pirate:         +0.200,
    rebel:          +0.050,  // Jedi ne combattent pas vraiment les rebelles
  },
  sith: {
    jedi:           +0.200,  // rage = offensive pure, surpasse discipline
    civilian:       +0.300,  // aucune retenue
    clone:          +0.150,  // Vador était une machine à tuer des clones
    stormtrooper:   +0.200,
    rebel:          +0.150,
    pirate:         +0.200,
  },
  inquisitor: {
    jedi:           +0.050,  // spécialisés dans la chasse aux Jedi
    clone:          +0.100,
    rebel:          +0.150,
    stormtrooper:   +0.050,  // entraînement Force supérieur au storm
  },

  // ── NEUTRES ───────────────────────────────────────────
  bounty_hunter: {
    senate_guard:   +0.020,
    rebel:          +0.020,
    smuggler:       +0.040,
    civilian:       +0.050,
    clone:          +0.010,  // imprévisibilité déstabilise la formation
  },
  wookiee: {
    droid:          +0.030,  // démembrement physique des B1
    stormtrooper:   +0.030,  // force brute perce l'armure plastoid
    civilian:       +0.040,
    militia:        +0.020,
  },
  pirate: {
    civilian:       +0.050,
    smuggler:       +0.020,
    militia:        +0.010,
  },
  militia: {
    droid:          +0.008,  // connaissance des patterns B1 par expérience locale
    smuggler:       +0.030,
    pirate:         +0.030,
    civilian:       +0.020,
    compforce:      +0.015,  // milice locale vs occupation
  },
  geonosian: {
    clone:          +0.020,  // terrain aréneux, vol — surprennent les clones
    civilian:       +0.030,
  },
  gamorrean: {
    civilian:       +0.030,  // force brute contre non-combattants
    smuggler:       +0.020,
  },

  // ── DROÏDES NON-SÉPARATISTES ──────────────────────────────
  ig11: {
    stormtrooper:   +0.060,  // tirs dévastateurs, immunité à la douleur
    militia:        +0.080,
    civilian:       +0.020,
  },
  ig88: {
    clone:          +0.020,
    stormtrooper:   +0.050,
    bounty_hunter:  +0.030,  // rivalité de chasseurs
    militia:        +0.080,
  },
  k2so: {
    stormtrooper:   +0.040,  // connaît les protocoles impériaux
    militia:        +0.050,
    civilian:       +0.030,
  },
  droid_probe: {
    civilian:       +0.030,
    militia:        +0.010,
  },
  droid_igrm: {
    smuggler:       +0.040,
    pirate:         +0.030,
    civilian:       +0.040,
  },
  hk47: {
    clone:          +0.030,
    jedi:           +0.020,  // protocols anti-Jedi archaïques
    stormtrooper:   +0.060,
    civilian:       +0.100,  // "meatbag protocol"
  },

  // ── CHASSEURS DE PRIMES — ARCHÉTYPES ────────────────────────
  // Pistolero : vitesse de tir supérieure dans toutes les situations de duel
  bh_pistolero: {
    clone:          +0.040,  // dégaine avant que le clone réagisse
    jedi:           +0.020,  // a déjà battu des Force-users (Cad Bane)
    stormtrooper:   +0.060,
    militia:        +0.080,
    bounty_hunter:  +0.030,  // avantage en duel
    bh_sniper:      +0.040,  // couverture nulle = le pistolero gagne
    bh_rookie:      +0.080,
  },
  // Sniper : dangereux surtout contre des cibles non-protégées ou à découvert
  bh_sniper: {
    stormtrooper:   +0.060,
    militia:        +0.090,
    scout_trooper:  +0.050,  // contre-reconnaissance
    clone_arf:      +0.030,
    civilian:       +0.060,
    bh_rookie:      +0.060,
  },
  // Cuirassé : son armure lui permet d'encaisser et de riposter — avantage soutenu
  bh_armored: {
    stormtrooper:   +0.080,
    clone:          +0.040,
    rebel:          +0.060,
    militia:        +0.060,
    bh_sniper:      +0.030,  // l'armure absorbe les tirs sniper
    bh_rookie:      +0.080,
    pirate:         +0.050,
  },
  // Novice : légèrement supérieur à la milice locale uniquement
  bh_rookie: {
    civilian:       +0.030,
    militia_poor:   +0.030,
    militia:        +0.010,
    smuggler:       +0.020,
  },

  // ── MILICES PAR RICHESSE ──────────────────────────────────
  militia_poor: {
    civilian:       +0.015,
    smuggler:       +0.010,
  },
  militia_equipped: {
    droid:          +0.010,
    militia_poor:   +0.040,
    smuggler:       +0.030,
    pirate:         +0.020,
    civilian:       +0.030,
  },
  militia_guard: {
    droid:          +0.015,
    militia_poor:   +0.060,
    militia:        +0.030,
    pirate:         +0.040,
    smuggler:       +0.050,
    compforce:      +0.020,
  },
};

/**
 * Calcule le modificateur net entre un type d'attaquant et un défenseur.
 */
export function getCombatModifier(attackerType, defenderType) {
  return TROOP_MATCHUPS[attackerType]?.[defenderType] ?? 0;
}

// ═══════════════════════════════════════════════════════
// AMARRAGE
// ═══════════════════════════════════════════════════════

export function canDockTo(source, target) {
  if (!source?.alive || !target?.alive) return { ok: false, reason: 'Vaisseau détruit' };
  const dist = Math.hypot(target.position.x - source.position.x, target.position.y - source.position.y);
  if (dist > 2.5) return { ok: false, reason: `Trop loin (${dist.toFixed(1)} cases)` };
  const sh = target.shields;
  const shDown = !sh || sh.max === 0 || sh.current <= 0 || sh.disabled;
  if (!shDown) return { ok: false, reason: 'Boucliers de la cible actifs' };
  if (target._dockedShipIds?.length >= 4) return { ok: false, reason: 'Sas d\'amarrage saturé (max 4)' };
  return { ok: true };
}

export function applyDock(source, target) {
  source._dockedInShipId = target.id;
  source._dockedStationId = null;
  if (!target._dockedShipIds) target._dockedShipIds = [];
  if (!target._dockedShipIds.includes(source.id)) target._dockedShipIds.push(source.id);
}

export function applyUndock(source, target) {
  source._dockedInShipId = null;
  if (target) {
    target._dockedShipIds = (target._dockedShipIds||[]).filter(id => id !== source.id);
  }
}

// ═══════════════════════════════════════════════════════
// ABORDAGE
// ═══════════════════════════════════════════════════════

export function initBoarding(attacker, defender, troops) {
  if (!troops?.length) return { ok: false, reason: 'Aucune troupe à engager' };
  const totalTroops = troops.reduce((s,t) => s + t.count, 0);
  if (totalTroops <= 0) return { ok: false, reason: 'Effectif insuffisant' };

  defender._boardingState = {
    attackerShipId:  attacker.id,
    attackerFleetId: attacker.fleetId,
    attackerTroops:  troops.map(t => ({ ...t })),
    defenderTroops:  buildDefenderTroops(defender),
    tick:    0,
    phase:   'breach',
    log:     [],
  };
  return { ok: true };
}

/** Construit les troupes défensives depuis le roster de troupes du défenseur. */
function buildDefenderTroops(ship) {
  const result = [];
  const troops = (ship._troops || []).filter(t => t.willFight !== false);
  troops.forEach(t => { if (t.count > 0) result.push({ type: t.type, count: t.count }); });
  const crewFighting = Math.round((ship.crewCount || 0) * 0.3);
  if (crewFighting > 0) {
    const DROID_TYPES = new Set(['droid_integrated','droid_integrated_advanced','droid_captain','droid_strategist']);
    const crewType = DROID_TYPES.has(ship.pilotType) ? 'droid' : inferCrewType(ship);
    result.push({ type: crewType, count: crewFighting });
  }
  return result;
}

function inferCrewType(ship) {
  const m = {
    clone_commander: 'clone',       clone: 'clone',
    imperial:        'stormtrooper',
    rebel:           'rebel',
    bounty_hunter:   'bounty_hunter',
    pirate:          'pirate',
    smuggler:        'smuggler',
    royal_guard:     'senate_guard',
    force_user:      'jedi',
    militia:         'militia',
    droid_integrated:'droid',       droid_captain:'droid',
    droid_integrated_advanced:'droid', droid_strategist:'droid',
  };
  return m[ship.pilotType] || 'civilian';
}

/**
 * Résout UN tick d'abordage.
 *
 * Mécanique d'efficacité individuelle :
 *   - Chaque unité inflige `offense` dégâts de base par tick
 *   - Ces dégâts sont réduits par l'`armor` du défenseur
 *   - Le bonus d'abordage (+15% au tick 1 → -10% tick 5+) avantage l'assaut initial
 *   - Les matchMods représentent des stratégies lore-accurate (flanquement, EMP, etc.)
 */
export function tickBoarding(defender, tick) {
  const bs = defender._boardingState;
  if (!bs || bs.phase === 'over') return { over: true, winner: null, log: [] };

  bs.tick++;
  const logs = [];

  // Bonus d'abordage décroissant : +15% tick 1 → 0% tick 3 → -10% tick 5+
  const boardingBonus = Math.max(-0.10, 0.15 - bs.tick * 0.05);

  let totalAtkAlive = bs.attackerTroops.reduce((s,t) => s+t.count, 0);
  let totalDefAlive = bs.defenderTroops.reduce((s,t) => s+t.count, 0);

  if (totalAtkAlive <= 0 || totalDefAlive <= 0) {
    bs.phase = 'over';
    return { over: true, winner: totalAtkAlive > 0 ? 'attacker' : 'defender', log: logs };
  }

  let atkDmgTotal = 0, defDmgTotal = 0;

  // ATTAQUANTS → DÉFENSEURS
  bs.attackerTroops.forEach(atkGroup => {
    if (atkGroup.count <= 0) return;
    const atkType = TROOP_TYPES[atkGroup.type] || TROOP_TYPES.civilian;
    bs.defenderTroops.forEach(defGroup => {
      if (defGroup.count <= 0) return;
      const defType   = TROOP_TYPES[defGroup.type] || TROOP_TYPES.civilian;
      const matchMod  = getCombatModifier(atkGroup.type, defGroup.type);
      const atkEff    = Math.max(0.001, (atkType.offense + matchMod + boardingBonus) * (1 - defType.armor));
      const fraction  = defGroup.count / totalDefAlive;
      const dmg       = Math.max(0, Math.round(atkGroup.count * atkEff * fraction));
      defGroup.count  = Math.max(0, defGroup.count - dmg);
      defDmgTotal    += dmg;
    });
  });

  // DÉFENSEURS → ATTAQUANTS (pas de boardingBonus — défense pas d'avantage d'assaut)
  bs.defenderTroops.forEach(defGroup => {
    if (defGroup.count <= 0) return;
    const defType = TROOP_TYPES[defGroup.type] || TROOP_TYPES.civilian;
    bs.attackerTroops.forEach(atkGroup => {
      if (atkGroup.count <= 0) return;
      const atkType   = TROOP_TYPES[atkGroup.type] || TROOP_TYPES.civilian;
      const matchMod  = getCombatModifier(defGroup.type, atkGroup.type);
      const defEff    = Math.max(0.001, (defType.offense + matchMod) * (1 - atkType.armor));
      const fraction  = atkGroup.count / totalAtkAlive;
      const dmg       = Math.max(0, Math.round(defGroup.count * defEff * fraction));
      atkGroup.count  = Math.max(0, atkGroup.count - dmg);
      atkDmgTotal    += dmg;
    });
  });

  totalAtkAlive = bs.attackerTroops.reduce((s,t) => s+t.count, 0);
  totalDefAlive = bs.defenderTroops.reduce((s,t) => s+t.count, 0);

  const logLine = `⚔ T${bs.tick} — Att: ${totalAtkAlive} (-${atkDmgTotal}) | Def: ${totalDefAlive} (-${defDmgTotal})`;
  logs.push(logLine);
  bs.log.push(logLine);

  if (totalAtkAlive <= 0 || totalDefAlive <= 0) {
    bs.phase = 'over';
    const winner = totalAtkAlive > 0 ? 'attacker' : 'defender';
    const endLine = winner === 'attacker' ? '🏴 Vaisseau pris !' : '🛡 Abordage repoussé !';
    logs.push(endLine);
    bs.log.push(endLine);
    return { over: true, winner, log: logs };
  }

  return { over: false, winner: null, log: logs };
}
