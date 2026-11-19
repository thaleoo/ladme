import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarEquipos, listarOcupacion, miEspera, salirEspera, unirseEspera, type Espera } from '../lib/api'
import { etiquetaSO, textoSO, type Equipo, type Ocupacion } from '../lib/types'
import { dia as textoDia, fecha, hace, hora, inicioDia, sumarDias } from '../lib/format'
import { esStaff, useAuth } from '../context/AuthContext'
import PageHeader, { Empty, Esqueleto } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import Pestanas from '../components/Pestanas'
import Deslizar from '../components/Deslizar'
import { guardarCache, leerCache } from '../lib/cacheLocal'


type Filtro = 'TODOS' | 'LIBRES' | 'OCUPADOS'
type Situacion = 'libre' | 'ocupado' | 'bloqueado' | 'inactivo'

interface Celda {
  equipo: Equipo
  situacion: Situacion
  actual?: Ocupacion
  proxima?: Ocupacion
  /** Texto corto bajo el código: «Libre», «hasta 3:20 p. m.»… */
  detalle: string
}

function etiquetaDia(d: Date, hoy: Date): string {
  if (d.toDateString() === hoy.toDateString()) return 'Hoy'
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short' }).format(d).replace('.', '')
}

/** «3:20 p. m.» si es hoy; «mar 3:20 p. m.» si es otro día. */
function cuando(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? hora(iso) : `${etiquetaDia(d, new Date())} ${hora(iso)}`
}

const TEXTO: Record<Situacion, string> = {
  libre: 'Libre',
  ocupado: 'Ocupado',
  bloqueado: 'Bloqueado',
  inactivo: 'No disponible'
}

/** Vista de línea de tiempo: un equipo por fila y siete días de corrido. */
function LineaTiempo({ equipos, porEquipo, dias }: { equipos: Equipo[]; porEquipo: Map<string, Ocupacion[]>; dias: Date[] }) {
  const desde = dias[0].getTime()
  const total = dias.length * 86400000
  const ahoraPct = ((Date.now() - desde) / total) * 100
  return (
    <section className="card">
      <div className="linea" role="table" aria-label="Ocupación de los próximos 7 días">
        <div className="linea__fila linea__fila--cabecera" role="row">
          <span className="linea__equipo" />
          <div className="linea__dias">
            {dias.map((d) => (
              <span key={d.toISOString()}>
                {etiquetaDia(d, dias[0])} {d.getDate()}
              </span>
            ))}
          </div>
        </div>
        {equipos.map((e) => (
          <div key={e.id} className="linea__fila" role="row">
            <Link className="linea__equipo" to={`/equipo/${e.codigo}`} title={e.nombre}>
              {e.codigo}
            </Link>
            <div className={`linea__pista${e.estado !== 'activo' ? ' linea__pista--inactiva' : ''}`}>
              {(porEquipo.get(e.codigo) ?? []).map((o, i) => {
                const ini = Math.max(new Date(o.inicio).getTime(), desde)
                const fin = Math.min(new Date(o.fin).getTime(), desde + total)
                if (fin <= ini) return null
                return (
                  <span
                    key={i}
                    className={`linea__tramo${o.tipo === 'bloqueo' ? ' linea__tramo--bloqueo' : ''}`}
                    style={{ left: `${((ini - desde) / total) * 100}%`, width: `${Math.max(0.6, ((fin - ini) / total) * 100)}%` }}
                    title={`${fecha(o.inicio)} → ${fecha(o.fin)}${o.tipo === 'bloqueo' ? ' · bloqueo' : ''}`}
                  />
                )
              })}
              {ahoraPct >= 0 && ahoraPct <= 100 && <span className="linea__ahora" style={{ left: `${ahoraPct}%` }} />}
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: 'var(--s3) 0 0' }}>
        <span className="linea__leyenda" /> Reservado <span className="linea__leyenda linea__leyenda--bloqueo" /> Bloqueo o
        mantenimiento · La línea vertical es este momento. Toque un equipo para ver su ficha.
      </p>
    </section>
  )
}

export default function Disponibilidad() {
  const { perfil } = useAuth()
  const staff = esStaff(perfil)
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [ocupacion, setOcupacion] = useState<Ocupacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('TODOS')
  const [categoria, setCategoria] = useState('TODAS')
  const [so, setSo] = useState('TODOS')
  const [programa, setPrograma] = useState('TODOS')
  const [espera, setEspera] = useState<Espera | null>(null)
  const [esperaOcupado, setEsperaOcupado] = useState(false)
  useEffect(() => { void miEspera().then(setEspera) }, [])
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [vista, setVista] = useState<'cuadricula' | 'linea'>(() =>
    localStorage.getItem('ladme-vista') === 'linea' ? 'linea' : 'cuadricula'
  )

  const [copia, setCopia] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refrescar = () =>
    new Promise<void>((listo) => {
      setTick((n) => n + 1)
      window.setTimeout(listo, 600)
    })

  useEffect(() => {
    let vivo = true
    const cargar = () =>
      Promise.all([listarEquipos(), listarOcupacion()])
        .then(([eqs, ocs]) => {
          if (!vivo) return
          setEquipos(eqs)
          setOcupacion(ocs)
          setError(null)
          setCopia(null)
          guardarCache('disponibilidad', { eqs, ocs })
        })
        .catch((e: unknown) => {
          if (!vivo) return
          // Sin conexión: se muestra lo último que se vio, marcado como copia.
          const c = leerCache<{ eqs: Equipo[]; ocs: Ocupacion[] }>('disponibilidad')
          if (c) {
            setEquipos(c.datos.eqs)
            setOcupacion(c.datos.ocs)
            setCopia(c.guardado)
          } else setError(e instanceof Error ? e.message : 'No se pudo cargar la disponibilidad.')
        })
        .finally(() => vivo && setCargando(false))
    void cargar()
    // La disponibilidad cambia mientras se mira: se refresca cada minuto.
    const t = window.setInterval(() => document.visibilityState === 'visible' && void cargar(), 60000)
    return () => {
      vivo = false
      window.clearInterval(t)
    }
  }, [tick])

  const hoy = useMemo(() => inicioDia(new Date()), [])
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i)), [hoy])

  const porEquipo = useMemo(() => {
    const mapa = new Map<string, Ocupacion[]>()
    for (const o of ocupacion) {
      const lista = mapa.get(o.codigo) ?? []
      lista.push(o)
      mapa.set(o.codigo, lista)
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.inicio.localeCompare(b.inicio))
    return mapa
  }, [ocupacion])

  const celdas = useMemo<Celda[]>(() => {
    const ahora = Date.now()
    return equipos.map((equipo) => {
      const lista = porEquipo.get(equipo.codigo) ?? []
      // Un uso compartido no ocupa el equipo: se puede usar sin cerrar los programas protegidos.
      const actual = lista.find((o) => !o.compartida && new Date(o.inicio).getTime() <= ahora && new Date(o.fin).getTime() > ahora)
      const compartido = lista.find((o) => o.compartida && new Date(o.inicio).getTime() <= ahora && new Date(o.fin).getTime() > ahora)
      const proxima = lista.find((o) => !o.compartida && new Date(o.inicio).getTime() > ahora)
      if (equipo.estado !== 'activo') {
        return { equipo, situacion: 'inactivo', detalle: equipo.estado === 'mantenimiento' ? 'Mantenimiento' : 'Fuera de servicio' }
      }
      if (actual) {
        return {
          equipo, actual, proxima,
          situacion: actual.tipo === 'bloqueo' ? 'bloqueado' : 'ocupado',
          detalle: `hasta ${cuando(actual.fin)}`
        }
      }
      if (compartido) return { equipo, proxima, situacion: 'libre', detalle: `Uso compartido hasta ${cuando(compartido.fin)}` }
      return { equipo, proxima, situacion: 'libre', detalle: proxima ? `hasta ${cuando(proxima.inicio)}` : 'Libre' }
    })
  }, [equipos, porEquipo])

  const categorias = useMemo(() => [...new Set(equipos.map((e) => e.categoria))].sort(), [equipos])
  const sistemas = useMemo(() => [...new Set(equipos.map((e) => e.sistema_operativo).filter(Boolean) as string[])].sort(), [equipos])
  // Programas que Faro detectó en los equipos (R, Python, SPSS…), para filtrar.
  const programas = useMemo(() => [...new Set(equipos.flatMap((e) => e.software ?? []))].sort((a, b) => a.localeCompare(b, 'es')), [equipos])
  const cuenta = (s: Situacion) => celdas.filter((c) => c.situacion === s).length
  const libres = cuenta('libre')
  const ocupados = celdas.length - libres

  const visibles = celdas.filter((c) => {
    if (categoria !== 'TODAS' && c.equipo.categoria !== categoria) return false
    if (so !== 'TODOS' && c.equipo.sistema_operativo !== so) return false
    if (programa !== 'TODOS' && !(c.equipo.software ?? []).includes(programa)) return false
    if (filtro === 'LIBRES' && c.situacion !== 'libre') return false
    if (filtro === 'OCUPADOS' && c.situacion === 'libre') return false
    const q = texto.trim().toLowerCase()
    return !q || [c.equipo.codigo, c.equipo.nombre, c.equipo.marca, c.equipo.modelo, c.equipo.sistema_operativo, c.equipo.so_version, ...(c.equipo.software ?? [])].some((v) => v?.toLowerCase().includes(q))
  })
  const grupos = (categoria === 'TODAS' ? categorias : [categoria])
    .map((cat) => ({ cat, lista: visibles.filter((c) => c.equipo.categoria === cat) }))
    .filter((g) => g.lista.length > 0)

  const sel = celdas.find((c) => c.equipo.codigo === abierto)
  const agendaSel = sel ? (porEquipo.get(sel.equipo.codigo) ?? []).filter((o) => new Date(o.fin).getTime() > Date.now()).slice(0, 5) : []
  const specs = sel ? Object.entries(sel.equipo.especificaciones ?? {}).slice(0, 4) : []

  return (
    <>
      <PageHeader
        eyebrow={staff ? 'Laboratorio' : 'Operación'}
        titulo="Disponibilidad"
        sub={
          staff
            ? 'Estado de todos los recursos en este momento. Para gestionar reservas, use Administración.'
            : `Hola ${perfil?.nombre?.split(' ')[0] || 'de nuevo'}: toque un equipo para ver su detalle o reservarlo.`
        }
        acciones={
          <Link className="btn" to="/reservar">
            <Icon nombre="mas2" /> Nueva reserva
          </Link>
        }
      />

      <Deslizar alActualizar={refrescar} />

      {copia && (
        <div className="alert warn">
          <Icon nombre="sin-conexion" />
          <div className="alert__body">Sin conexión: esto es lo que había {hace(copia)}. Puede haber cambiado.</div>
        </div>
      )}

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <section className="barra-filtros">
        <div className="segmented" role="group" aria-label="Filtrar por estado">
          {(
            [
              ['TODOS', `Todos ${celdas.length}`],
              ['LIBRES', `Libres ${libres}`],
              ['OCUPADOS', `No libres ${ocupados}`]
            ] as const
          ).map(([valor, etiqueta]) => (
            <button key={valor} className={filtro === valor ? 'activo' : ''} onClick={() => setFiltro(valor)} type="button">
              {etiqueta}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Tipo de vista">
          {(['cuadricula', 'linea'] as const).map((v) => (
            <button
              key={v}
              className={vista === v ? 'activo' : ''}
              type="button"
              onClick={() => {
                setVista(v)
                localStorage.setItem('ladme-vista', v)
              }}
            >
              {v === 'cuadricula' ? 'Ahora' : '7 días'}
            </button>
          ))}
        </div>
        {equipos.length > 8 && (
          <div className="field barra-filtros__buscar">
            <label className="solo-lector" htmlFor="buscar-equipo">
              Buscar equipo
            </label>
            <input
              id="buscar-equipo"
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar: UNAL-05, Ubuntu…"
            />
          </div>
        )}
      </section>

      {sistemas.length > 1 && (
        <div className="chips" role="group" aria-label="Sistema operativo">
          {['TODOS', ...sistemas].map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={so === s} onClick={() => setSo(s)}>
              {s === 'TODOS' ? 'Cualquier sistema' : s}
              <span className="chip__n">{s === 'TODOS' ? equipos.length : equipos.filter((e) => e.sistema_operativo === s).length}</span>
            </button>
          ))}
        </div>
      )}

      {programas.length > 0 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label className="field__label" htmlFor="filtro-programa">Programa instalado</label>
          <select id="filtro-programa" value={programa} onChange={(e) => setPrograma(e.target.value)}>
            <option value="TODOS">Cualquier programa</option>
            {programas.map((p) => (
              <option key={p} value={p}>{p} ({equipos.filter((e) => (e.software ?? []).includes(p)).length})</option>
            ))}
          </select>
        </div>
      )}

      {!staff && (espera ? (
        <div className="alert info">
          <Icon nombre="campana" />
          <div className="alert__body">
            Está en la lista de espera{espera.software ? ` para un equipo con ${espera.software}` : ''}. Le avisaremos en cuanto haya uno libre.{' '}
            <button className="link-btn" type="button" disabled={esperaOcupado}
                    onClick={() => { setEsperaOcupado(true); void salirEspera().then(() => setEspera(null)).finally(() => setEsperaOcupado(false)) }}>
              Salir de la lista
            </button>
          </div>
        </div>
      ) : libres === 0 || (programa !== 'TODOS' && visibles.every((c) => c.situacion !== 'libre')) ? (
        <div className="alert warn">
          <Icon nombre="reloj" />
          <div className="alert__body">
            No hay equipos libres{programa !== 'TODOS' ? ` con ${programa}` : ''} en este momento.{' '}
            <button className="link-btn" type="button" disabled={esperaOcupado}
                    onClick={() => {
                      setEsperaOcupado(true)
                      void unirseEspera(programa !== 'TODOS' ? programa : null).then(() => miEspera()).then(setEspera).finally(() => setEsperaOcupado(false))
                    }}>
              Avísenme cuando haya uno
            </button>
          </div>
        </div>
      ) : null)}

      {categorias.length > 1 && (
        <Pestanas
          etiqueta="Categorías"
          opciones={['TODAS', ...categorias].map((c) => ({ id: c, texto: c === 'TODAS' ? 'Todo' : c }))}
          actual={categoria}
          alCambiar={setCategoria}
        />
      )}

      {cargando && (
        <div className="grid cols-2">
          <Esqueleto />
          <Esqueleto />
        </div>
      )}

      {!cargando && !error && visibles.length === 0 && (
        <div className="card">
          <Empty icono="monitor" titulo="Nada con ese filtro">
            Cambie el filtro o la búsqueda para ver más recursos.
          </Empty>
        </div>
      )}

      {!cargando && visibles.length > 0 && vista === 'linea' && (
        <LineaTiempo equipos={visibles.map((c) => c.equipo)} porEquipo={porEquipo} dias={dias} />
      )}

      {!cargando && vista === 'cuadricula' &&
        grupos.map((g) => (
          <section key={g.cat}>
            {categorias.length > 1 && (
              <h2 className="grupo-titulo">
                {g.cat} <span>{g.lista.filter((c) => c.situacion === 'libre').length} libres de {g.lista.length}</span>
              </h2>
            )}
            <div className="mosaico">
              {g.lista.map((c) => (
                <button
                  key={c.equipo.id}
                  type="button"
                  className={`mosaico__celda mosaico__celda--${c.situacion}`}
                  onClick={() => setAbierto(c.equipo.codigo)}
                  aria-label={`${c.equipo.codigo}: ${TEXTO[c.situacion]} ${c.situacion === 'libre' && !c.proxima ? '' : c.detalle}`}
                >
                  <span className="mosaico__codigo">{c.equipo.codigo}</span>
                  {etiquetaSO(c.equipo) && <span className="mosaico__so">{etiquetaSO(c.equipo)}</span>}
                  <span className="mosaico__estado">
                    <span className="mosaico__punto" aria-hidden="true" />
                    {TEXTO[c.situacion]}
                  </span>
                  <span className="mosaico__detalle">
                    {c.situacion === 'libre' && !c.proxima ? 'sin reservas hoy' : c.detalle}
                    {c.actual?.desatendido ? ' · desatendido' : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}

      <Modal
        abierto={!!sel}
        titulo={sel ? sel.equipo.codigo : ''}
        descripcion={sel ? [textoSO(sel.equipo), sel.equipo.nombre, sel.equipo.marca, sel.equipo.ubicacion].filter(Boolean).join(' · ') : undefined}
        onCerrar={() => setAbierto(null)}
        pie={
          sel && (
            <>
              <Link className="btn ghost" to={`/equipo/${sel.equipo.codigo}`}>
                Ver ficha
              </Link>
              {sel.equipo.estado === 'activo' && (
                <Link className="btn" to={`/reservar?equipo=${sel.equipo.codigo}`}>
                  <Icon nombre="reservar" /> Reservar
                </Link>
              )}
            </>
          )
        }
      >
        {sel && (
          <div className="stack">
            <div className="row tight">
              <span className={`badge ${sel.situacion === 'libre' ? 'ok' : sel.situacion === 'ocupado' ? 'warn' : 'gray'}`}>
                {TEXTO[sel.situacion]}
              </span>
              <span className="small">
                {sel.situacion === 'libre'
                  ? sel.proxima
                    ? `Libre hasta ${fecha(sel.proxima.inicio)}`
                    : 'Sin reservas próximas'
                  : sel.actual
                    ? `Hasta ${fecha(sel.actual.fin)}`
                    : sel.detalle}
              </span>
            </div>
            {sel.actual?.tipo === 'bloqueo' && sel.actual.motivo && <p className="small" style={{ margin: 0 }}>{sel.actual.motivo}</p>}
            {sel.actual?.desatendido && (
              <p className="small" style={{ margin: 0 }}>
                <span className="badge warn">Proceso desatendido</span> {sel.actual.mensaje_llegada || 'No apagar ni cerrar sesión.'}
              </p>
            )}
            {specs.length > 0 && (
              <p className="tiny muted" style={{ margin: 0 }}>
                {specs.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
              </p>
            )}
            <div>
              <span className="field__label">Próximas ocupaciones</span>
              {agendaSel.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Ninguna en los próximos días.
                </p>
              ) : (
                <ul className="small" style={{ margin: 0, paddingLeft: '1.05rem' }}>
                  {agendaSel.map((o, i) => (
                    <li key={i}>
                      {textoDia(o.inicio)}, {hora(o.inicio)} → {fecha(o.fin)}
                      {o.tipo === 'bloqueo' ? ' · bloqueo' : ''}
                    </li>
                  ))}
                </ul>
              )}
              <Link className="small" to={`/equipo/${encodeURIComponent(sel.equipo.codigo)}#agenda`}>
                Ver la agenda del día y la semana
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
