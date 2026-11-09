import { Link } from 'react-router-dom'

export default function NoEncontrada() {
  return (
    <div className="container">
      <div className="card center">
        <h2>Página no encontrada</h2>
        <p className="muted">El enlace no existe o cambió de dirección.</p>
        <Link className="btn" to="/">Ir a disponibilidad</Link>
      </div>
    </div>
  )
}
