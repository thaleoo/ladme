import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import * as QRCode from 'qrcode'
import { obtenerReserva } from '../lib/api'
import type { Reserva } from '../lib/types'
import { dia, duracion, estadoReserva, hace, hora, tonoEstado } from '../lib/format'
import { useLimites } from '../lib/politicas'
import { publicUrl } from '../lib/supabase'
import PageHeader, { Cargando } from '../components/PageHeader'
import Icon from '../components/Icon'
import Logo from '../components/Logo'
import { useToast } from '../components/Toast'

const REFRESCO_MS = 30000

function icsFecha(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function escaparICS(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export default function Credencial() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const toast = useToast()
  const lim = useLimites()
  const [reserva, setReserva] = useState<Reserva | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [actualizada, setActualizada] = useState<Date | null>(null)
  const [sinRed, setSinRed] = useState(false)
  const [, setTic] = useState(0)
  const recienCreada = !!(location.state as { recienCreada?: boolean } | null)?.recienCreada

  // La credencial nunca es una imagen fija: se vuelve a leer de la base de datos
  // cada 30 s y al volver a la pantalla. Si se extiende o se cancela, cambia sola.
  const cargar = useCallback(async () => {
    if (!id) return
    try {
      const r = await obtenerReserva(id)
      if (!r) {
        setError('La reserva no existe o no le pertenece.')
        return
      }
      setReserva(r)
      setActualizada(new Date())
      setSinRed(false)
      setError(null)
    } catch (e) {
      // Con una copia ya en pantalla solo se avisa; no se da por válida sin red.
      setSinRed(true)
      setReserva((previa) => {
        if (!previa) setError(e instanceof Error ? e.message : 'No se pudo cargar la credencial.')
        return previa
      })
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    if (!id) {
      setError('Credencial no encontrada.')
      setCargando(false)
      return
    }
    void cargar()
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void cargar()
      setTic((n) => n + 1)
    }, REFRESCO_MS)
    const alVolver = () => document.visibilityState === 'visible' && void cargar()
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('online', alVolver)
    return () => {
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('online', alVolver)
    }
  }, [id, cargar])

  const token = reserva?.token_credencial
  const enlace = useMemo(() => (token ? `${publicUrl}/validar/${token}` : ''), [token])

  useEffect(() => {
    if (!enlace) return
    let vivo = true
    QRCode.toDataURL(enlace, { width: 640, margin: 1, color: { dark: '#17122b', light: '#ffffff' } })
      .then((url) => vivo && setQr(url))
      .catch(() => vivo && setQr(null))
    return () => {
      vivo = false
    }
  }, [enlace])

  function descargarICS() {
    if (!reserva) return
    const equipo = reserva.equipos?.codigo ?? 'equipo'
    const lineas = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LADME UNAL//Reservas//ES',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${reserva.id}@ladme`,
      `DTSTAMP:${icsFecha(new Date().toISOString())}`,
      `DTSTART:${icsFecha(reserva.inicio)}`,
      `DTEND:${icsFecha(reserva.fin)}`,
      `SUMMARY:${escaparICS(`LADME · ${equipo}`)}`,
      `LOCATION:${escaparICS(reserva.equipos?.ubicacion || 'Laboratorio LADME')}`,
      `DESCRIPTION:${escaparICS(`Reserva ${reserva.codigo_legible} del equipo ${equipo}. Credencial: ${publicUrl}/credencial/${reserva.id}`)}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ]
    const blob = new Blob([lineas.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${reserva.codigo_legible}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Abre Google Calendar con el evento ya diligenciado: solo falta guardar. */
  function enlaceGoogleCalendar(): string {
    if (!reserva) return '#'
    const equipo = reserva.equipos?.codigo ?? 'equipo'
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: `LADME · ${equipo}`,
      dates: `${icsFecha(reserva.inicio)}/${icsFecha(reserva.fin)}`,
      location: reserva.equipos?.ubicacion || 'Laboratorio LADME',
      details: `Reserva ${reserva.codigo_legible} del equipo ${equipo}.\nPase: ${publicUrl}/credencial/${reserva.id}`
    })
    return `https://calendar.google.com/calendar/render?${q.toString()}`
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace)
      toast.mostrar('Enlace copiado.')
    } catch {
      toast.mostrar('No se pudo copiar. Seleccione el texto y cópielo manualmente.', 'warn')
    }
  }

  if (cargando) return <Cargando texto="Cargando credencial…" />

  if (error || !reserva) {
    return (
      <>
        <PageHeader titulo="Credencial" volver={{ a: '/mis-reservas', texto: 'Mis reservas' }} />
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error ?? 'Credencial no encontrada.'}</div>
        </div>
      </>
    )
  }

  const estado = estadoReserva(reserva, lim.toleranciaMin)
  const inactiva = estado === 'Cancelada' || estado === 'Finalizada'
  const mismoDia = new Date(reserva.inicio).toDateString() === new Date(reserva.fin).toDateString()

  return (
    <>
      <PageHeader
        eyebrow="Credencial"
        titulo="Su pase"
        sub="Muéstrelo al personal del laboratorio. Se actualiza solo si la reserva cambia."
        volver={{ a: '/mis-reservas', texto: 'Mis reservas' }}
      />

      {recienCreada && (
        <div className="alert ok no-imprimir">
          <Icon nombre="check-circulo" />
          <div className="alert__body">
            <strong>Reserva creada.</strong> Este es su pase. También queda en «Mis reservas».
          </div>
        </div>
      )}

      {sinRed && (
        <div className="alert warn no-imprimir">
          <Icon nombre="sin-conexion" />
          <div className="alert__body">
            Sin conexión: el pase puede estar desactualizado. La validación del QR siempre consulta el estado real.
          </div>
        </div>
      )}

      <div className="dos-columnas">
        <article className={`pase${inactiva ? ' pase--inactivo' : ''}`} aria-label={`Pase de la reserva ${reserva.codigo_legible}`}>
          <header className="pase__cabecera">
            <span className="pase__marca">
              <Logo size={30} />
              <span>
                <strong>LADME</strong>
                <span>Laboratorio de Datos · UNAL La Paz</span>
              </span>
            </span>
            <span className={`badge ${tonoEstado(estado)}`}>
              {estado === 'En curso' && <span className="punto" />}
              {estado}
            </span>
          </header>

          <div className="pase__titulo">
            <span className="pase__eyebrow">Equipo reservado</span>
            <h2>{reserva.equipos?.codigo ?? '—'}</h2>
            <p>
              {reserva.equipos?.nombre}
              {reserva.equipos?.ubicacion ? ` · ${reserva.equipos.ubicacion}` : ''}
            </p>
          </div>

          <div className="pase__horario">
            <div>
              <span className="pase__eyebrow">Inicio</span>
              <strong>{hora(reserva.inicio)}</strong>
              <span>{dia(reserva.inicio)}</span>
            </div>
            <span className="pase__flecha" aria-hidden="true">
              <Icon nombre="flecha-der" />
              <small>{duracion(reserva.inicio, reserva.fin)}</small>
            </span>
            <div style={{ textAlign: 'right' }}>
              <span className="pase__eyebrow">Fin</span>
              <strong>{hora(reserva.fin)}</strong>
              <span>{mismoDia ? 'mismo día' : dia(reserva.fin)}</span>
            </div>
          </div>

          <dl className="pase__datos">
            <div className="pase__ancho">
              <dt>Titular</dt>
              <dd>{reserva.perfiles?.nombre ?? '—'}</dd>
              <dd className="pase__sub">{reserva.perfiles?.correo}</dd>
            </div>
            <div>
              <dt>Actividad</dt>
              <dd>{reserva.actividad ?? '—'}</dd>
            </div>
            <div>
              <dt>Reserva</dt>
              <dd className="pase__mono">{reserva.codigo_legible}</dd>
            </div>
          </dl>

          {estado === 'Cancelada' && reserva.motivo && (
            <p className="pase__nota">Cancelada: {reserva.motivo}</p>
          )}

          <div className="pase__corte" aria-hidden="true" />

          <div className="pase__qr">
            <div className="pase__qr-caja">
              {qr ? (
                <img src={qr} alt={`Código QR de la reserva ${reserva.codigo_legible}`} />
              ) : (
                <span className="cargando">
                  <span className="spinner" aria-hidden="true" /> Generando QR…
                </span>
              )}
              {inactiva && <span className="pase__sello">{estado === 'Cancelada' ? 'CANCELADA' : 'FINALIZADA'}</span>}
            </div>
            <p>
              {inactiva
                ? 'Este pase ya no autoriza el uso del equipo.'
                : 'El personal escanea este código para confirmar su reserva y registrar su llegada.'}
            </p>
            <p className="pase__actualizado">
              <Icon nombre="actualizar" width={12} height={12} /> Actualizado{' '}
              {actualizada ? hace(actualizada.toISOString()) : '—'}
            </p>
          </div>
        </article>

        <aside className="stack no-imprimir">
          <section className="card">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Acciones</h3>
            <div className="stack" style={{ marginTop: 'var(--s3)' }}>
              <a className="btn block" href={enlaceGoogleCalendar()} target="_blank" rel="noopener noreferrer">
                <Icon nombre="calendario" /> Añadir a Google Calendar
              </a>
              <Link className="btn ghost block" to="/mis-reservas">
                <Icon nombre="ticket" /> Extender, liberar o cancelar
              </Link>
              <button className="btn gray block" onClick={() => window.print()} type="button">
                <Icon nombre="imprimir" /> Imprimir
              </button>
              <button className="btn-enlace" onClick={descargarICS} type="button">
                Descargar archivo .ics (Outlook, Apple)
              </button>
            </div>
          </section>

          <section className="card">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Enlace de validación</h3>
            <p className="tiny muted">Si el QR no se puede escanear, el personal puede abrir este enlace.</p>
            <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'nowrap' }}>
              <input readOnly value={enlace} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de validación" />
              <button className="btn ghost" onClick={copiar} type="button" aria-label="Copiar enlace">
                <Icon nombre="copiar" />
              </button>
            </div>
            <p className="tiny muted" style={{ marginTop: 'var(--s3)', marginBottom: 0 }}>
              El código es aleatorio y no contiene datos personales. Una captura de pantalla no sirve si la
              reserva se cancela o termina: el estado se consulta en línea.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}
