// ─── Service Worker — martin-bakery PWA ──────────────────────────────────────
const CACHE_NAME = 'martin-bakery-v1'
const SUPABASE_HOST = 'nlklndgmtmwoacipjyek.supabase.co'

// Static assets to pre-cache on install
const PRE_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// ─── Install: pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  )
  self.skipWaiting()
})

// ─── Activate: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ─── Fetch: strategy per request type ───────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip auth-related Supabase requests (tokens, sessions)
  if (url.hostname === SUPABASE_HOST && url.pathname.includes('/auth/')) return

  // Network First for Supabase API calls (data should be fresh)
  if (url.hostname === SUPABASE_HOST) {
    event.respondWith(networkFirst(request))
    return
  }

  // Cache First for static assets (JS, CSS, images, fonts)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Network First for HTML navigation (ensures fresh app shell)
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // Default: network first
  event.respondWith(networkFirst(request))
})

// ─── Cache First strategy ───────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// ─── Network First strategy ─────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // For navigation requests, return cached index.html (SPA fallback)
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html')
      if (fallback) return fallback
    }
    return new Response('Offline', { status: 503 })
  }
}
