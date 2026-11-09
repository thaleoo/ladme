import { useCallback, useEffect, useMemo, useState } from 'react'
import { activarUsuario, asignarRol, listarPerfiles, otorgarPermiso } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { Perfil, Rol } from '../lib/types'

const ROLES: Array<{ valor: Rol; etiqueta: string }> = [
  { valor: 'usuario', etiqueta: 'Usuario' },
  { valor: 'laboratorista', etiqueta: 'Laboratorista' },
  { valor: 'administrador', etiqueta: 'Administrador' }
]

const PERMISO_VALIDAR = 'validar_mantenimiento'

export default function Usuarios() {
  const { perfil: yo } = useAuth()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [filtroRol, setFiltroRol] = useState<'TODOS' | Rol>('TODOS')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
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
    setAviso(null)
    setOcupado(p.id)
    try {
      await asignarRol(p.id, rol)
      setAviso(`${p.nombre} ahora tiene rol ${rol}.`)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el rol.')
    } finally {
      setOcupado(null)
    }
  }

  async function cambiarActivo(p: Perfil) {
    setError(null)
    setAviso(null)
    setOcupado(p.id)
    try {
      await activarUsuario(p.id, !p.activo)
      setAviso(`${p.nombre} quedó ${p.activo ? 'inhabilitado' : 'habilitado'}.`)
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
    setAviso(null)
    setOcupado(p.id)
    try {
      await otorgarPermiso(p.id, PERMISO_VALIDAR, !activo)
      setAviso(
        activo
          ? `Se retiró «${PERMISO_VALIDAR}» a ${p.nombre}.`
          : `${p.nombre} ahora puede validar mantenimiento.`
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
      <div className="card accent">
        <h2>Usuarios y roles</h2>
        <p className="muted small mb-0">
          Roles: usuario, laboratorista y administrador. El permiso fino <code>validar_mantenimiento</code>
          {' '}se otorga por separado, sin cambiar el rol.
        </p>
      </div>

      {aviso && <div className="alert ok">{aviso}</div>}
      {error && <div className="alert danger">{error}</div>}

      <div className="card">
        <div className="row">
          <span className="badge">{conteos.usuario} usuarios</span>
          <span className="badge warn">{conteos.laboratorista} laboratoristas</span>
          <span className="badge ok">{conteos.administrador} administradores</span>
          {conteos.inactivos > 0 && <span className="badge danger">{conteos.inactivos} inactivos</span>}
        </div>
        <div className="row mt">
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="buscar">Buscar</label>
            <input id="buscar" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o correo" />
          </div>
          <div>
            <label htmlFor="rol-filtro">Rol</label>
            <select id="rol-filtro" value={filtroRol} onChange={(e) => setFiltroRol(e.target.value as 'TODOS' | Rol)}>
              <option value="TODOS">Todos</option>
              {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
            </select>
          </div>
        </div>
      </div>

      {cargando && <div className="card center muted">Cargando usuarios…</div>}

      {!cargando && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Validar mantenimiento</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const esYo = p.id === yo?.id
                  const bloqueado = ocupado === p.id
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.nombre}
                        {esYo && <span className="badge gray" style={{ marginLeft: 6 }}>usted</span>}
                      </td>
                      <td className="tiny">{p.correo}</td>
                      <td>
                        <select
                          value={p.rol}
                          disabled={esYo || bloqueado}
                          onChange={(e) => cambiarRol(p, e.target.value as Rol)}
                          style={{ width: 'auto' }}
                        >
                          {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
                        </select>
                      </td>
                      <td>
                        <span className={`badge ${p.activo ? 'ok' : 'danger'}`}>{p.activo ? 'Habilitado' : 'Inhabilitado'}</span>
                      </td>
                      <td>
                        <label className="row" style={{ fontWeight: 500 }}>
                          <input
                            type="checkbox"
                            checked={p.permisos.includes(PERMISO_VALIDAR)}
                            disabled={bloqueado}
                            onChange={() => cambiarPermiso(p)}
                            style={{ width: 'auto' }}
                          />
                          <span className="tiny">validar_mantenimiento</span>
                        </label>
                      </td>
                      <td>
                        <button
                          className={`btn sm ${p.activo ? 'danger' : 'ok'}`}
                          disabled={esYo || bloqueado}
                          onClick={() => cambiarActivo(p)}
                        >
                          {p.activo ? 'Inhabilitar' : 'Habilitar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filtrados.length === 0 && <p className="muted mt">No hay usuarios que coincidan.</p>}
        </div>
      )}

      <div className="card">
        <h4>Reglas</h4>
        <ul className="small muted" style={{ paddingLeft: '1.1rem' }}>
          <li>Nadie puede cambiar su propio rol ni inhabilitar su propia cuenta.</li>
          <li>Solo un administrador puede asignar roles, habilitar cuentas u otorgar permisos.</li>
          <li>Los usuarios se crean al ingresar por primera vez con su correo @unal.edu.co.</li>
          <li>La aprobación inicial de la cuenta la hace la administración del laboratorio.</li>
        </ul>
      </div>
    </>
  )
}
