const CACHE='pet-grooming-cram-v15-2';
const BANK_CACHE='pet-grooming-bank-stable-v1';
const IMAGE_CACHE='pet-grooming-animal-images-v1';
const CRITICAL=['./','./index.html','./styles.css','./app-v15.2.js?v=15.2','./manifest.webmanifest','./assets/icon.svg'];
const BANK_FILES=['./data/professional-13900.json','./data/common-90006-90009.json','./data/firstaid-practice.json','./data/animal-study.json'];
const OPTIONAL=['./assets/q-13900-05-026.png','./assets/q-90008-013.png','./assets/q-90009-002.png','./assets/q-90009-069.png','./assets/q-90009-086.png'];

async function fetchAndCache(cacheName,url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok)throw new Error(`${url} HTTP ${res.status}`);
  const cache=await caches.open(cacheName);await cache.put(url,res.clone());return res;
}

self.addEventListener('install',e=>e.waitUntil((async()=>{
  const app=await caches.open(CACHE);
  for(const url of CRITICAL){const res=await fetch(url,{cache:'no-store'});if(!res.ok)throw new Error(`critical ${url} HTTP ${res.status}`);await app.put(url,res.clone());}
  await Promise.allSettled(OPTIONAL.map(url=>fetchAndCache(CACHE,url)));
  await Promise.allSettled(BANK_FILES.map(url=>fetchAndCache(BANK_CACHE,url)));
  await self.skipWaiting();
})()));

self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE&&k!==BANK_CACHE&&k!==IMAGE_CACHE&&k.startsWith('pet-grooming-cram-')).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin){
    if(e.request.destination==='image'){
      e.respondWith((async()=>{
        const cache=await caches.open(IMAGE_CACHE);
        const hit=await cache.match(e.request);
        if(hit)return hit;
        const res=await fetch(e.request,{mode:'no-cors'});
        await cache.put(e.request,res.clone());
        return res;
      })().catch(async()=>{const hit=await caches.match(e.request);if(hit)return hit;throw new Error('animal image fetch failed');}));
    }
    return;
  }
  const path=u.pathname;
  const isBank=BANK_FILES.some(x=>path.endsWith(x.replace('./','/'))||path.endsWith(x.replace('./','')));
  e.respondWith((async()=>{
    try{
      const res=await fetch(e.request);
      if(res.ok){const copy=res.clone();const cache=await caches.open(isBank?BANK_CACHE:CACHE);cache.put(e.request,copy);return res;}
      const hit=await caches.match(e.request);if(hit)return hit;
      return res;
    }catch(err){
      const hit=await caches.match(e.request);if(hit)return hit;
      if(e.request.mode==='navigate')return (await caches.match('./index.html'))||(await caches.match('./'));
      throw err;
    }
  })());
});
