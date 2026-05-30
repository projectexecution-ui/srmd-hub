// Minimal service worker for the CT HUB JMR module.
// Caches the app shell + recent navigation responses so the daily entry
// screen remains usable on flaky site networks. NOT a substitute for
// full offline-first — daily entries themselves are queued in IndexedDB
// (see lib/jmr/offline-queue.ts) and posted when navigator.onLine flips.

// Bump this version whenever the fetch handler logic changes.
// v2: refuse to cache or return redirected/non-2xx navigation responses.
// Previously the SW poisoned itself by caching login-redirect HTML under
// protected URLs (e.g. /procurement-tracker), which Chromium/Brave then
// refused to serve for a navigation → "This page couldn't load".
const CACHE = 'srmd-jmr-v2'
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
          // Only cache real, final, successful HTML responses.
          // Never cache redirects (login bounces), opaque responses, or
          // non-2xx — caching those poisons the URL and Chromium refuses
          // to use a redirected response from a SW for a navigation.
          if (res && res.ok && !res.redirected && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => null)
          }
          return res
        })
        .catch(() =>
          caches.match(event.request).then(r => {
            // Refuse to serve a redirected cached response for a navigation —
            // the browser will reject it. Fall back to the JMR shell instead.
            if (r && !r.redirected) return r
            return caches.match('/jmr')
          })
        )
    )
    return
  }

  // Cache-first for /_next/static + images.
  if (url.pathname.startsWith('/_next/static') || /\.(png|svg|jpg|jpeg|webp|ico|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetch(event.request).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => null)
        }
        return res
      }))
    )
  }
})
