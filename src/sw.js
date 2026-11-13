// Only a public offline notice is cached. PDFs, API calls and sessions are never cached here.
const CACHE='sharework-offline-v1';
const OFFLINE=new URL('./offline.html',self.location.href).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add(OFFLINE))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sharework-offline-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 if(event.request.mode!=='navigate'||event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).catch(()=>caches.match(OFFLINE)));
});
