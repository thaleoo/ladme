import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { crearReserva, equiposDisponibles, listarEquipos } from '../lib/api'
import type { Equipo } from '../lib/types'
import {
  MAX_HORAS_EXTENSION,
  MAX_HORAS_RESERVA,
  MAX_HORAS_TOTAL,
  aIso,
  aInputLocal,
  fecha,
  horasEntre,
  nuevoIdSolicitud,
  sumarHoras
} from '../lib/format'

function redondear(d: Date, minutos: number): Date {
  const ms = minutos * 60000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

export default function Reservar() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [equipo, setEquipo] = useState(params.get('equipo')?.toUpperCase() ?? '')
  const ahora = useMemo(() => redondear(new Date(), 30), [])
  const [inicio, setInicio] = useState(params.get('inicio') ?? aInputLocal(ahora))
  const [fin, setFin] = useState(params.get('fin') ?? aInputLocal(new Date(sumarHoras(ahora.toISOString(), 2))))
  const [actividad, setActividad] = useState('')
  const [detalle, setDetalle] = useState('')
  const [desatendido, setDesatendido] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [idSolicitud, setIdSolicitud] = useState(() => nuevoIdSolicitud())
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [disponibles, setDisponibles] = useState<string[] | null>(null)

  useEffect(() => {
    let vivo = true
    listarEquipos()
      .then((lista) => {
        if (!vivo) return
        setEquipos(lista)
        setEquipo((prev) => prev || lista[0]?.codigo || '')
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudieron cargar los equipos.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [])

  const duracion = useMemo(() => {
    try {
      return horasEntre(aIso(inicio), aIso(fin))
    } catch {
      return NaN
    }
  }, [inicio, fin])

  const problema = useMemo(() => {
    if (!inicio || !fin) return 'Indique el inicio y el fin de la reserva.'
    if (Number.isNaN(duracion) || duracion <= 0) return 'El fin debe ser posterior al inicio.'
    if (duracion > MAX_HORAS_RESERVA) {
      return `La reserva base no puede superar ${MAX_HORAS_RESERVA} h (7 días). Después podrá solicitar una única extensión de hasta ${MAX_HORAS_EXTENSION} h (máximo total ${MAX_HORAS_TOTAL} h).`
    }
    if (new Date(inicio).getTime() < Date.now() - 5 * 60000) return 'La hora de inicio no puede estar en el pasado.'
    return null
  }, [inicio, fin, duracion])

  async function consultarDisponibilidad() {
    setError(null)
    setAviso(null)
    try {
      const lista = await equiposDisponibles(aIso(inicio), aIso(fin))
      const codigos = lista.map((x) => x.codigo)
      setDisponibles(codigos)
      if (equipo && codigos.includes(equipo)) setAviso(`${equipo} está disponible en ese intervalo.`)
      else if (equipo) setError(`${equipo} no está disponible en ese intervalo. Pruebe otro horario o equipo.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar la disponibilidad.')
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    if (problema) {
      setError(problema)
      return
    }
    if (!equipo) {
      setError('Seleccione un equipo.')
      return
    }
    setEnviando(true)
    try {
      const reserva = await crearReserva({
        equipo,
        inicio: aIso(inicio),
        fin: aIso(fin),
        actividad: actividad.trim() || undefined,
        detalle: detalle.trim() || undefined,
        desatendido,
        mensaje: mensaje.trim() || undefined,
        idSolicitud
      })
      setIdSolicitud(nuevoIdSolicitud())
      navigate(`/credencial/${reserva.id}`, {
        replace: true,
        state: { recienCreada: true }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la reserva.')
    } finally {
      setEnviando(false)
    }
  }

  const equipoActual = equipos.find((e) => e.codigo === equipo)

  return (
    <>
      <div className="card accent">
        <h2>Nueva reserva</h2>
        <p className="muted small mb-0">
          Hasta <strong>{MAX_HORAS_RESERVA} h</strong> por reserva (7 días). Al iniciar puede pedir
          una única extensión de hasta <strong>{MAX_HORAS_EXTENSION} h</strong>, sin superar
          {' '}<strong>{MAX_HORAS_TOTAL} h</strong> en total.
        </p>
      </div>

      <div className="card">
        <form onSubmit={enviar} className="stack">
          <div className="grid cols-2">
            <div>
              <label htmlFor="equipo">Equipo</label>
              <select id="equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)} disabled={cargando}>
                {equipos.map((e) => (
                  <option key={e.id} value={e.codigo}>{e.codigo} · {e.nombre}</option>
                ))}
              </select>
              {equipoActual && (
                <div className="help">
                  {equipoActual.marca} {equipoActual.modelo} · {equipoActual.ubicacion || 'LADME'}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="actividad">Actividad</label>
              <input
                id="actividad"
                value={actividad}
                onChange={(e) => setActividad(e.target.value)}
                maxLength={120}
                placeholder="Ej. Entrenamiento de modelos, clase, práctica"
              />
            </div>
            <div>
              <label htmlFor="inicio">Inicio</label>
              <input id="inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="fin">Fin</label>
              <input id="fin" type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} required />
            </div>
          </div>

          <div className="row">
            <span className={`badge ${duracion > MAX_HORAS_RESERVA ? 'danger' : 'ok'}`}>
              Duración: {Number.isFinite(duracion) ? duracion.toFixed(1) : '—'} h
            </span>
            {fin && !Number.isNaN(duracion) && duracion > 0 && (
              <span className="tiny muted">Termina el {fecha(aIso(fin))}</span>
            )}
          </div>

          {problema && <div className="alert warn">{problema}</div>}

          <div>
            <label htmlFor="detalle">Detalle (opcional)</label>
            <textarea
              id="detalle"
              rows={2}
              maxLength={800}
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Software, accesorios o condiciones especiales que necesita."
            />
          </div>

          <div>
            <label className="row" style={{ fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={desatendido}
                onChange={(e) => setDesatendido(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span>Trabajaré de forma desatendida (cálculos largos sin presencia continua)</span>
            </label>
            {desatendido && (
              <div className="mt">
                <label htmlFor="mensaje">Mensaje para quien vea el equipo (opcional)</label>
                <input
                  id="mensaje"
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  maxLength={140}
                  placeholder="Ej. No apagar: entrenamiento en curso."
                />
              </div>
            )}
          </div>

          <div className="row">
            <button type="button" className="btn ghost" onClick={consultarDisponibilidad} disabled={!!problema}>
              Comprobar disponibilidad
            </button>
            <button type="submit" disabled={enviando || cargando || !!problema}>
              {enviando ? 'Creando…' : 'Reservar'}
            </button>
            <Link className="btn gray" to="/">Cancelar</Link>
          </div>

          {disponibles && (
            <div className="alert info">
              Equipos libres en ese intervalo: {disponibles.length ? disponibles.join(', ') : 'ninguno'}.
            </div>
          )}
          {aviso && <div className="alert ok">{aviso}</div>}
          {error && <div className="alert danger">{error}</div>}
        </form>
      </div>

      <div className="card">
        <h4>Antes de reservar</h4>
        <ul className="small muted" style={{ paddingLeft: '1.1rem' }}>
          <li>La reserva queda registrada a su nombre institucional y genera una credencial con QR.</li>
          <li>Registre su llegada al comenzar; si no usa el equipo, cancélelo para liberarlo.</li>
          <li>Al terminar, use «Liberar equipo» para que otra persona pueda reservar antes.</li>
          <li>Las cancelaciones conservan el historial: no se borran, solo se marcan como canceladas.</li>
        </ul>
      </div>
    </>
  )
}
