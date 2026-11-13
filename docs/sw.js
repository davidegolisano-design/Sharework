// Only a public offline notice is cached. PDFs, API calls and sessions are never cached here.
const CACHE='sharework-offline-v4';
const OFFLINE=new URL('./offline.html',self.location.href).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([OFFLINE,...['offline.js','locale.js','style.css','icons/sharework.svg'].map(path=>new URL(path,self.location.href).href)]))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sharework-offline-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 if(event.request.method==='GET'&&['offline.js','locale.js','style.css','icons/sharework.svg'].some(path=>new URL(event.request.url).pathname===new URL(path,self.location.href).pathname)){
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request,{ignoreSearch:true})));
  return;
 }
 if(event.request.mode!=='navigate'||event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).catch(()=>caches.match(OFFLINE)));
});
