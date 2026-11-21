// App state: the initial demo data plus localStorage persistence (no backend, no database).
import { DEMO_LOCATION, DOCKS, SCOOTERS } from './data.js';

export const STORAGE_KEY = 'dsu-ride/state';
const VERSION = 1;

export function createInitialState() {
  return {
    screen: 'home', // home | reserved | scan | ride | park | done
    tab: 'scooters', // scooters | charging
    query: '',
    selectedId: null,
    navDockId: null,
    you: { at: DEMO_LOCATION.at, source: 'demo', accuracy: null }, // source: demo | gps (accuracy in metres)
    liveLocation: false, // the user turned on live GPS tracking (resumed after a reload)
    scooters: structuredClone(SCOOTERS),
    docks: structuredClone(DOCKS),
    reservation: null, // { scooterId, expiresAt }
    scan: null, // { step: 0 | 1 | 2, verifyAt }
    ride: null, // { scooterId, startedAt, lastTickAt, distanceM, zone, throttle, faultMenu }
    parkDockId: null,
    lastTrip: null, // { scooterId, dockId, durationS, distanceM }
  };
}

/** Only the parts worth keeping across a reload; search text and the position itself start fresh. */
function serialize(state) {
  return JSON.stringify({
    version: VERSION,
    screen: state.screen,
    tab: state.tab,
    liveLocation: state.liveLocation,
    selectedId: state.selectedId,
    scooters: state.scooters,
    dockPorts: Object.fromEntries(state.docks.map((d) => [d.id, d.freePorts])),
    reservation: state.reservation,
    scan: state.scan,
    ride: state.ride,
    parkDockId: state.parkDockId,
    lastTrip: state.lastTrip,
  });
}

function hydrate(saved) {
  const state = createInitialState();
  if (!saved || saved.version !== VERSION || !Array.isArray(saved.scooters)) return state;

  const knownIds = state.scooters.map((s) => s.id).sort().join();
  const savedIds = saved.scooters.map((s) => s?.id).sort().join();
  if (knownIds !== savedIds) return state; // demo data changed since this was saved

  state.scooters = saved.scooters;
  for (const dock of state.docks) {
    const free = saved.dockPorts?.[dock.id];
    if (Number.isInteger(free) && free >= 0 && free <= dock.totalPorts) dock.freePorts = free;
  }
  state.tab = saved.tab === 'charging' ? 'charging' : 'scooters';
  state.liveLocation = saved.liveLocation === true;
  state.selectedId = saved.selectedId ?? null;
  state.reservation = saved.reservation ?? null;
  state.scan = saved.scan ?? null;
  state.ride = saved.ride ?? null;
  state.parkDockId = saved.parkDockId ?? null;
  state.lastTrip = saved.lastTrip ?? null;

  // Never land on a screen whose data is missing.
  if (state.ride) state.screen = saved.screen === 'park' ? 'park' : 'ride';
  else if (state.reservation) state.screen = saved.screen === 'scan' ? 'scan' : 'reserved';
  else if (saved.screen === 'done' && state.lastTrip) state.screen = 'done';
  else state.screen = 'home';
  if (state.screen !== 'scan') state.scan = null;
  return state;
}

export function loadState(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? hydrate(JSON.parse(text)) : createInitialState();
  } catch {
    return createInitialState();
  }
}

export function saveState(storage, state) {
  try {
    storage?.setItem(STORAGE_KEY, serialize(state));
  } catch {
    // Storage full or blocked (e.g. some private modes): keep running in memory.
  }
}
