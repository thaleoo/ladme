import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarEquipos, listarOcupacion, miEspera, salirEspera, unirseEspera, type Espera } from '../lib/api'
import { etiquetaSO, fotoEquipo, textoSO, type Equipo, type Ocupacion } from '../lib/types'
import { diaCorto, fecha, hace, hora, inicioDia, sumarDias } from '../lib/format'
import { esStaff, useAuth } from '../context/AuthContext'
import PageHeader, { Empty, Esqueleto } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { PedirSoftware } from '../components/Software'
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

function diaCapital(iso: string): string {
  const t = diaCorto(iso)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Texto de estado de una fila: dice qué pasa y hasta cuándo, en una frase. */
function textoEstado(c: Celda): string {
  if (c.situacion === 'inactivo') return c.detalle
  if (c.situacion === 'libre') return c.proxima ? `Libre hasta ${cuando(c.proxima.inicio)}` : c.detalle.startsWith('Uso compartido') ? c.detalle : 'Libre, sin reservas próximas'
  return `${TEXTO[c.situacion]} ${c.detalle}`
}

const COLORES_PROGRAMA = ['#E5B53A', '#5B9BFF', '#FF7A59', '#F39A3B', '#3FBF84', '#F06FA9', '#36BDBD', '#A98BFF']
/** Color estable por programa, para reconocerlo de un vistazo en los filtros. */
function colorPrograma(nombre: string): string {
  let h = 0
  for (const ch of nombre.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORES_PROGRAMA[h % COLORES_PROGRAMA.length]
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
  // Las categorías se muestran como grupos de la lista, sin pestañas.
  const categoria: string = 'TODAS'
  const [so, setSo] = useState('TODOS')
  // Programas elegidos: se muestran solo los equipos que los tienen todos.
  const [elegidos, setElegidos] = useState<string[]>([])
  const alternar = (x: string) => setElegidos((l) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]))
  const [espera, setEspera] = useState<Espera | null>(null)
  const [esperaOcupado, setEsperaOcupado] = useState(false)
  useEffect(() => { void miEspera().then(setEspera) }, [])
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [vista, setVista] = useState<'cuadricula' | 'linea'>(() =>
    localStorage.getItem('ladme-vista') === 'linea' ? 'linea' : 'cuadricula'
  )

  const [copia, setCopia] = useState<string | null>(null)
  const tick = 0

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
  const [pedirSoftware, setPedirSoftware] = useState(false)
  const [masProgramas, setMasProgramas] = useState(false)
  const programas = useMemo(() => [...new Set(equipos.flatMap((e) => e.software ?? []))].sort((a, b) => a.localeCompare(b, 'es')), [equipos])
  const cuenta = (s: Situacion) => celdas.filter((c) => c.situacion === s).length
  const libres = cuenta('libre')

  const visibles = celdas.filter((c) => {
    if (categoria !== 'TODAS' && c.equipo.categoria !== categoria) return false
    if (so !== 'TODOS' && c.equipo.sistema_operativo !== so) return false
    if (elegidos.length && !elegidos.every((x) => (c.equipo.software ?? []).includes(x))) return false
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

  const fotoDe = (e: Equipo) => fotoEquipo((e as Equipo & { foto_url?: string | null }).foto_url)
  const libresVisibles = visibles.filter((c) => c.situacion === 'libre')
  // Programas más comunes primero; el resto queda en «Más programas».
  const programasOrdenados = [...programas].sort(
    (x, y) => equipos.filter((e) => (e.software ?? []).includes(y)).length - equipos.filter((e) => (e.software ?? []).includes(x)).length || x.localeCompare(y, 'es')
  )
  // En la fila caben todos si son pocos; si no, los más comunes y los elegidos, y el resto en «Todos».
  const MAX_FILA = 10
  const programasChips = programasOrdenados.length <= MAX_FILA + 2 ? programasOrdenados
    : [...programasOrdenados.slice(0, MAX_FILA), ...elegidos.filter((x) => !programasOrdenados.slice(0, MAX_FILA).includes(x))]
  const conTodos = equipos.filter((e) => elegidos.every((x) => (e.software ?? []).includes(x))).length
  const listaElegidos = elegidos.length > 1 ? `${elegidos.slice(0, -1).join(', ')} y ${elegidos[elegidos.length - 1]}` : (elegidos[0] ?? '')

  return (
    <>
      <PageHeader titulo="Disponibilidad" />

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

      {equipos.length > 8 && (
        <label className="disp-buscar">
          <Icon nombre="buscar" width={20} height={20} />
          <span className="solo-lector">Buscar equipo o programa</span>
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Equipo o programa" />
        </label>
      )}

      <div className="chips-desliza" role="group" aria-label="Filtros">
        <button type="button" className="chip" aria-pressed={filtro === 'LIBRES'} onClick={() => setFiltro(filtro === 'LIBRES' ? 'TODOS' : 'LIBRES')}>
          <span className="punto-estado libre" aria-hidden="true" /> Libres <span className="chip__n">{libres}</span>
        </button>
        {sistemas.length > 1 &&
          sistemas.map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={so === x} onClick={() => setSo(so === x ? 'TODOS' : x)}>
              {x}
            </button>
          ))}
      </div>

      {(programas.length > 0 || !staff) && (
        <div className="disp-programas">
          <div className="disp-programas__cabeza">
            <span className="disp-programas__t" id="disp-programas-t">Programas</span>
            {elegidos.length > 0 ? (
              <span className="disp-programas__res" aria-live="polite">
                {conTodos === 0 ? 'Ningún equipo los tiene todos' : `${conTodos} ${conTodos === 1 ? 'equipo tiene' : 'equipos tienen'} ${elegidos.length === 1 ? listaElegidos : 'todos'}`}
                {' · '}
                <button type="button" className="link-btn" onClick={() => setElegidos([])}>Quitar</button>
              </span>
            ) : (
              <span className="disp-programas__res">Elija los que necesita</span>
            )}
          </div>
          <div className="chips-desliza" role="group" aria-labelledby="disp-programas-t">
            {programasChips.map((x) => (
              <button key={x} type="button" className="chip" aria-pressed={elegidos.includes(x)} onClick={() => alternar(x)}>
                <span className="chip__marca" style={{ borderColor: colorPrograma(x) }} aria-hidden="true" />
                {x}
              </button>
            ))}
            {programas.length > programasChips.length && (
              <button type="button" className="chip" onClick={() => setMasProgramas(true)}>
                Todos ({programas.length})
              </button>
            )}
            {!staff && (
              <button type="button" className="chip chip--suave" onClick={() => setPedirSoftware(true)}>
                <Icon nombre="mas2" width={16} height={16} /> Pedir un programa
              </button>
            )}
          </div>
        </div>
      )}
      <PedirSoftware abierto={pedirSoftware} cerrar={() => setPedirSoftware(false)} equipos={equipos} />

      {!staff && (espera ? (
        <div className="alert info">
          <Icon nombre="campana" />
          <div className="alert__body">
            Está en la lista de espera{espera.software ? ` para un equipo con ${espera.software}` : ''}. Le avisaremos cuando se libere uno.{' '}
            <button className="link-btn" type="button" disabled={esperaOcupado}
                    onClick={() => { setEsperaOcupado(true); void salirEspera().then(() => setEspera(null)).finally(() => setEsperaOcupado(false)) }}>
              Salir de la lista
            </button>
          </div>
        </div>
      ) : !cargando && (libres === 0 || (elegidos.length > 0 && visibles.every((c) => c.situacion !== 'libre'))) ? (
        <div className="alert warn">
          <Icon nombre="reloj" />
          <div className="alert__body">
            No hay equipos libres{elegidos.length ? ` con ${listaElegidos}` : ''} en este momento.{' '}
            <button className="link-btn" type="button" disabled={esperaOcupado}
                    onClick={() => {
                      setEsperaOcupado(true)
                      void unirseEspera(elegidos.length === 1 ? elegidos[0] : null).then(() => miEspera()).then(setEspera).finally(() => setEsperaOcupado(false))
                    }}>
              Avísenme cuando haya uno
            </button>
          </div>
        </div>
      ) : null)}

      {cargando && (
        <div className="grid cols-2">
          <Esqueleto />
          <Esqueleto />
        </div>
      )}

      {!cargando && vista === 'cuadricula' && libresVisibles.length > 0 && (
        <section>
          <div className="seccion-cabecera">
            <h2>Libres ahora</h2>
            {libresVisibles.length > 2 && filtro !== 'LIBRES' && (
              <button type="button" className="link-btn seccion-cabecera__mas" onClick={() => setFiltro('LIBRES')}>
                Ver los {libresVisibles.length} <Icon nombre="flecha-der" width={16} height={16} />
              </button>
            )}
          </div>
          <div className="libres-carrusel">
            {libresVisibles.map((c) => (
              <button key={c.equipo.id} type="button" className="libre-card" onClick={() => setAbierto(c.equipo.codigo)}
                      aria-label={`${c.equipo.codigo}, libre ${c.proxima ? `hasta ${cuando(c.proxima.inicio)}` : 'sin reservas próximas'}`}>
                <img className="libre-card__foto" src={fotoDe(c.equipo)} alt="" loading="lazy" />
                <span className="libre-card__hasta">{c.proxima ? `Hasta ${cuando(c.proxima.inicio)}` : 'Todo el día'}</span>
                <span className="libre-card__codigo">{c.equipo.codigo}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!cargando && (
        <div className="seccion-cabecera">
          <h2>{vista === 'linea' ? 'Próximos 7 días' : 'Toda la sala'}</h2>
          <div className="segmented segmented--sm" role="group" aria-label="Tipo de vista">
            {(['cuadricula', 'linea'] as const).map((v) => (
              <button key={v} className={vista === v ? 'activo' : ''} type="button" aria-pressed={vista === v}
                      onClick={() => { setVista(v); localStorage.setItem('ladme-vista', v) }}>
                {v === 'cuadricula' ? 'Ahora' : 'Semana'}
              </button>
            ))}
          </div>
        </div>
      )}

      {!cargando && !error && visibles.length === 0 && (
        <div className="card">
          <Empty icono="monitor" titulo="Ningún equipo con esos filtros">
            Quite un filtro o cambie la búsqueda.
          </Empty>
        </div>
      )}

      {!cargando && visibles.length > 0 && vista === 'linea' && (
        <LineaTiempo equipos={visibles.map((c) => c.equipo)} porEquipo={porEquipo} dias={dias} />
      )}

      {!cargando && vista === 'cuadricula' &&
        grupos.map((g) => (
          <section key={g.cat} className="disp-grupo">
            {grupos.length > 1 && (
              <h3 className="disp-grupo__titulo">
                {g.cat} <span>{g.lista.filter((c) => c.situacion === 'libre').length} de {g.lista.length} libres</span>
              </h3>
            )}
            <div className="sala-lista">
              {g.lista.map((c) => (
                <button key={c.equipo.id} type="button" className="sala-fila" onClick={() => setAbierto(c.equipo.codigo)}>
                  <img className="sala-fila__foto" src={fotoDe(c.equipo)} alt="" loading="lazy" />
                  <span className="sala-fila__texto">
                    <span className="sala-fila__titulo">
                      {c.equipo.codigo}
                      {etiquetaSO(c.equipo) && <span className="sala-fila__so">{etiquetaSO(c.equipo)}</span>}
                    </span>
                    <span className="sala-fila__estado">
                      <span className={`punto-estado ${c.situacion}`} aria-hidden="true" />
                      {textoEstado(c)}
                      {c.actual?.desatendido ? ', proceso desatendido' : ''}
                    </span>
                  </span>
                  <Icon nombre="flecha-der" width={18} height={18} className="sala-fila__flecha" />
                </button>
              ))}
            </div>
          </section>
        ))}

      <Modal
        abierto={masProgramas}
        titulo="Programas instalados"
        descripcion="Elija todos los que necesita: se muestran los equipos que los tienen todos."
        onCerrar={() => setMasProgramas(false)}
        pie={<button type="button" onClick={() => setMasProgramas(false)}>{elegidos.length ? `Ver ${conTodos} ${conTodos === 1 ? 'equipo' : 'equipos'}` : 'Listo'}</button>}
      >
        <div className="lista-programas">
          {programasOrdenados.map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={elegidos.includes(x)} onClick={() => alternar(x)}>
              <span className="chip__marca" style={{ borderColor: colorPrograma(x) }} aria-hidden="true" />
              {x}
              <span className="chip__n">{equipos.filter((e) => (e.software ?? []).includes(x)).length}</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        abierto={!!sel}
        titulo={sel ? sel.equipo.codigo : ''}
        descripcion={sel ? [[sel.equipo.marca, sel.equipo.modelo].filter(Boolean).join(' ') || sel.equipo.nombre, textoSO(sel.equipo), sel.equipo.ubicacion].filter(Boolean).join(', ') : undefined}
        onCerrar={() => setAbierto(null)}
        pie={
          sel && (
            <>
              <Link className="btn ghost" to={`/equipo/${sel.equipo.codigo}`}>
                Ver ficha
              </Link>
              {sel.equipo.estado === 'activo' && (
                <Link className="btn" to={`/reservar?equipo=${sel.equipo.codigo}`}>
                  Reservar
                </Link>
              )}
            </>
          )
        }
      >
        {sel && (
          <div className="equipo-hoja">
            <img className="equipo-hoja__foto" src={fotoDe(sel.equipo)} alt={`Foto de ${sel.equipo.codigo}`} />

            <div className="equipo-hoja__estado">
              <span className={`punto-estado ${sel.situacion}`} aria-hidden="true" />
              <span>
                <strong>
                  {sel.situacion === 'libre'
                    ? sel.proxima
                      ? `Libre hasta ${cuando(sel.proxima.inicio)}`
                      : 'Libre, sin reservas próximas'
                    : sel.situacion === 'inactivo'
                      ? sel.detalle
                      : `${TEXTO[sel.situacion]} hasta ${sel.actual ? cuando(sel.actual.fin) : ''}`}
                </strong>
                {sel.actual?.tipo === 'bloqueo' && sel.actual.motivo && <span className="muted">{sel.actual.motivo}</span>}
              </span>
            </div>

            {sel.actual?.desatendido && (
              <div className="equipo-hoja__nota">
                <Icon nombre="info" width={18} height={18} />
                <span>
                  <strong>Hay un proceso corriendo.</strong> {sel.actual.mensaje_llegada || 'No apague el equipo ni cierre la sesión.'}
                </span>
              </div>
            )}

            {(sel.equipo.software ?? []).length > 0 && (
              <div className="equipo-hoja__bloque">
                <h3>Programas</h3>
                <div className="equipo-hoja__programas">
                  {(sel.equipo.software ?? []).slice(0, 10).map((x) => (
                    <span key={x} className="programa">
                      <span className="chip__marca" style={{ borderColor: colorPrograma(x) }} aria-hidden="true" />
                      {x}
                    </span>
                  ))}
                  {(sel.equipo.software ?? []).length > 10 && <span className="programa programa--mas">y {(sel.equipo.software ?? []).length - 10} más</span>}
                </div>
              </div>
            )}

            <div className="equipo-hoja__bloque">
              <h3>Próximas ocupaciones</h3>
              {agendaSel.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Ninguna en los próximos días.
                </p>
              ) : (
                <ul className="agenda-corta">
                  {agendaSel.map((o, i) => (
                    <li key={i}>
                      <span className="agenda-corta__dia">{diaCapital(o.inicio)}</span>
                      <span className="agenda-corta__horas">
                        {hora(o.inicio)} a {new Date(o.fin).toDateString() === new Date(o.inicio).toDateString() ? hora(o.fin) : `${diaCorto(o.fin)}, ${hora(o.fin)}`}
                        {o.tipo === 'bloqueo' && <span className="muted">, bloqueo</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link className="small" to={`/equipo/${encodeURIComponent(sel.equipo.codigo)}#agenda`}>
                Ver la agenda completa
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
