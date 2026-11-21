# DSU Ride

DSU Ride is a responsive, installable campus e-scooter web app for the Dayananda Sagar University Harohalli campus. Find scooters by campus location or scooter ID, view charging-point availability, and walk through the reserve, QR-unlock, ride, and park flows.

The map is a live [Leaflet](https://leafletjs.com/) map with [OpenStreetMap](https://www.openstreetmap.org/) tiles. The campus outline and building positions come from OpenStreetMap (way 1107054018). Scooters, battery levels, port counts, reservations, wallet checks, and the rider's "you are here" position (Campus Yard) are sample data simulated in the browser. There is no backend.

**Live app:** https://aakashr-exe.github.io/DSU-Ride-Concept-Demo/

## Open it on any device

Open the live link in any modern browser: phone, tablet, or laptop. To install it like an app:

- **Android / Chrome / Edge:** menu → **Install app** (or **Add to Home screen**).
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.
- **Desktop Chrome / Edge:** install icon in the address bar.

After the first visit, the app shell works offline. Map tiles still need a connection.

## Run locally

Serve this folder over HTTP:

```powershell
python -m http.server 8000
```

Then open http://localhost:8000/. Opening `index.html` straight from disk also works, but the service worker (offline/install) needs HTTP(S).

## Deploy with GitHub Pages

The repository root holds an `index.html` that redirects to this folder, plus a `.nojekyll` file. One-time setup: in the repository **Settings → Pages**, set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, and save. Every push to `main` then redeploys within a minute or two.

## Project files

- `index.html` — app UI, Leaflet map, and demo interactions
- `vendor/leaflet/` — Leaflet 1.9.4 (BSD-2-Clause), bundled so the app has no CDN dependency
- `manifest.webmanifest` — installable web-app metadata
- `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — app icons
- `sw.js` — offline app-shell cache

Map data © OpenStreetMap contributors, available under the Open Database License.
