import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  cancelarReserva, extenderReserva, liberarReserva, misReservas, misSolicitudes, registrarLlegada, retirarSolicitud,
  valorarReserva
} from '../lib/api'
import type { Reserva, Solicitud } from '../lib/types'
import { useLimites } from '../lib/politicas'
import ReporteFalla from '../components/ReporteFalla'
import Deslizar from '../components/Deslizar'
import { guardarCache, leerCache } from '../lib/cacheLocal'
import {
  aInputLocal,
  duracion,
  esFuturo,
  esPasado,
  estadoReserva,
  fecha,
  hace,
  horasEntre,
  rango,
  rangoCorto
} from '../lib/format'
import Inasistencias from '../components/Inasistencias'
import MisSoftware from '../components/Software'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'

type Dialogo = { tipo: 'cancelar' | 'extender' | 'liberar'; reserva: Reserva } | null

const PUNTO: Record<string, string> = {
  'En curso': 'libre',
  Programada: 'programada',
  'Sin registrar llegada': 'ocupado',
  Finalizada: 'inactivo',
  Cancelada: 'inactivo'
}

export default function MisReservas() {
  const toast = useToast()
  const lim = useLimites()
  const [copia, setCopia] = useState<string | null>(null)
  const MAX_HORAS_EXTENSION = lim.maxExtension
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [encuesta, setEncuesta] = useState<Reserva | null>(null)
  const [reporte, setReporte] = useState<string | null>(null)
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
      const [res, sol] = await Promise.all([misReservas(), misSolicitudes()])
      setReservas(res)
      setSolicitudes(sol)
      setCopia(null)
      guardarCache('mis-reservas', res)
    } catch (e) {
      const c = leerCache<Reserva[]>('mis-reservas')
      if (c) {
        setReservas(c.datos)
        setCopia(c.guardado)
      } else setError(e instanceof Error ? e.message : 'No se pudieron cargar sus reservas.')
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
      const visible = estadoReserva(r, lim.toleranciaMin)
      if (r.estado === 'activa' && !esPasado(r.fin) && visible !== 'Finalizada') act.push(r)
      else his.push(r)
    }
    return { activas: act, historial: his }
  }, [reservas, lim.toleranciaMin])

  /** Tope total en horas; una reserva aprobada por excepción solo está limitada por la extensión. */
  function topeHoras(r: Reserva): number {
    return r.excepcion ? horasEntre(r.inicio, r.fin) + lim.maxExtension : lim.maxTotal
  }

  async function retirar(id: string) {
    setProcesando(true)
    try {
      await retirarSolicitud(id)
      toast.mostrar('Solicitud retirada.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo retirar la solicitud.')
    } finally {
      setProcesando(false)
    }
  }

  /** «¿Todo funcionó bien?»: un toque. Si no, se abre el reporte de falla. */
  async function valorar(r: Reserva, ok: boolean) {
    setEncuesta(null)
    try {
      await valorarReserva(r.id, ok)
      setReservas((lista) => lista.map((x) => (x.id === r.id ? { ...x, funciono: ok } : x)))
      if (ok) toast.mostrar('¡Gracias por contarnos!')
      else if (r.equipos?.codigo) setReporte(r.equipos.codigo)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar su respuesta.')
    }
  }

  function abrirCancelar(r: Reserva) {
    setMotivo('')
    setError(null)
    setDialogo({ tipo: 'cancelar', reserva: r })
  }

  function abrirExtension(r: Reserva) {
    const finActual = new Date(r.fin)
    const tope = new Date(new Date(r.inicio).getTime() + topeHoras(r) * 3600000)
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
    const maximo = new Date(new Date(r.inicio).getTime() + topeHoras(r) * 3600000)
    if (fin.toISOString() <= r.fin) {
      setError('El nuevo fin debe ser posterior al actual.')
      return
    }
    if (horasEntre(r.fin, fin.toISOString()) > MAX_HORAS_EXTENSION) {
      setError(`La extensión admite como máximo ${MAX_HORAS_EXTENSION} h.`)
      return
    }
    if (fin > maximo) {
      setError(`La reserva no puede superar ${Math.round(topeHoras(r))} h en total.`)
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
      const liberada = dialogo.reserva
      await liberarReserva(liberada.id)
      setDialogo(null)
      toast.mostrar('Equipo liberado. ¡Gracias!')
      if (liberada.funciono === null) setEncuesta(liberada)
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

  // El menú «Más» se cierra al tocar fuera de él.
  useEffect(() => {
    const cerrar = (e: MouseEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('details.menu-mas[open]').forEach((d) => {
        if (!d.contains(e.target as Node)) d.open = false
      })
    }
    document.addEventListener('click', cerrar)
    return () => document.removeEventListener('click', cerrar)
  }, [])

  function tarjeta(r: Reserva) {
    const estado = estadoReserva(r, lim.toleranciaMin)
    const vigente = r.estado === 'activa' && !esPasado(r.fin)
    const puedeLlegada = !r.llegada_en
    const puedeExtender =
      vigente &&
      r.extensiones < lim.extensionesMax &&
      new Date(r.inicio).getTime() + topeHoras(r) * 3600000 > new Date(r.fin).getTime()

    const empezo = !esFuturo(r.inicio)
    const cuando =
      estado === 'En curso' || estado === 'Sin registrar llegada' ? `Termina ${hace(r.fin)}`
        : vigente ? `Empieza ${hace(r.inicio)}`
          : r.estado === 'cancelada' ? 'Cancelada' : `Terminó ${hace(r.fin)}`

    // Acciones: dos a la vista (la más útil primero) y el resto en «Más».
    type Accion = { id: string; nodo: JSX.Element }
    const acciones: Accion[] = []
    if (vigente && puedeLlegada && empezo)
      acciones.push({ id: 'llegada', nodo: (
        lim.llegadaModo === 0 ? (
          <button key="llegada" className="btn ok sm" disabled={procesando} onClick={() => llegada(r)} type="button">
            <Icon nombre="check" /> Registrar llegada
          </button>
        ) : (
          <Link key="llegada" className="btn ok sm" to="/llegada">
            <Icon nombre="check" /> Confirmar asistencia
          </Link>
        )) })
    acciones.push({ id: 'credencial', nodo: (
      <Link key="credencial" className="btn ghost sm" to={`/credencial/${r.id}`}>
        <Icon nombre="qr" /> Credencial
      </Link>) })
    if (vigente && empezo)
      acciones.push({ id: 'liberar', nodo: (
        <button key="liberar" className="btn ghost sm" disabled={procesando} type="button"
                onClick={() => { setError(null); setDialogo({ tipo: 'liberar', reserva: r }) }}>
          <Icon nombre="salir" /> Liberar
        </button>) })
    if (puedeExtender)
      acciones.push({ id: 'extender', nodo: (
        <button key="extender" className="btn ghost sm" disabled={procesando} onClick={() => abrirExtension(r)} type="button">
          <Icon nombre="reloj" /> Extender
        </button>) })
    if (!vigente && r.equipos?.codigo)
      acciones.push({ id: 'otra', nodo: (
        <Link key="otra" className="btn ghost sm"
              to={`/reservar?equipo=${r.equipos.codigo}&actividad=${encodeURIComponent(r.actividad ?? '')}${r.docente ? `&docente=${encodeURIComponent(r.docente)}` : ''}&horas=${Math.min(horasEntre(r.inicio, r.fin), lim.maxHoras).toFixed(1)}`}>
          <Icon nombre="actualizar" /> Reservar otra vez
        </Link>) })
    const visibles = acciones.slice(0, 2)
    const resto = acciones.slice(2)
    const cancelar = vigente

    return (
      <article key={r.id} className={`reserva-card ${vigente ? '' : 'pasada'}`}>
        <header className="reserva-card__cab">
          {r.equipos?.foto_url ? (
            <img className="reserva-card__foto" src={r.equipos.foto_url} alt="" loading="lazy" />
          ) : (
            <span className="reserva-card__foto reserva-card__foto--vacia" aria-hidden="true">
              <Icon nombre="monitor" width={24} height={24} />
            </span>
          )}
          <div className="reserva-card__titulo">
            <Link className="reserva-card__codigo" to={r.equipos?.codigo ? `/equipo/${r.equipos.codigo}` : '#'}>
              {r.equipos?.codigo ?? 'Equipo'}
            </Link>
            <span className="reserva-card__estado">
              <span className={`punto-estado ${PUNTO[estado] ?? 'inactivo'}`} aria-hidden="true" />
              <span>
                {estado}
                {r.estado !== 'cancelada' && <span className="muted">{`, ${cuando.charAt(0).toLowerCase()}${cuando.slice(1)}`}</span>}
              </span>
            </span>
          </div>
        </header>

        <p className="reserva-card__horario">{rangoCorto(r.inicio, r.fin)}</p>

        <p className="reserva-card__meta">
          {[duracion(r.inicio, r.fin), r.actividad, r.desatendido && 'proceso desatendido', r.compartida && 'compartida', r.excepcion && 'reserva larga', r.extensiones > 0 && 'extendida']
            .filter(Boolean)
            .join(', ')}
        </p>

        {estado === 'Sin registrar llegada' && (
          <p className="reserva-card__nota aviso">
            <Icon nombre="alerta" width={14} height={14} /> No registró la llegada a tiempo: cuenta como inasistencia. Si fue un error, apélela.
          </p>
        )}
        {empezo && vigente && !r.llegada_en && estado !== 'Sin registrar llegada' && (
          <p className="reserva-card__nota aviso">
            <Icon nombre="reloj" width={14} height={14} /> Confirme su asistencia (código de Faro en el equipo) antes de las{' '}
            {new Date(new Date(r.inicio).getTime() + lim.toleranciaMin * 60000).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })}
            : si no, cuenta como inasistencia.
          </p>
        )}
        {r.llegada_en && vigente && (
          <p className="reserva-card__nota"><Icon nombre="check" width={14} height={14} /> Llegada registrada {hace(r.llegada_en)}.</p>
        )}
        {r.desatendido && r.mensaje_llegada && vigente && (
          <p className="reserva-card__nota">Aviso en el equipo: «{r.mensaje_llegada}»</p>
        )}
        {r.estado === 'cancelada' && r.motivo && (
          <p className="reserva-card__nota peligro">Motivo: {r.motivo}</p>
        )}

        {estado === 'Finalizada' && r.funciono === null && Date.now() - new Date(r.fin).getTime() < 7 * 86400000 && (
          <div className="encuesta">
            <span>¿Todo funcionó bien con el equipo?</span>
            <span className="row tight">
              <button className="btn ok sm" type="button" onClick={() => valorar(r, true)}>Sí</button>
              <button className="btn gray sm" type="button" onClick={() => valorar(r, false)}>No, hubo un problema</button>
            </span>
          </div>
        )}

        <footer className="reserva-card__acciones">
          {visibles.map((a) => a.nodo)}
          {(resto.length > 0 || cancelar) && (
            <details className="menu-mas">
              <summary className="btn ghost sm" aria-label="Más acciones">
                <Icon nombre="mas" /> <span className="solo-ancho">Más</span>
              </summary>
              <div className="menu-mas__lista" role="menu">
                {resto.map((a) => a.nodo)}
                {cancelar && (
                  <button className="btn ghost sm peligro" disabled={procesando} onClick={() => abrirCancelar(r)} type="button" role="menuitem">
                    <Icon nombre="x" /> Cancelar reserva
                  </button>
                )}
              </div>
            </details>
          )}
        </footer>
      </article>
    )
  }

  const lista = pestana === 'vigentes' ? activas : historial

  return (
    <>
      <PageHeader titulo="Mis reservas" />

      <Deslizar alActualizar={cargar} />

      {copia && (
        <div className="alert warn">
          <Icon nombre="sin-conexion" />
          <div className="alert__body">
            Sin conexión: estas son sus reservas tal como estaban {hace(copia)}. Para extender, liberar o cancelar se
            necesita internet.
          </div>
        </div>
      )}

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <Inasistencias />

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

      {pestana === 'vigentes' && solicitudes.some((x) => x.estado === 'pendiente' || x.estado === 'rechazada') && (
        <section className="card">
          <h3 style={{ fontSize: 'var(--text-base)' }}>Solicitudes de reserva larga</h3>
          <div className="stack" style={{ marginTop: 'var(--s3)' }}>
            {solicitudes
              .filter((x) => x.estado === 'pendiente' || x.estado === 'rechazada')
              .slice(0, 5)
              .map((x) => (
                <div key={x.id} className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row tight">
                      <strong>{x.equipos?.codigo}</strong>
                      <span className={`badge ${x.estado === 'pendiente' ? 'warn' : 'danger'}`}>
                        {x.estado === 'pendiente' ? 'En revisión' : 'No aprobada'}
                      </span>
                    </div>
                    <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                      {rango(x.inicio, x.fin)} · {duracion(x.inicio, x.fin)}
                    </p>
                    {x.respuesta && (
                      <p className="tiny" style={{ margin: '2px 0 0' }}>
                        Respuesta: {x.respuesta}
                      </p>
                    )}
                  </div>
                  {x.estado === 'pendiente' && (
                    <button className="btn gray sm" type="button" disabled={procesando} onClick={() => retirar(x.id)}>
                      Retirar
                    </button>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

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

      {pestana === 'vigentes' && <MisSoftware />}

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
        descripcion={`Hasta ${lim.maxExtension} h más. Extensiones permitidas por reserva: ${lim.extensionesMax}.`}
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
                  {fecha(new Date(new Date(dialogo.reserva.inicio).getTime() + topeHoras(dialogo.reserva) * 3600000).toISOString())}
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

      <Modal
        abierto={!!encuesta}
        titulo="¿Todo funcionó bien?"
        descripcion={encuesta ? `Su uso del equipo ${encuesta.equipos?.codigo ?? ''} acaba de terminar.` : undefined}
        onCerrar={() => setEncuesta(null)}
        pie={
          <>
            <button className="btn gray" type="button" onClick={() => encuesta && valorar(encuesta, false)}>
              No, hubo un problema
            </button>
            <button className="btn ok" type="button" onClick={() => encuesta && valorar(encuesta, true)}>
              Sí, todo bien
            </button>
          </>
        }
      >
        <p className="small" style={{ margin: 0 }}>
          Su respuesta ayuda al laboratorio a detectar equipos con fallas antes de que afecten a otra persona.
        </p>
      </Modal>

      <ReporteFalla equipo={reporte ?? ''} abierto={!!reporte} alCerrar={() => setReporte(null)} />
    </>
  )
}
