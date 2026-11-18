import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { extenderReserva, liberarReserva, misReservas, valorarReserva } from '../lib/api'
import type { Reserva } from '../lib/types'
import { conPunto, hora, horasEntre } from '../lib/format'
import { useLimites } from '../lib/politicas'
import PageHeader, { Cargando } from '../components/PageHeader'
import ReporteFalla from '../components/ReporteFalla'
import Icon from '../components/Icon'

type Accion = 'extender' | 'liberar' | 'reportar' | 'reservar'
const ACCIONES: Accion[] = ['extender', 'liberar', 'reportar', 'reservar']

/**
 * Lo que abre el QR de la isla de Faro: la acción directa, sin pasar por la ficha.
 * /pc/UNAL-05/extender · /pc/UNAL-05/liberar · /pc/UNAL-05/reportar · /pc/UNAL-05/reservar
 */
export default function AccionRapida() {
  const { codigo = '', accion = '' } = useParams<{ codigo: string; accion: string }>()
  const equipo = codigo.toUpperCase()
  const lim = useLimites()
  const [reserva, setReserva] = useState<Reserva | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [valorada, setValorada] = useState(false)
  const [reporte, setReporte] = useState(accion === 'reportar')

  useEffect(() => {
    if (accion !== 'extender' && accion !== 'liberar') return
    misReservas()
      .then((l) => {
        const ahora = Date.now()
        setReserva(
          l.find((r) => r.equipos?.codigo === equipo && r.estado === 'activa' && !r.liberada_en &&
                        new Date(r.inicio).getTime() <= ahora + 15 * 60_000 && new Date(r.fin).getTime() > ahora) ?? null
        )
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar su reserva.'))
  }, [accion, equipo])

  // Opciones de extensión que respetan los límites vigentes.
  const opciones = useMemo(() => {
    if (!reserva) return []
    const tope = reserva.excepcion ? horasEntre(reserva.inicio, reserva.fin) + lim.maxExtension : lim.maxTotal
    const restante = Math.min(lim.maxExtension, tope - horasEntre(reserva.inicio, reserva.fin))
    return [0.5, 1, 2, 4, 8, 24].filter((h) => h <= restante + 1e-9)
  }, [reserva, lim])
  const sinExtensiones = !!reserva && (reserva.extensiones ?? 0) >= lim.extensionesMax

  if (!ACCIONES.includes(accion as Accion)) return <Navigate to={`/equipo/${equipo}`} replace />
  if (accion === 'reservar') return <Navigate to={`/reservar?equipo=${encodeURIComponent(equipo)}`} replace />

  async function extender(horas: number) {
    if (!reserva) return
    setOcupado(true)
    setError(null)
    try {
      const fin = new Date(new Date(reserva.fin).getTime() + horas * 3600_000)
      await extenderReserva(reserva.id, fin.toISOString())
      setHecho(conPunto(`Listo: su reserva de ${equipo} ahora termina a las ${hora(fin.toISOString())}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo extender la reserva.')
    } finally {
      setOcupado(false)
    }
  }

  async function liberar() {
    if (!reserva) return
    setOcupado(true)
    setError(null)
    try {
      await liberarReserva(reserva.id)
      setHecho(`Liberó ${equipo}. ¡Gracias! Ya está disponible para otra persona.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo liberar el equipo.')
    } finally {
      setOcupado(false)
    }
  }

  const titulo = accion === 'extender' ? `Extender ${equipo}` : accion === 'liberar' ? `Liberar ${equipo}` : `Reportar falla en ${equipo}`

  return (
    <>
      <PageHeader eyebrow="Desde el equipo" titulo={titulo} />

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {hecho ? (
        <section className="card stack" style={{ textAlign: 'center' }}>
          <Icon nombre="check-circulo" width={44} height={44} style={{ color: 'var(--ok-600, #16a34a)', margin: '0 auto' }} />
          <strong style={{ fontSize: 'var(--text-lg)' }}>{hecho}</strong>
          <p className="small muted" style={{ margin: 0 }}>La isla del equipo se actualiza en unos segundos.</p>
          {accion === 'liberar' && reserva && !valorada && (
            <div className="stack" style={{ gap: 'var(--s2)' }}>
              <span className="small">¿El equipo funcionó bien?</span>
              <div className="row tight" style={{ justifyContent: 'center' }}>
                <button className="btn ghost" type="button" onClick={() => { void valorarReserva(reserva.id, true); setValorada(true) }}>Sí</button>
                <button className="btn ghost" type="button" onClick={() => { void valorarReserva(reserva.id, false); setValorada(true); setReporte(true) }}>
                  Tuvo problemas
                </button>
              </div>
            </div>
          )}
          <Link className="btn gray" to="/mis-reservas">Ver mis reservas</Link>
        </section>
      ) : accion === 'reportar' ? (
        <section className="card stack">
          <p className="small" style={{ margin: 0 }}>Cuéntele al laboratorio qué pasa con {equipo}. El personal recibe el aviso de inmediato.</p>
          <button className="btn" type="button" onClick={() => setReporte(true)}>
            <Icon nombre="alerta" /> Escribir el reporte
          </button>
        </section>
      ) : reserva === undefined ? (
        <Cargando texto="Buscando su reserva…" />
      ) : reserva === null ? (
        <section className="card stack">
          <strong>No tiene una reserva vigente en {equipo}</strong>
          <p className="small muted" style={{ margin: 0 }}>
            Solo quien reservó el equipo puede {accion === 'extender' ? 'extender' : 'liberar'} su reserva. Si el equipo está libre, puede reservarlo.
          </p>
          <div className="row tight">
            <Link className="btn" to={`/reservar?equipo=${encodeURIComponent(equipo)}`}>Reservar {equipo}</Link>
            <Link className="btn gray" to={`/equipo/${equipo}`}>Ver el equipo</Link>
          </div>
        </section>
      ) : accion === 'extender' ? (
        <section className="card stack">
          <p className="small" style={{ margin: 0 }}>
            Su reserva termina a las <strong>{conPunto(hora(reserva.fin))}</strong> ¿Cuánto tiempo más necesita?
          </p>
          {sinExtensiones || opciones.length === 0 ? (
            <div className="alert warn">
              <Icon nombre="alerta" />
              <div className="alert__body">
                {sinExtensiones ? 'Ya usó la extensión permitida para esta reserva.' : 'La reserva ya llegó al tope permitido.'} Para más tiempo,
                haga una nueva reserva o una solicitud de reserva larga.
              </div>
            </div>
          ) : (
            <div className="grid cols-3" style={{ gap: 'var(--s2)' }}>
              {opciones.map((h) => (
                <button key={h} className="btn lg" type="button" disabled={ocupado} onClick={() => void extender(h)}>
                  +{h < 1 ? '30 min' : `${h} h`}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="card stack">
          <p className="small" style={{ margin: 0 }}>
            Si ya terminó, libere {equipo} para que otra persona pueda usarlo. {conPunto(`Su reserva iba hasta las ${hora(reserva.fin)}`)}
          </p>
          <button className="btn lg" type="button" disabled={ocupado} onClick={() => void liberar()}>
            <Icon nombre="salir" /> {ocupado ? 'Liberando…' : 'Liberar ahora'}
          </button>
        </section>
      )}

      <ReporteFalla equipo={equipo} abierto={reporte} alCerrar={() => setReporte(false)}
                    alEnviar={() => { setReporte(false); setHecho(`Reporte enviado. El personal revisará ${equipo}.`) }} />
    </>
  )
}
