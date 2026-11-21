// State transitions. Each action mutates state and may return a message to show as a toast.
// Time is passed in (now = epoch ms) so the flow is deterministic and testable.
import { FAULTS, RULES, ZONES } from './data.js';
import { dockById, rideSpeed, scooterById } from './selectors.js';
import { createInitialState } from './state.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function releaseReservation(state) {
  const reservation = state.reservation;
  if (!reservation) return;
  const scooter = scooterById(state, reservation.scooterId);
  if (scooter?.status === 'reserved') scooter.status = 'available';
  state.selectedId = reservation.scooterId;
  state.reservation = null;
  state.scan = null;
}

export const actions = {
  setTab(state, tab) {
    state.tab = tab === 'charging' ? 'charging' : 'scooters';
    state.navDockId = null;
  },

  setQuery(state, query) {
    state.query = String(query ?? '').slice(0, 60);
  },

  select(state, id) {
    if (scooterById(state, id)) state.selectedId = id;
  },

  navigate(state, dockId) {
    const dock = dockById(state, dockId);
    if (!dock) return;
    state.navDockId = dockId;
    return `Walking route to ${dock.name}: ${dock.freePorts} of ${dock.totalPorts} ports free (demo)`;
  },

  reserve(state, id, now) {
    const scooter = scooterById(state, id);
    if (!scooter || scooter.status !== 'available') return 'That scooter is no longer available.';
    scooter.status = 'reserved';
    state.reservation = { scooterId: id, expiresAt: now + RULES.reservationMs };
    state.screen = 'reserved';
  },

  cancelReservation(state) {
    releaseReservation(state);
    state.screen = 'home';
    return 'Reservation cancelled.';
  },

  skipHold(state, _arg, now) {
    if (state.reservation) state.reservation.expiresAt = Math.min(state.reservation.expiresAt, now + RULES.skipHoldMs);
  },

  chirp(state) {
    if (state.reservation) return `🔊 Chirp! Beacon light is blinking on ${state.reservation.scooterId}`;
  },

  openScanner(state) {
    if (!state.reservation) return;
    state.screen = 'scan';
    state.scan = { step: 0, verifyAt: null };
  },

  closeScanner(state) {
    if (!state.reservation) return;
    state.screen = 'reserved';
    state.scan = null;
  },

  scanQr(state, _arg, now) {
    if (state.reservation) state.scan = { step: 1, verifyAt: now + RULES.scanVerifyMs };
  },

  startRide(state, _arg, now) {
    const reservation = state.reservation;
    if (!reservation || state.scan?.step !== 2) return;
    const scooter = scooterById(state, reservation.scooterId);
    const dock = dockById(state, scooter.dockId);
    scooter.status = 'riding';
    dock.freePorts = Math.min(dock.totalPorts, dock.freePorts + 1); // the scooter leaves its port
    state.ride = {
      scooterId: scooter.id,
      startedAt: now,
      lastTickAt: now,
      distanceM: 0,
      zone: 0,
      throttle: RULES.defaultThrottle,
      faultMenu: false,
    };
    state.reservation = null;
    state.scan = null;
    state.screen = 'ride';
    return '⛑️ Wear your helmet. Ride safe.';
  },

  setZone(state, index) {
    if (state.ride && ZONES[Number(index)]) state.ride.zone = Number(index);
  },

  setThrottle(state, value) {
    const n = Number(value);
    if (state.ride && Number.isFinite(n)) state.ride.throttle = clamp(Math.round(n), 0, RULES.maxThrottle);
  },

  toggleFaultMenu(state) {
    if (state.ride) state.ride.faultMenu = !state.ride.faultMenu;
  },

  reportFault(state, fault) {
    if (!state.ride || !FAULTS.includes(fault)) return;
    scooterById(state, state.ride.scooterId).status = 'fault';
    state.ride = null;
    state.screen = 'home';
    state.selectedId = null;
    return `${fault} reported. Scooter locked for technician triage.`;
  },

  openParking(state) {
    if (!state.ride) return;
    state.screen = 'park';
    state.parkDockId = null;
  },

  chooseDock(state, dockId) {
    const dock = dockById(state, dockId);
    if (!dock || state.screen !== 'park') return;
    if (dock.freePorts < 1) return `${dock.name} is full. Pick another charging point.`;
    state.parkDockId = dockId;
  },

  backToRide(state) {
    if (state.ride) state.screen = 'ride';
  },

  finishRide(state, _arg, now) {
    const ride = state.ride;
    const dock = dockById(state, state.parkDockId);
    if (!ride || !dock || dock.freePorts < 1) return;
    const scooter = scooterById(state, ride.scooterId);
    scooter.dockId = dock.id;
    scooter.status = 'available';
    scooter.battery = Math.round(scooter.battery);
    dock.freePorts -= 1;
    state.lastTrip = {
      scooterId: scooter.id,
      dockId: dock.id,
      durationS: Math.round((now - ride.startedAt) / 1000),
      distanceM: Math.round(ride.distanceM),
    };
    state.ride = null;
    state.parkDockId = null;
    state.screen = 'done';
    return '📷 Photo captured. Trip closed.';
  },

  backToMap(state) {
    state.screen = 'home';
    state.selectedId = null;
  },

  setLocation(state, location) {
    state.you = { at: location.at, source: location.source };
  },

  resetDemo(state) {
    Object.assign(state, createInitialState());
    return 'Demo data reset.';
  },
};

/**
 * Advance time-based state: reservation expiry, the simulated wallet check, and the ride.
 * Returns { render } when the screen needs a full re-render, plus an optional toast.
 */
export function tick(state, now) {
  const result = { render: false, toast: undefined };

  if (state.reservation && now >= state.reservation.expiresAt) {
    releaseReservation(state);
    state.screen = 'home';
    result.render = true;
    result.toast = 'Reservation expired. Scooter released for others.';
  }

  if (state.scan?.step === 1 && now >= state.scan.verifyAt) {
    state.scan.step = 2;
    result.render = true;
  }

  const ride = state.ride;
  if (ride) {
    const seconds = clamp(now - ride.lastTickAt, 0, RULES.maxTickGapMs) / 1000;
    ride.lastTickAt = now;
    const speed = rideSpeed(state);
    const scooter = scooterById(state, ride.scooterId);
    ride.distanceM += (speed / 3.6) * seconds;
    scooter.battery = Math.max(RULES.minParkedBattery, scooter.battery - (0.01 + 0.004 * speed) * seconds);
  }

  return result;
}
