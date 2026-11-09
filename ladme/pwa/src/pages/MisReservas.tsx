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
  horasEntre,
  rango
} from '../lib/format'

type Accion = { tipo: 'extender'; reserva: Reserva } | null

function colorEstado(estado: string): string {
  if (estado === 'En curso') return 'ok'
  if (estado === 'Programada' || estado === 'Activa') return ''
  if (estado === 'Sin registrar llegada') return 'warn'
  if (estado === 'Cancelada') return 'danger'
  return 'gray'
}

export default function MisReservas() {
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)
  const [nuevoFin, setNuevoFin] = useState('')
  const [procesando, setProcesando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setError(null)
      const lista = await misReservas()
      setReservas(lista)
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

  async function cancelar(r: Reserva) {
    const motivo = window.prompt('Motivo de la cancelación (quedará en el historial):', '')
    if (motivo === null) return
    if (motivo.trim().length < 3) {
      setError('Escriba un motivo de al menos 3 caracteres.')
      return
    }
    setProcesando(true)
    try {
      await cancelarReserva(r.id, motivo.trim())
      setAviso('Reserva cancelada. El equipo quedó libre para otra persona.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar la reserva.')
    } finally {
      setProcesando(false)
    }
  }

  async function liberar(r: Reserva) {
    if (!window.confirm('¿Liberar el equipo ahora? La reserva terminará en este momento.')) return
    setProcesando(true)
    try {
      await liberarReserva(r.id)
      setAviso('Equipo liberado. ¡Gracias!')
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
      setAviso('Llegada registrada.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la llegada.')
    } finally {
      setProcesando(false)
    }
  }

  function abrirExtension(r: Reserva) {
    const finActual = new Date(r.fin)
    const tope = new Date(new Date(r.inicio).getTime() + MAX_HORAS_TOTAL * 3600000)
    const propuesto = new Date(Math.min(finActual.getTime() + MAX_HORAS_EXTENSION * 3600000, tope.getTime()))
    setAccion({ tipo: 'extender', reserva: r })
    setNuevoFin(aInputLocal(propuesto))
    setError(null)
    setAviso(null)
  }

  async function confirmarExtension() {
    if (!accion) return
    const r = accion.reserva
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
      setError(`La reserva no puede superar ${MAX_HORAS_TOTAL} h en total (${MAX_HORAS_TOTAL} h = 168 h + 24 h).`)
      return
    }
    setProcesando(true)
    try {
      await extenderReserva(r.id, fin.toISOString())
      setAviso('Reserva extendida.')
      setAccion(null)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo extender la reserva.')
    } finally {
      setProcesando(false)
    }
  }

  function tarjeta(r: Reserva) {
    const estado = estadoReserva(r)
    const puedeExtender =
      r.estado === 'activa' &&
      !esPasado(r.fin) &&
      r.extensiones < 1 &&
      new Date(r.inicio).getTime() + MAX_HORAS_TOTAL * 3600000 > new Date(r.fin).getTime()
    return (
      <div key={r.id} className={`card ${estado === 'En curso' ? 'ok' : estado === 'Sin registrar llegada' ? 'warn' : ''}`}>
        <div className="row between">
          <div>
            <h4>{r.codigo_legible} <span className={`badge ${colorEstado(estado)}`}>{estado}</span></h4>
            <div className="small muted">{rango(r.inicio, r.fin)}</div>
            {r.actividad && <div className="small">{r.actividad}</div>}
            {r.desatendido && <div className="tiny muted">Trabajo desatendido{r.mensaje_llegada ? ` · ${r.mensaje_llegada}` : ''}</div>}
            {r.motivo && r.estado === 'cancelada' && <div className="tiny error">Motivo: {r.motivo}</div>}
            {r.extensiones > 0 && <div className="tiny muted">Extensión usada: {r.extensiones}</div>}
          </div>
          <Link className="btn ghost sm" to={`/credencial/${r.id}`}>Credencial QR</Link>
        </div>

        <div className="row mt">
          {r.estado === 'activa' && !esPasado(r.fin) && (
            <>
              {!esFuturo(r.inicio) && (
                <button className="btn ok sm" disabled={procesando} onClick={() => llegada(r)}>
                  Registrar llegada
                </button>
              )}
              {puedeExtender && (
                <button className="btn ghost sm" disabled={procesando} onClick={() => abrirExtension(r)}>
                  Extender hasta {MAX_HORAS_EXTENSION} h
                </button>
              )}
              <button className="btn danger sm" disabled={procesando} onClick={() => cancelar(r)}>
                Cancelar
              </button>
              {!esFuturo(r.inicio) && (
                <button className="btn gray sm" disabled={procesando} onClick={() => liberar(r)}>
                  Liberar equipo
                </button>
              )}
            </>
          )}
        </div>

        {accion?.tipo === 'extender' && accion.reserva.id === r.id && (
          <div className="card warn mt">
            <h4>Extender la reserva</h4>
            <p className="small muted">
              Fin actual: {fecha(r.fin)}. Máximo permitido: {fecha(new Date(new Date(r.inicio).getTime() + MAX_HORAS_TOTAL * 3600000).toISOString())}
              {' '}({MAX_HORAS_TOTAL} h desde el inicio).
            </p>
            <div className="row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <label htmlFor={`fin-${r.id}`}>Nuevo fin</label>
                <input
                  id={`fin-${r.id}`}
                  type="datetime-local"
                  value={nuevoFin}
                  onChange={(e) => setNuevoFin(e.target.value)}
                />
              </div>
              <button className="btn" disabled={procesando} onClick={confirmarExtension}>Confirmar extensión</button>
              <button className="btn gray" disabled={procesando} onClick={() => setAccion(null)}>Cerrar</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="card accent">
        <div className="row between">
          <div>
            <h2>Mis reservas</h2>
            <p className="muted small mb-0">Historial completo: las cancelaciones se conservan y no se borran.</p>
          </div>
          <Link className="btn" to="/reservar">Nueva reserva</Link>
        </div>
      </div>

      {aviso && <div className="alert ok">{aviso}</div>}
      {error && <div className="alert danger">{error}</div>}
      {cargando && <div className="card center muted">Cargando sus reservas…</div>}

      {!cargando && (
        <>
          <h3>Vigentes ({activas.length})</h3>
          {activas.length === 0 && <div className="alert info">No tiene reservas vigentes.</div>}
          {activas.map(tarjeta)}

          <h3 className="mt">Historial ({historial.length})</h3>
          {historial.length === 0 && <div className="alert info">Todavía no hay reservas en el historial.</div>}
          {historial.map(tarjeta)}
        </>
      )}
    </>
  )
}
