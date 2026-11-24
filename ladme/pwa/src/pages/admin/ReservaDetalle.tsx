import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { reservaDetalle, type CambioHistorial, type DetalleReserva } from '../../lib/api'
import { fotoEquipo, type Reserva } from '../../lib/types'
import { duracion, estadoReserva, fecha, hace, hora, rango, tonoEstado } from '../../lib/format'
import { useLimites } from '../../lib/politicas'
import { esAdmin, useAuth } from '../../context/AuthContext'
import PageHeader, { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import AccionesReserva, { type Accion } from './AccionesReserva'
import { ESTADO_SOFTWARE } from '../../components/Software'

type Tono = 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'gray'
interface Hito {
  en: string
  texto: ReactNode
  quien?: string | null
  tono: Tono
  fuente: 'Reserva' | 'Faro' | 'Inasistencia' | 'Software' | 'Falla'
}

const TEXTO_FARO: Record<string, string> = {
  vinculado: 'Faro vinculado',
  desvinculado: 'Faro desvinculado',
  uso_sin_reserva: 'Uso sin reserva detectado',
  llegada_detectada: 'Faro detectó la llegada',
  llegada_qr: 'Llegada confirmada con el código de Faro',
  bloqueo: 'Pantalla bloqueada',
  desbloqueo: 'Pantalla desbloqueada',
  desbloqueo_personal: 'Desbloqueo por el personal',
  desbloqueo_emergencia: 'Se usó la clave de emergencia',
  cierre_intentado: 'Intentaron cerrar Faro',
  modo: 'Cambió el modo de Faro',
  comando: 'Orden remota',
  retirado: 'Faro retirado del equipo'
}

const fechaCorta = (v: unknown) => (typeof v === 'string' && v ? fecha(v) : '—')

/** Cada cambio del historial en palabras. */
function textoCambio(c: CambioHistorial): string | null {
  switch (c.campo) {
    case 'llegada_en':
      return c.despues ? `Llegada registrada (${fechaCorta(c.despues)})` : 'Se quitó la llegada'
    case 'fin':
      return `Fin: ${fechaCorta(c.antes)} → ${fechaCorta(c.despues)}`
    case 'inicio':
      return `Inicio: ${fechaCorta(c.antes)} → ${fechaCorta(c.despues)}`
    case 'compartida':
      return c.despues ? 'Marcada como uso compartido' : 'Dejó de ser compartida'
    case 'protegidos':
      return 'Cambió los programas protegidos'
    case 'funciono':
      return c.despues === true ? 'Calificó el equipo: funcionó bien' : c.despues === false ? 'Calificó el equipo: no funcionó' : null
    case 'desatendido':
      return c.despues ? 'Marcada como proceso desatendido' : 'Dejó de ser proceso desatendido'
    case 'mensaje_llegada':
      return c.despues ? `Mensaje para quien llegue: «${String(c.despues)}»` : 'Quitó el mensaje para quien llegue'
    case 'equipo_id':
      return 'Cambió de equipo'
    case 'usuario_id':
      return 'Pasó a la cuenta de su titular'
    case 'tipo':
      return c.despues === 'reserva' ? 'El titular reclamó la reserva migrada' : null
    case 'docente':
      return `Docente: ${String(c.despues ?? '—')}`
    case 'motivo':
      return null
    default:
      return null
  }
}

function hitosDe(d: DetalleReserva): Hito[] {
  const r = d.reserva
  const hitos: Hito[] = []
  for (const h of d.historial) {
    const por = h.actor && !h.actor_es_titular ? h.actor : null
    if (h.accion === 'creada') {
      hitos.push({ en: h.en, fuente: 'Reserva', tono: 'brand', quien: por, texto: por ? `Reserva creada por ${por}` : 'Reserva creada' })
    } else if (h.accion === 'extendida') {
      const fin = h.cambios.find((c) => c.campo === 'fin')
      hitos.push({ en: h.en, fuente: 'Reserva', tono: 'info', quien: h.actor, texto: fin ? `Extendida: ${textoCambio(fin)}` : 'Extendida' })
    } else if (h.accion === 'liberada') {
      hitos.push({ en: h.en, fuente: 'Reserva', tono: 'gray', quien: h.actor, texto: 'Equipo liberado' })
    } else if (h.accion === 'cancelada') {
      hitos.push({
        en: h.en,
        fuente: 'Reserva',
        tono: 'danger',
        quien: h.actor,
        texto: h.actor_es_titular ? 'Cancelada por el titular' : `Cancelada${r.motivo ? ` · ${r.motivo}` : ''}`
      })
    } else {
      const textos = h.cambios.map(textoCambio).filter((x): x is string => !!x)
      if (!textos.length) continue
      const llegada = h.cambios.some((c) => c.campo === 'llegada_en' && c.despues)
      hitos.push({ en: h.en, fuente: 'Reserva', tono: llegada ? 'ok' : 'gray', quien: h.actor, texto: textos.join(' · ') })
    }
  }
  for (const e of d.faro) {
    const extra = ['modo', 'orden', 'motivo'].map((k) => e.detalle?.[k]).find((x) => typeof x === 'string') as string | undefined
    hitos.push({
      en: e.en,
      fuente: 'Faro',
      tono: e.tipo.startsWith('llegada') ? 'ok' : e.tipo === 'desbloqueo_emergencia' || e.tipo === 'cierre_intentado' ? 'warn' : 'gray',
      quien: e.actor,
      texto: `${TEXTO_FARO[e.tipo] ?? e.tipo}${extra ? ` · ${extra}` : ''}`
    })
  }
  if (d.inasistencia) {
    const i = d.inasistencia
    hitos.push({
      en: i.creado_en,
      fuente: 'Inasistencia',
      tono: 'warn',
      texto: `Inasistencia n.º ${i.numero}${i.sancion_hasta ? ` · sin reservar hasta ${fecha(i.sancion_hasta)}` : ' · solo advertencia'}`
    })
    if (i.apelada_en) hitos.push({ en: i.apelada_en, fuente: 'Inasistencia', tono: 'info', texto: 'El titular apeló la inasistencia' })
    if (i.resuelto_en)
      hitos.push({
        en: i.resuelto_en,
        fuente: 'Inasistencia',
        tono: i.estado === 'anulada' ? 'ok' : 'gray',
        texto: i.estado === 'anulada' ? 'Inasistencia anulada' : 'Apelación no aceptada'
      })
  }
  for (const s of d.software) hitos.push({ en: s.creado_en, fuente: 'Software', tono: 'info', texto: `Pidió instalar ${s.software}` })
  for (const f of d.fallas) hitos.push({ en: f.creado_en, fuente: 'Falla', tono: 'danger', texto: `Reportó una falla: ${f.categoria}` })
  return hitos.sort((a, b) => a.en.localeCompare(b.en))
}

function Dato({ t, children, ancho }: { t: string; children: ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'detalle-datos__ancho' : undefined}>
      <dt>{t}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Todo sobre una reserva, en su propia página del panel. */
export default function ReservaDetalle() {
  const { id } = useParams()
  const { perfil } = useAuth()
  const lim = useLimites()
  const [d, setD] = useState<DetalleReserva | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)

  const cargar = useCallback(() => {
    if (!id) return
    reservaDetalle(id)
      .then((x) => {
        setD(x)
        setError(null)
      })
      .catch((e: unknown) => {
        setD(null)
        setError(e instanceof Error ? e.message : 'No se pudo cargar la reserva.')
      })
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  const hitos = useMemo(() => (d ? hitosDe(d) : []), [d])

  if (d === undefined) return <Cargando texto="Cargando la reserva…" />
  if (!d)
    return (
      <div className="stack">
        <PageHeader volver={{ a: '/admin?tab=reservas', texto: 'Reservas' }} titulo="Reserva" />
        <div className="card">
          <Empty icono="buscar" titulo="No se encontró la reserva">
            {error ?? 'Puede que el enlace esté incompleto.'}
          </Empty>
        </div>
      </div>
    )

  const r = d.reserva
  const imp = d.importada
  const sinReclamar = !!imp && r.tipo === 'bloqueo'
  const est = estadoReserva(r, lim.toleranciaMin)
  const vigente = !sinReclamar && est !== 'Finalizada' && est !== 'Cancelada'
  const enCurso = est === 'En curso' || est === 'Sin registrar llegada'
  const nombre = (sinReclamar ? imp?.nombre : d.titular?.nombre) ?? '—'
  const correo = (sinReclamar ? imp?.correo : d.titular?.correo) ?? ''
  const conDatos: Reserva = {
    ...r,
    equipos: d.equipo ? { codigo: d.equipo.codigo, nombre: d.equipo.nombre, ubicacion: d.equipo.ubicacion } : null,
    perfiles: { nombre, correo, programa: r.programa }
  }
  const minutosTarde = r.llegada_en ? Math.round((new Date(r.llegada_en).getTime() - new Date(r.inicio).getTime()) / 60000) : null
  const finUso = r.liberada_en ?? (est === 'Finalizada' ? r.fin : null)
  const desdeUso = r.llegada_en && r.llegada_en < r.inicio ? r.inicio : r.llegada_en
  const usoReal = desdeUso ? duracion(desdeUso, finUso ?? new Date().toISOString()) : null
  const perfilCambio =
    d.titular && !sinReclamar && (d.titular.programa !== r.programa || (d.titular.matricula ?? null) !== (r.matricula ?? null))

  return (
    <div className="stack reserva-detalle">
      <PageHeader
        volver={{ a: '/admin?tab=reservas', texto: 'Reservas' }}
        titulo={`${d.equipo?.codigo ?? 'Equipo'} · ${nombre}`}
        sub={
          <span className="row tight" style={{ flexWrap: 'wrap' }}>
            <span className={`badge ${sinReclamar ? 'warn' : tonoEstado(est)}`}>{sinReclamar ? 'Migrada · sin reclamar' : est}</span>
            <span>{rango(r.inicio, r.fin)}</span>
            <span className="muted num">{r.codigo_legible}</span>
          </span>
        }
        acciones={
          <div className="row tight" style={{ flexWrap: 'wrap' }}>
            {vigente && enCurso && !r.llegada_en && (
              <button className="btn ok sm" type="button" onClick={() => setAccion({ tipo: 'llegada', reserva: conDatos })}>
                Llegó
              </button>
            )}
            {vigente && (
              <button className="btn ghost sm" type="button" onClick={() => setAccion({ tipo: 'extender', reserva: conDatos })}>
                Extender
              </button>
            )}
            {vigente && enCurso && (
              <button className="btn gray sm" type="button" onClick={() => setAccion({ tipo: 'liberar', reserva: conDatos })}>
                Liberar
              </button>
            )}
            {vigente && (
              <button className="btn danger sm" type="button" onClick={() => setAccion({ tipo: 'cancelar', reserva: conDatos })}>
                Cancelar
              </button>
            )}
            {!sinReclamar && (
              <Link className="btn ghost sm" to={`/credencial/${r.id}`}>
                <Icon nombre="qr" width={16} height={16} /> Credencial
              </Link>
            )}
          </div>
        }
      />

      <div className="stats">
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="reloj" width={14} height={14} /> Reservado
          </div>
          <div className="stat__value">{duracion(r.inicio, r.fin)}</div>
        </div>
        <div className={`stat ${r.llegada_en ? 'ok' : est === 'Sin registrar llegada' ? 'warn' : ''}`}>
          <div className="stat__label">
            <Icon nombre="check" width={14} height={14} /> Llegada
          </div>
          <div className="stat__value">
            {r.llegada_en ? hora(r.llegada_en) : est === 'Programada' ? '—' : 'Sin registrar'}
            {minutosTarde !== null && minutosTarde > 0 && <small> +{minutosTarde} min</small>}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">
            <Icon nombre="grafica" width={14} height={14} /> Uso real
          </div>
          <div className="stat__value">
            {usoReal ?? '—'}
            {usoReal && !finUso && <small> hasta ahora</small>}
          </div>
        </div>
        <div className={`stat ${r.extensiones ? 'brand' : ''}`}>
          <div className="stat__label">
            <Icon nombre="actualizar" width={14} height={14} /> Extensiones
          </div>
          <div className="stat__value">{r.extensiones}</div>
        </div>
      </div>

      <div className="dos-columnas">
        <div className="stack">
          <section className="card">
            <h2 className="detalle-t">Uso</h2>
            <dl className="detalle-datos">
              <Dato t="Actividad">{r.actividad ?? 'Sin especificar'}</Dato>
              <Dato t="Docente responsable">{r.docente ?? <span className="muted">—</span>}</Dato>
              <Dato t="Creada">
                {fecha(r.creado_en)}
                <span className="tiny muted">{hace(r.creado_en)}</span>
              </Dato>
              <Dato t="Proceso desatendido">{r.desatendido ? 'Sí' : 'No'}</Dato>
              {r.detalle && (
                <Dato t="Detalle" ancho>
                  <span className="detalle-texto">{r.detalle}</span>
                </Dato>
              )}
              {r.desatendido && r.mensaje_llegada && (
                <Dato t="Mensaje para quien llegue" ancho>
                  «{r.mensaje_llegada}»
                </Dato>
              )}
              {r.compartida && (
                <Dato t="Uso compartido" ancho>
                  Sí{r.protegidos?.length ? ` · no cerrar: ${r.protegidos.join(', ')}` : ''}
                </Dato>
              )}
              {r.liberada_en && <Dato t="Liberada">{fecha(r.liberada_en)}</Dato>}
              {r.estado === 'cancelada' && (
                <Dato t="Cancelada" ancho>
                  {r.cancelada_en ? fecha(r.cancelada_en) : 'Sí'}
                  {r.motivo && <span className="small">Motivo: {r.motivo}</span>}
                </Dato>
              )}
              {r.funciono !== null && r.funciono !== undefined && (
                <Dato t="¿Funcionó el equipo?">{r.funciono ? 'Sí' : <span style={{ color: 'var(--danger)' }}>No</span>}</Dato>
              )}
            </dl>
          </section>

          {(d.solicitud_larga || d.clase || imp) && (
            <section className="card">
              <h2 className="detalle-t">Origen</h2>
              <dl className="detalle-datos">
                {d.solicitud_larga && (
                  <>
                    <Dato t="Reserva larga" ancho>
                      <span className="detalle-texto">{d.solicitud_larga.justificacion}</span>
                      <span className="tiny muted">Pedida {fecha(d.solicitud_larga.creado_en)}</span>
                    </Dato>
                    <Dato t="Aprobada por">
                      {d.solicitud_larga.resuelto_por ?? '—'}
                      {d.solicitud_larga.resuelto_en && <span className="tiny muted">{fecha(d.solicitud_larga.resuelto_en)}</span>}
                    </Dato>
                    {d.solicitud_larga.respuesta && (
                      <Dato t="Respuesta" ancho>
                        {d.solicitud_larga.respuesta}
                      </Dato>
                    )}
                  </>
                )}
                {d.clase && (
                  <Dato t="Clase" ancho>
                    <Link to={`/admin/clases/${d.clase.id}`}>
                      {d.clase.nombre} · grupo {d.clase.grupo}
                    </Link>
                    <span className="tiny muted">Docente: {d.clase.docente}</span>
                  </Dato>
                )}
                {imp && (
                  <>
                    <Dato t="Migrada del sistema anterior">
                      {imp.nombre ?? '—'}
                      {imp.correo && <span className="tiny muted">{imp.correo}</span>}
                    </Dato>
                    <Dato t="Reclamada">
                      {imp.reclamada_en ? fecha(imp.reclamada_en) : <span style={{ color: 'var(--warn)' }}>Todavía no: el titular no ha entrado</span>}
                    </Dato>
                  </>
                )}
              </dl>
            </section>
          )}

          <section className="card">
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <h2 className="detalle-t">Línea de tiempo</h2>
              <span className="tiny muted">{hitos.length} eventos</span>
            </div>
            {hitos.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                Sin eventos registrados.
              </p>
            ) : (
              <ol className="linea">
                {hitos.map((h, i) => (
                  <li key={`${h.en}-${i}`}>
                    <span className={`linea__punto ${h.tono}`} aria-hidden="true" />
                    <div className="linea__cuerpo">
                      <span className="linea__texto">{h.texto}</span>
                      <span className="linea__meta">
                        <span className="num">{fecha(h.en)}</span> · {h.fuente}
                        {h.quien && <> · {h.quien}</>}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2 className="detalle-t">Titular</h2>
            <div className="detalle-persona">
              <span className="detalle-persona__ini" aria-hidden="true">
                {nombre
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join('')
                  .toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>{nombre}</strong>
                {correo && (
                  <a className="small detalle-correo" href={`mailto:${correo}`}>
                    {correo}
                  </a>
                )}
              </div>
            </div>
            <dl className="detalle-datos">
              <Dato t="Tipo de usuario">
                {r.tipo_usuario ?? d.titular?.tipo_usuario ?? '—'}
                {d.titular?.docente_verificado_en && <span className="tiny" style={{ color: 'var(--ok)' }}>Docente verificado</span>}
              </Dato>
              <Dato t="Matrícula">{r.matricula ?? '—'}</Dato>
              <Dato t="Programa" ancho>
                {r.programa ?? '—'}
              </Dato>
              {!sinReclamar && d.titular && (
                <>
                  <Dato t="Reservas en total">{d.titular.reservas}</Dato>
                  <Dato t="Inasistencias vigentes">
                    <span style={d.titular.inasistencias ? { color: 'var(--warn)' } : undefined}>{d.titular.inasistencias}</span>
                  </Dato>
                  <Dato t="Cuenta">
                    {d.titular.activo ? 'Activa' : <span style={{ color: 'var(--danger)' }}>Inhabilitada</span>}
                    <span className="tiny muted">desde {fecha(d.titular.creado_en)}</span>
                  </Dato>
                  <Dato t="Rol">{d.titular.rol}</Dato>
                </>
              )}
            </dl>
            {perfilCambio && (
              <p className="tiny muted" style={{ margin: 'var(--s2) 0 0' }}>
                Programa y matrícula son los que tenía al reservar. Hoy su perfil dice: {d.titular?.programa ?? '—'}
                {d.titular?.matricula ? ` · ${d.titular.matricula}` : ''}.
              </p>
            )}
          </section>

          {d.equipo && (
            <section className="card">
              <h2 className="detalle-t">Equipo</h2>
              <img className="detalle-foto" src={fotoEquipo(d.equipo.foto_url)} alt={d.equipo.foto_url ? `Foto de ${d.equipo.codigo}` : ''} loading="lazy" />
              <dl className="detalle-datos">
                <Dato t="Código">
                  <Link to={`/equipo/${d.equipo.codigo}`}>{d.equipo.codigo}</Link>
                </Dato>
                <Dato t="Ubicación">{d.equipo.ubicacion ?? 'LADME'}</Dato>
                <Dato t="Equipo" ancho>
                  {[d.equipo.marca, d.equipo.modelo].filter(Boolean).join(' ') || d.equipo.nombre}
                  {d.equipo.sistema_operativo && (
                    <span className="tiny muted">
                      {d.equipo.sistema_operativo}
                      {d.equipo.so_version ? ` ${d.equipo.so_version}` : ''}
                    </span>
                  )}
                </Dato>
                {d.equipo.estado !== 'activo' && <Dato t="Estado del equipo">{d.equipo.estado.replace(/_/g, ' ')}</Dato>}
              </dl>
            </section>
          )}

          {d.inasistencia && (
            <section className="card warn">
              <h2 className="detalle-t">Inasistencia</h2>
              <dl className="detalle-datos">
                <Dato t="Número">{d.inasistencia.numero}</Dato>
                <Dato t="Estado">{d.inasistencia.estado === 'anulada' ? 'Anulada' : 'Vigente'}</Dato>
                <Dato t="Sanción" ancho>
                  {d.inasistencia.sancion_hasta ? `Sin reservar hasta ${fecha(d.inasistencia.sancion_hasta)}` : 'Solo advertencia'}
                </Dato>
                {d.inasistencia.apelacion && (
                  <Dato t="Apelación" ancho>
                    <span className="detalle-texto">{d.inasistencia.apelacion}</span>
                  </Dato>
                )}
                {d.inasistencia.respuesta && (
                  <Dato t="Respuesta" ancho>
                    {d.inasistencia.respuesta}
                  </Dato>
                )}
              </dl>
            </section>
          )}

          {d.software.length > 0 && (
            <section className="card">
              <h2 className="detalle-t">Software pedido</h2>
              <ul className="detalle-lista">
                {d.software.map((s) => (
                  <li key={s.id}>
                    <span>
                      <strong>{s.software}</strong>
                      {s.version ? ` ${s.version}` : ''}
                    </span>
                    <span className={`badge ${ESTADO_SOFTWARE[s.estado as keyof typeof ESTADO_SOFTWARE]?.tono ?? 'gray'}`}>{ESTADO_SOFTWARE[s.estado as keyof typeof ESTADO_SOFTWARE]?.texto ?? s.estado}</span>
                  </li>
                ))}
              </ul>
              <Link className="small" to="/admin?tab=software">
                Ver solicitudes de software
              </Link>
            </section>
          )}

          {d.fallas.length > 0 && (
            <section className="card">
              <h2 className="detalle-t">Fallas que reportó</h2>
              <ul className="detalle-lista">
                {d.fallas.map((f) => (
                  <li key={f.id} className="detalle-lista__bloque">
                    <span className="row between">
                      <strong>{f.categoria}</strong>
                      <span className="badge outline">{f.estado.replace(/_/g, ' ')}</span>
                    </span>
                    <span className="small">{f.descripcion}</span>
                    {f.respuesta && <span className="tiny muted">Respuesta: {f.respuesta}</span>}
                  </li>
                ))}
              </ul>
              <Link className="small" to="/admin?tab=reportes">
                Ver fallas
              </Link>
            </section>
          )}
        </aside>
      </div>

      <AccionesReserva accion={accion} admin={esAdmin(perfil)} alCerrar={() => setAccion(null)} alTerminar={cargar} />
    </div>
  )
}
