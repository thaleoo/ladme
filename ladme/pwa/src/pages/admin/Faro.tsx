import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  codigoVinculoFaro, desbloquearFaro, desvincularFaro, empezarClaseFaro, generarClaveFaro, modoFaro, panelFaro, terminarClaseFaro,
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
  const [confirmar, setConfirmar] = useState<{ titulo: string; texto: string; accion: () => Promise<void> } | null>(null)
  const [clave, setClave] = useState<string | null>(null)
  const [, setTic] = useState(0)
  const [clase, setClase] = useState<{ motivo: string; minutos: number } | null>(null)

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
      <p className="small muted" style={{ margin: 0 }}>
        Faro corre en cada PC de la sala: muestra la reserva vigente en una isla arriba de la pantalla y, según el modo,
        avisa o bloquea el equipo cuando no hay reserva. Se recomienda empezar en «Observar» y subir de fase con los datos.
      </p>

      <section className="card tight">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
          <div>
            <strong>Modo de toda la sala</strong>
            <p className="tiny muted" style={{ margin: '2px 0 0' }}>
              {vinculados.length === 0 ? 'Aún no hay equipos vinculados.'
                : modoComun ? `Todos en «${MODOS.find((m) => m.id === modoComun)?.texto}».` : 'Hay equipos en modos distintos.'}
            </p>
          </div>
          <div className="chips" role="group" aria-label="Modo de toda la sala">
            {MODOS.map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={modoComun === m.id}
                      disabled={ocupado || vinculados.length === 0} onClick={() => modoComun !== m.id && cambiarTodos(m.id)}>
                {m.texto}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card tight">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
          <div style={{ minWidth: 0 }}>
            <strong className="row tight"><Icon nombre="usuarios" /> Modo clase</strong>
            <p className="tiny muted" style={{ margin: '2px 0 0' }}>
              Bloquea los equipos para reservas durante la clase y los deja libres para usar sin reserva. Los equipos que ya
              tienen una reserva en ese horario se respetan.
            </p>
          </div>
          <div className="row tight">
            <button className="btn ghost sm" type="button" disabled={ocupado}
                    onClick={() => void hacer(async () => {
                      const n = await terminarClaseFaro(null)
                      toast.mostrar(n ? `Clase terminada en ${n} ${n === 1 ? 'equipo' : 'equipos'}.` : 'No hay clases en curso.')
                    })}>
              Terminar clase
            </button>
            <button className="btn sm" type="button" disabled={ocupado} onClick={() => setClase({ motivo: '', minutos: 120 })}>
              Empezar clase
            </button>
          </div>
        </div>
      </section>

      <FaroUso />

      {admin && (
        <section className="card tight">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
            <div style={{ minWidth: 0 }}>
              <strong className="row tight"><Icon nombre="clave" /> Clave de emergencia</strong>
              <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                Desbloquea cualquier equipo por 2 horas aunque no haya internet. Cada uso avisa al personal.{' '}
                {panel.clave_creada_en ? `Creada ${hace(panel.clave_creada_en)}.` : 'Aún no se ha creado.'}
              </p>
            </div>
            <button className="btn ghost sm" type="button" disabled={ocupado}
                    onClick={() => setConfirmar({
                      titulo: panel.clave_creada_en ? 'Cambiar la clave de emergencia' : 'Crear la clave de emergencia',
                      texto: panel.clave_creada_en
                        ? 'La clave anterior deja de servir en cuanto cada equipo se conecte. La nueva se muestra una sola vez.'
                        : 'La clave se muestra una sola vez: guárdela en un lugar seguro del laboratorio.',
                      accion: () => hacer(async () => setClave(await generarClaveFaro()))
                    })}>
              {panel.clave_creada_en ? 'Cambiar clave' : 'Crear clave'}
            </button>
          </div>
        </section>
      )}

      <div className="chips" role="group" aria-label="Filtrar equipos">
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

      <div className="grid cols-2">
        {visibles.map((e) => {
          const c = conexion(e)
          return (
            <article key={e.codigo} className="card tight">
              <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row tight" style={{ flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 'var(--text-lg)' }}>{e.codigo}</strong>
                    <span className={`badge ${c.tono}`}>{c.texto}</span>
                    {e.vinculado && enLinea(e) && e.bloqueado && <span className="badge danger">Bloqueado ahora</span>}
                    {e.desbloqueo_hasta && <span className="badge info">Libre hasta {hora(e.desbloqueo_hasta)}</span>}
                  </div>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    {e.vinculado
                      ? [e.host, e.so, e.version && `Faro ${e.version}`].filter(Boolean).join(' · ') || 'Sin datos del equipo todavía'
                      : [e.categoria, e.nombre].filter(Boolean).join(' · ')}
                  </p>
                  {e.usos_sin_reserva_7d > 0 && (
                    <p className="tiny" style={{ margin: '4px 0 0', color: 'var(--warn-700, #b45309)' }}>
                      Usado sin reserva {e.usos_sin_reserva_7d} {e.usos_sin_reserva_7d === 1 ? 'vez' : 'veces'} en 7 días
                    </p>
                  )}
                </div>
                {!e.vinculado && (
                  <button className="btn sm" type="button" disabled={ocupado}
                          onClick={() => void hacer(async () => setCodigo(await codigoVinculoFaro(e.codigo)))}>
                    Vincular
                  </button>
                )}
              </div>

              {e.vinculado && (
                <div className="stack mt" style={{ gap: 'var(--s2)' }}>
                  <div className="chips" role="group" aria-label={`Modo de ${e.codigo}`}>
                    {MODOS.map((m) => (
                      <button key={m.id} type="button" className="chip" aria-pressed={e.modo === m.id} disabled={ocupado} title={m.ayuda}
                              onClick={() => e.modo !== m.id && void hacer(() => modoFaro([e.codigo], m.id), `${e.codigo} en «${m.texto}».`)}>
                        {m.texto}
                      </button>
                    ))}
                  </div>
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
                          Libre {min < 60 ? `${min} min` : `${min / 60} h`}
                        </button>
                      ))
                    )}
                    <button className="btn ghost sm" type="button" disabled={ocupado} style={{ marginLeft: 'auto' }}
                            onClick={() => setConfirmar({
                              titulo: `Desvincular ${e.codigo}`,
                              texto: 'Faro dejará de funcionar en ese PC hasta que lo vincule de nuevo con otro código.',
                              accion: () => hacer(() => desvincularFaro(e.codigo), `${e.codigo} desvinculado.`)
                            })}>
                      Desvincular
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <section className="card tight">
        <strong>Actividad reciente</strong>
        {panel.eventos.length === 0 ? (
          <p className="small muted" style={{ margin: '4px 0 0' }}>Aquí aparecerán los bloqueos, desbloqueos y el uso sin reserva.</p>
        ) : (
          <ul className="small" style={{ margin: '8px 0 0', paddingLeft: '1rem', display: 'grid', gap: 4 }}>
            {panel.eventos.map((ev) => (
              <li key={ev.id}>
                <strong>{ev.equipo}</strong> · {EVENTOS[ev.tipo] ?? ev.tipo}
                {ev.tipo === 'modo' && typeof ev.detalle.modo === 'string' ? ` → ${ev.detalle.modo}` : ''}
                {ev.actor ? ` · ${ev.actor}` : ''}
                <span className="muted"> · {fecha(ev.creado_en)}</span>
              </li>
            ))}
          </ul>
        )}
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

      <Modal abierto={!!confirmar} titulo={confirmar?.titulo ?? ''} onCerrar={() => setConfirmar(null)}
             pie={
               <>
                 <button className="btn gray" type="button" onClick={() => setConfirmar(null)}>Cancelar</button>
                 <button className="btn" type="button" disabled={ocupado}
                         onClick={() => { const a = confirmar?.accion; setConfirmar(null); void a?.() }}>
                   Confirmar
                 </button>
               </>
             }>
        <p className="small" style={{ margin: 0 }}>{confirmar?.texto}</p>
      </Modal>
    </>
  )
}
