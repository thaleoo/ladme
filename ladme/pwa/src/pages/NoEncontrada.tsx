import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { aplicarActualizacion, buscarVersionNueva } from '../lib/sw'
import Icon from '../components/Icon'
import Logo from '../components/Logo'

export default function NoEncontrada() {
  const location = useLocation()
  // Un enlace nuevo (p. ej. el QR de un equipo) puede caer aquí si el celular tiene una versión
  // vieja de la app en caché: se busca la versión nueva y, si existe, se activa y se reintenta.
  const [buscando, setBuscando] = useState(true)
  useEffect(() => {
    const clave = `ladme-reintento:${location.pathname}`
    if (sessionStorage.getItem(clave)) { setBuscando(false); return }
    let vivo = true
    void buscarVersionNueva().then((hay) => {
      if (!vivo) return
      if (hay) {
        sessionStorage.setItem(clave, '1')
        void aplicarActualizacion()
      } else {
        setBuscando(false)
      }
    })
    return () => { vivo = false }
  }, [location.pathname])

  if (buscando)
    return (
      <section className="card" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s4)' }}>
          <Logo size={52} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>Buscando la versión más reciente de LADME…</p>
      </section>
    )

  return (
    <section className="card" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s4)' }}>
        <Logo size={52} />
      </div>
      <span className="badge gray">Error 404</span>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--s3)' }}>Esta página no existe</h1>
      <p className="small muted">
        El enlace <code>{location.pathname}</code> no corresponde a ninguna sección de LADME. Puede
        haber cambiado de dirección o haberse escrito con algún error.
      </p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--s4)' }}>
        <Link className="btn" to="/">
          <Icon nombre="inicio" /> Ir a disponibilidad
        </Link>
        <Link className="btn ghost" to="/mis-reservas">
          <Icon nombre="ticket" /> Mis reservas
        </Link>
      </div>
    </section>
  )
}
