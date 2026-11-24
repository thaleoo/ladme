import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { cancelarBloqueo, crearBloqueo, listarEquipos, listarReservasAdmin } from '../../lib/api'
import type { Equipo, Reserva } from '../../lib/types'
import { aInputLocal, aIso, fecha } from '../../lib/format'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import { useToast } from '../../components/Toast'
import Modal from '../../components/Modal'

/** Bloqueos de gestión: revisión, verificación o cualquier pausa que no sea un mantenimiento formal. */
export default function Bloqueos() {
  const toast = useToast()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [bloqueos, setBloqueos] = useState<Reserva[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [equipo, setEquipo] = useState('')
  const [desde, setDesde] = useState(aInputLocal(new Date()))
  const [hasta, setHasta] = useState(aInputLocal(new Date(Date.now() + 2 * 3600000)))
  const [motivo, setMotivo] = useState('')
  const [cancelar, setCancelar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const ahora = new Date()
      const [eqs, res] = await Promise.all([
        listarEquipos(),
        listarReservasAdmin(ahora.toISOString(), new Date(ahora.getTime() + 365 * 86400000).toISOString())
      ])
      setEquipos(eqs)
      setEquipo((p) => p || eqs[0]?.codigo || '')
      const activas = res.filter((r) => r.estado === 'activa')
      setBloqueos(activas.filter((r) => r.tipo === 'bloqueo').sort((a, b) => a.inicio.localeCompare(b.inicio)))
      setReservas(activas.filter((r) => r.tipo === 'reserva'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los bloqueos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Reservas que chocan con el intervalo que se está escribiendo.
  const afectadas = reservas.filter(
    (r) => r.equipos?.codigo === equipo && desde && hasta && new Date(r.inicio) < new Date(hasta) && new Date(r.fin) > new Date(desde)
  )

  async function crear(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (motivo.trim().length < 3) return setError('Escriba el motivo del bloqueo.')
    if (new Date(hasta) <= new Date(desde)) return setError('El fin debe ser posterior al inicio.')
    if (afectadas.length && !cancelar) return setError('Hay reservas en ese intervalo. Marque la casilla para cancelarlas o cambie el horario.')
    setOcupado(true)
    try {
      const r = await crearBloqueo({ equipo, inicio: aIso(desde), fin: aIso(hasta), motivo: motivo.trim(), cancelarConflictos: cancelar })
      toast.mostrar(r.canceladas ? `Bloqueo creado. Se cancelaron ${r.canceladas} reserva(s) y se avisó a sus titulares.` : 'Bloqueo creado.')
      setMotivo('')
      setCancelar(false)
      setAbierto(false)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el bloqueo.')
    } finally {
      setOcupado(false)
    }
  }

  async function quitar(id: string) {
    setOcupado(true)
    try {
      await cancelarBloqueo(id)
      toast.mostrar('Bloqueo retirado. El equipo vuelve a poder reservarse.')
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el bloqueo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <div className="admin-barra">
        <p className="admin-barra__texto">
          Un bloqueo pausa las reservas de un equipo por un rato. Para una intervención técnica con historial, use Mantenimiento.
        </p>
        <button type="button" onClick={() => { setError(null); setAbierto(true) }} disabled={!equipos.length}>
          <Icon nombre="mas2" /> Nuevo bloqueo
        </button>
      </div>

      <section className="stack" aria-label="Bloqueos vigentes y próximos">
        {cargando && <Cargando texto="Cargando bloqueos…" />}
        {!cargando && bloqueos.length === 0 && (
          <Empty icono="check-circulo" titulo="Sin bloqueos vigentes">
            Todos los equipos activos se pueden reservar.
          </Empty>
        )}
        {bloqueos.length > 0 && (
          <div className="lista-plana">
            {bloqueos.map((b) => (
              <article key={b.id} className="ronda-fila">
                <span className={`punto-estado ${new Date(b.inicio) <= new Date() ? 'bloqueado' : 'inactivo'}`} aria-hidden="true" />
                <div className="ronda-fila__texto">
                  <p className="ronda-fila__titulo">
                    <span className="ronda-fila__codigo">{b.equipos?.codigo}</span>
                    <span>{b.motivo}</span>
                  </p>
                  <p className="ronda-fila__meta">
                    {new Date(b.inicio) <= new Date() ? `Hasta ${fecha(b.fin)}` : `${fecha(b.inicio)} → ${fecha(b.fin)}`}
                    {b.perfiles?.nombre ? ` · lo puso ${b.perfiles.nombre}` : ''}
                  </p>
                </div>
                <div className="ronda-fila__acciones">
                  <button className="btn gray sm" type="button" disabled={ocupado} onClick={() => quitar(b.id)}>
                    Quitar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        abierto={abierto}
        titulo="Nuevo bloqueo"
        descripcion="El motivo se muestra en la ficha del equipo."
        onCerrar={() => setAbierto(false)}
        pie={
          <>
            <button className="btn ghost" type="button" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <button type="submit" form="bl-form" disabled={ocupado || !equipo}>
              Bloquear equipo
            </button>
          </>
        }
      >
        <form id="bl-form" className="stack" onSubmit={crear} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="bl-equipo">
              Equipo
            </label>
            <select id="bl-equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
              {equipos.map((e) => (
                <option key={e.id} value={e.codigo}>
                  {e.codigo} · {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="grid cols-2 gap-sm">
            <div className="field">
              <label className="field__label" htmlFor="bl-desde">
                Desde
              </label>
              <input id="bl-desde" type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="bl-hasta">
                Hasta
              </label>
              <input id="bl-hasta" type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="bl-motivo">
              Motivo
            </label>
            <input id="bl-motivo" value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Revisión de disco" />
          </div>
          {afectadas.length > 0 && (
            <div className="alert warn">
              <Icon nombre="alerta" />
              <div className="alert__body">
                <strong>{afectadas.length} reserva(s) chocan con ese intervalo:</strong>
                <ul className="tiny" style={{ margin: '4px 0', paddingLeft: '1rem' }}>
                  {afectadas.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      {r.perfiles?.nombre} · {fecha(r.inicio)} → {fecha(r.fin)}
                    </li>
                  ))}
                </ul>
                <label className="check-row" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={cancelar} onChange={(e) => setCancelar(e.target.checked)} />
                  <span>
                    <strong>Cancelarlas y avisar a sus titulares</strong>
                    El motivo del bloqueo se les envía.
                  </span>
                </label>
              </div>
            </div>
          )}
          {error && (
            <div className="alert danger">
              <Icon nombre="alerta" />
              <div className="alert__body">{error}</div>
            </div>
          )}
        </form>
      </Modal>
    </>
  )
}
