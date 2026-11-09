import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarEquipos, listarOcupacion } from '../lib/api'
import type { Equipo, Ocupacion } from '../lib/types'
import { aInputFecha, fecha, fechaLarga, finDia, hora, inicioDia, sumarDias } from '../lib/format'
import { useAuth } from '../context/AuthContext'

interface Tramo {
  inicio: string
  fin: string
  tipo: 'reserva' | 'bloqueo'
  motivo: string | null
}

function recortar(intervalos: Ocupacion[], desde: Date, hasta: Date): Tramo[] {
  return intervalos
    .filter((o) => new Date(o.fin) > desde && new Date(o.inicio) < hasta)
    .map((o) => ({
      inicio: new Date(o.inicio) < desde ? desde.toISOString() : o.inicio,
      fin: new Date(o.fin) > hasta ? hasta.toISOString() : o.fin,
      tipo: o.tipo,
      motivo: o.motivo
    }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
}

function horas(tramos: Tramo[]): number {
  return tramos.reduce((s, t) => s + (new Date(t.fin).getTime() - new Date(t.inicio).getTime()) / 3600000, 0)
}

export default function Disponibilidad() {
  const { perfil } = useAuth()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [ocupacion, setOcupacion] = useState<Ocupacion[]>([])
  const [fechaSel, setFechaSel] = useState(aInputFecha(new Date()))
  const [filtro, setFiltro] = useState('TODOS')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([listarEquipos(), listarOcupacion()])
      .then(([eqs, ocs]) => {
        if (!vivo) return
        setEquipos(eqs)
        setOcupacion(ocs)
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar la disponibilidad.'))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [])

  const dia = useMemo(() => {
    const [y, m, d] = fechaSel.split('-').map(Number)
    return y && m && d ? new Date(y, m - 1, d) : new Date()
  }, [fechaSel])

  const desde = useMemo(() => inicioDia(dia), [dia])
  const hasta = useMemo(() => finDia(dia), [dia])
  const ahora = new Date()

  const porEquipo = useMemo(() => {
    const mapa = new Map<string, Ocupacion[]>()
    for (const o of ocupacion) {
      const lista = mapa.get(o.codigo) ?? []
      lista.push(o)
      mapa.set(o.codigo, lista)
    }
    return mapa
  }, [ocupacion])

  const visibles = equipos.filter((e) => filtro === 'TODOS' || e.codigo === filtro)

  const resumenAhora = useMemo(() => {
    let libres = 0
    let ocupados = 0
    for (const e of equipos) {
      const activo = (porEquipo.get(e.codigo) ?? []).some(
        (o) => new Date(o.inicio) <= ahora && new Date(o.fin) > ahora
      )
      if (activo) ocupados++
      else libres++
    }
    return { libres, ocupados }
  }, [equipos, porEquipo, ahora])

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(desde, i)), [desde])

  return (
    <>
      <div className="card accent">
        <div className="row between">
          <div>
            <h2>Disponibilidad</h2>
            <p className="muted small mb-0">
              Hola {perfil?.nombre?.split(' ')[0] || 'usuario'}: consulte el estado de los equipos y reserve.
            </p>
          </div>
          <Link className="btn" to="/reservar">Nueva reserva</Link>
        </div>

        <div className="grid cols-3 mt">
          <div>
            <label htmlFor="fecha">Día a consultar</label>
            <input id="fecha" type="date" value={fechaSel} onChange={(e) => setFechaSel(e.target.value)} />
          </div>
          <div>
            <label htmlFor="filtro">Equipo</label>
            <select id="filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="TODOS">Todos los equipos</option>
              {equipos.map((e) => (
                <option key={e.id} value={e.codigo}>{e.codigo} · {e.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Ahora mismo</label>
            <div className="row">
              <span className="badge ok">{resumenAhora.libres} libres</span>
              <span className="badge danger">{resumenAhora.ocupados} ocupados</span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}
      {cargando && <div className="card center muted">Cargando equipos y ocupación…</div>}

      {!cargando && !error && (
        <>
          <div className="card">
            <h3 className="mb">Semana alrededor de {fechaLarga(desde)}</h3>
            <p className="small muted">
              Cada columna resume las horas ocupadas del equipo ese día. Toque un equipo para ver su ficha.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Equipo</th>
                    {dias.map((d) => (
                      <th key={d.toISOString()} className="center">
                        {new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric' }).format(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((e) => {
                    const intervalos = porEquipo.get(e.codigo) ?? []
                    return (
                      <tr key={e.id}>
                        <td>
                          <Link to={`/equipo/${e.codigo}`}><strong>{e.codigo}</strong></Link>
                          <div className="tiny muted">{e.nombre}</div>
                        </td>
                        {dias.map((d) => {
                          const tramos = recortar(intervalos, inicioDia(d), finDia(d))
                          const h = horas(tramos)
                          const nivel = h >= 8 ? 'danger' : h > 0 ? 'warn' : 'ok'
                          const texto = h > 0 ? `${Math.round(h)} h` : 'libre'
                          return (
                            <td key={d.toISOString()} className="center">
                              <span className={`badge ${nivel}`}>{texto}</span>
                              {tramos.length > 0 && (
                                <div className="tiny muted">
                                  {tramos.map((t) => `${hora(t.inicio)}–${hora(t.fin)}`).join(', ')}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid cols-2">
            {visibles.map((e) => {
              const intervalos = porEquipo.get(e.codigo) ?? []
              const tramos = recortar(intervalos, desde, hasta)
              const enCurso = intervalos.find((o) => new Date(o.inicio) <= ahora && new Date(o.fin) > ahora)
              const proximo = intervalos
                .filter((o) => new Date(o.inicio) > ahora)
                .sort((a, b) => a.inicio.localeCompare(b.inicio))[0]
              return (
                <div key={e.id} className={`card ${enCurso ? 'warn' : 'ok'}`}>
                  <div className="row between">
                    <div>
                      <h4>{e.codigo}</h4>
                      <div className="small muted">{e.nombre} {e.ubicacion ? `· ${e.ubicacion}` : ''}</div>
                    </div>
                    <span className={`badge ${enCurso ? 'danger' : 'ok'}`}>
                      {enCurso ? `Ocupado hasta ${hora(enCurso.fin)}` : 'Libre ahora'}
                    </span>
                  </div>

                  <div className="mt small">
                    {tramos.length === 0 ? (
                      <span className="muted">Sin ocupación registrada para este día.</span>
                    ) : (
                      <ul className="list">
                        {tramos.map((t, i) => (
                          <li key={`${t.inicio}-${i}`}>
                            <span>
                              <span className={`badge ${t.tipo === 'bloqueo' ? 'gray' : 'warn'}`}>
                                {t.tipo === 'bloqueo' ? 'Bloqueo' : 'Reserva'}
                              </span>{' '}
                              {hora(t.inicio)}–{hora(t.fin)}
                              {t.motivo && <span className="tiny muted"> · {t.motivo}</span>}
                            </span>
                            <span className="tiny muted">{Math.round((new Date(t.fin).getTime() - new Date(t.inicio).getTime()) / 3600000)} h</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="row mt">
                    <Link className="btn sm" to={`/reservar?equipo=${encodeURIComponent(e.codigo)}`}>Reservar</Link>
                    <Link className="btn ghost sm" to={`/equipo/${e.codigo}`}>Ver ficha</Link>
                    {proximo && (
                      <span className="tiny muted">Próxima ocupación: {fecha(proximo.inicio)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {visibles.length === 0 && <div className="alert info">No hay equipos que coincidan con el filtro.</div>}
        </>
      )}
    </>
  )
}
