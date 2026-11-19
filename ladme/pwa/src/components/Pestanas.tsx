import { useLayoutEffect, useRef, useState } from 'react'

/** Pestañas con un indicador que se desliza hasta la activa. */
export default function Pestanas<T extends string>({
  opciones,
  actual,
  alCambiar,
  etiqueta
}: {
  opciones: Array<{ id: T; texto: string; n?: number }>
  actual: T
  alCambiar: (id: T) => void
  etiqueta: string
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [indicador, setIndicador] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const medir = () => {
      const activo = caja.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      if (!activo) return
      setIndicador({ x: activo.offsetLeft, w: activo.offsetWidth })
      activo.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
    medir()
    // También al cambiar de tamaño la caja (p. ej. al aparecer con una animación), no solo la ventana.
    const ro = new ResizeObserver(medir)
    if (caja.current) ro.observe(caja.current)
    window.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [actual, opciones.length])

  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta} ref={caja}>
      {opciones.map((o) => (
        <button
          key={o.id}
          role="tab"
          type="button"
          aria-selected={actual === o.id}
          className={actual === o.id ? 'activo' : ''}
          onClick={() => alCambiar(o.id)}
        >
          {o.texto}
          {!!o.n && <span className="pestanas__n">{o.n}</span>}
        </button>
      ))}
      {indicador && (
        <span className="pestanas__indicador" aria-hidden="true" style={{ transform: `translateX(${indicador.x}px)`, width: indicador.w }} />
      )}
    </div>
  )
}
