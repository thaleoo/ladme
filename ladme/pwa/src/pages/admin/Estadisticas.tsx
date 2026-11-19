import { useEffect, useState } from 'react'
import { estadisticas, estadisticasSoporte, programasUsados } from '../../lib/api'
import type { Conteo, Estadisticas as Datos, EstadisticasSoporte } from '../../lib/types'
import { descargarCSV } from '../../lib/csv'
import { Cargando } from '../../components/PageHeader'
import Icon from '../../components/Icon'

const RANGOS = [
  { dias: 30, texto: '30 días' },
  { dias: 120, texto: 'Semestre' },
  { dias: 365, texto: 'Un año' }
]
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Barras horizontales de una sola serie: un solo color; la etiqueta y el valor van en texto. */
function Barras({ titulo, datos, valor = 'n', unidad = '' }: { titulo: string; datos: Conteo[]; valor?: 'n' | 'horas'; unidad?: string }) {
  const max = Math.max(1, ...datos.map((d) => Number(d[valor] ?? 0)))
  return (
    <section className="card">
      <h3 style={{ fontSize: 'var(--text-base)' }}>{titulo}</h3>
      {datos.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Sin datos en el período.
        </p>
      ) : (
        <div className="barras">
          {datos.map((d) => {
            const v = Number(d[valor] ?? 0)
            return (
              <div key={String(d.clave)} className="barras__fila" title={`${d.clave}: ${v}${unidad}`}>
                <span className="barras__etiqueta">{d.clave}</span>
                <span className="barras__pista">
                  <span className="barras__barra" style={{ width: `${(v / max) * 100}%` }} />
                </span>
                <span className="barras__valor num">
                  {v}
                  {unidad}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Columnas por hora del día (0–23). */
function Columnas({ titulo, datos, etiqueta }: { titulo: string; datos: Array<{ clave: string; n: number }>; etiqueta: (c: string, i: number) => string }) {
  const max = Math.max(1, ...datos.map((d) => d.n))
  return (
    <section className="card">
      <h3 style={{ fontSize: 'var(--text-base)' }}>{titulo}</h3>
      <div className="columnas" style={{ gridTemplateColumns: `repeat(${datos.length}, 1fr)` }}>
        {datos.map((d, i) => (
          <div key={d.clave} className="columnas__col" title={`${d.clave}: ${d.n} reservas`}>
            <span className="columnas__valor num">{d.n || ''}</span>
            <span className="columnas__barra" style={{ height: `${(d.n / max) * 100}%` }} />
            <span className="columnas__etiqueta">{etiqueta(d.clave, i)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Estadisticas() {
  const [dias, setDias] = useState(120)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [soporte, setSoporte] = useState<EstadisticasSoporte | null>(null)
  const [programas, setProgramas] = useState<Conteo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setDatos(null)
    const hasta = new Date()
    const desde = new Date(hasta.getTime() - dias * 86400000).toISOString()
    estadisticasSoporte(desde, hasta.toISOString()).then((d) => vivo && setSoporte(d)).catch(() => undefined)
    programasUsados(desde.slice(0, 10), hasta.toISOString().slice(0, 10))
      .then((l) => vivo && setProgramas(l.map((p) => ({ clave: p.programa, n: p.equipos, horas: p.horas }))))
      .catch(() => vivo && setProgramas([]))
    estadisticas(desde, hasta.toISOString())
      .then((d) => vivo && setDatos(d))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudieron calcular las estadísticas.'))
    return () => {
      vivo = false
    }
  }, [dias])

  function exportar() {
    if (!datos) return
    const filas: Array<Array<string | number>> = []
    const grupo = (nombre: string, lista: Conteo[]) => lista.forEach((c) => filas.push([nombre, String(c.clave), c.n, c.horas ?? '']))
    grupo('Equipo', datos.por_equipo)
    grupo('Actividad', datos.por_actividad)
    grupo('Programa', datos.por_programa)
    grupo('Matrícula', datos.por_matricula)
    grupo('Hora de inicio', datos.por_hora)
    grupo('Día de la semana', datos.por_dia.map((d) => ({ ...d, clave: DIAS[Number(d.clave)] })))
    descargarCSV(`estadisticas-ladme-${dias}-dias.csv`, ['Dimensión', 'Valor', 'Reservas', 'Horas'], filas)
  }

  const porHora = Array.from({ length: 24 }, (_, h) => ({
    clave: `${String(h).padStart(2, '0')}:00`,
    n: datos?.por_hora.find((x) => Number(x.clave) === h)?.n ?? 0
  }))
  const porDia = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ clave: DIAS[d], n: datos?.por_dia.find((x) => Number(x.clave) === d)?.n ?? 0 }))

  return (
    <>
      <div className="row between">
        <div className="segmented" role="group" aria-label="Período">
          {RANGOS.map((r) => (
            <button key={r.dias} type="button" className={dias === r.dias ? 'activo' : ''} onClick={() => setDias(r.dias)}>
              {r.texto}
            </button>
          ))}
        </div>
        <button className="btn ghost sm" type="button" onClick={exportar} disabled={!datos}>
          <Icon nombre="descargar" /> CSV
        </button>
      </div>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {!datos && !error && <Cargando texto="Calculando…" />}

      {datos && (
        <>
          <div className="stats">
            <div className="stat brand">
              <div className="stat__label">Reservas</div>
              <div className="stat__value">{datos.total}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Horas reservadas</div>
              <div className="stat__value">{datos.horas.toLocaleString('es-CO')}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Canceladas</div>
              <div className="stat__value">{datos.canceladas}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Sin llegada registrada</div>
              <div className="stat__value">{datos.sin_llegada}</div>
            </div>
          </div>
          <div className="grid cols-2">
            <Barras titulo="Horas reservadas por equipo" datos={datos.por_equipo} valor="horas" unidad=" h" />
            <Barras titulo="Reservas por equipo" datos={datos.por_equipo} />
            <Barras titulo="Reservas por tipo de actividad" datos={datos.por_actividad} />
            <Barras titulo="Reservas por programa" datos={datos.por_programa} />
            <Barras titulo="Reservas por matrícula" datos={datos.por_matricula} />
            <Columnas titulo="Reservas por día de la semana (inicio)" datos={porDia} etiqueta={(c) => c} />
            {soporte && <Barras titulo="Reportes de fallas por equipo" datos={soporte.reportes_por_equipo} />}
            {programas.length > 0 && <Barras titulo="Horas de uso por programa (medido por Faro)" datos={programas} valor="horas" unidad=" h" />}
            {soporte && (
              <section className="card">
                <h3 style={{ fontSize: 'var(--text-base)' }}>Soporte</h3>
                <div className="stack">
                  <div className="row between small">
                    <span className="muted">Reportes de fallas en el período</span>
                    <strong className="num">{soporte.reportes}</strong>
                  </div>
                  <div className="row between small">
                    <span className="muted">Reportes aún pendientes</span>
                    <strong className="num">{soporte.reportes_abiertos}</strong>
                  </div>
                  <div className="row between small">
                    <span className="muted">Usos valorados por los usuarios</span>
                    <strong className="num">{soporte.valoradas}</strong>
                  </div>
                  <div className="row between small">
                    <span className="muted">Usos con algún problema</span>
                    <strong className="num">{soporte.con_problemas}</strong>
                  </div>
                </div>
              </section>
            )}
          </div>
          <Columnas titulo="Reservas por hora de inicio" datos={porHora} etiqueta={(c, i) => (i % 3 === 0 ? c.slice(0, 2) : '')} />
          <p className="tiny muted">
            Incluye las reservas importadas del sistema anterior. «Sin llegada» solo se mide desde que se usa esta aplicación.
          </p>
        </>
      )}
    </>
  )
}
