import { useSearchParams } from 'react-router-dom'
import { esAdmin, useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import Ronda from './admin/Ronda'
import ReservasAdmin from './admin/ReservasAdmin'
import Bloqueos from './admin/Bloqueos'
import Solicitudes from './admin/Solicitudes'
import Reportes from './admin/Reportes'
import Equipos from './admin/Equipos'
import Estadisticas from './admin/Estadisticas'
import Politicas from './admin/Politicas'

const PESTANAS = [
  { id: 'ronda', texto: 'Ronda' },
  { id: 'reservas', texto: 'Reservas' },
  { id: 'bloqueos', texto: 'Bloqueos' },
  { id: 'reportes', texto: 'Reportes' },
  { id: 'solicitudes', texto: 'Solicitudes' },
  { id: 'equipos', texto: 'Equipos' },
  { id: 'estadisticas', texto: 'Estadísticas' },
  { id: 'politicas', texto: 'Políticas', soloAdmin: true }
] as const

export default function Admin() {
  const { perfil } = useAuth()
  const admin = esAdmin(perfil)
  const [params, setParams] = useSearchParams()
  const visibles = PESTANAS.filter((p) => !('soloAdmin' in p) || admin)
  const actual = visibles.find((p) => p.id === params.get('tab'))?.id ?? 'ronda'

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        titulo="Administración"
        sub="El estado del laboratorio, todas las reservas y la configuración."
      />

      <div className="pestanas" role="tablist" aria-label="Secciones de administración">
        {visibles.map((p) => (
          <button
            key={p.id}
            role="tab"
            type="button"
            aria-selected={actual === p.id}
            className={actual === p.id ? 'activo' : ''}
            onClick={() => setParams({ tab: p.id }, { replace: true })}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {actual === 'ronda' && <Ronda />}
      {actual === 'reservas' && <ReservasAdmin />}
      {actual === 'bloqueos' && <Bloqueos />}
      {actual === 'reportes' && <Reportes />}
      {actual === 'solicitudes' && <Solicitudes />}
      {actual === 'equipos' && <Equipos />}
      {actual === 'estadisticas' && <Estadisticas />}
      {actual === 'politicas' && admin && <Politicas />}
    </>
  )
}
