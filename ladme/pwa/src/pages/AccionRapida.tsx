import { Navigate, useParams } from 'react-router-dom'

/**
 * Enlaces de Faro 0.2–0.3 (/pc/UNAL-05/extender…) y el enlace corto /e/UNAL-05.
 * Todo lleva a la ficha del equipo, que muestra «Tu reserva» con sus acciones.
 */
export default function AccionRapida() {
  const { codigo = '', accion = '' } = useParams<{ codigo: string; accion?: string }>()
  const equipo = encodeURIComponent(codigo.toUpperCase())
  if (accion === 'reservar') return <Navigate to={`/reservar?equipo=${equipo}`} replace />
  const q = ['extender', 'liberar', 'reportar'].includes(accion) ? `?accion=${accion}` : ''
  return <Navigate to={`/equipo/${equipo}${q}`} replace />
}
