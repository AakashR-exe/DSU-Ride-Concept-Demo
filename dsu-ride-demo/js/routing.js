// Road routes from the public OSRM server, plus the rules for keeping a route current while you walk.
import { distanceMeters, distanceToSegmentMeters } from './geo.js';

const ROUTER_URL = 'https://router.project-osrm.org/route/v1/driving';

/** Fetch a road-following route between two [latitude, longitude] points. */
export async function fetchRoadRoute(from, to, { signal, fetchImpl = fetch } = {}) {
  const coordinates = [from, to].map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `${ROUTER_URL}/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`Routing service returned ${response.status}`);

  const result = await response.json();
  const points = result.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(points) || points.length < 2) throw new Error('Routing service returned no route');

  const roadPoints = points.map(([lng, lat]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Routing service returned invalid coordinates');
    return [lat, lng];
  });
  const startsAtOrigin = roadPoints[0][0] === from[0] && roadPoints[0][1] === from[1];
  const endsAtDestination = roadPoints.at(-1)[0] === to[0] && roadPoints.at(-1)[1] === to[1];
  return [...(startsAtOrigin ? [] : [[...from]]), ...roadPoints, ...(endsAtDestination ? [] : [[...to]])];
}

export const REROUTE_AFTER_M = 40;
export const REROUTE_MIN_INTERVAL_MS = 10_000;

/**
 * Re-request a route for the same destination only after the user has walked well away from where
 * the current route starts, and never more often than every 10 s (the public OSRM server is shared).
 */
export function shouldReroute({ origin, from, requestedAt, now, pending }) {
  return !pending && now - requestedAt >= REROUTE_MIN_INTERVAL_MS && distanceMeters(origin, from) > REROUTE_AFTER_M;
}

/**
 * Redraw a route so it starts at `from`, dropping the part already walked. `points` is a fetched route:
 * [where it was requested from, ...road points, destination]. You're placed on the nearest road segment
 * within the first `searchM` metres, so a road that loops back near the start can't cut the route short.
 */
export function trimRoute(points, from, searchM = 100) {
  if (points.length < 3) return [from, ...points.slice(1)];
  let cut = 1; // keep every road point: you haven't reached the road yet
  let best = distanceToSegmentMeters(from, points[1], points[1]);
  let along = 0;
  for (let i = 2; i < points.length && along <= searchM; i++) {
    const d = distanceToSegmentMeters(from, points[i - 1], points[i]);
    if (d < best) {
      best = d;
      cut = i; // you're on segment i-1 → i, so the route continues from point i
    }
    along += distanceMeters(points[i - 1], points[i]);
  }
  return [from, ...points.slice(cut)];
}
