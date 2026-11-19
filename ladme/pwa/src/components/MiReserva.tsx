import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { extenderReserva, liberarReserva, marcarCompartida, misReservas, registrarLlegada, registrarLlegadaPc, valorarReserva } from '../lib/api'
import type { Reserva } from '../lib/types'
import { conPunto, hora, horasEntre } from '../lib/format'
import { useLimites } from '../lib/politicas'
import Icon from './Icon'
import Modal from './Modal'
import { useToast } from './Toast'

interface Props {
  equipo: string
  /** Programas detectados en el equipo, para elegir cuáles proteger al compartir. */
  software?: string[]
  /** «extender» o «liberar» cuando la ficha se abre desde la isla de Faro. */
  accion: string | null
  /** Código del QR de llegada de la isla (?llegada=…). */
  codigoLlegada: string | null
  /** Se llama tras extender, liberar o registrar la llegada, para recargar la ficha. */
  alCambiar: () => void
  /** Informa la reserva propia que se muestra (o null), para no ofrecerle «Preguntar si lo libera». */
  alVer?: (r: { inicio: string; fin: string } | null) => void
}

/**
 * «Tu reserva» en la ficha del equipo: aparece solo si quien mira tiene la reserva vigente
 * (o por empezar) de ESTE equipo. Desde aquí registra la llegada, extiende o libera.
 */
export default function MiReserva({ equipo, software = [], accion, codigoLlegada, alCambiar, alVer }: Props) {
  const lim = useLimites()
  const toast = useToast()
  const [reserva, setReserva] = useState<Reserva | null | undefined>(undefined)
  const [compartiendo, setCompartiendo] = useState(false)
  const [protegidos, setProtegidos] = useState<string[]>([])
  const [notaCompartir, setNotaCompartir] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extendiendo, setExtendiendo] = useState(accion === 'extender')
  const [liberando, setLiberando] = useState(false)
  const [preguntaValoracion, setPreguntaValoracion] = useState<Reserva | null>(null)
  const [, setTic] = useState(0)
  const tarjeta = useRef<HTMLElement>(null)
  const llegadaIntentada = useRef(false)

  async function cargar() {
    try {
      const ahora = Date.now()
      const lista = await misReservas()
      const mia =
        lista
          .filter((r) => r.equipos?.codigo === equipo && r.estado === 'activa' && !r.liberada_en && new Date(r.fin).getTime() > ahora)
          .filter((r) => new Date(r.inicio).getTime() <= ahora + 60 * 60_000)
          .sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null
      setReserva(mia)
      alVer?.(mia ? { inicio: mia.inicio, fin: mia.fin } : null)
    } catch {
      setReserva(null)
      alVer?.(null)
    }
  }

  useEffect(() => {
    void cargar()
    const t = window.setInterval(() => setTic((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [equipo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Desde la isla: abrir lo pedido y llevar la vista a la tarjeta.
  useEffect(() => {
    if (reserva === undefined) return
    if (accion === 'liberar' && reserva) setLiberando(true)
    if ((accion || codigoLlegada) && tarjeta.current) tarjeta.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [reserva, accion, codigoLlegada])

  // QR de llegada de la isla: se registra solo al abrir.
  useEffect(() => {
    if (!codigoLlegada || llegadaIntentada.current || reserva === undefined) return
    llegadaIntentada.current = true
    if (!reserva) {
      setError(`No tiene una reserva vigente en ${equipo}. Solo quien reservó el equipo puede registrar su llegada.`)
      return
    }
    if (reserva.llegada_en) return
    void hacer(async () => {
      await registrarLlegadaPc(equipo, codigoLlegada)
      toast.mostrar('Llegada registrada. ¡Buen trabajo!')
    })
  }, [codigoLlegada, reserva]) // eslint-disable-line react-hooks/exhaustive-deps

  const opciones = useMemo(() => {
    if (!reserva) return []
    const actual = horasEntre(reserva.inicio, reserva.fin)
    const tope = reserva.excepcion ? actual + lim.maxExtension : lim.maxTotal
    const restante = Math.min(lim.maxExtension, tope - actual, lim.maxAbsolutoHoras - actual)
    return [0.5, 1, 2, 4, 8, 24].filter((h) => h <= restante + 1e-9)
  }, [reserva, lim])

  async function hacer(f: () => Promise<void>) {
    setOcupado(true)
    setError(null)
    try {
      await f()
      await cargar()
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la acción.')
    } finally {
      setOcupado(false)
    }
  }

  if (reserva === undefined) return null
  if (!reserva) {
    if (accion !== 'extender' && accion !== 'liberar' && !error) return null
    return (
      <section className="card" ref={tarjeta}>
        <strong>No tiene una reserva vigente en {equipo}</strong>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {error ?? `Solo quien reservó el equipo puede ${accion === 'liberar' ? 'liberarlo' : 'extender su reserva'}.`}
        </p>
      </section>
    )
  }

  const ahora = Date.now()
  const empezo = new Date(reserva.inicio).getTime() <= ahora
  const restanteMs = new Date(reserva.fin).getTime() - ahora
  const h = Math.floor(restanteMs / 3600_000)
  const m = Math.floor((restanteMs % 3600_000) / 60_000)
  const sinExtensiones = (reserva.extensiones ?? 0) >= lim.extensionesMax

  return (
    <section className="card accent mi-reserva" ref={tarjeta}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
        <div>
          <span className="eyebrow">Tu reserva</span>
          <strong style={{ display: 'block', fontSize: 'var(--text-lg)' }}>
            {hora(reserva.inicio)} – {hora(reserva.fin)}
          </strong>
          <span className="small muted">
            {empezo ? `Quedan ${h > 0 ? `${h} h ` : ''}${m} min` : `Empieza a las ${hora(reserva.inicio)}`}
          </span>
        </div>
        <span className={`badge ${reserva.llegada_en ? 'ok' : 'warn'}`}>
          {reserva.llegada_en ? `Llegada ${hora(reserva.llegada_en)}` : 'Sin llegada'}
        </span>
      </div>

      {error && (
        <div className="alert danger mt">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {!reserva.llegada_en && (
        <div className="small mt" style={{ color: 'var(--ink-700, inherit)' }}>
          {lim.llegadaModo === 0 ? null
            : lim.llegadaModo === 1 ? 'Muestre su pase al personal del laboratorio para registrar la llegada.'
            : 'Para registrar la llegada, abra la isla de Faro en el equipo y escanee el QR «Registrar llegada».'}
        </div>
      )}

      <div className="row tight mt" style={{ flexWrap: 'wrap' }}>
        {!reserva.llegada_en && lim.llegadaModo === 0 && (
          <button className="btn" type="button" disabled={ocupado}
                  onClick={() => void hacer(async () => { await registrarLlegada(reserva.id); toast.mostrar('Llegada registrada.') })}>
            <Icon nombre="check-circulo" /> Registrar llegada
          </button>
        )}
        {empezo && (
          <button className="btn ghost" type="button" disabled={ocupado} onClick={() => setExtendiendo((v) => !v)}>
            <Icon nombre="reloj" /> Extender
          </button>
        )}
        {empezo && (
          <button className="btn ghost" type="button" disabled={ocupado} onClick={() => setLiberando(true)}>
            <Icon nombre="salir" /> Liberar
          </button>
        )}
        <Link className="btn ghost" to={`/credencial/${reserva.id}`}>
          <Icon nombre="qr" /> Mi pase
        </Link>
        {lim.usoCompartido &&
          (reserva.compartida ? (
            <button className="btn ghost" type="button" disabled={ocupado}
                    onClick={() => void hacer(async () => { await marcarCompartida(reserva.id, false); toast.mostrar('Ya no está compartida.') })}>
              <Icon nombre="compartir" /> Dejar de compartir
            </button>
          ) : (
            <button className="btn ghost" type="button" disabled={ocupado} onClick={() => setCompartiendo(true)}>
              <Icon nombre="compartir" /> Compartir mientras no estoy
            </button>
          ))}
      </div>
      {reserva.compartida && (
        <p className="small mt" style={{ margin: 0 }}>
          <span className="badge info">Uso compartido</span> Otras personas pueden usar el equipo sin cerrar{' '}
          {reserva.protegidos?.length ? reserva.protegidos.join(', ') : 'sus programas'}.
        </p>
      )}

      <Modal abierto={compartiendo} titulo={`Compartir ${equipo} mientras no está`} onCerrar={() => setCompartiendo(false)}>
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            Mientras su proceso corre, otras personas pueden usar este equipo y reservarlo en su horario. Verán qué programas no deben
            cerrar, y Faro no deja apagar ni reiniciar el equipo de forma remota. Ellas trabajan en la misma sesión del computador:
            guarde sus resultados en su carpeta o en la nube.
          </p>
          <span className="field__label">Programas que nadie debe cerrar</span>
          {software.length > 0 && (
            <div className="chips" role="group" aria-label="Programas protegidos">
              {software.map((p) => (
                <button key={p} type="button" className={`chip ${protegidos.includes(p) ? 'activo' : ''}`} aria-pressed={protegidos.includes(p)}
                        onClick={() => setProtegidos((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}>
                  {p}
                </button>
              ))}
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor="mr-nota">Nota para quien use el equipo</label>
            <input id="mr-nota" maxLength={140} value={notaCompartir} onChange={(e) => setNotaCompartir(e.target.value)}
                   placeholder="Ej. No cerrar la terminal: entrenamiento hasta las 6 p. m." />
          </div>
          <button type="button" disabled={ocupado}
                  onClick={() => void hacer(async () => {
                    await marcarCompartida(reserva.id, true, protegidos, notaCompartir.trim() || undefined)
                    setCompartiendo(false)
                    toast.mostrar('Listo: su reserva es de uso compartido.')
                  })}>
            <Icon nombre="compartir" /> Compartir
          </button>
        </div>
      </Modal>

      {extendiendo && empezo && (
        <div className="mt">
          {sinExtensiones || opciones.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              {sinExtensiones ? 'Ya usó la extensión permitida para esta reserva.' : 'La reserva ya llegó al tope permitido.'} Para más tiempo, haga
              una reserva nueva.
            </p>
          ) : (
            <>
              <span className="small muted">¿Cuánto tiempo más?</span>
              <div className="chips mt-sm" role="group" aria-label="Extender">
                {opciones.map((x) => (
                  <button key={x} type="button" className="chip" disabled={ocupado}
                          onClick={() => void hacer(async () => {
                            const fin = new Date(new Date(reserva.fin).getTime() + x * 3600_000)
                            await extenderReserva(reserva.id, fin.toISOString())
                            setExtendiendo(false)
                            toast.mostrar(conPunto(`Listo: ahora termina a las ${hora(fin.toISOString())}`))
                          })}>
                    +{x < 1 ? '30 min' : `${x} h`}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Modal abierto={liberando} titulo={`Liberar ${equipo}`} onCerrar={() => setLiberando(false)}
             pie={
               <>
                 <button className="btn gray" type="button" onClick={() => setLiberando(false)}>Cancelar</button>
                 <button className="btn" type="button" disabled={ocupado}
                         onClick={() => {
                           setLiberando(false)
                           const r = reserva
                           void hacer(async () => {
                             await liberarReserva(r.id)
                             toast.mostrar(`Liberó ${equipo}. ¡Gracias!`)
                             setPreguntaValoracion(r)
                           })
                         }}>
                   Liberar ahora
                 </button>
               </>
             }>
        <p className="small" style={{ margin: 0 }}>
          El equipo queda disponible para otra persona. Su reserva iba hasta las {conPunto(hora(reserva.fin))}
        </p>
      </Modal>

      <Modal abierto={!!preguntaValoracion} titulo="¿El equipo funcionó bien?" onCerrar={() => setPreguntaValoracion(null)}
             pie={
               <>
                 <button className="btn gray" type="button"
                         onClick={() => { if (preguntaValoracion) void valorarReserva(preguntaValoracion.id, false); setPreguntaValoracion(null) }}>
                   Tuvo problemas
                 </button>
                 <button className="btn" type="button"
                         onClick={() => { if (preguntaValoracion) void valorarReserva(preguntaValoracion.id, true); setPreguntaValoracion(null) }}>
                   Sí, todo bien
                 </button>
               </>
             }>
        <p className="small" style={{ margin: 0 }}>Su respuesta ayuda al laboratorio a detectar equipos con fallas.</p>
      </Modal>
    </section>
  )
}
