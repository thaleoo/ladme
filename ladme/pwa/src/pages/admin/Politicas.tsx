import { useEffect, useState } from 'react'
import { guardarPolitica, listarPoliticas } from '../../lib/api'
import type { Politica } from '../../lib/types'
import { useLimites } from '../../lib/politicas'
import { Cargando } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import { useToast } from '../../components/Toast'

const NOMBRES: Record<string, { titulo: string; unidad: string; min: number; max: number }> = {
  duracion_max_horas: { titulo: 'Duración máxima de una reserva', unidad: 'horas', min: 1, max: 720 },
  extension_max_horas: { titulo: 'Horas máximas de una extensión', unidad: 'horas', min: 1, max: 168 },
  extensiones_max: { titulo: 'Extensiones por reserva', unidad: 'veces', min: 0, max: 10 },
  duracion_max_total_horas: { titulo: 'Tope total con extensiones', unidad: 'horas', min: 1, max: 1000 },
  anticipacion_max_dias: { titulo: 'Anticipación máxima para reservar', unidad: 'días', min: 1, max: 365 },
  tolerancia_llegada_min: { titulo: 'Tolerancia para registrar la llegada', unidad: 'minutos', min: 5, max: 240 },
  reservas_activas_max: { titulo: 'Reservas a la vez por usuario (el personal está exento; 0 = sin límite)', unidad: 'reservas', min: 0, max: 20 },
  excepcion_max_horas: { titulo: 'Máximo que se puede pedir en una solicitud de reserva larga', unidad: 'horas', min: 1, max: 2160 },
  contacto_espera_min: { titulo: 'Espera entre mensajes al titular de un equipo', unidad: 'minutos', min: 1, max: 240 },
  reserva_max_absoluta_horas: { titulo: 'Tope absoluto de cualquier reserva (también para administradores)', unidad: 'horas', min: 24, max: 2160 },
  recordatorio_fin_min: { titulo: 'Anticipación del recordatorio de fin', unidad: 'minutos', min: 10, max: 720 },
  faro_aviso_min: { titulo: 'Faro: aviso antes del fin de la reserva', unidad: 'minutos', min: 1, max: 60 },
  faro_gracia_min: { titulo: 'Faro: gracia al terminar antes de bloquear', unidad: 'minutos', min: 0, max: 30 },
  faro_desatendido_min: { titulo: 'Faro: inactividad para mostrar el aviso de proceso desatendido', unidad: 'minutos', min: 1, max: 120 },
  faro_llegada_automatica: { titulo: 'Faro: registrar la llegada al detectar uso (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 },
  llegada_modo: { titulo: 'Quién registra la llegada (0 = la persona desde la app · 1 = solo el personal · 2 = con el QR de la isla de Faro)', unidad: '', min: 0, max: 2 },
  liberar_no_show_min: { titulo: 'Liberar sola una reserva sin llegada ni uso del PC (0 = nunca)', unidad: 'minutos', min: 0, max: 120 },
  faro_sesion_limpia: { titulo: 'Faro ofrece borrar los archivos de la persona al terminar (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 },
  software_anticipacion_dias: { titulo: 'Anticipación para pedir software', unidad: 'días hábiles', min: 0, max: 30 },
  reservas_pausadas: { titulo: 'Pausar las reservas nuevas (1 = pausadas, 0 = abiertas)', unidad: '', min: 0, max: 1 },
  inasistencias_activas: { titulo: 'Contar inasistencias y sancionar (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 },
  inasistencia_ventana_dias: { titulo: 'Días en que se cuentan las inasistencias', unidad: 'días', min: 7, max: 365 },
  inasistencia_sancion_2_dias: { titulo: 'Días sin reservar con 2 inasistencias', unidad: 'días', min: 0, max: 60 },
  inasistencia_sancion_3_dias: { titulo: 'Días sin reservar con 3 o más inasistencias', unidad: 'días', min: 0, max: 120 },
  uso_compartido: { titulo: 'Permitir uso compartido de reservas (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 },
  clase_semanas_max: { titulo: 'Semanas máximas de una solicitud de sala para clase', unidad: 'semanas', min: 1, max: 30 },
  sala_encender_hhmm: { titulo: 'Encender la sala a las (HHMM, p. ej. 700; 0 = no)', unidad: '', min: 0, max: 2359 },
  sala_apagar_hhmm: { titulo: 'Apagar la sala a las (HHMM, p. ej. 1900; 0 = no). Se omiten equipos con reserva o clase', unidad: '', min: 0, max: 2359 },
  sala_aviso_cierre_min: { titulo: 'Anuncio de cierre antes de apagar', unidad: 'min', min: 0, max: 120 },
  sala_sabado: { titulo: 'El horario automático aplica los sábados (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 }
}

/** Solo administradores. Los cambios aplican de inmediato a las reservas nuevas. */
type Forma = { titulo: string; ayuda: string | null; tipo: 'numero' | 'interruptor' | 'opciones'; opciones: [string, string][] }

/** Saca del título lo que va entre paréntesis: si es «1 = sí, 0 = no» la regla es un interruptor;
 *  si enumera todos los valores («0 = … · 1 = …») es una lista; si no, queda como ayuda. */
function forma(clave: string, regla?: { titulo: string; min: number; max: number }): Forma {
  if (!regla) return { titulo: clave, ayuda: null, tipo: 'numero', opciones: [] }
  const m = regla.titulo.match(/^(.*?)\s*\((.*)\)\.?\s*(.*)$/)
  if (!m) return { titulo: regla.titulo, ayuda: null, tipo: 'numero', opciones: [] }
  const [, titulo, dentro, despues] = m
  if (regla.min === 0 && regla.max === 1 && /^1 = /.test(dentro)) return { titulo, ayuda: despues || null, tipo: 'interruptor', opciones: [] }
  const partes = dentro.split(' · ').map((x) => x.match(/^(\d+) = (.+)$/))
  if (partes.every(Boolean) && partes.length === regla.max - regla.min + 1) {
    const opciones = partes.map((x) => [x![1], x![2].charAt(0).toUpperCase() + x![2].slice(1)] as [string, string])
    return { titulo, ayuda: despues || null, tipo: 'opciones', opciones }
  }
  return { titulo, ayuda: [dentro.charAt(0).toUpperCase() + dentro.slice(1), despues].filter(Boolean).join('. '), tipo: 'numero', opciones: [] }
}

const GRUPOS: [string, (clave: string) => boolean][] = [
  ['Reservas', (c) => !/^(faro_|sala_|inasistencia|tolerancia_llegada|llegada_modo|liberar_no_show)/.test(c)],
  ['Llegada e inasistencias', (c) => /^(inasistencia|tolerancia_llegada|llegada_modo|liberar_no_show)/.test(c)],
  ['Faro', (c) => c.startsWith('faro_')],
  ['Horario automático de la sala', (c) => c.startsWith('sala_')]
]

export default function Politicas() {
  const toast = useToast()
  const lim = useLimites()
  const [lista, setLista] = useState<Politica[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    try {
      // Solo las numéricas son editables aquí (p. ej. inasistencias_desde es una fecha fija).
      const l = (await listarPoliticas()).filter((p) => /^-?\d+$/.test(String(p.valor)))
      setLista(l)
      setValores(Object.fromEntries(l.map((p) => [p.clave, String(p.valor)])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las políticas.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void cargar()
  }, [])

  const cambios = lista.filter((p) => valores[p.clave] !== String(p.valor))

  async function guardar() {
    setError(null)
    for (const p of cambios) {
      const n = Number(valores[p.clave])
      const regla = NOMBRES[p.clave]
      if (!Number.isInteger(n) || (regla && (n < regla.min || n > regla.max))) {
        return setError(`«${regla?.titulo ?? p.clave}» debe ser un número entero${regla ? ` entre ${regla.min} y ${regla.max}` : ''}.`)
      }
    }
    const base = Number(valores.duracion_max_horas)
    const total = Number(valores.duracion_max_total_horas)
    if (total < base) return setError('El tope total no puede ser menor que la duración máxima de una reserva.')
    setGuardando(true)
    try {
      for (const p of cambios) await guardarPolitica(p.clave, Number(valores[p.clave]))
      toast.mostrar('Políticas actualizadas.')
      await Promise.all([cargar(), lim.recargar()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar las políticas.')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return <Cargando texto="Cargando políticas…" />

  return (
    <section className="stack">
      <p className="admin-barra__texto">
        La base de datos hace cumplir estas reglas. Cambiarlas no modifica las reservas que ya existen.
      </p>
      {GRUPOS.map(([nombre, toca]) => {
        const del = lista.filter((p) => toca(p.clave))
        if (!del.length) return null
        return (
          <section key={nombre} className="ajustes-grupo">
            <h2 className="ajustes-grupo__titulo">{nombre}</h2>
            <div className="ajustes-lista">
              {del.map((p) => {
                const regla = NOMBRES[p.clave]
                const f = forma(p.clave, regla)
                const id = `pol-${p.clave}`
                const cambiado = cambios.some((c) => c.clave === p.clave)
                const valor = valores[p.clave] ?? ''
                const poner = (v: string) => setValores({ ...valores, [p.clave]: v })
                return (
                  <div key={p.clave} className={`ajuste-fila ${f.tipo === 'opciones' ? 'ajuste-fila--apilada' : ''} ${cambiado ? 'cambiado' : ''}`}>
                    <label className="ajuste-fila__texto" htmlFor={id}>
                      {f.titulo}
                      {f.ayuda && <span className="ajuste-fila__ayuda">{f.ayuda}</span>}
                    </label>
                    {f.tipo === 'interruptor' ? (
                      <input id={id} type="checkbox" role="switch" className="interruptor" checked={valor === '1'} onChange={(e) => poner(e.target.checked ? '1' : '0')} />
                    ) : f.tipo === 'opciones' ? (
                      <select id={id} value={valor} onChange={(e) => poner(e.target.value)}>
                        {f.opciones.map(([v, t]) => (
                          <option key={v} value={v}>{t}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="ajuste-fila__valor">
                        <input id={id} type="number" inputMode="numeric" min={regla?.min} max={regla?.max} value={valor} onChange={(e) => poner(e.target.value)} />
                        {regla?.unidad && <span className="ajuste-fila__unidad">{regla.unidad}</span>}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {cambios.length > 0 && (
        <div className="guardar-flotante">
          <button type="button" className="btn ghost" onClick={() => setValores(Object.fromEntries(lista.map((p) => [p.clave, String(p.valor)])))} disabled={guardando}>
            Deshacer
          </button>
          <button type="button" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : cambios.length === 1 ? 'Guardar 1 cambio' : `Guardar ${cambios.length} cambios`}
          </button>
        </div>
      )}
    </section>
  )
}
