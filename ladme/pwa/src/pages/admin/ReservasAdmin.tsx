import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarReservasAdmin } from '../../lib/api'
import { ACTIVIDADES, type Reserva } from '../../lib/types'
import { aInputFecha, duracion, estadoReserva, fecha, hora, sumarDias, tonoEstado } from '../../lib/format'
import { descargarCSV } from '../../lib/csv'
import { useLimites } from '../../lib/politicas'
import { esAdmin, useAuth } from '../../context/AuthContext'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import AccionesReserva, { type Accion } from './AccionesReserva'

/** «2026-11-17» → «17 nov». */
function diaCorto(iso: string): string {
  if (!iso) return '…'
  return new Date(`${iso}T12:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')
}

const ESTADOS = ['Todas', 'Vigentes', 'En curso', 'Programada', 'Sin registrar llegada', 'Finalizada', 'Cancelada']
const CLAVE_FILTROS = 'ladme-panel-reservas'

interface Filtros {
  desde: string
  hasta: string
  texto: string
  estado: string
  actividad: string
}

function filtrosIniciales(): Filtros {
  const base = {
    desde: aInputFecha(sumarDias(new Date(), -7)),
    hasta: aInputFecha(sumarDias(new Date(), 30)),
    texto: '',
    estado: 'Vigentes',
    actividad: 'Todas'
  }
  try {
    // Al volver del detalle de una reserva, el panel queda como estaba.
    return { ...base, ...(JSON.parse(sessionStorage.getItem(CLAVE_FILTROS) ?? '{}') as Partial<Filtros>) }
  } catch {
    return base
  }
}

/** Titular visible: el de la cuenta o, si la reserva vino del sistema anterior y nadie la reclamó, el original. */
export function titularDe(r: Reserva): { nombre: string; correo: string; migrada: boolean; sinReclamar: boolean } {
  const imp = r.reservas_importadas?.[0]
  const sinReclamar = !!imp && r.tipo === 'bloqueo'
  return {
    nombre: (sinReclamar ? imp?.nombre_titular : r.perfiles?.nombre) ?? '—',
    correo: (sinReclamar ? imp?.correo_titular : r.perfiles?.correo) ?? '',
    migrada: !!imp,
    sinReclamar
  }
}

export default function ReservasAdmin() {
  const { perfil } = useAuth()
  const lim = useLimites()
  const [f, setF] = useState<Filtros>(filtrosIniciales)
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)
  const [fechasAbiertas, setFechasAbiertas] = useState(false)
  const cambiar = (x: Partial<Filtros>) => setF((y) => ({ ...y, ...x }))

  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_FILTROS, JSON.stringify(f))
    } catch {
      /* sin almacenamiento */
    }
  }, [f])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const lista = await listarReservasAdmin(new Date(`${f.desde}T00:00`).toISOString(), new Date(`${f.hasta}T23:59:59`).toISOString())
      // Reservas, y también las migradas que aún esperan a su titular (se guardan como bloqueo provisional).
      setReservas(lista.filter((r) => r.tipo === 'reserva' || !!r.reservas_importadas?.length))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las reservas.')
    } finally {
      setCargando(false)
    }
  }, [f.desde, f.hasta])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const filtradas = useMemo(() => {
    const q = f.texto.trim().toLowerCase()
    return reservas
      .map((r) => ({ r, est: estadoReserva(r, lim.toleranciaMin), t: titularDe(r) }))
      .filter(({ r, est, t }) => {
        if (f.estado === 'Vigentes' ? est === 'Finalizada' || est === 'Cancelada' : f.estado !== 'Todas' && est !== f.estado) return false
        if (f.actividad !== 'Todas' && r.actividad !== f.actividad) return false
        if (!q) return true
        return [t.nombre, t.correo, r.equipos?.codigo, r.codigo_legible, r.actividad, r.programa, r.matricula, r.docente, r.detalle]
          .some((v) => v?.toLowerCase().includes(q))
      })
  }, [reservas, f.texto, f.estado, f.actividad, lim.toleranciaMin])

  function exportar() {
    descargarCSV(
      `reservas-ladme-${f.desde}-a-${f.hasta}.csv`,
      [
        'Código', 'Equipo', 'Titular', 'Correo', 'Tipo de usuario', 'Programa', 'Matrícula', 'Actividad', 'Docente', 'Detalle',
        'Inicio', 'Fin', 'Horas', 'Estado', 'Llegada', 'Liberada', 'Extensiones', 'Desatendido', 'Compartida', 'Reserva larga',
        'Clase', 'Migrada', 'Creada', 'Motivo de cancelación'
      ],
      filtradas.map(({ r, est, t }) => [
        r.codigo_legible, r.equipos?.codigo, t.nombre, t.correo, r.tipo_usuario ?? '', r.programa, r.matricula, r.actividad, r.docente ?? '',
        r.detalle, fecha(r.inicio), fecha(r.fin), ((new Date(r.fin).getTime() - new Date(r.inicio).getTime()) / 3600000).toFixed(1),
        t.sinReclamar ? 'Migrada sin reclamar' : est, r.llegada_en ? fecha(r.llegada_en) : '', r.liberada_en ? fecha(r.liberada_en) : '',
        r.extensiones, r.desatendido ? 'Sí' : 'No', r.compartida ? 'Sí' : 'No', r.excepcion ? 'Sí' : 'No', r.clase_id ? 'Sí' : 'No',
        t.migrada ? 'Sí' : 'No', fecha(r.creado_en), r.estado === 'cancelada' ? r.motivo : ''
      ])
    )
  }

  return (
    <>
      <section className="filtros-admin" aria-label="Filtros">
        <label className="disp-buscar">
          <Icon nombre="buscar" width={20} height={20} />
          <span className="solo-lector">Buscar reservas</span>
          <input type="search" value={f.texto} onChange={(e) => cambiar({ texto: e.target.value })} placeholder="Nombre, correo, equipo, código o docente" />
        </label>
        <div className="chips-desliza">
          <label className={`chip chip--select ${f.estado !== 'Todas' ? 'activo' : ''}`}>
            <span className="solo-lector">Estado</span>
            <select value={f.estado} onChange={(e) => cambiar({ estado: e.target.value })}>
              {ESTADOS.map((x) => (
                <option key={x} value={x}>{x === 'Todas' ? 'Todos los estados' : x}</option>
              ))}
            </select>
          </label>
          <label className={`chip chip--select ${f.actividad !== 'Todas' ? 'activo' : ''}`}>
            <span className="solo-lector">Actividad</span>
            <select value={f.actividad} onChange={(e) => cambiar({ actividad: e.target.value })}>
              {['Todas', ...ACTIVIDADES].map((x) => (
                <option key={x} value={x}>{x === 'Todas' ? 'Todas las actividades' : x}</option>
              ))}
            </select>
          </label>
          <button type="button" className="chip" aria-expanded={fechasAbiertas} onClick={() => setFechasAbiertas((v) => !v)}>
            <Icon nombre="calendario" width={16} height={16} /> {diaCorto(f.desde)} – {diaCorto(f.hasta)}
          </button>
          <button type="button" className="chip" onClick={exportar} disabled={!filtradas.length}>
            <Icon nombre="descargar" width={16} height={16} /> CSV
          </button>
        </div>
        {fechasAbiertas && (
          <div className="filtros-admin__fechas">
            <div className="field">
              <label className="field__label" htmlFor="ra-desde">Desde</label>
              <input id="ra-desde" type="date" value={f.desde} onChange={(e) => cambiar({ desde: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ra-hasta">Hasta</label>
              <input id="ra-hasta" type="date" value={f.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} />
            </div>
          </div>
        )}
        <p className="filtros-admin__total">
          {filtradas.length === reservas.length ? `${reservas.length} reservas` : `${filtradas.length} de ${reservas.length} reservas`}
        </p>
      </section>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {cargando && <Cargando texto="Cargando reservas…" />}

      {!cargando && filtradas.length === 0 && (
        <Empty icono="ticket" titulo="No hay reservas con ese filtro">
          Amplíe las fechas o cambie el estado.
        </Empty>
      )}

      {!cargando && filtradas.length > 0 && (
        <div className="lista-plana">
          {filtradas.map(({ r, est, t }) => {
            const vigente = !t.sinReclamar && est !== 'Finalizada' && est !== 'Cancelada'
            const enCurso = est === 'En curso' || est === 'Sin registrar llegada'
            const datosTitular = [r.tipo_usuario, r.programa, r.matricula].filter(Boolean).join(' · ')
            return (
              <article key={r.id} className="ronda abrible">
                <div className="ronda__equipo">
                  <strong>{r.equipos?.codigo}</strong>
                  <span className="tiny muted">{r.codigo_legible}</span>
                </div>
                <div className="ronda__estado">
                  <span className={`badge ${t.sinReclamar ? 'warn' : tonoEstado(est)}`}>{t.sinReclamar ? 'Sin reclamar' : est}</span>
                </div>
                <div className="ronda__detalle">
                  <Link className="ronda__abrir" to={`/admin/reservas/${r.id}`}>
                    <strong>{t.nombre}</strong>
                    <span className="sr-only"> · ver detalle de la reserva</span>
                  </Link>
                  <span className="tiny muted" style={{ wordBreak: 'break-all' }}>
                    {t.correo}
                    {datosTitular ? ` · ${datosTitular}` : ''}
                  </span>
                  <span className="tiny">
                    {fecha(r.inicio)} → {fecha(r.fin)} · {duracion(r.inicio, r.fin)}
                  </span>
                  {(r.actividad || r.docente) && (
                    <span className="tiny">
                      {r.actividad ?? 'Sin actividad'}
                      {r.docente && <> · Docente: <strong>{r.docente}</strong></>}
                    </span>
                  )}
                  {r.detalle && <span className="tiny muted ronda__nota">{r.detalle}</span>}
                  <span className="ronda__chips">
                    {r.llegada_en && <span className="badge ok">Llegó {hora(r.llegada_en)}</span>}
                    {r.liberada_en && <span className="badge gray">Liberada {hora(r.liberada_en)}</span>}
                    {r.desatendido && <span className="badge gray">Desatendido</span>}
                    {r.compartida && <span className="badge info">Compartida</span>}
                    {r.excepcion && <span className="badge outline">Larga</span>}
                    {r.extensiones > 0 && <span className="badge outline">Extendida ×{r.extensiones}</span>}
                    {r.clase_id && <span className="badge outline">Clase</span>}
                    {t.migrada && (
                      <span className="badge outline">{t.sinReclamar ? 'Migrada · el titular aún no entra a LADME' : 'Migrada'}</span>
                    )}
                    {r.funciono === false && <span className="badge danger">Reportó que no funcionó</span>}
                  </span>
                  {r.estado === 'cancelada' && r.motivo && <span className="tiny">Motivo: {r.motivo}</span>}
                </div>
                <div className="ronda__acciones">
                  {vigente && (
                    <>
                      {enCurso && !r.llegada_en && (
                        <button className="btn sm" type="button" onClick={() => setAccion({ tipo: 'llegada', reserva: r })}>
                          Llegó
                        </button>
                      )}
                      <button className="btn ghost sm" type="button" onClick={() => setAccion({ tipo: 'extender', reserva: r })}>
                        Extender
                      </button>
                      {enCurso && (
                        <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'liberar', reserva: r })}>
                          Liberar
                        </button>
                      )}
                      <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'cancelar', reserva: r })}>
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <AccionesReserva accion={accion} admin={esAdmin(perfil)} alCerrar={() => setAccion(null)} alTerminar={cargar} />
    </>
  )
}
