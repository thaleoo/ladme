import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { crearReserva, equiposDisponibles, listarEquipos, solicitarExcepcion } from '../lib/api'
import { ACTIVIDADES, perfilCompleto, type Equipo } from '../lib/types'
import { aIso, aInputLocal, fecha, horasEntre, nuevoIdSolicitud, sumarHoras } from '../lib/format'
import { useLimites } from '../lib/politicas'
import { esAdmin, useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import PerfilForm from '../components/PerfilForm'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'

function redondear(d: Date, minutos: number): Date {
  const ms = minutos * 60000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

export default function Reservar() {
  const navigate = useNavigate()
  const toast = useToast()
  const { perfil } = useAuth()
  const lim = useLimites()
  const admin = esAdmin(perfil)
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
  const [justificacion, setJustificacion] = useState('')
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
        const reservables = lista.filter((e) => e.estado === 'activo')
        setEquipos(reservables)
        setEquipo((prev) => (prev && reservables.some((e) => e.codigo === prev) ? prev : reservables[0]?.codigo || ''))
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudieron cargar los equipos.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [])

  const presets = useMemo(() => {
    const base = [2, 4, 8, 24, 72].filter((h) => h < lim.maxHoras)
    return [...base, lim.maxHoras].map((h) => ({
      horas: h,
      etiqueta: h < 24 ? `${h} h` : h % 24 === 0 ? `${h / 24} ${h === 24 ? 'día' : 'días'}` : `${h} h`
    }))
  }, [lim.maxHoras])

  const duracion = useMemo(() => {
    try {
      return horasEntre(aIso(inicio), aIso(fin))
    } catch {
      return NaN
    }
  }, [inicio, fin])

  // Más de lo permitido: en vez de bloquear, se ofrece pedir una excepción.
  const esLarga = !admin && Number.isFinite(duracion) && duracion > lim.maxHoras

  const problema = useMemo(() => {
    if (!inicio || !fin) return 'Indique el inicio y el fin de la reserva.'
    if (Number.isNaN(duracion) || duracion <= 0) return 'El fin debe ser posterior al inicio.'
    if (new Date(inicio).getTime() < Date.now() - 5 * 60000) return 'La hora de inicio no puede estar en el pasado.'
    if (esLarga && duracion > lim.excepcionMaxHoras) {
      return `Ni siquiera con solicitud se puede superar ${lim.excepcionMaxHoras} h (${Math.round(lim.excepcionMaxHoras / 24)} días).`
    }
    if (!admin && new Date(inicio).getTime() > Date.now() + lim.anticipacionDias * 86400000) {
      return `Solo se puede reservar con ${lim.anticipacionDias} días de anticipación.`
    }
    return null
  }, [inicio, fin, duracion, esLarga, admin, lim])

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
    if (problema) return setError(problema)
    if (!equipo) return setError('Seleccione un equipo.')
    if (!actividad) return setError('Seleccione el tipo de actividad.')
    if (esLarga && justificacion.trim().length < 10) {
      return setError('Explique por qué necesita más tiempo (mínimo 10 caracteres).')
    }
    setEnviando(true)
    try {
      if (esLarga) {
        await solicitarExcepcion({
          equipo,
          inicio: aIso(inicio),
          fin: aIso(fin),
          actividad,
          detalle: detalle.trim() || undefined,
          justificacion: justificacion.trim()
        })
        toast.mostrar('Solicitud enviada. La administración le responderá por aquí y por correo.')
        navigate('/mis-reservas', { replace: true })
        return
      }
      const reserva = await crearReserva({
        equipo,
        inicio: aIso(inicio),
        fin: aIso(fin),
        actividad,
        detalle: detalle.trim() || undefined,
        desatendido,
        mensaje: mensaje.trim() || undefined,
        idSolicitud
      })
      setIdSolicitud(nuevoIdSolicitud())
      navigate(`/credencial/${reserva.id}`, { replace: true, state: { recienCreada: true } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la reserva.')
    } finally {
      setEnviando(false)
    }
  }

  if (!perfilCompleto(perfil)) {
    return (
      <>
        <PageHeader
          eyebrow="Operación"
          titulo="Antes de reservar"
          sub="Necesitamos sus datos académicos. Se piden una sola vez y luego reservar toma unos segundos."
          volver={{ a: '/', texto: 'Volver a disponibilidad' }}
        />
        <section className="card">
          <PerfilForm />
        </section>
      </>
    )
  }

  const equipoActual = equipos.find((e) => e.codigo === equipo)
  const porcentaje = Number.isFinite(duracion) && duracion > 0 ? Math.min(100, (duracion / lim.maxTotal) * 100) : 0

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        titulo="Nueva reserva"
        sub={
          <>
            Hasta <strong>{lim.maxHoras} h</strong> por reserva y una extensión de{' '}
            <strong>{lim.maxExtension} h</strong>. Para más tiempo, se envía una solicitud.
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
                Tipo de actividad
              </label>
              <select id="actividad" value={actividad} onChange={(e) => setActividad(e.target.value)}>
                <option value="" disabled>
                  Seleccione
                </option>
                {ACTIVIDADES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="inicio">
                Inicio
              </label>
              <input id="inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
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
              {presets.map((p) => (
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
              <span className={`badge ${esLarga ? 'warn' : 'ok'}`}>
                <Icon nombre="reloj" /> {Number.isFinite(duracion) ? `${duracion.toFixed(1)} h` : '—'}
              </span>
              <span className="tiny muted">
                {lim.maxHoras} h base + {lim.maxExtension} h extensión
              </span>
            </div>
            <div
              className="medidor"
              role="img"
              aria-label={`Duración ${Number.isFinite(duracion) ? duracion.toFixed(1) : 0} de ${lim.maxTotal} horas`}
            >
              <div className={`medidor__relleno${esLarga ? ' alerta' : ''}`} style={{ width: `${Math.max(2, porcentaje)}%` }} />
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

          {esLarga && !problema && (
            <div className="alert info">
              <Icon nombre="info" />
              <div className="alert__body">
                <strong>Esto supera las {lim.maxHoras} h.</strong> No se reserva de inmediato: se envía una
                solicitud y un administrador la aprueba o la rechaza. El equipo no queda apartado mientras tanto.
                <div className="field" style={{ marginTop: 'var(--s3)' }}>
                  <label className="field__label" htmlFor="justificacion">
                    ¿Por qué necesita más tiempo?
                  </label>
                  <textarea
                    id="justificacion"
                    rows={3}
                    maxLength={800}
                    value={justificacion}
                    onChange={(e) => setJustificacion(e.target.value)}
                    placeholder="Ej. Entrenamiento de un modelo para el trabajo de grado que tarda 12 días continuos."
                  />
                </div>
              </div>
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="detalle">
              Detalle, tutor o descripción <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span>
            </label>
            <textarea
              id="detalle"
              rows={3}
              maxLength={800}
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Nombre del proyecto, tutor, software que va a usar."
            />
          </div>

          {!esLarga && (
            <label className="check-row">
              <input type="checkbox" checked={desatendido} onChange={(e) => setDesatendido(e.target.checked)} />
              <span>
                <strong>Proceso desatendido</strong>
                Dejará algo ejecutándose sin estar presente. Quien pase por el equipo verá su mensaje.
              </span>
            </label>
          )}

          {desatendido && !esLarga && (
            <div className="field">
              <label className="field__label" htmlFor="mensaje">
                Mensaje para quien llegue al equipo
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
                  <span className="spinner" aria-hidden="true" /> Enviando…
                </>
              ) : esLarga ? (
                <>
                  <Icon nombre="flecha" /> Enviar solicitud
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
              <li>La reserva queda a su nombre y genera una credencial con QR.</li>
              <li>Registre su llegada al comenzar; si no va a usar el equipo, cancele para liberarlo.</li>
              <li>Al terminar, use «Liberar equipo» para que otra persona pueda reservar antes.</li>
              <li>Las cancelaciones conservan el historial: no se borran.</li>
            </ul>
          </section>

          <section className="card accent">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Límites vigentes</h3>
            <div className="stack" style={{ marginTop: 'var(--s3)' }}>
              <div className="row between small">
                <span className="muted">Reserva base</span>
                <strong className="num">{lim.maxHoras} h</strong>
              </div>
              <div className="row between small">
                <span className="muted">Extensión</span>
                <strong className="num">+{lim.maxExtension} h</strong>
              </div>
              <div className="row between small">
                <span className="muted">Tope sin solicitud</span>
                <strong className="num">{lim.maxTotal} h</strong>
              </div>
              <div className="row between small">
                <span className="muted">Con solicitud aprobada</span>
                <strong className="num">hasta {Math.round(lim.excepcionMaxHoras / 24)} días</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
