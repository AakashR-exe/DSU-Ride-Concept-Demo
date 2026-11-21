// Entry point: owns the state, renders screens, routes UI events to actions, and runs the 1 s clock.
import { actions, tick } from './actions.js';
import { CAMPUS_BOUNDARY, DEMO_LOCATION } from './data.js';
import { distanceMeters, isInside } from './geo.js';
import { createCampusMap } from './map.js';
import { loadState, saveState } from './state.js';
import { liveValues, mapScene, renderScreen } from './views.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null; // storage disabled: the demo still works, it just won't survive a reload
  }
})();

const state = loadState(storage);
const campusMap = createCampusMap({
  boundary: CAMPUS_BOUNDARY,
  onAction: dispatch,
  onLocate: locate,
  onRouteError: () => showToast("Couldn't load a road route. Check your connection and try again."),
});
let renderedScreen = null;

// Actions that only change values shown live (no full re-render, so a dragged slider keeps its grip).
const LIVE_ONLY = new Set(['setThrottle']);

// ---------- rendering

/** A selector that finds the "same" control after re-rendering, so keyboard focus isn't lost. */
function focusSelector(el) {
  if (!el || el === document.body || !app.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const { action, arg } = el.dataset;
  if (!action) return null;
  return `[data-action="${CSS.escape(action)}"]${arg != null ? `[data-arg="${CSS.escape(arg)}"]` : ''}`;
}

function render() {
  const now = Date.now();
  const focused = document.activeElement;
  const keepFocus = focusSelector(focused);
  const caret = keepFocus && focused.type === 'search' ? focused.selectionStart : null;

  const scene = mapScene(state);
  campusMap.detach();
  app.dataset.screen = state.screen;
  app.dataset.layout = scene ? 'map' : 'card';
  app.innerHTML = String(renderScreen(state, now));
  if (scene) campusMap.mount(app.querySelector('#map-slot'), scene);

  if (renderedScreen !== null && renderedScreen !== state.screen) {
    // New screen: move focus to its heading so screen readers announce it.
    app.querySelector('[data-screen-title]')?.focus({ preventScroll: true });
  } else if (keepFocus) {
    const el = app.querySelector(keepFocus);
    el?.focus({ preventScroll: true });
    if (el && caret != null) el.setSelectionRange(caret, caret);
  }
  renderedScreen = state.screen;
  updateLive(now);
}

function updateLive(now = Date.now()) {
  const values = liveValues(state, now);
  for (const el of app.querySelectorAll('[data-live]')) {
    const value = values[el.dataset.live];
    if (value != null && el.textContent !== value) el.textContent = value;
  }
}

let toastTimer;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------- actions

function dispatch(name, arg) {
  const action = actions[name];
  if (!action) return;
  const message = action(state, arg, Date.now());
  saveState(storage, state);
  if (LIVE_ONLY.has(name)) updateLive();
  else render();
  if (name === 'chirp') campusMap.blink(state.reservation?.scooterId);
  if (message) showToast(message);
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (target && app.contains(target) && !target.disabled) dispatch(target.dataset.action, target.dataset.arg);
});

app.addEventListener('input', (event) => {
  const target = event.target.closest('[data-input]');
  if (target) dispatch(target.dataset.input, target.value);
});

// ---------- location

function locate() {
  if (!('geolocation' in navigator)) {
    showToast('Location is not available on this device.');
    return;
  }
  showToast('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const at = [coords.latitude, coords.longitude];
      const nearCampus = isInside(at, CAMPUS_BOUNDARY) || CAMPUS_BOUNDARY.some((p) => distanceMeters(p, at) < 150);
      if (nearCampus) {
        dispatch('setLocation', { at, source: 'gps' });
        showToast('Showing distances from your location.');
      } else {
        dispatch('setLocation', { at: DEMO_LOCATION.at, source: 'demo' });
        const km = distanceMeters(at, DEMO_LOCATION.at) / 1000;
        showToast(`You're about ${km < 10 ? km.toFixed(1) : Math.round(km)} km from campus, so distances use the demo location (${DEMO_LOCATION.label}).`);
      }
    },
    (error) =>
      showToast(error.code === error.PERMISSION_DENIED ? 'Location permission denied. Using the demo location.' : "Couldn't get your location. Using the demo location."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, // the user tapped because they moved: always a fresh fix
  );
}

// ---------- clock

function onTick() {
  const result = tick(state, Date.now());
  if (state.reservation || state.ride || result.render) saveState(storage, state);
  if (result.render) render();
  else updateLive();
  if (result.toast) showToast(result.toast);
}

setInterval(onTick, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) onTick(); // catch up immediately when the phone wakes
});

// ---------- start

onTick(); // settle anything that expired while the app was closed
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
