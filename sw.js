/* Minimal offline support: network-first for the app's own files, so the
   compass keeps working without signal after the first visit. */
var CACHE = 'qibla-v3';
var SHELL = [
  './',
  'index.html',
  'faq.html',
  'css/style.css',
  'js/qibla.js',
  'js/usage.js',
  'js/contact.js',
  'js/faq.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  // Only handle our own static files; APIs and map tiles go straight to the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true });
  }));
});
