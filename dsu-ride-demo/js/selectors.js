// Derived data. Pure functions of state; nothing here mutates.
import { RULES, ZONES } from './data.js';
import { walkingMeters } from './geo.js';

export const dockById = (state, id) => state.docks.find((d) => d.id === id);
export const scooterById = (state, id) => state.scooters.find((s) => s.id === id);

const matches = (query, ...values) => {
  const q = query.trim().toLowerCase();
  return !q || values.some((v) => String(v).toLowerCase().includes(q));
};

export const walkTo = (state, dock) => walkingMeters(state.you.at, dock.at, RULES.walkDetour);

/** Rentable scooters, nearest first, each with its dock and walking distance. */
export function availableScooters(state) {
  return state.scooters
    .filter((s) => s.status === 'available' && s.battery >= RULES.minBattery)
    .map((s) => {
      const dock = dockById(state, s.dockId);
      return { ...s, dock, walkM: walkTo(state, dock) };
    })
    .sort((a, b) => a.walkM - b.walkM);
}

export const visibleScooters = (state) => availableScooters(state).filter((s) => matches(state.query, s.id, s.dock.name));

/** The scooter shown in the sheet: the user's pick if still visible, otherwise the nearest. */
export function selectedScooter(state) {
  const list = visibleScooters(state);
  return list.find((s) => s.id === state.selectedId) ?? list[0] ?? null;
}

export const docksByDistance = (state) =>
  state.docks.map((d) => ({ ...d, walkM: walkTo(state, d) })).sort((a, b) => a.walkM - b.walkM);

export const visibleDocks = (state) => docksByDistance(state).filter((d) => matches(state.query, d.name));

export const openDocks = (state) => docksByDistance(state).filter((d) => d.freePorts > 0);

export function dockStatus(dock) {
  if (dock.freePorts === 0) return 'Full';
  return dock.freePorts === 1 ? 'Limited' : 'Open';
}

/** Current simulated speed: the throttle, limited by the zone's geofence cap. */
export function rideSpeed(state) {
  const ride = state.ride;
  return ride ? Math.min(ride.throttle, ZONES[ride.zone].speedCap) : 0;
}
