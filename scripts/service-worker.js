/* SHELL is embedded by the build: readable version plus content-hashed assets. */
const PREFIX = 'speedracer-shell-';
const CACHE = PREFIX + SHELL.generation;
const urls = new Set(SHELL.assets.map(asset => new URL(asset.url, self.location.origin).href));
const digest = async response => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Reject a partial rollout so the current release remains available until a later retry.
      for (const asset of SHELL.assets) {
        const response = await fetch(asset.url, { cache: 'reload' });
        if (!response.ok || await digest(response.clone()) !== asset.sha256) throw new Error('Incomplete app shell');
        await cache.put(asset.url, response);
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
    // An upgrade waits for the user's explicit APPLY_UPDATE message.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Keep old generations while other tabs may still run their module graphs.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length <= 1) {
      const shells = (await caches.keys()).filter(name => name.startsWith(PREFIX));
      const previous = shells.filter(name => name !== CACHE).at(-1);
      await Promise.all(shells.filter(name => name !== CACHE && name !== previous).map(name => caches.delete(name)));
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'GET_UPDATE_INFO') event.ports?.[0]?.postMessage({ version: SHELL.version });
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html', { ignoreVary: true })).then(response => response ?? fetch(request)));
  } else if (urls.has(request.url)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request, { ignoreVary: true })).then(response => response ?? fetch(request)));
  } else if (new URL(request.url).pathname.startsWith('/assets/')) {
    // Another tab can still request an older, hashed asset after explicit activation.
    event.respondWith(caches.match(request, { ignoreVary: true }).then(response => response ?? fetch(request)));
  }
});
