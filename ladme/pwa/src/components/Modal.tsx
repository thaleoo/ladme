import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

interface Props {
  abierto: boolean
  titulo: string
  descripcion?: ReactNode
  onCerrar: () => void
  children?: ReactNode
  pie?: ReactNode
}

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo accesible. En móvil se presenta como hoja inferior; en escritorio,
 * como ventana centrada. Bloquea el desplazamiento del fondo, atrapa el foco y
 * se cierra con Escape o tocando fuera.
 */
export default function Modal({ abierto, titulo, descripcion, onCerrar, children, pie }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const tituloId = useRef(`modal-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    if (!abierto) return
    const anterior = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const temporizador = window.setTimeout(() => {
      const primero = panel.current?.querySelector<HTMLElement>(ENFOCABLES)
      ;(primero ?? panel.current)?.focus()
    }, 40)

    function alPulsar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCerrar()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const nodos = Array.from(panel.current.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
        (n) => n.offsetParent !== null
      )
      if (nodos.length === 0) return
      const primero = nodos[0]
      const ultimo = nodos[nodos.length - 1]
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }

    document.addEventListener('keydown', alPulsar)
    return () => {
      window.clearTimeout(temporizador)
      document.removeEventListener('keydown', alPulsar)
      document.body.style.overflow = overflow
      anterior?.focus?.()
    }
  }, [abierto, onCerrar])

  if (!abierto) return null

  return createPortal(
    <div className="modal">
      <button className="modal__backdrop" tabIndex={-1} aria-label="Cerrar" onClick={onCerrar} />
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId.current}
        ref={panel}
        tabIndex={-1}
      >
        <div className="modal__asa" aria-hidden="true" />
        <div className="modal__head">
          <div>
            <h2 id={tituloId.current}>{titulo}</h2>
            {descripcion && <p className="modal__sub">{descripcion}</p>}
          </div>
          <button className="icon-btn" onClick={onCerrar} aria-label="Cerrar" type="button">
            <Icon nombre="x" />
          </button>
        </div>
        {children}
        {pie && <div className="modal__foot">{pie}</div>}
      </div>
    </div>,
    document.body
  )
}
