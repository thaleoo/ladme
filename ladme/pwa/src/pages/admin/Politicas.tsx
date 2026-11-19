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
  uso_compartido: { titulo: 'Permitir uso compartido de reservas (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 },
  clase_semanas_max: { titulo: 'Semanas máximas de una solicitud de sala para clase', unidad: 'semanas', min: 1, max: 30 },
  sala_encender_hhmm: { titulo: 'Encender la sala a las (HHMM, p. ej. 700; 0 = no)', unidad: '', min: 0, max: 2359 },
  sala_apagar_hhmm: { titulo: 'Apagar la sala a las (HHMM, p. ej. 1900; 0 = no). Se omiten equipos con reserva o clase', unidad: '', min: 0, max: 2359 },
  sala_aviso_cierre_min: { titulo: 'Anuncio de cierre antes de apagar', unidad: 'min', min: 0, max: 120 },
  sala_sabado: { titulo: 'El horario automático aplica los sábados (1 = sí, 0 = no)', unidad: '', min: 0, max: 1 }
}

/** Solo administradores. Los cambios aplican de inmediato a las reservas nuevas. */
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
      const l = await listarPoliticas()
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
    <section className="card stack">
      <p className="small muted" style={{ margin: 0 }}>
        Estas reglas las hace cumplir la base de datos. Cambiarlas no modifica las reservas que ya existen.
      </p>
      <div className="grid cols-2 gap-sm">
        {lista.map((p) => {
          const regla = NOMBRES[p.clave]
          return (
            <div key={p.clave} className="field">
              <label className="field__label" htmlFor={`pol-${p.clave}`}>
                {regla?.titulo ?? p.clave}
              </label>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--s2)', alignItems: 'center' }}>
                <input
                  id={`pol-${p.clave}`}
                  type="number"
                  inputMode="numeric"
                  min={regla?.min}
                  max={regla?.max}
                  value={valores[p.clave] ?? ''}
                  onChange={(e) => setValores({ ...valores, [p.clave]: e.target.value })}
                  style={{ maxWidth: 130 }}
                />
                <span className="small muted">{regla?.unidad}</span>
              </div>
            </div>
          )
        })}
      </div>
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      <div className="row">
        <button type="button" onClick={guardar} disabled={guardando || cambios.length === 0}>
          <Icon nombre="check" /> {guardando ? 'Guardando…' : cambios.length ? `Guardar ${cambios.length} cambio(s)` : 'Sin cambios'}
        </button>
      </div>
    </section>
  )
}
