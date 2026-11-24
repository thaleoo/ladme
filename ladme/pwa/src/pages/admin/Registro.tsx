import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listarEquipos, registro, type FilaRegistro, type FuenteRegistro } from '../../lib/api'
import { hora, inicioDia, sumarDias } from '../../lib/format'
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

/** Agrupa las filas por día: «Hoy», «Ayer» o «lunes 23 de noviembre». */
function porDia(filas: FilaRegistro[]): [string, FilaRegistro[]][] {
  const hoy = inicioDia(new Date()).getTime()
  const grupos = new Map<string, FilaRegistro[]>()
  for (const f of filas) {
    const d = inicioDia(new Date(f.en)).getTime()
    const clave = d === hoy ? 'Hoy' : d === hoy - 86400000 ? 'Ayer'
      : new Date(f.en).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' })
    const nombre = clave.charAt(0).toUpperCase() + clave.slice(1)
    grupos.set(nombre, [...(grupos.get(nombre) ?? []), f])
  }
  return [...grupos]
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
      <section className="filtros-admin" aria-label="Filtros del registro">
        <label className="disp-buscar">
          <Icon nombre="buscar" width={20} height={20} />
          <span className="solo-lector">Buscar en el registro</span>
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, código o palabra" />
        </label>
        <div className="chips-desliza" role="group" aria-label="Tipo de actividad">
          <button type="button" className="chip" aria-pressed={fuente === ''} onClick={() => setFuente('')}>
            Todo
          </button>
          {FUENTES.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={fuente === f.id} onClick={() => setFuente(f.id)}>
              {f.texto}
            </button>
          ))}
        </div>
        <div className="chips-desliza">
          <label className={`chip chip--select ${equipo ? 'activo' : ''}`}>
            <span className="solo-lector">Equipo</span>
            <select value={equipo} onChange={(e) => setEquipo(e.target.value)}>
              <option value="">Todos los equipos</option>
              {equipos.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="chip chip--select">
            <span className="solo-lector">Periodo</span>
            <select value={rango} onChange={(e) => setRango(e.target.value as Rango)}>
              {RANGOS.map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
          </label>
          <button className="chip" type="button" onClick={() => void exportar()} disabled={!total || !!exportando}>
            <Icon nombre="descargar" width={16} height={16} /> {exportando ?? 'CSV'}
          </button>
        </div>
        {rango === 'otro' && (
          <div className="filtros-admin__fechas">
            <div className="field">
              <label className="field__label" htmlFor="reg-desde">Desde</label>
              <input id="reg-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="reg-hasta">Hasta</label>
              <input id="reg-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
        )}
        <p className="filtros-admin__total num" aria-live="polite">
          {datos
            ? total === 0
              ? 'Sin resultados'
              : total <= TAMANO
                ? `${total.toLocaleString('es-CO')} ${total === 1 ? 'movimiento' : 'movimientos'}`
                : `${(pagina * TAMANO + 1).toLocaleString('es-CO')}–${Math.min(total, (pagina + 1) * TAMANO).toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`
            : ''}
          {' · nada se borra'}
        </p>
      </section>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {!datos && !error ? (
        <Cargando texto="Cargando registro…" />
      ) : datos && datos.filas.length === 0 ? (
        <Empty icono="buscar" titulo="Nada con esos filtros">
          Pruebe con otro periodo o quite algún filtro.
        </Empty>
      ) : (
        <div className={`registro-dias ${cargando ? 'cargando' : ''}`}>
          {porDia(datos?.filas ?? []).map(([dia, filas]) => (
            <section key={dia} className="registro-dia">
              <h3 className="registro-dia__titulo">{dia}</h3>
              <ol className="registro-lista2">
                {filas.map((f, i) => (
                  <li key={`${f.en}-${i}`} className="registro-mov">
                    <span className="registro-mov__hora num">{hora(f.en)}</span>
                    <span className={`registro-mov__marca tono-${TEXTO_FUENTE[f.fuente]?.tono ?? 'gray'}`} aria-hidden="true" />
                    <span className="registro-mov__cuerpo">
                      <span className="registro-mov__fuente">
                        {TEXTO_FUENTE[f.fuente]?.texto ?? f.fuente}
                        {f.equipo && (
                          <>
                            {' · '}
                            <button className="link-btn" type="button" onClick={() => setEquipo(f.equipo ?? '')} title="Ver solo este equipo">
                              {f.equipo}
                            </button>
                          </>
                        )}
                      </span>
                      <span className="registro-mov__texto">{f.texto}</span>
                      {(f.persona || f.actor) && (
                        <span className="registro-mov__quien">
                          {f.persona && <>{f.persona}</>}
                          {f.persona && f.actor && f.actor !== f.persona && ' · '}
                          {f.actor && f.actor !== f.persona && <>lo hizo {f.actor}</>}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
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
