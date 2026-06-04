// SportsBrain PRO — Service Worker v4 (auto-reload on deploy)
// Estratégia: navigation = network-first, assets = network-first com fallback cache.
// Na ativação: limpa TODO cache antigo e recarrega todas as abas abertas.

const CACHE_NAME = 'sportsbrain-v4'
const STATIC_ASSETS = ['/', '/index.html']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Limpa TODOS os caches antigos (força refresh do bundle novo)
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    await self.clients.claim()
    // Recarrega todas as abas controladas para pegar o JS novo
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) {
      try { client.navigate(client.url) } catch {}
    }
  })())
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (url.origin !== location.origin) return

  // Navigation: network-first (garante index.html fresco, referenciando bundle novo)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  // Assets: network-first com cache só como fallback offline
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
        }
        return res
      }).catch(() => caches.match(e.request))
    )
    return
  }
})

// Mensagem manual: `navigator.serviceWorker.controller.postMessage({type:'SKIP_WAITING'})`
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// Push notifications
self.addEventListener('push', e => {
  if (!e.data) return
  const data = e.data.json()
  e.waitUntil(
    self.registration.showNotification(data.title || 'SportsBrain', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   data.tag   || 'sb-push',
      data:  data.url   || '/',
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow(e.notification.data || '/'))
})

// ─── BACKGROUND ALERT POLL (Fase J) ──────────────────────────────────────
const ALERT_API = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/intelligence/alerts'
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sb-poll-alerts') event.waitUntil(pollAndNotify())
})
self.addEventListener('message', (event) => {
  if (event.data?.type === 'POLL_ALERTS') event.waitUntil(pollAndNotify())
})
async function pollAndNotify() {
  try {
    const res = await fetch(ALERT_API, { cache: 'no-store' })
    const j = await res.json()
    if (!j?.alerts?.length) return
    for (const a of j.alerts.slice(0, 3)) {
      await self.registration.showNotification('🎯 Pick HIGH +EV', {
        body: `${a.outcome} @${a.odd} · edge ${a.edge}%`,
        tag: a.id || `${a.outcome}-${a.odd}`,
        icon: '/favicon.ico',
        data: '/banca365',
      })
    }
  } catch (e) { console.warn('[sw] poll error:', e.message) }
}
