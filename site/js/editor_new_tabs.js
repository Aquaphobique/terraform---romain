// Replacement methods for editor.js — Ships, Fleets and Scenarios tabs

export const SHIP_TYPES = [
  { id:'fighter',       label:'🚀 Chasseur',     desc:'Rapide, évasif, anti-chasseur' },
  { id:'heavy_fighter', label:'⚡ Lourd',         desc:'Dommages élevés, moins agile' },
  { id:'interceptor',   label:'💨 Intercepteur',  desc:'Ultra-rapide, fragile' },
  { id:'bomber',        label:'💣 Bombardier',     desc:'Torpilles, anti-capital' },
  { id:'gunship',       label:'🔫 Canonnière',     desc:'Soutien polyvalent' },
  { id:'corvette',      label:'🚢 Corvette',       desc:'Rapide, léger' },
  { id:'frigate',       label:'🛳 Frégate',        desc:'Artillerie lourde' },
  { id:'cruiser',       label:'⚓ Croiseur',       desc:'Capital ship principal' },
  { id:'destroyer',     label:'🗡 Destroyer',      desc:'Dreadnought impérial' },
  { id:'dreadnought',   label:'💥 Dreadnought',    desc:'Vaisseau de ligne suprême' },
];

export const PILOT_TYPES = [
  'clone','droid_integrated','droid_integrated_advanced','droid_captain',
  'droid_strategist','clone_commander','force_user','imperial','rebel',
  'bounty_hunter','pirate','smuggler','militia','civilian',
];
