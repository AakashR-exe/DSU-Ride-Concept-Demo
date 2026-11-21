// End-to-end smoke test in a real headless browser (Chrome or Edge) over the DevTools protocol.
// No dependencies: starts the local server, walks the whole trip on a phone-sized and a desktop
// screen, and fails on any assertion, page error, or failed request for an app file.
//   npm run test:smoke                 (set CHROME_PATH to use a specific browser)
//   node scripts/smoke-test.mjs --screenshots out-dir
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './serve.mjs';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

const CACHE_NAME = fs.readFileSync(new URL('../dsu-ride-demo/sw.js', import.meta.url), 'utf8').match(/const CACHE = '([^']+)'/)[1];
const shotsDir = process.argv.includes('--screenshots') ? process.argv[process.argv.indexOf('--screenshots') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${message}`);
  if (!ok) failures.push(message);
};

const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(1);
}

const server = await startServer({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsu-ride-smoke-'));
const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`];
if (process.platform === 'linux') flags.push('--no-sandbox', '--disable-dev-shm-usage'); // CI machines
const browser = spawn(browserPath, [...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });

// Chrome prints "DevTools listening on ws://..." to stderr once it's ready; keep the log for error reports.
let browserLog = '';
let browserExit = null;
const browserReady = new Promise((resolve) => {
  browser.stderr.setEncoding('utf8');
  browser.stderr.on('data', (chunk) => {
    browserLog += chunk;
    const match = browserLog.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) resolve(match[1]);
  });
  browser.on('error', (error) => {
    browserExit = error.message;
    resolve(null);
  });
  browser.on('exit', (code, signal) => {
    browserExit = code ?? signal;
    resolve(null);
  });
});

// ---------- minimal DevTools protocol client
let ws;
let nextId = 0;
const pending = new Map();
const listeners = new Set();
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function connect() {
  const url = await Promise.race([browserReady, sleep(30000).then(() => null)]);
  if (!url) {
    const why = browserExit != null ? `exited with ${browserExit}` : 'did not start within 30 s';
    throw new Error(`Browser ${why}. Last output:\n${browserLog.trim().split('\n').slice(-12).join('\n')}`);
  }
  ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else for (const listener of listeners) listener(msg);
  });
}

async function openPage(label, { width, height, mobile }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const routeRequests = [];
  listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    if (msg.method === 'Fetch.requestPaused') {
      // Answer road-route requests here: deterministic, and the test never loads the shared OSRM server.
      routeRequests.push(p.request.url);
      const [[lng1, lat1], [lng2, lat2]] = new URL(p.request.url).pathname.split('/').pop().split(';').map((c) => c.split(',').map(Number));
      const midLat = (lat1 + lat2) / 2;
      const body = JSON.stringify({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[lng1, lat1], [lng1, midLat], [lng2, midLat], [lng2, lat2]] } }] });
      call('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(body).toString('base64'),
      }).catch(() => {});
    }
    if (msg.method === 'Runtime.exceptionThrown') failures.push(`[${label}] page error: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') failures.push(`[${label}] console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Network.responseReceived' && p.response.url.startsWith(origin) && p.response.status >= 400) failures.push(`[${label}] HTTP ${p.response.status} ${p.response.url}`);
    if (msg.method === 'Network.loadingFailed' && !p.canceled && p.type !== 'Image') failures.push(`[${label}] request failed: ${p.errorText}`);
  });
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*router.project-osrm.org*', requestStage: 'Request' }] });
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}\n  → ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const page = {
    call,
    evaluate,
    routeRequests,
    async goto(url) {
      await call('Page.navigate', { url });
      await page.waitFor(`!!document.querySelector('#app [data-screen-title]')`);
    },
    async waitFor(expression, timeout = 10000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(`(() => { try { return ${expression} } catch { return false } })()`)) return true;
        await sleep(100);
      }
      throw new Error(`[${label}] timed out waiting for: ${expression}`);
    },
    click: (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no element ' + ${JSON.stringify(selector)}); el.click(); })()`),
    text: (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? null`),
    count: (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`),
    async shot(name) {
      if (!shotsDir) return;
      // Let map tiles finish loading and fading in so screenshots show the real map (never fails the test).
      await page.waitFor(`![...document.querySelectorAll('.leaflet-tile')].some((t) => !t.classList.contains('leaflet-tile-loaded'))`, 8000).catch(() => {});
      await sleep(400);
      fs.mkdirSync(shotsDir, { recursive: true });
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotsDir, name), Buffer.from(data, 'base64'));
    },
  };
  return page;
}

// ---------- the test
try {
  await connect();
  console.log(`Browser: ${browserPath}\nServer:  ${origin}\n\nPhone`);
  const phone = await openPage('phone', { width: 390, height: 844, mobile: true });
  await phone.goto(`${origin}/`);
  check((await phone.evaluate('location.pathname')) === '/dsu-ride-demo/', 'site root redirects to the app');
  await phone.waitFor(`document.querySelectorAll('.pin.scooter').length === 7`);
  check(true, 'Leaflet map shows 7 scooter pins');
  check(/Nearest scooter/.test(await phone.text('.sheet')), 'sheet shows the nearest scooter');
  await phone.shot('phone-home.png');

  await phone.evaluate(`[...document.querySelectorAll('.pin.scooter')].find((p) => p.title.startsWith('DSU-014')).click()`);
  check((await phone.text('.sheet .row b')) === 'DSU-014', 'tapping a map pin selects that scooter');

  await phone.evaluate(`(() => { const i = document.getElementById('search'); i.focus(); i.value = 'hostel'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check((await phone.count('.pin.scooter')) === 1, 'search filters the map pins');
  check((await phone.evaluate('document.activeElement.id')) === 'search', 'search box keeps focus while typing');
  await phone.evaluate(`(() => { const i = document.getElementById('search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);

  await phone.click('[data-action="setTab"][data-arg="charging"]');
  check((await phone.count('.pin.dock')) === 8, 'charging tab shows 8 dock pins');
  await phone.click('.list [data-action="navigate"][data-arg="AR"]');
  await phone.waitFor(`document.querySelectorAll('.leaflet-overlay-pane path').length >= 3`); // campus outline + route casing + route
  check(phone.routeRequests.some((u) => u.includes('77.453289,12.659638')), 'navigating draws a road route to the dock');
  check(/DSU Arena/.test(await phone.text('#toast')), 'navigate shows a toast');
  await phone.click('[data-action="setTab"][data-arg="scooters"]');

  await phone.click('.sheet [data-action="reserve"]');
  const reservedId = await phone.evaluate(`document.querySelector('.ban span').textContent.match(/DSU-\\d+/)[0]`);
  check(/^\d\d:\d\d$/.test(await phone.text('[data-live="countdown"]')), `reserved ${reservedId}, countdown running`);
  await phone.shot('phone-reserved.png');

  await phone.goto(`${origin}/dsu-ride-demo/`);
  check((await phone.text('.ban span')) === `⚡ ${reservedId} reserved`, 'reservation survives a page reload');
  await phone.waitFor(`!!document.querySelector('.pin.scooter.on')`);
  await phone.click('[data-action="chirp"]');
  check(await phone.evaluate(`document.querySelector('.pin.scooter.on').classList.contains('blink')`), 'chirp blinks the scooter pin');

  await phone.click('[data-action="openScanner"]');
  await phone.click('[data-action="scanQr"]');
  await phone.waitFor(`!!document.querySelector('[data-action="startRide"]')`, 5000);
  check(true, 'simulated scan verifies the wallet');
  await phone.click('[data-action="startRide"]');
  await phone.evaluate(`(() => { const r = document.querySelector('input[type=range]'); r.value = 25; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check((await phone.text('[data-live="speed"]')) === '15', 'throttle is capped at 15 km/h on the main drive');
  await phone.waitFor(`document.querySelector('[data-live="time"]').textContent !== '00:00'`, 4000);
  check(true, 'ride clock is ticking');
  await phone.shot('phone-ride.png');

  await phone.click('[data-action="openParking"]');
  await phone.waitFor(`document.querySelectorAll('.pin.dock').length === 8`);
  await phone.evaluate(`[...document.querySelectorAll('.pin.dock')].find((p) => p.title.startsWith('Tummy Trails')).click()`);
  check(!(await phone.evaluate(`document.querySelector('[data-action="finishRide"]').disabled`)), 'choosing a dock on the map enables "end trip"');
  await phone.shot('phone-park.png');
  await phone.click('[data-action="finishRide"]');
  check(/Parked at Tummy Trails food court/.test(await phone.text('.done')), 'trip complete screen');
  await phone.click('[data-action="backToMap"]');
  check((await phone.count('.pin.scooter')) === 7, 'back on the map with all scooters available');

  // ---------- live GPS tracking
  await send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
  const setGps = (latitude, longitude) => phone.call('Emulation.setGeolocationOverride', { latitude, longitude, accuracy: 8 });
  const where = () => phone.text('[data-live="where"]');
  const locateClass = (name) => phone.evaluate(`document.querySelector('.map-btn.locate').classList.contains('${name}')`);
  const youNearCentre = `(() => {
    const m = document.querySelector('.map').getBoundingClientRect();
    const d = document.querySelector('.me-dot').getBoundingClientRect();
    return Math.hypot(d.x + d.width / 2 - (m.x + m.width / 2), d.y + d.height / 2 - (m.y + m.height / 2)) < 30;
  })()`;

  await setGps(12.6604, 77.4527); // next to Tummy Trails
  await phone.click('.map-btn.locate');
  await phone.waitFor(`document.querySelector('[data-live="where"]').textContent.includes('live location')`);
  check(true, 'live location replaces the demo location');
  check((await phone.text('.sheet .row b')) === 'DSU-014', 'nearest scooter is measured from your real position');
  check(await locateClass('is-follow'), 'locate button shows the map is following you');
  check(await phone.evaluate(`!!document.querySelector('path.accuracy') && document.querySelector('.me-dot').classList.contains('live')`), 'live dot with a GPS accuracy circle');
  await phone.waitFor(youNearCentre);
  check(true, 'map centres on you');
  await phone.waitFor(`document.querySelectorAll('.leaflet-overlay-pane path').length >= 4`); // + accuracy circle
  await sleep(300);
  await phone.shot('phone-live.png');

  const distanceBefore = await phone.text('.sheet .row .sm');
  const routeRequestsBefore = phone.routeRequests.length;
  await setGps(12.66055, 77.4527); // walk ~17 m north
  await phone.waitFor(`document.querySelector('.sheet .row .sm').textContent !== ${JSON.stringify(distanceBefore)}`);
  check(true, 'distances update as you walk');
  await phone.waitFor(youNearCentre);
  check(true, 'the map follows you');
  check(phone.routeRequests.length === routeRequestsBefore, 'a short walk reuses the route instead of asking the server again');

  const box = await phone.evaluate(`(() => { const r = document.querySelector('.map').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await phone.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) await phone.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + i * 15, y: box.y + i * 10, button: 'left', buttons: 1 });
  await phone.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 90, y: box.y + 60, button: 'left', clickCount: 1 });
  check((await locateClass('is-track')) && !(await locateClass('is-follow')), 'dragging the map stops following (tracking continues)');
  await phone.click('.map-btn.locate');
  await phone.waitFor(youNearCentre);
  check(await locateClass('is-follow'), 'tapping locate re-centres and follows again');

  await phone.click('.map-btn.locate');
  check(/demo location/.test(await where()) && !(await locateClass('is-follow')), 'tapping again turns live location off');
  check(/Live location off/.test(await phone.text('#toast')), 'and says so');

  await phone.click('.map-btn.locate');
  await phone.waitFor(`document.querySelector('[data-live="where"]').textContent.includes('live location')`);
  await phone.goto(`${origin}/dsu-ride-demo/`);
  await phone.waitFor(`document.querySelector('[data-live="where"]').textContent.includes('live location')`);
  check(await locateClass('is-follow'), 'live location resumes after a reload');

  await setGps(12.9716, 77.5946); // walk off to central Bengaluru
  await phone.waitFor(`/left campus/.test(document.getElementById('toast').textContent)`);
  check(/demo location/.test(await where()) && !(await locateClass('is-follow')), 'leaving campus turns live location off');
  await phone.click('.map-btn.locate');
  await phone.waitFor(`/km from campus/.test(document.getElementById('toast').textContent)`);
  check(/demo location/.test(await where()), 'starting off campus keeps the demo location');

  await phone.click('[data-action="resetDemo"]');
  check(/DSU-022/.test(await phone.text('.sheet .row b')), 'reset restores the original data');

  const manifest = await phone.call('Page.getAppManifest');
  check(manifest.errors.length === 0, 'web app manifest has no errors');
  try {
    const { installabilityErrors } = await phone.call('Page.getInstallabilityErrors');
    check(installabilityErrors.length === 0, `installable${installabilityErrors.length ? `: ${JSON.stringify(installabilityErrors)}` : ''}`);
  } catch {
    console.log('  - installability check not supported by this browser');
  }
  check((await phone.evaluate(`navigator.serviceWorker.ready.then((r) => r.active.state)`)) === 'activated', 'service worker active');
  await phone.waitFor(`caches.open('${CACHE_NAME}').then((c) => c.keys()).then((k) => k.length >= 20)`, 8000);
  check(true, 'app shell cached for offline use');

  console.log('\nDesktop');
  const desktop = await openPage('desktop', { width: 1366, height: 800, mobile: false });
  await desktop.goto(`${origin}/dsu-ride-demo/`);
  await desktop.waitFor(`!!document.querySelector('.leaflet-container')`);
  check((await desktop.evaluate(`document.querySelector('.map').getBoundingClientRect().width`)) > 700, 'map sits beside the sheet');
  await desktop.shot('desktop-home.png');
  await desktop.click('.sheet [data-action="reserve"]');
  check((await desktop.evaluate(`document.querySelector('.map').getBoundingClientRect().width`)) > 700, 'reserved screen keeps the wide map');
  await desktop.shot('desktop-reserved.png');
  await desktop.click('[data-action="cancelReservation"]');
} catch (error) {
  failures.push(error.message);
} finally {
  try {
    await send('Browser.close');
  } catch {}
  browser.kill();
  server.close();
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    // Surface each failure as an annotation on the run / pull request.
    const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    for (const f of failures) console.log(`::error title=Smoke test::${escape(f)}`);
  }
  process.exit(1);
}
console.log('\nSmoke test passed.');
process.exit(0);
