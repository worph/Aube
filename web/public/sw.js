/**
 * Service worker for install and push only (ported from Newsdesk web/public/sw.js). No offline
 * caching: the brief always comes from the server or says it cannot.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = { title: 'Aube', body: 'Your brief is ready.', url: '/briefs' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // A malformed payload still deserves a notification rather than silence.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa/icon-192.png',
      badge: '/pwa/badge-96.png',
      data: { url: payload.url },
      tag: 'aube-brief',
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url ?? '/briefs'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
