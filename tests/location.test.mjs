import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPUS_BOUNDARY, DEMO_LOCATION, DOCKS } from '../dsu-ride-demo/js/data.js';
import { distanceToPolygonMeters, distanceToSegmentMeters } from '../dsu-ride-demo/js/geo.js';
import { createLocationTracker, isNearCampus } from '../dsu-ride-demo/js/location.js';

const ON_CAMPUS = [12.6604, 77.4527]; // near Tummy Trails
const BENGALURU = [12.9716, 77.5946];

/** A stand-in for navigator.geolocation that the test drives by hand. */
function fakeGeolocation() {
  const geo = {
    watching: null,
    cleared: [],
    options: null,
    watchPosition(onSuccess, onError, options) {
      geo.watching = { onSuccess, onError };
      geo.options = options;
      return 42;
    },
    clearWatch(id) {
      geo.cleared.push(id);
      geo.watching = null;
    },
    move([latitude, longitude], accuracy = 8) {
      geo.watching?.onSuccess({ coords: { latitude, longitude, accuracy } });
    },
    fail(code) {
      geo.watching?.onError({ code });
    },
  };
  return geo;
}

function setup() {
  const geo = fakeGeolocation();
  const fixes = [];
  const stops = [];
  const tracker = createLocationTracker({
    geolocation: geo,
    boundary: CAMPUS_BOUNDARY,
    onFix: (fix, first) => fixes.push({ ...fix, first }),
    onStop: (message) => stops.push(message),
  });
  return { geo, tracker, fixes, stops };
}

test('distance to the campus edge: 0 inside, metres outside', () => {
  assert.equal(distanceToPolygonMeters(DEMO_LOCATION.at, CAMPUS_BOUNDARY), 0);
  const northOfGate = [12.663452 + 0.0009, 77.451253]; // ~100 m north of the northernmost corner
  const d = distanceToPolygonMeters(northOfGate, CAMPUS_BOUNDARY);
  assert.ok(d > 40 && d <= 101, `${d}`);
  assert.ok(distanceToPolygonMeters(BENGALURU, CAMPUS_BOUNDARY) > 30_000);
});

test('distance to a segment projects onto it and clamps at the ends', () => {
  const a = [12.66, 77.45];
  const b = [12.66, 77.451]; // ~109 m east
  assert.ok(Math.abs(distanceToSegmentMeters([12.6601, 77.4505], a, b) - 11.06) < 0.1, 'perpendicular to the middle');
  assert.ok(Math.abs(distanceToSegmentMeters([12.66, 77.449], a, b) - 108.6) < 0.5, 'past the start: distance to a');
});

test('isNearCampus allows GPS drift just outside the boundary', () => {
  assert.ok(isNearCampus(ON_CAMPUS, CAMPUS_BOUNDARY));
  for (const dock of DOCKS) assert.ok(isNearCampus(dock.at, CAMPUS_BOUNDARY), dock.name);
  assert.ok(isNearCampus([12.663452 + 0.0009, 77.451253], CAMPUS_BOUNDARY), '~100 m outside');
  assert.ok(!isNearCampus([12.663452 + 0.003, 77.451253], CAMPUS_BOUNDARY), '~330 m outside');
  assert.ok(!isNearCampus(BENGALURU, CAMPUS_BOUNDARY));
});

test('tracking reports every on-campus fix and marks the first', () => {
  const { geo, tracker, fixes, stops } = setup();
  assert.equal(tracker.start(), true);
  assert.equal(tracker.active, true);
  assert.equal(geo.options.enableHighAccuracy, true);
  geo.move(ON_CAMPUS, 12);
  geo.move([12.6606, 77.4527], 6);
  assert.deepEqual(fixes, [
    { at: ON_CAMPUS, accuracy: 12, first: true },
    { at: [12.6606, 77.4527], accuracy: 6, first: false },
  ]);
  assert.deepEqual(stops, []);
});

test('starting off campus stops with the distance to campus', () => {
  const { geo, tracker, fixes, stops } = setup();
  tracker.start();
  geo.move(BENGALURU);
  assert.equal(fixes.length, 0);
  assert.equal(tracker.active, false);
  assert.deepEqual(geo.cleared, [42]);
  assert.match(stops[0], /about \d+ km from campus.*demo location/);
});

test('walking off campus stops tracking', () => {
  const { geo, tracker, stops } = setup();
  tracker.start();
  geo.move(ON_CAMPUS);
  geo.move(BENGALURU);
  assert.equal(tracker.active, false);
  assert.match(stops[0], /left campus/);
});

test('permission denied stops; brief signal loss after a fix does not', () => {
  const denied = setup();
  denied.tracker.start();
  denied.geo.fail(1);
  assert.equal(denied.tracker.active, false);
  assert.match(denied.stops[0], /permission denied/);

  const noFix = setup();
  noFix.tracker.start();
  noFix.geo.fail(3); // timeout before any position
  assert.equal(noFix.tracker.active, false);
  assert.match(noFix.stops[0], /Couldn't get your location/);

  const blip = setup();
  blip.tracker.start();
  blip.geo.move(ON_CAMPUS);
  blip.geo.fail(2); // position unavailable for a moment
  assert.equal(blip.tracker.active, true);
  assert.deepEqual(blip.stops, []);
});

test('stop() clears the watch and ignores late callbacks', () => {
  const { geo, tracker, fixes } = setup();
  tracker.start();
  const { onSuccess } = geo.watching;
  tracker.stop();
  assert.equal(tracker.active, false);
  assert.deepEqual(geo.cleared, [42]);
  onSuccess({ coords: { latitude: ON_CAMPUS[0], longitude: ON_CAMPUS[1], accuracy: 5 } });
  assert.equal(fixes.length, 0);
});

test('starting twice keeps one watch; no geolocation reports why', () => {
  const { geo, tracker } = setup();
  tracker.start();
  const first = geo.watching;
  tracker.start();
  assert.equal(geo.watching, first);

  const stops = [];
  const none = createLocationTracker({ geolocation: null, boundary: CAMPUS_BOUNDARY, onFix() {}, onStop: (m) => stops.push(m) });
  assert.equal(none.start(), false);
  assert.match(stops[0], /not available/);
});
