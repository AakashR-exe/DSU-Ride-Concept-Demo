// Screen templates (state → HTML), the map scene for each screen, and live values updated every second.
// Buttons carry data-action / data-arg; main.js routes them to actions.js.
import { DEMO_LOCATION, FAULTS, RULES, ZONES } from './data.js';
import { formatClock, formatDistance, walkingMinutes } from './geo.js';
import { html, raw } from './html.js';
import { qrSvg } from './qr.js';
import {
  dockById,
  dockStatus,
  openDocks,
  rideSpeed,
  scooterById,
  selectedScooter,
  visibleDocks,
  visibleScooters,
  walkTo,
} from './selectors.js';

const HOLD_MINUTES = Math.round(RULES.reservationMs / 60000);
const STEPS = ['Reserved', 'Scan QR', 'Ride', 'Park & lock'];

// ---------- shared pieces

const screenTitle = (text) => html`<h1 class="sr-only" tabindex="-1" data-screen-title>${text}</h1>`;

function stepper(done) {
  return html`<ol class="steps" aria-label="Trip progress">${STEPS.map(
    (label, i) =>
      html`<li class="${i < done ? 'd' : ''}" ${raw(i === done ? 'aria-current="step"' : '')}><span aria-hidden="true">${i < done ? '✓' : i + 1}</span>${label}</li>`,
  )}</ol>`;
}

function mapKey(items, you) {
  return html`<div class="map-key">${items.map(([kind, text]) => html`<span><i class="k-${kind}"></i>${text}</span>`)}${
    you ? html`<span><i class="k-you"></i>${you.source === 'gps' ? 'You (GPS)' : 'You'}</span>` : ''
  }</div>`;
}

function portsPill(dock) {
  const cls = dock.freePorts === 0 ? 'pill f' : dock.freePorts === 1 ? 'pill l' : 'pill';
  return html`<span class="${cls}">${dock.freePorts === 0 ? 'Full' : `${dock.freePorts} free`}</span>`;
}

const batteryBar = (pct) =>
  html`<div class="bar" role="img" aria-label="Battery ${pct}%"><i style="width:${pct}%"></i></div>`;

const countdown = (state, now) => formatClock((state.reservation.expiresAt - now) / 1000);

// ---------- screens

function home(state) {
  const onScooters = state.tab === 'scooters';
  const gps = state.you.source === 'gps';
  return html`${screenTitle(onScooters ? 'DSU Ride: find a scooter' : 'DSU Ride: charging points')}
<header class="top">
  <div class="home-heading"><div class="brand"><span class="brandmark" aria-hidden="true">⚡</span>DSU Ride</div><small>Harohalli campus mobility</small></div>
  <input id="search" class="search" type="search" enterkeyhint="search" autocomplete="off" aria-label="Search scooters or campus locations" placeholder="Search scooter ID or campus location" value="${state.query}" data-input="setQuery">
  <div class="tabs" role="tablist" aria-label="Map view">
    <button type="button" role="tab" aria-selected="${onScooters}" class="${onScooters ? 'on' : ''}" data-action="setTab" data-arg="scooters">Scooters</button>
    <button type="button" role="tab" aria-selected="${!onScooters}" class="${onScooters ? '' : 'on'}" data-action="setTab" data-arg="charging">Charging</button>
  </div>
</header>
<div class="map-wrap" id="map-slot">${mapKey(onScooters ? [['scooter', 'Scooter · battery %']] : [['dock', 'Free charging ports']], state.you)}</div>
<section class="sheet" aria-label="${onScooters ? 'Scooters' : 'Charging points'}">
  ${onScooters ? scooterSheet(state) : dockSheet(state)}
  <p class="note dist-note">Distances from ${gps ? 'your location' : `${DEMO_LOCATION.label} (demo location)`}. Road routes use OSRM and share these coordinates with its public routing service.</p>
  <button type="button" class="lnk subtle" data-action="resetDemo">Reset demo data</button>
</section>`;
}

function scooterSheet(state) {
  const list = visibleScooters(state);
  const current = selectedScooter(state);
  if (!current) {
    return state.query
      ? html`<div class="empty"><b>No scooters match your search</b>Try a scooter ID or campus location.</div>`
      : html`<div class="empty"><b>No scooters free right now</b>Every scooter is out or charging. Check the Charging tab for available docks.</div>`;
  }
  const others = list.filter((s) => s.id !== current.id).slice(0, 3);
  return html`<div class="lbl">${current.id === list[0].id ? 'Nearest scooter' : 'Selected scooter'}</div>
<div class="row"><div class="ico" aria-hidden="true">⚡</div><div class="grow"><b>${current.id}</b><span class="sm">${current.battery}% · ${formatDistance(current.walkM)} · ${walkingMinutes(current.walkM)} min walk · ${current.dock.name}</span></div></div>
${batteryBar(current.battery)}
<button type="button" class="btn" data-action="reserve" data-arg="${current.id}">Reserve for ${HOLD_MINUTES} min</button>
<p class="note">${list.length} available${state.query ? ' for this search' : ' on campus'} · free hold, cancel any time</p>
${
  others.length
    ? html`<ul class="list" aria-label="Other scooters">${others.map(
        (s) =>
          html`<li><button type="button" class="row row-btn" data-action="select" data-arg="${s.id}"><span class="grow"><b>${s.id}</b><span class="sm">${s.dock.name} · ${formatDistance(s.walkM)} · ${walkingMinutes(s.walkM)} min</span></span><span class="pill">${s.battery}%</span></button></li>`,
      )}</ul>`
    : ''
}`;
}

function dockSheet(state) {
  const docks = visibleDocks(state);
  if (!docks.length) return html`<div class="empty"><b>No charging points match your search</b>Try a campus building name.</div>`;
  const nearestOpen = docks.find((d) => d.freePorts > 0);
  return html`<div class="lbl">Charging points on campus</div>
${nearestOpen ? html`<button type="button" class="btn am" data-action="navigate" data-arg="${nearestOpen.id}">Navigate to ${nearestOpen.name}</button>` : ''}
<ul class="list" aria-label="Charging points, nearest first">${docks.map(
    (d) =>
      html`<li><button type="button" class="row row-btn${d.id === state.navDockId ? ' sel' : ''}" aria-pressed="${d.id === state.navDockId}" data-action="navigate" data-arg="${d.id}"><span class="ico am" aria-hidden="true">⚡</span><span class="grow"><b>${d.name}</b><span class="sm">${formatDistance(d.walkM)} · ${dockStatus(d)} · ${d.detail}</span></span>${portsPill(d)}</button></li>`,
  )}</ul>`;
}

function reserved(state, now) {
  const scooter = scooterById(state, state.reservation.scooterId);
  const dock = dockById(state, scooter.dockId);
  const meters = walkTo(state, dock);
  return html`${screenTitle(`${scooter.id} reserved`)}
<div class="ban"><span>⚡ ${scooter.id} reserved</span><span data-live="countdown" aria-label="Time left on hold">${countdown(state, now)}</span></div>
<div class="map-wrap" id="map-slot"><div class="map-key">Walk about ${formatDistance(meters)} to ${dock.name}</div></div>
<section class="sheet">
  <div class="row"><div class="grow"><b>${scooter.id}</b><span class="sm">${Math.round(scooter.battery)}% · ${dock.name} rack</span></div><span class="pill">Walk ${walkingMinutes(meters)} min</span></div>
  ${stepper(1)}
  <button type="button" class="btn" data-action="openScanner">Scan QR to unlock</button>
  <button type="button" class="lnk" data-action="chirp">🔊 Chirp &amp; flash light to find it</button>
  <button type="button" class="lnk" data-action="skipHold">⏩ Demo: skip to end of hold</button>
  <button type="button" class="lnk danger" data-action="cancelReservation">Cancel reservation</button>
</section>`;
}

function scan(state, now) {
  const id = state.reservation.scooterId;
  const step = state.scan?.step ?? 0;
  const action =
    step === 0
      ? html`<button type="button" class="btn" data-action="scanQr">Simulate scan</button>`
      : step === 1
        ? html`<button type="button" class="btn" disabled>Verifying wallet…</button>`
        : html`<button type="button" class="btn" data-action="startRide">Unlock &amp; start ride</button>`;
  return html`${screenTitle('Scan the handlebar QR code')}
<div class="full dark">
  <div class="ban"><span>Scan the handlebar QR</span><span data-live="countdown" aria-label="Time left on hold">${countdown(state, now)}</span></div>
  <div class="qrbox">${raw(qrSvg(id))}</div>
  <p class="sm center on-dark">${step === 0 ? 'Point the camera at the code on the handlebar stem' : ''}</p>
  <div class="spacer"></div>
  <section class="sheet" aria-live="polite">
    ${step >= 1 ? html`<div class="chk"><span aria-hidden="true">✅</span><div><b>${id} matched</b><span class="sm">Reservation confirmed</span></div></div>` : ''}
    ${step >= 2 ? html`<div class="chk"><span aria-hidden="true">✅</span><div><b>Wallet verified</b><span class="sm">Campus ID linked · ₹${RULES.depositRupees} deposit held · rider insurance active (sample)</span></div></div>` : ''}
    ${action}
    <button type="button" class="lnk" data-action="closeScanner">Back</button>
  </section>
</div>`;
}

function ride(state, now) {
  const r = state.ride;
  const live = liveValues(state, now);
  const sheet = r.faultMenu
    ? html`<div class="lbl">Report a fault</div>
${FAULTS.map((f) => html`<button type="button" class="btn ghost" data-action="reportFault" data-arg="${f}">${f}</button>`)}
<button type="button" class="lnk" data-action="toggleFaultMenu">Cancel</button>`
    : html`<button type="button" class="btn am" data-action="openParking">Park &amp; lock</button>
<button type="button" class="lnk" data-action="toggleFaultMenu">⚠ Report a fault</button>`;
  return html`${screenTitle(`Riding ${r.scooterId}`)}
<div class="full dark">
  <div class="ban"><span>Riding ${r.scooterId}</span><span data-live="battery">${live.battery}</span></div>
  <div class="speed"><b data-live="speed">${live.speed}</b><div class="sm on-dark">km/h</div><div class="cap-wrap"><span class="cap" data-live="cap">${live.cap}</span></div></div>
  <div class="zones" role="group" aria-label="Simulated riding zone">${ZONES.map(
    (z, i) =>
      html`<button type="button" class="${i === r.zone ? 'on' : ''}" aria-pressed="${i === r.zone}" data-action="setZone" data-arg="${i}">${z.name}</button>`,
  )}</div>
  <p class="note on-dark ride-msg" data-live="message" aria-live="polite">${live.message}</p>
  <label class="throttle"><span class="sm on-dark">Throttle (simulated)</span><input type="range" min="0" max="${RULES.maxThrottle}" value="${r.throttle}" data-input="setThrottle"></label>
  <div class="stats"><div><b data-live="time">${live.time}</b><small>time</small></div><div><b data-live="distance">${live.distance}</b><small>distance</small></div></div>
  <div class="spacer"></div>
  <section class="sheet">${sheet}</section>
</div>`;
}

function park(state) {
  const docks = openDocks(state);
  const chosen = state.parkDockId;
  return html`${screenTitle('Park at a charging point')}
<header class="top"><div class="title-bar"><b>Park at a charging point</b><small>Pick a dock on the map or in the list</small></div></header>
<div class="map-wrap" id="map-slot">${mapKey([['dock', 'Free charging ports']], null)}</div>
<section class="sheet">
  ${stepper(3)}
  <ul class="list" aria-label="Charging points with free ports">${docks.map(
    (d) =>
      html`<li><button type="button" class="row row-btn${d.id === chosen ? ' sel' : ''}" aria-pressed="${d.id === chosen}" data-action="chooseDock" data-arg="${d.id}"><span class="ico am" aria-hidden="true">⚡</span><span class="grow"><b>${d.name}</b><span class="sm">${d.freePorts} of ${d.totalPorts} ports free</span></span></button></li>`,
  )}</ul>
  <div class="sheet-actions">
    <button type="button" class="btn" data-action="finishRide" ${raw(chosen ? '' : 'disabled')}>Lock &amp; snap photo to end trip</button>
    <button type="button" class="lnk" data-action="backToRide">Back to ride</button>
  </div>
</section>`;
}

function done(state) {
  const trip = state.lastTrip;
  const dock = dockById(state, trip.dockId);
  const avgKmh = trip.durationS ? (trip.distanceM / trip.durationS) * 3.6 : 0;
  return html`<div class="full done">
  <div class="done-icon" aria-hidden="true">✅</div>
  <h1 tabindex="-1" data-screen-title>Trip complete</h1>
  <div class="stats"><div><b>${formatClock(trip.durationS)}</b><small>time</small></div><div><b>${formatDistance(trip.distanceM)}</b><small>distance</small></div><div><b>${avgKmh.toFixed(1)}</b><small>avg km/h</small></div></div>
  <p class="sm">Parked at ${dock.name}. Photo saved, ₹${RULES.depositRupees} deposit released.</p>
  <p class="sm">${trip.scooterId} is now visible to the next student.</p>
  <button type="button" class="btn" data-action="backToMap">Back to map</button>
</div>`;
}

const SCREENS = { home, reserved, scan, ride, park, done };

export function renderScreen(state, now) {
  return (SCREENS[state.screen] ?? home)(state, now);
}

// ---------- live values (updated every second without re-rendering)

export function liveValues(state, now) {
  const out = {};
  if (state.reservation) out.countdown = countdown(state, now);
  const r = state.ride;
  if (r) {
    const zone = ZONES[r.zone];
    out.speed = String(rideSpeed(state));
    out.cap = zone.speedCap ? `Speed cap ${zone.speedCap} km/h` : 'Restricted zone';
    out.message =
      zone.speedCap === 0
        ? 'Motor power cut in courtyards, dining halls and indoor sports areas. Walk the scooter.'
        : r.throttle > zone.speedCap
          ? `Geofence limits you to ${zone.speedCap} km/h here.`
          : 'Helmet on, eyes up. Slow down at gates.';
    out.time = formatClock((now - r.startedAt) / 1000);
    out.distance = formatDistance(r.distanceM);
    out.battery = `${Math.round(scooterById(state, r.scooterId).battery)}% 🔋`;
  }
  return out;
}

// ---------- map scenes: what the Leaflet map should show for the current screen

const dockPin = (dock, selected, action) => ({
  id: dock.id,
  at: dock.at,
  kind: 'dock',
  label: String(dock.freePorts),
  title: `${dock.name} · ${dock.freePorts} of ${dock.totalPorts} ports free`,
  full: dock.freePorts === 0,
  selected,
  action,
  arg: dock.id,
});

/** Spread pins that share a dock sideways so none hides another. */
function stack(pins) {
  const seen = {};
  return pins.map((pin) => ({ ...pin, stack: (seen[pin.stackKey] = (seen[pin.stackKey] ?? -1) + 1) }));
}

export function mapScene(state) {
  const you = state.you;
  switch (state.screen) {
    case 'home': {
      if (state.tab === 'scooters') {
        const current = selectedScooter(state);
        const pins = visibleScooters(state).map((s) => ({
          id: s.id,
          at: s.dock.at,
          stackKey: s.dockId,
          kind: 'scooter',
          label: `${s.battery}%`,
          title: `${s.id} · ${s.battery}% · ${s.dock.name}`,
          selected: s.id === current?.id,
          action: 'select',
          arg: s.id,
        }));
        return { fitKey: current ? `scooter:${current.id}` : 'campus', you, route: current ? [you.at, current.dock.at] : null, pins: stack(pins) };
      }
      const nav = state.navDockId ? dockById(state, state.navDockId) : null;
      return {
        fitKey: nav ? `nav:${nav.id}` : 'campus',
        fit: nav ? [you.at, nav.at] : null,
        you,
        route: nav ? [you.at, nav.at] : null,
        pins: visibleDocks(state).map((d) => dockPin(d, d.id === state.navDockId, 'navigate')),
      };
    }
    case 'reserved': {
      const scooter = scooterById(state, state.reservation.scooterId);
      const dock = dockById(state, scooter.dockId);
      return {
        fitKey: `reserved:${scooter.id}`,
        fit: [you.at, dock.at],
        you,
        route: [you.at, dock.at],
        pins: [{ id: scooter.id, at: dock.at, kind: 'scooter', label: `${Math.round(scooter.battery)}%`, title: scooter.id, selected: true }],
      };
    }
    case 'park':
      return { fitKey: 'park', you: null, route: null, pins: state.docks.map((d) => dockPin(d, d.id === state.parkDockId, 'chooseDock')) };
    default:
      return null;
  }
}
