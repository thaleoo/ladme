import { Fragment } from 'react'
import { useLimites } from '../lib/politicas'
import type { Regla } from '../lib/reglamento'

/** Texto de una regla: **negrita** y los datos que cambian con las políticas ({tolerancia}, {software_dias}). */
export function TextoRegla({ texto }: { texto: string }) {
  const { toleranciaMin, softwareAnticipacion } = useLimites()
  const lleno = texto.split('{tolerancia}').join(String(toleranciaMin)).split('{software_dias}').join(String(softwareAnticipacion))
  return (
    <>
      {lleno.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.length > 4 && p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>
      )}
    </>
  )
}

export default function ListaReglas({ reglas }: { reglas: Regla[] }) {
  return (
    <ol className="reglamento__lista">
      {reglas.map((r, i) => (
        <li key={i}>
          <strong>{r.titulo}</strong>
          <span>
            <TextoRegla texto={r.texto} />
          </span>
        </li>
      ))}
    </ol>
  )
}
