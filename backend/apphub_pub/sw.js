const CACHE='apphub-pwa-v2';
const ASSETS=['/pub/apphub/','/pub/apphub/avatar.js','/pub/apphub/layout.js','/pub/apphub/icon.svg','/pub/apphub/icon-192.png','/pub/apphub/icon-512.png','/i18n/i18n.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const p=new URL(e.request.url).pathname;if(!ASSETS.includes(p))return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)))});
