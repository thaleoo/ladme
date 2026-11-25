import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { esAdmin, useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import Pestanas from '../components/Pestanas'
import { inasistenciasApeladas, listarClases, listarReportes, listarSoftware, listarSolicitudes, verificacionesPendientes } from '../lib/api'
import Errores from './admin/Errores'
import Ronda from './admin/Ronda'
import ReservasAdmin from './admin/ReservasAdmin'
import Bloqueos from './admin/Bloqueos'
import Solicitudes from './admin/Solicitudes'
import Reportes from './admin/Reportes'
import Software from './admin/Software'
import Equipos from './admin/Equipos'
import Estadisticas from './admin/Estadisticas'
import Politicas from './admin/Politicas'
import ReglamentoAdmin from './admin/Reglamento'
import Faro from './admin/Faro'
import Registro from './admin/Registro'
import Consola from './admin/Consola'

/**
 * Las secciones se agrupan en cinco grupos para no tener una fila de doce pestañas. Cada sección
 * sigue teniendo su dirección (?tab=faro), así que los enlaces de avisos y del chat no cambian.
 */
const GRUPOS = [
  { id: 'hoy', texto: 'Hoy', secciones: [{ id: 'ronda', texto: 'Ronda' }] },
  {
    id: 'reservas',
    texto: 'Reservas',
    secciones: [
      { id: 'reservas', texto: 'Reservas' },
      { id: 'solicitudes', texto: 'Solicitudes y clases' },
      { id: 'bloqueos', texto: 'Bloqueos' }
    ]
  },
  {
    id: 'equipos',
    texto: 'Equipos',
    secciones: [
      { id: 'faro', texto: 'Faro' },
      { id: 'equipos', texto: 'Inventario' },
      { id: 'reportes', texto: 'Fallas' },
      { id: 'software', texto: 'Software' }
    ]
  },
  {
    id: 'historial',
    texto: 'Historial',
    secciones: [
      { id: 'registro', texto: 'Registro' },
      { id: 'estadisticas', texto: 'Estadísticas' },
      { id: 'errores', texto: 'Errores de la app' }
    ]
  },
  {
    id: 'herramientas',
    texto: 'Herramientas',
    secciones: [
      { id: 'consola', texto: 'Consola' },
      { id: 'politicas', texto: 'Políticas', soloAdmin: true },
      { id: 'reglamento', texto: 'Reglas de uso', soloAdmin: true }
    ]
  }
] as const

type Seccion = { id: string; texto: string; soloAdmin?: boolean }

const CLAVE_ULTIMA = 'ladme:admin:ultima'

/** Pendientes que merecen un número en la navegación: solicitudes (largas y de clase) y fallas abiertas. */
function usePendientes(): Record<string, number> {
  const [n, setN] = useState<Record<string, number>>({})
  useEffect(() => {
    let vivo = true
    Promise.all([
      listarSolicitudes().then((l) => l.filter((x) => x.estado === 'pendiente').length).catch(() => 0),
      listarClases(true).then((l) => l.length).catch(() => 0),
      listarReportes().then((l) => l.filter((r) => r.estado === 'abierto' || r.estado === 'en_revision').length).catch(() => 0),
      verificacionesPendientes().then((l) => l.length).catch(() => 0),
      inasistenciasApeladas().then((l) => l.length).catch(() => 0),
      listarSoftware({ abiertas: true }).then((l) => l.filter((x) => x.estado === 'pendiente').length).catch(() => 0)
    ]).then(([sol, cla, fal, ver, ape, sw]) => vivo && setN({ solicitudes: sol + cla + ver + ape, reportes: fal, software: sw }))
    return () => {
      vivo = false
    }
  }, [])
  return n
}

/** Grupos como una fila de chips: el texto siempre visible y el número de pendientes al lado. */
function Grupos({ grupos, actual, pendientes, alCambiar }: {
  grupos: Array<{ id: string; texto: string; secciones: Seccion[] }>
  actual: string
  pendientes: Record<string, number>
  alCambiar: (id: string) => void
}) {
  const caja = useRef<HTMLDivElement>(null)
  const firma = Object.values(pendientes).join()
  // El grupo activo queda centrado en la fila (en el celular no caben todos).
  useLayoutEffect(() => {
    const centrar = () => {
      const c = caja.current
      const b = c?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      if (c && b) c.scrollTo({ left: b.offsetLeft - (c.clientWidth - b.offsetWidth) / 2, behavior: 'instant' })
    }
    centrar()
    const r = requestAnimationFrame(centrar)
    void document.fonts?.ready.then(centrar)
    return () => cancelAnimationFrame(r)
    // Los números de pendientes llegan después y ensanchan los chips: se vuelve a centrar.
  }, [actual, firma])
  return (
    <div className="admin-grupos" role="tablist" aria-label="Grupos de administración" ref={caja}>
      {grupos.map((g) => {
        const n = g.secciones.reduce((t, x) => t + (pendientes[x.id] ?? 0), 0)
        return (
          <button key={g.id} type="button" role="tab" className="chip" aria-selected={actual === g.id} onClick={() => alCambiar(g.id)}>
            {g.texto}
            {n > 0 && <span className="admin-grupos__n" aria-label={`${n} pendientes`}>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default function Admin() {
  const { perfil } = useAuth()
  const admin = esAdmin(perfil)
  const [params, setParams] = useSearchParams()
  const pendientes = usePendientes()
  const grupos = GRUPOS.map((g) => ({ ...g, secciones: (g.secciones as readonly Seccion[]).filter((x) => !x.soloAdmin || admin) }))
  const todas = grupos.flatMap((g) => g.secciones)
  const actual = todas.find((x) => x.id === params.get('tab'))?.id ?? 'ronda'
  const grupo = grupos.find((g) => g.secciones.some((x) => x.id === actual)) ?? grupos[0]
  const nav = useRef<HTMLDivElement>(null)
  // Dirección de la transición: hacia la derecha si la sección nueva está después de la anterior.
  const previa = useRef(actual)
  const orden = (id: string) => todas.findIndex((x) => x.id === id)
  const direccion = orden(actual) >= orden(previa.current) ? 'adelante' : 'atras'
  useEffect(() => {
    previa.current = actual
    try {
      const ultimas = JSON.parse(sessionStorage.getItem(CLAVE_ULTIMA) ?? '{}')
      sessionStorage.setItem(CLAVE_ULTIMA, JSON.stringify({ ...ultimas, [grupo.id]: actual }))
    } catch {
      /* sin almacenamiento: se vuelve a la primera sección */
    }
  }, [actual, grupo.id])

  function ir(id: string) {
    if (id === actual) return
    setParams({ tab: id }, { replace: true })
    // Si la navegación quedó pegada arriba, la sección nueva empieza justo debajo de ella.
    const n = nav.current
    if (n && n.getBoundingClientRect().top <= parseFloat(getComputedStyle(n).top || '0') + 1) {
      const destino = window.scrollY + n.getBoundingClientRect().top - parseFloat(getComputedStyle(n).top || '0')
      window.scrollTo({ top: destino, behavior: 'smooth' })
    }
  }

  function irGrupo(id: string) {
    const g = grupos.find((x) => x.id === id)
    if (!g) return
    let ultima: string | undefined
    try {
      ultima = JSON.parse(sessionStorage.getItem(CLAVE_ULTIMA) ?? '{}')[id]
    } catch {
      ultima = undefined
    }
    ir(g.secciones.some((x) => x.id === ultima) ? (ultima as string) : g.secciones[0].id)
  }

  return (
    <>
      <PageHeader titulo="Administración" />

      <div className="admin-nav" ref={nav}>
        <Grupos grupos={grupos} actual={grupo.id} pendientes={pendientes} alCambiar={irGrupo} />
        <div className={`admin-subs ${grupo.secciones.length > 1 ? 'abierto' : ''}`} aria-hidden={grupo.secciones.length <= 1}>
          <div className="admin-subs__dentro">
            {grupo.secciones.length > 1 && (
              <Pestanas
                etiqueta={`Secciones de ${grupo.texto}`}
                opciones={grupo.secciones.map((x) => ({ id: x.id, texto: x.texto, n: pendientes[x.id] }))}
                actual={actual}
                alCambiar={ir}
              />
            )}
          </div>
        </div>
      </div>

      <div className="panel-pestana" key={actual} data-dir={direccion}>
      {actual === 'ronda' && <Ronda />}
      {actual === 'reservas' && <ReservasAdmin />}
      {actual === 'bloqueos' && <Bloqueos />}
      {actual === 'reportes' && <Reportes />}
      {actual === 'software' && <Software />}
      {actual === 'solicitudes' && <Solicitudes />}
      {actual === 'equipos' && <Equipos />}
      {actual === 'faro' && <Faro />}
      {actual === 'registro' && <Registro />}
      {actual === 'consola' && <Consola />}
      {actual === 'estadisticas' && <Estadisticas />}
      {actual === 'politicas' && admin && <Politicas />}
      {actual === 'reglamento' && admin && <ReglamentoAdmin />}
      {actual === 'errores' && <Errores />}
      </div>
    </>
  )
}
