import { useEffect, useMemo, useState } from 'react'
import { estadisticasFaro, type EstadisticasFaro } from '../../lib/api'
import { Cargando } from '../../components/PageHeader'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })
const h = (n: number) => `${num.format(n)} h`

/** Uso real medido por Faro: cuánto se usan los equipos, cuánto sin reserva y cuándo. */
export default function FaroUso() {
  const [dias, setDias] = useState(7)
  const [datos, setDatos] = useState<EstadisticasFaro | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDatos(null)
    const hasta = new Date()
    const desde = new Date(hasta.getTime() - dias * 86400_000)
    estadisticasFaro(desde.toISOString(), hasta.toISOString())
      .then(setDatos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo calcular el uso real.'))
  }, [dias])

  const resumen = useMemo(() => {
    const l = datos?.por_equipo ?? []
    const suma = (k: 'uso_h' | 'sin_reserva_h' | 'reservado_h' | 'reservas_sin_uso') => l.reduce((a, x) => a + Number(x[k] || 0), 0)
    const uso = suma('uso_h')
    return { uso, sin: suma('sin_reserva_h'), reservado: suma('reservado_h'), noShows: suma('reservas_sin_uso'), pct: uso > 0 ? suma('sin_reserva_h') / uso : 0 }
  }, [datos])

  const mapa = useMemo(() => {
    const celdas = new Map<string, number>()
    let max = 0
    let minH = 7
    let maxH = 19
    for (const c of datos?.por_hora ?? []) {
      celdas.set(`${c.dia}-${c.hora}`, c.uso_h)
      max = Math.max(max, c.uso_h)
      if (c.uso_h > 0) { minH = Math.min(minH, c.hora); maxH = Math.max(maxH, c.hora) }
    }
    return { celdas, max, horas: Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i) }
  }, [datos])

  const maxEquipo = Math.max(1, ...(datos?.por_equipo ?? []).map((e) => Math.max(e.uso_h, e.reservado_h)))

  return (
    <section className="card tight faro-uso">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
        <strong>Uso real medido por Faro</strong>
        <div className="chips" role="group" aria-label="Periodo">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" className="chip" aria-pressed={dias === d} onClick={() => setDias(d)}>
              {d} días
            </button>
          ))}
        </div>
      </div>

      {error && <p className="small" style={{ color: 'var(--danger-600, #dc2626)' }}>{error}</p>}
      {!datos && !error && <Cargando texto="Calculando el uso…" />}
      {datos && datos.por_equipo.length === 0 && (
        <p className="small muted" style={{ margin: 'var(--s2) 0 0' }}>
          Aún no hay datos. Faro empieza a medir en cuanto un equipo queda vinculado.
        </p>
      )}

      {datos && datos.por_equipo.length > 0 && (
        <>
          <div className="faro-uso__cifras">
            <div><span className="tiny muted">Horas en uso</span><strong className="num">{h(resumen.uso)}</strong></div>
            <div>
              <span className="tiny muted">Uso sin reserva</span>
              <strong className="num">{h(resumen.sin)}</strong>
              <span className="tiny muted">{Math.round(resumen.pct * 100)} % del uso</span>
            </div>
            <div><span className="tiny muted">Horas reservadas</span><strong className="num">{h(resumen.reservado)}</strong></div>
            <div>
              <span className="tiny muted">Reservas sin uso</span>
              <strong className="num">{resumen.noShows}</strong>
              <span className="tiny muted">nadie usó el PC</span>
            </div>
          </div>

          <h3 className="faro-uso__sub">¿Cuándo se usa la sala?</h3>
          <div className="faro-mapa" role="table" aria-label="Horas de uso por día y hora"
               style={{ gridTemplateColumns: `2.4rem repeat(${mapa.horas.length}, minmax(0, 1fr))` }}>
            <span role="columnheader" />
            {mapa.horas.map((hh) => (
              <span key={hh} role="columnheader" className="faro-mapa__hora">{hh % 3 === 0 ? hh : ''}</span>
            ))}
            {DIAS.map((d, i) => (
              <div key={d} role="row" style={{ display: 'contents' }}>
                <span role="rowheader" className="faro-mapa__dia">{d}</span>
                {mapa.horas.map((hh) => {
                  const v = mapa.celdas.get(`${i + 1}-${hh}`) ?? 0
                  const nivel = v <= 0 || mapa.max <= 0 ? 0 : Math.max(1, Math.ceil((v / mapa.max) * 5))
                  const texto = `${d} ${hh}:00–${hh + 1}:00 · ${h(v)} de uso`
                  return <span key={hh} role="cell" className={`faro-mapa__celda n${nivel}`} title={texto} aria-label={texto} />
                })}
              </div>
            ))}
          </div>
          <div className="faro-mapa__leyenda tiny muted">
            Menos {[0, 1, 2, 3, 4, 5].map((n) => <span key={n} className={`faro-mapa__celda n${n}`} aria-hidden="true" />)} Más
          </div>

          <h3 className="faro-uso__sub">Por equipo</h3>
          <div className="faro-uso__leyenda tiny">
            <span><i className="faro-serie s1" /> Uso con reserva</span>
            <span><i className="faro-serie s2" /> Uso sin reserva</span>
            <span><i className="faro-serie reservado" /> Tiempo reservado</span>
          </div>
          <ul className="faro-barras">
            {datos.por_equipo.map((e) => {
              const con = Math.max(0, e.uso_h - e.sin_reserva_h)
              const texto = `${e.codigo}: ${h(e.uso_h)} en uso (${h(e.sin_reserva_h)} sin reserva), ${h(e.reservado_h)} reservadas, ${e.reservas_sin_uso} reservas sin uso`
              return (
                <li key={e.codigo} title={texto}>
                  <span className="faro-barras__codigo">{e.codigo}</span>
                  <span className="faro-barras__pista" aria-label={texto}>
                    <span className="faro-barras__reservado" style={{ width: `${(e.reservado_h / maxEquipo) * 100}%` }} />
                    <span className="faro-barras__uso">
                      {con > 0 && <i className="faro-serie s1" style={{ width: `${(con / maxEquipo) * 100}%` }} />}
                      {e.sin_reserva_h > 0 && <i className="faro-serie s2" style={{ width: `${(e.sin_reserva_h / maxEquipo) * 100}%` }} />}
                    </span>
                  </span>
                  <span className="faro-barras__valor num tiny">
                    {h(e.uso_h)}{e.reservas_sin_uso > 0 ? ` · ${e.reservas_sin_uso} sin uso` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
