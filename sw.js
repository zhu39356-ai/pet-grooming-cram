const CACHE='pet-grooming-cram-v2';
const CORE=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./assets/icon.svg','./data/sources.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
    if(res.ok && new URL(e.request.url).origin===location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(()=>caches.match('./index.html'))));
});
