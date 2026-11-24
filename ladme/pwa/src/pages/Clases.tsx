import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { esStaff, useAuth } from '../context/AuthContext'
import { cancelarClase, claseHoja, listarClases, miVerificacion, obtenerClase, salaPublica, solicitarClase, totalEquiposSala, type EquipoSala, type HojaClase } from '../lib/api'
import type { Clase, EstadoClase } from '../lib/types'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'

/**
 * Sala para clases: el docente pide la sala para su clase semanal, el personal la aprueba con los
 * equipos libres y el docente imprime la lista de equipos habilitados para sus estudiantes.
 */

export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export const TEXTO_ESTADO: Record<EstadoClase, { texto: string; tono: string }> = {
  pendiente: { texto: 'Pendiente', tono: 'warn' },
  aprobada: { texto: 'Aprobada', tono: 'ok' },
  rechazada: { texto: 'No aprobada', tono: 'danger' },
  cancelada: { texto: 'Cancelada', tono: 'gray' },
  vencida: { texto: 'Vencida', tono: 'gray' }
}

const hhmm = (t: string) => t.slice(0, 5)
const fechaCorta = (d: string) =>
  new Date(`${d}T12:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

export function textoHorario(c: Pick<Clase, 'dias' | 'hora_inicio' | 'hora_fin' | 'desde' | 'hasta'>): string {
  return `${c.dias.map((d) => CORTOS[d]).join(', ')} · ${hhmm(c.hora_inicio)}–${hhmm(c.hora_fin)} · ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}`
}

/** Fechas de cada sesión (para la hoja impresa y el conteo del formulario). */
export function sesiones(c: Pick<Clase, 'dias' | 'desde' | 'hasta'>): Date[] {
  const salida: Date[] = []
  const d = new Date(`${c.desde}T12:00`)
  const fin = new Date(`${c.hasta}T12:00`)
  while (d <= fin && salida.length < 200) {
    const iso = d.getDay() === 0 ? 7 : d.getDay()
    if (c.dias.includes(iso)) salida.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return salida
}

const hoyIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Formulario({ alEnviar }: { alEnviar: () => void }) {
  const { perfil } = useAuth()
  const [nombre, setNombre] = useState('')
  const [grupo, setGrupo] = useState('1')
  const [dias, setDias] = useState<number[]>([])
  const [inicio, setInicio] = useState('14:00')
  const [fin, setFin] = useState('16:00')
  const [desde, setDesde] = useState(hoyIso())
  const [hasta, setHasta] = useState('')
  const [maxEquipos, setMaxEquipos] = useState(0)
  const [equipos, setEquipos] = useState(8)
  const [todosLibres, setTodosLibres] = useState(false)
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    totalEquiposSala()
      .then((n) => {
        setMaxEquipos(n)
        setEquipos((x) => Math.min(x, Math.max(1, n)))
      })
      .catch(() => setMaxEquipos(0))
  }, [])

  const fechas = useMemo(() => (dias.length && desde && hasta ? sesiones({ dias, desde, hasta }) : []), [dias, desde, hasta])
  const n = fechas.length
  // Sesiones que aún no empiezan (una sesión de hoy cuya hora ya pasó no cuenta).
  const futuras = useMemo(
    () => fechas.filter((f) => new Date(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}T${inicio}`) > new Date()).length,
    [fechas, inicio]
  )

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!dias.length) return setError('Elija al menos un día de la semana.')
    if (!hasta) return setError('Indique hasta qué fecha se repite la clase.')
    if (n === 0) return setError('Entre esas fechas no cae ninguno de los días elegidos.')
    if (futuras === 0) return setError('Esas sesiones ya empezaron o pasaron: elija fechas u horas futuras.')
    setEnviando(true)
    try {
      await solicitarClase({
        nombre: nombre.trim(),
        docente: perfil?.nombre ?? '',
        grupo: Number(grupo),
        dias,
        horaInicio: inicio,
        horaFin: fin,
        desde,
        hasta,
        equipos: todosLibres ? null : equipos,
        notas: notas.trim() || null
      })
      alEnviar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="stack" onSubmit={enviar}>
      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor="cl-nombre">Nombre de la clase</label>
          <input id="cl-nombre" required minLength={3} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Estadística I" />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="cl-grupo">Grupo</label>
          <input id="cl-grupo" required type="number" min={1} max={999} inputMode="numeric" value={grupo} onChange={(e) => setGrupo(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <span className="field__label">Docente responsable</span>
        <div className="docente-fijo">
          <Icon nombre="usuario" width={16} height={16} />
          <span>
            <strong>{perfil?.nombre}</strong>
            <span className="small muted">{perfil?.correo}</span>
          </span>
        </div>
      </div>
      <div className="field">
        <span className="field__label">Días de clase</span>
        <div className="chips chips--envolver" role="group" aria-label="Días de clase">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <button
              key={d}
              type="button"
              className={`chip ${dias.includes(d) ? 'activo' : ''}`}
              aria-pressed={dias.includes(d)}
              onClick={() => setDias((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort()))}
            >
              {DIAS[d]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor="cl-inicio">Desde las</label>
          <input id="cl-inicio" type="time" required value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="cl-fin">Hasta las</label>
          <input id="cl-fin" type="time" required value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="cl-desde">Primera semana</label>
          <input id="cl-desde" type="date" required min={hoyIso()} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="cl-hasta">Se repite hasta</label>
          <input id="cl-hasta" type="date" required min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          <span className="field__hint">Para una sola sesión, ponga la misma fecha.</span>
        </div>
      </div>
      <div className="field">
        <span className="field__label" id="cl-equipos-l">Computadores que necesita</span>
        <div className={`rango-equipos ${todosLibres ? 'apagado' : ''}`}>
          <input
            type="range"
            min={1}
            max={Math.max(1, maxEquipos)}
            value={equipos}
            disabled={todosLibres || maxEquipos === 0}
            aria-labelledby="cl-equipos-l"
            onChange={(e) => setEquipos(Number(e.target.value))}
            style={{ ['--p' as string]: `${maxEquipos > 1 ? ((equipos - 1) / (maxEquipos - 1)) * 100 : 100}%` }}
          />
          <output className="rango-equipos__n num">{todosLibres ? <small>Todos</small> : <>{equipos}<span>/{maxEquipos || '…'}</span></>}</output>
        </div>
        <label className="check-row compacto">
          <input type="checkbox" checked={todosLibres} onChange={(e) => setTodosLibres(e.target.checked)} />
          <span>Los que haya disponibles</span>
        </label>
        <p className="help">
          Recuerde verificar la <Link to="/">agenda de los computadores</Link> para esos días y solicite una cantidad moderada.
        </p>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="cl-notas">Notas para el laboratorio (opcional)</label>
        <textarea id="cl-notas" maxLength={500} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Programas que usarán, si es un parcial…" />
      </div>
      {n > 0 && (
        <p className={`small ${futuras === 0 ? 'texto-aviso' : 'muted'}`} style={{ margin: 0 }}>
          {futuras === 0
            ? 'Esas sesiones ya empezaron o pasaron: elija fechas u horas futuras.'
            : `${futuras === 1 ? '1 sesión' : `${futuras} sesiones`}${futuras < n ? ` (${n - futuras} ya pasaron y no cuentan)` : ''}. El laboratorio asigna los computadores libres en todas ellas.`}
        </p>
      )}
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      <button type="submit" disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </form>
  )
}

export default function Clases() {
  const { perfil } = useAuth()
  const staff = esStaff(perfil)
  const docente = !!perfil?.docente_verificado_en || staff
  const enRevision = !docente && perfil?.tipo_usuario === 'Docente/Investigador'
  const [verif, setVerif] = useState<Awaited<ReturnType<typeof miVerificacion>>>(null)
  useEffect(() => {
    if (enRevision) void miVerificacion().then(setVerif)
  }, [enRevision])
  const [lista, setLista] = useState<Clase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const [enviada, setEnviada] = useState(false)

  const cargar = () =>
    listarClases()
      .then((l) => setLista(staff ? l.filter((c) => c.solicitante === perfil?.id) : l))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las clases.'))

  useEffect(() => {
    void cargar()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Docentes"
        titulo="Sala para clases"
        sub="Pida los computadores para su clase; el laboratorio le asigna los equipos libres."
        acciones={
          docente && (
            <button type="button" onClick={() => setNueva(true)}>
              <Icon nombre="calendario" width={16} height={16} /> Solicitar sala
            </button>
          )
        }
      />

      {enRevision ? (
        <div className="alert info">
          <Icon nombre="reloj" />
          <div className="alert__body">
            <strong>Su verificación como docente está en revisión.</strong> Cuando el laboratorio la confirme podrá pedir la sala.
            {!verif?.mensaje && (
              <> Para agilizarla, cuéntenos qué asignaturas dicta en <Link to="/cuenta#perfil">Cuenta</Link>.</>
            )}
          </div>
        </div>
      ) : (
        !docente && (
          <div className="alert info">
            <Icon nombre="info" />
            <div className="alert__body">
              Solo los docentes verificados pueden solicitar la sala para una clase. Si es docente, elija «Docente/Investigador» en{' '}
              <Link to="/cuenta#perfil">Cuenta</Link> y el laboratorio lo verificará.
            </div>
          </div>
        )
      )}
      {enviada && (
        <div className="alert ok" role="status">
          <Icon nombre="check" />
          <div className="alert__body">Solicitud enviada. El personal del laboratorio la revisa y le avisará por correo y en la app.</div>
        </div>
      )}
      {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}

      {!lista && !error ? (
        <Cargando texto="Cargando clases…" />
      ) : lista && lista.length === 0 ? (
        <div className="card">
          <Empty icono="calendario" titulo="Aún no ha pedido la sala">
            {docente ? 'Toque «Solicitar sala» para pedirla para una clase.' : 'Aquí aparecerán sus solicitudes.'}
          </Empty>
        </div>
      ) : (
        <ul className="lista-clases">
          {lista?.map((c) => (
            <li key={c.id}>
              <Link className="card clase-item" to={`/clases/${c.id}`}>
                <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <strong>{c.nombre} · grupo {c.grupo}</strong>
                  <span className={`badge ${TEXTO_ESTADO[c.estado].tono}`}>{TEXTO_ESTADO[c.estado].texto}</span>
                </span>
                <span className="small muted">{textoHorario(c)}</span>
                {c.estado === 'aprobada' && c.equipos && <span className="small">{c.equipos.length} equipos habilitados</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal abierto={nueva} titulo="Solicitar la sala para una clase" onCerrar={() => setNueva(false)}>
        <Formulario
          alEnviar={() => {
            setNueva(false)
            setEnviada(true)
            void cargar()
          }}
        />
      </Modal>
    </div>
  )
}

const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
const diaCorto = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Bogota' })

/** Autorización formal de la sala: lo que el docente imprime o guarda en PDF (también llega por correo). */
export function HojaAutorizacion({ h, sala }: { h: HojaClase; sala: EquipoSala[] }) {
  const habilitados = new Set(h.equipos)
  const conPlano = sala.length > 0 && sala.every((e) => e.x && e.y)
  const xs = sala.map((e) => e.x ?? 0)
  const ys = sala.map((e) => e.y ?? 0)
  const futuras = h.sesiones.filter((x) => !x.pasada).length
  return (
    <section className="card hoja-clase">
      <header className="hoja-clase__cabecera">
        <div>
          <div className="eyebrow">LADME · Laboratorio de Datos y Modelamiento Estadístico · UNAL Sede La Paz</div>
          <h2>Autorización de uso de sala</h2>
        </div>
        <div className="hoja-clase__folio">
          <span>N.º</span>
          <strong>{h.consecutivo}</strong>
        </div>
      </header>

      <dl className="hoja-clase__datos">
        <div className="d2"><dt>Clase</dt><dd>{h.nombre}</dd></div>
        <div><dt>Grupo</dt><dd>{h.grupo}</dd></div>
        <div><dt>Sesiones</dt><dd>{h.sesiones.length}{futuras < h.sesiones.length ? ` (${futuras} por realizar)` : ''}</dd></div>
        <div className="ancho"><dt>Docente responsable</dt><dd>{h.docente}{h.docente_correo && <span> · {h.docente_correo}</span>}</dd></div>
        <div><dt>Horario</dt><dd>{h.dias.map((d) => DIAS[d]).join(', ')} · {h.hora_inicio}–{h.hora_fin}</dd></div>
        <div><dt>Período</dt><dd>{fechaCorta(h.desde)} al {fechaCorta(h.hasta)}</dd></div>
        <div className="d2"><dt>Aprobada</dt><dd>{h.resuelto_en ? `${fechaLarga(h.resuelto_en)}${h.aprobado_por ? ` · ${h.aprobado_por}` : ''}` : '—'}</dd></div>
      </dl>

      <div className="hoja-clase__seccion">
        <h3>Equipos habilitados <span className="hoja-clase__n">{h.equipos.length}</span></h3>
        <ul className="hoja-clase__codigos">
          {h.equipos.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>

      {conPlano && (
        <div className="hoja-clase__seccion">
          <h3>Ubicación en la sala</h3>
          <div
            className="hoja-clase__plano"
            style={{ gridTemplateColumns: `repeat(${Math.max(...xs)}, 1fr)`, gridTemplateRows: `repeat(${Math.max(...ys)}, auto)` }}
          >
            {sala.map((e) => (
              <span key={e.codigo} className={habilitados.has(e.codigo) ? 'si' : ''} style={{ gridColumn: e.x ?? 1, gridRow: e.y ?? 1 }}>
                {e.codigo.replace(/^[A-Z]+-/, '')}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="hoja-clase__seccion">
        <h3>Fechas</h3>
        <ul className="hoja-clase__fechas">
          {h.sesiones.map((x) => (
            <li key={x.inicio} className={x.pasada ? 'pasada' : x.equipos < h.equipos.length ? 'parcial' : ''}>
              {diaCorto(x.inicio)}
              {!x.pasada && x.equipos < h.equipos.length && <span> · {x.equipos} eq.</span>}
            </li>
          ))}
        </ul>
        {h.omitidos.length > 0 && (
          <p className="small texto-aviso" style={{ margin: '6px 0 0' }}>
            Algunos equipos no quedaron reservados en ciertas fechas porque ya estaban ocupados:{' '}
            {h.omitidos.slice(0, 6).map((o) => `${o.codigo} (${diaCorto(o.inicio)})`).join(', ')}
            {h.omitidos.length > 6 ? ` y ${h.omitidos.length - 6} más` : ''}.
          </p>
        )}
      </div>

      {h.respuesta && (
        <p className="hoja-clase__nota-lab"><strong>Nota del laboratorio:</strong> {h.respuesta}</p>
      )}

      <ul className="hoja-clase__normas small">
        <li>Use solo los equipos de esta lista; los demás pueden estar reservados por otras personas.</li>
        <li>Durante la clase los equipos habilitados se desbloquean solos. Deje cada equipo como lo encontró y cierre su sesión.</li>
        <li>Si un equipo habilitado falla, repórtelo desde su ficha (código QR del equipo) o avise al personal del laboratorio.</li>
      </ul>
      <footer className="hoja-clase__pie tiny">
        Documento generado por LADME · {h.consecutivo} · {fechaLarga(new Date().toISOString())}
      </footer>
    </section>
  )
}

/** Detalle de una clase con la autorización imprimible. */
export function ClaseDetalle() {
  const { id } = useParams()
  const { perfil } = useAuth()
  const staff = esStaff(perfil)
  const [c, setC] = useState<Clase | null | undefined>(undefined)
  const [hoja, setHoja] = useState<HojaClase | null>(null)
  const [sala, setSala] = useState<EquipoSala[]>([])
  const [cancelar, setCancelar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cargar = () =>
    obtenerClase(Number(id))
      .then((x) => {
        setC(x)
        if (x?.estado === 'aprobada') claseHoja(x.id).then(setHoja).catch(() => setHoja(null))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar.'))

  useEffect(() => {
    void cargar()
    salaPublica().then(setSala).catch(() => setSala([]))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (c === undefined && !error) return <Cargando texto="Cargando clase…" />
  if (!c) return <div className="card"><Empty icono="buscar" titulo="Clase no encontrada">{error ?? 'Puede que no tenga acceso a esta solicitud.'}</Empty></div>

  const puedeCancelar = (c.estado === 'pendiente' || c.estado === 'aprobada') && (c.solicitante === perfil?.id || staff)

  return (
    <div className="stack clase-detalle">
      <PageHeader
        volver={staff && c.solicitante !== perfil?.id ? { a: '/admin?tab=solicitudes', texto: 'Solicitudes' } : { a: '/clases', texto: 'Clases' }}
        titulo={`${c.nombre} · grupo ${c.grupo}`}
        sub={textoHorario(c)}
        acciones={
          <span className="row tight no-imprimir">
            {c.estado === 'aprobada' && (
              <button type="button" onClick={() => window.print()}>
                <Icon nombre="imprimir" width={16} height={16} /> Imprimir o guardar PDF
              </button>
            )}
            {staff && c.estado === 'pendiente' && (
              <Link className="btn" to={`/admin/clases/${c.id}`}>Revisar y aprobar</Link>
            )}
            {puedeCancelar && (
              <button type="button" className="btn ghost" onClick={() => setCancelar(true)}>
                Cancelar clase
              </button>
            )}
          </span>
        }
      />
      <span className={`badge ${TEXTO_ESTADO[c.estado].tono} no-imprimir`} style={{ alignSelf: 'flex-start' }}>
        {TEXTO_ESTADO[c.estado].texto}
      </span>
      {c.estado !== 'aprobada' && c.respuesta && (
        <div className="alert info">
          <Icon nombre="info" />
          <div className="alert__body"><strong>Nota del laboratorio:</strong> {c.respuesta}</div>
        </div>
      )}
      {c.estado === 'pendiente' && (
        <p className="small muted">El personal del laboratorio está revisando la solicitud. Recibirá la autorización por correo y en la app.</p>
      )}

      {c.estado === 'aprobada' && (hoja ? <HojaAutorizacion h={hoja} sala={sala} /> : <Cargando texto="Preparando la autorización…" />)}

      <Modal abierto={cancelar} titulo="Cancelar la clase" onCerrar={() => setCancelar(false)}>
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>Se liberan todas las sesiones que aún no han ocurrido.</p>
          <div className="field">
            <label className="field__label" htmlFor="cl-motivo">Motivo (opcional)</label>
            <input id="cl-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
          </div>
          {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}
          <button
            type="button"
            className="btn danger"
            onClick={() =>
              void cancelarClase(c.id, motivo)
                .then(() => cargar())
                .then(() => setCancelar(false))
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cancelar.'))
            }
          >
            Cancelar la clase
          </button>
        </div>
      </Modal>
    </div>
  )
}
