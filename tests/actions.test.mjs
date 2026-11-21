import assert from 'node:assert/strict';
import test from 'node:test';
import { actions, tick } from '../dsu-ride-demo/js/actions.js';
import { RULES } from '../dsu-ride-demo/js/data.js';
import { availableScooters, dockById, scooterById, selectedScooter, visibleScooters } from '../dsu-ride-demo/js/selectors.js';
import { createInitialState, loadState, saveState, STORAGE_KEY } from '../dsu-ride-demo/js/state.js';

const T0 = 1_700_000_000_000;

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

/** Reserve, scan and start riding `id`; returns the state. */
function startRide(id = 'DSU-022') {
  const state = createInitialState();
  actions.reserve(state, id, T0);
  actions.openScanner(state);
  actions.scanQr(state, undefined, T0);
  tick(state, T0 + RULES.scanVerifyMs);
  actions.startRide(state, undefined, T0 + 2000);
  return state;
}

test('the nearest available scooter is selected by default', () => {
  const state = createInitialState();
  const list = availableScooters(state);
  assert.equal(selectedScooter(state).id, list[0].id);
  assert.ok(list.every((s, i) => i === 0 || list[i - 1].walkM <= s.walkM), 'sorted by walking distance');
});

test('scooters below the battery threshold are hidden', () => {
  const state = createInitialState();
  scooterById(state, 'DSU-022').battery = RULES.minBattery - 1;
  assert.ok(!availableScooters(state).some((s) => s.id === 'DSU-022'));
});

test('search matches scooter IDs and dock names, case-insensitively', () => {
  const state = createInitialState();
  actions.setQuery(state, 'HOSTEL');
  assert.deepEqual(visibleScooters(state).map((s) => s.id), ['DSU-007']);
  actions.setQuery(state, 'dsu-014');
  assert.deepEqual(visibleScooters(state).map((s) => s.id), ['DSU-014']);
});

test('reserve, then cancel, puts the scooter back', () => {
  const state = createInitialState();
  actions.reserve(state, 'DSU-014', T0);
  assert.equal(state.screen, 'reserved');
  assert.equal(scooterById(state, 'DSU-014').status, 'reserved');
  assert.ok(!availableScooters(state).some((s) => s.id === 'DSU-014'));
  actions.cancelReservation(state);
  assert.equal(state.screen, 'home');
  assert.equal(scooterById(state, 'DSU-014').status, 'available');
  assert.equal(state.selectedId, 'DSU-014');
});

test('a reserved scooter cannot be reserved again', () => {
  const state = createInitialState();
  actions.reserve(state, 'DSU-014', T0);
  assert.match(actions.reserve(state, 'DSU-014', T0), /no longer available/);
});

test('the reservation expires on the clock, even after the app slept', () => {
  const state = createInitialState();
  actions.reserve(state, 'DSU-014', T0);
  assert.equal(tick(state, T0 + RULES.reservationMs - 1).render, false);
  assert.equal(state.screen, 'reserved');
  const result = tick(state, T0 + RULES.reservationMs + 3_600_000);
  assert.equal(result.render, true);
  assert.match(result.toast, /expired/);
  assert.equal(state.screen, 'home');
  assert.equal(scooterById(state, 'DSU-014').status, 'available');
});

test('"skip to end of hold" leaves a few seconds', () => {
  const state = createInitialState();
  actions.reserve(state, 'DSU-014', T0);
  actions.skipHold(state, undefined, T0);
  assert.equal(state.reservation.expiresAt, T0 + RULES.skipHoldMs);
});

test('the ride only starts after the simulated wallet check', () => {
  const state = createInitialState();
  actions.reserve(state, 'DSU-022', T0);
  actions.openScanner(state);
  actions.scanQr(state, undefined, T0);
  actions.startRide(state, undefined, T0);
  assert.equal(state.screen, 'scan', 'still verifying');
  tick(state, T0 + RULES.scanVerifyMs);
  assert.equal(state.scan.step, 2);
  const freeBefore = dockById(state, 'SOE').freePorts;
  assert.match(actions.startRide(state, undefined, T0 + 2000), /helmet/i);
  assert.equal(state.screen, 'ride');
  assert.equal(state.reservation, null);
  assert.equal(dockById(state, 'SOE').freePorts, freeBefore + 1, 'scooter leaves its port');
});

test('riding accumulates distance at the geofence-capped speed', () => {
  const state = startRide();
  actions.setThrottle(state, 25); // main drive caps at 15 km/h
  tick(state, T0 + 12_000); // 10 s after the ride started
  assert.ok(Math.abs(state.ride.distanceM - (15 / 3.6) * 10) < 1e-9);
  actions.setZone(state, 2); // courtyard: motor cut
  const before = state.ride.distanceM;
  tick(state, T0 + 22_000);
  assert.equal(state.ride.distanceM, before);
});

test('long gaps between ticks are capped', () => {
  const state = startRide();
  tick(state, T0 + 2000 + 3_600_000); // an hour asleep
  assert.ok(state.ride.distanceM <= (RULES.defaultThrottle / 3.6) * (RULES.maxTickGapMs / 1000) + 1e-9);
});

test('throttle is clamped to the allowed range', () => {
  const state = startRide();
  actions.setThrottle(state, 99);
  assert.equal(state.ride.throttle, RULES.maxThrottle);
  actions.setThrottle(state, -5);
  assert.equal(state.ride.throttle, 0);
  actions.setThrottle(state, 'abc');
  assert.equal(state.ride.throttle, 0);
});

test('parking: full docks are refused, the trip is recorded', () => {
  const state = startRide();
  tick(state, T0 + 62_000);
  actions.openParking(state);
  assert.match(actions.chooseDock(state, 'GH'), /full/i);
  assert.equal(state.parkDockId, null);
  const freeBefore = dockById(state, 'TT').freePorts;
  actions.chooseDock(state, 'TT');
  actions.finishRide(state, undefined, T0 + 62_000);
  assert.equal(state.screen, 'done');
  const scooter = scooterById(state, 'DSU-022');
  assert.equal(scooter.dockId, 'TT');
  assert.equal(scooter.status, 'available');
  assert.ok(Number.isInteger(scooter.battery));
  assert.equal(dockById(state, 'TT').freePorts, freeBefore - 1);
  assert.equal(state.lastTrip.durationS, 60);
  assert.ok(state.lastTrip.distanceM > 0);
});

test('reporting a fault takes the scooter out of service', () => {
  const state = startRide();
  actions.reportFault(state, 'Flat tire');
  assert.equal(state.screen, 'home');
  assert.equal(scooterById(state, 'DSU-022').status, 'fault');
  assert.ok(!availableScooters(state).some((s) => s.id === 'DSU-022'));
  assert.equal(actions.reportFault(state, 'Made-up fault'), undefined);
});

test('state survives a reload; search text does not', () => {
  const storage = memoryStorage();
  const state = createInitialState();
  actions.setQuery(state, 'arena');
  actions.reserve(state, 'DSU-026', T0);
  saveState(storage, state);
  const restored = loadState(storage);
  assert.equal(restored.screen, 'reserved');
  assert.equal(restored.reservation.scooterId, 'DSU-026');
  assert.equal(scooterById(restored, 'DSU-026').status, 'reserved');
  assert.equal(restored.query, '');
});

test('dock port counts survive a reload', () => {
  const storage = memoryStorage();
  const state = startRide();
  saveState(storage, state);
  assert.equal(dockById(loadState(storage), 'SOE').freePorts, dockById(state, 'SOE').freePorts);
});

test('corrupt or inconsistent saved state falls back safely', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadState(storage), createInitialState());

  const saved = JSON.parse(JSON.stringify({ version: 1, screen: 'ride', ride: null, scooters: createInitialState().scooters }));
  storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  assert.equal(loadState(storage).screen, 'home', 'no ride data, so not the ride screen');

  storage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, scooters: [{ id: 'DSU-999' }] }));
  assert.deepEqual(loadState(storage).scooters, createInitialState().scooters, 'unknown scooters are ignored');

  assert.deepEqual(loadState(null), createInitialState(), 'no storage available');
});

test('resetDemo restores the original data', () => {
  const state = startRide();
  actions.reportFault(state, 'Brake wear');
  actions.resetDemo(state);
  assert.deepEqual(state, createInitialState());
});

test('live location: the choice survives a reload, the position does not', () => {
  const storage = memoryStorage();
  const state = createInitialState();
  actions.setLiveLocation(state, true);
  actions.setLocation(state, { at: [12.6604, 77.4527], source: 'gps', accuracy: 9 });
  assert.deepEqual(state.you, { at: [12.6604, 77.4527], source: 'gps', accuracy: 9 });
  saveState(storage, state);
  const restored = loadState(storage);
  assert.equal(restored.liveLocation, true);
  assert.equal(restored.you.source, 'demo', 'position comes from a fresh GPS fix, not storage');
});

test('resetDemo keeps your location and live-tracking choice', () => {
  const state = startRide();
  actions.setLiveLocation(state, true);
  actions.setLocation(state, { at: [12.6604, 77.4527], source: 'gps', accuracy: 9 });
  actions.resetDemo(state);
  assert.equal(state.liveLocation, true);
  assert.equal(state.you.source, 'gps');
  assert.equal(state.ride, null);
  assert.equal(state.screen, 'home');
});
