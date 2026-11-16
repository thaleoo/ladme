import { useCallback, useEffect, useMemo, useState } from 'react'
import { listarReservasAdmin } from '../../lib/api'
import type { Reserva } from '../../lib/types'
import { aInputFecha, duracion, estadoReserva, fecha, sumarDias, tonoEstado } from '../../lib/format'
import { descargarCSV } from '../../lib/csv'
import { useLimites } from '../../lib/politicas'
import { esAdmin, useAuth } from '../../context/AuthContext'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import AccionesReserva, { type Accion } from './AccionesReserva'

const ESTADOS = ['Todas', 'Vigentes', 'En curso', 'Programada', 'Sin registrar llegada', 'Finalizada', 'Cancelada']

export default function ReservasAdmin() {
  const { perfil } = useAuth()
  const lim = useLimites()
  const [desde, setDesde] = useState(aInputFecha(sumarDias(new Date(), -7)))
  const [hasta, setHasta] = useState(aInputFecha(sumarDias(new Date(), 30)))
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('Vigentes')
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const lista = await listarReservasAdmin(new Date(`${desde}T00:00`).toISOString(), new Date(`${hasta}T23:59:59`).toISOString())
      setReservas(lista.filter((r) => r.tipo === 'reserva'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las reservas.')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase()
    return reservas
      .map((r) => ({ r, est: estadoReserva(r, lim.toleranciaMin) }))
      .filter(({ r, est }) => {
        if (estado === 'Vigentes' ? est === 'Finalizada' || est === 'Cancelada' : estado !== 'Todas' && est !== estado) return false
        if (!q) return true
        return [r.perfiles?.nombre, r.perfiles?.correo, r.equipos?.codigo, r.codigo_legible, r.actividad, r.programa]
          .some((v) => v?.toLowerCase().includes(q))
      })
  }, [reservas, texto, estado, lim.toleranciaMin])

  function exportar() {
    descargarCSV(
      `reservas-ladme-${desde}-a-${hasta}.csv`,
      ['Código', 'Equipo', 'Titular', 'Correo', 'Programa', 'Matrícula', 'Actividad', 'Detalle', 'Inicio', 'Fin', 'Horas', 'Estado', 'Llegada', 'Extensiones', 'Motivo de cancelación'],
      filtradas.map(({ r, est }) => [
        r.codigo_legible, r.equipos?.codigo, r.perfiles?.nombre, r.perfiles?.correo, r.programa, r.matricula, r.actividad, r.detalle,
        fecha(r.inicio), fecha(r.fin), ((new Date(r.fin).getTime() - new Date(r.inicio).getTime()) / 3600000).toFixed(1),
        est, r.llegada_en ? fecha(r.llegada_en) : '', r.extensiones, r.estado === 'cancelada' ? r.motivo : ''
      ])
    )
  }

  return (
    <>
      <section className="card">
        <div className="row" style={{ gap: 'var(--s3)', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 200px' }}>
            <label className="field__label" htmlFor="ra-buscar">
              Buscar
            </label>
            <input id="ra-buscar" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, correo, equipo o código" />
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label className="field__label" htmlFor="ra-estado">
              Estado
            </label>
            <select id="ra-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
              {ESTADOS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="ra-desde">
              Desde
            </label>
            <input id="ra-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="ra-hasta">
              Hasta
            </label>
            <input id="ra-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <button className="btn ghost" type="button" onClick={exportar} disabled={!filtradas.length}>
            <Icon nombre="descargar" /> CSV
          </button>
        </div>
        <p className="help" style={{ marginBottom: 0 }}>
          {filtradas.length} de {reservas.length} reservas en el rango.
        </p>
      </section>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {cargando && <Cargando texto="Cargando reservas…" />}

      {!cargando && filtradas.length === 0 && (
        <div className="card">
          <Empty icono="ticket" titulo="No hay reservas con ese filtro">
            Amplíe el rango de fechas o cambie el estado.
          </Empty>
        </div>
      )}

      {!cargando && filtradas.length > 0 && (
        <div className="grid" style={{ gap: 'var(--s2)' }}>
          {filtradas.map(({ r, est }) => {
            const vigente = est !== 'Finalizada' && est !== 'Cancelada'
            const enCurso = est === 'En curso' || est === 'Sin registrar llegada'
            return (
              <article key={r.id} className="ronda">
                <div className="ronda__equipo">
                  <strong>{r.equipos?.codigo}</strong>
                  <span className="tiny muted">{r.codigo_legible}</span>
                </div>
                <div className="ronda__estado">
                  <span className={`badge ${tonoEstado(est)}`}>{est}</span>
                </div>
                <div className="ronda__detalle">
                  <strong>{r.perfiles?.nombre}</strong>
                  <span className="tiny muted" style={{ wordBreak: 'break-all' }}>
                    {r.perfiles?.correo}
                    {r.programa ? ` · ${r.programa}` : ''}
                  </span>
                  <span className="tiny">
                    {fecha(r.inicio)} → {fecha(r.fin)} · {duracion(r.inicio, r.fin)}
                    {r.actividad ? ` · ${r.actividad}` : ''}
                  </span>
                  {r.detalle && <span className="tiny muted">{r.detalle}</span>}
                  {r.estado === 'cancelada' && r.motivo && <span className="tiny">Motivo: {r.motivo}</span>}
                </div>
                <div className="ronda__acciones">
                  {vigente && (
                    <>
                      {enCurso && !r.llegada_en && (
                        <button className="btn ok sm" type="button" onClick={() => setAccion({ tipo: 'llegada', reserva: r })}>
                          Llegó
                        </button>
                      )}
                      <button className="btn ghost sm" type="button" onClick={() => setAccion({ tipo: 'extender', reserva: r })}>
                        Extender
                      </button>
                      {enCurso && (
                        <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'liberar', reserva: r })}>
                          Liberar
                        </button>
                      )}
                      <button className="btn danger sm" type="button" onClick={() => setAccion({ tipo: 'cancelar', reserva: r })}>
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <AccionesReserva accion={accion} admin={esAdmin(perfil)} alCerrar={() => setAccion(null)} alTerminar={cargar} />
    </>
  )
}
