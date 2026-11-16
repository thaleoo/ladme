import { Link, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'
import { esAdmin, esStaff, puedeValidarMantenimiento, useAuth } from '../context/AuthContext'
import PerfilForm from '../components/PerfilForm'
import { useLimites } from '../lib/politicas'
import { perfilCompleto } from '../lib/types'

const ROL: Record<string, { etiqueta: string; descripcion: string; clase: string }> = {
  usuario: {
    etiqueta: 'Usuario',
    descripcion: 'Puede consultar disponibilidad, reservar equipos y gestionar sus credenciales.',
    clase: 'info'
  },
  laboratorista: {
    etiqueta: 'Laboratorista',
    descripcion: 'Además valida credenciales y registra intervenciones de mantenimiento.',
    clase: 'ok'
  },
  administrador: {
    etiqueta: 'Administrador',
    descripcion: 'Gestiona roles, permisos y toda la operación del laboratorio.',
    clase: ''
  }
}

export default function Cuenta() {
  const { perfil, salir } = useAuth()
  const navigate = useNavigate()
  const lim = useLimites()

  if (!perfil) return null

  const rol = ROL[perfil.rol] ?? { etiqueta: perfil.rol, descripcion: '', clase: 'gray' }
  const iniciales =
    (perfil.nombre || perfil.correo)
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '?'

  async function cerrar() {
    await salir()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow="Cuenta institucional"
        titulo="Mi cuenta"
        sub="Sus datos de acceso, el rol que tiene en el laboratorio y las reglas de uso."
      />

      <section className="card">
        <div className="row" style={{ alignItems: 'center', gap: 'var(--s4)' }}>
          <span className="avatar lg">{iniciales}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 2 }}>{perfil.nombre || 'Sin nombre registrado'}</h2>
            <p className="small muted" style={{ margin: 0, wordBreak: 'break-all' }}>
              {perfil.correo}
            </p>
            <div className="row tight" style={{ marginTop: 'var(--s2)' }}>
              <span className={`badge ${rol.clase}`}>{rol.etiqueta}</span>
              <span className={`badge ${perfil.activo ? 'ok' : 'danger'}`}>
                {perfil.activo ? 'Habilitada' : 'Inhabilitada'}
              </span>
              {perfil.permisos?.includes('validar_mantenimiento') && (
                <span className="badge gray">
                  <Icon nombre="escudo" /> Valida mantenimiento
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 'var(--s4)', marginBottom: 0 }}>
          {rol.descripcion}
        </p>
      </section>

      <section className={`card ${perfilCompleto(perfil) ? '' : 'warn'}`} id="perfil">
        <h3>Datos académicos</h3>
        <p className="small muted">
          {perfilCompleto(perfil)
            ? 'Se usan en sus reservas y en las estadísticas de uso del laboratorio.'
            : 'Complete estos datos para poder reservar. Solo se piden una vez.'}
        </p>
        <PerfilForm />
      </section>

      <section>
        <div className="section-title">
          <h2>Accesos rápidos</h2>
        </div>
        <div className="grid cols-2">
          {esStaff(perfil) && (
            <Link to="/admin" className="card" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
              <span className="empty__icon" style={{ width: 40, height: 40, marginBottom: 0 }}>
                <Icon nombre="ajustes" />
              </span>
              <span>
                <strong style={{ display: 'block' }}>Administración</strong>
                <span className="tiny muted">Ronda, reservas, bloqueos, equipos y estadísticas.</span>
              </span>
            </Link>
          )}
          {esStaff(perfil) && (
            <Link to="/mantenimiento" className="card" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
              <span className="empty__icon" style={{ width: 40, height: 40, marginBottom: 0 }}>
                <Icon nombre="llave" />
              </span>
              <span>
                <strong style={{ display: 'block' }}>Mantenimiento</strong>
                <span className="tiny muted">
                  {puedeValidarMantenimiento(perfil)
                    ? 'Registrar, completar y validar intervenciones.'
                    : 'Registrar y completar intervenciones.'}
                </span>
              </span>
            </Link>
          )}
          {esAdmin(perfil) && (
            <Link to="/usuarios" className="card" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
              <span className="empty__icon" style={{ width: 40, height: 40, marginBottom: 0 }}>
                <Icon nombre="usuarios" />
              </span>
              <span>
                <strong style={{ display: 'block' }}>Usuarios y roles</strong>
                <span className="tiny muted">Habilitar cuentas, asignar roles y permisos.</span>
              </span>
            </Link>
          )}
          <Link to="/reservar" className="card" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
            <span className="empty__icon" style={{ width: 40, height: 40, marginBottom: 0 }}>
              <Icon nombre="reservar" />
            </span>
            <span>
              <strong style={{ display: 'block' }}>Reservar equipo</strong>
              <span className="tiny muted">Ver equipos libres y agendar una franja.</span>
            </span>
          </Link>
          <Link to="/mis-reservas" className="card" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
            <span className="empty__icon" style={{ width: 40, height: 40, marginBottom: 0 }}>
              <Icon nombre="ticket" />
            </span>
            <span>
              <strong style={{ display: 'block' }}>Mis reservas</strong>
              <span className="tiny muted">Credenciales, extensiones y cancelaciones.</span>
            </span>
          </Link>
        </div>
      </section>

      <section className="card">
        <h3>Reglas de reserva</h3>
        <ul className="small muted" style={{ paddingLeft: '1.05rem', margin: 0 }}>
          <li>
            Máximo <strong>{lim.maxHoras} h</strong> por reserva.
          </li>
          <li>
            {lim.extensionesMax === 1 ? 'Una única extensión' : `${lim.extensionesMax} extensiones`} de hasta{' '}
            <strong>{lim.maxExtension} h</strong>, sin pasar de <strong>{lim.maxTotal} h</strong> desde el inicio.
          </li>
          <li>
            ¿Necesita más tiempo? Envíe una solicitud de reserva larga (hasta {Math.round(lim.excepcionMaxHoras / 24)}{' '}
            días) desde «Reservar»; la administración la revisa.
          </li>
          <li>Registre su llegada dentro de los primeros {lim.toleranciaMin} minutos.</li>
          <li>Las cancelaciones no se borran: quedan en el historial con su motivo.</li>
        </ul>
      </section>

      <section className="card">
        <h3>Instalación</h3>
        <p className="small muted">
          Instale LADME para abrirla como aplicación y recibir avisos del laboratorio.
        </p>
        <ul className="small muted" style={{ paddingLeft: '1.05rem', margin: 0 }}>
          <li>
            <strong>Android / escritorio:</strong> menú del navegador → «Instalar aplicación» o «Añadir a
            pantalla de inicio».
          </li>
          <li>
            <strong>iPhone / iPad:</strong> Compartir → «Añadir a pantalla de inicio».
          </li>
        </ul>
      </section>

      <button className="btn danger block" onClick={cerrar} type="button">
        <Icon nombre="salir" /> Cerrar sesión en este dispositivo
      </button>
    </>
  )
}
