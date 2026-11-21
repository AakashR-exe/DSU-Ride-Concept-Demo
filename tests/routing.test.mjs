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
