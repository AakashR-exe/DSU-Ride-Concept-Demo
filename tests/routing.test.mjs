import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRoadRoute } from '../dsu-ride-demo/js/routing.js';

test('fetchRoadRoute requests a road route and converts GeoJSON coordinates to Leaflet order', async () => {
  let requestedUrl;
  const points = await fetchRoadRoute([12.66, 77.45], [12.65, 77.46], {
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({ routes: [{ geometry: { coordinates: [[77.4501, 12.6601], [77.455, 12.655], [77.4599, 12.6501]] } }] }),
      };
    },
  });

  assert.equal(requestedUrl.hostname, 'router.project-osrm.org');
  assert.match(requestedUrl.pathname, /\/route\/v1\/driving\/77\.45,12\.66;77\.46,12\.65$/);
  assert.equal(requestedUrl.searchParams.get('geometries'), 'geojson');
  assert.deepEqual(points, [[12.66, 77.45], [12.6601, 77.4501], [12.655, 77.455], [12.6501, 77.4599], [12.65, 77.46]]);
});

test('fetchRoadRoute reports unavailable and malformed routes', async () => {
  await assert.rejects(
    fetchRoadRoute([12.66, 77.45], [12.65, 77.46], { fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /returned 503/,
  );
  await assert.rejects(
    fetchRoadRoute([12.66, 77.45], [12.65, 77.46], { fetchImpl: async () => ({ ok: true, json: async () => ({ routes: [] }) }) }),
    /no route/,
  );
});

test('re-route only after walking 40 m from the route start, at most every 10 s', async () => {
  const { shouldReroute, REROUTE_MIN_INTERVAL_MS } = await import('../dsu-ride-demo/js/routing.js');
  const origin = [12.66, 77.45];
  const far = [12.6605, 77.45]; // ~55 m north
  const near = [12.6602, 77.45]; // ~22 m north
  const base = { origin, requestedAt: 0, now: REROUTE_MIN_INTERVAL_MS, pending: false };
  assert.equal(shouldReroute({ ...base, from: far }), true);
  assert.equal(shouldReroute({ ...base, from: near }), false, 'not far enough');
  assert.equal(shouldReroute({ ...base, from: far, now: REROUTE_MIN_INTERVAL_MS - 1 }), false, 'too soon');
  assert.equal(shouldReroute({ ...base, from: far, pending: true }), false, 'a request is already in flight');
});

test('trimRoute starts the route at you and drops the part already walked', async () => {
  const { trimRoute } = await import('../dsu-ride-demo/js/routing.js');
  // Requested from `origin`; the road runs east from r1 through r2 and r3 to the destination.
  const origin = [12.6599, 77.45];
  const r1 = [12.66, 77.45];
  const r2 = [12.66, 77.4504];
  const r3 = [12.66, 77.4508];
  const dest = [12.6601, 77.4512];
  const route = [origin, r1, r2, r3, dest];

  assert.deepEqual(trimRoute(route, origin), [origin, r1, r2, r3, dest], 'not on the road yet: keep it all');
  const betweenR2andR3 = [12.66001, 77.4506];
  assert.deepEqual(trimRoute(route, betweenR2andR3), [betweenR2andR3, r3, dest], 'mid-segment: continue from the next point');
  assert.deepEqual(trimRoute([origin, dest], r1), [r1, dest], 'two-point route');
});

test('trimRoute ignores a road that loops back near the start', async () => {
  const { trimRoute } = await import('../dsu-ride-demo/js/routing.js');
  const origin = [12.66, 77.45];
  const out = [12.66, 77.4525]; // ~270 m east
  const back = [12.66005, 77.45001]; // the road returns right next to the start
  const dest = [12.6605, 77.45];
  const route = [origin, [12.66, 77.45], out, back, dest];
  const you = [12.66004, 77.45001]; // a few metres from the start, and even closer to the looping-back road
  assert.deepEqual(trimRoute(route, you), [you, out, back, dest], 'the loop out and back is kept');
  assert.deepEqual(trimRoute(route, you, Infinity), [you, back, dest], 'without the search limit the loop would be cut off');
});
