import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarEquipos, listarOcupacion } from '../lib/api'
import type { Equipo, Ocupacion } from '../lib/types'
import { aInputFecha, fecha, finDia, hora, inicioDia, sumarDias } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import PageHeader, { Empty, Esqueleto } from '../components/PageHeader'
import Icon from '../components/Icon'

interface Tramo {
  inicio: string
  fin: string
  tipo: 'reserva' | 'bloqueo'
  motivo: string | null
}

type Filtro = 'TODOS' | 'LIBRES' | 'OCUPADOS'

function recortar(intervalos: Ocupacion[], desde: Date, hasta: Date): Tramo[] {
  return intervalos
    .filter((o) => new Date(o.fin) > desde && new Date(o.inicio) < hasta)
    .map((o) => ({
      inicio: new Date(o.inicio) < desde ? desde.toISOString() : o.inicio,
      fin: new Date(o.fin) > hasta ? hasta.toISOString() : o.fin,
      tipo: o.tipo,
      motivo: o.motivo
    }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
}

function horas(tramos: Tramo[]): number {
  return tramos.reduce((s, t) => s + (new Date(t.fin).getTime() - new Date(t.inicio).getTime()) / 3600000, 0)
}

function etiquetaDia(d: Date, hoy: Date): string {
  if (d.toDateString() === hoy.toDateString()) return 'Hoy'
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short' }).format(d).replace('.', '')
}

export default function Disponibilidad() {
  const { perfil } = useAuth()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [ocupacion, setOcupacion] = useState<Ocupacion[]>([])
  const [fechaSel, setFechaSel] = useState(aInputFecha(new Date()))
  const [equipoSel, setEquipoSel] = useState('TODOS')
  const [filtro, setFiltro] = useState<Filtro>('TODOS')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([listarEquipos(), listarOcupacion()])
      .then(([eqs, ocs]) => {
        if (!vivo) return
        setEquipos(eqs)
        setOcupacion(ocs)
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar la disponibilidad.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [])

  const dia = useMemo(() => {
    const [y, m, d] = fechaSel.split('-').map(Number)
    return y && m && d ? new Date(y, m - 1, d) : new Date()
  }, [fechaSel])

  const desde = useMemo(() => inicioDia(dia), [dia])
  const hasta = useMemo(() => finDia(dia), [dia])
  const hoy = useMemo(() => inicioDia(new Date()), [])
  const ahora = new Date()

  const porEquipo = useMemo(() => {
    const mapa = new Map<string, Ocupacion[]>()
    for (const o of ocupacion) {
      const lista = mapa.get(o.codigo) ?? []
      lista.push(o)
      mapa.set(o.codigo, lista)
    }
    return mapa
  }, [ocupacion])

  const resumen = useMemo(() => {
    let libres = 0
    let ocupados = 0
    for (const e of equipos) {
      const activo = (porEquipo.get(e.codigo) ?? []).some(
        (o) => new Date(o.inicio) <= ahora && new Date(o.fin) > ahora
      )
      if (activo) ocupados++
      else libres++
    }
    return { libres, ocupados, total: equipos.length }
  }, [equipos, porEquipo, ahora])

  const reservasDelDia = useMemo(
    () =>
      ocupacion.filter(
        (o) => o.tipo === 'reserva' && new Date(o.fin) > desde && new Date(o.inicio) < hasta
      ).length,
    [ocupacion, desde, hasta]
  )

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i)), [hoy])

  const visibles = equipos.filter((e) => {
    if (equipoSel !== 'TODOS' && e.codigo !== equipoSel) return false
    if (filtro === 'TODOS') return true
    const enCurso = (porEquipo.get(e.codigo) ?? []).some(
      (o) => new Date(o.inicio) <= ahora && new Date(o.fin) > ahora
    )
    return filtro === 'OCUPADOS' ? enCurso : !enCurso
  })

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        titulo="Disponibilidad"
        sub={
          <>
            Hola {perfil?.nombre?.split(' ')[0] || 'de nuevo'}: este es el estado del laboratorio ahora
            mismo y la agenda de los próximos días.
          </>
        }
        acciones={
          <Link className="btn" to="/reservar">
            <Icon nombre="mas2" /> Nueva reserva
          </Link>
        }
      />

      <div className="stats">
        <div className="stat ok">
          <div className="stat__label">
            <Icon nombre="check-circulo" width={14} height={14} /> Libres ahora
          </div>
          <div className="stat__value">{resumen.libres}</div>
        </div>
        <div className="stat warn">
          <div className="stat__label">
            <Icon nombre="reloj" width={14} height={14} /> Ocupados
          </div>
          <div className="stat__value">{resumen.ocupados}</div>
        </div>
        <div className="stat brand">
          <div className="stat__label">
            <Icon nombre="monitor" width={14} height={14} /> Equipos
          </div>
          <div className="stat__value">{resumen.total}</div>
        </div>
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="ticket" width={14} height={14} /> Reservas el día
          </div>
          <div className="stat__value">{reservasDelDia}</div>
        </div>
      </div>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <section className="card">
        <div className="row between" style={{ alignItems: 'flex-end', gap: 'var(--s3)' }}>
          <div style={{ minWidth: 0, flex: '1 1 340px' }}>
            <span className="field__label">Próximos 7 días</span>
            <div
              className="row"
              style={{ flexWrap: 'nowrap', gap: 'var(--s1)', overflowX: 'auto', paddingBottom: 2 }}
              role="group"
              aria-label="Elegir día"
            >
              {dias.map((d) => (
                <button
                  key={d.toISOString()}
                  className="dia-chip"
                  aria-pressed={aInputFecha(d) === fechaSel}
                  onClick={() => setFechaSel(aInputFecha(d))}
                  type="button"
                >
                  <span>{etiquetaDia(d, hoy)}</span>
                  <strong>{d.getDate()}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 'var(--s2)', alignItems: 'flex-end' }}>
            <div className="field">
              <label className="field__label" htmlFor="fecha">
                Otro día
              </label>
              <input
                id="fecha"
                type="date"
                value={fechaSel}
                onChange={(e) => setFechaSel(e.target.value)}
                style={{ width: 'auto' }}
              />
            </div>
            <button className="btn gray sm" onClick={() => setFechaSel(aInputFecha(new Date()))} type="button">
              Hoy
            </button>
          </div>
        </div>

        <div className="row between mt" style={{ gap: 'var(--s3)' }}>
          <div className="segmented" role="group" aria-label="Filtrar por estado">
            <button className={filtro === 'TODOS' ? 'activo' : ''} onClick={() => setFiltro('TODOS')} type="button">
              Todos
            </button>
            <button className={filtro === 'LIBRES' ? 'activo' : ''} onClick={() => setFiltro('LIBRES')} type="button">
              Libres
            </button>
            <button
              className={filtro === 'OCUPADOS' ? 'activo' : ''}
              onClick={() => setFiltro('OCUPADOS')}
              type="button"
            >
              Ocupados
            </button>
          </div>

          <div className="field" style={{ minWidth: 200, flex: '1 1 200px', maxWidth: 320 }}>
            <label className="solo-lector" htmlFor="equipo-filtro">
              Filtrar por equipo
            </label>
            <select id="equipo-filtro" value={equipoSel} onChange={(e) => setEquipoSel(e.target.value)}>
              <option value="TODOS">Todos los equipos</option>
              {equipos.map((e) => (
                <option key={e.id} value={e.codigo}>
                  {e.codigo} · {e.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {cargando && (
        <div className="grid cols-2">
          <Esqueleto />
          <Esqueleto />
        </div>
      )}

      {!cargando && !error && visibles.length === 0 && (
        <div className="card">
          <Empty
            icono="monitor"
            titulo="Sin equipos con ese filtro"
            accion={
              <button
                className="btn ghost sm"
                type="button"
                onClick={() => {
                  setFiltro('TODOS')
                  setEquipoSel('TODOS')
                }}
              >
                Limpiar filtros
              </button>
            }
          >
            Pruebe con otro estado o consulte todos los equipos del laboratorio.
          </Empty>
        </div>
      )}

      {!cargando && !error && visibles.length > 0 && (
        <div className="grid cols-2">
          {visibles.map((e) => {
            const intervalos = porEquipo.get(e.codigo) ?? []
            const tramos = recortar(intervalos, desde, hasta)
            const enCurso = intervalos.find((o) => new Date(o.inicio) <= ahora && new Date(o.fin) > ahora)
            const proximo = intervalos
              .filter((o) => new Date(o.inicio) > ahora)
              .sort((a, b) => a.inicio.localeCompare(b.inicio))[0]

            return (
              <article
                key={e.id}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}
              >
                <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row tight">
                      <Link
                        to={`/equipo/${e.codigo}`}
                        style={{ fontSize: 'var(--text-lg)', fontWeight: 700, letterSpacing: '-0.01em' }}
                      >
                        {e.codigo}
                      </Link>
                      {e.estado !== 'activo' ? (
                        <span className="badge gray">{e.estado.replace('_', ' ')}</span>
                      ) : (
                        <span className={`badge ${enCurso ? 'danger' : 'ok'}`}>
                          <span className="punto" />
                          {enCurso ? `Ocupado hasta ${hora(enCurso.fin)}` : 'Libre ahora'}
                        </span>
                      )}
                    </div>
                    <p className="small muted" style={{ margin: 0 }}>
                      {e.nombre}
                      {e.ubicacion ? ` · ${e.ubicacion}` : ''}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="tiny muted" style={{ marginBottom: 4 }}>
                    Próximos 7 días
                  </div>
                  <div className="semana">
                    {dias.map((d) => {
                      const h = horas(recortar(intervalos, inicioDia(d), finDia(d)))
                      const nivel = Math.min(100, Math.round((h / 24) * 100))
                      const clase = h >= 8 ? 'alto' : h > 0 ? 'medio' : ''
                      return (
                        <div
                          key={d.toISOString()}
                          className="semana__dia"
                          title={`${etiquetaDia(d, hoy)} ${d.getDate()}: ${h.toFixed(1)} h ocupadas`}
                        >
                          <span>{etiquetaDia(d, hoy)}</span>
                          <span className={`semana__barra ${clase}`} style={{ ['--nivel' as string]: `${nivel}%` }} />
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  {tramos.length === 0 ? (
                    <p className="tiny muted" style={{ margin: 0 }}>
                      <Icon nombre="check" width={13} height={13} /> Sin ocupación registrada ese día.
                    </p>
                  ) : (
                    <div className="row tight" style={{ gap: 6 }}>
                      {tramos.slice(0, 3).map((t, i) => (
                        <span key={`${t.inicio}-${i}`} className={`badge ${t.tipo === 'bloqueo' ? 'gray' : 'warn'}`}>
                          {hora(t.inicio)}–{hora(t.fin)}
                          {t.tipo === 'bloqueo' ? ' · bloqueo' : ''}
                        </span>
                      ))}
                      {tramos.length > 3 && <span className="badge outline">+{tramos.length - 3} más</span>}
                    </div>
                  )}
                </div>

                <div className="row" style={{ gap: 'var(--s2)' }}>
                  <Link className="btn sm" to={`/reservar?equipo=${encodeURIComponent(e.codigo)}`}>
                    Reservar
                  </Link>
                  <Link className="btn ghost sm" to={`/equipo/${e.codigo}`}>
                    Ver ficha
                  </Link>
                  {proximo && (
                    <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                      Próxima: {fecha(proximo.inicio)}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
