import { supabase } from './supabase'

/** Identificador de la versión publicada (lo fija Vite al compilar). */
export const VERSION = typeof __LADME_VERSION__ === 'string' ? __LADME_VERSION__ : 'dev'

export type TipoError = 'error' | 'promesa' | 'carga_lenta' | 'chunk' | 'render'

const enviados = new Set<string>()

/**
 * Envía un fallo a la tabla errores_app. Nunca lanza: si no hay red, se pierde.
 * El mismo mensaje se envía una sola vez por sesión.
 */
export function registrarError(tipo: TipoError, mensaje: string, pila?: string | null): void {
  const clave = `${tipo}:${mensaje}`
  if (!mensaje || enviados.has(clave) || enviados.size > 30) return
  enviados.add(clave)
  if (import.meta.env.DEV) console.warn('[registrarError]', tipo, mensaje)
  void supabase
    .rpc('registrar_error', {
      p_tipo: tipo,
      p_mensaje: mensaje.slice(0, 500),
      p_pila: pila?.slice(0, 2000) ?? null,
      p_ruta: window.location.pathname.slice(0, 200),
      p_agente: navigator.userAgent.slice(0, 300),
      p_version: VERSION
    })
    .then(
      () => undefined,
      () => undefined
    )
}

export function esErrorDeCarga(e: unknown): boolean {
  const texto = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(texto)
}

/** Captura errores no controlados de toda la app. Se llama una vez al iniciar. */
export function instalarCapturaDeErrores(): void {
  window.addEventListener('error', (ev) => {
    if (!ev.message) return
    registrarError(esErrorDeCarga(ev.error) ? 'chunk' : 'error', ev.message, ev.error?.stack)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    const mensaje = r instanceof Error ? r.message : typeof r === 'string' ? r : JSON.stringify(r ?? '')
    registrarError(esErrorDeCarga(r) ? 'chunk' : 'promesa', mensaje, r instanceof Error ? r.stack : null)
  })
}
