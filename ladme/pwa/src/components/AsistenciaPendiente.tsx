import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { miLlegadaPendiente, type LlegadaPendiente } from '../lib/api'
import { esStaff, useAuth } from '../context/AuthContext'
import Icon from './Icon'

/** La reserva que espera confirmar asistencia; se revisa cada minuto y al volver a la app. */
export function useLlegadaPendiente(): { pendiente: LlegadaPendiente | null; recargar: () => void } {
  const { perfil } = useAuth()
  const [pendiente, setPendiente] = useState<LlegadaPendiente | null>(null)
  const recargar = useCallback(() => {
    if (!perfil) return
    void miLlegadaPendiente().then(setPendiente)
  }, [perfil])
  useEffect(() => {
    recargar()
    const t = window.setInterval(recargar, 60000)
    const alVolver = () => document.visibilityState === 'visible' && recargar()
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('ladme:llegada', recargar)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('ladme:llegada', recargar)
    }
  }, [recargar])
  return { pendiente, recargar }
}

/**
 * Acceso temporal a «Confirmar asistencia»: aparece en toda la app mientras una reserva espera la
 * confirmación (desde 15 min antes del inicio hasta el límite de la tolerancia).
 */
export default function AsistenciaPendiente() {
  const { perfil } = useAuth()
  const location = useLocation()
  const { pendiente } = useLlegadaPendiente()
  const [, forzar] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => forzar((x) => x + 1), 30000)
    return () => window.clearInterval(t)
  }, [])
  if (!pendiente || !perfil || esStaff(perfil) || location.pathname.startsWith('/llegada')) return null
  const faltan = Math.round((new Date(pendiente.limite).getTime() - Date.now()) / 60000)
  if (faltan <= 0) return null
  const empezo = new Date(pendiente.inicio).getTime() <= Date.now()
  return (
    <Link className={`asistencia-aviso${faltan <= 10 ? ' urgente' : ''}`} to="/llegada">
      <span className="asistencia-aviso__icono" aria-hidden="true"><Icon nombre="qr" width={20} height={20} /></span>
      <span className="asistencia-aviso__t">
        <strong>Confirme su llegada a <span className="nowrap">{pendiente.equipo}</span></strong>
        <span>{empezo ? `Le quedan ${faltan} min para hacerlo` : 'Su reserva está por empezar'}</span>
      </span>
      <Icon nombre="flecha-der" width={18} height={18} />
    </Link>
  )
}
