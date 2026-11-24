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

  const grupos = useMemo(() => {
    const atencion = filas.filter((f) => f.sinLlegada)
    const enUso = filas.filter((f) => f.actual?.tipo === 'reserva' && !f.sinLlegada)
    const fuera = filas.filter((f) => f.e.estado !== 'activo' || f.actual?.tipo === 'bloqueo')
    const libres = filas.filter((f) => !f.actual && f.e.estado === 'activo')
    return { atencion, enUso, fuera, libres }
  }, [filas])

  if (cargando) return <Cargando texto="Cargando ronda…" />

  const resumen: [number, string, string][] = [
    [grupos.libres.length, grupos.libres.length === 1 ? 'libre' : 'libres', 'libre'],
    [grupos.enUso.length + grupos.atencion.length, 'en uso', 'ocupado'],
    [grupos.atencion.length, 'sin llegada', 'alerta'],
    [grupos.fuera.length, 'fuera de servicio', 'inactivo']
  ]

  function Fila({ e, actual, proxima, sinLlegada }: (typeof filas)[number]) {
    const tono = e.estado !== 'activo' ? 'inactivo' : actual?.tipo === 'bloqueo' ? 'bloqueado' : sinLlegada ? 'alerta' : 'ocupado'
    const reserva = actual?.tipo === 'reserva' ? actual : null
    return (
      <article className={`ronda-fila ${reserva ? 'abrible' : ''}`}>
        <span className={`punto-estado ${tono}`} aria-hidden="true" />
        <div className="ronda-fila__texto">
          <p className="ronda-fila__titulo">
            <Link to={`/equipo/${e.codigo}`} className="ronda-fila__codigo">{e.codigo}</Link>
            {reserva && (
              <Link className="ronda-fila__abrir" to={`/admin/reservas/${reserva.id}`}>
                {reserva.perfiles?.nombre ?? 'Sin titular'}
                <span className="solo-lector"> · ver detalle de la reserva</span>
              </Link>
            )}
          </p>
          {reserva && (
            <p className="ronda-fila__meta">
              {sinLlegada ? 'No ha registrado llegada' : reserva.llegada_en ? `Llegó ${hace(reserva.llegada_en)}` : 'Aún en tolerancia'}
              {' · hasta '}{fecha(reserva.fin)}
              {reserva.actividad ? ` · ${reserva.actividad}` : ''}
            </p>
          )}
          {reserva?.desatendido && <p className="ronda-fila__nota">Desatendido{reserva.mensaje_llegada ? `: «${reserva.mensaje_llegada}»` : ''}</p>}
          {actual?.tipo === 'bloqueo' && <p className="ronda-fila__meta">{actual.motivo} · hasta {fecha(actual.fin)}</p>}
          {e.estado !== 'activo' && !actual && <p className="ronda-fila__meta">{e.estado === 'mantenimiento' ? 'En mantenimiento' : e.estado.replace(/_/g, ' ')}</p>}
          {proxima && <p className="ronda-fila__meta">Después: {fecha(proxima.inicio)}</p>}
        </div>
        {reserva && (
          <div className="ronda-fila__acciones">
            {!reserva.llegada_en && (
              <button className="btn sm" type="button" onClick={() => setAccion({ tipo: 'llegada', reserva })}>
                Llegó
              </button>
            )}
            <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'liberar', reserva })}>
              Liberar
            </button>
            <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'cancelar', reserva })}>
              Cancelar
            </button>
          </div>
        )}
      </article>
    )
  }

  return (
    <>
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <div className="ronda-resumen" role="list" aria-label="Resumen de la sala">
        {resumen.map(([n, texto, tono]) => (
          <div key={texto} role="listitem" className={`ronda-resumen__dato ${tono === 'alerta' && n === 0 ? 'cero' : ''}`}>
            <span className="ronda-resumen__n">{n}</span>
            <span className="ronda-resumen__t"><span className={`punto-estado ${tono}`} aria-hidden="true" />{texto}</span>
          </div>
        ))}
      </div>

      {grupos.atencion.length > 0 && (
        <section className="ronda-grupo">
          <h2 className="ronda-grupo__titulo">Sin registrar llegada</h2>
          <p className="ronda-grupo__sub">Pasó la tolerancia de {lim.toleranciaMin} min. Confirme si la persona está o libere el equipo.</p>
          {grupos.atencion.map((f) => <Fila key={f.e.id} {...f} />)}
        </section>
      )}

      <section className="ronda-grupo">
        <h2 className="ronda-grupo__titulo">En uso</h2>
        {grupos.enUso.length === 0 ? <p className="ronda-grupo__sub">Nadie está usando un equipo en este momento.</p> : grupos.enUso.map((f) => <Fila key={f.e.id} {...f} />)}
      </section>

      {grupos.fuera.length > 0 && (
        <section className="ronda-grupo">
          <h2 className="ronda-grupo__titulo">Bloqueados o fuera de servicio</h2>
          {grupos.fuera.map((f) => <Fila key={f.e.id} {...f} />)}
        </section>
      )}

      {grupos.libres.length > 0 && (
        <section className="ronda-grupo">
          <h2 className="ronda-grupo__titulo">Libres</h2>
          <div className="ronda-libres">
            {grupos.libres.map(({ e, proxima }) => (
              <Link key={e.id} to={`/equipo/${e.codigo}`} className="ronda-libre">
                <strong>{e.codigo}</strong>
                <span>{proxima ? `Reservado ${fecha(proxima.inicio)}` : 'Sin reservas próximas'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <AccionesReserva accion={accion} admin={esAdmin(perfil)} alCerrar={() => setAccion(null)} alTerminar={cargar} />
    </>
  )
}
