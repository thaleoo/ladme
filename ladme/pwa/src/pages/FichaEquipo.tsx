import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { obtenerEquipo, ocupacionPublica, mantenimientoDelEquipo, type EstadoMantenimientoEquipo } from '../lib/api'
import { esStaff, useAuth } from '../context/AuthContext'
import type { Equipo, Ocupacion } from '../lib/types'
import { fecha, fechaLarga, finDia, hora, inicioDia, sumarDias } from '../lib/format'

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

  if (cargando) return <div className="card center muted">Cargando ficha del equipo…</div>
  if (error || !equipo) return <div className="alert danger">{error ?? 'Equipo no encontrado.'}</div>

  const especificaciones = Object.entries(equipo.especificaciones ?? {})

  return (
    <>
      <div className={`card ${libre ? 'ok' : 'warn'}`}>
        <div className="row between">
          <div>
            <h2>{equipo.codigo}</h2>
            <p className="mb-0">{equipo.nombre} {equipo.marca ? `· ${equipo.marca}` : ''} {equipo.modelo ?? ''}</p>
            <p className="small muted mb-0">{equipo.ubicacion || 'LADME'}</p>
          </div>
          <span className={`badge ${libre ? 'ok' : 'danger'}`}>
            {equipo.estado !== 'activo' ? equipo.estado.replace('_', ' ') : libre ? 'Libre ahora' : `Ocupado hasta ${hora(enCurso!.fin)}`}
          </span>
        </div>

        <div className="grid cols-3 mt">
          <div className="card mb-0">
            <div className="tiny muted">Próxima disponibilidad</div>
            <strong>{enCurso ? fecha(proximoLibre.toISOString()) : 'Ahora'}</strong>
          </div>
          <div className="card mb-0">
            <div className="tiny muted">Reservas activas</div>
            <strong>{ocupacion.filter((o) => o.tipo === 'reserva').length}</strong>
          </div>
          <div className="card mb-0">
            <div className="tiny muted">Bloqueos de gestión</div>
            <strong>{ocupacion.filter((o) => o.tipo === 'bloqueo').length}</strong>
          </div>
        </div>

        <div className="row mt">
          {equipo.estado === 'activo' ? (
            <Link className="btn" to={`/reservar?equipo=${encodeURIComponent(equipo.codigo)}`}>Reservar este equipo</Link>
          ) : (
            <span className="alert warn mb-0">El equipo no está operativo; no admite reservas.</span>
          )}
          <Link className="btn ghost" to="/">Volver a disponibilidad</Link>
        </div>
      </div>

      {mantenimiento && (
        <div className={`card ${mantenimiento.vencido ? 'warn' : ''}`}>
          <h4>Mantenimiento</h4>
          <p className="small mb-0">
            Última intervención validada: <strong>{mantenimiento.ultimo ?? 'sin registro'}</strong>
            <br />
            Próxima: <strong>{mantenimiento.proximo ?? 'sin programar'}</strong>
            {mantenimiento.vencido && <span className="badge danger" style={{ marginLeft: 8 }}>vencido</span>}
          </p>
        </div>
      )}

      <div className="card">
        <h3>Agenda de los próximos 7 días</h3>
        {dias.map((d) => {
          const tramos = ocupacion
            .filter((o) => new Date(o.fin) > inicioDia(d) && new Date(o.inicio) < finDia(d))
            .sort((a, b) => a.inicio.localeCompare(b.inicio))
          return (
            <div key={d.toISOString()} className="mt">
              <div className="row between">
                <strong className="small">{fechaLarga(d)}</strong>
                {tramos.length === 0 ? <span className="badge ok">Libre</span> : <span className="badge warn">{tramos.length} ocupación(es)</span>}
              </div>
              {tramos.length > 0 && (
                <ul className="list">
                  {tramos.map((o, i) => (
                    <li key={`${o.inicio}-${i}`}>
                      <span>
                        <span className={`badge ${o.tipo === 'bloqueo' ? 'gray' : 'warn'}`}>
                          {o.tipo === 'bloqueo' ? 'Bloqueo' : 'Reserva'}
                        </span>{' '}
                        {hora(o.inicio)}–{hora(o.fin)}
                        {o.motivo && <span className="tiny muted"> · {o.motivo}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {(especificaciones.length > 0 || equipo.especificaciones) && (
        <div className="card">
          <h4>Especificaciones</h4>
          {especificaciones.length === 0 ? (
            <p className="muted small mb-0">Sin especificaciones registradas.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {especificaciones.map(([k, v]) => (
                    <tr key={k}>
                      <th>{k.replace(/_/g, ' ')}</th>
                      <td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
