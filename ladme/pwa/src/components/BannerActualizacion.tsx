import { useEffect, useState } from 'react'
import { aplicarActualizacion, hayActualizacion } from '../lib/sw'
import Icon from './Icon'

/** Aviso discreto cuando hay una versión nueva lista para usarse. */
export default function BannerActualizacion() {
  const [visible, setVisible] = useState(hayActualizacion)
  const [aplicando, setAplicando] = useState(false)

  useEffect(() => {
    const mostrar = () => setVisible(true)
    window.addEventListener('ladme-actualizacion', mostrar)
    return () => window.removeEventListener('ladme-actualizacion', mostrar)
  }, [])

  if (!visible) return null
  return (
    <div className="banner-flotante" role="status">
      <Icon nombre="actualizar" />
      <span>Hay una versión nueva de LADME.</span>
      <button
        className="btn sm"
        type="button"
        disabled={aplicando}
        onClick={() => {
          setAplicando(true)
          void aplicarActualizacion()
        }}
      >
        {aplicando ? 'Actualizando…' : 'Actualizar'}
      </button>
      <button className="icon-btn" type="button" aria-label="Más tarde" onClick={() => setVisible(false)}>
        <Icon nombre="x" width={16} height={16} />
      </button>
    </div>
  )
}
