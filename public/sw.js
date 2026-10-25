/* OctaIQ service worker: network first, so a deploy is never hidden behind a stale cache,
   with the last good copy available when the connection drops. */
const CACHE = 'octaiq-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // The live API is never served from cache: stale prices would be worse than none.
  if (url.pathname.includes('/api/')) return

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match(self.registration.scope)
          if (shell) return shell
        }
        return Response.error()
      }
    })(),
  )
})
