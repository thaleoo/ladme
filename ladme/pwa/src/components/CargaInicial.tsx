import { useEffect, useState } from 'react'
import { limpiarYRecargar } from '../lib/sw'
import { registrarError } from '../lib/telemetria'
import Logo from './Logo'

const ESPERA_MS = 8000
const CLAVE_INTENTO = 'ladme-carga-lenta'

/**
 * Pantalla de arranque. Si a los 8 s sigue aquí, ofrece reintentar; si ya se
 * reintentó una vez en esta sesión, ofrece limpiar la caché de la app.
 */
export default function CargaInicial({ alReintentar }: { alReintentar?: () => void }) {
  const [lenta, setLenta] = useState(false)
  const yaReintento = sessionStorage.getItem(CLAVE_INTENTO) === '1'

  useEffect(() => {
    const t = window.setTimeout(() => {
      setLenta(true)
      registrarError('carga_lenta', `Arranque sin terminar tras ${ESPERA_MS / 1000} s${navigator.onLine ? '' : ' (sin conexión)'}`)
    }, ESPERA_MS)
    return () => window.clearTimeout(t)
  }, [])

  function reintentar() {
    sessionStorage.setItem(CLAVE_INTENTO, '1')
    if (alReintentar) alReintentar()
    else window.location.reload()
  }

  return (
    <div className="arranque" role="status" aria-live="polite">
      <div className="arranque__logo">
        <Logo size={56} />
      </div>
      {!lenta ? (
        <p className="arranque__texto">
          <span className="spinner" aria-hidden="true" /> Cargando LADME…
        </p>
      ) : (
        <div className="arranque__lenta">
          <strong>Esto está tardando más de lo normal</strong>
          <p className="small muted">
            {navigator.onLine
              ? 'Puede ser la conexión o una versión vieja guardada en el teléfono.'
              : 'Parece que no hay conexión a internet.'}
          </p>
          <div className="row" style={{ gap: 'var(--s2)', justifyContent: 'center' }}>
            <button className="btn" type="button" onClick={yaReintento ? () => void limpiarYRecargar() : reintentar}>
              {yaReintento ? 'Limpiar y recargar' : 'Reintentar'}
            </button>
            {yaReintento && (
              <button className="btn gray" type="button" onClick={() => window.location.reload()}>
                Solo recargar
              </button>
            )}
          </div>
          {yaReintento && (
            <p className="tiny muted" style={{ marginTop: 'var(--s2)' }}>
              «Limpiar» borra los archivos guardados de la app, no su sesión.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
