import { useEffect, useRef, useState } from 'react'
import { hora } from '../lib/format'
import { Link, useSearchParams } from 'react-router-dom'
import { desbloquearConQr, type DesbloqueoQr } from '../lib/api'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'

/**
 * Llega aquí con el QR de una pantalla suspendida por Faro (cambia cada minuto). Si el equipo tiene una
 * reserva vigente, solo su titular lo desbloquea; si no, cualquier cuenta frente al equipo (queda registrado).
 */
export default function DesbloquearPantalla() {
  const [params] = useSearchParams()
  const equipo = (params.get('equipo') ?? '').toUpperCase()
  const codigo = params.get('c') ?? ''
  const [estado, setEstado] = useState<'enviando' | 'listo' | 'error' | 'confirmar'>('enviando')
  const [texto, setTexto] = useState('')
  const [pregunta, setPregunta] = useState<Extract<DesbloqueoQr, { confirmar: true }> | null>(null)
  const hecho = useRef(false)

  function resultado(r: DesbloqueoQr) {
    if (r.ok) { setTexto(r.texto); setEstado('listo'); navigator.vibrate?.(40) }
    else { setPregunta(r); setEstado('confirmar') }
  }
  function fallo(e: unknown) {
    setEstado('error')
    setTexto((e instanceof Error ? e.message : 'No se pudo desbloquear.').replace(/^No se pudo desbloquear: /, ''))
  }

  useEffect(() => {
    if (hecho.current) return
    hecho.current = true
    if (!equipo || !codigo) {
      setEstado('error')
      setTexto('Este enlace no está completo. Escanee de nuevo el QR que muestra la pantalla del equipo.')
      return
    }
    desbloquearConQr(equipo, codigo).then(resultado).catch(fallo)
  }, [equipo, codigo])

  return (
    <div className="stack">
      <PageHeader eyebrow="Faro" titulo={equipo ? `Desbloquear ${equipo}` : 'Desbloquear pantalla'} volver={{ a: '/mis-reservas', texto: 'Mis reservas' }} />
      {estado === 'enviando' ? (
        <section className="card asistencia-ok">
          <span className="spinner" aria-hidden="true" />
          <p className="small muted" style={{ margin: 0 }}>Desbloqueando…</p>
        </section>
      ) : estado === 'confirmar' && pregunta ? (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Este equipo es de {pregunta.titular}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Su reserva sigue hasta las {hora(pregunta.hasta)}. Si lo desbloquea como personal, {pregunta.titular} recibe un aviso y queda en la actividad de Faro.
          </p>
          <div className="row tight">
            <button className="btn" type="button" onClick={() => { setEstado('enviando'); desbloquearConQr(equipo, codigo, true).then(resultado).catch(fallo) }}>
              Desbloquear como personal
            </button>
            <Link className="btn ghost" to="/admin?tab=faro">Cancelar</Link>
          </div>
        </section>
      ) : estado === 'listo' ? (
        <section className="card asistencia-ok">
          <span className="asistencia-ok__icono"><Icon nombre="check" width={30} height={30} /></span>
          <h2>Pantalla desbloqueada</h2>
          <p className="small muted" style={{ margin: 0 }}>{texto} La pantalla se quita en unos segundos.</p>
          <Link className="btn" to="/mis-reservas">Ver mi reserva</Link>
        </section>
      ) : (
        <section className="card stack">
          <div className="alert danger" role="alert"><Icon nombre="alerta" /><span>{texto}</span></div>
          <p className="small muted" style={{ margin: 0 }}>
            Si tiene la reserva de este equipo, también puede escribir en la pantalla el código de su reserva (está en Mis reservas).
          </p>
          <Link className="btn ghost" to="/mis-reservas">Ir a Mis reservas</Link>
        </section>
      )}
    </div>
  )
}
