import { useCallback, useEffect, useRef, useState } from 'react'
import {
  activarUsuario, actividadUsuario, asignarRol, buscarUsuarios, otorgarPermiso, resumenUsuarios,
  type FiltroUsuarios, type ResumenUsuarios
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { Perfil, Rol } from '../lib/types'
import { fecha, hace } from '../lib/format'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'

const ROLES: Array<{ valor: Rol; etiqueta: string }> = [
  { valor: 'usuario', etiqueta: 'Usuario' },
  { valor: 'laboratorista', etiqueta: 'Laboratorista' },
  { valor: 'administrador', etiqueta: 'Administrador' }
]
const ETIQUETA_ROL: Record<Rol, string> = { usuario: 'Usuario', laboratorista: 'Laboratorista', administrador: 'Administrador' }
const PERMISO_VALIDAR = 'validar_mantenimiento'
const TAMANO = 30

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
  const [resumen, setResumen] = useState<ResumenUsuarios | null>(null)
  const [lista, setLista] = useState<Perfil[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<FiltroUsuarios>('todos')
  const [cargando, setCargando] = useState(true)
  const [masCargando, setMasCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Perfil | null>(null)
  const [actividad, setActividad] = useState<Awaited<ReturnType<typeof actividadUsuario>> | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const consulta = useRef(0)

  // La búsqueda espera a que se deje de escribir (300 ms) para no consultar en cada tecla.
  useEffect(() => {
    const t = window.setTimeout(() => setBusqueda(texto), 300)
    return () => window.clearTimeout(t)
  }, [texto])

  const cargar = useCallback(
    async (pag: number) => {
      const id = ++consulta.current
      if (pag === 0) setCargando(true)
      else setMasCargando(true)
      try {
        const r = await buscarUsuarios(busqueda, filtro, pag, TAMANO)
        if (id !== consulta.current) return // llegó una búsqueda más reciente
        setLista((previa) => (pag === 0 ? r.lista : [...previa, ...r.lista]))
        setTotal(r.total)
        setPagina(pag)
        setError(null)
      } catch (e) {
        if (id === consulta.current) setError(e instanceof Error ? e.message : 'No se pudieron cargar los usuarios.')
      } finally {
        if (id === consulta.current) {
          setCargando(false)
          setMasCargando(false)
        }
      }
    },
    [busqueda, filtro]
  )

  useEffect(() => {
    void cargar(0)
  }, [cargar])

  useEffect(() => {
    resumenUsuarios().then(setResumen).catch(() => undefined)
  }, [])

  function abrir(p: Perfil) {
    setSel(p)
    setActividad(null)
    actividadUsuario(p.id).then(setActividad).catch(() => undefined)
  }

  /** Aplica un cambio y actualiza la fila en la lista sin recargar todo. */
  async function cambiar(accion: () => Promise<void>, cambio: Partial<Perfil>, mensaje: string) {
    if (!sel) return
    setOcupado(true)
    setError(null)
    try {
      await accion()
      const nuevo = { ...sel, ...cambio }
      setSel(nuevo)
      setLista((l) => l.map((x) => (x.id === nuevo.id ? nuevo : x)))
      toast.mostrar(mensaje)
      resumenUsuarios().then(setResumen).catch(() => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aplicar el cambio.')
    } finally {
      setOcupado(false)
    }
  }

  const FILTROS: Array<{ id: FiltroUsuarios; texto: string; n?: number }> = [
    { id: 'todos', texto: 'Todos', n: resumen?.total },
    { id: 'usuario', texto: 'Usuarios', n: resumen?.usuario },
    { id: 'laboratorista', texto: 'Laboratoristas', n: resumen?.laboratorista },
    { id: 'administrador', texto: 'Administradores', n: resumen?.administrador },
    { id: 'inhabilitados', texto: 'Inhabilitados', n: resumen?.inhabilitados },
    { id: 'tecnicos', texto: 'Validan mantenimiento' }
  ]

  const esYo = sel?.id === yo?.id
  const valida = !!sel?.permisos.includes(PERMISO_VALIDAR)

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        titulo="Usuarios y roles"
        sub="Las cuentas se crean solas al ingresar con un correo @unal.edu.co. Toque a una persona para cambiar su rol, su permiso técnico o inhabilitarla."
      />

      <section className="card stack">
        <div className="field" style={{ margin: 0 }}>
          <label className="solo-lector" htmlFor="buscar">
            Buscar
          </label>
          <div style={{ position: 'relative' }}>
            <Icon
              nombre="buscar"
              width={16}
              height={16}
              style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-400)', pointerEvents: 'none' }}
            />
            <input
              id="buscar"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nombre, correo o programa"
              style={{ paddingLeft: 34 }}
            />
          </div>
        </div>
        <div className="chips" role="group" aria-label="Filtrar">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.texto}
              {f.n !== undefined && <span className="chip__n">{f.n}</span>}
            </button>
          ))}
        </div>
      </section>

      {error && !sel && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {cargando && <Cargando texto="Buscando…" />}

      {!cargando && lista.length === 0 && (
        <div className="card">
          <Empty icono="usuarios" titulo="Nadie coincide">
            Cambie la búsqueda o el filtro.
          </Empty>
        </div>
      )}

      {!cargando && lista.length > 0 && (
        <section className="lista-usuarios" aria-label={`${total} cuentas`}>
          {lista.map((p) => (
            <button key={p.id} type="button" className="lista-usuarios__fila" onClick={() => abrir(p)}>
              <span className="avatar">{inicialesDe(p.nombre || p.correo)}</span>
              <span className="lista-usuarios__texto">
                <strong>
                  {p.nombre || 'Sin nombre'} {p.id === yo?.id && <span className="badge gray">usted</span>}
                </strong>
                <span>
                  {p.correo}
                  {p.programa ? ` · ${p.programa}` : ''}
                </span>
              </span>
              <span className="lista-usuarios__marcas">
                {p.rol !== 'usuario' && <span className={`badge ${p.rol === 'administrador' ? 'ok' : 'info'}`}>{ETIQUETA_ROL[p.rol]}</span>}
                {p.permisos.includes(PERMISO_VALIDAR) && <span className="badge outline">Técnico</span>}
                {!p.activo && <span className="badge danger">Inhabilitado</span>}
              </span>
            </button>
          ))}
          <div className="lista-usuarios__pie">
            <span className="tiny muted">
              {lista.length} de {total}
            </span>
            {lista.length < total && (
              <button className="btn ghost sm" type="button" disabled={masCargando} onClick={() => void cargar(pagina + 1)}>
                {masCargando ? 'Cargando…' : `Ver ${Math.min(TAMANO, total - lista.length)} más`}
              </button>
            )}
          </div>
        </section>
      )}

      <Modal
        abierto={!!sel}
        titulo={sel?.nombre || 'Sin nombre'}
        descripcion={sel ? `${sel.correo}${sel.programa ? ` · ${sel.programa}` : ''}` : undefined}
        onCerrar={() => {
          setSel(null)
          setError(null)
        }}
      >
        {sel && (
          <div className="stack">
            <div className="row tight">
              <span className={`badge ${sel.activo ? 'ok' : 'danger'}`}>
                <span className="punto" /> {sel.activo ? 'Habilitado' : 'Inhabilitado'}
              </span>
              {sel.matricula && <span className="badge outline">{sel.matricula}</span>}
              <span className="tiny muted">Cuenta creada {hace(sel.creado_en)}</span>
            </div>
            <p className="small" style={{ margin: 0 }}>
              {actividad
                ? actividad.reservas
                  ? `${actividad.reservas} ${actividad.reservas === 1 ? 'reserva' : 'reservas'}. La última, ${actividad.ultima?.equipos?.codigo ?? ''}: ${fecha(actividad.ultima!.inicio)}`
                  : 'Aún no ha hecho reservas.'
                : 'Cargando actividad…'}
            </p>

            <div className="field">
              <label className="field__label" htmlFor="usr-rol">
                Rol
              </label>
              <select
                id="usr-rol"
                value={sel.rol}
                disabled={esYo || ocupado}
                onChange={(e) => {
                  const rol = e.target.value as Rol
                  void cambiar(() => asignarRol(sel.id, rol), { rol }, `${sel.nombre || sel.correo} ahora es ${ETIQUETA_ROL[rol].toLowerCase()}.`)
                }}
              >
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.etiqueta}
                  </option>
                ))}
              </select>
              {esYo && <p className="help">No puede cambiar su propio rol.</p>}
            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={valida}
                disabled={ocupado}
                onChange={() =>
                  void cambiar(
                    () => otorgarPermiso(sel.id, PERMISO_VALIDAR, !valida),
                    { permisos: valida ? sel.permisos.filter((x) => x !== PERMISO_VALIDAR) : [...sel.permisos, PERMISO_VALIDAR] },
                    valida ? 'Permiso técnico retirado.' : 'Ahora puede validar mantenimientos.'
                  )
                }
              />
              <span>
                <strong>Puede validar mantenimientos</strong>
                Permiso técnico, independiente del rol.
              </span>
            </label>

            {error && (
              <div className="alert danger">
                <Icon nombre="alerta" />
                <div className="alert__body">{error}</div>
              </div>
            )}

            <button
              className={`btn ${sel.activo ? 'danger' : 'ok'}`}
              type="button"
              disabled={esYo || ocupado}
              onClick={() =>
                void cambiar(
                  () => activarUsuario(sel.id, !sel.activo),
                  { activo: !sel.activo },
                  sel.activo ? 'Cuenta inhabilitada.' : 'Cuenta habilitada.'
                )
              }
            >
              {sel.activo ? 'Inhabilitar cuenta' : 'Habilitar cuenta'}
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
