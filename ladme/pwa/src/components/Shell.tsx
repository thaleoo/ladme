import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { esAdmin, esStaff, useAuth } from '../context/AuthContext'
import AvisosPush from './AvisosPush'

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function Shell() {
  const { perfil, salir } = useAuth()
  const navigate = useNavigate()
  const [enLinea, setEnLinea] = useState(navigator.onLine)
  const [instalacion, setInstalacion] = useState<EventoInstalacion | null>(null)

  useEffect(() => {
    const arriba = () => setEnLinea(true)
    const abajo = () => setEnLinea(false)
    const preparado = (e: Event) => {
      e.preventDefault()
      setInstalacion(e as EventoInstalacion)
    }
    window.addEventListener('online', arriba)
    window.addEventListener('offline', abajo)
    window.addEventListener('beforeinstallprompt', preparado)
    return () => {
      window.removeEventListener('online', arriba)
      window.removeEventListener('offline', abajo)
      window.removeEventListener('beforeinstallprompt', preparado)
    }
  }, [])

  async function cerrar() {
    await salir()
    navigate('/login', { replace: true })
  }

  async function instalar() {
    if (!instalacion) return
    await instalacion.prompt()
    await instalacion.userChoice
    setInstalacion(null)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <strong>LADME</strong>
        <span className="who">{perfil?.nombre} · {perfil?.correo}</span>
        <span className="spacer" />
        {!enLinea && <span className="badge danger">Sin conexión</span>}
        {instalacion && (
          <button className="icon" onClick={instalar} title="Instalar LADME">
            Instalar
          </button>
        )}
        {perfil && (
          <button className="icon" onClick={cerrar} title="Cerrar sesión" aria-label="Cerrar sesión">
            Salir
          </button>
        )}
      </header>

      <main className="container">
        <nav className="tabs" aria-label="Secciones">
          <NavLink to="/" end>Disponibilidad</NavLink>
          <NavLink to="/reservar">Reservar</NavLink>
          <NavLink to="/mis-reservas">Mis reservas</NavLink>
          {esStaff(perfil) && <NavLink to="/validar">Validar QR</NavLink>}
          {esStaff(perfil) && <NavLink to="/mantenimiento">Mantenimiento</NavLink>}
          {esAdmin(perfil) && <NavLink to="/usuarios">Usuarios</NavLink>}
        </nav>
        {!enLinea && (
          <div className="alert warn">
            Está sin conexión. Puede consultar la aplicación, pero reservar, cancelar o validar requiere internet.
          </div>
        )}
        <AvisosPush />
        <Outlet />
      </main>
    </div>
  )
}
