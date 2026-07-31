/**
 * CARRIER — Ship carrier / hangar system
 *
 * Carriers (e.g. Venator-class) hold small ships in their hangars.
 * Ships can be deployed onto the battlefield or recovered back aboard.
 *
 * Data model on the carrier ship:
 *   ship.carrierData = {
 *     capacity: 24,                    // total bay slots
 *     autoFighters:    true,
 *     autoBombers:     true,
 *     autoInterceptors:false,
 *     complement: [
 *       { classId:'v19', type:'fighter',     count:8, deployed:0 },
 *       { classId:'ywing', type:'bomber',    count:4, deployed:0 },
 *     ]
 *   }
 *
 * Data model on a carried ship:
 *   ship.carriedBy = carrierId    (null if not aboard)
 *
 * Ships with carriedBy !== null:
 *   - Are not rendered on the map
 *   - Are still in GameState.ships (but alive = true, position = carrier position)
 *   - Can be "recovered" by moving within DOCK_RANGE of the carrier
 */

import CONFIG from './config.js';
import { dist2D } from './utils.js';

export const CARRIER_DOCK_RANGE = 2.5;   // cells — must be this close to land
export const SMALL_SHIP_TYPES   = ['fighter','heavy_fighter','interceptor','bomber','gunship','transport'];

/**
 * Returns true if a ship type can be carried (smaller than corvette).
 */
export function isCarriable(shipType) {
  return SMALL_SHIP_TYPES.includes(shipType);
}

/**
 * Returns true if a ship can act as a carrier.
 */
export function isCarrier(ship) {
  return !!ship.carrierData;
}

/**
 * Returns available bay slots on a carrier.
 */
export function availableBays(carrier) {
  if (!carrier.carrierData) return 0;
  const used = carrier.carrier.reserves.reduce((s, c) => s + c.deployed, 0);
  return carrier.carrierData.capacity - used;
}

/**
 * Auto-deploy logic: called each tick for carriers in aggressive/attack mode.
 * Deploys ships according to carrier's auto-deploy flags.
 *
 * @param {Ship}     carrier
 * @param {GameState} state
 * @param {Function} createShipFn
 * @param {Function} logFn
 */
export function processCarrierAutoDeploy(carrier, state, createShipFn, logFn) {
  if (!carrier.carrierData) return;
  const cd   = carrier.carrierData;
  const enemies = state.ships.filter(s => s.alive && s.fleetId !== carrier.fleetId);
  if (!enemies.length) return;   // no enemies → don't auto-deploy

  for (const slot of cd.complement) {
    if (slot.deployed >= slot.count) continue; // all out

    const autoFlag = slot.type === 'fighter'      ? cd.autoFighters
                   : slot.type === 'bomber'        ? cd.autoBombers
                   : slot.type === 'interceptor'   ? cd.autoInterceptors
                   : false;
    if (!autoFlag) continue;

    // Deploy one ship from this slot
    deployFromCarrier(carrier, slot, state, createShipFn, logFn);
  }
}

/**
 * Deploys one ship from a carrier complement slot.
 * Returns the newly created ship or null if slot is empty.
 */
export function deployFromCarrier(carrier, slot, state, createShipFn, logFn) {
  if (slot.deployed >= slot.count) return null;

  // Import presets dynamically to avoid circular imports
  // (Fiverr dev: can be refactored to pass instantiatePreset as param)
  const ship = createShipFn({
    name:     `${slot.classId.toUpperCase()} #${slot.deployed + 1}`,
    classId:  slot.classId,
    type:     slot.type,
    fleetId:  carrier.fleetId,
    position: {
      x: carrier.position.x + (Math.random() - 0.5),
      y: carrier.position.y + (Math.random() - 0.5),
      z: carrier.position.z,
    },
    behavior: { mode: 'aggressive', radius: 10, targetId: null, points: [],
                authorizedFleets: [carrier.fleetId], patrolIndex: 0, attackedBy: null, distance: 2 },
  });

  ship.carriedBy = null; // on the field now
  state.ships.push(ship);

  const fleet = state.fleets.find(f => f.fleetId === carrier.fleetId);
  if (fleet) fleet.shipIds.push(ship.id);

  slot.deployed++;

  logFn?.(`✈ ${carrier.name} deploys ${ship.name}`, 'move');
  return ship;
}

/**
 * Recovers a ship back to the carrier.
 * Ship must be within DOCK_RANGE cells.
 */
export function recoverShip(ship, carrier, logFn) {
  if (!carrier.carrierData) return false;
  if (dist2D(ship.position, carrier.position) > CARRIER_DOCK_RANGE) return false;
  if (!isCarriable(ship.type)) return false;

  // Find the matching complement slot and decrement deployed count
  const slot = carrier.carrier.reserves.find(s => s.classId === ship.classId);
  if (slot && slot.deployed > 0) slot.deployed--;

  ship.alive     = false; // remove from field
  ship.carriedBy = carrier.id;
  logFn?.(`✈ ${ship.name} landed aboard ${carrier.name}`, 'move');
  return true;
}
