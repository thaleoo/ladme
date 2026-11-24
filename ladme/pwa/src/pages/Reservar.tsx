import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AvisoSancion, useSancion } from '../components/Inasistencias'
import { CamposSoftware, SOFTWARE_VACIO, alcanzaParaSoftware, type DatosSoftware } from '../components/Software'
import CampoDocente, { docenteRecordado, recordarDocente, validarDocente } from '../components/CampoDocente'
import { solicitarSoftware, crearReserva, equiposDisponibles, listarEquipos, marcarCompartida, ocupacionPublica, solicitarExcepcion } from '../lib/api'
import { ACTIVIDADES, perfilCompleto, pideDocente, textoSO, type Equipo, type Ocupacion } from '../lib/types'
import { aIso, aInputLocal, fecha, horasEntre, nuevoIdSolicitud, sumarHoras } from '../lib/format'
import { useLimites } from '../lib/politicas'
import { useTopeReservas } from '../lib/reservaVigente'
import { esAdmin, esStaff, useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import PerfilForm from '../components/PerfilForm'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
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
  const tope = useTopeReservas()
  const sancion = useSancion()
  const [params] = useSearchParams()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [equipo, setEquipo] = useState(params.get('equipo')?.toUpperCase() ?? '')
  const ahora = useMemo(() => redondear(new Date(), 30), [])
  const [inicio, setInicio] = useState(params.get('inicio') ?? aInputLocal(ahora))
  const horasIniciales = Math.min(Math.max(Number(params.get('horas')) || 2, 0.5), lim.maxHoras)
  const [fin, setFin] = useState(
    params.get('fin') ?? aInputLocal(new Date(sumarHoras(ahora.toISOString(), horasIniciales)))
  )
  const [actividad, setActividad] = useState(() => {
    const a = params.get('actividad') ?? ''
    return (ACTIVIDADES as readonly string[]).includes(a) ? a : ''
  })
  const [docente, setDocente] = useState(() => params.get('docente') || docenteRecordado(actividad))
  const [detalle, setDetalle] = useState('')
  const [desatendido, setDesatendido] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [compartida, setCompartida] = useState(false)
  const [pideSoftware, setPideSoftware] = useState(false)
  const [software, setSoftware] = useState<DatosSoftware>(SOFTWARE_VACIO)
  const [protegidos, setProtegidos] = useState<string[]>([])
  const [otrosProtegidos, setOtrosProtegidos] = useState('')
  const [ocupEquipo, setOcupEquipo] = useState<Ocupacion[]>([])
  const [justificacion, setJustificacion] = useState('')
  const [idSolicitud, setIdSolicitud] = useState(() => nuevoIdSolicitud())
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [disponibles, setDisponibles] = useState<string[] | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const [finManual, setFinManual] = useState(false)

  // Ocupación del equipo elegido: para avisar si el horario cae en un uso compartido.
  useEffect(() => {
    if (!equipo) return setOcupEquipo([])
    let vivo = true
    ocupacionPublica(equipo)
      .then((l) => vivo && setOcupEquipo(l))
      .catch(() => vivo && setOcupEquipo([]))
    return () => {
      vivo = false
    }
  }, [equipo])

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
  // El administrador puede superar el límite, pero debe confirmarlo explícitamente.
  const adminExcede = admin && Number.isFinite(duracion) && duracion > lim.maxHoras
  const [confirmaExceso, setConfirmaExceso] = useState(false)
  useEffect(() => setConfirmaExceso(false), [inicio, fin])

  const problema = useMemo(() => {
    if (!inicio || !fin) return 'Indique el inicio y el fin de la reserva.'
    if (Number.isNaN(duracion) || duracion <= 0) return 'El fin debe ser posterior al inicio.'
    if (new Date(inicio).getTime() < Date.now() - 5 * 60000) return 'La hora de inicio no puede estar en el pasado.'
    if (duracion > lim.maxAbsolutoHoras) {
      return `Ninguna reserva puede superar ${Math.round(lim.maxAbsolutoHoras / 24)} días (tope absoluto del laboratorio).`
    }
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

  // Disponibilidad del horario elegido: se consulta sola al cambiar el horario (con una pausa breve).
  useEffect(() => {
    if (problema) return setDisponibles(null)
    let vivo = true
    const t = window.setTimeout(() => {
      equiposDisponibles(aIso(inicio), aIso(fin))
        .then((lista) => vivo && setDisponibles(lista.map((x) => x.codigo)))
        .catch(() => vivo && setDisponibles(null))
    }, 350)
    return () => {
      vivo = false
      window.clearTimeout(t)
    }
  }, [inicio, fin, problema])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    if (problema) return setError(problema)
    if (!equipo) return setError('Seleccione un equipo.')
    if (!actividad) return setError('Seleccione el tipo de actividad.')
    const conDocente = pideDocente(actividad)
    if (conDocente) {
      const falta = validarDocente(docente)
      if (falta) return setError(falta)
    }
    const docenteFinal = conDocente ? docente.trim().replace(/\s+/g, ' ') : undefined
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
          justificacion: justificacion.trim(),
          docente: docenteFinal
        })
        if (docenteFinal) recordarDocente(actividad, docenteFinal)
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
        idSolicitud,
        docente: docenteFinal
      })
      if (docenteFinal) recordarDocente(actividad, docenteFinal)
      if (pideSoftware && software.software.trim()) {
        try {
          await solicitarSoftware({ ...software, version: software.version || undefined, enlace: software.enlace || undefined, reserva: reserva.id })
          toast.mostrar('Reserva creada y solicitud de software enviada al laboratorio.')
        } catch (e) {
          toast.mostrar(`La reserva quedó creada, pero la solicitud de software no se envió: ${e instanceof Error ? e.message : ''}`)
        }
      }
      if (compartida && desatendido) {
        const todos = [...protegidos, ...otrosProtegidos.split(',').map((x) => x.trim()).filter(Boolean)]
        try {
          await marcarCompartida(reserva.id, true, todos, mensaje.trim() || undefined)
        } catch (e) {
          toast.mostrar(`La reserva quedó creada, pero no se pudo compartir: ${e instanceof Error ? e.message : ''}`)
        }
      }
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
  // ¿El horario elegido cae dentro del uso compartido de otra persona?
  const anfitrion = (() => {
    try {
      const a = new Date(aIso(inicio)).getTime()
      const b = new Date(aIso(fin)).getTime()
      return ocupEquipo.find((o) => o.compartida && new Date(o.inicio).getTime() < b && new Date(o.fin).getTime() > a) ?? null
    } catch {
      return null
    }
  })()
  const categorias = [...new Set(equipos.map((e) => e.categoria))].sort()
  const fotoDe = (e?: Equipo) => (e as (Equipo & { foto_url?: string | null }) | undefined)?.foto_url ?? null
  const diaActual = inicio.slice(0, 10)
  const horaActual = inicio.slice(11, 16)
  const hoyLocal = aInputLocal(new Date()).slice(0, 10)
  const dias = Array.from({ length: Math.max(1, Math.min(7, admin ? 7 : lim.anticipacionDias + 1)) }, (_, i) => {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() + i)
    const valor = aInputLocal(d).slice(0, 10)
    const texto = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric' }).format(d).replace('.', '')
    return { valor, texto: texto.charAt(0).toUpperCase() + texto.slice(1) }
  })
  const otroDia = !dias.some((d) => d.valor === diaActual)
  const durValida = Number.isFinite(duracion) && duracion > 0

  // Mover el día o la hora conserva la duración elegida.
  function moverInicio(nuevo: string) {
    setInicio(nuevo)
    if (durValida) setFin(aInputLocal(new Date(sumarHoras(aIso(nuevo), duracion))))
  }
  function pasoDuracion(signo: 1 | -1) {
    const actual = durValida ? duracion : 2
    const paso = actual < 12 || (signo < 0 && actual <= 12) ? 1 : actual < 48 || (signo < 0 && actual <= 48) ? 6 : 24
    aplicarDuracion(Math.max(0.5, actual + signo * paso))
  }
  const textoFin = fin && durValida ? cuandoLargo(aIso(fin), aIso(inicio)) : '—'
  const libreEnHorario = disponibles && equipo ? disponibles.includes(equipo) : null
  const otrosLibres = (disponibles ?? []).filter((c) => c !== equipo)
  const proximasEquipo = ocupEquipo.filter((o) => new Date(o.fin).getTime() > Date.now()).sort((x, y) => x.inicio.localeCompare(y.inicio)).slice(0, 6)

  return (
    <>
      <PageHeader titulo="Nueva reserva" volver={{ a: '/', texto: 'Disponibilidad' }} />

      <div className="reservar-layout">
      <form onSubmit={enviar} className="reservar" noValidate>
        {lim.reservasPausadas && !esStaff(perfil) && (
          <div className="alert warn">
            <Icon nombre="reloj" />
            <div className="alert__body">
              <strong>Las reservas están pausadas unos minutos</strong> mientras el laboratorio actualiza el sistema. Intente de nuevo en un rato.
            </div>
          </div>
        )}
        {sancion.hasta && <AvisoSancion hasta={sancion.hasta} />}
        {tope.alcanzado && (
          <div className="alert warn" role="status">
            <Icon nombre="reloj" />
            <div className="alert__body">
              <strong>{tope.vigentes.length === 1 ? 'Ya tiene una reserva.' : `Ya tiene ${tope.vigentes.length} reservas.`}</strong>{' '}
              {lim.reservasALaVez === 1 ? 'Solo se permite una a la vez' : `El máximo es ${lim.reservasALaVez} a la vez`}: cuando termine, la libere o la
              cancele, podrá hacer otra.
              <ul className="tope-lista">
                {tope.vigentes.map((r) => (
                  <li key={r.id}>
                    <strong>{r.equipos?.codigo}</strong>, {fecha(r.inicio)} a {fecha(r.fin)}
                  </li>
                ))}
              </ul>
              <Link to="/mis-reservas">Ir a mis reservas</Link>
            </div>
          </div>
        )}

        {/* Equipo */}
        <section className="reservar-equipo">
          {fotoDe(equipoActual) ? (
            <img className="reservar-equipo__foto" src={fotoDe(equipoActual) ?? undefined} alt="" />
          ) : (
            <span className="reservar-equipo__foto reservar-equipo__foto--vacia" aria-hidden="true">
              <Icon nombre="monitor" width={30} height={30} />
            </span>
          )}
          <div className="reservar-equipo__texto">
            <strong>{equipoActual?.codigo ?? (cargando ? 'Cargando…' : 'Sin equipos disponibles')}</strong>
            {equipoActual && (
              <span className="muted small">
                {[[equipoActual.marca, equipoActual.modelo].filter(Boolean).join(' '), textoSO(equipoActual)].filter(Boolean).join(', ')}
              </span>
            )}
            {libreEnHorario !== null && !problema && (
              <span className="reservar-equipo__estado">
                <span className={`punto-estado ${libreEnHorario ? 'libre' : 'ocupado'}`} aria-hidden="true" />
                {libreEnHorario ? 'Libre en ese horario' : 'Ocupado en ese horario'}
              </span>
            )}
          </div>
          <button type="button" className="btn ghost sm" onClick={() => setEligiendo(true)} disabled={cargando || equipos.length < 2}>
            Cambiar
          </button>
        </section>
        {libreEnHorario === false && !problema && otrosLibres.length > 0 && (
          <div className="reservar-alternativas">
            <span className="small muted">Libres en ese horario:</span>
            <div className="chips-desliza">
              {otrosLibres.slice(0, 8).map((c) => (
                <button key={c} type="button" className="chip" onClick={() => setEquipo(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cuándo */}
        <section className="ajustes" aria-label="Horario">
          <div className="ajustes__fila ajustes__fila--bloque">
            <span className="ajustes__etiqueta">Día</span>
            <div className="chips-desliza" role="group" aria-label="Día">
              {dias.map((d) => (
                <button key={d.valor} type="button" className="chip" aria-pressed={diaActual === d.valor}
                        onClick={() => moverInicio(`${d.valor}T${horaActual}`)}>
                  {d.texto}
                </button>
              ))}
              <label className={`chip chip--fecha${otroDia ? ' activo' : ''}`} aria-pressed={otroDia}>
                <Icon nombre="calendario" width={16} height={16} />
                {otroDia ? diaLegible(diaActual) : 'Otro día'}
                <input type="date" value={diaActual} min={hoyLocal} aria-label="Elegir otro día"
                       onChange={(e) => e.target.value && moverInicio(`${e.target.value}T${horaActual}`)} />
              </label>
            </div>
          </div>
          <label className="ajustes__fila">
            <span className="ajustes__etiqueta">Desde</span>
            <input className="ajustes__hora" type="time" step={900} value={horaActual} required
                   onChange={(e) => e.target.value && moverInicio(`${diaActual}T${e.target.value}`)} />
          </label>
          <div className="ajustes__fila">
            <span className="ajustes__etiqueta">Duración</span>
            <span className="paso">
              <button type="button" className="paso__btn" aria-label="Menos tiempo" onClick={() => pasoDuracion(-1)} disabled={!durValida || duracion <= 0.5}>
                <Icon nombre="menos" width={18} height={18} />
              </button>
              <span className="paso__valor">{durValida ? textoDuracion(duracion) : '—'}</span>
              <button type="button" className="paso__btn" aria-label="Más tiempo" onClick={() => pasoDuracion(1)}>
                <Icon nombre="mas2" width={18} height={18} />
              </button>
            </span>
          </div>
          <div className="ajustes__rapidas chips-desliza" role="group" aria-label="Duraciones frecuentes">
            {presets.map((p) => (
              <button key={p.horas} type="button" className="chip chip--sm" onClick={() => aplicarDuracion(p.horas)}
                      aria-pressed={durValida && Math.abs(duracion - p.horas) < 0.01}>
                {p.etiqueta}
              </button>
            ))}
          </div>
          <div className="ajustes__fila">
            <span className="ajustes__etiqueta">Termina</span>
            {finManual ? (
              <input className="ajustes__hora" type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} aria-label="Fin de la reserva" />
            ) : (
              <button type="button" className="ajustes__valor-btn" onClick={() => setFinManual(true)}>
                {textoFin}
                <Icon nombre="lapiz" width={15} height={15} />
              </button>
            )}
          </div>
        </section>
        <p className="tiny muted reservar-limite">
          Hasta {lim.maxHoras} h por reserva{admin ? '' : '; para más tiempo se envía una solicitud'}.
        </p>

        {problema && (
          <div className="alert warn">
            <Icon nombre="alerta" />
            <div className="alert__body">{problema}</div>
          </div>
        )}

        {adminExcede && !problema && (
          <div className="alert warn">
            <Icon nombre="alerta" />
            <div className="alert__body">
              <strong>Supera el límite de {lim.maxHoras} h.</strong> Como administrador puede reservar hasta {Math.round(lim.maxAbsolutoHoras / 24)} días;
              el equipo quedará ocupado para todos durante {Math.round(duracion / 24)} días.
              <label className="check-row" style={{ marginTop: 'var(--s3)' }}>
                <input type="checkbox" checked={confirmaExceso} onChange={(e) => setConfirmaExceso(e.target.checked)} />
                <span>
                  <strong>Confirmo que supero el límite como administrador</strong>
                  Termina el {fecha(aIso(fin))}
                </span>
              </label>
            </div>
          </div>
        )}

        {esLarga && !problema && (
          <div className="alert info">
            <Icon nombre="info" />
            <div className="alert__body">
              <strong>Esto supera las {lim.maxHoras} h.</strong> Se envía como solicitud: un administrador la aprueba o la rechaza, y el equipo no queda
              apartado mientras tanto.
              <div className="field" style={{ marginTop: 'var(--s3)' }}>
                <label className="field__label" htmlFor="justificacion">
                  ¿Por qué necesita más tiempo?
                </label>
                <textarea id="justificacion" rows={3} maxLength={800} value={justificacion} onChange={(e) => setJustificacion(e.target.value)}
                          placeholder="Ej. El entrenamiento del modelo tarda 12 días continuos." />
              </div>
            </div>
          </div>
        )}

        {/* Para qué */}
        <section className="reservar-bloque">
          <h2 className="reservar-bloque__t">Actividad</h2>
          <div className="actividades" role="radiogroup" aria-label="Tipo de actividad">
            {ACTIVIDADES.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={actividad === x} className="chip actividad"
                      onClick={() => {
                        setActividad(x)
                        if (pideDocente(x) && !docente.trim()) setDocente(docenteRecordado(x))
                      }}>
                <span className="actividad__punto" style={{ background: COLOR_ACTIVIDAD[x] }} aria-hidden="true" />
                {x === 'Semilleros' ? 'Semillero' : x}
              </button>
            ))}
          </div>
          {pideDocente(actividad) && <CampoDocente id="docente" actividad={actividad} valor={docente} onCambio={setDocente} />}
          <div className="field">
            <label className="field__label" htmlFor="detalle">
              Detalle (opcional)
            </label>
            <textarea id="detalle" rows={2} maxLength={800} value={detalle} onChange={(e) => setDetalle(e.target.value)}
                      placeholder="Proyecto, asignatura o lo que va a hacer" />
          </div>
        </section>

        {/* Opciones */}
        {!esLarga && (
          <section className="reservar-bloque">
            <h2 className="reservar-bloque__t">Opciones</h2>
            {(() => {
              const alcanza = alcanzaParaSoftware(aIso(inicio), lim.softwareAnticipacion)
              return (
                <div className="opcion">
                  <label className="opcion__fila">
                    <span className="opcion__texto">
                      <strong>Necesito un programa que no está instalado</strong>
                      <span>
                        {alcanza
                          ? 'El laboratorio lo gestiona con TI; su reserva no depende de eso.'
                          : `Se pide con ${lim.softwareAnticipacion} días hábiles de anticipación. Para esta fecha ya no alcanza.`}
                      </span>
                    </span>
                    <input type="checkbox" role="switch" className="interruptor" checked={pideSoftware && alcanza} disabled={!alcanza}
                           onChange={(e) => setPideSoftware(e.target.checked)} />
                  </label>
                  {pideSoftware && alcanza && <CamposSoftware valor={software} cambiar={setSoftware} equipos={equipos} />}
                </div>
              )
            })()}
            <div className="opcion">
              <label className="opcion__fila">
                <span className="opcion__texto">
                  <strong>Dejaré un proceso corriendo</strong>
                  <span>Quien pase por el equipo verá su mensaje y no lo apagará.</span>
                </span>
                <input type="checkbox" role="switch" className="interruptor" checked={desatendido} onChange={(e) => setDesatendido(e.target.checked)} />
              </label>
              {desatendido && (
                <div className="stack">
                  <div className="field">
                    <label className="field__label" htmlFor="mensaje">
                      Mensaje para quien llegue
                    </label>
                    <input id="mensaje" value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={140}
                           placeholder="Ej. No apagar: entrenamiento en curso" />
                  </div>
                  {lim.usoCompartido && (
                    <label className="opcion__fila opcion__fila--sub">
                      <span className="opcion__texto">
                        <strong>Permitir que otros usen el equipo</strong>
                        <span>Pueden reservarlo mientras su proceso corre, sin cerrar los programas que usted proteja.</span>
                      </span>
                      <input type="checkbox" role="switch" className="interruptor" checked={compartida} onChange={(e) => setCompartida(e.target.checked)} />
                    </label>
                  )}
                  {compartida && lim.usoCompartido && (
                    <div className="stack">
                      <span className="field__label">Programas que nadie debe cerrar</span>
                      {(equipoActual?.software ?? []).length > 0 && (
                        <div className="chips" role="group" aria-label="Programas protegidos">
                          {(equipoActual?.software ?? []).map((x) => (
                            <button key={x} type="button" className="chip" aria-pressed={protegidos.includes(x)}
                                    onClick={() => setProtegidos((l) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]))}>
                              {x}
                            </button>
                          ))}
                        </div>
                      )}
                      <input aria-label="Otros programas protegidos" value={otrosProtegidos} onChange={(e) => setOtrosProtegidos(e.target.value)}
                             maxLength={200} placeholder="Otros, separados por coma" />
                      <p className="tiny muted" style={{ margin: 0 }}>
                        Guarde sus resultados en su carpeta o en la nube: quien use el equipo trabaja en la misma sesión.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {anfitrion && (
          <div className="alert warn" role="status">
            <Icon nombre="compartir" />
            <div className="alert__body">
              <strong>Este horario es de uso compartido.</strong> Otra persona dejó un proceso corriendo en {equipo}. Puede usar el equipo, pero{' '}
              <strong>no cierre</strong> {anfitrion.protegidos?.length ? anfitrion.protegidos.join(', ') : 'los programas abiertos'} ni reinicie o apague el
              computador.
              {anfitrion.mensaje_llegada && <> Nota: «{anfitrion.mensaje_llegada}».</>}
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

        <p className="small muted reservar-clase">
          ¿Necesita varios equipos para una clase? <Link to="/clases">Solicite la sala</Link>
        </p>

        <div className="reservar-pie">
          <span className="reservar-pie__resumen">
            {equipoActual?.codigo ?? 'Equipo'}
            <span>{durValida ? resumenHorario(aIso(inicio), aIso(fin)) : 'Elija el horario'}</span>
          </span>
          <button type="submit" className="btn lg" disabled={enviando || cargando || tope.alcanzado || !!problema || (adminExcede && !confirmaExceso)}>
            {enviando ? (
              <>
                <span className="spinner" aria-hidden="true" /> Enviando…
              </>
            ) : esLarga ? (
              'Enviar solicitud'
            ) : (
              'Reservar'
            )}
          </button>
        </div>
      </form>

      <aside className="reservar-lado" aria-label={`Agenda de ${equipoActual?.codigo ?? 'el equipo'}`}>
        <h2 className="reservar-bloque__t">Agenda de {equipoActual?.codigo ?? 'el equipo'}</h2>
        {proximasEquipo.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Sin reservas en los próximos días.</p>
        ) : (
          <ul className="agenda-corta">
            {proximasEquipo.map((o, i) => (
              <li key={i}>
                <span className="agenda-corta__dia">{diaLegible(aInputLocal(new Date(o.inicio)).slice(0, 10))}</span>
                <span className="agenda-corta__horas">
                  {fmtHora.format(new Date(o.inicio))} a {new Date(o.fin).toDateString() === new Date(o.inicio).toDateString() ? fmtHora.format(new Date(o.fin)) : `${diaLegible(aInputLocal(new Date(o.fin)).slice(0, 10))}, ${fmtHora.format(new Date(o.fin))}`}
                  {o.tipo === 'bloqueo' && <span className="muted">, bloqueo</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          Al reservar recibe una credencial con QR. Registre su llegada al comenzar y libere el equipo al terminar.
        </p>
      </aside>
      </div>

      <Modal abierto={eligiendo} titulo="Elegir equipo" descripcion={durValida ? resumenHorario(aIso(inicio), aIso(fin)) : undefined} onCerrar={() => setEligiendo(false)}>
        <div className="elegir-equipo">
          {categorias.map((cat) => (
            <div key={cat}>
              {categorias.length > 1 && <h3 className="disp-grupo__titulo">{cat}</h3>}
              <div className="sala-lista">
                {equipos.filter((e) => e.categoria === cat).map((e) => {
                  const libre = disponibles ? disponibles.includes(e.codigo) : null
                  return (
                    <button key={e.id} type="button" className="sala-fila" aria-current={e.codigo === equipo}
                            onClick={() => { setEquipo(e.codigo); setEligiendo(false) }}>
                      {fotoDe(e) ? (
                        <img className="sala-fila__foto" src={fotoDe(e) ?? undefined} alt="" loading="lazy" />
                      ) : (
                        <span className="sala-fila__foto sala-fila__foto--vacia" aria-hidden="true">
                          <Icon nombre="monitor" width={24} height={24} />
                        </span>
                      )}
                      <span className="sala-fila__texto">
                        <span className="sala-fila__titulo">
                          {e.codigo}
                          {textoSO(e) && <span className="sala-fila__so">{textoSO(e)}</span>}
                        </span>
                        {libre !== null && (
                          <span className="sala-fila__estado">
                            <span className={`punto-estado ${libre ? 'libre' : 'ocupado'}`} aria-hidden="true" />
                            {libre ? 'Libre en ese horario' : 'Ocupado en ese horario'}
                          </span>
                        )}
                      </span>
                      {e.codigo === equipo && <Icon nombre="check" width={20} height={20} className="sala-fila__flecha" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}

const COLOR_ACTIVIDAD: Record<string, string> = {
  Docencia: '#5B9BFF',
  Investigación: '#3FBF84',
  PAE: '#E5B53A',
  Semilleros: '#F39A3B',
  'Trabajo de grado': '#F06FA9',
  Otro: '#9C9C9C'
}

/** «3 h», «2 h 30 min», «1 día y 4 h», «7 días». */
function textoDuracion(h: number): string {
  const min = Math.round(h * 60)
  const dias = Math.floor(min / 1440)
  const horas = Math.floor((min % 1440) / 60)
  const mins = min % 60
  if (dias === 0) return mins ? (horas ? `${horas} h ${mins} min` : `${mins} min`) : `${horas} h`
  const d = `${dias} ${dias === 1 ? 'día' : 'días'}`
  return horas ? `${d} y ${horas} h` : d
}

const fmtHora = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' })
const fmtDiaLargo = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })

function nombreDia(iso: string): string {
  const d = new Date(iso)
  const hoy = new Date()
  const man = new Date()
  man.setDate(hoy.getDate() + 1)
  if (d.toDateString() === hoy.toDateString()) return 'hoy'
  if (d.toDateString() === man.toDateString()) return 'mañana'
  return fmtDiaLargo.format(d).replace(/\./g, '').replace(/,/g, '').replace(/ de /g, ' ')
}

/** «hoy de 11:00 a. m. a 2:00 p. m.» o «hoy 11:00 a. m. a mié 25 nov 2:00 p. m.». */
function resumenHorario(ini: string, fin: string): string {
  const a = new Date(ini)
  const b = new Date(fin)
  const dia = nombreDia(ini)
  const texto = a.toDateString() === b.toDateString()
    ? `${dia} de ${fmtHora.format(a)} a ${fmtHora.format(b)}`
    : `${dia} ${fmtHora.format(a)} a ${nombreDia(fin)} ${fmtHora.format(b)}`
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Fin de la reserva: solo la hora si termina el mismo día; si no, el día y la hora. */
function cuandoLargo(fin: string, ini: string): string {
  const a = new Date(ini)
  const b = new Date(fin)
  if (a.toDateString() === b.toDateString()) return fmtHora.format(b)
  const t = `${nombreDia(fin)}, ${fmtHora.format(b)}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function diaLegible(valor: string): string {
  const [y, m, d] = valor.split('-').map(Number)
  return fmtDiaLargo.format(new Date(y, m - 1, d, 12)).replace(/\./g, '').replace(/,/g, '').replace(/ de /g, ' ')
}
