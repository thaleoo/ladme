import { useEffect, useRef, useState } from 'react'
import { estaInstalada } from './InstalarApp'

const UMBRAL = 70

/**
 * «Deslizar hacia abajo para actualizar». Solo en la app instalada: en el
 * navegador ya existe el gesto propio y no conviene duplicarlo.
 */
export default function Deslizar({ alActualizar }: { alActualizar: () => Promise<unknown> | void }) {
  const [tiron, setTiron] = useState(0)
  const [actualizando, setActualizando] = useState(false)
  const inicio = useRef<number | null>(null)
  const funcion = useRef(alActualizar)
  funcion.current = alActualizar

  useEffect(() => {
    if (!estaInstalada() || !('ontouchstart' in window)) return
    let distancia = 0
    const empezar = (e: TouchEvent) => {
      inicio.current = window.scrollY <= 0 && !document.querySelector('.modal, .reglamento') ? e.touches[0].clientY : null
    }
    const mover = (e: TouchEvent) => {
      if (inicio.current === null) return
      distancia = Math.max(0, Math.min(120, (e.touches[0].clientY - inicio.current) * 0.5))
      setTiron(distancia)
    }
    const soltar = async () => {
      if (inicio.current === null) return
      inicio.current = null
      if (distancia >= UMBRAL) {
        setActualizando(true)
        setTiron(UMBRAL)
        try {
          await funcion.current()
        } finally {
          setActualizando(false)
        }
      }
      distancia = 0
      setTiron(0)
    }
    window.addEventListener('touchstart', empezar, { passive: true })
    window.addEventListener('touchmove', mover, { passive: true })
    window.addEventListener('touchend', soltar)
    return () => {
      window.removeEventListener('touchstart', empezar)
      window.removeEventListener('touchmove', mover)
      window.removeEventListener('touchend', soltar)
    }
  }, [])

  if (!tiron && !actualizando) return null
  return (
    <div className="deslizar" style={{ transform: `translate(-50%, ${tiron - 44}px)` }} aria-hidden="true">
      <span
        className={actualizando ? 'spinner' : 'deslizar__flecha'}
        style={actualizando ? undefined : { transform: `rotate(${Math.min(180, (tiron / UMBRAL) * 180)}deg)` }}
      >
        {actualizando ? null : '↓'}
      </span>
    </div>
  )
}
