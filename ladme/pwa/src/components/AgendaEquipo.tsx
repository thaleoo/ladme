import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Ocupacion } from '../lib/types'
import { aInputLocal, diaCorto, duracion, hora, inicioDia, sumarDias } from '../lib/format'
import { useLimites } from '../lib/politicas'
import Icon from './Icon'

/**
 * Agenda de un equipo por día o por semana: en qué rangos está libre y en cuáles ocupado.
 * Solo muestra horarios (nunca quién reservó). Un rango libre lleva directo al formulario de reserva
 * con el equipo y las horas ya puestos.
 */

type Tramo = { tipo: 'libre' | 'reserva' | 'bloqueo'; inicio: Date; fin: Date; motivo?: string | null }

const MIN_LIBRE_MS = 15 * 60_000

/** Redondea hacia arriba al siguiente cuarto de hora. */
function siguienteCuarto(d: Date): Date {
  const ms = 15 * 60_000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

/** Tramos de un día [d0, d0+1d): ocupaciones recortadas y unidas, y los huecos libres entre ellas. */
function tramosDelDia(ocupacion: Ocupacion[], d0: Date, ahora: Date): Tramo[] {
  const d1 = sumarDias(d0, 1)
  const desde = new Date(Math.max(d0.getTime(), siguienteCuarto(ahora).getTime()))
  const ocupados: Tramo[] = ocupacion
    .map((o) => ({ tipo: o.tipo, inicio: new Date(o.inicio), fin: new Date(o.fin), motivo: o.motivo }))
    .filter((o) => o.fin > d0 && o.inicio < d1)
    .map((o) => ({ ...o, inicio: o.inicio < d0 ? d0 : o.inicio, fin: o.fin > d1 ? d1 : o.fin }))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())

  // Une ocupaciones que se tocan o se solapan (del mismo tipo).
  const unidos: Tramo[] = []
  for (const o of ocupados) {
    const u = unidos[unidos.length - 1]
    if (u && u.tipo === o.tipo && o.inicio <= u.fin) u.fin = o.fin > u.fin ? o.fin : u.fin
    else unidos.push({ ...o })
  }

  const salida: Tramo[] = []
  let cursor = desde
  for (const o of unidos) {
    if (o.fin <= desde) continue
    if (o.inicio.getTime() - cursor.getTime() >= MIN_LIBRE_MS) salida.push({ tipo: 'libre', inicio: cursor, fin: o.inicio })
    salida.push({ ...o, inicio: o.inicio < desde ? desde : o.inicio })
    if (o.fin > cursor) cursor = o.fin
  }
  if (d1.getTime() - cursor.getTime() >= MIN_LIBRE_MS) salida.push({ tipo: 'libre', inicio: cursor, fin: d1 })
  return salida
}

function textoHora(d: Date, d0: Date): string {
  // La medianoche del día siguiente se muestra como «24:00», que se entiende mejor que «12:00 a. m.».
  if (d.getTime() === sumarDias(d0, 1).getTime()) return 'medianoche'
  return hora(d.toISOString())
}

const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
const fechaLarga = (d: Date) => fmtDia.format(d)
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function pct(d: Date, d0: Date): number {
  return Math.min(100, Math.max(0, ((d.getTime() - d0.getTime()) / 86_400_000) * 100))
}

/** Barra de 24 h con los tramos ocupados y la hora actual. */
function Pista({ tramos, d0, ahora, marcas }: { tramos: Tramo[]; d0: Date; ahora: Date; marcas?: boolean }) {
  const hoy = inicioDia(ahora).getTime() === d0.getTime()
  return (
    <div className="ag-pista" aria-hidden="true">
      {hoy && <span className="ag-pasado" style={{ width: `${pct(ahora, d0)}%` }} />}
      {tramos
        .filter((t) => t.tipo !== 'libre')
        .map((t, i) => (
          <span
            key={i}
            className={`ag-bloque ag-${t.tipo}`}
            style={{ left: `${pct(t.inicio, d0)}%`, width: `${Math.max(0.6, pct(t.fin, d0) - pct(t.inicio, d0))}%` }}
          />
        ))}
      {hoy && <span className="ag-ahora" style={{ left: `${pct(ahora, d0)}%` }} />}
      {marcas && [6, 12, 18].map((h) => <span key={h} className="ag-marca" style={{ left: `${(h / 24) * 100}%` }} />)}
    </div>
  )
}

export default function AgendaEquipo({
  codigo,
  ocupacion,
  fueraDeServicio
}: {
  codigo: string
  ocupacion: Ocupacion[]
  fueraDeServicio?: boolean
}) {
  const lim = useLimites()
  const [vista, setVista] = useState<'semana' | 'dia'>('semana')
  const [desplazamiento, setDesplazamiento] = useState(0) // días desde hoy
  const ahora = useMemo(() => new Date(), [ocupacion]) // eslint-disable-line react-hooks/exhaustive-deps
  const hoy = inicioDia(ahora)
  const ultimoDia = Math.max(0, lim.anticipacionDias)
  const paso = vista === 'semana' ? 7 : 1
  const primero = sumarDias(hoy, desplazamiento)
  const dias = Array.from({ length: vista === 'semana' ? 7 : 1 }, (_, i) => sumarDias(primero, i)).filter(
    (d) => d.getTime() <= sumarDias(hoy, ultimoDia).getTime()
  )
  const limiteReserva = sumarDias(hoy, ultimoDia + 1)

  const enlace = (t: Tramo) => {
    const fin = new Date(Math.min(t.fin.getTime(), t.inicio.getTime() + lim.maxHoras * 3_600_000))
    const q = new URLSearchParams({ equipo: codigo, inicio: aInputLocal(t.inicio), fin: aInputLocal(fin) })
    return `/reservar?${q.toString()}`
  }

  if (fueraDeServicio) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Este equipo está fuera de servicio y no se puede reservar por ahora.
      </p>
    )
  }

  return (
    <div className="ag">
      <div className="ag-barra">
        <div className="segmented" role="tablist" aria-label="Vista de la agenda">
          <button role="tab" aria-selected={vista === 'dia'} className={vista === 'dia' ? 'activo' : ''} onClick={() => setVista('dia')}>
            Día
          </button>
          <button
            role="tab"
            aria-selected={vista === 'semana'}
            className={vista === 'semana' ? 'activo' : ''}
            onClick={() => setVista('semana')}
          >
            Semana
          </button>
        </div>
        <div className="ag-nav">
          <button
            className="btn ghost sm"
            aria-label="Anterior"
            disabled={desplazamiento <= 0}
            onClick={() => setDesplazamiento((n) => Math.max(0, n - paso))}
          >
            ‹
          </button>
          <button className="btn ghost sm" disabled={desplazamiento === 0} onClick={() => setDesplazamiento(0)}>
            Hoy
          </button>
          <button
            className="btn ghost sm"
            aria-label="Siguiente"
            disabled={desplazamiento + paso > ultimoDia}
            onClick={() => setDesplazamiento((n) => Math.min(ultimoDia, n + paso))}
          >
            ›
          </button>
        </div>
      </div>

      {vista === 'semana' ? (
        <div className="ag-semana">
          <div className="ag-escala" aria-hidden="true">
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
          {dias.map((d) => {
            const tramos = tramosDelDia(ocupacion, d, ahora)
            const libres = tramos.filter((t) => t.tipo === 'libre')
            const resumen =
              libres.length === 0
                ? 'Sin horas libres'
                : libres.length === 1 && libres[0].inicio.getTime() <= Math.max(d.getTime(), siguienteCuarto(ahora).getTime()) &&
                    libres[0].fin.getTime() === sumarDias(d, 1).getTime()
                  ? d.getTime() === hoy.getTime()
                    ? 'Libre el resto del día'
                    : 'Libre todo el día'
                  : 'Libre ' +
                    libres
                      .slice(0, 2)
                      .map((t) => `${textoHora(t.inicio, d)}–${textoHora(t.fin, d)}`)
                      .join(', ') +
                    (libres.length > 2 ? ` y ${libres.length - 2} más` : '')
            return (
              <button
                key={d.toISOString()}
                className="ag-fila"
                onClick={() => {
                  setDesplazamiento(Math.round((d.getTime() - hoy.getTime()) / 86_400_000))
                  setVista('dia')
                }}
              >
                <span className="ag-fecha">{d.getTime() === hoy.getTime() ? 'Hoy' : diaCorto(d)}</span>
                <span className="ag-cuerpo">
                  <Pista tramos={tramos} d0={d} ahora={ahora} marcas />
                  <span className={`ag-resumen ${libres.length ? 'libre' : ''}`}>{resumen}</span>
                </span>
              </button>
            )
          })}
          <div className="ag-leyenda" aria-hidden="true">
            <span><i className="ag-libre" /> Libre</span>
            <span><i className="ag-reserva" /> Reservado</span>
            <span><i className="ag-bloqueo" /> Bloqueado</span>
          </div>
        </div>
      ) : (
        dias.map((d) => {
          const tramos = tramosDelDia(ocupacion, d, ahora)
          return (
            <div key={d.toISOString()} className="ag-dia">
              <h3 className="ag-titulo">{d.getTime() === hoy.getTime() ? `Hoy · ${fechaLarga(d)}` : mayuscula(fechaLarga(d))}</h3>
              <Pista tramos={tramos} d0={d} ahora={ahora} marcas />
              <div className="ag-escala" aria-hidden="true">
                <span>0</span>
                <span>6</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>
              {tramos.length === 0 ? (
                <p className="small muted">El día ya terminó.</p>
              ) : (
                <ul className="ag-lista">
                  {tramos.map((t, i) => (
                    <li key={i} className={`ag-tramo ag-${t.tipo}`}>
                      <span className="ag-info">
                      <span className="ag-horas">
                        {textoHora(t.inicio, d)} – {textoHora(t.fin, d)}
                      </span>
                      <span className="ag-que">
                        {t.tipo === 'libre' ? (
                          <>
                            <strong>Libre</strong> · {duracion(t.inicio.toISOString(), t.fin.toISOString())}
                          </>
                        ) : t.tipo === 'reserva' ? (
                          <strong>Reservado</strong>
                        ) : (
                          <>
                            <strong>Bloqueado</strong>
                            {t.motivo ? ` · ${t.motivo}` : ''}
                          </>
                        )}
                      </span>
                      </span>
                      {t.tipo === 'libre' && t.inicio < limiteReserva && (
                        <Link className="btn sm" to={enlace(t)}>
                          <Icon nombre="reservar" width={14} height={14} /> Reservar
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
