import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { aplicarTema, temaGuardado, type Tema } from '../lib/tema'
import { esIOS, estaInstalada, instalarAhora, puedeInstalarse } from '../components/InstalarApp'
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
  const [tema, setTema] = useState<Tema>(temaGuardado)
  const [instalable, setInstalable] = useState(puedeInstalarse)

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
      <PageHeader titulo="Mi cuenta" />

      <section className="perfil-cabeza">
        <span className="avatar perfil-cabeza__avatar" aria-hidden="true">{iniciales}</span>
        <div className="perfil-cabeza__texto">
          <h2>{perfil.nombre || 'Sin nombre registrado'}</h2>
          <p>{perfil.correo}</p>
          <p className="perfil-cabeza__rol">
            {rol.etiqueta}
            {!perfil.activo && <span className="perfil-cabeza__alerta"> · Cuenta inhabilitada</span>}
            {perfil.permisos?.includes('validar_mantenimiento') && ' · Valida mantenimiento'}
          </p>
        </div>
      </section>
      <p className="perfil-cabeza__desc">{rol.descripcion}</p>

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
        <h2 className="seccion-sola">Accesos rápidos</h2>
        <nav className="lista-enlaces" aria-label="Accesos rápidos">
          <Link to={'/mi-uso'} className="lista-enlaces__fila">
            <span className="lista-enlaces__icono"><Icon nombre="grafica" /></span>
            <span className="lista-enlaces__texto">
              <strong>Mi uso</strong>
              <span>{'Horas y equipos usados, para sus informes.'}</span>
            </span>
            <Icon nombre="flecha-der" width={18} height={18} />
          </Link>
          {esStaff(perfil) && (
            <Link to={'/admin'} className="lista-enlaces__fila">
            <span className="lista-enlaces__icono"><Icon nombre="ajustes" /></span>
            <span className="lista-enlaces__texto">
              <strong>Administración</strong>
              <span>{'Ronda, reservas, bloqueos, equipos y estadísticas.'}</span>
            </span>
            <Icon nombre="flecha-der" width={18} height={18} />
          </Link>
          )}
          {esStaff(perfil) && (
            <Link to={'/mantenimiento'} className="lista-enlaces__fila">
            <span className="lista-enlaces__icono"><Icon nombre="llave" /></span>
            <span className="lista-enlaces__texto">
              <strong>Mantenimiento</strong>
              <span>{puedeValidarMantenimiento(perfil) ? 'Registrar, completar y validar intervenciones.' : 'Registrar y completar intervenciones.'}</span>
            </span>
            <Icon nombre="flecha-der" width={18} height={18} />
          </Link>
          )}
          {esAdmin(perfil) && (
            <Link to={'/usuarios'} className="lista-enlaces__fila">
            <span className="lista-enlaces__icono"><Icon nombre="usuarios" /></span>
            <span className="lista-enlaces__texto">
              <strong>Usuarios y roles</strong>
              <span>{'Habilitar cuentas, asignar roles y permisos.'}</span>
            </span>
            <Icon nombre="flecha-der" width={18} height={18} />
          </Link>
          )}
          <Link to={'/reglamento'} className="lista-enlaces__fila">
            <span className="lista-enlaces__icono"><Icon nombre="escudo" /></span>
            <span className="lista-enlaces__texto">
              <strong>Reglas de uso</strong>
              <span>{'Lo que se espera de quien usa el laboratorio.'}</span>
            </span>
            <Icon nombre="flecha-der" width={18} height={18} />
          </Link>
          <Link to={'/mis-reservas'} className="lista-enlaces__fila">
            <span className="lista-enlaces__icono"><Icon nombre="ticket" /></span>
            <span className="lista-enlaces__texto">
              <strong>Mis reservas</strong>
              <span>{'Credenciales, extensiones y cancelaciones.'}</span>
            </span>
            <Icon nombre="flecha-der" width={18} height={18} />
          </Link>
        </nav>
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
        <h3>Apariencia</h3>
        <div className="segmented" role="group" aria-label="Tema" style={{ marginTop: 'var(--s2)' }}>
          {(
            [
              ['auto', 'Automático'],
              ['claro', 'Claro'],
              ['oscuro', 'Oscuro']
            ] as const
          ).map(([v, t]) => (
            <button
              key={v}
              type="button"
              className={tema === v ? 'activo' : ''}
              onClick={() => {
                aplicarTema(v)
                setTema(v)
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="help" style={{ marginBottom: 0 }}>«Automático» sigue la configuración de su dispositivo.</p>
      </section>

      <section className="card">
        <h3>Instalación</h3>
        {estaInstalada() ? (
          <p className="small muted" style={{ margin: 0 }}>
            <Icon nombre="check-circulo" width={14} height={14} /> Ya está usando LADME como aplicación.
          </p>
        ) : instalable ? (
          <>
            <p className="small muted">Ábrala como una app, reciba avisos y entre más rápido.</p>
            <button className="btn" type="button" onClick={async () => { await instalarAhora(); setInstalable(puedeInstalarse()) }}>
              <Icon nombre="descargar" /> Instalar LADME
            </button>
          </>
        ) : esIOS() ? (
          <p className="small muted" style={{ margin: 0 }}>
            En Safari toque <Icon nombre="compartir" width={14} height={14} /> Compartir y luego «Agregar a inicio».
          </p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Abra el menú del navegador y elija «Instalar aplicación» o «Agregar a la pantalla de inicio».
          </p>
        )}
      </section>

      <button className="btn gray block cerrar-sesion" onClick={cerrar} type="button">
        <Icon nombre="salir" /> Cerrar sesión en este dispositivo
      </button>
    </>
  )
}
