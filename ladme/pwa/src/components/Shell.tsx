import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { esAdmin, esStaff, useAuth } from '../context/AuthContext'
import { contarAvisosSinLeer } from '../lib/api'
import { perfilCompleto } from '../lib/types'
import Reglamento from './Reglamento'
import InstalarApp, { instalarAhora, puedeInstalarse } from './InstalarApp'
import BannerActualizacion from './BannerActualizacion'
import { propsPrecarga } from '../lib/rutas'
import AvisosPush from './AvisosPush'
import AsistenciaPendiente from './AsistenciaPendiente'
import Icon, { type NombreIcono } from './Icon'
import Logo from './Logo'
import Modal from './Modal'


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
  [/^\/llegada/, 'Confirmar asistencia'],
  [/^\/$/, 'Disponibilidad'],
  [/^\/reservar/, 'Nueva reserva'],
  [/^\/mis-reservas/, 'Mis reservas'],
  [/^\/credencial/, 'Credencial'],
  [/^\/equipo\//, 'Ficha del equipo'],
  [/^\/validar/, 'Validar credencial'],
  [/^\/mantenimiento/, 'Mantenimiento'],
  [/^\/usuarios/, 'Usuarios'],
  [/^\/admin/, 'Administración'],
  [/^\/avisos/, 'Avisos'],
  [/^\/mi-uso/, 'Mi uso'],
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
  const [instalacion, setInstalacion] = useState(puedeInstalarse)
  const [masAbierto, setMasAbierto] = useState(false)
  const [sinLeer, setSinLeer] = useState(0)

  const staff = esStaff(perfil)
  const admin = esAdmin(perfil)

  const operacion = useMemo<Enlace[]>(() => {
    const base: Enlace[] = [
      { a: '/', texto: 'Disponibilidad', icono: 'inicio', fin: true },
      { a: '/reservar', texto: 'Reservar', icono: 'reservar' },
      { a: '/mis-reservas', texto: 'Mis reservas', icono: 'ticket' },
      { a: '/mi-uso', texto: 'Mi uso', icono: 'grafica' }
    ]
    if (staff || perfil?.tipo_usuario === 'Docente/Investigador') base.push({ a: '/clases', texto: 'Sala para clases', icono: 'calendario' })
    if (staff) base.push({ a: '/validar', texto: 'Validar credencial', icono: 'qr' })
    return base
  }, [staff, perfil?.tipo_usuario])

  const gestion = useMemo<Enlace[]>(() => {
    const lista: Enlace[] = []
    if (staff) lista.push({ a: '/admin', texto: 'Administración', icono: 'ajustes' })
    if (staff) lista.push({ a: '/mantenimiento', texto: 'Mantenimiento', icono: 'llave' })
    if (admin) lista.push({ a: '/usuarios', texto: 'Usuarios', icono: 'usuarios' })
    return lista
  }, [staff, admin])

  useEffect(() => {
    const arriba = () => setEnLinea(true)
    const abajo = () => setEnLinea(false)
    const preparado = () => setInstalacion(puedeInstalarse())
    window.addEventListener('online', arriba)
    window.addEventListener('offline', abajo)
    window.addEventListener('ladme-instalable', preparado)
    window.addEventListener('appinstalled', preparado)
    return () => {
      window.removeEventListener('online', arriba)
      window.removeEventListener('offline', abajo)
      window.removeEventListener('ladme-instalable', preparado)
      window.removeEventListener('appinstalled', preparado)
    }
  }, [])

  // Contador de avisos sin leer: al entrar, cada 2 minutos y cuando se leen.
  useEffect(() => {
    let vivo = true
    const contar = () => contarAvisosSinLeer().then((n) => vivo && setSinLeer(n))
    void contar()
    const t = window.setInterval(() => document.visibilityState === 'visible' && void contar(), 120000)
    window.addEventListener('ladme-avisos', contar)
    return () => {
      vivo = false
      window.clearInterval(t)
      window.removeEventListener('ladme-avisos', contar)
    }
  }, [location.pathname])

  // Número de avisos sin leer sobre el icono de la app instalada (donde se admite).
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (sinLeer > 0) void nav.setAppBadge?.(sinLeer).catch(() => undefined)
    else void nav.clearAppBadge?.().catch(() => undefined)
  }, [sinLeer])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    setMasAbierto(false)
  }, [location.pathname])

  async function cerrar() {
    await salir()
    navigate('/login', { replace: true })
  }

  async function instalar() {
    await instalarAhora()
    setInstalacion(puedeInstalarse())
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
    <div className={`app${location.pathname.startsWith('/reservar') ? ' app--tarea' : ''}`}>
      <a className="salto-al-contenido" href="#contenido">
        Saltar al contenido
      </a>

      <aside className="sidebar">
        <Link className="sidebar__brand" to="/">
          <Logo />
          <span>
            <strong>LADME</strong>
            <span>UNAL La Paz</span>
          </span>
        </Link>

        <nav className="sidebar__nav" aria-label="Secciones">
          <div className="sidebar__group">Operación</div>
          {operacion.map((e) => (
            <NavLink key={e.a} to={e.a} end={e.fin} className="sidebar__link" {...propsPrecarga(e.a)}>
              <Icon nombre={e.icono} />
              {e.texto}
            </NavLink>
          ))}
          <NavLink to="/avisos" className="sidebar__link" {...propsPrecarga('/avisos')}>
            <Icon nombre="campana" />
            Avisos
            {sinLeer > 0 && <span className="contador">{sinLeer > 9 ? '9+' : sinLeer}</span>}
          </NavLink>
          {gestion.length > 0 && (
            <>
              <div className="sidebar__group">Gestión</div>
              {gestion.map((e) => (
                <NavLink key={e.a} to={e.a} className="sidebar__link" {...propsPrecarga(e.a)}>
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
          <Link to="/" className="icon-btn appbar__marca" aria-label="Inicio">
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
          <Link to="/avisos" className="icon-btn campana" aria-label={sinLeer ? `Avisos: ${sinLeer} sin leer` : 'Avisos'}>
            <Icon nombre="campana" width={20} height={20} />
            {sinLeer > 0 && <span className="contador">{sinLeer > 9 ? '9+' : sinLeer}</span>}
          </Link>
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
              {perfil && !perfilCompleto(perfil) && !/^\/(cuenta|reservar)/.test(location.pathname) && (
                <div className="alert info">
                  <Icon nombre="info" />
                  <div className="alert__body">
                    <strong>Complete su perfil para poder reservar.</strong> Solo son su programa y su matrícula.
                    <div className="alert__actions">
                      <Link className="btn sm" to="/cuenta#perfil">
                        Completar ahora
                      </Link>
                    </div>
                  </div>
                </div>
              )}
              <AvisosPush />
              {perfil && !perfil.reglamento_aceptado_en && <Reglamento />}
              <InstalarApp />
              <AsistenciaPendiente />
              <Suspense fallback={<div className="cargando"><span className="spinner" aria-hidden="true" /> Cargando…</div>}>
                {/* La clave reinicia la animación de entrada en cada cambio de página. */}
                <div className="pagina" key={location.pathname}>
                  <Outlet />
                </div>
              </Suspense>
            </div>
          </div>
        </main>
      </div>

      <BannerActualizacion />

      <nav className="bottomnav" aria-label="Navegación principal">
        {enlacesMoviles.map((e) => (
          <NavLink key={e.a} to={e.a} end={e.fin} className="bottomnav__link" {...propsPrecarga(e.a)}>
            <Icon nombre={e.icono} />
            <span>{e.texto}</span>
          </NavLink>
        ))}
        {staff && (
          <button
            type="button"
            className={`bottomnav__link${gestion.some((g) => location.pathname.startsWith(g.a)) ? ' activo' : ''}`}
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
