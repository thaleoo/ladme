import { useCallback, useEffect, useMemo, useState } from 'react'
import { activarUsuario, asignarRol, listarPerfiles, otorgarPermiso } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { Perfil, Rol } from '../lib/types'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'

const ROLES: Array<{ valor: Rol; etiqueta: string }> = [
  { valor: 'usuario', etiqueta: 'Usuario' },
  { valor: 'laboratorista', etiqueta: 'Laboratorista' },
  { valor: 'administrador', etiqueta: 'Administrador' }
]

const PERMISO_VALIDAR = 'validar_mantenimiento'

function inicialesDe(texto: string): string {
  return (
    texto
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '?'
  )
}

export default function Usuarios() {
  const { perfil: yo } = useAuth()
  const toast = useToast()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [filtroRol, setFiltroRol] = useState<'TODOS' | Rol>('TODOS')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setError(null)
      setPerfiles(await listarPerfiles())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los usuarios.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return perfiles.filter(
      (p) =>
        (filtroRol === 'TODOS' || p.rol === filtroRol) &&
        (!q || p.nombre.toLowerCase().includes(q) || p.correo.toLowerCase().includes(q))
    )
  }, [perfiles, busqueda, filtroRol])

  const conteos = useMemo(() => {
    const c = { usuario: 0, laboratorista: 0, administrador: 0, inactivos: 0 }
    for (const p of perfiles) {
      c[p.rol]++
      if (!p.activo) c.inactivos++
    }
    return c
  }, [perfiles])

  async function cambiarRol(p: Perfil, rol: Rol) {
    setError(null)
    setOcupado(p.id)
    try {
      await asignarRol(p.id, rol)
      toast.mostrar(`${p.nombre || p.correo} ahora tiene rol ${rol}.`)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el rol.')
    } finally {
      setOcupado(null)
    }
  }

  async function cambiarActivo(p: Perfil) {
    setError(null)
    setOcupado(p.id)
    try {
      await activarUsuario(p.id, !p.activo)
      toast.mostrar(`${p.nombre || p.correo} quedó ${p.activo ? 'inhabilitado' : 'habilitado'}.`)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el estado.')
    } finally {
      setOcupado(null)
    }
  }

  async function cambiarPermiso(p: Perfil) {
    const activo = p.permisos.includes(PERMISO_VALIDAR)
    setError(null)
    setOcupado(p.id)
    try {
      await otorgarPermiso(p.id, PERMISO_VALIDAR, !activo)
      toast.mostrar(
        activo
          ? `Se retiró «${PERMISO_VALIDAR}» a ${p.nombre || p.correo}.`
          : `${p.nombre || p.correo} ahora puede validar mantenimiento.`
      )
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el permiso.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        titulo="Usuarios y roles"
        sub="Las cuentas se crean solas al ingresar con un correo @unal.edu.co. Aquí se asignan roles, se otorga el permiso técnico y se inhabilita a quien haga falta."
      />

      <div className="stats">
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="usuario" width={14} height={14} /> Usuarios
          </div>
          <div className="stat__value">{conteos.usuario}</div>
        </div>
        <div className="stat brand">
          <div className="stat__label">
            <Icon nombre="llave" width={14} height={14} /> Laboratoristas
          </div>
          <div className="stat__value">{conteos.laboratorista}</div>
        </div>
        <div className="stat ok">
          <div className="stat__label">
            <Icon nombre="escudo" width={14} height={14} /> Administradores
          </div>
          <div className="stat__value">{conteos.administrador}</div>
        </div>
        <div className="stat danger">
          <div className="stat__label">
            <Icon nombre="prohibido" width={14} height={14} /> Inhabilitados
          </div>
          <div className="stat__value">{conteos.inactivos}</div>
        </div>
      </div>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <section className="card">
        <div className="row" style={{ gap: 'var(--s3)' }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label className="field__label" htmlFor="buscar">
              Buscar
            </label>
            <div style={{ position: 'relative' }}>
              <Icon
                nombre="buscar"
                width={16}
                height={16}
                style={{
                  position: 'absolute',
                  left: 11,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-400)',
                  pointerEvents: 'none'
                }}
              />
              <input
                id="buscar"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre o correo"
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label className="field__label" htmlFor="rol-filtro">
              Rol
            </label>
            <select id="rol-filtro" value={filtroRol} onChange={(e) => setFiltroRol(e.target.value as 'TODOS' | Rol)}>
              <option value="TODOS">Todos</option>
              {ROLES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="help" style={{ marginBottom: 0 }}>
          {filtrados.length} de {perfiles.length} cuentas.
        </p>
      </section>

      {cargando && <Cargando texto="Cargando usuarios…" />}

      {!cargando && filtrados.length === 0 && (
        <div className="card">
          <Empty icono="usuarios" titulo="No hay usuarios que coincidan">
            Cambie la búsqueda o el filtro de rol.
          </Empty>
        </div>
      )}

      {!cargando && filtrados.length > 0 && (
        <div className="grid" style={{ gap: 'var(--s2)' }}>
          {filtrados.map((p) => {
            const esYo = p.id === yo?.id
            const bloqueado = ocupado === p.id
            const valida = p.permisos.includes(PERMISO_VALIDAR)
            return (
              <div key={p.id} className="usuario-fila">
                <div className="usuario-fila__identidad">
                  <span className="avatar">{inicialesDe(p.nombre || p.correo)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="row tight">
                      <strong style={{ fontSize: 'var(--text-sm)' }}>{p.nombre || 'Sin nombre'}</strong>
                      {esYo && <span className="badge gray">usted</span>}
                    </div>
                    <div className="tiny muted" style={{ wordBreak: 'break-all' }}>
                      {p.correo}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="solo-lector" htmlFor={`rol-${p.id}`}>
                    Rol de {p.nombre}
                  </label>
                  <select
                    id={`rol-${p.id}`}
                    value={p.rol}
                    disabled={esYo || bloqueado}
                    onChange={(e) => cambiarRol(p, e.target.value as Rol)}
                    style={{ minHeight: 36, fontSize: 'var(--text-sm)' }}
                  >
                    {ROLES.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.etiqueta}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className={`badge ${p.activo ? 'ok' : 'danger'}`}>
                    <span className="punto" />
                    {p.activo ? 'Habilitado' : 'Inhabilitado'}
                  </span>
                </div>

                <label className="switch" title="Permiso para validar mantenimiento">
                  <input
                    type="checkbox"
                    checked={valida}
                    disabled={bloqueado}
                    onChange={() => cambiarPermiso(p)}
                  />
                  <span className="switch__track" />
                  <span className="tiny">Validar mantenimiento</span>
                </label>

                <button
                  className={`btn sm ${p.activo ? 'danger' : 'ok'}`}
                  disabled={esYo || bloqueado}
                  onClick={() => cambiarActivo(p)}
                  type="button"
                >
                  {p.activo ? 'Inhabilitar' : 'Habilitar'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <section className="card">
        <h3 style={{ fontSize: 'var(--text-base)' }}>Reglas</h3>
        <ul className="small muted" style={{ paddingLeft: '1.05rem', margin: 0 }}>
          <li>Nadie puede cambiar su propio rol ni inhabilitar su propia cuenta.</li>
          <li>Solo un administrador puede asignar roles, habilitar cuentas u otorgar permisos.</li>
          <li>Los usuarios se crean al ingresar por primera vez con su correo @unal.edu.co.</li>
          <li>
            El permiso <code>validar_mantenimiento</code> se otorga por separado y no cambia el rol.
          </li>
        </ul>
      </section>
    </>
  )
}
