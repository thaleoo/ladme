import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker en modo «prompt»: la versión nueva se descarga en segundo plano
 * y se activa cuando la persona toca «Actualizar» (o sola, si la app falla).
 */
let actualizarSW: ((recargar?: boolean) => Promise<void>) | null = null
let hayNueva = false

export function iniciarServiceWorker(): void {
  actualizarSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      hayNueva = true
      window.dispatchEvent(new Event('ladme-actualizacion'))
    },
    onRegisteredSW(_url, registro) {
      if (!registro) return
      // Busca versiones nuevas cada hora y cada vez que la app vuelve a primer plano.
      const revisar = () => {
        if (navigator.onLine) void registro.update().catch(() => undefined)
      }
      window.setInterval(revisar, 60 * 60 * 1000)
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && revisar())
    }
  })
}

export function hayActualizacion(): boolean {
  return hayNueva
}

export async function aplicarActualizacion(): Promise<void> {
  if (actualizarSW) await actualizarSW(true)
  else window.location.reload()
}

/**
 * Último recurso cuando la app no arranca: borra el service worker y la caché
 * de archivos (NO la sesión ni las preferencias) y recarga desde el servidor.
 */
export async function limpiarYRecargar(): Promise<void> {
  try {
    const registros = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(registros.map((r) => r.unregister()))
    const claves = (await window.caches?.keys?.()) ?? []
    await Promise.all(claves.map((k) => caches.delete(k)))
  } catch {
    // Si el navegador no lo permite, al menos se recarga.
  }
  window.location.reload()
}
