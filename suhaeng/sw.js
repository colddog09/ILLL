const CACHE_NAME = 'pwa-cache-v24';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// Install Service Worker
self.addEventListener('install', event => {
  // Force waiting service worker to become active
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Fetch from cache, fallback to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Update cache on activate
self.addEventListener('activate', event => {
  // Claim clients immediately
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        );
      })
    ])
  );
});
