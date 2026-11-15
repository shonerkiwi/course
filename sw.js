const C='course-v2';
const SHELL=['./','index.html','style.css','app.js','route.js','manifest.json','lib/leaflet.js','lib/leaflet.css','lib/dseg7.woff2','icons/icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(e.request.method!=='GET')return;
  if(u.hostname.endsWith('openstreetmap.org')){ // tuiles : cache d'abord
    e.respondWith(caches.open(C+'-tiles').then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(n=>{c.put(e.request,n.clone());return n;}))));return;}
  if(u.origin===location.origin) // appli : réseau d'abord, cache si hors ligne
    e.respondWith(fetch(e.request).then(n=>{const k=n.clone();caches.open(C).then(c=>c.put(e.request,k));return n;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
