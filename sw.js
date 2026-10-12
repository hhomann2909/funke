// Funke service worker: network first, but never wait longer than ~3 s before falling back to the cache.
// Only good (2xx), same-origin answers are cached, so an error page can never replace the app.
// All paths are relative to this file, so the app works under any subpath (e.g. /funke/).
const CACHE = 'funke-v3';
const PREFIX = 'funke-';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
const TIMEOUT = 3000;

self.addEventListener('install', e => {
  // Fetch fresh copies (bypassing the HTTP cache). A single missing file must not break the install.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(u =>
        fetch(new Request(u, { cache: 'reload' }))
          .then(r => (r.ok ? c.put(u, r) : null))
          .catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Only remove our own old caches: other projects on the same origin (github.io) keep theirs.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  const nav = req.mode === 'navigate';

  const fromCache = () => caches.open(CACHE)
    .then(c => c.match(req, { ignoreSearch: nav })
      .then(r => r || (nav ? c.match('./').then(x => x || c.match('./index.html')) : undefined)))
    .catch(() => undefined);

  // Network request; good same-origin answers refresh the cache in the background
  const network = fetch(req).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      return caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}).then(() => res);
    }
    return res;
  });
  e.waitUntil(network.then(() => {}, () => {}));

  e.respondWith(new Promise(resolve => {
    let done = false;
    const send = r => { if (!done && r) { done = true; resolve(r); } };
    // Slow network: after 3 s answer from the cache (if there is a copy) and let the network finish quietly
    const timer = setTimeout(() => { fromCache().then(send); }, TIMEOUT);
    network.then(res => {
      clearTimeout(timer);
      if (res.ok || res.type === 'opaqueredirect') return send(res);
      // HTTP error (404, 5xx): prefer the cached copy, otherwise pass the error through
      return fromCache().then(c => send(c || res));
    }, () => {
      clearTimeout(timer);
      return fromCache().then(c => send(c || Response.error()));
    });
  }));
});
