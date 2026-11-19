import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listarEquipos, registro, type FilaRegistro, type FuenteRegistro } from '../../lib/api'
import { fecha, inicioDia, sumarDias } from '../../lib/format'
import { descargarCSV } from '../../lib/csv'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'

/**
 * Registro: todo lo que ha pasado en el laboratorio, en un solo lugar y de a páginas.
 * Nada se borra; para revisar periodos largos se filtra o se exporta a CSV.
 */

export const FUENTES: { id: FuenteRegistro; texto: string; tono: string }[] = [
  { id: 'reservas', texto: 'Reservas', tono: 'ok' },
  { id: 'faro', texto: 'Faro', tono: 'info' },
  { id: 'fallas', texto: 'Fallas', tono: 'danger' },
  { id: 'mantenimiento', texto: 'Mantenimiento', tono: 'warn' },
  { id: 'solicitudes', texto: 'Solicitudes', tono: 'gray' },
  { id: 'consola', texto: 'Consola', tono: 'outline' },
  { id: 'errores', texto: 'Errores de la app', tono: 'gray' }
]
const TEXTO_FUENTE = Object.fromEntries(FUENTES.map((f) => [f.id, f])) as Record<FuenteRegistro, (typeof FUENTES)[number]>

type Rango = 'hoy' | '7d' | '30d' | 'mes' | 'todo' | 'otro'
const RANGOS: [Rango, string][] = [
  ['hoy', 'Hoy'],
  ['7d', '7 días'],
  ['30d', '30 días'],
  ['mes', 'Este mes'],
  ['todo', 'Todo'],
  ['otro', 'Fechas…']
]
const TAMANO = 25

function limites(rango: Rango, desde: string, hasta: string): { desde: string | null; hasta: string | null } {
  const hoy = inicioDia(new Date())
  switch (rango) {
    case 'hoy':
      return { desde: hoy.toISOString(), hasta: null }
    case '7d':
      return { desde: sumarDias(hoy, -6).toISOString(), hasta: null }
    case '30d':
      return { desde: sumarDias(hoy, -29).toISOString(), hasta: null }
    case 'mes':
      return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString(), hasta: null }
    case 'todo':
      return { desde: null, hasta: null }
    case 'otro':
      return {
        desde: desde ? new Date(`${desde}T00:00`).toISOString() : null,
        hasta: hasta ? sumarDias(new Date(`${hasta}T00:00`), 1).toISOString() : null
      }
  }
}

export default function Registro() {
  const [params] = useSearchParams()
  const [fuente, setFuente] = useState<FuenteRegistro | ''>(() => {
    const f = params.get('fuente')
    return FUENTES.some((x) => x.id === f) ? (f as FuenteRegistro) : ''
  })
  const [equipo, setEquipo] = useState(params.get('equipo')?.toUpperCase() ?? '')
  const [rango, setRango] = useState<Rango>('7d')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [texto, setTexto] = useState('')
  const [buscar, setBuscar] = useState('')
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState<{ total: number; filas: FilaRegistro[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [exportando, setExportando] = useState<string | null>(null)
  const [equipos, setEquipos] = useState<string[]>([])

  useEffect(() => {
    listarEquipos(true)
      .then((l) => setEquipos(l.map((e) => e.codigo).sort()))
      .catch(() => setEquipos([]))
  }, [])

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setBuscar(texto.trim()), 400)
    return () => clearTimeout(t)
  }, [texto])

  const filtros = useMemo(() => {
    const l = limites(rango, desde, hasta)
    return { fuentes: fuente ? [fuente] : null, equipo: equipo || null, buscar: buscar || null, ...l }
  }, [fuente, equipo, rango, desde, hasta, buscar])

  // Un filtro nuevo vuelve a la primera página.
  useEffect(() => setPagina(0), [filtros])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    registro(filtros, TAMANO, pagina * TAMANO)
      .then((d) => vivo && setDatos(d))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar el registro.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [filtros, pagina])

  async function exportar() {
    if (!datos) return
    setExportando('Preparando…')
    try {
      const filas: FilaRegistro[] = []
      for (let offset = 0; offset < datos.total; offset += 5000) {
        setExportando(`Descargando ${Math.min(datos.total, offset + 5000).toLocaleString('es-CO')} de ${datos.total.toLocaleString('es-CO')}…`)
        const parte = await registro(filtros, 5000, offset)
        filas.push(...parte.filas)
        if (parte.filas.length < 5000) break
      }
      const hoy = new Date().toISOString().slice(0, 10)
      descargarCSV(
        `registro-ladme-${fuente || 'todo'}-${hoy}.csv`,
        ['Fecha', 'Fuente', 'Tipo', 'Equipo', 'Detalle', 'Persona', 'Hecho por'],
        filas.map((f) => [
          new Date(f.en).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
          TEXTO_FUENTE[f.fuente]?.texto ?? f.fuente,
          f.tipo,
          f.equipo,
          f.texto,
          f.persona,
          f.actor
        ])
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar.')
    } finally {
      setExportando(null)
    }
  }

  const total = datos?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / TAMANO))

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Todo lo que pasa en el laboratorio queda aquí y no se borra. Filtre por tipo, equipo o fechas, o exporte lo filtrado a
        CSV para abrirlo en Excel.
      </p>

      <section className="card tight registro-filtros">
        <div className="chips" role="group" aria-label="Tipo de actividad">
          <button className={`chip ${fuente === '' ? 'activo' : ''}`} aria-pressed={fuente === ''} onClick={() => setFuente('')}>
            Todo
          </button>
          {FUENTES.map((f) => (
            <button key={f.id} className={`chip ${fuente === f.id ? 'activo' : ''}`} aria-pressed={fuente === f.id} onClick={() => setFuente(f.id)}>
              {f.texto}
            </button>
          ))}
        </div>
        <div className="registro-campos">
          <div className="field">
            <label className="field__label" htmlFor="reg-buscar">
              Buscar
            </label>
            <input id="reg-buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, código, palabra…" />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="reg-equipo">
              Equipo
            </label>
            <select id="reg-equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
              <option value="">Todos</option>
              {equipos.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="reg-rango">
              Periodo
            </label>
            <select id="reg-rango" value={rango} onChange={(e) => setRango(e.target.value as Rango)}>
              {RANGOS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {rango === 'otro' && (
            <>
              <div className="field">
                <label className="field__label" htmlFor="reg-desde">
                  Desde
                </label>
                <input id="reg-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="reg-hasta">
                  Hasta
                </label>
                <input id="reg-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </section>

      <div className="registro-barra">
        <span className="small muted num" aria-live="polite">
          {datos
            ? total === 0
              ? 'Sin resultados'
              : `${(pagina * TAMANO + 1).toLocaleString('es-CO')}–${Math.min(total, (pagina + 1) * TAMANO).toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`
            : ''}
        </span>
        <button className="btn sm gray" type="button" onClick={() => void exportar()} disabled={!total || !!exportando}>
          <Icon nombre="descargar" width={15} height={15} /> {exportando ?? 'Exportar CSV'}
        </button>
      </div>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {!datos && !error ? (
        <Cargando texto="Cargando registro…" />
      ) : datos && datos.filas.length === 0 ? (
        <div className="card">
          <Empty icono="buscar" titulo="Nada con esos filtros">
            Pruebe con otro periodo o quite algún filtro.
          </Empty>
        </div>
      ) : (
        <ol className={`registro-lista ${cargando ? 'cargando' : ''}`}>
          {datos?.filas.map((f, i) => (
            <li key={`${f.en}-${i}`} className="registro-fila">
              <span className="registro-cuando num">{fecha(f.en)}</span>
              <span className="registro-que">
                <span className="row tight" style={{ flexWrap: 'wrap' }}>
                  <span className={`badge ${TEXTO_FUENTE[f.fuente]?.tono ?? 'gray'}`}>{TEXTO_FUENTE[f.fuente]?.texto ?? f.fuente}</span>
                  {f.equipo && (
                    <button className="link-btn small" type="button" onClick={() => setEquipo(f.equipo ?? '')} title="Filtrar por este equipo">
                      <strong>{f.equipo}</strong>
                    </button>
                  )}
                </span>
                <span className="registro-texto">{f.texto}</span>
                {(f.persona || f.actor) && (
                  <span className="tiny muted">
                    {f.persona && <>Persona: {f.persona}</>}
                    {f.persona && f.actor && f.actor !== f.persona && ' · '}
                    {f.actor && f.actor !== f.persona && <>Hecho por: {f.actor}</>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {total > TAMANO && (
        <nav className="paginador" aria-label="Páginas del registro">
          <button className="btn sm ghost" type="button" disabled={pagina === 0 || cargando} onClick={() => setPagina(0)}>
            « Primera
          </button>
          <button className="btn sm ghost" type="button" disabled={pagina === 0 || cargando} onClick={() => setPagina((p) => p - 1)}>
            ‹ Anterior
          </button>
          <span className="small num">
            Página {pagina + 1} de {paginas.toLocaleString('es-CO')}
          </span>
          <button className="btn sm ghost" type="button" disabled={pagina + 1 >= paginas || cargando} onClick={() => setPagina((p) => p + 1)}>
            Siguiente ›
          </button>
        </nav>
      )}
    </div>
  )
}
