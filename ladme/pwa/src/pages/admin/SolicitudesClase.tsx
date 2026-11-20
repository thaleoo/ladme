import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarClases, resolverVerificacion, verificacionesPendientes, type VerificacionDocente } from '../../lib/api'
import type { Clase } from '../../lib/types'
import { hace } from '../../lib/format'
import { TEXTO_ESTADO, textoHorario } from '../Clases'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

/** La última sesión de la clase ya terminó (no queda nada que aprobar). */
function vencida(c: Clase): boolean {
  return new Date(`${c.hasta}T${c.hora_fin}`) < new Date()
}

/** Verificaciones docentes pendientes: quien dice ser docente espera aquí para poder pedir la sala. */
function Verificaciones({ alCambiar }: { alCambiar: () => void }) {
  const toast = useToast()
  const [lista, setLista] = useState<VerificacionDocente[] | null>(null)
  const [rechazo, setRechazo] = useState<{ v: VerificacionDocente; motivo: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => verificacionesPendientes().then(setLista).catch(() => setLista([])), [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  async function resolver(v: VerificacionDocente, aprobar: boolean, motivo?: string) {
    setOcupado(true)
    try {
      await resolverVerificacion(v.id, aprobar, motivo)
      toast.mostrar(aprobar ? `${v.nombre} ya puede pedir la sala para clases.` : 'Verificación rechazada; la persona recibe el motivo.', 'ok')
      setRechazo(null)
      await cargar()
      alCambiar()
    } catch (e) {
      toast.mostrar(e instanceof Error ? e.message : 'No se pudo resolver.', 'danger')
    } finally {
      setOcupado(false)
    }
  }

  if (!lista || lista.length === 0) return null
  return (
    <section className="card tight stack">
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Verificación docente <span className="pestanas__n">{lista.length}</span></h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Confirme que son docentes; solo así pueden pedir la sala para clases.</p>
      <ul className="verificaciones" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {lista.map((v) => (
          <li key={v.id} className="verificacion">
            <span className="verificacion__d">
              <strong>{v.nombre}</strong>
              <span className="small muted">{v.correo}{v.programa ? ` · ${v.programa}` : ''} · {hace(v.creado_en)}</span>
            </span>
            <span className="row tight">
              <button type="button" className="btn sm ghost" disabled={ocupado} onClick={() => setRechazo({ v, motivo: '' })}>No</button>
              <button type="button" className="btn sm" disabled={ocupado} onClick={() => void resolver(v, true)}>
                <Icon nombre="check" width={14} height={14} /> Verificar
              </button>
            </span>
            {v.mensaje && <p className="verificacion__m">«{v.mensaje}»</p>}
          </li>
        ))}
      </ul>
      <Modal abierto={!!rechazo} titulo="No verificar como docente" onCerrar={() => setRechazo(null)}>
        {rechazo && (
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              {rechazo.v.nombre} recibe el motivo y se le pide actualizar su tipo de usuario. Puede seguir reservando equipos.
            </p>
            <div className="field">
              <label className="field__label" htmlFor="vf-motivo">Motivo</label>
              <textarea id="vf-motivo" rows={2} maxLength={300} value={rechazo.motivo}
                        onChange={(e) => setRechazo({ ...rechazo, motivo: e.target.value })} placeholder="No aparece en la planta docente…" />
            </div>
            <button type="button" className="btn danger" disabled={ocupado || rechazo.motivo.trim().length < 5}
                    onClick={() => void resolver(rechazo.v, false, rechazo.motivo.trim())}>
              No verificar
            </button>
          </div>
        )}
      </Modal>
    </section>
  )
}

/**
 * Solicitudes de sala para clases. Cada una se revisa y aprueba en su propia página
 * (/admin/clases/:id), con el selector de equipos libres.
 */
export default function SolicitudesClase() {
  const [lista, setLista] = useState<Clase[] | null>(null)
  const [verTodas, setVerTodas] = useState(false)

  const cargar = useCallback(() => listarClases(!verTodas).then(setLista).catch(() => setLista([])), [verTodas])
  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <>
      <Verificaciones alCambiar={() => undefined} />
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
            {lista.map((c) => {
              const sinFechas = c.estado === 'pendiente' && vencida(c)
              return (
                <li key={c.id}>
                  <Link className="card clase-item clase-item--boton" to={c.estado === 'pendiente' ? `/admin/clases/${c.id}` : `/clases/${c.id}`}>
                    <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong>
                        {c.nombre} · grupo {c.grupo}
                      </strong>
                      <span className={`badge ${sinFechas ? 'gray' : TEXTO_ESTADO[c.estado].tono}`}>
                        {sinFechas ? 'Fechas pasadas' : TEXTO_ESTADO[c.estado].texto}
                      </span>
                    </span>
                    <span className="small muted">{textoHorario(c)}</span>
                    <span className="tiny muted">
                      {c.docente} · {c.equipos_pedidos ? `pide ${c.equipos_pedidos} equipos` : 'los equipos disponibles'} · {hace(c.creado_en)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
