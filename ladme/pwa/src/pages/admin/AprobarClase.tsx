import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { aprobarClase, clasePrevia, claseReenviar, obtenerClase, rechazarClase, type PreviaClase } from '../../lib/api'
import type { Clase } from '../../lib/types'
import { hace } from '../../lib/format'
import { DIAS, TEXTO_ESTADO, textoHorario } from '../Clases'
import PageHeader, { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

const diaCorto = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Bogota' })

/**
 * Aprobación de una solicitud de sala, en su propia página: revisar la solicitud, elegir los
 * equipos libres en todas las sesiones y aprobar. El docente recibe la autorización con PDF por
 * correo y en la app.
 */
export default function AprobarClase() {
  const { id } = useParams()
  const toast = useToast()
  const [c, setC] = useState<Clase | null | undefined>(undefined)
  const [previa, setPrevia] = useState<PreviaClase | null>(null)
  const [elegidos, setElegidos] = useState<string[]>([])
  const [verOcupados, setVerOcupados] = useState(false)
  const [nota, setNota] = useState('')
  const [rechazo, setRechazo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ creadas: number; omitidas: number } | null>(null)

  useEffect(() => {
    obtenerClase(Number(id))
      .then(async (x) => {
        setC(x)
        if (x?.estado !== 'pendiente') return
        const p = await clasePrevia(x.id)
        setPrevia(p)
        const libres = p.equipos.filter((e) => p.total_sesiones > 0 && e.libres === p.total_sesiones).map((e) => e.codigo)
        setElegidos(x.equipos_pedidos ? libres.slice(0, x.equipos_pedidos) : libres)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar la solicitud.'))
  }, [id])

  const libres = useMemo(
    () => (previa && previa.total_sesiones > 0 ? previa.equipos.filter((e) => e.libres === previa.total_sesiones) : []),
    [previa]
  )
  const parciales = useMemo(
    () => (previa && previa.total_sesiones > 0 ? previa.equipos.filter((e) => e.libres < previa.total_sesiones) : []),
    [previa]
  )

  if (c === undefined && !error) return <Cargando texto="Cargando solicitud…" />
  if (!c) return <div className="card"><Empty icono="buscar" titulo="Solicitud no encontrada">{error ?? ''}</Empty></div>

  const pedidos = c.equipos_pedidos
  const meta = pedidos ?? libres.length
  const alternar = (codigo: string) =>
    setElegidos((x) => (x.includes(codigo) ? x.filter((y) => y !== codigo) : [...x, codigo].sort()))

  async function aprobar() {
    if (!c) return
    setOcupado(true)
    setError(null)
    try {
      const r = await aprobarClase(c.id, elegidos, nota.trim() || undefined)
      setHecho({ creadas: r.creadas, omitidas: r.omitidas.length })
      setC({ ...c, estado: 'aprobada', equipos: elegidos })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar.')
    } finally {
      setOcupado(false)
    }
  }

  async function rechazar() {
    if (!c || rechazo === null) return
    setOcupado(true)
    setError(null)
    try {
      await rechazarClase(c.id, rechazo)
      toast.mostrar('Solicitud rechazada; el docente recibe el motivo.', 'ok')
      setC({ ...c, estado: 'rechazada', respuesta: rechazo })
      setRechazo(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo rechazar.')
    } finally {
      setOcupado(false)
    }
  }

  async function reenviar() {
    if (!c) return
    try {
      await claseReenviar(c.id)
      toast.mostrar('Listo: la autorización sale al correo del docente en unos minutos.', 'ok')
    } catch (e) {
      toast.mostrar(e instanceof Error ? e.message : 'No se pudo reenviar.', 'danger')
    }
  }

  const cabecera = (
    <PageHeader
      volver={{ a: '/admin?tab=solicitudes', texto: 'Solicitudes y clases' }}
      titulo={`${c.nombre} · grupo ${c.grupo}`}
      sub={textoHorario(c)}
    />
  )

  if (c.estado !== 'pendiente') {
    return (
      <div className="stack aprobar-clase">
        {cabecera}
        {hecho ? (
          <section className="card aprobar-hecho">
            <span className="aprobar-hecho__icono"><Icon nombre="check" width={28} height={28} /></span>
            <h2>Clase aprobada</h2>
            <p className="small muted">
              {hecho.creadas} bloqueos creados en {c.equipos?.length} equipos
              {hecho.omitidas ? ` · ${hecho.omitidas} omitidos porque ya estaban ocupados` : ''}. {c.docente} recibe la autorización con
              PDF en su correo en los próximos minutos y también la ve en la app.
            </p>
            <div className="row tight aprobar-hecho__acciones">
              <Link className="btn" to={`/clases/${c.id}`}><Icon nombre="imprimir" width={16} height={16} /> Ver autorización</Link>
              <button type="button" className="btn ghost" onClick={() => void reenviar()}>Reenviar correo</button>
              <Link className="btn ghost" to="/admin?tab=solicitudes">Volver</Link>
            </div>
          </section>
        ) : (
          <section className="card stack">
            <span className={`badge ${TEXTO_ESTADO[c.estado].tono}`} style={{ justifySelf: 'start' }}>{TEXTO_ESTADO[c.estado].texto}</span>
            {c.equipos && <p className="small" style={{ margin: 0 }}>Equipos: {c.equipos.join(', ')}</p>}
            {c.respuesta && <p className="small muted" style={{ margin: 0 }}>Nota: {c.respuesta}</p>}
            {c.estado === 'aprobada' && (
              <div className="row tight">
                <Link className="btn" to={`/clases/${c.id}`}><Icon nombre="imprimir" width={16} height={16} /> Ver autorización</Link>
                <button type="button" className="btn ghost" onClick={() => void reenviar()}>Reenviar correo al docente</button>
              </div>
            )}
          </section>
        )}
      </div>
    )
  }

  const sinSesiones = previa !== null && previa.total_sesiones === 0
  const visibles = verOcupados ? [...libres, ...parciales] : libres

  return (
    <div className="stack aprobar-clase">
      {cabecera}

      <section className="card tight aprobar-paso">
        <h2 className="aprobar-paso__t"><span>1</span> Solicitud</h2>
        <dl className="aprobar-datos">
          <div>
            <dt>Docente</dt>
            <dd>
              {c.docente}
              {c.docente_correo && <a className="small" href={`mailto:${c.docente_correo}`}>{c.docente_correo}</a>}
            </dd>
          </div>
          <div><dt>Pide</dt><dd>{pedidos ? `${pedidos} equipos` : 'Los que haya disponibles'}</dd></div>
          <div><dt>Horario</dt><dd>{c.dias.map((d) => DIAS[d]).join(', ')} · {c.hora_inicio.slice(0, 5)}–{c.hora_fin.slice(0, 5)}</dd></div>
          <div><dt>Enviada</dt><dd>{hace(c.creado_en)}</dd></div>
        </dl>
        {c.notas && <p className="aprobar-notas small">«{c.notas}»</p>}
        {previa && previa.sesiones.length > 0 && (
          <ul className="aprobar-sesiones" aria-label="Sesiones por realizar">
            {previa.sesiones.map((s) => (
              <li key={s.inicio} className={s.libres < meta ? 'justa' : ''}>
                <span>{diaCorto(s.inicio)}</span>
                <strong className="num">{s.libres}</strong>
                <span className="tiny">libres</span>
              </li>
            ))}
          </ul>
        )}
        {previa && previa.pasadas > 0 && (
          <p className="tiny muted" style={{ margin: 0 }}>
            {previa.pasadas === 1 ? '1 sesión ya pasó y no se bloquea.' : `${previa.pasadas} sesiones ya pasaron y no se bloquean.`}
          </p>
        )}
      </section>

      {!previa && !error ? (
        <Cargando texto="Calculando equipos libres en cada sesión…" />
      ) : sinSesiones ? (
        <div className="alert warn">
          <Icon nombre="alerta" />
          <div className="alert__body">
            <strong>Todas las sesiones de esta solicitud ya empezaron o pasaron.</strong> No hay nada que bloquear: rechácela con una nota
            para que el docente envíe una nueva con fechas futuras.
          </div>
        </div>
      ) : (
        previa && (
          <section className="card tight aprobar-paso">
            <div className="aprobar-paso__cab">
              <h2 className="aprobar-paso__t"><span>2</span> Equipos</h2>
              <span className={`aprobar-contador ${pedidos && elegidos.length !== pedidos ? 'aviso' : ''}`}>
                <strong className="num">{elegidos.length}</strong>
                {pedidos ? ` de ${pedidos} pedidos` : ' elegidos'}
              </span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {libres.length} de {previa.total_equipos} equipos están libres en las {previa.total_sesiones} sesiones.
              {pedidos && libres.length < pedidos && <span className="texto-aviso"> No alcanzan para los {pedidos} pedidos.</span>}
            </p>
            <div className="aprobar-rapido" role="group" aria-label="Selección rápida">
              <button type="button" className="chip" onClick={() => setElegidos(libres.map((e) => e.codigo))}>
                Seleccionar todos ({libres.length})
              </button>
              {pedidos && pedidos < libres.length && (
                <button type="button" className="chip" onClick={() => setElegidos(libres.slice(0, pedidos).map((e) => e.codigo))}>
                  Los {pedidos} pedidos
                </button>
              )}
              <button type="button" className="chip" onClick={() => setElegidos([])} disabled={elegidos.length === 0}>
                Ninguno
              </button>
              {parciales.length > 0 && (
                <label className="aprobar-ocupados small">
                  <input type="checkbox" checked={verOcupados} onChange={(e) => setVerOcupados(e.target.checked)} />
                  Mostrar los ocupados en alguna sesión ({parciales.length})
                </label>
              )}
            </div>
            {visibles.length === 0 ? (
              <p className="small muted">No hay equipos libres en todas las sesiones.</p>
            ) : (
              <ul className="selector-equipos">
                {visibles.map((e) => {
                  const activo = elegidos.includes(e.codigo)
                  const parcial = e.libres < previa.total_sesiones
                  return (
                    <li key={e.codigo}>
                      <button
                        type="button"
                        className={`selector-equipo ${activo ? 'activo' : ''} ${parcial ? 'parcial' : ''}`}
                        aria-pressed={activo}
                        onClick={() => alternar(e.codigo)}
                      >
                        <span className="selector-equipo__check" aria-hidden="true"><Icon nombre="check" width={12} height={12} /></span>
                        <strong>{e.codigo}</strong>
                        <span className="tiny">{parcial ? `Libre en ${e.libres}/${previa.total_sesiones}` : e.nombre}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {elegidos.some((x) => parciales.some((p) => p.codigo === x)) && (
              <p className="tiny muted" style={{ margin: 0 }}>Los equipos ocupados en alguna sesión solo se bloquean en las sesiones en que están libres.</p>
            )}
          </section>
        )
      )}

      {previa && (
        <section className="card tight aprobar-paso">
          <h2 className="aprobar-paso__t"><span>{sinSesiones ? 2 : 3}</span> Respuesta</h2>
          {!sinSesiones && (
            <div className="field">
              <label className="field__label" htmlFor="ap-nota">Nota para el docente (opcional)</label>
              <textarea id="ap-nota" rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)}
                        placeholder="Lleguen 5 minutos antes; los equipos tienen R y Python instalados…" />
              <p className="help">Va en la autorización y en el correo. El correo sale con un PDF de la autorización y se responde a usted.</p>
            </div>
          )}
          {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}
        </section>
      )}

      {previa && (
        <div className="aprobar-barra">
          <span className="small">
            {sinSesiones ? 'Nada que bloquear' : <><strong className="num">{elegidos.length}</strong> eq. × <strong className="num">{previa.total_sesiones}</strong> ses.</>}
          </span>
          <span className="row tight">
            <button type="button" className="btn ghost" onClick={() => setRechazo('')} disabled={ocupado}>Rechazar</button>
            {!sinSesiones && (
              <button type="button" onClick={() => void aprobar()} disabled={ocupado || elegidos.length === 0}>
                <Icon nombre="check" width={16} height={16} /> {ocupado ? 'Aprobando…' : 'Aprobar'}
              </button>
            )}
          </span>
        </div>
      )}

      <Modal abierto={rechazo !== null} titulo="Rechazar la solicitud" onCerrar={() => setRechazo(null)}>
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="ap-motivo">Motivo para el docente</label>
            <textarea id="ap-motivo" rows={3} maxLength={500} value={rechazo ?? ''} onChange={(e) => setRechazo(e.target.value)}
                      placeholder={sinSesiones ? 'Las fechas ya pasaron; envíe una nueva solicitud con fechas futuras.' : 'La sala está ocupada en ese horario…'} />
          </div>
          {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}
          <button type="button" className="btn danger" disabled={ocupado || (rechazo ?? '').trim().length < 5} onClick={() => void rechazar()}>
            Rechazar solicitud
          </button>
        </div>
      </Modal>
    </div>
  )
}
