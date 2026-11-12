import { Link, useLocation } from 'react-router-dom'
import Icon from '../components/Icon'
import Logo from '../components/Logo'

export default function NoEncontrada() {
  const location = useLocation()

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
