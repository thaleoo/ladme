import { useCallback, useEffect, useState } from 'react'
import { actualizarSoftware, listarEquipos, listarSoftware } from '../../lib/api'
import type { Equipo, SolicitudSoftware } from '../../lib/types'
import { hace } from '../../lib/format'
import { ESTADO_SOFTWARE } from '../../components/Software'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

/**
 * Solicitudes de software: el personal las marca «Enviada a TI», «Instalado en…» (el programa se
 * agrega a esos equipos y la persona recibe el aviso) o «No se instalará» con el motivo.
 */
export default function Software() {
  const toast = useToast()
  const [lista, setLista] = useState<SolicitudSoftware[] | null>(null)
  const [todas, setTodas] = useState(false)
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [instalar, setInstalar] = useState<{ s: SolicitudSoftware; elegidos: string[] } | null>(null)
  const [rechazar, setRechazar] = useState<{ s: SolicitudSoftware; motivo: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => listarSoftware({ abiertas: !todas }).then(setLista).catch(() => setLista([])), [todas])
  useEffect(() => {
    void cargar()
  }, [cargar])
  useEffect(() => {
    listarEquipos().then((l) => setEquipos(l.filter((e) => !e.archivado))).catch(() => setEquipos([]))
  }, [])

  async function hacer(fn: () => Promise<void>, ok: string) {
    setOcupado(true)
    try {
      await fn()
      toast.mostrar(ok, 'ok')
      setInstalar(null)
      setRechazar(null)
      await cargar()
    } catch (e) {
      toast.mostrar(e instanceof Error ? e.message : 'No se pudo actualizar.', 'danger')
    } finally {
      setOcupado(false)
    }
  }

  const fecha = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <section className="card tight stack">
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Solicitudes de software</h2>
        <button className="link-btn small" type="button" onClick={() => setTodas((v) => !v)}>{todas ? 'Ver solo abiertas' : 'Ver todas'}</button>
      </div>
      {!lista ? (
        <p className="small muted">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>{todas ? 'Aún no hay solicitudes.' : 'No hay solicitudes abiertas.'}</p>
      ) : (
        <ul className="verificaciones" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lista.map((s) => {
            const abierta = s.estado === 'pendiente' || s.estado === 'en_tramite'
            return (
              <li key={s.id} className="verificacion software-item">
                <span className="verificacion__d">
                  <strong>
                    {s.software}{s.version ? ` ${s.version}` : ''} <span className={`badge ${ESTADO_SOFTWARE[s.estado].tono}`}>{ESTADO_SOFTWARE[s.estado].texto}</span>
                  </strong>
                  <span className="small muted">
                    {s.perfiles?.nombre ?? 'Persona'} · {s.para_fecha ? `para el ${fecha(s.para_fecha)}` : 'sin fecha'}
                    {s.equipos?.codigo ? ` · ${s.equipos.codigo}` : ''}{s.reserva_id ? ' · con reserva' : ''} · {hace(s.creado_en)}
                  </span>
                </span>
                {abierta ? (
                  <span className="row tight">
                    {s.estado === 'pendiente' && (
                      <button type="button" className="btn sm ghost" disabled={ocupado}
                              onClick={() => void hacer(() => actualizarSoftware(s.id, 'en_tramite'), 'Marcada como enviada a TI.')}>
                        Enviada a TI
                      </button>
                    )}
                    <button type="button" className="btn sm" disabled={ocupado}
                            onClick={() => setInstalar({ s, elegidos: s.equipos?.codigo ? [s.equipos.codigo] : [] })}>
                      <Icon nombre="check" width={14} height={14} /> Instalado
                    </button>
                  </span>
                ) : <span />}
                <p className="verificacion__m">
                  «{s.uso}»
                  {s.enlace && <> · <a href={s.enlace} target="_blank" rel="noreferrer noopener">enlace</a></>}
                  {s.estado === 'instalado' && s.equipos_instalados.length > 0 && <> · instalado en {s.equipos_instalados.join(', ')}</>}
                  {s.respuesta && <> · {s.respuesta}</>}
                </p>
                {abierta && (
                  <button type="button" className="link-btn tiny software-item__no" onClick={() => setRechazar({ s, motivo: '' })}>
                    No se instalará…
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Modal abierto={!!instalar} titulo="¿En qué equipos quedó instalado?" onCerrar={() => setInstalar(null)}>
        {instalar && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>{instalar.s.software} se agrega a la lista de programas de esos equipos y la persona recibe el aviso.</p>
            <div className="aprobar-rapido">
              <button type="button" className="chip" onClick={() => setInstalar({ ...instalar, elegidos: equipos.map((e) => e.codigo) })}>Todos ({equipos.length})</button>
              <button type="button" className="chip" onClick={() => setInstalar({ ...instalar, elegidos: [] })}>Ninguno</button>
            </div>
            <ul className="selector-equipos">
              {equipos.map((e) => {
                const activo = instalar.elegidos.includes(e.codigo)
                return (
                  <li key={e.id}>
                    <button type="button" className={`selector-equipo ${activo ? 'activo' : ''}`} aria-pressed={activo}
                            onClick={() => setInstalar({ ...instalar, elegidos: activo ? instalar.elegidos.filter((x) => x !== e.codigo) : [...instalar.elegidos, e.codigo] })}>
                      <span className="selector-equipo__check" aria-hidden="true"><Icon nombre="check" width={12} height={12} /></span>
                      <strong>{e.codigo}</strong>
                      <span className="tiny">{e.sistema_operativo ?? e.nombre}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <button type="button" disabled={ocupado || instalar.elegidos.length === 0}
                    onClick={() => void hacer(() => actualizarSoftware(instalar.s.id, 'instalado', instalar.elegidos), 'Listo: la persona recibe el aviso.')}>
              Marcar instalado en {instalar.elegidos.length} equipo{instalar.elegidos.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </Modal>
      <Modal abierto={!!rechazar} titulo="No se instalará" onCerrar={() => setRechazar(null)}>
        {rechazar && (
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="sw-no">Motivo para la persona</label>
              <textarea id="sw-no" rows={2} maxLength={400} value={rechazar.motivo} onChange={(e) => setRechazar({ ...rechazar, motivo: e.target.value })}
                        placeholder="Requiere una licencia que la universidad no tiene…" />
            </div>
            <button type="button" className="btn danger" disabled={ocupado || rechazar.motivo.trim().length < 5}
                    onClick={() => void hacer(() => actualizarSoftware(rechazar.s.id, 'rechazada', undefined, rechazar.motivo.trim()), 'La persona recibe el motivo.')}>
              No instalar
            </button>
          </div>
        )}
      </Modal>
    </section>
  )
}
