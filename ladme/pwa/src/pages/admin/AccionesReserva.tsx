import { useState } from 'react'
import { cancelarReserva, extenderReserva, liberarReserva, registrarLlegada } from '../../lib/api'
import type { Reserva } from '../../lib/types'
import { aInputLocal, fecha, rango } from '../../lib/format'
import Icon from '../../components/Icon'
import { useLimites } from '../../lib/politicas'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

export type Accion = { tipo: 'cancelar' | 'liberar' | 'extender' | 'llegada'; reserva: Reserva } | null

/** Diálogos de las acciones del personal sobre la reserva de otra persona. */
export default function AccionesReserva({
  accion,
  admin,
  alCerrar,
  alTerminar
}: {
  accion: Accion
  admin: boolean
  alCerrar: () => void
  alTerminar: () => void
}) {
  const toast = useToast()
  const lim = useLimites()
  const [confirma, setConfirma] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [nuevoFin, setNuevoFin] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const r = accion?.reserva
  const titulo =
    accion?.tipo === 'cancelar'
      ? 'Cancelar la reserva'
      : accion?.tipo === 'liberar'
        ? 'Liberar el equipo ahora'
        : accion?.tipo === 'extender'
          ? 'Extender la reserva'
          : 'Registrar llegada'

  function cerrar() {
    setConfirma(false)
    setMotivo('')
    setNuevoFin('')
    setError(null)
    alCerrar()
  }

  async function confirmar() {
    if (!accion || !r) return
    setError(null)
    if (accion.tipo === 'cancelar' && motivo.trim().length < 3) {
      return setError('Escriba el motivo: se le envía al titular.')
    }
    const fin = accion.tipo === 'extender' ? new Date(nuevoFin || aInputLocal(new Date(new Date(r.fin).getTime() + 86400000))) : null
    if (fin && (Number.isNaN(fin.getTime()) || fin <= new Date(r.fin))) {
      return setError('El nuevo fin debe ser posterior al actual.')
    }
    const totalH = fin ? (fin.getTime() - new Date(r.inicio).getTime()) / 3600000 : 0
    if (fin && totalH > lim.maxAbsolutoHoras) {
      return setError(`Ninguna reserva puede superar ${Math.round(lim.maxAbsolutoHoras / 24)} días (tope absoluto).`)
    }
    if (fin && admin && totalH > lim.maxTotal && !confirma) {
      return setError(`Supera el límite de ${lim.maxTotal} h. Marque la confirmación para continuar como administrador.`)
    }
    setOcupado(true)
    try {
      if (accion.tipo === 'cancelar') await cancelarReserva(r.id, motivo.trim())
      else if (accion.tipo === 'liberar') await liberarReserva(r.id)
      else if (accion.tipo === 'llegada') await registrarLlegada(r.id)
      else if (fin) await extenderReserva(r.id, fin.toISOString())
      toast.mostrar(
        accion.tipo === 'cancelar'
          ? 'Reserva cancelada. Se avisó al titular.'
          : accion.tipo === 'liberar'
            ? 'Equipo liberado.'
            : accion.tipo === 'llegada'
              ? 'Llegada registrada.'
              : 'Reserva extendida.'
      )
      cerrar()
      alTerminar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la acción.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Modal
      abierto={!!accion}
      titulo={titulo}
      descripcion={r ? `${r.equipos?.codigo ?? ''} · ${r.perfiles?.nombre ?? ''} · ${rango(r.inicio, r.fin)}` : undefined}
      onCerrar={cerrar}
      pie={
        <>
          <button className="btn gray" type="button" onClick={cerrar} disabled={ocupado}>
            Volver
          </button>
          <button className={`btn ${accion?.tipo === 'cancelar' ? 'danger' : ''}`} type="button" onClick={confirmar} disabled={ocupado}>
            {ocupado ? 'Procesando…' : 'Confirmar'}
          </button>
        </>
      }
    >
      {accion?.tipo === 'cancelar' && (
        <div className="field">
          <label className="field__label" htmlFor="adm-motivo">
            Motivo (se le envía al titular)
          </label>
          <textarea id="adm-motivo" rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </div>
      )}
      {accion?.tipo === 'liberar' && (
        <p className="small">La reserva termina en este momento y el equipo queda disponible. El titular recibe un aviso.</p>
      )}
      {accion?.tipo === 'llegada' && <p className="small">Confirma que la persona ya está usando el equipo.</p>}
      {accion?.tipo === 'extender' && r && (
        <div className="field">
          <label className="field__label" htmlFor="adm-fin">
            Nuevo fin (actual: {fecha(r.fin)})
          </label>
          <input
            id="adm-fin"
            type="datetime-local"
            value={nuevoFin || aInputLocal(new Date(new Date(r.fin).getTime() + 86400000))}
            onChange={(e) => setNuevoFin(e.target.value)}
          />
          <p className="help">
            {admin
              ? `Como administrador puede superar los límites (hasta ${Math.round(lim.maxAbsolutoHoras / 24)} días en total); queda registrado en el historial.`
              : 'Se aplican los mismos límites que al titular. Solo un administrador puede superarlos.'}
          </p>
          {admin &&
            (new Date(nuevoFin || aInputLocal(new Date(new Date(r.fin).getTime() + 86400000))).getTime() - new Date(r.inicio).getTime()) / 3600000 >
              lim.maxTotal && (
              <label className="check-row" style={{ marginTop: 'var(--s2)' }}>
                <input type="checkbox" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} />
                <span>
                  <strong>Confirmo que supero el límite de {lim.maxTotal} h</strong>
                  El equipo quedará ocupado para todos hasta la nueva fecha.
                </span>
              </label>
            )}
        </div>
      )}
      {error && (
        <div className="alert danger mt">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
    </Modal>
  )
}
