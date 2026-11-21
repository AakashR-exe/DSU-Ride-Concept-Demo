# DSU Ride

DSU Ride is an installable campus e-scooter web app for the Dayananda Sagar University Harohalli campus. Find a scooter on a live campus map, reserve it, scan to unlock, ride, and park at a charging point.

**Live app:** https://aakashr-exe.github.io/DSU-Ride-Concept-Demo/

It's a front-end demo with no backend and no database. The campus map is real (Leaflet + OpenStreetMap). Scooters, batteries, port counts, wallet checks and rides are simulated in the browser. Demo progress is saved in the browser's local storage, so a refresh doesn't lose a reservation or ride. **Reset demo data** at the bottom of the home screen restores the starting state, which is handy before a presentation.

## Open it on any device

Open the live link in any modern browser. To install it like an app:

- **Android / Chrome / Edge:** menu → **Install app** (or **Add to Home screen**)
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**
- **Desktop Chrome / Edge:** the install icon in the address bar

After the first visit the app works offline, but map tiles need a connection. On campus, the **Use my location** button (crosshair on the map) measures distances from where you are. Elsewhere it falls back to a demo location at Campus Yard.

## Demo walkthrough

1. **Home:** tap a scooter pin or list item, or search by scooter ID or building. The **Charging** tab lists docks; tap one for a walking route.
2. **Reserve:** a 10-minute hold with a live countdown. **Chirp** blinks the scooter on the map; **Demo: skip to end of hold** shows expiry.
3. **Scan:** **Simulate scan** matches the scooter and verifies the wallet.
4. **Ride:** drag the throttle and switch zones to show the geofence speed caps (15 km/h, 8 km/h, motor cut). You can also report a fault.
5. **Park:** pick a dock with free ports on the map or in the list, then end the trip.

## Develop

Requires Node.js 22 or newer. There are no packages to install.

```sh
npm start            # http://localhost:8000/
npm run start:lan    # also reachable from phones on the same Wi-Fi
npm test             # unit tests (node:test)
npm run test:smoke   # end-to-end test in headless Chrome/Edge (set CHROME_PATH if needed)
```

The app uses JavaScript modules, so open it through a server (as above), not straight from disk. Python works too: run `python -m http.server 8000` in the repository root.

### How the code is organised

| File | Role |
| --- | --- |
| `index.html` | Page shell: loads Leaflet, the stylesheet and `js/main.js` |
| `css/app.css` | All styles (phone-first; wide screens put the map beside the sheet) |
| `js/data.js` | Campus outline, docks, scooters, zones and demo rules |
| `js/state.js` | Initial state and save/restore via `localStorage` |
| `js/actions.js` | Every state change (reserve, scan, ride, park…) plus the 1-second `tick` |
| `js/selectors.js` | Derived data: nearest scooters, search, open docks, speed |
| `js/views.js` | Screens as HTML templates, live values, and the map "scene" per screen |
| `js/map.js` | The single Leaflet map, moved between screens and redrawn from a scene |
| `js/html.js` | `html` template tag that escapes everything interpolated |
| `js/geo.js` | Distances, walking estimates, point-in-campus test, formatting |
| `js/main.js` | Wiring: renders, routes `data-action` clicks to actions, runs the clock, GPS |
| `sw.js` | Offline cache, network-first so new deploys appear immediately |

Buttons declare what they do with `data-action="reserve" data-arg="DSU-014"`. One click listener in `main.js` calls the matching function in `actions.js`, saves state, and re-renders. Actions receive the current time as an argument, so the tests can drive the whole flow with a fake clock.

When you add a file under `js/` or `css/`, add it to `SHELL` in `sw.js` and bump `CACHE`. A unit test fails if you forget.

## Deploy

`.github/workflows/pages.yml` runs both test suites on every push and pull request. When they pass on `main`, it publishes the repository to GitHub Pages. The site root redirects to this folder. One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Credits

Map data © OpenStreetMap contributors (ODbL). Leaflet 1.9.4 (BSD-2-Clause) is bundled in `vendor/leaflet/`.
