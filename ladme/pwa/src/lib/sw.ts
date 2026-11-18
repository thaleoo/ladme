import { registerSW } from 'virtual:pwa-register'

/**
 * Service worker en modo «prompt»: la versión nueva se descarga en segundo plano
 * y se activa cuando la persona toca «Actualizar» (o sola, si la app falla).
 */
let actualizarSW: ((recargar?: boolean) => Promise<void>) | null = null
let hayNueva = false
let registroSW: ServiceWorkerRegistration | null = null

export function iniciarServiceWorker(): void {
  actualizarSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      hayNueva = true
      window.dispatchEvent(new Event('ladme-actualizacion'))
    },
    onRegisteredSW(_url, registro) {
      if (!registro) return
      registroSW = registro
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

/**
 * Pide al servidor la última versión y espera unos segundos a que se descargue.
 * Devuelve true si hay una versión nueva lista para activar.
 */
export async function buscarVersionNueva(esperaMs = 6000): Promise<boolean> {
  if (hayNueva) return true
  if (!registroSW || !navigator.onLine) return false
  try {
    await registroSW.update()
  } catch {
    return false
  }
  const fin = Date.now() + esperaMs
  while (Date.now() < fin) {
    if (hayNueva || registroSW.waiting) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return hayNueva || !!registroSW.waiting
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
