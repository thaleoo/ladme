import { useEffect, useState } from 'react'
import Icon from './Icon'
import Logo from './Logo'

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const CLAVE = 'ladme-instalar-descartado'
const MES = 30 * 86400000

let eventoGuardado: EventoInstalacion | null = null
// El navegador avisa una sola vez y muy temprano: se guarda antes de montar React.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  eventoGuardado = e as EventoInstalacion
  window.dispatchEvent(new Event('ladme-instalable'))
})

export function estaInstalada(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function esIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Lanza el diálogo nativo si el navegador lo ofrece. Devuelve false si no hay. */
export async function instalarAhora(): Promise<boolean> {
  if (!eventoGuardado) return false
  await eventoGuardado.prompt()
  const { outcome } = await eventoGuardado.userChoice
  eventoGuardado = null
  return outcome === 'accepted'
}

export function puedeInstalarse(): boolean {
  return !!eventoGuardado
}

/**
 * Banner «Instale LADME». En Chrome, Edge y Android abre el diálogo nativo; en
 * iPhone/iPad explica los dos toques de Safari. Si se cierra, vuelve en un mes.
 */
export default function InstalarApp() {
  const [disponible, setDisponible] = useState(puedeInstalarse)
  const [descartado, setDescartado] = useState(() => {
    const t = Number(localStorage.getItem(CLAVE) ?? 0)
    return Date.now() - t < MES
  })

  useEffect(() => {
    const avisar = () => setDisponible(true)
    const instalada = () => setDisponible(false)
    window.addEventListener('ladme-instalable', avisar)
    window.addEventListener('appinstalled', instalada)
    return () => {
      window.removeEventListener('ladme-instalable', avisar)
      window.removeEventListener('appinstalled', instalada)
    }
  }, [])

  const ios = esIOS()
  if (descartado || estaInstalada() || (!disponible && !ios)) return null

  function cerrar() {
    localStorage.setItem(CLAVE, String(Date.now()))
    setDescartado(true)
  }

  return (
    <div className="instalar" role="region" aria-label="Instalar la aplicación">
      <Logo size={40} />
      <div className="instalar__texto">
        <strong>Instale LADME en su {ios ? 'iPhone' : 'dispositivo'}</strong>
        {ios ? (
          <span>
            En Safari toque <Icon nombre="compartir" width={14} height={14} /> Compartir y luego «Agregar a inicio». Así
            recibirá avisos y abrirá más rápido.
          </span>
        ) : (
          <span>Ábrala como una app, reciba avisos y entre más rápido.</span>
        )}
      </div>
      <div className="instalar__acciones">
        {!ios && (
          <button className="btn sm" type="button" onClick={async () => (await instalarAhora()) && setDisponible(false)}>
            Instalar
          </button>
        )}
        <button className="icon-btn" type="button" aria-label="Ahora no" onClick={cerrar}>
          <Icon nombre="x" width={16} height={16} />
        </button>
      </div>
    </div>
  )
}
