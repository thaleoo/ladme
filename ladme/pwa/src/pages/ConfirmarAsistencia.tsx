import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { confirmarLlegada } from '../lib/api'
import { useLlegadaPendiente } from '../components/AsistenciaPendiente'
import PageHeader, { Cargando } from '../components/PageHeader'
import Icon from '../components/Icon'

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })

/**
 * Confirmar asistencia: la persona escribe el código de 6 dígitos que muestra la isla de Faro en el
 * equipo (cambia cada 30 s), o llega aquí con el QR de la isla y el código ya puesto. Así la llegada
 * solo se registra estando frente al equipo.
 */
export default function ConfirmarAsistencia() {
  const [params] = useSearchParams()
  const { pendiente, recargar } = useLlegadaPendiente()
  const [cargado, setCargado] = useState(false)
  const [codigo, setCodigo] = useState((params.get('c') ?? '').replace(/\D/g, '').slice(0, 6))
  const [estado, setEstado] = useState<'escribiendo' | 'enviando' | 'listo'>('escribiendo')
  const [equipoOk, setEquipoOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const auto = useRef(false)

  useEffect(() => {
    const t = window.setTimeout(() => setCargado(true), 900)
    return () => window.clearTimeout(t)
  }, [])
  useEffect(() => {
    if (pendiente) setCargado(true)
  }, [pendiente])

  async function enviar(c = codigo) {
    if (c.length !== 6 || estado === 'enviando') return
    setEstado('enviando')
    setError(null)
    try {
      const r = await confirmarLlegada(c)
      if (r.ok) {
        setEquipoOk(r.equipo ?? pendiente?.equipo ?? '')
        setEstado('listo')
        window.dispatchEvent(new Event('ladme:llegada'))
        navigator.vibrate?.(40)
      } else {
        setError(r.error ?? 'No se pudo confirmar.')
        setCodigo('')
        setEstado('escribiendo')
        window.setTimeout(() => entrada.current?.focus(), 50)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo confirmar.')
      setEstado('escribiendo')
    }
  }

  // Con el QR de la isla el código llega en la dirección: se confirma solo.
  useEffect(() => {
    if (!auto.current && codigo.length === 6 && params.get('c')) {
      auto.current = true
      void enviar(codigo)
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const cabecera = <PageHeader eyebrow="Llegada" titulo="Confirmar asistencia" volver={{ a: '/mis-reservas', texto: 'Mis reservas' }} />

  if (estado === 'listo') {
    return (
      <div className="stack">
        {cabecera}
        <section className="card asistencia-ok">
          <span className="asistencia-ok__icono"><Icon nombre="check" width={30} height={30} /></span>
          <h2>Asistencia confirmada</h2>
          <p className="small muted">{equipoOk ? `Su llegada a ${equipoOk} quedó registrada.` : 'Su llegada quedó registrada.'} Buen trabajo.</p>
          <Link className="btn" to="/mis-reservas">Ver mi reserva</Link>
        </section>
      </div>
    )
  }

  if (!pendiente && !cargado) return <Cargando texto="Buscando su reserva…" />

  return (
    <div className="stack">
      {cabecera}
      {!pendiente ? (
        <section className="card stack">
          <p style={{ margin: 0 }}>No tiene una reserva que esté empezando ahora.</p>
          <p className="small muted" style={{ margin: 0 }}>
            La confirmación se abre 15 minutos antes del inicio de su reserva y dura hasta el límite de llegada.
          </p>
          <button type="button" className="btn ghost" onClick={recargar}>Volver a buscar</button>
        </section>
      ) : (
        <section className="card asistencia">
          <div className="asistencia__equipo">
            <span className="asistencia__codigo-eq">{pendiente.equipo}</span>
            <span className="small muted">
              {pendiente.codigo_legible} · confirme antes de las <strong>{hora(pendiente.limite)}</strong>
            </span>
          </div>
          <ol className="asistencia__pasos small">
            <li>En el equipo, abra la isla de Faro y toque <strong>Confirmar asistencia</strong>.</li>
            <li>Escriba aquí el código de 6 dígitos (cambia cada 30 segundos) o escanee el QR de la isla.</li>
          </ol>
          <form
            className="asistencia__form"
            onSubmit={(e) => {
              e.preventDefault()
              void enviar()
            }}
          >
            <label className="sr-only" htmlFor="as-codigo">Código de Faro</label>
            <input
              id="as-codigo"
              ref={entrada}
              className="asistencia__input num"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={7}
              placeholder="000 000"
              autoFocus
              value={codigo.length > 3 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo}
              onChange={(e) => {
                const c = e.target.value.replace(/\D/g, '').slice(0, 6)
                setCodigo(c)
                setError(null)
                if (c.length === 6) void enviar(c)
              }}
              disabled={estado === 'enviando'}
              aria-invalid={!!error}
            />
            <button type="submit" disabled={codigo.length !== 6 || estado === 'enviando'}>
              {estado === 'enviando' ? 'Confirmando…' : 'Confirmar'}
            </button>
          </form>
          {error && (
            <div className="alert danger" role="alert">
              <Icon nombre="alerta" />
              <div className="alert__body">{error}</div>
            </div>
          )}
          <p className="tiny muted" style={{ margin: 0 }}>
            Si dejó un proceso desatendido, también debe confirmar al llegar. Si la isla no funciona, pida al personal que registre su
            llegada.
          </p>
        </section>
      )}
    </div>
  )
}
