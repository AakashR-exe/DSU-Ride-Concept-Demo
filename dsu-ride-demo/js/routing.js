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
