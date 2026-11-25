import { lazy, type ComponentType } from 'react'
import { esErrorDeCarga } from './telemetria'

const CLAVE = 'ladme-recarga-por-chunk'

/**
 * Como React.lazy, pero si el archivo de la página ya no existe (pasa cuando se
 * publica una versión nueva con la app abierta) recarga una vez para traer la
 * versión vigente, en lugar de dejar la pantalla en blanco.
 */
function perezosa<T extends ComponentType<object>>(cargar: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await cargar()
      sessionStorage.removeItem(CLAVE)
      return m
    } catch (e) {
      if (esErrorDeCarga(e) && !sessionStorage.getItem(CLAVE)) {
        sessionStorage.setItem(CLAVE, '1')
        window.location.reload()
        return new Promise<{ default: T }>(() => {})
      }
      throw e
    }
  })
}

const cargadores = {
  '/reservar': () => import('../pages/Reservar'),
  '/mis-reservas': () => import('../pages/MisReservas'),
  '/credencial': () => import('../pages/Credencial'),
  '/equipo': () => import('../pages/FichaEquipo'),
  '/pc': () => import('../pages/AccionRapida'),
  '/sala': () => import('../pages/Sala'),
  '/validar': () => import('../pages/Validar'),
  '/avisos': () => import('../pages/Avisos'),
  '/cuenta': () => import('../pages/Cuenta'),
  '/reglamento': () => import('../pages/Reglamento'),
  '/mi-uso': () => import('../pages/MiUso'),
  '/clases': () => import('../pages/Clases'),
  '/admin': () => import('../pages/Admin'),
  '/mantenimiento': () => import('../pages/Mantenimiento'),
  '/usuarios': () => import('../pages/Usuarios')
} as const

export const Paginas = {
  Reservar: perezosa(cargadores['/reservar']),
  MisReservas: perezosa(cargadores['/mis-reservas']),
  Credencial: perezosa(cargadores['/credencial']),
  FichaEquipo: perezosa(cargadores['/equipo']),
  AccionRapida: perezosa(cargadores['/pc']),
  Sala: perezosa(cargadores['/sala']),
  Validar: perezosa(cargadores['/validar']),
  Avisos: perezosa(cargadores['/avisos']),
  Cuenta: perezosa(cargadores['/cuenta']),
  Reglamento: perezosa(cargadores['/reglamento']),
  MiUso: perezosa(cargadores['/mi-uso']),
  Clases: perezosa(cargadores['/clases']),
  ClaseDetalle: perezosa(() => cargadores['/clases']().then((m) => ({ default: m.ClaseDetalle }))),
  AprobarClase: perezosa(() => import('../pages/admin/AprobarClase')),
  ReservaDetalle: perezosa(() => import('../pages/admin/ReservaDetalle')),
  ConfirmarAsistencia: perezosa(() => import('../pages/ConfirmarAsistencia')),
  Admin: perezosa(cargadores['/admin']),
  Mantenimiento: perezosa(cargadores['/mantenimiento']),
  Usuarios: perezosa(cargadores['/usuarios'])
}

const precargadas = new Set<string>()

/** Descarga la página en cuanto el dedo o el cursor llega al enlace. */
export function precargar(ruta: string): void {
  const base = ('/' + ruta.split('?')[0].split('/')[1]) as keyof typeof cargadores
  if (precargadas.has(base) || !(base in cargadores)) return
  precargadas.add(base)
  void cargadores[base]().catch(() => precargadas.delete(base))
}

/** Props para cualquier enlace que convenga precargar. */
export function propsPrecarga(ruta: string) {
  return {
    onPointerEnter: () => precargar(ruta),
    onTouchStart: () => precargar(ruta),
    onFocus: () => precargar(ruta)
  }
}

const CLAVE_VOLVER = 'ladme-volver'

/** Guarda a dónde volver después de iniciar sesión (p. ej. el QR de Faro). Solo rutas internas. */
export function recordarDestino(ruta: string): void {
  if (ruta.startsWith('/') && !ruta.startsWith('//') && !ruta.startsWith('/login') && !ruta.startsWith('/auth')) {
    sessionStorage.setItem(CLAVE_VOLVER, ruta)
  }
}

/** Devuelve (y olvida) el destino guardado, o «/». */
export function tomarDestino(): string {
  const r = sessionStorage.getItem(CLAVE_VOLVER)
  sessionStorage.removeItem(CLAVE_VOLVER)
  return r && r.startsWith('/') && !r.startsWith('//') ? r : '/'
}
