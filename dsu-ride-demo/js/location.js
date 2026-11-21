// Live GPS tracking. Wraps geolocation.watchPosition, only accepts positions on (or right next to)
// campus, and always reports why tracking stopped. The geolocation object is injected so tests can fake it.
import { DEMO_LOCATION } from './data.js';
import { distanceMeters, distanceToPolygonMeters } from './geo.js';

export const NEAR_CAMPUS_M = 150; // GPS drift at the gates shouldn't switch tracking off
const PERMISSION_DENIED = 1; // GeolocationPositionError.PERMISSION_DENIED

export const isNearCampus = (at, boundary) => distanceToPolygonMeters(at, boundary) <= NEAR_CAMPUS_M;

/**
 * onFix({ at, accuracy }, isFirstFix) is called for every on-campus position.
 * onStop(message) is called whenever tracking ends on its own (off campus, denied, unavailable).
 */
export function createLocationTracker({ geolocation, boundary, onFix, onStop }) {
  let watchId = null;
  let fixes = 0;

  function stop() {
    if (watchId !== null) geolocation.clearWatch(watchId);
    watchId = null;
  }

  function fail(message) {
    stop();
    onStop(message);
  }

  function handlePosition({ coords }) {
    if (watchId === null) return; // late callback after stop()
    const at = [coords.latitude, coords.longitude];
    if (!isNearCampus(at, boundary)) {
      if (fixes > 0) {
        fail("You've left campus, so live location is off. Distances use the demo location.");
      } else {
        const km = distanceMeters(at, DEMO_LOCATION.at) / 1000;
        fail(`You're about ${km < 10 ? km.toFixed(1) : Math.round(km)} km from campus, so distances use the demo location (${DEMO_LOCATION.label}).`);
      }
      return;
    }
    fixes += 1;
    onFix({ at, accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null }, fixes === 1);
  }

  function handleError(error) {
    if (watchId === null) return;
    if (error.code === PERMISSION_DENIED) fail('Location permission denied. Distances use the demo location.');
    else if (fixes === 0) fail("Couldn't get your location. Distances use the demo location.");
    // After the first fix, a brief signal loss (timeout / unavailable) is ignored and the watch keeps running.
  }

  return {
    get active() {
      return watchId !== null;
    },
    /** Returns false if this device has no geolocation (onStop is called with the reason). */
    start() {
      if (watchId !== null) return true;
      if (!geolocation) {
        onStop('Location is not available on this device.');
        return false;
      }
      fixes = 0;
      watchId = geolocation.watchPosition(handlePosition, handleError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      return true;
    },
    stop,
  };
}
