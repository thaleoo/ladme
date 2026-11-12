import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelarReserva, extenderReserva, liberarReserva, misReservas, registrarLlegada } from '../lib/api'
import type { Reserva } from '../lib/types'
import {
  MAX_HORAS_EXTENSION,
  MAX_HORAS_TOTAL,
  aInputLocal,
  esFuturo,
  esPasado,
  estadoReserva,
  fecha,
  hace,
  horasEntre,
  rango
} from '../lib/format'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'

type Dialogo = { tipo: 'cancelar' | 'extender' | 'liberar'; reserva: Reserva } | null

function tonoEstado(estado: string): string {
  if (estado === 'En curso') return 'ok'
  if (estado === 'Sin registrar llegada') return 'warn'
  if (estado === 'Cancelada' || estado === 'Finalizada') return 'gray'
  return 'info'
}

export default function MisReservas() {
  const toast = useToast()
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'vigentes' | 'historial'>('vigentes')
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [nuevoFin, setNuevoFin] = useState('')
  const [motivo, setMotivo] = useState('')
  const [procesando, setProcesando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setError(null)
      setReservas(await misReservas())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar sus reservas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const { activas, historial } = useMemo(() => {
    const act: Reserva[] = []
    const his: Reserva[] = []
    for (const r of reservas) {
      const visible = estadoReserva(r)
      if (r.estado === 'activa' && !esPasado(r.fin) && visible !== 'Finalizada') act.push(r)
      else his.push(r)
    }
    return { activas: act, historial: his }
  }, [reservas])

  function abrirCancelar(r: Reserva) {
    setMotivo('')
    setError(null)
    setDialogo({ tipo: 'cancelar', reserva: r })
  }

  function abrirExtension(r: Reserva) {
    const finActual = new Date(r.fin)
    const tope = new Date(new Date(r.inicio).getTime() + MAX_HORAS_TOTAL * 3600000)
    const propuesto = new Date(Math.min(finActual.getTime() + MAX_HORAS_EXTENSION * 3600000, tope.getTime()))
    setNuevoFin(aInputLocal(propuesto))
    setError(null)
    setDialogo({ tipo: 'extender', reserva: r })
  }

  async function confirmarCancelacion() {
    if (!dialogo) return
    if (motivo.trim().length < 3) {
      setError('Escriba un motivo de al menos 3 caracteres.')
      return
    }
    setProcesando(true)
    try {
      await cancelarReserva(dialogo.reserva.id, motivo.trim())
      setDialogo(null)
      toast.mostrar('Reserva cancelada. El equipo quedó libre para otra persona.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar la reserva.')
    } finally {
      setProcesando(false)
    }
  }

  async function confirmarExtension() {
    if (!dialogo) return
    const r = dialogo.reserva
    const fin = new Date(nuevoFin)
    if (Number.isNaN(fin.getTime())) {
      setError('Indique la nueva fecha y hora de fin.')
      return
    }
    const maximo = new Date(new Date(r.inicio).getTime() + MAX_HORAS_TOTAL * 3600000)
    if (fin.toISOString() <= r.fin) {
      setError('El nuevo fin debe ser posterior al actual.')
      return
    }
    if (horasEntre(r.fin, fin.toISOString()) > MAX_HORAS_EXTENSION) {
      setError(`La extensión admite como máximo ${MAX_HORAS_EXTENSION} h.`)
      return
    }
    if (fin > maximo) {
      setError(`La reserva no puede superar ${MAX_HORAS_TOTAL} h en total.`)
      return
    }
    setProcesando(true)
    try {
      await extenderReserva(r.id, fin.toISOString())
      setDialogo(null)
      toast.mostrar('Reserva extendida.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo extender la reserva.')
    } finally {
      setProcesando(false)
    }
  }

  async function confirmarLiberacion() {
    if (!dialogo) return
    setProcesando(true)
    try {
      await liberarReserva(dialogo.reserva.id)
      setDialogo(null)
      toast.mostrar('Equipo liberado. ¡Gracias!')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo liberar el equipo.')
    } finally {
      setProcesando(false)
    }
  }

  async function llegada(r: Reserva) {
    setProcesando(true)
    try {
      await registrarLlegada(r.id)
      toast.mostrar('Llegada registrada. Buen trabajo.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la llegada.')
    } finally {
      setProcesando(false)
    }
  }

  function tarjeta(r: Reserva) {
    const estado = estadoReserva(r)
    const vigente = r.estado === 'activa' && !esPasado(r.fin)
    const puedeLlegada = estado === 'Sin registrar llegada' || estado === 'Activa'
    const puedeExtender =
      vigente &&
      r.extensiones < 1 &&
      new Date(r.inicio).getTime() + MAX_HORAS_TOTAL * 3600000 > new Date(r.fin).getTime()

    return (
      <article key={r.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="row tight">
              <span style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{r.codigo_legible}</span>
              <span className={`badge ${tonoEstado(estado)}`}>
                {estado === 'En curso' && <span className="punto" />}
                {estado}
              </span>
              {r.desatendido && <span className="badge gray">Desatendido</span>}
            </div>
            <p className="small" style={{ margin: '2px 0 0' }}>
              <Icon nombre="calendario" width={13} height={13} /> {rango(r.inicio, r.fin)}
            </p>
          </div>
          <span className="badge outline num">{horasEntre(r.inicio, r.fin).toFixed(0)} h</span>
        </div>

        {r.actividad && <p className="small" style={{ margin: 0 }}>{r.actividad}</p>}
        {r.desatendido && r.mensaje_llegada && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Aviso en el equipo: {r.mensaje_llegada}
          </p>
        )}
        {r.estado === 'cancelada' && r.motivo && (
          <p className="tiny" style={{ margin: 0, color: 'var(--danger-fg)' }}>
            Motivo de cancelación: {r.motivo}
          </p>
        )}
        {estado === 'En curso' && (
          <p className="tiny muted" style={{ margin: 0 }}>
            <Icon nombre="reloj" width={13} height={13} /> Termina {hace(r.fin)}
          </p>
        )}
        {estado === 'Sin registrar llegada' && (
          <p className="tiny" style={{ margin: 0, color: 'var(--warning-fg)' }}>
            <Icon nombre="alerta" width={13} height={13} /> Registre su llegada para no perder el turno.
          </p>
        )}
        {r.extensiones > 0 && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Extensión usada ({r.extensiones} de 1).
          </p>
        )}

        <div className="row" style={{ gap: 'var(--s2)' }}>
          <Link className="btn ghost sm" to={`/credencial/${r.id}`}>
            <Icon nombre="qr" /> Credencial
          </Link>

          {vigente && (
            <>
              {puedeLlegada && !esFuturo(r.inicio) && (
                <button className="btn ok sm" disabled={procesando} onClick={() => llegada(r)} type="button">
                  <Icon nombre="check" /> Registrar llegada
                </button>
              )}
              {puedeExtender && (
                <button className="btn ghost sm" disabled={procesando} onClick={() => abrirExtension(r)} type="button">
                  <Icon nombre="reloj" /> Extender
                </button>
              )}
              {!esFuturo(r.inicio) && (
                <button
                  className="btn gray sm"
                  disabled={procesando}
                  onClick={() => {
                    setError(null)
                    setDialogo({ tipo: 'liberar', reserva: r })
                  }}
                  type="button"
                >
                  Liberar equipo
                </button>
              )}
              <button className="btn danger sm" disabled={procesando} onClick={() => abrirCancelar(r)} type="button">
                Cancelar
              </button>
            </>
          )}
        </div>
      </article>
    )
  }

  const lista = pestana === 'vigentes' ? activas : historial

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        titulo="Mis reservas"
        sub="Sus turnos vigentes y el historial completo. Las cancelaciones se conservan con su motivo."
        acciones={
          <Link className="btn" to="/reservar">
            <Icon nombre="mas2" /> Nueva reserva
          </Link>
        }
      />

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <div className="segmented" role="tablist" aria-label="Filtro de reservas">
        <button
          role="tab"
          aria-selected={pestana === 'vigentes'}
          className={pestana === 'vigentes' ? 'activo' : ''}
          onClick={() => setPestana('vigentes')}
          type="button"
        >
          Vigentes ({activas.length})
        </button>
        <button
          role="tab"
          aria-selected={pestana === 'historial'}
          className={pestana === 'historial' ? 'activo' : ''}
          onClick={() => setPestana('historial')}
          type="button"
        >
          Historial ({historial.length})
        </button>
      </div>

      {cargando && <Cargando texto="Cargando sus reservas…" />}

      {!cargando && lista.length === 0 && (
        <div className="card">
          {pestana === 'vigentes' ? (
            <Empty
              icono="ticket"
              titulo="No tiene reservas vigentes"
              accion={
                <Link className="btn sm" to="/reservar">
                  <Icon nombre="mas2" /> Reservar un equipo
                </Link>
              }
            >
              Cuando reserve un equipo aparecerá aquí con su credencial y sus acciones.
            </Empty>
          ) : (
            <Empty icono="reloj" titulo="Todavía no hay historial">
              Las reservas finalizadas o canceladas se guardan aquí para su consulta.
            </Empty>
          )}
        </div>
      )}

      {!cargando && lista.length > 0 && (
        <div className="grid" style={{ gap: 'var(--s3)' }}>
          {lista.map(tarjeta)}
        </div>
      )}

      <Modal
        abierto={dialogo?.tipo === 'cancelar'}
        titulo="Cancelar reserva"
        descripcion={dialogo?.reserva ? `${dialogo.reserva.codigo_legible} · ${rango(dialogo.reserva.inicio, dialogo.reserva.fin)}` : undefined}
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" onClick={() => setDialogo(null)} disabled={procesando} type="button">
              Volver
            </button>
            <button className="btn danger" onClick={confirmarCancelacion} disabled={procesando} type="button">
              {procesando ? 'Cancelando…' : 'Sí, cancelar'}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field__label" htmlFor="motivo-cancelacion">
            Motivo (quedará en el historial)
          </label>
          <textarea
            id="motivo-cancelacion"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            placeholder="Ej. No podré asistir; libero el equipo para otra persona."
            autoFocus
          />
          <p className="help">El equipo queda libre de inmediato. La reserva no se borra.</p>
        </div>
      </Modal>

      <Modal
        abierto={dialogo?.tipo === 'liberar'}
        titulo="Liberar el equipo ahora"
        descripcion={dialogo?.reserva ? `${dialogo.reserva.codigo_legible} · ${rango(dialogo.reserva.inicio, dialogo.reserva.fin)}` : undefined}
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" onClick={() => setDialogo(null)} disabled={procesando} type="button">
              Volver
            </button>
            <button className="btn" onClick={confirmarLiberacion} disabled={procesando} type="button">
              {procesando ? 'Liberando…' : 'Sí, liberar'}
            </button>
          </>
        }
      >
        <div className="alert info">
          <Icon nombre="info" />
          <div className="alert__body">
            La reserva termina en este momento y el equipo queda disponible para otra persona. La reserva
            seguirá en su historial como finalizada.
          </div>
        </div>
      </Modal>

      <Modal
        abierto={dialogo?.tipo === 'extender'}
        titulo="Extender la reserva"
        descripcion="Una única extensión por reserva, de hasta 24 h y sin superar 192 h desde el inicio."
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" onClick={() => setDialogo(null)} disabled={procesando} type="button">
              Cerrar
            </button>
            <button className="btn" onClick={confirmarExtension} disabled={procesando} type="button">
              {procesando ? 'Guardando…' : 'Confirmar extensión'}
            </button>
          </>
        }
      >
        {dialogo?.reserva && (
          <>
            <div className="alert info">
              <Icon nombre="info" />
              <div className="alert__body">
                Fin actual: <strong>{fecha(dialogo.reserva.fin)}</strong>
                <br />
                Máximo permitido:{' '}
                <strong>
                  {fecha(new Date(new Date(dialogo.reserva.inicio).getTime() + MAX_HORAS_TOTAL * 3600000).toISOString())}
                </strong>
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="nuevo-fin">
                Nuevo fin
              </label>
              <input
                id="nuevo-fin"
                type="datetime-local"
                value={nuevoFin}
                onChange={(e) => setNuevoFin(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
