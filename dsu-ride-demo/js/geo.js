// Distance and formatting helpers. Pure functions, no DOM.

const EARTH_RADIUS_M = 6371e3;
const RAD = Math.PI / 180;

/** Great-circle distance in metres between two [lat, lng] points. */
export function distanceMeters([lat1, lng1], [lat2, lng2]) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Estimated walking distance (straight line plus detour), rounded to 10 m. */
export function walkingMeters(from, to, detour = 1.25) {
  return Math.max(10, Math.round((distanceMeters(from, to) * detour) / 10) * 10);
}

export function walkingMinutes(meters, metersPerMinute = 80) {
  return Math.max(1, Math.ceil(meters / metersPerMinute));
}

/** Ray-casting point-in-polygon test on [lat, lng] pairs (accurate enough at campus scale). */
export function isInside([lat, lng], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) inside = !inside;
  }
  return inside;
}

/** Shortest distance in metres from point p to the segment a–b (flat projection around p; fine at campus scale). */
export function distanceToSegmentMeters(p, a, b) {
  const mPerLng = 111320 * Math.cos(p[0] * RAD);
  const mPerLat = 110574;
  const x1 = (a[1] - p[1]) * mPerLng;
  const y1 = (a[0] - p[0]) * mPerLat;
  const dx = (b[1] - a[1]) * mPerLng;
  const dy = (b[0] - a[0]) * mPerLat;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lengthSq)) : 0;
  return Math.hypot(x1 + t * dx, y1 + t * dy);
}

/** Shortest distance in metres from a point to a polygon's edge, or 0 inside it. */
export function distanceToPolygonMeters(at, polygon) {
  if (isInside(at, polygon)) return 0;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegmentMeters(at, polygon[j], polygon[i]));
  }
  return best;
}

/** Seconds → "mm:ss" (minutes keep counting past 60). */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
