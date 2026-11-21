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
if (process.platform === 'linux') flags.push('--no-sandbox'); // CI containers
const browser = spawn(browserPath, [...flags, 'about:blank'], { stdio: 'ignore' });

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
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
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
  listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    if (msg.method === 'Runtime.exceptionThrown') failures.push(`[${label}] page error: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') failures.push(`[${label}] console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Network.responseReceived' && p.response.url.startsWith(origin) && p.response.status >= 400) failures.push(`[${label}] HTTP ${p.response.status} ${p.response.url}`);
    if (msg.method === 'Network.loadingFailed' && !p.canceled && p.type !== 'Image') failures.push(`[${label}] request failed: ${p.errorText}`);
  });
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Page.enable');
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
  check((await phone.count('.leaflet-overlay-pane path')) === 2, 'navigating draws a walking route');
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

  const allow = { origin, permissions: ['geolocation'] };
  await send('Browser.grantPermissions', allow);
  await phone.call('Emulation.setGeolocationOverride', { latitude: 12.6604, longitude: 77.4527, accuracy: 10 });
  await phone.click('.map-btn[title="Use my location"]');
  await phone.waitFor(`document.querySelector('.dist-note').textContent.includes('your location')`);
  check(true, 'GPS on campus is used for distances');
  await phone.call('Emulation.setGeolocationOverride', { latitude: 12.9716, longitude: 77.5946, accuracy: 10 });
  await phone.click('.map-btn[title="Use my location"]');
  await phone.waitFor(`/km from campus/.test(document.getElementById('toast').textContent)`);
  check(/demo location/.test(await phone.text('.dist-note')), 'GPS off campus falls back to the demo location');

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
  await phone.waitFor(`caches.open('dsu-ride-v4').then((c) => c.keys()).then((k) => k.length >= 20)`, 8000);
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
  process.exit(1);
}
console.log('\nSmoke test passed.');
process.exit(0);
