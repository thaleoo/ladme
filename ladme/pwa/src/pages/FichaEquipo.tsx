import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  alternarAlerta, contactarTitular, crearReserva, listarReportes, obtenerEquipo, tengoAlerta, ocupacionPublica, mantenimientoDelEquipo, registrarLlegada,
  type EstadoMantenimientoEquipo
} from '../lib/api'
import { esStaff, useAuth } from '../context/AuthContext'
import { ACTIVIDADES, perfilCompleto, type Equipo, type Ocupacion, type Reporte } from '../lib/types'
import ReporteFalla from '../components/ReporteFalla'
import { conPunto, dia, diaCorto, fecha, finDia, hora, inicioDia, nuevoIdSolicitud, sumarDias } from '../lib/format'
import PageHeader, { Cargando } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'

const RAPIDAS = [1, 2, 4, 8, 12, 24]
const CLAVE_ACTIVIDAD = 'ladme-ultima-actividad'

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
  const navigate = useNavigate()
  const toast = useToast()
  const [dialogo, setDialogo] = useState<'rapida' | 'contacto' | 'falla' | null>(null)
  const [alerta, setAlerta] = useState(false)
  const [reportes, setReportes] = useState<Reporte[]>([])

  const cargarReportes = (equipoId: string) =>
    listarReportes(equipoId)
      .then((l) => setReportes(l.filter((x) => x.estado === 'abierto' || x.estado === 'en_revision')))
      .catch(() => undefined)

  useEffect(() => {
    if (!equipo?.id) return
    void tengoAlerta(equipo.id).then(setAlerta)
    void cargarReportes(equipo.id)
  }, [equipo?.id])

  async function cambiarAlerta() {
    if (!equipo) return
    try {
      const activa = await alternarAlerta(equipo.codigo)
      setAlerta(activa)
      toast.mostrar(activa ? 'Listo: le avisaremos cuando quede libre.' : 'Alerta desactivada.')
    } catch (e) {
      toast.mostrar(e instanceof Error ? e.message : 'No se pudo cambiar la alerta.', 'warn')
    }
  }
  const [horasRapida, setHorasRapida] = useState(2)
  const [actividad, setActividad] = useState(() => localStorage.getItem(CLAVE_ACTIVIDAD) ?? '')
  const [desatendido, setDesatendido] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [idSolicitud, setIdSolicitud] = useState(() => nuevoIdSolicitud())

  async function reservarYa() {
    if (!equipo) return
    if (!actividad) return setErrorDialogo('Seleccione el tipo de actividad.')
    setOcupado(true)
    setErrorDialogo(null)
    try {
      const ini = new Date()
      const r = await crearReserva({
        equipo: equipo.codigo,
        inicio: ini.toISOString(),
        fin: new Date(ini.getTime() + horasRapida * 3600000).toISOString(),
        actividad,
        desatendido,
        mensaje: desatendido ? mensaje.trim() || undefined : undefined,
        idSolicitud
      })
      // Está frente al equipo: la llegada queda registrada de una vez.
      await registrarLlegada(r.id).catch(() => undefined)
      localStorage.setItem(CLAVE_ACTIVIDAD, actividad)
      setIdSolicitud(nuevoIdSolicitud())
      navigate(`/credencial/${r.id}`, { state: { recienCreada: true } })
    } catch (e) {
      setErrorDialogo(e instanceof Error ? e.message : 'No se pudo crear la reserva.')
    } finally {
      setOcupado(false)
    }
  }

  async function enviarContacto() {
    if (!equipo) return
    setOcupado(true)
    setErrorDialogo(null)
    try {
      await contactarTitular(equipo.codigo, texto.trim())
      setDialogo(null)
      setTexto('')
      toast.mostrar('Mensaje enviado. Quien tiene el equipo podrá responderle a su correo.')
    } catch (e) {
      setErrorDialogo(e instanceof Error ? e.message : 'No se pudo enviar el mensaje.')
    } finally {
      setOcupado(false)
    }
  }

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
  const siguiente = ocupacion
    .filter((o) => new Date(o.inicio) > ahora)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))[0]
  const horasLibres = siguiente ? (new Date(siguiente.inicio).getTime() - ahora.getTime()) / 3600000 : Infinity
  const rapidas = RAPIDAS.filter((h) => h <= horasLibres)

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

      {libre && (
        <section className="card accent">
          <div className="row between" style={{ gap: 'var(--s3)' }}>
            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
              <h3 style={{ fontSize: 'var(--text-base)', margin: 0 }}>
                <Icon nombre="chispa" width={16} height={16} /> ¿Está frente al equipo?
              </h3>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                {rapidas.length
                  ? `Resérvelo desde ya, sin llenar el formulario.${siguiente ? ` ${conPunto(`Libre hasta ${fecha(siguiente.inicio)}`)}` : ''}`
                  : `Hay otra reserva a las ${hora(siguiente!.inicio)}: no alcanza para una reserva rápida.`}
              </p>
            </div>
            {rapidas.length > 0 && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setErrorDialogo(null)
                  setHorasRapida(rapidas.includes(2) ? 2 : rapidas[0])
                  setDialogo('rapida')
                }}
              >
                <Icon nombre="reproducir" /> Usar ahora
              </button>
            )}
          </div>
        </section>
      )}

      {enCurso && enCurso.tipo === 'reserva' && (
        <section className="card">
          <div className="row between" style={{ gap: 'var(--s3)' }}>
            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
              <h3 style={{ fontSize: 'var(--text-base)', margin: 0 }}>Reservado hasta {fecha(enCurso.fin)}</h3>
              {enCurso.desatendido && (
                <p className="small" style={{ margin: '4px 0 0' }}>
                  <span className="badge warn">Proceso desatendido</span>{' '}
                  {enCurso.mensaje_llegada || 'Hay algo ejecutándose: no apague ni cierre sesión.'}
                </p>
              )}
              <p className="tiny muted" style={{ margin: '4px 0 0' }}>
                Por privacidad no se muestra quién lo reservó, pero puede escribirle por aquí.
              </p>
            </div>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setErrorDialogo(null)
                setDialogo('contacto')
              }}
            >
              <Icon nombre="campana" /> Preguntar si lo libera
            </button>
            <button className={`btn ${alerta ? 'gray' : 'ghost'}`} type="button" onClick={cambiarAlerta} aria-pressed={alerta}>
              <Icon nombre="chispa" /> {alerta ? 'Alerta activa: quitar' : 'Avisarme cuando se libere'}
            </button>
          </div>
        </section>
      )}

      {enCurso && enCurso.tipo === 'bloqueo' && (
        <div className="alert warn">
          <Icon nombre="llave" />
          <div className="alert__body">
            <strong>{conPunto(`Equipo bloqueado hasta ${fecha(enCurso.fin)}`)}</strong> {enCurso.motivo}
          </div>
        </div>
      )}

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
        <div className="row between" style={{ gap: 'var(--s3)' }}>
          <div style={{ minWidth: 0, flex: '1 1 220px' }}>
            <h3 style={{ fontSize: 'var(--text-base)', margin: 0 }}>¿Algo no funciona?</h3>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              {reportes.length
                ? `${reportes.length === 1 ? 'Hay 1 reporte' : `Hay ${reportes.length} reportes`} en revisión para este equipo.`
                : 'Avise al laboratorio para que lo revisen. Toma menos de un minuto.'}
            </p>
          </div>
          <button className="btn ghost" type="button" onClick={() => setDialogo('falla')}>
            <Icon nombre="alerta" /> Reportar un problema
          </button>
        </div>
        {reportes.length > 0 && (
          <ul className="small" style={{ margin: 'var(--s3) 0 0', paddingLeft: '1.05rem' }}>
            {reportes.slice(0, 4).map((x) => (
              <li key={x.id}>
                <strong>{x.categoria}:</strong> {x.descripcion}{' '}
                <span className="muted">· {x.estado === 'abierto' ? 'recibido' : 'en revisión'}</span>
              </li>
            ))}
          </ul>
        )}
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

      <Modal
        abierto={dialogo === 'rapida'}
        titulo={`Usar ${equipo.codigo} ahora`}
        descripcion="La reserva empieza en este momento y su llegada queda registrada."
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" type="button" onClick={() => setDialogo(null)} disabled={ocupado}>
              Volver
            </button>
            <button className="btn" type="button" onClick={reservarYa} disabled={ocupado || !perfilCompleto(perfil)}>
              {ocupado ? 'Reservando…' : `Reservar ${horasRapida} h`}
            </button>
          </>
        }
      >
        {!perfilCompleto(perfil) ? (
          <div className="alert warn">
            <Icon nombre="alerta" />
            <div className="alert__body">
              Complete primero sus datos académicos en <Link to="/cuenta">Mi cuenta</Link>. Solo se piden una vez.
            </div>
          </div>
        ) : (
          <div className="stack">
            <div>
              <span className="field__label">Duración</span>
              <div className="chips">
                {rapidas.map((h) => (
                  <button key={h} type="button" className="chip" aria-pressed={h === horasRapida} onClick={() => setHorasRapida(h)}>
                    {h} h
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rapida-actividad">
                Tipo de actividad
              </label>
              <select id="rapida-actividad" value={actividad} onChange={(e) => setActividad(e.target.value)}>
                <option value="" disabled>
                  Seleccione
                </option>
                {ACTIVIDADES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={desatendido} onChange={(e) => setDesatendido(e.target.checked)} />
              <span>
                <strong>Proceso desatendido</strong>
                Dejaré algo ejecutándose sin estar presente.
              </span>
            </label>
            {desatendido && (
              <div className="field">
                <label className="field__label" htmlFor="rapida-mensaje">
                  Mensaje para quien llegue
                </label>
                <input id="rapida-mensaje" value={mensaje} maxLength={140} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej. No cerrar el navegador." />
              </div>
            )}
          </div>
        )}
        {errorDialogo && (
          <div className="alert danger mt">
            <Icon nombre="alerta" />
            <div className="alert__body">{errorDialogo}</div>
          </div>
        )}
      </Modal>

      <Modal
        abierto={dialogo === 'contacto'}
        titulo="Preguntar por el equipo"
        descripcion="Le llega un aviso a quien lo tiene reservado. Esa persona verá su correo para poder responderle; usted no verá el suyo."
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" type="button" onClick={() => setDialogo(null)} disabled={ocupado}>
              Volver
            </button>
            <button className="btn" type="button" onClick={enviarContacto} disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Enviar mensaje'}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field__label" htmlFor="contacto-texto">
            Mensaje <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span>
          </label>
          <textarea
            id="contacto-texto"
            rows={3}
            maxLength={300}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ej. ¿Le falta mucho? Necesito el equipo una hora."
          />
        </div>
        {errorDialogo && (
          <div className="alert danger mt">
            <Icon nombre="alerta" />
            <div className="alert__body">{errorDialogo}</div>
          </div>
        )}
      </Modal>

      <ReporteFalla
        equipo={equipo.codigo}
        abierto={dialogo === 'falla'}
        alCerrar={() => setDialogo(null)}
        alEnviar={() => void cargarReportes(equipo.id)}
      />
    </>
  )
}
