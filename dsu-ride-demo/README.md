# DSU Ride – Concept Demo

Clickable prototype of the DSU Ride campus e-scooter app (find, reserve, unlock, ride, park). All data is sample data. No backend, no dependencies, no internet needed.

## Run locally (no internet)
- **Computer:** double-click `index.html`.
- **Phone:** copy the folder to the phone and open `index.html` in Chrome/Safari, or serve it on your Wi-Fi: `python3 -m http.server 8000` then open `http://<your-computer-ip>:8000` on the phone.

## Host on GitHub Pages
1. Push this folder to a repo.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open the Pages URL once on the phone, then use "Add to Home Screen". After that it works offline (service worker caches the files).

## Files
`index.html` (the whole app) · `manifest.webmanifest` + `icon.svg` (install as app) · `sw.js` (offline cache)
