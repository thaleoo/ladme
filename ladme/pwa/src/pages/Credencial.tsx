import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import * as QRCode from 'qrcode'
import { obtenerReserva } from '../lib/api'
import type { Reserva } from '../lib/types'
import { estadoReserva, horasEntre, rango } from '../lib/format'
import { publicUrl } from '../lib/supabase'
import PageHeader, { Cargando } from '../components/PageHeader'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'

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
  const [reserva, setReserva] = useState<Reserva | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const recienCreada = !!(location.state as { recienCreada?: boolean } | null)?.recienCreada

  useEffect(() => {
    let vivo = true
    if (!id) {
      setError('Credencial no encontrada.')
      setCargando(false)
      return
    }
    obtenerReserva(id)
      .then((r) => {
        if (!vivo) return
        if (!r) {
          setError('La reserva no existe o no le pertenece.')
          return
        }
        setReserva(r)
        const destino = `${publicUrl}/validar/${r.token_credencial}`
        return QRCode.toDataURL(destino, { width: 640, margin: 1, color: { dark: '#3b0764', light: '#ffffff' } })
      })
      .then((url) => {
        if (vivo && url) setQr(url)
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar la credencial.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [id])

  const enlace = useMemo(
    () => (reserva ? `${publicUrl}/validar/${reserva.token_credencial}` : ''),
    [reserva]
  )

  function descargarICS() {
    if (!reserva) return
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
      `SUMMARY:${escaparICS(`LADME · ${reserva.codigo_legible}`)}`,
      `DESCRIPTION:${escaparICS(`Reserva de equipo LADME. Credencial: ${enlace}`)}`,
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

  const estado = estadoReserva(reserva)

  return (
    <>
      <PageHeader
        eyebrow="Credencial"
        titulo={reserva.codigo_legible}
        sub="Muéstrela al personal del laboratorio al llegar."
        volver={{ a: '/mis-reservas', texto: 'Mis reservas' }}
      />

      {recienCreada && (
        <div className="alert ok">
          <Icon nombre="check-circulo" />
          <div className="alert__body">
            <strong>Reserva creada.</strong> Guarde o descargue su credencial: el QR es la prueba para el
            laboratorista.
          </div>
        </div>
      )}

      <div className="dos-columnas">
        <section className="card credencial">
          <span className={`badge ${estado === 'En curso' ? 'ok' : estado === 'Cancelada' ? 'danger' : 'info'}`}>
            {estado}
          </span>

          <div className="credencial__qr">
            {qr ? (
              <img src={qr} alt={`Código QR de la reserva ${reserva.codigo_legible}`} />
            ) : (
              <span className="cargando">
                <span className="spinner" aria-hidden="true" /> Generando QR…
              </span>
            )}
          </div>

          <div className="credencial__codigo">{reserva.codigo_legible}</div>
          <p className="small muted" style={{ marginTop: 4 }}>
            {rango(reserva.inicio, reserva.fin)}
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 'var(--s2)' }}>
            <span className="badge outline num">{horasEntre(reserva.inicio, reserva.fin).toFixed(0)} h</span>
            {reserva.actividad && <span className="badge outline">{reserva.actividad}</span>}
          </div>
        </section>

        <aside className="stack">
          <section className="card">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Acciones</h3>
            <div className="stack" style={{ marginTop: 'var(--s3)' }}>
              <button className="btn block" onClick={descargarICS} type="button">
                <Icon nombre="calendario" /> Añadir al calendario
              </button>
              <button className="btn ghost block" onClick={() => window.print()} type="button">
                <Icon nombre="imprimir" /> Imprimir credencial
              </button>
              <Link className="btn gray block" to="/mis-reservas">
                <Icon nombre="ticket" /> Mis reservas
              </Link>
            </div>
          </section>

          <section className="card">
            <h3 style={{ fontSize: 'var(--text-base)' }}>Enlace de validación</h3>
            <p className="tiny muted">
              Si el QR no se puede escanear, el laboratorista puede abrir este enlace o buscar el código a
              mano.
            </p>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <input readOnly value={enlace} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de validación" />
              <button className="btn ghost" onClick={copiar} type="button" aria-label="Copiar enlace">
                <Icon nombre="copiar" />
              </button>
            </div>
            <p className="tiny muted" style={{ marginTop: 'var(--s3)', marginBottom: 0 }}>
              El token es aleatorio y no contiene datos personales. Quien tenga el enlace puede ver el estado
              de esta reserva, pero solo usted puede gestionarla.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}
