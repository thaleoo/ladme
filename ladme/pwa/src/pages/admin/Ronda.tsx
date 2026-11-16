import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarEquipos, listarReservasAdmin } from '../../lib/api'
import type { Equipo, Reserva } from '../../lib/types'
import { fecha, hace } from '../../lib/format'
import { useLimites } from '../../lib/politicas'
import { esAdmin, useAuth } from '../../context/AuthContext'
import { Cargando } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import AccionesReserva, { type Accion } from './AccionesReserva'

/** Vista de ronda: qué pasa ahora mismo en cada equipo. */
export default function Ronda() {
  const { perfil } = useAuth()
  const lim = useLimites()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)

  const cargar = useCallback(async () => {
    try {
      const ahora = new Date()
      const [eqs, res] = await Promise.all([
        listarEquipos(),
        listarReservasAdmin(ahora.toISOString(), new Date(ahora.getTime() + 30 * 86400000).toISOString())
      ])
      setEquipos(eqs)
      setReservas(res.filter((r) => r.estado === 'activa'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la ronda.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
    const t = window.setInterval(() => document.visibilityState === 'visible' && void cargar(), 60000)
    return () => window.clearInterval(t)
  }, [cargar])

  const filas = useMemo(() => {
    const ahora = Date.now()
    return equipos.map((e) => {
      const propias = reservas.filter((r) => r.equipo_id === e.id)
      const actual = propias.find((r) => new Date(r.inicio).getTime() <= ahora && new Date(r.fin).getTime() > ahora)
      const proxima = propias
        .filter((r) => new Date(r.inicio).getTime() > ahora)
        .sort((a, b) => a.inicio.localeCompare(b.inicio))[0]
      const sinLlegada =
        !!actual && actual.tipo === 'reserva' && !actual.llegada_en &&
        ahora > new Date(actual.inicio).getTime() + lim.toleranciaMin * 60000
      return { e, actual, proxima, sinLlegada }
    })
  }, [equipos, reservas, lim.toleranciaMin])

  const enUso = filas.filter((f) => f.actual?.tipo === 'reserva').length
  const ausentes = filas.filter((f) => f.sinLlegada).length

  if (cargando) return <Cargando texto="Cargando ronda…" />

  return (
    <>
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <div className="stats">
        <div className="stat ok">
          <div className="stat__label">Libres ahora</div>
          <div className="stat__value">{filas.filter((f) => !f.actual && f.e.estado === 'activo').length}</div>
        </div>
        <div className="stat brand">
          <div className="stat__label">En uso</div>
          <div className="stat__value">{enUso}</div>
        </div>
        <div className={`stat ${ausentes ? 'warn' : ''}`}>
          <div className="stat__label">Sin llegada</div>
          <div className="stat__value">{ausentes}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Bloqueados o fuera de servicio</div>
          <div className="stat__value">{filas.filter((f) => f.actual?.tipo === 'bloqueo' || f.e.estado !== 'activo').length}</div>
        </div>
      </div>

      <div className="grid" style={{ gap: 'var(--s2)' }}>
        {filas.map(({ e, actual, proxima, sinLlegada }) => (
          <article key={e.id} className="ronda">
            <div className="ronda__equipo">
              <Link to={`/equipo/${e.codigo}`}>{e.codigo}</Link>
              <span className="tiny muted">{e.nombre}</span>
            </div>
            <div className="ronda__estado">
              {e.estado !== 'activo' ? (
                <span className="badge gray">{e.estado.replace(/_/g, ' ')}</span>
              ) : !actual ? (
                <span className="badge ok">
                  <span className="punto" /> Libre
                </span>
              ) : actual.tipo === 'bloqueo' ? (
                <span className="badge gray">Bloqueado</span>
              ) : sinLlegada ? (
                <span className="badge warn">Sin llegada</span>
              ) : (
                <span className="badge info">En uso</span>
              )}
            </div>
            <div className="ronda__detalle">
              {actual?.tipo === 'reserva' && (
                <>
                  <strong>{actual.perfiles?.nombre}</strong>
                  <span className="tiny muted" style={{ wordBreak: 'break-all' }}>
                    {actual.perfiles?.correo} · {actual.actividad ?? 'Sin actividad'}
                  </span>
                  <span className="tiny">
                    Hasta {fecha(actual.fin)}
                    {actual.llegada_en ? ` · llegó ${hace(actual.llegada_en)}` : ''}
                  </span>
                  {actual.desatendido && (
                    <span className="tiny">
                      <span className="badge warn">Desatendido</span> {actual.mensaje_llegada}
                    </span>
                  )}
                </>
              )}
              {actual?.tipo === 'bloqueo' && (
                <span className="tiny">
                  {actual.motivo} · hasta {fecha(actual.fin)}
                </span>
              )}
              {!actual && <span className="tiny muted">{proxima ? `Próxima: ${fecha(proxima.inicio)}` : 'Sin reservas próximas'}</span>}
              {actual && proxima && <span className="tiny muted">Luego: {fecha(proxima.inicio)}</span>}
            </div>
            <div className="ronda__acciones">
              {actual?.tipo === 'reserva' && (
                <>
                  {!actual.llegada_en && (
                    <button className="btn ok sm" type="button" onClick={() => setAccion({ tipo: 'llegada', reserva: actual })}>
                      Llegó
                    </button>
                  )}
                  <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'liberar', reserva: actual })}>
                    Liberar
                  </button>
                  <button className="btn danger sm" type="button" onClick={() => setAccion({ tipo: 'cancelar', reserva: actual })}>
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      <AccionesReserva accion={accion} admin={esAdmin(perfil)} alCerrar={() => setAccion(null)} alTerminar={cargar} />
    </>
  )
}
