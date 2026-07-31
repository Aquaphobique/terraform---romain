// VERIFICATION: run to confirm projectiles work before full patch
import { createShip } from './models.js';
import { instantiatePreset } from './presets.js';
import { GameEngine } from './simulation.js';

const gs = { ships:[], fleets:[{fleetId:'f1',colorIndex:0},{fleetId:'f2',colorIndex:1}], projectiles:[], tick:0 };
const v = instantiatePreset('cruiser',   {name:'V',fleetId:'f1',position:{x:10,y:10,z:3},heading:0,behavior:{mode:'aggressive',radius:30,targetId:null,points:[],patrolIndex:0,attackedBy:null,distance:2,authorizedFleets:['f1']}}, createShip);
const i = instantiatePreset('destroyer', {name:'I',fleetId:'f2',position:{x:18,y:10,z:3},heading:Math.PI,behavior:{mode:'aggressive',radius:30,targetId:null,points:[],patrolIndex:0,attackedBy:null,distance:2,authorizedFleets:['f2']}}, createShip);
gs.ships = [v,i].map(s => ({...s,alive:true,_prevX:s.position.x,_prevY:s.position.y}));
const eng = new GameEngine(gs, () => {});
let t = 0;
for (let k = 0; k < 5; k++) { eng.tick(); t += gs.projectiles.length; }
console.log('RESULT: ships alive:', gs.ships.filter(s=>s.alive).length, '/ projectiles total:', t);
