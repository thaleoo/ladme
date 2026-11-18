import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { misReservasDesde } from '../lib/api'
import type { Reserva } from '../lib/types'
import { descargarCSV } from '../lib/csv'
import { fecha } from '../lib/format'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'

type Periodo = 'semestre' | 'anio' | 'todo'

/** Semestres de la UNAL aproximados: enero–junio y julio–diciembre. */
function inicioPeriodo(p: Periodo): Date | null {
  const hoy = new Date()
  if (p === 'semestre') return new Date(hoy.getFullYear(), hoy.getMonth() < 6 ? 0 : 6, 1)
  if (p === 'anio') return new Date(hoy.getFullYear(), 0, 1)
  return null
}

/** Horas efectivamente usadas: si se liberó antes, cuenta hasta ese momento; nada del futuro. */
function horasUsadas(r: Reserva): number {
  const fin = Math.min(new Date(r.fin).getTime(), r.liberada_en ? new Date(r.liberada_en).getTime() : Infinity, Date.now())
  return Math.max(0, (fin - new Date(r.inicio).getTime()) / 3600000)
}

function agrupar(lista: Reserva[], clave: (r: Reserva) => string) {
  const mapa = new Map<string, { n: number; horas: number }>()
  for (const r of lista) {
    const k = clave(r)
    const v = mapa.get(k) ?? { n: 0, horas: 0 }
    v.n++
    v.horas += horasUsadas(r)
    mapa.set(k, v)
  }
  return [...mapa.entries()].map(([k, v]) => ({ clave: k, ...v })).sort((a, b) => b.horas - a.horas)
}

function Barras({ titulo, datos }: { titulo: string; datos: Array<{ clave: string; n: number; horas: number }> }) {
  const max = Math.max(1, ...datos.map((d) => d.horas))
  return (
    <section className="card">
      <h3 style={{ fontSize: 'var(--text-base)' }}>{titulo}</h3>
      <div className="barras">
        {datos.map((d) => (
          <div key={d.clave} className="barras__fila" title={`${d.clave}: ${Math.round(d.horas)} h en ${d.n} reservas`}>
            <span className="barras__etiqueta">{d.clave}</span>
            <span className="barras__pista">
              <span className="barras__barra" style={{ width: `${(d.horas / max) * 100}%` }} />
            </span>
            <span className="barras__valor num">{Math.round(d.horas)} h</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function MiUso() {
  const [periodo, setPeriodo] = useState<Periodo>('semestre')
  const [lista, setLista] = useState<Reserva[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setLista(null)
    setError(null)
    const desde = inicioPeriodo(periodo)
    misReservasDesde(desde ? desde.toISOString() : null)
      .then((l) => vivo && setLista(l.filter((r) => new Date(r.inicio).getTime() <= Date.now())))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar su historial.'))
    return () => {
      vivo = false
    }
  }, [periodo])

  const resumen = useMemo(() => {
    if (!lista) return null
    const horas = lista.reduce((s, r) => s + horasUsadas(r), 0)
    return {
      horas,
      equipos: agrupar(lista, (r) => r.equipos?.codigo ?? '—'),
      actividades: agrupar(lista, (r) => r.actividad ?? 'Sin especificar'),
      diasDistintos: new Set(lista.map((r) => new Date(r.inicio).toDateString())).size
    }
  }, [lista])

  function exportar() {
    if (!lista) return
    descargarCSV(
      `mi-uso-ladme-${periodo}.csv`,
      ['Reserva', 'Equipo', 'Actividad', 'Inicio', 'Fin', 'Horas usadas'],
      lista.map((r) => [r.codigo_legible, r.equipos?.codigo, r.actividad, fecha(r.inicio), fecha(r.liberada_en ?? r.fin), horasUsadas(r).toFixed(1)])
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Historial"
        titulo="Mi uso"
        sub="Cuánto ha usado el laboratorio. Sirve como soporte para su trabajo de grado o informe."
        volver={{ a: '/cuenta', texto: 'Mi cuenta' }}
      />

      <div className="row between">
        <div className="segmented" role="group" aria-label="Período">
          {(
            [
              ['semestre', 'Este semestre'],
              ['anio', 'Este año'],
              ['todo', 'Todo']
            ] as const
          ).map(([v, t]) => (
            <button key={v} type="button" className={periodo === v ? 'activo' : ''} onClick={() => setPeriodo(v)}>
              {t}
            </button>
          ))}
        </div>
        <button className="btn ghost sm" type="button" onClick={exportar} disabled={!lista?.length}>
          <Icon nombre="descargar" /> CSV
        </button>
      </div>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {!lista && !error && <Cargando texto="Calculando su uso…" />}

      {lista && lista.length === 0 && (
        <div className="card">
          <Empty icono="grafica" titulo="Sin uso en este período">
            Cuando use un equipo aparecerá aquí. <Link to="/reservar">Hacer una reserva</Link>
          </Empty>
        </div>
      )}

      {resumen && lista && lista.length > 0 && (
        <>
          <div className="stats">
            <div className="stat brand">
              <div className="stat__label">Horas de uso</div>
              <div className="stat__value">{Math.round(resumen.horas).toLocaleString('es-CO')}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Reservas</div>
              <div className="stat__value">{lista.length}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Días con uso</div>
              <div className="stat__value">{resumen.diasDistintos}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Equipo más usado</div>
              <div className="stat__value" style={{ fontSize: 'var(--text-xl)' }}>
                {resumen.equipos[0]?.clave}
              </div>
            </div>
          </div>
          <div className="grid cols-2">
            <Barras titulo="Horas por equipo" datos={resumen.equipos.slice(0, 8)} />
            <Barras titulo="Horas por actividad" datos={resumen.actividades} />
          </div>
          <p className="tiny muted">
            Se cuentan las horas reales: si liberó el equipo antes de tiempo, hasta ese momento. Las reservas canceladas no
            suman.
          </p>
        </>
      )}
    </>
  )
}
