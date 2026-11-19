import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { aprobarClase, clasePrevia, listarClases, rechazarClase, type PreviaClase } from '../../lib/api'
import type { Clase } from '../../lib/types'
import { hace } from '../../lib/format'
import { TEXTO_ESTADO, textoHorario } from '../Clases'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

/**
 * Solicitudes de sala para clases. Aprobar es casi automático: se calculan los equipos libres en
 * todas las sesiones, se marcan los que pidió el docente y con un clic se crean los bloqueos.
 */
export default function SolicitudesClase() {
  const toast = useToast()
  const [lista, setLista] = useState<Clase[] | null>(null)
  const [verTodas, setVerTodas] = useState(false)
  const [sel, setSel] = useState<Clase | null>(null)
  const [previa, setPrevia] = useState<PreviaClase | null>(null)
  const [elegidos, setElegidos] = useState<string[]>([])
  const [respuesta, setRespuesta] = useState('')
  const [rechazar, setRechazar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => listarClases(!verTodas).then(setLista).catch(() => setLista([])), [verTodas])
  useEffect(() => {
    void cargar()
  }, [cargar])

  async function abrir(c: Clase) {
    setSel(c)
    setPrevia(null)
    setElegidos([])
    setRespuesta('')
    setRechazar(false)
    setError(null)
    if (c.estado !== 'pendiente') return
    try {
      const p = await clasePrevia(c.id)
      setPrevia(p)
      // Preselección: los libres en TODAS las sesiones, hasta los que pidió el docente.
      const todas = p.equipos.filter((e) => e.libres === p.total_sesiones).map((e) => e.codigo)
      setElegidos(c.equipos_pedidos ? todas.slice(0, c.equipos_pedidos) : todas)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular la disponibilidad.')
    }
  }

  const libresTodas = useMemo(() => previa?.equipos.filter((e) => e.libres === previa.total_sesiones).length ?? 0, [previa])

  async function aprobar() {
    if (!sel) return
    setOcupado(true)
    setError(null)
    try {
      const r = await aprobarClase(sel.id, elegidos, respuesta.trim() || undefined)
      toast.mostrar(
        `Clase aprobada: ${r.creadas} bloqueos creados${r.omitidas.length ? `, ${r.omitidas.length} sesiones omitidas por choque` : ''}.`,
        'ok'
      )
      setSel(null)
      void cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar.')
    } finally {
      setOcupado(false)
    }
  }

  async function confirmarRechazo() {
    if (!sel) return
    setOcupado(true)
    setError(null)
    try {
      await rechazarClase(sel.id, respuesta)
      toast.mostrar('Solicitud rechazada; el docente recibe el motivo.', 'ok')
      setSel(null)
      void cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo rechazar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="card tight stack">
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Sala para clases</h2>
        <button className="link-btn small" type="button" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? 'Ver solo pendientes' : 'Ver todas'}
        </button>
      </div>
      {!lista ? (
        <p className="small muted">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {verTodas ? 'Aún no hay solicitudes de clase.' : 'No hay solicitudes de clase pendientes.'}
        </p>
      ) : (
        <ul className="lista-clases">
          {lista.map((c) => (
            <li key={c.id}>
              <button type="button" className="card clase-item clase-item--boton" onClick={() => void abrir(c)}>
                <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <strong>
                    {c.nombre} · grupo {c.grupo}
                  </strong>
                  <span className={`badge ${TEXTO_ESTADO[c.estado].tono}`}>{TEXTO_ESTADO[c.estado].texto}</span>
                </span>
                <span className="small muted">{textoHorario(c)}</span>
                <span className="tiny muted">
                  {c.docente}
                  {c.equipos_pedidos ? ` · pide ${c.equipos_pedidos} equipos` : ''} · {hace(c.creado_en)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal abierto={!!sel} titulo={sel ? `${sel.nombre} · grupo ${sel.grupo}` : ''} onCerrar={() => setSel(null)}>
        {sel && (
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              {textoHorario(sel)}
              <br />
              Docente: <strong>{sel.docente}</strong>
              {sel.equipos_pedidos ? ` · pide ${sel.equipos_pedidos} equipos` : ''}
            </p>
            {sel.notas && <p className="small muted" style={{ margin: 0 }}>«{sel.notas}»</p>}

            {sel.estado !== 'pendiente' ? (
              <>
                <span className={`badge ${TEXTO_ESTADO[sel.estado].tono}`} style={{ justifySelf: 'start' }}>{TEXTO_ESTADO[sel.estado].texto}</span>
                {sel.equipos && <p className="small" style={{ margin: 0 }}>Equipos: {sel.equipos.join(', ')}</p>}
                {sel.respuesta && <p className="small muted" style={{ margin: 0 }}>Nota: {sel.respuesta}</p>}
                <Link className="btn ghost" to={`/clases/${sel.id}`}>Ver hoja de la clase</Link>
              </>
            ) : !previa && !error ? (
              <p className="small muted">Calculando equipos libres en cada sesión…</p>
            ) : previa ? (
              <>
                <p className="small" style={{ margin: 0 }}>
                  <strong>{previa.total_sesiones}</strong> sesiones · <strong>{libresTodas}</strong> equipos libres en todas.
                  {sel.equipos_pedidos && libresTodas < sel.equipos_pedidos && (
                    <span className="texto-aviso"> No alcanzan para los {sel.equipos_pedidos} pedidos.</span>
                  )}
                </p>
                <div className="chips clase-equipos" role="group" aria-label="Equipos para la clase">
                  {previa.equipos.map((e) => {
                    const completo = e.libres === previa.total_sesiones
                    const activo = elegidos.includes(e.codigo)
                    return (
                      <button
                        key={e.codigo}
                        type="button"
                        className={`chip ${activo ? 'activo' : ''} ${completo ? '' : 'parcial'}`}
                        aria-pressed={activo}
                        title={completo ? 'Libre en todas las sesiones' : `Libre en ${e.libres} de ${previa.total_sesiones} sesiones`}
                        onClick={() => setElegidos((x) => (x.includes(e.codigo) ? x.filter((y) => y !== e.codigo) : [...x, e.codigo].sort()))}
                      >
                        {e.codigo}
                        {!completo && <span className="tiny"> {e.libres}/{previa.total_sesiones}</span>}
                      </button>
                    )
                  })}
                </div>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Marcados: {elegidos.length}. Los que muestran «n/m» no están libres en todas las sesiones; en las que choquen no se
                  bloquean.
                </p>
                <div className="field">
                  <label className="field__label" htmlFor="cl-resp">{rechazar ? 'Motivo para el docente' : 'Nota para el docente (opcional)'}</label>
                  <textarea id="cl-resp" rows={2} maxLength={500} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
                </div>
                {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}
                {rechazar ? (
                  <div className="row tight">
                    <button type="button" className="btn danger" disabled={ocupado || respuesta.trim().length < 5} onClick={() => void confirmarRechazo()}>
                      Rechazar solicitud
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setRechazar(false)}>Volver</button>
                  </div>
                ) : (
                  <div className="row tight" style={{ flexWrap: 'wrap' }}>
                    <button type="button" disabled={ocupado || elegidos.length === 0} onClick={() => void aprobar()}>
                      <Icon nombre="check" width={16} height={16} /> Aprobar con {elegidos.length} equipos
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setRechazar(true)}>Rechazar</button>
                  </div>
                )}
              </>
            ) : (
              error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}
