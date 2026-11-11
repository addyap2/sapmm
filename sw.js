// App shell + content: network-first with cache fallback.
// Audio: served from the 'sapmm-audio' cache when a module was downloaded for offline use (with Range support).
const CACHE = 'sapmm-v4';
const AUDIO = 'sapmm-audio';
const CORE = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'assets/icon.svg', 'assets/icon-192.png',
  'content/course.json', ...Array.from({ length: 10 }, (_, i) => `content/module-${String(i + 1).padStart(2, '0')}.json`)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== AUDIO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function audioResponse(req) {
  const cache = await caches.open(AUDIO);
  const hit = await cache.match(req.url, { ignoreSearch: true });
  if (!hit) return fetch(req);
  const range = req.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? +m[1] : 0;
  const end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/audio/') && (req.method === 'GET' || req.method === 'HEAD')) { e.respondWith(audioResponse(req)); return; }
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
