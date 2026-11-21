// Entry point: owns the state, renders screens, routes UI events to actions, and runs the 1 s clock.
import { actions, tick } from './actions.js';
import { CAMPUS_BOUNDARY, DEMO_LOCATION } from './data.js';
import { distanceMeters } from './geo.js';
import { createLocationTracker } from './location.js';
import { createCampusMap } from './map.js';
import { selectedScooter } from './selectors.js';
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
  onLocate: onLocateButton,
  onRouteError: () => showToast("Couldn't load a road route. Check your connection and try again."),
});
const tracker = createLocationTracker({
  geolocation: navigator.geolocation ?? null,
  boundary: CAMPUS_BOUNDARY,
  onFix,
  onStop: stopLiveLocation,
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

// ---------- live location

// Screens that show distances from you. Others (scan, ride, done) keep the position without re-rendering,
// so e.g. a dragged throttle slider is never rebuilt under your finger.
const LOCATION_SCREENS = new Set(['home', 'reserved', 'park']);
const RERENDER_AFTER_M = 10; // distances are shown to the nearest 10 m
let renderedFrom = null; // the live position the on-screen distances were computed from

function startLiveLocation() {
  if (!tracker.start()) return;
  actions.setLiveLocation(state, true);
  saveState(storage, state);
  campusMap.setLocateMode('follow');
}

function stopLiveLocation(message) {
  tracker.stop();
  renderedFrom = null;
  campusMap.setLocateMode('off');
  actions.setLiveLocation(state, false);
  actions.setLocation(state, { at: DEMO_LOCATION.at, source: 'demo' });
  saveState(storage, state);
  render();
  if (message) showToast(message);
}

/** Locate button: off → live and following → (drag the map) live → tap to re-centre → tap again to stop. */
function onLocateButton() {
  if (!tracker.active) {
    showToast('Finding your location…');
    startLiveLocation();
  } else if (campusMap.locateMode === 'track') {
    campusMap.setLocateMode('follow');
  } else {
    stopLiveLocation('Live location off. Distances use the demo location.');
  }
}

function onFix(fix, first) {
  actions.setLocation(state, { at: fix.at, source: 'gps', accuracy: fix.accuracy });
  // Keep showing the scooter you were looking at as you walk, rather than whichever is nearest this second.
  if (state.screen === 'home' && !state.selectedId) state.selectedId = selectedScooter(state)?.id ?? null;
  const movedEnough = !renderedFrom || distanceMeters(renderedFrom, fix.at) >= RERENDER_AFTER_M;
  if (LOCATION_SCREENS.has(state.screen) && (first || movedEnough)) {
    renderedFrom = fix.at;
    render();
  }
  campusMap.updateYou(state.you, { recentre: first });
  if (first) showToast('Live location on. Distances update as you move.');
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

if (state.liveLocation) {
  // Resume live location after a reload, but never pop a permission prompt on page load.
  const permission = navigator.permissions?.query({ name: 'geolocation' }) ?? Promise.resolve(null);
  permission
    .then((status) => {
      if (status?.state === 'granted') {
        startLiveLocation();
      } else {
        actions.setLiveLocation(state, false);
        saveState(storage, state);
      }
    })
    .catch(() => {});
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
