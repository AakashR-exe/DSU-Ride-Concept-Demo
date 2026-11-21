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

/** Seconds → "mm:ss" (minutes keep counting past 60). */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
