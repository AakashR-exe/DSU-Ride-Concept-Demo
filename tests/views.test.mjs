import assert from 'node:assert/strict';
import test from 'node:test';
import { actions, tick } from '../dsu-ride-demo/js/actions.js';
import { RULES } from '../dsu-ride-demo/js/data.js';
import { html, raw } from '../dsu-ride-demo/js/html.js';
import { createInitialState } from '../dsu-ride-demo/js/state.js';
import { liveValues, mapScene, renderScreen } from '../dsu-ride-demo/js/views.js';

const T0 = 1_700_000_000_000;
const render = (state, now = T0) => String(renderScreen(state, now));

test('html`` escapes values, keeps nested templates, skips empty values', () => {
  assert.equal(String(html`<b>${'<img onerror=x>'}</b>`), '<b>&lt;img onerror=x&gt;</b>');
  assert.equal(String(html`<a title="${'"quoted" & \'single\''}">`), '<a title="&quot;quoted&quot; &amp; &#39;single&#39;">');
  assert.equal(String(html`<i>${html`<b>ok</b>`}</i>`), '<i><b>ok</b></i>');
  assert.equal(String(html`${[1, html`<br>`, 2]}${null}${undefined}${false}`), '1<br>2');
  assert.equal(String(raw('<hr>')), '<hr>');
});

test('the search query is escaped when rendered', () => {
  const state = createInitialState();
  actions.setQuery(state, '"><script>alert(1)</script>');
  const out = render(state);
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('value="&quot;&gt;&lt;script&gt;'));
});

test('every screen of the trip renders', () => {
  const state = createInitialState();
  assert.match(render(state), /Nearest scooter/);
  actions.setTab(state, 'charging');
  assert.match(render(state), /Charging points on campus/);
  actions.setTab(state, 'scooters');

  actions.reserve(state, 'DSU-022', T0);
  assert.match(render(state), /DSU-022 reserved[\s\S]*10:00/);
  actions.openScanner(state);
  assert.match(render(state), /Simulate scan/);
  actions.scanQr(state, undefined, T0);
  assert.match(render(state), /Verifying wallet/);
  tick(state, T0 + RULES.scanVerifyMs);
  assert.match(render(state), /Unlock &amp; start ride/);
  actions.startRide(state, undefined, T0);
  assert.match(render(state), /Riding DSU-022/);
  actions.toggleFaultMenu(state);
  assert.match(render(state), /Report a fault[\s\S]*Brake wear/);
  actions.toggleFaultMenu(state);
  actions.openParking(state);
  assert.match(render(state), /Park at a charging point[\s\S]*disabled/);
  actions.chooseDock(state, 'TT');
  actions.finishRide(state, undefined, T0 + 30_000);
  assert.match(render(state), /Trip complete[\s\S]*Tummy Trails food court/);
});

test('live values follow the clock', () => {
  const state = createInitialState();
  actions.reserve(state, 'DSU-022', T0);
  assert.equal(liveValues(state, T0 + 61_000).countdown, '08:59');
  actions.openScanner(state);
  actions.scanQr(state, undefined, T0);
  tick(state, T0 + 2000);
  actions.startRide(state, undefined, T0 + 2000);
  actions.setZone(state, 1);
  actions.setThrottle(state, 20);
  const live = liveValues(state, T0 + 2000 + 75_000);
  assert.equal(live.time, '01:15');
  assert.equal(live.speed, '8');
  assert.match(live.message, /limits you to 8 km\/h/);
});

test('map scenes: pins, routes and when to refit', () => {
  const state = createInitialState();
  const home = mapScene(state);
  assert.equal(home.fitKey, 'scooter:DSU-022');
  assert.equal(home.pins.length, 7);
  assert.equal(home.pins.filter((p) => p.selected).length, 1);
  assert.ok(home.route, 'route to the selected scooter');
  actions.select(state, 'DSU-019');
  assert.equal(mapScene(state).fitKey, 'scooter:DSU-019', 'selecting another scooter refits the route');

  actions.setTab(state, 'charging');
  assert.equal(mapScene(state).pins.length, 8);
  actions.navigate(state, 'AR');
  assert.equal(mapScene(state).fitKey, 'nav:AR');

  actions.setTab(state, 'scooters');
  actions.reserve(state, 'DSU-014', T0);
  assert.equal(mapScene(state).fitKey, 'reserved:DSU-014');

  actions.openScanner(state);
  assert.equal(mapScene(state), null, 'no map on the scan screen');
});

test('live location shows in the legend, the distance note and the parking screen', () => {
  const state = createInitialState();
  assert.match(liveValues(state, T0).where, /Campus Yard \(demo location\)/);
  actions.setLocation(state, { at: [12.6604, 77.4527], source: 'gps', accuracy: 7.6 });
  assert.equal(liveValues(state, T0).where, 'Distances from your live location (±8 m).');
  const home = render(state);
  assert.match(home, /You \(live\)/);
  assert.match(home, /data-live="where">Distances from your live location/);

  actions.reserve(state, 'DSU-014', T0);
  actions.openScanner(state);
  actions.scanQr(state, undefined, T0);
  tick(state, T0 + RULES.scanVerifyMs);
  actions.startRide(state, undefined, T0);
  actions.openParking(state);
  assert.deepEqual(mapScene(state).you.source, 'gps', 'parking map shows you when GPS is live');
  assert.match(render(state), /\d+ m · \d of \d ports free/);

  actions.setLocation(state, { at: [12.661641, 77.450018], source: 'demo' });
  assert.equal(mapScene(state).you, null, 'but not the demo location');
  assert.doesNotMatch(render(state), /\d+ m · \d of \d ports free/);
});
