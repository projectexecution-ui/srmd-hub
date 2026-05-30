// Minimal service worker for the CT HUB JMR module.
// Caches static assets (JS/CSS/images) so the daily entry screen
// stays snappy on flaky site networks. Navigations are NOT mediated
// by the SW any more — see the v3 note below. Daily entries
// themselves are queued in IndexedDB (see lib/jmr/offline-queue.ts)
// and posted when navigator.onLine flips.

// Bump this version whenever the fetch handler logic changes.
// v3: stop intercepting navigations entirely. The previous versions
// either cached or live-fetched navigation responses through the SW.
// Both broke auth redirects: fetch() follows redirects by default, the
// resulting Response carries `redirected: true`, and Chromium/Brave
// REFUSE to use a redirected response returned from a SW for a
// navigation (per spec) — surfacing as "This page couldn't load" on
// any protected route the moment the Supabase session expires.
// Now we let the browser handle navigations natively. Static asset
// caching (cache-first for /_next/static + images) still goes through
// the SW, which is the only thing that genuinely benefits from it.
const CACHE = 'srmd-jmr-v3'
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

// Cache-first for static assets only. Navigations bypass the SW.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return
  // Never cache Supabase API/auth calls.
  if (url.hostname.includes('supabase.co')) return

  // NAVIGATIONS: do not intercept. The browser handles them natively,
  // which means auth redirects (307 → /login) flow through correctly
  // and the user lands on the login page instead of seeing Brave's
  // "page couldn't load" error. The SHELL precache is kept for the
  // JMR offline scenario but is no longer mediated by this handler.
  if (event.request.mode === 'navigate') return

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
