import { useEffect, useId, useState } from 'react'
import { docentesSugeridos } from '../lib/api'

const AYUDA: Record<string, string> = {
  'Trabajo de grado': 'Director(a) del trabajo de grado.',
  PAE: 'Tutor(a) del PAE.',
  Semilleros: 'Docente que lidera el semillero de investigación.'
}

let cache: Promise<string[]> | null = null

/**
 * Docente responsable: obligatorio en Trabajo de grado, PAE y Semilleros. Sugiere los
 * docentes que la persona ya usó y los docentes verificados, pero acepta cualquier nombre.
 */
export default function CampoDocente({
  actividad,
  valor,
  onCambio,
  id
}: {
  actividad: string
  valor: string
  onCambio: (v: string) => void
  id?: string
}) {
  const propio = useId()
  const campo = id ?? `docente-${propio}`
  const [sugeridos, setSugeridos] = useState<string[]>([])

  useEffect(() => {
    cache ??= docentesSugeridos()
    let vivo = true
    void cache.then((x) => vivo && setSugeridos(x))
    return () => {
      vivo = false
    }
  }, [])

  return (
    <div className="field">
      <label className="field__label" htmlFor={campo}>
        Docente responsable
      </label>
      <input
        id={campo}
        list={`${campo}-lista`}
        value={valor}
        maxLength={120}
        autoComplete="off"
        required
        onChange={(e) => onCambio(e.target.value)}
        placeholder="Nombre y apellido"
      />
      <datalist id={`${campo}-lista`}>
        {sugeridos.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <p className="help">{AYUDA[actividad] ?? 'Docente que avala la actividad.'}</p>
    </div>
  )
}

/** El nombre tal como lo guarda la base (espacios de más fuera), o un error para mostrar. */
export function validarDocente(v: string): string | null {
  const limpio = v.trim().replace(/\s+/g, ' ')
  if (limpio.length < 3) return 'Indique el docente responsable (director del trabajo de grado, tutor del PAE o docente del semillero).'
  return null
}

/** Recuerda el último docente por actividad para no escribirlo cada vez. */
const CLAVE = 'ladme-docente-por-actividad'
export function docenteRecordado(actividad: string): string {
  try {
    return (JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Record<string, string>)[actividad] ?? ''
  } catch {
    return ''
  }
}
export function recordarDocente(actividad: string, docente: string) {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Record<string, string>
    m[actividad] = docente.trim().replace(/\s+/g, ' ')
    localStorage.setItem(CLAVE, JSON.stringify(m))
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}
