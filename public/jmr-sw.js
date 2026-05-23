// Minimal service worker for the SRMD Hub JMR module.
// Caches the app shell + recent navigation responses so the daily entry
// screen remains usable on flaky site networks. NOT a substitute for
// full offline-first — daily entries themselves are queued in IndexedDB
// (see lib/jmr/offline-queue.ts) and posted when navigator.onLine flips.

const CACHE = 'srmd-jmr-v1'
const SHELL = [
  '/',
  '/jmr',
  '/jmr/entry',
  '/manifest.webmanifest',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL).catch(() => null))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  )
  self.clients.claim()
})

// Network-first for navigation; cache-first for static.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return
  // Never cache Supabase API/auth calls.
  if (url.hostname.includes('supabase.co')) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(event.request, copy))
          return res
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('/jmr')))
    )
    return
  }

  // Cache-first for /_next/static + images.
  if (url.pathname.startsWith('/_next/static') || /\.(png|svg|jpg|jpeg|webp|ico|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetch(event.request).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(event.request, copy))
        return res
      }))
    )
  }
})
