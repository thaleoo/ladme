import { useEffect, useMemo, useState } from 'react'
import { listarErroresApp, type ErrorApp } from '../../lib/api'
import { fecha, hace } from '../../lib/format'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'

const TIPOS: Record<string, string> = {
  error: 'Error',
  promesa: 'Error',
  render: 'Pantalla',
  chunk: 'Versión vieja',
  carga_lenta: 'Carga lenta'
}

/** Resume el navegador y el sistema a partir del agente de usuario. */
function dispositivo(agente: string | null): string {
  if (!agente) return 'Desconocido'
  const so = /iPhone|iPad/.test(agente) ? 'iOS' : /Android/.test(agente) ? 'Android' : /Windows/.test(agente) ? 'Windows' : /Mac OS/.test(agente) ? 'macOS' : /Linux/.test(agente) ? 'Linux' : 'Otro'
  const nav = /EdgA?\//.test(agente) ? 'Edge' : /SamsungBrowser/.test(agente) ? 'Samsung' : /CriOS|Chrome\//.test(agente) ? 'Chrome' : /Firefox|FxiOS/.test(agente) ? 'Firefox' : /Safari/.test(agente) ? 'Safari' : 'Otro'
  return `${nav} · ${so}`
}

/** Fallos ocurridos en los teléfonos y computadores de los usuarios, agrupados por mensaje. */
export default function Errores() {
  const [lista, setLista] = useState<ErrorApp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    listarErroresApp()
      .then(setLista)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los errores.'))
  }, [])

  const grupos = useMemo(() => {
    const mapa = new Map<string, ErrorApp[]>()
    for (const e of lista ?? []) {
      const k = `${e.tipo}|${e.mensaje}`
      mapa.set(k, [...(mapa.get(k) ?? []), e])
    }
    return [...mapa.entries()].map(([clave, items]) => ({ clave, items })).sort((a, b) => b.items[0].creado_en.localeCompare(a.items[0].creado_en))
  }, [lista])

  if (error)
    return (
      <div className="alert danger">
        <Icon nombre="alerta" />
        <div className="alert__body">{error}</div>
      </div>
    )
  if (!lista) return <Cargando texto="Cargando errores…" />

  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        Fallos registrados automáticamente en los dispositivos de los usuarios (últimos 90 días). «Carga lenta» es la
        pantalla que se queda cargando; «Versión vieja», alguien con la app desactualizada tras una publicación.
      </p>
      {grupos.length === 0 && (
        <div className="card">
          <Empty icono="check-circulo" titulo="Sin errores registrados">
            Cuando algo falle en el dispositivo de alguien aparecerá aquí.
          </Empty>
        </div>
      )}
      <div className="grid" style={{ gap: 'var(--s2)' }}>
        {grupos.map(({ clave, items }) => {
          const e = items[0]
          const personas = new Set(items.map((x) => x.perfiles?.correo ?? x.agente)).size
          return (
            <article key={clave} className="card tight">
              <button className="error-app__cabecera" type="button" onClick={() => setAbierto(abierto === clave ? null : clave)}>
                <span className="row tight">
                  <span className={`badge ${e.tipo === 'carga_lenta' || e.tipo === 'chunk' ? 'warn' : 'danger'}`}>{TIPOS[e.tipo] ?? e.tipo}</span>
                  <span className="badge outline num">
                    {items.length} {items.length === 1 ? 'vez' : 'veces'} · {personas} {personas === 1 ? 'persona' : 'personas'}
                  </span>
                </span>
                <strong className="small">{e.mensaje}</strong>
                <span className="tiny muted">
                  Última {hace(e.creado_en)} · {e.ruta} · {dispositivo(e.agente)} · versión {e.version}
                </span>
              </button>
              {abierto === clave && (
                <div className="stack mt">
                  <ul className="tiny" style={{ margin: 0, paddingLeft: '1rem' }}>
                    {items.slice(0, 10).map((x) => (
                      <li key={x.id}>
                        {fecha(x.creado_en)} · {x.perfiles?.correo ?? 'sin sesión'} · {dispositivo(x.agente)} · {x.ruta}
                      </li>
                    ))}
                  </ul>
                  {e.pila && <pre className="error-app__pila">{e.pila}</pre>}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}
