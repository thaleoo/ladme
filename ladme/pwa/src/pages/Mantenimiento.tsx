import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { accionMantenimiento, crearMantenimiento, listarEquipos, listarMantenimientos } from '../lib/api'
import { puedeValidarMantenimiento, useAuth } from '../context/AuthContext'
import type { Equipo, Mantenimiento } from '../lib/types'
import { aInputLocal, fecha, horasEntre } from '../lib/format'

function estadoClase(estado: Mantenimiento['estado']): string {
  if (estado === 'validado') return 'ok'
  if (estado === 'completado') return 'warn'
  if (estado === 'en_curso') return 'warn'
  if (estado === 'cancelado') return 'gray'
  return ''
}

export default function MantenimientoPage() {
  const { perfil } = useAuth()
  const puedeValidar = puedeValidarMantenimiento(perfil)
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [items, setItems] = useState<Mantenimiento[]>([])
  const [filtroEquipo, setFiltroEquipo] = useState('TODOS')
  const [filtroEstado, setFiltroEstado] = useState('TODOS')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [equipo, setEquipo] = useState('')
  const [tipo, setTipo] = useState<'preventivo' | 'correctivo' | 'mejora'>('preventivo')
  const [descripcion, setDescripcion] = useState('')
  const [inicio, setInicio] = useState(aInputLocal(new Date()))
  const [fin, setFin] = useState(aInputLocal(new Date(Date.now() + 2 * 3600000)))
  const [responsable, setResponsable] = useState(perfil?.correo ?? '')
  const [periodicidad, setPeriodicidad] = useState(0)
  const [cancelarConflictos, setCancelarConflictos] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setError(null)
      const [eqs, mnts] = await Promise.all([listarEquipos(), listarMantenimientos()])
      setEquipos(eqs)
      setItems(mnts)
      setEquipo((prev) => prev || eqs[0]?.codigo || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los mantenimientos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (perfil?.correo && !responsable) setResponsable(perfil.correo)
  }, [perfil, responsable])

  const filtrados = useMemo(
    () =>
      items.filter(
        (m) =>
          (filtroEstado === 'TODOS' || m.estado === filtroEstado) &&
          (filtroEquipo === 'TODOS' || m.equipos?.codigo === filtroEquipo)
      ),
    [items, filtroEstado, filtroEquipo]
  )

  const resumen = useMemo(() => {
    const ahora = new Date()
    let porValidar = 0
    let vencidos = 0
    let proximos = 0
    for (const m of items) {
      if (m.estado === 'completado') porValidar++
      if (m.estado !== 'validado' && m.estado !== 'cancelado' && new Date(m.fin) < ahora) vencidos++
      if (m.estado !== 'validado' && m.estado !== 'cancelado') {
        const delta = (new Date(m.fin).getTime() - ahora.getTime()) / 86400000
        if (delta >= 0 && delta <= 7) proximos++
      }
    }
    return { porValidar, vencidos, proximos }
  }, [items])

  async function crear(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    if (!equipo) {
      setError('Seleccione un equipo.')
      return
    }
    if (new Date(fin) <= new Date(inicio)) {
      setError('El fin debe ser posterior al inicio.')
      return
    }
    setGuardando(true)
    try {
      const r = await crearMantenimiento({
        equipo,
        tipo,
        descripcion,
        inicio: new Date(inicio).toISOString(),
        fin: new Date(fin).toISOString(),
        responsable,
        periodicidadDias: periodicidad,
        cancelarConflictos
      })
      setAviso(
        `Intervención registrada.${r.canceladas ? ` Se cancelaron ${r.canceladas} reserva(s) en conflicto.` : ''} El equipo quedó bloqueado en ese intervalo.`
      )
      setDescripcion('')
      setPeriodicidad(0)
      setCancelarConflictos(false)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el mantenimiento.')
    } finally {
      setGuardando(false)
    }
  }

  async function accion(m: Mantenimiento, tipoAccion: 'iniciar' | 'completar' | 'validar' | 'cancelar') {
    setError(null)
    setAviso(null)
    let texto = ''
    if (tipoAccion === 'cancelar') {
      const motivo = window.prompt('Motivo de la cancelación:')
      if (motivo === null) return
      texto = motivo.trim()
      if (texto.length < 3) {
        setError('Escriba un motivo de al menos 3 caracteres.')
        return
      }
    } else if (tipoAccion === 'completar' || tipoAccion === 'validar') {
      const hallazgos = window.prompt(
        tipoAccion === 'validar' ? 'Observaciones de la validación técnica (opcional):' : 'Hallazgos de la intervención:',
        m.hallazgos ?? ''
      )
      if (hallazgos === null) return
      texto = hallazgos.trim()
      if (tipoAccion === 'completar' && texto.length < 3) {
        setError('Registre los hallazgos (mínimo 3 caracteres).')
        return
      }
    }
    setGuardando(true)
    try {
      await accionMantenimiento(tipoAccion, m.id, texto)
      setAviso('Mantenimiento actualizado.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el mantenimiento.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <div className="card accent">
        <h2>Mantenimiento e intervenciones</h2>
        <p className="muted small mb-0">
          Registre intervenciones, bloquee el equipo durante el trabajo y valide técnicamente el cierre.
          {puedeValidar ? ' Usted puede validar.' : ' Su cuenta puede gestionar, pero no validar.'}
        </p>
      </div>

      <div className="card">
        <div className="row">
          {resumen.porValidar > 0 && <span className="badge warn">{resumen.porValidar} por validar</span>}
          {resumen.vencidos > 0 && <span className="badge danger">{resumen.vencidos} vencidos</span>}
          {resumen.proximos > 0 && <span className="badge">{resumen.proximos} próximos (7 días)</span>}
          {resumen.porValidar + resumen.vencidos + resumen.proximos === 0 && (
            <span className="badge ok">Sin alertas de mantenimiento</span>
          )}
        </div>
      </div>

      {aviso && <div className="alert ok">{aviso}</div>}
      {error && <div className="alert danger">{error}</div>}

      <div className="card">
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Registrar nueva intervención</summary>
          <form onSubmit={crear} className="stack mt">
            <div className="grid cols-2">
              <div>
                <label htmlFor="mnt-equipo">Equipo</label>
                <select id="mnt-equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
                  {equipos.map((eq) => (
                    <option key={eq.id} value={eq.codigo}>{eq.codigo} · {eq.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mnt-tipo">Tipo</label>
                <select id="mnt-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                  <option value="preventivo">Preventivo</option>
                  <option value="correctivo">Correctivo</option>
                  <option value="mejora">Mejora</option>
                </select>
              </div>
              <div>
                <label htmlFor="mnt-inicio">Inicio</label>
                <input id="mnt-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="mnt-fin">Fin</label>
                <input id="mnt-fin" type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="mnt-responsable">Responsable técnico</label>
                <input id="mnt-responsable" type="email" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="correo@unal.edu.co" required />
              </div>
              <div>
                <label htmlFor="mnt-periodicidad">Periodicidad (días, 0 = única)</label>
                <input id="mnt-periodicidad" type="number" min={0} max={3650} value={periodicidad} onChange={(e) => setPeriodicidad(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <label htmlFor="mnt-descripcion">Descripción</label>
              <input id="mnt-descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} required placeholder="Ej. Limpieza interna y revisión de discos" />
            </div>
            <label className="row" style={{ fontWeight: 500 }}>
              <input type="checkbox" checked={cancelarConflictos} onChange={(e) => setCancelarConflictos(e.target.checked)} style={{ width: 'auto' }} />
              <span>Cancelar reservas existentes en ese intervalo (con aviso en el historial)</span>
            </label>
            <div className="row">
              <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar intervención'}</button>
              <span className="tiny muted">Al registrar, el equipo queda bloqueado en ese intervalo para evitar reservas.</span>
            </div>
          </form>
        </details>
      </div>

      <div className="card">
        <div className="row between">
          <h3 className="mb-0">Historial</h3>
          <div className="row">
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={{ width: 'auto' }}>
              <option value="TODOS">Todos los estados</option>
              <option value="programado">Programado</option>
              <option value="en_curso">En curso</option>
              <option value="completado">Completado (por validar)</option>
              <option value="validado">Validado</option>
              <option value="cancelado">Cancelado</option>
            </select>
            <select value={filtroEquipo} onChange={(e) => setFiltroEquipo(e.target.value)} style={{ width: 'auto' }}>
              <option value="TODOS">Todos los equipos</option>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.codigo}>{eq.codigo}</option>
              ))}
            </select>
          </div>
        </div>

        {cargando && <p className="muted mt">Cargando…</p>}
        {!cargando && filtrados.length === 0 && <p className="muted mt">No hay intervenciones con ese filtro.</p>}

        {filtrados.length > 0 && (
          <div className="table-wrap mt">
            <table>
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Intervalo</th>
                  <th>Responsable</th>
                  <th>Próximo</th>
                  <th>Hallazgos</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((m) => {
                  const vencido = m.estado !== 'validado' && m.estado !== 'cancelado' && new Date(m.fin) < new Date()
                  return (
                    <tr key={m.id}>
                      <td>{m.equipos?.codigo ?? '—'}</td>
                      <td style={{ textTransform: 'capitalize' }}>{m.tipo}</td>
                      <td>
                        <span className={`badge ${estadoClase(m.estado)}`}>{m.estado.replace('_', ' ')}</span>
                        {vencido && <span className="badge danger" style={{ marginLeft: 4 }}>vencido</span>}
                      </td>
                      <td>
                        <div className="tiny">{fecha(m.inicio)}</div>
                        <div className="tiny muted">→ {fecha(m.fin)}</div>
                        <div className="tiny muted">{horasEntre(m.inicio, m.fin).toFixed(0)} h</div>
                      </td>
                      <td className="tiny">{m.responsable}</td>
                      <td className="tiny">{m.proximo ?? '—'}</td>
                      <td className="tiny">
                        {m.hallazgos || <span className="muted">—</span>}
                        {m.validado_en && <div className="muted">Validado: {fecha(m.validado_en)}</div>}
                      </td>
                      <td>
                        <div className="row">
                          {m.estado === 'programado' && (
                            <button className="btn sm ghost" disabled={guardando} onClick={() => accion(m, 'iniciar')}>Iniciar</button>
                          )}
                          {(m.estado === 'programado' || m.estado === 'en_curso') && (
                            <button className="btn sm" disabled={guardando} onClick={() => accion(m, 'completar')}>Completar</button>
                          )}
                          {m.estado === 'completado' && puedeValidar && (
                            <button className="btn sm ok" disabled={guardando} onClick={() => accion(m, 'validar')}>Validar</button>
                          )}
                          {m.estado !== 'validado' && m.estado !== 'cancelado' && (
                            <button className="btn sm danger" disabled={guardando} onClick={() => accion(m, 'cancelar')}>Cancelar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!puedeValidar && (
        <div className="alert info">
          La validación técnica está reservada a quien tenga el permiso <code>validar_mantenimiento</code>.
          Un administrador puede otorgarlo desde <strong>Usuarios</strong>.
        </div>
      )}
    </>
  )
}
