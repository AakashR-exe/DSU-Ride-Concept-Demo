// Leaflet + OpenStreetMap wrapper. One map instance lives for the whole session: each render moves
// its element into the current screen's #map-slot and redraws pins from a plain "scene" object
// (see mapScene in views.js), so tiles and zoom survive re-renders.
//
// Live location: updateYou() moves the "you" dot without a re-render. In follow mode the map keeps
// you centred and skips other automatic fits; dragging the map stops following.
import { escapeHtml } from './html.js';
import { fetchRoadRoute, shouldReroute, trimRoute } from './routing.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ICON_FIT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_LOCATE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>';
const LOCATE_TITLES = { off: 'Show my live location', follow: 'Stop live location', track: 'Centre on my location' };
const FOLLOW_ZOOM = 17;

export function createCampusMap({ boundary, onAction, onLocate, onRouteError }) {
  const L = window.L;
  let map = null;
  let el = null;
  let routeLayer = null;
  let pinLayer = null;
  let youMarker = null;
  let accuracyCircle = null;
  let locateButton = null;
  let locateMode = 'off'; // off | follow (map keeps you centred) | track (live, but you moved the map)
  let lastFitKey = null;
  let you = null; // the latest { at, source, accuracy } shown on the map
  let route = null; // { to, origin, points, requestedAt, pending }
  let routeController = null;
  let routeRequestId = 0;
  const markers = new Map();

  const campusBounds = () => L.latLngBounds(boundary);
  const fitCampus = () => map.fitBounds(campusBounds(), { padding: [12, 12] });
  const following = () => locateMode === 'follow';

  function controlButton(className, title, icon, onClick) {
    const b = L.DomUtil.create('button', `map-btn ${className}`);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    L.DomEvent.disableClickPropagation(b);
    L.DomEvent.on(b, 'click', onClick);
    return b;
  }

  function init() {
    map = L.map(el, {
      zoomControl: false,
      zoomSnap: 0.25,
      minZoom: 15,
      maxZoom: 19,
      maxBounds: campusBounds().pad(0.8),
      maxBoundsViscosity: 0.9,
    });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    const Buttons = L.Control.extend({
      onAdd: () => {
        const box = L.DomUtil.create('div', 'map-btns');
        locateButton = controlButton('locate', LOCATE_TITLES.off, ICON_LOCATE, onLocate);
        box.append(controlButton('fit', 'Show whole campus', ICON_FIT, fitCampus), locateButton);
        return box;
      },
    });
    new Buttons({ position: 'topright' }).addTo(map);
    L.polygon(boundary, { color: '#0f6b4a', weight: 2, dashArray: '6 6', fillColor: '#0f6b4a', fillOpacity: 0.06, interactive: false }).addTo(map);
    accuracyCircle = L.circle(boundary[0], { radius: 1, className: 'accuracy', color: '#2b6bff', weight: 1, opacity: 0.4, fillOpacity: 0.1, interactive: false });
    routeLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    youMarker = L.marker(boundary[0], {
      icon: L.divIcon({ className: 'me-dot', iconSize: [16, 16] }),
      keyboard: false,
      zIndexOffset: 2000,
    }).bindTooltip('', { direction: 'top', offset: [0, -10] });
    map.on('dragstart', () => {
      if (following()) setLocateMode('track'); // you're exploring the map: stop dragging it back
    });
    // While following, every finished movement must end with you centred. Overlapping animations can
    // leave the map off-centre (a pan measured at the old zoom mid-zoom-animation, or drag inertia that
    // starts a frame after a re-centre), and a pinch-zoom should keep you centred anyway.
    let recentring = false;
    map.on('moveend', () => {
      if (recentring || !following() || you?.source !== 'gps') return;
      const offCentre = map.latLngToContainerPoint(you.at).distanceTo(map.getSize().divideBy(2));
      if (offCentre <= 4) return;
      recentring = true; // the jump below fires moveend synchronously; don't loop
      map.panTo(you.at, { animate: false });
      recentring = false;
    });
    setLocateMode(locateMode);
  }

  function setLocateMode(mode) {
    locateMode = mode;
    if (!locateButton) return;
    locateButton.classList.toggle('is-follow', mode === 'follow');
    locateButton.classList.toggle('is-track', mode === 'track');
    locateButton.setAttribute('aria-pressed', String(mode !== 'off'));
    locateButton.title = LOCATE_TITLES[mode];
    locateButton.setAttribute('aria-label', LOCATE_TITLES[mode]);
  }

  /** Put the "you" dot and GPS accuracy circle where `you` says; hide them when there's no position. */
  function placeYou() {
    if (!map) return;
    const live = you?.source === 'gps';
    if (!you) {
      youMarker.remove();
      accuracyCircle.remove();
      return;
    }
    youMarker.setLatLng(you.at).setTooltipContent(live ? 'You are here (live)' : 'You are here (demo location)');
    if (!map.hasLayer(youMarker)) youMarker.addTo(map);
    youMarker.getElement()?.classList.toggle('live', live);
    if (live && you.accuracy) {
      accuracyCircle.setLatLng(you.at).setRadius(you.accuracy);
      if (!map.hasLayer(accuracyCircle)) accuracyCircle.addTo(map);
    } else {
      accuracyCircle.remove();
    }
  }

  function draw(scene) {
    pinLayer.clearLayers();
    markers.clear();
    you = scene.you;
    placeYou();
    drawRoute(scene.route);

    for (const pin of scene.pins) {
      const size = pin.selected ? 36 : 30;
      const shift = (pin.stack ?? 0) * 26;
      const classes = ['pin', pin.kind, pin.selected && 'on', pin.full && 'full'].filter(Boolean).join(' ');
      const marker = L.marker(pin.at, {
        title: pin.title,
        keyboard: Boolean(pin.action),
        interactive: Boolean(pin.action),
        riseOnHover: true,
        zIndexOffset: pin.selected ? 1000 : 0,
        icon: L.divIcon({ className: classes, html: escapeHtml(pin.label), iconSize: [size, size], iconAnchor: [size / 2 - shift, size / 2] }),
      });
      if (pin.action) marker.on('click', () => onAction(pin.action, pin.arg));
      marker.addTo(pinLayer);
      markers.set(pin.id, marker);
    }
  }

  // ---------- routes

  function showRoute() {
    routeLayer.clearLayers();
    if (!route?.points) return;
    const points = you ? trimRoute(route.points, you.at) : route.points;
    L.polyline(points, { color: '#fff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
    L.polyline(points, { color: '#2b6bff', weight: 5, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
  }

  function cancelRoute() {
    routeRequestId += 1;
    routeController?.abort();
    routeController = null;
    route = null;
    routeLayer.clearLayers();
  }

  /** newDestination: fit the map to the route and report failures. Otherwise it's a quiet re-route while walking. */
  function requestRoute(from, to, newDestination) {
    routeRequestId += 1;
    const requestId = routeRequestId;
    routeController?.abort();
    routeController = new AbortController();
    route = { to, origin: from, points: newDestination ? null : route?.points ?? null, requestedAt: Date.now(), pending: true };
    showRoute();

    fetchRoadRoute(from, to, { signal: routeController.signal })
      .then((points) => {
        if (requestId !== routeRequestId) return;
        route.points = points;
        showRoute();
        if (newDestination && !following()) map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 18 });
      })
      .catch((error) => {
        if (requestId === routeRequestId && newDestination && error.name !== 'AbortError') onRouteError?.(error);
      })
      .finally(() => {
        if (requestId !== routeRequestId) return;
        route.pending = false;
        routeController = null;
      });
  }

  function drawRoute(endpoints) {
    if (!endpoints) {
      if (route) cancelRoute();
      return;
    }
    const [from, to] = endpoints;
    if (!route || route.to[0] !== to[0] || route.to[1] !== to[1]) {
      requestRoute(from, to, true);
      return;
    }
    showRoute(); // same destination: redraw from where you are now
    if (shouldReroute({ origin: route.origin, from, requestedAt: route.requestedAt, now: Date.now(), pending: route.pending })) {
      requestRoute(from, to, false);
    }
  }

  return {
    /** Show the map inside `slot` with the given scene. Refits only when scene.fitKey changes (and not while following you). */
    mount(slot, scene) {
      if (!slot) return;
      if (!L) {
        slot.insertAdjacentHTML('afterbegin', '<div class="map map-off">Map unavailable. Reconnect to load the campus map.</div>');
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'map';
        el.setAttribute('aria-label', 'Map of the DSU Harohalli campus');
      }
      slot.prepend(el);
      if (!map) init();
      else map.invalidateSize({ pan: false });
      if (scene.fitKey !== lastFitKey) {
        lastFitKey = scene.fitKey;
        if (following() && scene.you) map.setView(scene.you.at, Math.max(map.getZoom(), FOLLOW_ZOOM));
        else if (scene.fit) map.fitBounds(L.latLngBounds(scene.fit), { padding: [60, 60], maxZoom: 18 });
        else fitCampus();
      }
      draw(scene);
    },

    detach() {
      el?.remove();
    },

    blink(pinId) {
      markers.get(pinId)?.getElement()?.classList.add('blink');
    },

    get locateMode() {
      return locateMode;
    },

    /** off | follow | track. Switching to follow re-centres on your last position. */
    setLocateMode(mode) {
      setLocateMode(mode);
      if (mode === 'follow' && map && you?.source === 'gps') map.setView(you.at, Math.max(map.getZoom(), FOLLOW_ZOOM));
    },

    /** A new live position: move the dot, keep the route starting from you, and follow if asked. */
    updateYou(next, { recentre = false } = {}) {
      if (!map || !el?.isConnected) return; // no map on this screen
      if (you) you = next; // screens that hide "you" (e.g. parking without GPS) stay hidden
      placeYou();
      if (route) drawRoute([next.at, route.to]);
      if (following()) {
        if (recentre) map.setView(next.at, Math.max(map.getZoom(), FOLLOW_ZOOM));
        else map.panTo(next.at);
      }
    },
  };
}
