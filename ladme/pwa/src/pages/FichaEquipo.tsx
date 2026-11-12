import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { obtenerEquipo, ocupacionPublica, mantenimientoDelEquipo, type EstadoMantenimientoEquipo } from '../lib/api'
import { esStaff, useAuth } from '../context/AuthContext'
import type { Equipo, Ocupacion } from '../lib/types'
import { dia, diaCorto, fecha, finDia, hora, inicioDia, sumarDias } from '../lib/format'
import PageHeader, { Cargando } from '../components/PageHeader'
import Icon from '../components/Icon'

function proximaLibertad(ocupacion: Ocupacion[]): Date {
  const ahora = new Date()
  let cursor = ahora
  const orden = ocupacion
    .filter((o) => new Date(o.fin) > ahora)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
  for (const o of orden) {
    const inicio = new Date(o.inicio)
    const fin = new Date(o.fin)
    if (fin <= cursor) continue
    if (inicio > cursor) return cursor
    cursor = fin
  }
  return cursor
}

export default function FichaEquipo() {
  const { codigo = '' } = useParams<{ codigo: string }>()
  const { perfil } = useAuth()
  const [equipo, setEquipo] = useState<Equipo | null>(null)
  const [ocupacion, setOcupacion] = useState<Ocupacion[]>([])
  const [mantenimiento, setMantenimiento] = useState<EstadoMantenimientoEquipo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    obtenerEquipo(codigo)
      .then(async (eq) => {
        if (!vivo) return
        if (!eq) {
          setError(`No existe un equipo con el código ${codigo}.`)
          return
        }
        setEquipo(eq)
        const ocs = await ocupacionPublica(eq.codigo)
        if (vivo) setOcupacion(ocs)
        if (esStaff(perfil)) {
          const mnt = await mantenimientoDelEquipo(eq.id)
          if (vivo) setMantenimiento(mnt)
        }
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar la ficha.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [codigo, perfil])

  const ahora = new Date()
  const enCurso = ocupacion.find((o) => new Date(o.inicio) <= ahora && new Date(o.fin) > ahora)
  const libre = !enCurso && equipo?.estado === 'activo'
  const proximoLibre = useMemo(() => (enCurso ? proximaLibertad(ocupacion) : new Date()), [ocupacion, enCurso])
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(inicioDia(ahora), i)), []) // eslint-disable-line react-hooks/exhaustive-deps

  if (cargando) return <Cargando texto="Cargando ficha del equipo…" />

  if (error || !equipo) {
    return (
      <>
        <PageHeader titulo="Equipo" volver={{ a: '/', texto: 'Disponibilidad' }} />
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error ?? 'Equipo no encontrado.'}</div>
        </div>
      </>
    )
  }

  const especificaciones = Object.entries(equipo.especificaciones ?? {})

  return (
    <>
      <PageHeader
        eyebrow="Equipo"
        titulo={equipo.codigo}
        sub={
          <>
            {equipo.nombre}
            {equipo.marca ? ` · ${equipo.marca}` : ''} {equipo.modelo ?? ''}
            {equipo.ubicacion ? ` · ${equipo.ubicacion}` : ''}
          </>
        }
        volver={{ a: '/', texto: 'Disponibilidad' }}
        acciones={
          equipo.estado === 'activo' ? (
            <Link className="btn" to={`/reservar?equipo=${encodeURIComponent(equipo.codigo)}`}>
              <Icon nombre="reservar" /> Reservar
            </Link>
          ) : (
            <span className="badge gray">{equipo.estado.replace('_', ' ')}</span>
          )
        }
      />

      <div className="stats">
        <div className={`stat ${libre ? 'ok' : 'warn'}`}>
          <div className="stat__label">
            <Icon nombre="monitor" width={14} height={14} /> Estado actual
          </div>
          <div className="stat__value" style={{ fontSize: '1.1rem' }}>
            {equipo.estado !== 'activo'
              ? equipo.estado.replace('_', ' ')
              : libre
                ? 'Libre'
                : 'Ocupado'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="reloj" width={14} height={14} /> Próxima disponibilidad
          </div>
          <div className="stat__value" style={{ fontSize: '1rem' }}>
            {enCurso ? (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{dia(proximoLibre.toISOString())}</span>
                <span className="muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 550 }}>
                  desde las {hora(proximoLibre.toISOString())}
                </span>
              </span>
            ) : (
              'Ahora'
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="ticket" width={14} height={14} /> Reservas
          </div>
          <div className="stat__value">{ocupacion.filter((o) => o.tipo === 'reserva').length}</div>
        </div>
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="llave" width={14} height={14} /> Bloqueos
          </div>
          <div className="stat__value">{ocupacion.filter((o) => o.tipo === 'bloqueo').length}</div>
        </div>
      </div>

      {mantenimiento && (
        <section className={`card ${mantenimiento.vencido ? 'warn' : ''}`}>
          <div className="row between">
            <h3 style={{ fontSize: 'var(--text-base)', margin: 0 }}>
              <Icon nombre="llave" width={16} height={16} /> Mantenimiento
            </h3>
            {mantenimiento.vencido && <span className="badge danger">Vencido</span>}
          </div>
          <div className="datos mt">
            <div className="datos__fila">
              <span className="datos__clave">Última intervención validada</span>
              <span className="datos__valor">
                {mantenimiento.ultimo ? fecha(mantenimiento.ultimo) : 'Sin registro'}
              </span>
            </div>
            <div className="datos__fila">
              <span className="datos__clave">Próxima</span>
              <span className="datos__valor">
                {mantenimiento.proximo ? fecha(mantenimiento.proximo) : 'Sin programar'}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <h2>Agenda de los próximos 7 días</h2>
          <span className="section-title__count">
            {ocupacion.filter((o) => new Date(o.fin) > ahora).length} ocupaciones
          </span>
        </div>

        <div className="agenda">
          {dias.map((d) => {
            const tramos = ocupacion
              .filter((o) => new Date(o.fin) > inicioDia(d) && new Date(o.inicio) < finDia(d))
              .sort((a, b) => a.inicio.localeCompare(b.inicio))
            return (
              <div key={d.toISOString()} className="agenda__dia">
                <div className="agenda__fecha">{diaCorto(d)}</div>
                <div className="agenda__tramos">
                  {tramos.length === 0 ? (
                    <span className="agenda__libre">
                      <Icon nombre="check" width={13} height={13} /> Día libre
                    </span>
                  ) : (
                    tramos.map((o, i) => (
                      <span key={`${o.inicio}-${i}`} className={`badge ${o.tipo === 'bloqueo' ? 'gray' : 'warn'}`}>
                        {hora(o.inicio)}–{hora(o.fin)}
                        {o.tipo === 'bloqueo' ? ' · bloqueo' : ''}
                      </span>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Especificaciones</h2>
        {especificaciones.length === 0 ? (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Sin especificaciones registradas.
          </p>
        ) : (
          <div className="datos">
            {especificaciones.map(([k, v]) => (
              <div key={k} className="datos__fila">
                <span className="datos__clave">{k.replace(/_/g, ' ')}</span>
                <span className="datos__valor">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
