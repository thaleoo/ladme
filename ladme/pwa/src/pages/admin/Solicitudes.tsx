import { useCallback, useEffect, useState } from 'react'
import { listarSolicitudes, resolverSolicitud } from '../../lib/api'
import type { Solicitud } from '../../lib/types'
import { duracion, fecha, hace } from '../../lib/format'
import { esAdmin, useAuth } from '../../context/AuthContext'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

const TONO: Record<Solicitud['estado'], string> = { pendiente: 'warn', aprobada: 'ok', rechazada: 'danger', retirada: 'gray' }

/** Solicitudes de reserva larga: el administrador aprueba o rechaza. */
export default function Solicitudes() {
  const { perfil } = useAuth()
  const admin = esAdmin(perfil)
  const toast = useToast()
  const [lista, setLista] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<{ s: Solicitud; aprobar: boolean } | null>(null)
  const [respuesta, setRespuesta] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const todas = await listarSolicitudes()
      setLista([...todas].sort((a, b) => Number(b.estado === 'pendiente') - Number(a.estado === 'pendiente')))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las solicitudes.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function resolver() {
    if (!dialogo) return
    if (!dialogo.aprobar && respuesta.trim().length < 3) return setError('Escriba el motivo del rechazo.')
    setOcupado(true)
    try {
      await resolverSolicitud(dialogo.s.id, dialogo.aprobar, respuesta.trim())
      toast.mostrar(dialogo.aprobar ? 'Solicitud aprobada: la reserva quedó creada.' : 'Solicitud rechazada. Se avisó al solicitante.')
      setDialogo(null)
      setRespuesta('')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo resolver la solicitud.')
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <Cargando texto="Cargando solicitudes…" />

  return (
    <>
      {!admin && (
        <div className="alert info">
          <Icon nombre="info" />
          <div className="alert__body">Puede consultar las solicitudes; solo un administrador las aprueba o rechaza.</div>
        </div>
      )}
      {error && !dialogo && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {lista.length === 0 && (
        <div className="card">
          <Empty icono="check-circulo" titulo="Sin solicitudes">
            Cuando alguien pida una reserva más larga de lo permitido aparecerá aquí.
          </Empty>
        </div>
      )}
      <div className="grid" style={{ gap: 'var(--s3)' }}>
        {lista.map((s) => (
          <article key={s.id} className="card">
            <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row tight">
                  <strong style={{ fontSize: 'var(--text-lg)' }}>{s.equipos?.codigo}</strong>
                  <span className={`badge ${TONO[s.estado]}`}>{s.estado}</span>
                  <span className="badge outline num">{duracion(s.inicio, s.fin)}</span>
                </div>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  <strong>{s.solicitante?.nombre}</strong> · {s.solicitante?.programa ?? 'sin programa'} · {s.actividad}
                </p>
                <p className="tiny muted" style={{ margin: '2px 0 0', wordBreak: 'break-all' }}>
                  {s.solicitante?.correo} · pedida {hace(s.creado_en)}
                </p>
              </div>
            </div>
            <p className="small" style={{ margin: 'var(--s3) 0 0' }}>
              {fecha(s.inicio)} → {fecha(s.fin)}
            </p>
            <p className="small" style={{ margin: '4px 0 0' }}>
              <span className="muted">Justificación:</span> {s.justificacion}
            </p>
            {s.respuesta && (
              <p className="small" style={{ margin: '4px 0 0' }}>
                <span className="muted">Respuesta:</span> {s.respuesta}
              </p>
            )}
            {admin && s.estado === 'pendiente' && (
              <div className="row mt" style={{ gap: 'var(--s2)' }}>
                <button className="btn ok sm" type="button" onClick={() => { setError(null); setRespuesta(''); setDialogo({ s, aprobar: true }) }}>
                  <Icon nombre="check" /> Aprobar
                </button>
                <button className="btn danger sm" type="button" onClick={() => { setError(null); setRespuesta(''); setDialogo({ s, aprobar: false }) }}>
                  Rechazar
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      <Modal
        abierto={!!dialogo}
        titulo={dialogo?.aprobar ? 'Aprobar la solicitud' : 'Rechazar la solicitud'}
        descripcion={dialogo ? `${dialogo.s.equipos?.codigo} · ${dialogo.s.solicitante?.nombre} · ${duracion(dialogo.s.inicio, dialogo.s.fin)}` : undefined}
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" type="button" onClick={() => setDialogo(null)} disabled={ocupado}>
              Volver
            </button>
            <button className={`btn ${dialogo?.aprobar ? 'ok' : 'danger'}`} type="button" onClick={resolver} disabled={ocupado}>
              {ocupado ? 'Procesando…' : dialogo?.aprobar ? 'Aprobar y crear la reserva' : 'Rechazar'}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field__label" htmlFor="sol-respuesta">
            {dialogo?.aprobar ? 'Nota (opcional)' : 'Motivo del rechazo (se le envía al solicitante)'}
          </label>
          <textarea id="sol-respuesta" rows={3} maxLength={500} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
          {dialogo?.aprobar && (
            <p className="help">Si el equipo ya tiene otra reserva en ese intervalo, la aprobación falla y no cambia nada.</p>
          )}
        </div>
        {error && (
          <div className="alert danger mt">
            <Icon nombre="alerta" />
            <div className="alert__body">{error}</div>
          </div>
        )}
      </Modal>
    </>
  )
}
