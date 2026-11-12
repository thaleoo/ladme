import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { accionMantenimiento, crearMantenimiento, listarEquipos, listarMantenimientos } from '../lib/api'
import { puedeValidarMantenimiento, useAuth } from '../context/AuthContext'
import type { Equipo, Mantenimiento } from '../lib/types'
import { aInputLocal, fecha, hace, horasEntre } from '../lib/format'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'

type Accion = 'iniciar' | 'completar' | 'validar' | 'cancelar'

const ESTADO_CLASE: Record<Mantenimiento['estado'], string> = {
  programado: 'info',
  en_curso: 'warn',
  completado: 'warn',
  validado: 'ok',
  cancelado: 'gray'
}

const ESTADO_TEXTO: Record<Mantenimiento['estado'], string> = {
  programado: 'Programado',
  en_curso: 'En curso',
  completado: 'Completado',
  validado: 'Validado',
  cancelado: 'Cancelado'
}

const TIPO_CLASE: Record<Mantenimiento['tipo'], string> = {
  preventivo: 'ok',
  correctivo: 'danger',
  mejora: 'info'
}

export default function MantenimientoPage() {
  const { perfil } = useAuth()
  const toast = useToast()
  const puedeValidar = puedeValidarMantenimiento(perfil)

  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [items, setItems] = useState<Mantenimiento[]>([])
  const [filtroEquipo, setFiltroEquipo] = useState('TODOS')
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | Mantenimiento['estado']>('TODOS')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [formAbierto, setFormAbierto] = useState(false)

  const [equipo, setEquipo] = useState('')
  const [tipo, setTipo] = useState<'preventivo' | 'correctivo' | 'mejora'>('preventivo')
  const [descripcion, setDescripcion] = useState('')
  const [inicio, setInicio] = useState(aInputLocal(new Date()))
  const [fin, setFin] = useState(aInputLocal(new Date(Date.now() + 2 * 3600000)))
  const [responsable, setResponsable] = useState(perfil?.correo ?? '')
  const [periodicidad, setPeriodicidad] = useState(0)
  const [cancelarConflictos, setCancelarConflictos] = useState(false)

  const [dialogo, setDialogo] = useState<{ m: Mantenimiento; tipo: Exclude<Accion, 'iniciar'> } | null>(null)
  const [texto, setTexto] = useState('')

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
      toast.mostrar(
        `Intervención registrada.${r.canceladas ? ` Se cancelaron ${r.canceladas} reserva(s) en conflicto.` : ''}`
      )
      setDescripcion('')
      setPeriodicidad(0)
      setCancelarConflictos(false)
      setFormAbierto(false)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el mantenimiento.')
    } finally {
      setGuardando(false)
    }
  }

  async function iniciar(m: Mantenimiento) {
    setError(null)
    setGuardando(true)
    try {
      await accionMantenimiento('iniciar', m.id, '')
      toast.mostrar('Intervención iniciada. El equipo queda bloqueado.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el mantenimiento.')
    } finally {
      setGuardando(false)
    }
  }

  function abrirAccion(m: Mantenimiento, tipoAccion: Exclude<Accion, 'iniciar'>) {
    setTexto(tipoAccion === 'completar' ? m.hallazgos ?? '' : '')
    setError(null)
    setDialogo({ m, tipo: tipoAccion })
  }

  async function confirmarAccion() {
    if (!dialogo) return
    if (dialogo.tipo === 'cancelar' && texto.trim().length < 3) {
      setError('Escriba un motivo de al menos 3 caracteres.')
      return
    }
    if (dialogo.tipo === 'completar' && texto.trim().length < 3) {
      setError('Registre los hallazgos (mínimo 3 caracteres).')
      return
    }
    setGuardando(true)
    try {
      await accionMantenimiento(dialogo.tipo, dialogo.m.id, texto.trim())
      toast.mostrar('Mantenimiento actualizado.')
      setDialogo(null)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el mantenimiento.')
    } finally {
      setGuardando(false)
    }
  }

  const dialogoInfo = dialogo
    ? {
        completar: {
          titulo: 'Completar intervención',
          sub: 'Registre los hallazgos técnicos. Después quedará pendiente de validación.',
          etiqueta: 'Hallazgos de la intervención',
          marcador: 'Ej. Se cambiaron discos y se actualizó el firmware.',
          boton: 'Completar',
          requerido: true
        },
        validar: {
          titulo: 'Validar técnicamente',
          sub: 'La validación cierra la intervención y deja constancia del responsable técnico.',
          etiqueta: 'Observaciones de la validación (opcional)',
          marcador: 'Ej. Revisado y aprobado por el responsable técnico.',
          boton: 'Validar',
          requerido: false
        },
        cancelar: {
          titulo: 'Cancelar intervención',
          sub: 'El equipo se libera en ese intervalo. La intervención queda en el historial.',
          etiqueta: 'Motivo de la cancelación',
          marcador: 'Ej. El equipo no presentó la falla reportada.',
          boton: 'Cancelar intervención',
          requerido: true
        }
      }[dialogo.tipo]
    : null

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        titulo="Mantenimiento"
        sub={
          puedeValidar
            ? 'Registre intervenciones, bloquee el equipo y valide técnicamente el cierre.'
            : 'Registre intervenciones y complételas. La validación técnica la hace quien tenga el permiso.'
        }
        acciones={
          <button className="btn" onClick={() => setFormAbierto(true)} type="button">
            <Icon nombre="mas2" /> Nueva intervención
          </button>
        }
      />

      <div className="stats">
        <div className="stat warn">
          <div className="stat__label">
            <Icon nombre="escudo" width={14} height={14} /> Por validar
          </div>
          <div className="stat__value">{resumen.porValidar}</div>
        </div>
        <div className="stat danger">
          <div className="stat__label">
            <Icon nombre="alerta" width={14} height={14} /> Vencidos
          </div>
          <div className="stat__value">{resumen.vencidos}</div>
        </div>
        <div className="stat brand">
          <div className="stat__label">
            <Icon nombre="calendario" width={14} height={14} /> Próximos 7 días
          </div>
          <div className="stat__value">{resumen.proximos}</div>
        </div>
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="llave" width={14} height={14} /> Total
          </div>
          <div className="stat__value">{items.length}</div>
        </div>
      </div>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {!puedeValidar && (
        <div className="alert info">
          <Icon nombre="info" />
          <div className="alert__body">
            La validación técnica está reservada a quien tenga el permiso <code>validar_mantenimiento</code>.
            Un administrador puede otorgarlo desde <strong>Usuarios</strong>.
          </div>
        </div>
      )}

      <section className="card">
        <div className="row between" style={{ gap: 'var(--s3)' }}>
          <div className="chips">
            {(['TODOS', 'programado', 'en_curso', 'completado', 'validado', 'cancelado'] as const).map((e) => (
              <button
                key={e}
                className="chip"
                aria-pressed={filtroEstado === e}
                onClick={() => setFiltroEstado(e)}
                type="button"
              >
                {e === 'TODOS' ? 'Todos' : ESTADO_TEXTO[e]}
              </button>
            ))}
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label className="solo-lector" htmlFor="filtro-equipo-mnt">
              Filtrar por equipo
            </label>
            <select
              id="filtro-equipo-mnt"
              value={filtroEquipo}
              onChange={(e) => setFiltroEquipo(e.target.value)}
            >
              <option value="TODOS">Todos los equipos</option>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.codigo}>
                  {eq.codigo}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {cargando && <Cargando texto="Cargando intervenciones…" />}

      {!cargando && filtrados.length === 0 && (
        <div className="card">
          <Empty icono="llave" titulo="No hay intervenciones con ese filtro">
            Registre una nueva intervención o cambie los filtros para ver el historial completo.
          </Empty>
        </div>
      )}

      {!cargando && filtrados.length > 0 && (
        <div className="grid" style={{ gap: 'var(--s3)' }}>
          {filtrados.map((m) => {
            const vencido = m.estado !== 'validado' && m.estado !== 'cancelado' && new Date(m.fin) < new Date()
            return (
              <article key={m.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
                <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row tight">
                      <strong style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>
                        {m.equipos?.codigo ?? 'Equipo'}
                      </strong>
                      <span className={`badge ${TIPO_CLASE[m.tipo]}`}>{m.tipo}</span>
                      <span className={`badge ${ESTADO_CLASE[m.estado]}`}>{ESTADO_TEXTO[m.estado]}</span>
                      {vencido && <span className="badge danger">Vencido</span>}
                    </div>
                    <p className="small" style={{ margin: '2px 0 0' }}>
                      {m.descripcion}
                    </p>
                  </div>
                  <span className="badge outline num">{horasEntre(m.inicio, m.fin).toFixed(0)} h</span>
                </div>

                <div className="datos">
                  <div className="datos__fila">
                    <span className="datos__clave">Intervalo</span>
                    <span className="datos__valor">
                      {fecha(m.inicio)} → {fecha(m.fin)}
                    </span>
                  </div>
                  <div className="datos__fila">
                    <span className="datos__clave">Responsable</span>
                    <span className="datos__valor">{m.responsable}</span>
                  </div>
                  <div className="datos__fila">
                    <span className="datos__clave">Próxima</span>
                    <span className="datos__valor">{m.proximo ? fecha(m.proximo) : '—'}</span>
                  </div>
                  {(m.hallazgos || m.validado_en) && (
                    <div className="datos__fila">
                      <span className="datos__clave">Hallazgos</span>
                      <span className="datos__valor">
                        {m.hallazgos || '—'}
                        {m.validado_en && (
                          <span className="tiny muted" style={{ display: 'block', fontWeight: 400 }}>
                            Validado {hace(m.validado_en)}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                <div className="row" style={{ gap: 'var(--s2)' }}>
                  {m.estado === 'programado' && (
                    <button className="btn sm ghost" disabled={guardando} onClick={() => iniciar(m)} type="button">
                      <Icon nombre="reproducir" /> Iniciar
                    </button>
                  )}
                  {(m.estado === 'programado' || m.estado === 'en_curso') && (
                    <button className="btn sm" disabled={guardando} onClick={() => abrirAccion(m, 'completar')} type="button">
                      <Icon nombre="check" /> Completar
                    </button>
                  )}
                  {m.estado === 'completado' && puedeValidar && (
                    <button className="btn sm ok" disabled={guardando} onClick={() => abrirAccion(m, 'validar')} type="button">
                      <Icon nombre="escudo" /> Validar
                    </button>
                  )}
                  {m.estado !== 'validado' && m.estado !== 'cancelado' && (
                    <button className="btn sm danger" disabled={guardando} onClick={() => abrirAccion(m, 'cancelar')} type="button">
                      Cancelar
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Modal
        abierto={formAbierto}
        titulo="Nueva intervención"
        descripcion="Al registrarla, el equipo queda bloqueado en ese intervalo para evitar reservas."
        onCerrar={() => setFormAbierto(false)}
        pie={
          <>
            <button className="btn gray" onClick={() => setFormAbierto(false)} disabled={guardando} type="button">
              Cancelar
            </button>
            <button className="btn" onClick={crear} disabled={guardando} type="button">
              {guardando ? 'Guardando…' : 'Registrar intervención'}
            </button>
          </>
        }
      >
        <form onSubmit={crear} className="stack" noValidate>
          <div className="grid cols-2 gap-sm">
            <div className="field">
              <label className="field__label" htmlFor="mnt-equipo">
                Equipo
              </label>
              <select id="mnt-equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
                {equipos.map((eq) => (
                  <option key={eq.id} value={eq.codigo}>
                    {eq.codigo} · {eq.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="mnt-tipo">
                Tipo
              </label>
              <select id="mnt-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                <option value="preventivo">Preventivo</option>
                <option value="correctivo">Correctivo</option>
                <option value="mejora">Mejora</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="mnt-inicio">
                Inicio
              </label>
              <input id="mnt-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="mnt-fin">
                Fin
              </label>
              <input id="mnt-fin" type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="mnt-responsable">
                Responsable técnico
              </label>
              <input
                id="mnt-responsable"
                type="email"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                placeholder="correo@unal.edu.co"
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="mnt-periodicidad">
                Periodicidad (días)
              </label>
              <input
                id="mnt-periodicidad"
                type="number"
                min={0}
                max={3650}
                value={periodicidad}
                onChange={(e) => setPeriodicidad(Number(e.target.value))}
              />
              <p className="help">0 = intervención única.</p>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="mnt-descripcion">
              Descripción
            </label>
            <input
              id="mnt-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={500}
              required
              placeholder="Ej. Limpieza interna y revisión de discos"
            />
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={cancelarConflictos}
              onChange={(e) => setCancelarConflictos(e.target.checked)}
            />
            <span>
              <strong>Cancelar reservas en conflicto</strong>
              Las reservas existentes en ese intervalo se cancelan con aviso en el historial.
            </span>
          </label>
        </form>
      </Modal>

      <Modal
        abierto={!!dialogo}
        titulo={dialogoInfo?.titulo ?? ''}
        descripcion={dialogoInfo?.sub}
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" onClick={() => setDialogo(null)} disabled={guardando} type="button">
              Volver
            </button>
            <button
              className={`btn ${dialogo?.tipo === 'cancelar' ? 'danger' : ''}`}
              onClick={confirmarAccion}
              disabled={guardando}
              type="button"
            >
              {guardando ? 'Guardando…' : dialogoInfo?.boton}
            </button>
          </>
        }
      >
        {dialogo && (
          <>
            <div className="alert info">
              <Icon nombre="info" />
              <div className="alert__body">
                <strong>{dialogo.m.equipos?.codigo ?? 'Equipo'}</strong> · {dialogo.m.descripcion}
                <br />
                <span className="tiny">
                  {fecha(dialogo.m.inicio)} → {fecha(dialogo.m.fin)}
                </span>
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="texto-accion">
                {dialogoInfo?.etiqueta}
              </label>
              <textarea
                id="texto-accion"
                rows={4}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={dialogoInfo?.marcador}
                maxLength={600}
                autoFocus
              />
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
