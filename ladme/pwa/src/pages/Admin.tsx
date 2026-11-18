import { useSearchParams } from 'react-router-dom'
import { esAdmin, useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import Pestanas from '../components/Pestanas'
import Errores from './admin/Errores'
import Ronda from './admin/Ronda'
import ReservasAdmin from './admin/ReservasAdmin'
import Bloqueos from './admin/Bloqueos'
import Solicitudes from './admin/Solicitudes'
import Reportes from './admin/Reportes'
import Equipos from './admin/Equipos'
import Estadisticas from './admin/Estadisticas'
import Politicas from './admin/Politicas'
import Faro from './admin/Faro'

const PESTANAS = [
  { id: 'ronda', texto: 'Ronda' },
  { id: 'reservas', texto: 'Reservas' },
  { id: 'bloqueos', texto: 'Bloqueos' },
  { id: 'reportes', texto: 'Reportes' },
  { id: 'solicitudes', texto: 'Solicitudes' },
  { id: 'equipos', texto: 'Equipos' },
  { id: 'faro', texto: 'Faro' },
  { id: 'estadisticas', texto: 'Estadísticas' },
  { id: 'politicas', texto: 'Políticas', soloAdmin: true },
  { id: 'errores', texto: 'Errores de la app' }
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

      <Pestanas
        etiqueta="Secciones de administración"
        opciones={visibles.map((p) => ({ id: p.id, texto: p.texto }))}
        actual={actual}
        alCambiar={(id) => setParams({ tab: id }, { replace: true })}
      />

      <div className="panel-pestana" key={actual}>

      {actual === 'ronda' && <Ronda />}
      {actual === 'reservas' && <ReservasAdmin />}
      {actual === 'bloqueos' && <Bloqueos />}
      {actual === 'reportes' && <Reportes />}
      {actual === 'solicitudes' && <Solicitudes />}
      {actual === 'equipos' && <Equipos />}
      {actual === 'faro' && <Faro />}
      {actual === 'estadisticas' && <Estadisticas />}
      {actual === 'politicas' && admin && <Politicas />}
      {actual === 'errores' && <Errores />}
      </div>
    </>
  )
}
