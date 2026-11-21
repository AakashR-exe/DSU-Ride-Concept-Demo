import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMPUS_BOUNDARY, DEMO_LOCATION, DOCKS } from '../dsu-ride-demo/js/data.js';
import { distanceMeters, formatClock, formatDistance, isInside, walkingMeters, walkingMinutes } from '../dsu-ride-demo/js/geo.js';

test('distanceMeters: one degree of latitude is about 111.2 km', () => {
  assert.ok(Math.abs(distanceMeters([12, 77], [13, 77]) - 111195) < 50);
});

test('distanceMeters is symmetric and zero for the same point', () => {
  const a = [12.6616, 77.45];
  const b = [12.6583, 77.448];
  assert.equal(distanceMeters(a, a), 0);
  assert.equal(distanceMeters(a, b), distanceMeters(b, a));
});

test('walkingMeters adds the detour factor and rounds to 10 m', () => {
  const soe = DOCKS.find((d) => d.id === 'SOE');
  const straight = distanceMeters(DEMO_LOCATION.at, soe.at);
  const walk = walkingMeters(DEMO_LOCATION.at, soe.at);
  assert.equal(walk % 10, 0);
  assert.ok(Math.abs(walk - straight * 1.25) <= 5);
  assert.equal(walkingMeters(DEMO_LOCATION.at, DEMO_LOCATION.at), 10, 'never shows 0 m');
});

test('walkingMinutes uses 80 m per minute, minimum 1', () => {
  assert.equal(walkingMinutes(10), 1);
  assert.equal(walkingMinutes(80), 1);
  assert.equal(walkingMinutes(81), 2);
  assert.equal(walkingMinutes(540), 7);
});

test('every dock and the demo location are inside the campus outline', () => {
  assert.ok(isInside(DEMO_LOCATION.at, CAMPUS_BOUNDARY));
  for (const dock of DOCKS) assert.ok(isInside(dock.at, CAMPUS_BOUNDARY), dock.name);
});

test('isInside rejects points off campus', () => {
  assert.ok(!isInside([12.9716, 77.5946], CAMPUS_BOUNDARY), 'central Bengaluru');
  assert.ok(!isInside([12.664, 77.4508], CAMPUS_BOUNDARY), 'just north of Gate 1');
});

test('formatClock and formatDistance', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(65.9), '01:05');
  assert.equal(formatClock(-3), '00:00');
  assert.equal(formatClock(3725), '62:05');
  assert.equal(formatDistance(540), '540 m');
  assert.equal(formatDistance(1234), '1.2 km');
});
