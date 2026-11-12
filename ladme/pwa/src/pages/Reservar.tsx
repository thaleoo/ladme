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
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'

function redondear(d: Date, minutos: number): Date {
  const ms = minutos * 60000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

const PRESETS: Array<{ etiqueta: string; horas: number }> = [
  { etiqueta: '2 h', horas: 2 },
  { etiqueta: '4 h', horas: 4 },
  { etiqueta: '8 h', horas: 8 },
  { etiqueta: '1 día', horas: 24 },
  { etiqueta: '3 días', horas: 72 },
  { etiqueta: '7 días', horas: MAX_HORAS_RESERVA }
]

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

  function aplicarDuracion(horas: number) {
    if (!inicio) return
    setFin(aInputLocal(new Date(sumarHoras(aIso(inicio), horas))))
  }

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
  const porcentaje = Number.isFinite(duracion) && duracion > 0 ? Math.min(100, (duracion / MAX_HORAS_TOTAL) * 100) : 0
  const excede = Number.isFinite(duracion) && duracion > MAX_HORAS_RESERVA

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        titulo="Nueva reserva"
        sub={
          <>
            Hasta <strong>{MAX_HORAS_RESERVA} h</strong> por reserva. Al iniciar puede pedir una única
            extensión de <strong>{MAX_HORAS_EXTENSION} h</strong>, sin pasar de{' '}
            <strong>{MAX_HORAS_TOTAL} h</strong> en total.
          </>
        }
        volver={{ a: '/', texto: 'Volver a disponibilidad' }}
      />

      <div className="dos-columnas">
        <form onSubmit={enviar} className="card stack" noValidate>
          <div className="grid cols-2 gap-sm">
            <div className="field">
              <label className="field__label" htmlFor="equipo">
                Equipo
              </label>
              <select id="equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)} disabled={cargando}>
                {equipos.map((e) => (
                  <option key={e.id} value={e.codigo}>
                    {e.codigo} · {e.nombre}
                  </option>
                ))}
              </select>
              {equipoActual && (
                <p className="help">
                  {[equipoActual.marca, equipoActual.modelo].filter(Boolean).join(' ')} ·{' '}
                  {equipoActual.ubicacion || 'LADME'}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="actividad">
                Actividad <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span>
              </label>
              <input
                id="actividad"
                value={actividad}
                onChange={(e) => setActividad(e.target.value)}
                maxLength={120}
                placeholder="Ej. Entrenamiento de modelos, clase, práctica"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="inicio">
                Inicio
              </label>
              <input
                id="inicio"
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="fin">
                Fin
              </label>
              <input id="fin" type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} required />
            </div>
          </div>

          <div>
            <div className="tiny muted" style={{ marginBottom: 6 }}>
              Duración rápida desde el inicio
            </div>
            <div className="chips">
              {PRESETS.map((p) => (
                <button
                  key={p.horas}
                  type="button"
                  className="chip"
                  onClick={() => aplicarDuracion(p.horas)}
                  aria-pressed={Number.isFinite(duracion) && Math.abs(duracion - p.horas) < 0.01}
                >
                  {p.etiqueta}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className={`badge ${excede ? 'danger' : 'ok'}`}>
                <Icon nombre="reloj" /> {Number.isFinite(duracion) ? `${duracion.toFixed(1)} h` : '—'}
              </span>
              <span className="tiny muted">
                {MAX_HORAS_RESERVA} h base + {MAX_HORAS_EXTENSION} h extensión
              </span>
            </div>
            <div className="medidor" role="img" aria-label={`Duración ${Number.isFinite(duracion) ? duracion.toFixed(1) : 0} de ${MAX_HORAS_TOTAL} horas`}>
              <div
                className={`medidor__relleno${excede ? ' alerta' : ''}`}
                style={{ width: `${Math.max(2, porcentaje)}%` }}
              />
            </div>
            {fin && !Number.isNaN(duracion) && duracion > 0 && (
              <p className="help" style={{ marginBottom: 0 }}>
                Termina el {fecha(aIso(fin))}.
              </p>
            )}
          </div>

          {problema && (
            <div className="alert warn">
              <Icon nombre="alerta" />
              <div className="alert__body">{problema}</div>
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="detalle">
              Detalle <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span>
            </label>
            <textarea
              id="detalle"
              rows={3}
              maxLength={800}
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Software, accesorios o condiciones especiales que necesita."
            />
          </div>

          <label className="check-row">
            <input type="checkbox" checked={desatendido} onChange={(e) => setDesatendido(e.target.checked)} />
            <span>
              <strong>Trabajo desatendido</strong>
              Cálculos largos sin presencia continua. Quien pase por el equipo verá su mensaje.
            </span>
          </label>

          {desatendido && (
            <div className="field">
              <label className="field__label" htmlFor="mensaje">
                Mensaje para quien vea el equipo
              </label>
              <input
                id="mensaje"
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                maxLength={140}
                placeholder="Ej. No apagar: entrenamiento en curso."
              />
            </div>
          )}

          <div className="row" style={{ gap: 'var(--s2)' }}>
            <button type="submit" disabled={enviando || cargando || !!problema}>
              {enviando ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Creando…
                </>
              ) : (
                <>
                  <Icon nombre="check" /> Reservar
                </>
              )}
            </button>
            <button type="button" className="btn ghost" onClick={consultarDisponibilidad} disabled={!!problema}>
              <Icon nombre="buscar" /> Comprobar disponibilidad
            </button>
            <Link className="btn gray" to="/">
              Cancelar
            </Link>
          </div>

          {disponibles && (
            <div className="alert info">
              <Icon nombre="info" />
              <div className="alert__body">
                Equipos libres en ese intervalo:{' '}
                <strong>{disponibles.length ? disponibles.join(', ') : 'ninguno'}</strong>.
              </div>
            </div>
          )}
          {aviso && (
            <div className="alert ok">
              <Icon nombre="check-circulo" />
              <div className="alert__body">{aviso}</div>
            </div>
          )}
          {error && (
            <div className="alert danger">
              <Icon nombre="alerta" />
              <div className="alert__body">{error}</div>
            </div>
          )}
        </form>

        <aside className="stack">
          <section className="card">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Antes de reservar</h3>
            <ul className="small muted" style={{ paddingLeft: '1.05rem', margin: 0 }}>
              <li>La reserva queda a su nombre institucional y genera una credencial con QR.</li>
              <li>Registre su llegada al comenzar; si no usa el equipo, cancélelo para liberarlo.</li>
              <li>Al terminar, use «Liberar equipo» para que otra persona pueda reservar antes.</li>
              <li>Las cancelaciones conservan el historial: no se borran.</li>
            </ul>
          </section>

          <section className="card accent">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Límites vigentes</h3>
            <div className="stack" style={{ marginTop: 'var(--s3)' }}>
              <div className="row between small">
                <span className="muted">Reserva base</span>
                <strong className="num">{MAX_HORAS_RESERVA} h</strong>
              </div>
              <div className="row between small">
                <span className="muted">Extensión única</span>
                <strong className="num">+{MAX_HORAS_EXTENSION} h</strong>
              </div>
              <div className="row between small">
                <span className="muted">Tope absoluto</span>
                <strong className="num">{MAX_HORAS_TOTAL} h</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
