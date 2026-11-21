# DSU Ride

DSU Ride is a responsive, installable campus e-scooter web app. Find scooters by campus location or scooter ID, view charging-point availability, and walk through the reserve, QR-unlock, ride, and park flows.

The app is a self-contained front-end demo: scooter locations, battery levels, reservations, wallet verification, and ride/parking actions use sample data and are simulated in the browser. It has no backend or third-party dependencies.

## Run locally

Open `index.html` in a browser, or serve this folder over HTTP:

```powershell
py -m http.server 8000
```

For offline installation and service-worker caching, use an HTTP(S) origin (opening the file directly does not enable service workers). In a supported browser, use **Install app** or **Add to Home Screen**.

## Deploy with GitHub Pages

In the repository settings, choose **Pages → Deploy from a branch** and select `main` with the repository root as the publishing source. Then open the `dsu-ride-demo/` subfolder in the published site. The service worker caches the app shell for offline use after the first visit.

## Project files

- `index.html` — responsive app UI and demo interactions
- `manifest.webmanifest` — installable web-app metadata
- `icon.svg` — app icon
- `sw.js` — offline app-shell cache
