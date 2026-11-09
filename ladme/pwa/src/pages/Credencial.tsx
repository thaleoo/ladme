import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import * as QRCode from 'qrcode'
import { obtenerReserva } from '../lib/api'
import type { Reserva } from '../lib/types'
import { estadoReserva, rango } from '../lib/format'
import { publicUrl } from '../lib/supabase'

function icsFecha(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function escaparICS(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export default function Credencial() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
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

  if (cargando) return <div className="card center muted">Cargando credencial…</div>
  if (error || !reserva) return <div className="alert danger">{error ?? 'Credencial no encontrada.'}</div>

  const estado = estadoReserva(reserva)

  return (
    <>
      {recienCreada && (
        <div className="alert ok">
          ✅ Reserva creada. Guarde o descargue su credencial: el QR es la prueba para el laboratorista.
        </div>
      )}

      <div className="card accent center">
        <h2>Credencial de reserva</h2>
        <p className="muted small">Muestre este QR al personal del laboratorio cuando llegue.</p>

        <div className="qr-box">
          {qr ? <img src={qr} alt={`Código QR de la reserva ${reserva.codigo_legible}`} /> : <span className="muted">Generando QR…</span>}
        </div>

        <h3 className="mt">{reserva.codigo_legible}</h3>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className={`badge ${estado === 'En curso' ? 'ok' : estado === 'Cancelada' ? 'danger' : ''}`}>{estado}</span>
          <span className="badge gray">Equipo</span>
        </div>
        <p className="small mt mb-0">{rango(reserva.inicio, reserva.fin)}</p>
        {reserva.actividad && <p className="small muted">{reserva.actividad}</p>}

        <div className="row mt" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={descargarICS}>Añadir al calendario</button>
          <button className="btn ghost" onClick={() => window.print()}>Imprimir</button>
          <Link className="btn gray" to="/mis-reservas">Mis reservas</Link>
        </div>
      </div>

      <div className="card">
        <h4>Enlace de validación</h4>
        <p className="small muted">Si el QR no se puede escanear, el laboratorista puede abrir este enlace o buscar el código.</p>
        <input readOnly value={enlace} onFocus={(e) => e.currentTarget.select()} />
        <p className="tiny muted mt">
          El token es aleatorio y no contiene datos personales. Si comparte el enlace, otra persona podría
          ver el estado de esta reserva. La reserva solo puede gestionarla usted.
        </p>
      </div>
    </>
  )
}
