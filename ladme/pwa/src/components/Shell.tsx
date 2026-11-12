import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { esAdmin, esStaff, useAuth } from '../context/AuthContext'
import AvisosPush from './AvisosPush'
import Icon, { type NombreIcono } from './Icon'
import Logo from './Logo'
import Modal from './Modal'

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface Enlace {
  a: string
  texto: string
  icono: NombreIcono
  fin?: boolean
}

const ROL_ETIQUETA: Record<string, string> = {
  usuario: 'Usuario',
  laboratorista: 'Laboratorista',
  administrador: 'Administrador'
}

const TITULOS: Array<[RegExp, string]> = [
  [/^\/$/, 'Disponibilidad'],
  [/^\/reservar/, 'Nueva reserva'],
  [/^\/mis-reservas/, 'Mis reservas'],
  [/^\/credencial/, 'Credencial'],
  [/^\/equipo\//, 'Ficha del equipo'],
  [/^\/validar/, 'Validar credencial'],
  [/^\/mantenimiento/, 'Mantenimiento'],
  [/^\/usuarios/, 'Usuarios'],
  [/^\/cuenta/, 'Mi cuenta']
]

function iniciales(nombre?: string | null, correo?: string | null): string {
  const base = (nombre ?? '').trim() || (correo ?? '').split('@')[0] || '?'
  const partes = base.split(/[\s._-]+/).filter(Boolean)
  const letras = partes.length >= 2 ? partes[0][0] + partes[1][0] : base.slice(0, 2)
  return letras.toUpperCase()
}

export default function Shell() {
  const { perfil, salir } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [enLinea, setEnLinea] = useState(navigator.onLine)
  const [instalacion, setInstalacion] = useState<EventoInstalacion | null>(null)
  const [masAbierto, setMasAbierto] = useState(false)

  const staff = esStaff(perfil)
  const admin = esAdmin(perfil)

  const operacion = useMemo<Enlace[]>(() => {
    const base: Enlace[] = [
      { a: '/', texto: 'Disponibilidad', icono: 'inicio', fin: true },
      { a: '/reservar', texto: 'Reservar', icono: 'reservar' },
      { a: '/mis-reservas', texto: 'Mis reservas', icono: 'ticket' }
    ]
    if (staff) base.push({ a: '/validar', texto: 'Validar credencial', icono: 'qr' })
    return base
  }, [staff])

  const gestion = useMemo<Enlace[]>(() => {
    const lista: Enlace[] = []
    if (staff) lista.push({ a: '/mantenimiento', texto: 'Mantenimiento', icono: 'llave' })
    if (admin) lista.push({ a: '/usuarios', texto: 'Usuarios', icono: 'usuarios' })
    return lista
  }, [staff, admin])

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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    setMasAbierto(false)
  }, [location.pathname])

  async function cerrar() {
    await salir()
    navigate('/login', { replace: true })
  }

  async function instalar() {
    if (!instalacion) return
    await instalacion.prompt()
    await instalacion.userChoice
    setInstalacion(null)
    setMasAbierto(false)
  }

  const titulo = TITULOS.find(([patron]) => patron.test(location.pathname))?.[1] ?? 'LADME'
  const inicial = iniciales(perfil?.nombre, perfil?.correo)

  const enlacesMoviles: Enlace[] = staff
    ? [
        { a: '/', texto: 'Inicio', icono: 'inicio', fin: true },
        { a: '/reservar', texto: 'Reservar', icono: 'reservar' },
        { a: '/mis-reservas', texto: 'Reservas', icono: 'ticket' },
        { a: '/validar', texto: 'Validar', icono: 'qr' }
      ]
    : [
        { a: '/', texto: 'Inicio', icono: 'inicio', fin: true },
        { a: '/reservar', texto: 'Reservar', icono: 'reservar' },
        { a: '/mis-reservas', texto: 'Reservas', icono: 'ticket' },
        { a: '/cuenta', texto: 'Cuenta', icono: 'usuario' }
      ]

  return (
    <div className="app">
      <a className="salto-al-contenido" href="#contenido">
        Saltar al contenido
      </a>

      <aside className="sidebar">
        <Link className="sidebar__brand" to="/">
          <Logo />
          <span>
            <strong>LADME</strong>
            <span>Reservas y equipos · UNAL</span>
          </span>
        </Link>

        <nav className="sidebar__nav" aria-label="Secciones">
          <div className="sidebar__group">Operación</div>
          {operacion.map((e) => (
            <NavLink key={e.a} to={e.a} end={e.fin} className="sidebar__link">
              <Icon nombre={e.icono} />
              {e.texto}
            </NavLink>
          ))}
          {gestion.length > 0 && (
            <>
              <div className="sidebar__group">Gestión</div>
              {gestion.map((e) => (
                <NavLink key={e.a} to={e.a} className="sidebar__link">
                  <Icon nombre={e.icono} />
                  {e.texto}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="sidebar__footer">
          {!enLinea && (
            <span className="badge warn">
              <Icon nombre="sin-conexion" /> Sin conexión
            </span>
          )}
          {instalacion && (
            <button className="btn ghost sm block" onClick={instalar} type="button">
              <Icon nombre="descargar" /> Instalar LADME
            </button>
          )}
          <Link to="/cuenta" className="usuario-chip">
            <span className="avatar">{inicial}</span>
            <span className="usuario-chip__texto">
              <span className="usuario-chip__nombre">{perfil?.nombre || 'Mi cuenta'}</span>
              <span className="usuario-chip__rol">
                {perfil ? ROL_ETIQUETA[perfil.rol] ?? perfil.rol : 'Sin perfil'}
              </span>
            </span>
          </Link>
          <button className="btn gray sm block" onClick={cerrar} type="button">
            <Icon nombre="salir" /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="columna">
        <header className="appbar">
          <Link to="/" className="icon-btn" aria-label="Inicio" style={{ display: 'grid', placeItems: 'center' }}>
            <Logo size={32} />
          </Link>
          <div className="appbar__titles">
            <p className="appbar__title">{titulo}</p>
            <p className="appbar__sub">
              {perfil ? `${perfil.nombre || perfil.correo}` : 'LADME · UNAL'}
            </p>
          </div>
          {!enLinea && (
            <span className="badge warn" title="Sin conexión">
              <Icon nombre="sin-conexion" />
            </span>
          )}
          <Link to="/cuenta" className="icon-btn" aria-label="Mi cuenta" style={{ padding: 0, width: 'auto' }}>
            <span className="avatar sm">{inicial}</span>
          </Link>
        </header>

        <main className="main" id="contenido">
          <div className="page">
            <div className="page-body">
              {!enLinea && (
                <div className="alert warn">
                  <Icon nombre="sin-conexion" />
                  <div className="alert__body">
                    <strong>Sin conexión.</strong> Puede consultar la aplicación, pero reservar, cancelar
                    o validar requiere internet.
                  </div>
                </div>
              )}
              <AvisosPush />
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      <nav className="bottomnav" aria-label="Navegación principal">
        {enlacesMoviles.map((e) => (
          <NavLink key={e.a} to={e.a} end={e.fin} className="bottomnav__link">
            <Icon nombre={e.icono} />
            <span>{e.texto}</span>
          </NavLink>
        ))}
        {staff && (
          <button
            type="button"
            className={`bottomnav__link${gestion.some((g) => g.a === location.pathname) ? ' activo' : ''}`}
            onClick={() => setMasAbierto(true)}
            aria-haspopup="dialog"
          >
            <Icon nombre="mas" />
            <span>Más</span>
          </button>
        )}
      </nav>

      <Modal
        abierto={masAbierto}
        titulo="Más opciones"
        descripcion={perfil ? `${perfil.nombre || perfil.correo} · ${ROL_ETIQUETA[perfil.rol] ?? perfil.rol}` : undefined}
        onCerrar={() => setMasAbierto(false)}
      >
        <div className="stack">
          {gestion.map((e) => (
            <Link
              key={e.a}
              to={e.a}
              className="btn ghost block"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => setMasAbierto(false)}
            >
              <Icon nombre={e.icono} /> {e.texto}
            </Link>
          ))}
          <Link
            to="/cuenta"
            className="btn ghost block"
            style={{ justifyContent: 'flex-start' }}
            onClick={() => setMasAbierto(false)}
          >
            <Icon nombre="usuario" /> Mi cuenta
          </Link>
          {instalacion && (
            <button className="btn ghost block" style={{ justifyContent: 'flex-start' }} onClick={instalar} type="button">
              <Icon nombre="descargar" /> Instalar LADME
            </button>
          )}
          <button className="btn danger block" style={{ justifyContent: 'flex-start' }} onClick={cerrar} type="button">
            <Icon nombre="salir" /> Cerrar sesión
          </button>
        </div>
      </Modal>
    </div>
  )
}
