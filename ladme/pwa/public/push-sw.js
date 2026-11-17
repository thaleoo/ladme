/* Manejadores de Web Push añadidos al service worker generado por Workbox. */
self.addEventListener('push', function (evento) {
  let datos = {}
  try {
    datos = evento.data ? evento.data.json() : {}
  } catch (e) {
    datos = { body: evento.data ? evento.data.text() : '' }
  }
  const titulo = datos.title || 'LADME'
  const opciones = {
    body: datos.body || 'Tiene una novedad en LADME.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: datos.tag || 'ladme',
    data: { url: datos.url || '/' },
    lang: 'es-CO'
  }
  // Marca el icono de la app instalada; la cifra exacta la pone la app al abrirse.
  const marcar = self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(function () {}) : Promise.resolve()
  evento.waitUntil(Promise.all([self.registration.showNotification(titulo, opciones), marcar]))
})

self.addEventListener('notificationclick', function (evento) {
  evento.notification.close()
  const destino = (evento.notification.data && evento.notification.data.url) || '/'
  evento.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (ventanas) {
        for (const ventana of ventanas) {
          if ('focus' in ventana) {
            if ('navigate' in ventana) {
              ventana.navigate(destino).catch(function () {})
            }
            return ventana.focus()
          }
        }
        return self.clients.openWindow(destino)
      })
  )
})
