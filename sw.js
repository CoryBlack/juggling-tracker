// Bump this on every deploy that touches a cached file — changing this string changes
// the byte content of sw.js itself, which is what makes the browser notice there's a
// new service worker to install (comparing cached shell contents alone doesn't).
const CACHE = 'juggling-shell-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for the app shell: always try to fetch the latest version while online,
// and only fall back to the cached copy if the network request fails (i.e. offline).
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache GitHub API calls — always go to network so data stays fresh.
  if (url.hostname === 'api.github.com') return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
