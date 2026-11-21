// Leaflet + OpenStreetMap wrapper. One map instance lives for the whole session: each render moves
// its element into the current screen's #map-slot and redraws pins from a plain "scene" object
// (see mapScene in views.js), so tiles and zoom survive re-renders.
import { escapeHtml } from './html.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ICON_FIT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_LOCATE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>';

export function createCampusMap({ boundary, onAction, onLocate }) {
  const L = window.L;
  let map = null;
  let el = null;
  let routeLayer = null;
  let pinLayer = null;
  let youMarker = null;
  let lastFitKey = null;
  const markers = new Map();

  const campusBounds = () => L.latLngBounds(boundary);
  const fitCampus = () => map.fitBounds(campusBounds(), { padding: [12, 12] });

  function controlButton(title, icon, onClick) {
    const b = L.DomUtil.create('button', 'map-btn');
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
        box.append(controlButton('Show whole campus', ICON_FIT, fitCampus), controlButton('Use my location', ICON_LOCATE, onLocate));
        return box;
      },
    });
    new Buttons({ position: 'topright' }).addTo(map);
    L.polygon(boundary, { color: '#0f6b4a', weight: 2, dashArray: '6 6', fillColor: '#0f6b4a', fillOpacity: 0.06, interactive: false }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    youMarker = L.marker(boundary[0], {
      icon: L.divIcon({ className: 'me-dot', iconSize: [16, 16] }),
      keyboard: false,
      zIndexOffset: 2000,
    }).bindTooltip('', { direction: 'top', offset: [0, -10] });
  }

  function draw(scene) {
    routeLayer.clearLayers();
    pinLayer.clearLayers();
    markers.clear();

    if (scene.you) {
      youMarker.setLatLng(scene.you.at).setTooltipContent(scene.you.source === 'gps' ? 'You are here' : 'You are here (demo location)');
      if (!map.hasLayer(youMarker)) youMarker.addTo(map);
    } else {
      youMarker.remove();
    }

    if (scene.route) {
      L.polyline(scene.route, { color: '#2b6bff', weight: 4, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(routeLayer);
    }

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

  return {
    /** Show the map inside `slot` with the given scene. Refits only when scene.fitKey changes. */
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
        if (scene.fit) map.fitBounds(L.latLngBounds(scene.fit), { padding: [60, 60], maxZoom: 18 });
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
  };
}
