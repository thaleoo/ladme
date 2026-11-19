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
import Registro from './admin/Registro'
import Consola from './admin/Consola'

/**
 * Las secciones se agrupan en cinco grupos para no tener una fila de doce pestañas. Cada sección
 * sigue teniendo su dirección (?tab=faro), así que los enlaces de avisos y del chat no cambian.
 */
const GRUPOS = [
  { id: 'hoy', texto: 'Hoy', secciones: [{ id: 'ronda', texto: 'Ronda' }] },
  {
    id: 'reservas',
    texto: 'Reservas',
    secciones: [
      { id: 'reservas', texto: 'Reservas' },
      { id: 'solicitudes', texto: 'Solicitudes y clases' },
      { id: 'bloqueos', texto: 'Bloqueos' }
    ]
  },
  {
    id: 'equipos',
    texto: 'Equipos',
    secciones: [
      { id: 'faro', texto: 'Faro' },
      { id: 'equipos', texto: 'Inventario' },
      { id: 'reportes', texto: 'Fallas' }
    ]
  },
  {
    id: 'historial',
    texto: 'Historial',
    secciones: [
      { id: 'registro', texto: 'Registro' },
      { id: 'estadisticas', texto: 'Estadísticas' },
      { id: 'errores', texto: 'Errores de la app' }
    ]
  },
  {
    id: 'herramientas',
    texto: 'Herramientas',
    secciones: [
      { id: 'consola', texto: 'Consola' },
      { id: 'politicas', texto: 'Políticas', soloAdmin: true }
    ]
  }
] as const

type Seccion = { id: string; texto: string; soloAdmin?: boolean }

export default function Admin() {
  const { perfil } = useAuth()
  const admin = esAdmin(perfil)
  const [params, setParams] = useSearchParams()
  const grupos = GRUPOS.map((g) => ({ ...g, secciones: (g.secciones as readonly Seccion[]).filter((x) => !x.soloAdmin || admin) }))
  const todas = grupos.flatMap((g) => g.secciones)
  const actual = todas.find((x) => x.id === params.get('tab'))?.id ?? 'ronda'
  const grupo = grupos.find((g) => g.secciones.some((x) => x.id === actual)) ?? grupos[0]
  const ir = (id: string) => setParams({ tab: id }, { replace: true })

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        titulo="Administración"
        sub="El estado del laboratorio, todas las reservas y la configuración."
      />

      <Pestanas
        etiqueta="Grupos de administración"
        opciones={grupos.map((g) => ({ id: g.id, texto: g.texto }))}
        actual={grupo.id}
        alCambiar={(id) => ir(grupos.find((g) => g.id === id)?.secciones[0]?.id ?? 'ronda')}
      />
      {grupo.secciones.length > 1 && (
        <div className="chips subsecciones" role="tablist" aria-label={`Secciones de ${grupo.texto}`}>
          {grupo.secciones.map((x) => (
            <button key={x.id} type="button" role="tab" className="chip" aria-selected={actual === x.id} aria-pressed={actual === x.id}
                    onClick={() => ir(x.id)}>
              {x.texto}
            </button>
          ))}
        </div>
      )}

      <div className="panel-pestana" key={actual}>

      {actual === 'ronda' && <Ronda />}
      {actual === 'reservas' && <ReservasAdmin />}
      {actual === 'bloqueos' && <Bloqueos />}
      {actual === 'reportes' && <Reportes />}
      {actual === 'solicitudes' && <Solicitudes />}
      {actual === 'equipos' && <Equipos />}
      {actual === 'faro' && <Faro />}
      {actual === 'registro' && <Registro />}
      {actual === 'consola' && <Consola />}
      {actual === 'estadisticas' && <Estadisticas />}
      {actual === 'politicas' && admin && <Politicas />}
      {actual === 'errores' && <Errores />}
      </div>
    </>
  )
}
