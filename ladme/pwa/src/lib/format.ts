export const MAX_HORAS_RESERVA = 168
export const MAX_HORAS_EXTENSION = 24
export const MAX_HORAS_TOTAL = 192
export const EXTENSIONES_MAX = 1

const fmt = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })

export function fecha(iso: string): string {
  return fmt.format(new Date(iso))
}

export function dia(iso: string): string {
  return fmtDia.format(new Date(iso))
}

export function rango(inicio: string, fin: string): string {
  return `${fecha(inicio)} → ${fecha(fin)}`
}

export function horasEntre(inicio: string, fin: string): number {
  return (new Date(fin).getTime() - new Date(inicio).getTime()) / 3600000
}

/** Valor para <input type="datetime-local"> en hora local (no UTC). */
export function aInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Convierte el valor de un input local a ISO con zona horaria. */
export function aIso(valor: string): string {
  return new Date(valor).toISOString()
}

export function sumarHoras(iso: string, horas: number): string {
  return new Date(new Date(iso).getTime() + horas * 3600000).toISOString()
}

export function esFuturo(iso: string): boolean {
  return new Date(iso).getTime() > Date.now()
}

export function esPasado(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now()
}

export function estadoReserva(r: { estado: string; estado_vigente?: string; inicio: string; fin: string }): string {
  if (r.estado === 'cancelada') return 'Cancelada'
  if (r.estado_vigente === 'finalizada' || r.estado_vigente === 'liberada' || esPasado(r.fin)) return 'Finalizada'
  if (r.estado_vigente === 'en_curso') return 'En curso'
  if (r.estado_vigente === 'sin_llegada') return 'Sin registrar llegada'
  if (esFuturo(r.inicio)) return 'Programada'
  return 'Activa'
}

export function nuevoIdSolicitud(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** Inicio del día local. */
export function inicioDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Fin del día local (23:59:59.999). */
export function finDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export function sumarDias(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

/** Valor para <input type="date"> en hora local. */
export function aInputFecha(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function fechaLarga(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d)
}

/** Texto relativo sencillo, sin dependencias. */
export function hace(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(Math.abs(ms) / 60000)
  const futuro = ms < 0
  if (min < 1) return 'ahora'
  if (min < 60) return futuro ? `en ${min} min` : `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return futuro ? `en ${h} h` : `hace ${h} h`
  const d = Math.round(h / 24)
  return futuro ? `en ${d} d` : `hace ${d} d`
}
