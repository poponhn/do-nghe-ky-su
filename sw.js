const VERSION = 'dnks-v2';
const CORE = ['./', './index.html', './data.js', './calc.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    // Có mạng thì lấy bản mới; lỗi hoặc mất mạng thì dùng bản đã lưu
    e.respondWith(fetch(req).then(r => {
      if (!r.ok) return caches.match('./index.html').then(hit => hit || r);
      const c = r.clone(); caches.open(VERSION).then(x => x.put('./index.html', c)); return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.origin === location.origin) {
    // File của app: lấy bản mới khi có mạng để không bị kẹt công thức cũ, mất mạng thì dùng cache
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; }
      return caches.match(req).then(hit => hit || r);
    }).catch(() => caches.match(req)));
    return;
  }
  if (url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r;
    })));
  }
});
