import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  anunciarFaro, canalFaro, codigoVinculoFaro, desbloquearFaro, desvincularFaro, empezarClaseFaro, generarClaveFaro, modoFaro, ordenFaro, textoOrden,
  panelFaro, quitarAnuncioFaro, terminarClaseFaro, type OrdenFaro,
  type EquipoFaro, type ModoFaro, type PanelFaro
} from '../../lib/api'
import { esAdmin, useAuth } from '../../context/AuthContext'
import { fecha, hace, hora } from '../../lib/format'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'
import FaroUso from './FaroUso'

const MODOS: Array<{ id: ModoFaro; texto: string; ayuda: string }> = [
  { id: 'observar', texto: 'Observar', ayuda: 'Solo muestra la isla y registra el uso sin reserva.' },
  { id: 'avisar', texto: 'Avisar', ayuda: 'Además insiste cuando alguien usa el equipo sin reserva.' },
  { id: 'bloquear', texto: 'Bloquear', ayuda: 'Pantalla de bloqueo cuando no hay reserva vigente.' }
]

const EVENTOS: Record<string, string> = {
  vinculado: 'Faro vinculado',
  desvinculado: 'Faro desvinculado',
  inicio: 'Faro se inició',
  uso_sin_reserva: 'Uso sin reserva',
  llegada_detectada: 'Llegada registrada por Faro',
  bloqueo: 'Pantalla bloqueada',
  desbloqueo: 'Pantalla desbloqueada',
  desbloqueo_personal: 'Desbloqueo del personal',
  desbloqueo_emergencia: 'Clave de emergencia usada',
  cierre_intentado: 'Intentaron cerrar el bloqueo',
  modo: 'Cambio de modo'
}

type Filtro = 'todos' | 'linea' | 'sin_senal' | 'sin_vincular' | 'sin_reserva'

const enLinea = (e: EquipoFaro) => !!e.ultimo_latido && Date.now() - new Date(e.ultimo_latido).getTime() < 2 * 60_000

function conexion(e: EquipoFaro): { texto: string; tono: string } {
  if (!e.vinculado) return { texto: 'Sin vincular', tono: 'gray' }
  if (enLinea(e)) return { texto: 'En línea', tono: 'ok' }
  if (!e.ultimo_latido) return { texto: 'Esperando primera señal', tono: 'warn' }
  return { texto: `Sin señal ${hace(e.ultimo_latido)}`, tono: 'warn' }
}

/** Faro: el agente que corre en cada PC de la sala. Vincular, elegir modo, desbloquear. */
export default function Faro() {
  const { perfil } = useAuth()
  const admin = esAdmin(perfil)
  const toast = useToast()
  const [panel, setPanel] = useState<PanelFaro | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ocupado, setOcupado] = useState(false)
  const [codigo, setCodigo] = useState<{ codigo: string; vence: string; equipo: string } | null>(null)
  const [confirmar, setConfirmar] = useState<{ titulo: string; texto: string; accion: () => Promise<void>; confirmar?: string; peligro?: boolean } | null>(null)
  const [clave, setClave] = useState<string | null>(null)
  const [, setTic] = useState(0)
  const [clase, setClase] = useState<{ motivo: string; minutos: number } | null>(null)
  const [anuncio, setAnuncio] = useState<{ texto: string; minutos: number } | null>(null)
  const [abiertoEquipo, setAbiertoEquipo] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setPanel(await panelFaro())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar Faro.')
    }
  }, [])

  useEffect(() => {
    void cargar()
    const t = window.setInterval(() => void cargar(), 20_000)
    const r = window.setInterval(() => setTic((n) => n + 1), 1000)
    return () => { window.clearInterval(t); window.clearInterval(r) }
  }, [cargar])

  const equipos = useMemo(() => panel?.equipos ?? [], [panel])
  const cuentas = useMemo(() => ({
    todos: equipos.length,
    linea: equipos.filter((e) => e.vinculado && enLinea(e)).length,
    sin_senal: equipos.filter((e) => e.vinculado && !enLinea(e)).length,
    sin_vincular: equipos.filter((e) => !e.vinculado).length,
    sin_reserva: equipos.filter((e) => e.usos_sin_reserva_7d > 0).length
  }), [equipos])
  const visibles = equipos.filter((e) =>
    filtro === 'todos' ? true
      : filtro === 'linea' ? e.vinculado && enLinea(e)
      : filtro === 'sin_senal' ? e.vinculado && !enLinea(e)
      : filtro === 'sin_vincular' ? !e.vinculado
      : e.usos_sin_reserva_7d > 0)
  const vinculados = equipos.filter((e) => e.vinculado)
  const modoComun = vinculados.length && vinculados.every((e) => e.modo === vinculados[0].modo) ? vinculados[0].modo : null

  async function hacer(accion: () => Promise<unknown>, ok?: string) {
    setOcupado(true)
    try {
      await accion()
      if (ok) toast.mostrar(ok)
      await cargar()
    } catch (e) {
      toast.mostrar(e instanceof Error ? e.message : 'No se pudo completar la acción.', 'warn')
    } finally {
      setOcupado(false)
    }
  }

  const NOMBRE_ORDEN: Record<OrdenFaro, string> = {
    reiniciar: 'Reiniciar Faro', actualizar: 'Actualizar ahora', apagar: 'Apagar el PC', encender: 'Encender el PC', desinstalar: 'Desinstalar Faro'
  }
  const AYUDA_ORDEN: Record<OrdenFaro, string> = {
    reiniciar: 'Faro se cierra y se vuelve a abrir en ese PC.',
    actualizar: 'Faro busca ya una versión nueva y la instala si no hay una reserva en curso.',
    apagar: 'El PC se apaga en un minuto (con aviso en pantalla). Los equipos con una reserva en curso se omiten.',
    encender: 'Un Faro encendido de la sala despierta al PC por la red (Wake-on-LAN). El PC debe tenerlo activado en la BIOS.',
    desinstalar: 'Faro se quita del PC: programa, arranque automático y configuración. El equipo queda desvinculado.'
  }
  function orden(equipos: string[] | null, o: OrdenFaro) {
    const donde = equipos ? equipos.join(', ') : 'toda la sala'
    setConfirmar({
      titulo: `${NOMBRE_ORDEN[o]} · ${donde}`,
      texto: AYUDA_ORDEN[o],
      accion: () => hacer(async () => {
        const { texto } = textoOrden(await ordenFaro(equipos, o))
        toast.mostrar(texto)
      })
    })
  }

  function cambiarTodos(m: ModoFaro) {
    const texto = MODOS.find((x) => x.id === m)!
    setConfirmar({
      titulo: `Poner todos los equipos en «${texto.texto}»`,
      texto: `${texto.ayuda} Aplica a los ${vinculados.length} equipos con Faro vinculado; cada PC lo toma en menos de un minuto.`,
      accion: () => hacer(() => modoFaro(null, m), `Todos los equipos en «${texto.texto}».`)
    })
  }

  if (error && !panel)
    return (
      <div className="alert danger">
        <Icon nombre="alerta" />
        <div className="alert__body">
          {error}
          {/faro_panel|function/.test(error) && ' ¿Ya ejecutó la migración 0006 en Supabase?'}
        </div>
      </div>
    )
  if (!panel) return <Cargando texto="Cargando Faro…" />

  return (
    <>
      <p className="admin-barra__texto">
        Faro muestra la reserva vigente en cada PC y, según el modo, avisa o bloquea el equipo si no hay reserva. Conviene empezar en «Observar».
      </p>

      <section className="faro-sala">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
          <div style={{ minWidth: 0 }}>
            <strong>Toda la sala</strong>
            <p className="tiny muted" style={{ margin: '2px 0 0' }}>
              {vinculados.length === 0 ? 'Aún no hay equipos vinculados.'
                : modoComun ? `Todos en «${MODOS.find((m) => m.id === modoComun)?.texto}».` : 'Hay equipos en modos distintos.'}
            </p>
          </div>
          <div className="chips" role="group" aria-label="Modo de toda la sala">
            {MODOS.map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={modoComun === m.id} title={m.ayuda}
                      disabled={ocupado || vinculados.length === 0} onClick={() => modoComun !== m.id && cambiarTodos(m.id)}>
                {m.texto}
              </button>
            ))}
          </div>
        </div>
        <div className="acciones-rapidas">
          <button className="accion-rapida" type="button" disabled={ocupado} onClick={() => setAnuncio({ texto: '', minutos: 60 })}>
            <Icon nombre="campana" /> <span>Anuncio</span>
          </button>
          <a className="accion-rapida" href="/sala?kiosco=1" target="_blank" rel="noreferrer">
            <Icon nombre="monitor" /> <span>Pantalla de la sala</span>
          </a>
          <button className="accion-rapida" type="button" disabled={ocupado} onClick={() => setClase({ motivo: '', minutos: 120 })}>
            <Icon nombre="usuarios" /> <span>Empezar clase</span>
          </button>
          <button className="accion-rapida" type="button" disabled={ocupado}
                  onClick={() => setConfirmar({
                    titulo: 'Terminar la clase en toda la sala',
                    texto: 'Los equipos de la clase vuelven a necesitar reserva: quien esté trabajando sin reserva puede quedar bloqueado según el modo de Faro. Úselo solo cuando la clase haya terminado.',
                    confirmar: 'Terminar clase',
                    peligro: true,
                    accion: () => hacer(async () => {
                      const n = await terminarClaseFaro(null)
                      toast.mostrar(n ? `Clase terminada en ${n} ${n === 1 ? 'equipo' : 'equipos'}.` : 'No hay clases en curso.')
                    })
                  })}>
            <Icon nombre="x" /> <span>Terminar clase</span>
          </button>
          <button className="accion-rapida" type="button" disabled={ocupado} onClick={() => orden(null, 'encender')}>
            <Icon nombre="chispa" /> <span>Encender</span>
          </button>
          <button className="accion-rapida" type="button" disabled={ocupado} onClick={() => orden(null, 'apagar')}>
            <Icon nombre="salir" /> <span>Apagar</span>
          </button>
          <button className="accion-rapida" type="button" disabled={ocupado} onClick={() => orden(null, 'actualizar')}>
            <Icon nombre="actualizar" /> <span>Actualizar Faro</span>
          </button>
          {admin && (
            <button className="accion-rapida" type="button" disabled={ocupado}
                    title={panel.clave_creada_en ? `Clave creada ${hace(panel.clave_creada_en)}` : 'Aún no se ha creado'}
                    onClick={() => setConfirmar({
                      titulo: panel.clave_creada_en ? 'Cambiar la clave de emergencia' : 'Crear la clave de emergencia',
                      texto: (panel.clave_creada_en
                        ? 'La clave anterior deja de servir en cuanto cada equipo se conecte. La nueva se muestra una sola vez.'
                        : 'La clave se muestra una sola vez: guárdela en un lugar seguro del laboratorio.') +
                        ' Desbloquea cualquier equipo por 2 horas aunque no haya internet, y cada uso avisa al personal.',
                      accion: () => hacer(async () => setClave(await generarClaveFaro()))
                    })}>
              <Icon nombre="clave" /> <span>{panel.clave_creada_en ? 'Clave' : 'Crear clave'}</span>
            </button>
          )}
        </div>
        {panel.anuncios.length > 0 && (
          <ul className="small" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {panel.anuncios.map((a) => (
              <li key={a.id} className="row between" style={{ gap: 'var(--s2)' }}>
                <span>«{a.texto}» <span className="muted">· {a.equipos ? a.equipos.join(', ') : 'toda la sala'} · hasta {hora(a.hasta)}</span></span>
                <button className="btn ghost sm" type="button" onClick={() => void hacer(() => quitarAnuncioFaro(a.id), 'Anuncio retirado.')}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="chips-desliza" role="group" aria-label="Filtrar equipos">
        {([
          ['todos', 'Todos'], ['linea', 'En línea'], ['sin_senal', 'Sin señal'],
          ['sin_vincular', 'Sin vincular'], ['sin_reserva', 'Uso sin reserva']
        ] as Array<[Filtro, string]>).map(([id, texto]) => (
          <button key={id} type="button" className="chip" aria-pressed={filtro === id} onClick={() => setFiltro(id)}>
            {texto}<span className="chip__n">{cuentas[id]}</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 && (
        <div className="card">
          <Empty icono="check-circulo" titulo="Nada por aquí">No hay equipos con ese filtro.</Empty>
        </div>
      )}

      <div className="faro-tiles">
        {visibles.map((e) => {
          const c = conexion(e)
          return (
            <button key={e.codigo} type="button" className={`faro-tile ${c.tono}`} onClick={() => setAbiertoEquipo(e.codigo)}
                    aria-label={`${e.codigo}: ${c.texto}`}>
              <span className="faro-tile__fila">
                <strong>{e.codigo}</strong>
                <span className={`punto ${c.tono}`} aria-hidden="true" />
              </span>
              <span className="tiny muted">{c.texto}</span>
              <span className="faro-tile__extra tiny">
                {!e.vinculado ? 'Toca para vincular'
                  : [MODOS.find((m) => m.id === e.modo)?.texto, enLinea(e) && e.cpu_pct != null ? `CPU ${e.cpu_pct}%` : null,
                     e.bloqueado && enLinea(e) ? 'bloqueado' : null, e.desbloqueo_hasta ? `libre ${hora(e.desbloqueo_hasta)}` : null]
                     .filter(Boolean).join(' · ')}
              </span>
              {e.usos_sin_reserva_7d > 0 && <span className="faro-tile__alerta" title="Usos sin reserva en 7 días">{e.usos_sin_reserva_7d}</span>}
            </button>
          )
        })}
      </div>

      {(() => {
        const e = panel.equipos.find((x) => x.codigo === abiertoEquipo)
        if (!e) return null
        const c = conexion(e)
        return (
          <Modal abierto titulo={e.codigo} onCerrar={() => setAbiertoEquipo(null)}>
            <div className="stack">
              <div className="row tight" style={{ flexWrap: 'wrap' }}>
                <span className={`badge ${c.tono}`}>{c.texto}</span>
                {e.vinculado && enLinea(e) && e.bloqueado && <span className="badge danger">Bloqueado ahora</span>}
                {e.desbloqueo_hasta && <span className="badge info">Libre hasta {hora(e.desbloqueo_hasta)}</span>}
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {e.vinculado
                  ? [e.host, e.so, e.version && `Faro ${e.version}`].filter(Boolean).join(' · ') || 'Sin datos del equipo todavía'
                  : [e.categoria, e.nombre].filter(Boolean).join(' · ')}
              </p>
              {e.usos_sin_reserva_7d > 0 && (
                <p className="tiny" style={{ margin: 0, color: 'var(--warn-700, #b45309)' }}>
                  Usado sin reserva {e.usos_sin_reserva_7d} {e.usos_sin_reserva_7d === 1 ? 'vez' : 'veces'} en 7 días
                </p>
              )}
              {!e.vinculado ? (
                <button className="btn" type="button" disabled={ocupado}
                        onClick={() => void hacer(async () => { setAbiertoEquipo(null); setCodigo(await codigoVinculoFaro(e.codigo)) })}>
                  Vincular Faro en este equipo
                </button>
              ) : (
                <>
                  <span className="field__label">Modo</span>
                  <div className="chips" role="group" aria-label={`Modo de ${e.codigo}`}>
                    {MODOS.map((m) => (
                      <button key={m.id} type="button" className="chip" aria-pressed={e.modo === m.id} disabled={ocupado} title={m.ayuda}
                              onClick={() => e.modo !== m.id && void hacer(() => modoFaro([e.codigo], m.id), `${e.codigo} en «${m.texto}».`)}>
                        {m.texto}
                      </button>
                    ))}
                  </div>
                  <span className="field__label">Dejar libre sin reserva</span>
                  <div className="row tight" style={{ flexWrap: 'wrap' }}>
                    {e.desbloqueo_hasta ? (
                      <button className="btn ghost sm" type="button" disabled={ocupado}
                              onClick={() => void hacer(() => desbloquearFaro(e.codigo, 0), 'Desbloqueo retirado.')}>
                        Quitar desbloqueo
                      </button>
                    ) : (
                      [30, 60, 240].map((min) => (
                        <button key={min} className="btn ghost sm" type="button" disabled={ocupado}
                                onClick={() => void hacer(() => desbloquearFaro(e.codigo, min), `${e.codigo} libre por ${min < 60 ? `${min} min` : `${min / 60} h`}.`)}>
                          {min < 60 ? `${min} min` : `${min / 60} h`}
                        </button>
                      ))
                    )}
                  </div>
                  <DetalleEquipo e={e} admin={admin} ocupado={ocupado} orden={orden}
                    canal={(cn) => void hacer(() => canalFaro([e.codigo], cn), `${e.codigo} en el canal ${cn}.`)} />
                  <button className="btn ghost sm" type="button" disabled={ocupado} style={{ justifySelf: 'start' }}
                          onClick={() => setConfirmar({
                            titulo: `Desvincular ${e.codigo}`,
                            texto: 'Faro dejará de funcionar en ese PC hasta que lo vincule de nuevo con otro código.',
                            accion: () => hacer(() => desvincularFaro(e.codigo), `${e.codigo} desvinculado.`)
                          })}>
                    Desvincular
                  </button>
                </>
              )}
            </div>
          </Modal>
        )
      })()}

      <details className="card tight plegable">
        <summary><strong>Uso de la sala</strong> <span className="tiny muted">horas de uso real por día y hora</span></summary>
        <FaroUso />
      </details>

      <section className="card tight">
        <strong>Actividad reciente</strong>
        {panel.eventos.length === 0 ? (
          <p className="small muted" style={{ margin: '4px 0 0' }}>Aquí aparecerán los bloqueos, desbloqueos y el uso sin reserva.</p>
        ) : (
          <ul className="small" style={{ margin: '8px 0 0', paddingLeft: '1rem', display: 'grid', gap: 4 }}>
            {panel.eventos.slice(0, 8).map((ev) => (
              <li key={ev.id}>
                <strong>{ev.equipo}</strong> · {EVENTOS[ev.tipo] ?? ev.tipo}
                {ev.tipo === 'modo' && typeof ev.detalle.modo === 'string' ? ` → ${ev.detalle.modo}` : ''}
                {ev.actor ? ` · ${ev.actor}` : ''}
                <span className="muted"> · {fecha(ev.creado_en)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link className="small" to="/admin?tab=registro&fuente=faro" style={{ display: 'inline-block', marginTop: 8 }}>
          Ver todo en Registro
        </Link>
      </section>

      <Modal abierto={!!codigo} titulo={`Vincular Faro en ${codigo?.equipo ?? ''}`} onCerrar={() => { setCodigo(null); void cargar() }}
             pie={<button className="btn" type="button" onClick={() => { setCodigo(null); void cargar() }}>Listo</button>}>
        <div className="stack" style={{ textAlign: 'center' }}>
          <p className="small muted" style={{ margin: 0 }}>
            En ese PC, abra Faro (se abre solo la primera vez) y escriba este código:
          </p>
          <div className="num" style={{ fontSize: '2.4rem', fontWeight: 800, letterSpacing: '0.14em', fontFamily: 'var(--mono)' }}>
            {codigo?.codigo}
          </div>
          {codigo && (
            <p className="tiny muted" style={{ margin: 0 }}>
              Vence a las {hora(codigo.vence)} · sirve una sola vez
            </p>
          )}
        </div>
      </Modal>

      <Modal abierto={!!clave} titulo="Nueva clave de emergencia" onCerrar={() => setClave(null)}
             pie={
               <>
                 <button className="btn gray" type="button"
                         onClick={() => clave && void navigator.clipboard?.writeText(clave).then(() => toast.mostrar('Clave copiada.'))}>
                   <Icon nombre="copiar" /> Copiar
                 </button>
                 <button className="btn" type="button" onClick={() => setClave(null)}>Ya la guardé</button>
               </>
             }>
        <div className="stack" style={{ textAlign: 'center' }}>
          <div className="num" style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.1em', fontFamily: 'var(--mono)' }}>{clave}</div>
          <p className="small muted" style={{ margin: 0 }}>
            No se volverá a mostrar. Guárdela donde solo el personal la vea; si se filtra, genere otra.
          </p>
        </div>
      </Modal>

      <Modal abierto={!!clase} titulo="Empezar una clase en la sala" onCerrar={() => setClase(null)}
             pie={
               <>
                 <button className="btn gray" type="button" onClick={() => setClase(null)}>Cancelar</button>
                 <button className="btn" type="button" disabled={ocupado || (clase?.motivo.trim().length ?? 0) < 3}
                         onClick={() => {
                           const c = clase
                           setClase(null)
                           if (c) void hacer(async () => {
                             const r = await empezarClaseFaro(null, c.minutos, c.motivo.trim())
                             toast.mostrar(`Clase hasta las ${hora(r.fin)} en ${r.equipos.length} equipos.` +
                               (r.omitidos.length ? ` Con reserva, se respetaron: ${r.omitidos.join(', ')}.` : ''))
                           })
                         }}>
                   Empezar
                 </button>
               </>
             }>
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="clase-motivo">Clase o actividad</label>
            <input id="clase-motivo" placeholder="Estadística I · grupo 2" maxLength={120}
                   value={clase?.motivo ?? ''} onChange={(e) => clase && setClase({ ...clase, motivo: e.target.value })} />
          </div>
          <div className="field">
            <span className="field__label">Duración</span>
            <div className="chips" role="group" aria-label="Duración">
              {[60, 90, 120, 180, 240].map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={clase?.minutos === m}
                        onClick={() => clase && setClase({ ...clase, minutos: m })}>
                  {m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`}
                </button>
              ))}
            </div>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Aplica a toda la sala. Al terminar, use «Terminar clase» o espere a que venza.</p>
        </div>
      </Modal>

      <Modal abierto={!!anuncio} titulo="Anuncio en las islas" onCerrar={() => setAnuncio(null)}
             pie={
               <>
                 <button className="btn gray" type="button" onClick={() => setAnuncio(null)}>Cancelar</button>
                 <button className="btn" type="button" disabled={ocupado || (anuncio?.texto.trim().length ?? 0) < 3}
                         onClick={() => {
                           const a = anuncio
                           setAnuncio(null)
                           if (a) void hacer(() => anunciarFaro(a.texto.trim(), a.minutos), 'Anuncio publicado en las islas.')
                         }}>
                   Publicar
                 </button>
               </>
             }>
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="anuncio-texto">Mensaje (máximo 160 caracteres)</label>
            <input id="anuncio-texto" maxLength={160} placeholder="La sala cierra hoy a las 5 p. m."
                   value={anuncio?.texto ?? ''} onChange={(ev) => anuncio && setAnuncio({ ...anuncio, texto: ev.target.value })} />
          </div>
          <div className="field">
            <span className="field__label">Visible durante</span>
            <div className="chips" role="group" aria-label="Duración">
              {[30, 60, 180, 480, 1440].map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={anuncio?.minutos === m}
                        onClick={() => anuncio && setAnuncio({ ...anuncio, minutos: m })}>
                  {m < 60 ? `${m} min` : m === 1440 ? 'Todo el día' : `${m / 60} h`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal abierto={!!confirmar} titulo={confirmar?.titulo ?? ''} onCerrar={() => setConfirmar(null)}
             pie={
               <>
                 <button className="btn gray" type="button" onClick={() => setConfirmar(null)}>Cancelar</button>
                 <button className={`btn ${confirmar?.peligro ? 'danger' : ''}`} type="button" disabled={ocupado}
                         onClick={() => { const a = confirmar?.accion; setConfirmar(null); void a?.() }}>
                   {confirmar?.confirmar ?? 'Confirmar'}
                 </button>
               </>
             }>
        <p className="small" style={{ margin: 0 }}>{confirmar?.texto}</p>
      </Modal>
    </>
  )
}

/** Inventario que informa Faro, canal de actualizaciones y órdenes remotas de un equipo. */
function DetalleEquipo({ e, admin, ocupado, orden, canal }: {
  e: EquipoFaro
  admin: boolean
  ocupado: boolean
  orden: (equipos: string[] | null, o: OrdenFaro) => void
  canal: (c: 'estable' | 'pruebas') => void
}) {
  const inv = e.inventario
  const libre = inv?.disco_gb && inv.disco_libre_gb !== undefined ? Math.round((inv.disco_libre_gb / inv.disco_gb) * 100) : null
  return (
    <div className="faro-detalle">
      {inv ? (
        <dl className="faro-detalle__datos small">
          {inv.cpu && <><dt>Procesador</dt><dd>{inv.cpu}{inv.nucleos ? ` · ${inv.nucleos} núcleos` : ''}</dd></>}
          {inv.ram_gb !== undefined && <><dt>Memoria</dt><dd>{inv.ram_gb} GB</dd></>}
          {inv.disco_gb !== undefined && (
            <><dt>Disco</dt><dd className={libre !== null && libre < 10 ? 'faro-detalle__alerta' : undefined}>
              {inv.disco_libre_gb} GB libres de {inv.disco_gb} GB{libre !== null ? ` (${libre} %)` : ''}
            </dd></>
          )}
          {e.cpu_pct !== null && <><dt>Uso del procesador</dt><dd>{e.cpu_pct} %</dd></>}
          {inv.arranque_h !== undefined && <><dt>Encendido hace</dt><dd>{inv.arranque_h < 48 ? `${inv.arranque_h} h` : `${Math.round(inv.arranque_h / 24)} días`}</dd></>}
          {inv.mac && <><dt>MAC</dt><dd className="num">{inv.mac}</dd></>}
          <dt>Software</dt>
          <dd>{(inv.software ?? []).length ? (inv.software ?? []).join(' · ') : 'Ninguno de la lista conocida'}</dd>
        </dl>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Faro 0.4 o superior informa el inventario del equipo unas horas después de vincularse.</p>
      )}
      <div className="row tight" style={{ flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
        <span className="small muted">Canal:</span>
        {(['estable', 'pruebas'] as const).map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={e.canal === c} disabled={ocupado} onClick={() => e.canal !== c && canal(c)}>
            {c === 'estable' ? 'Estable' : 'Pruebas'}
          </button>
        ))}
      </div>
      <div className="row tight" style={{ flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
        {(['reiniciar', 'actualizar', 'apagar', 'encender'] as OrdenFaro[]).map((o) => (
          <button key={o} type="button" className="btn ghost sm" disabled={ocupado} onClick={() => orden([e.codigo], o)}>
            {o === 'reiniciar' ? 'Reiniciar Faro' : o === 'actualizar' ? 'Actualizar' : o === 'apagar' ? 'Apagar' : 'Encender'}
          </button>
        ))}
        {admin && (
          <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => orden([e.codigo], 'desinstalar')}
                  style={{ color: 'var(--danger-600, #dc2626)' }}>
            Desinstalar Faro
          </button>
        )}
        {e.comandos_pendientes > 0 && <span className="tiny muted">{e.comandos_pendientes} orden(es) en camino</span>}
      </div>
    </div>
  )
}
