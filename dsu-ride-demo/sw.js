// Offline app shell. Pages load network-first so a new deploy shows up as soon as you're online;
// static assets are cache-first. Map tiles (cross-origin, OpenStreetMap) are left to the browser's HTTP cache.
const C='dsu-ride-v3',F=['./','index.html','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png','vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const r=e.request;
 if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
 if(r.mode==='navigate'){
  e.respondWith(fetch(r).then(res=>{const copy=res.clone();caches.open(C).then(c=>c.put(r,copy));return res})
   .catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))));
  return;
 }
 e.respondWith(caches.match(r).then(m=>m||fetch(r)));
});
