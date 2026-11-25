import { Link } from 'react-router-dom'
import PageHeader, { Cargando } from '../components/PageHeader'
import ListaReglas from '../components/ListaReglas'
import Icon from '../components/Icon'
import { esAdmin, useAuth } from '../context/AuthContext'
import { REGLAMENTO_POR_DEFECTO } from '../lib/reglamento'
import { useReglamento } from '../lib/useReglamento'

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

/** Las reglas de uso del laboratorio, para consultarlas cuando se quiera. */
export default function Reglamento() {
  const { perfil } = useAuth()
  const { datos, cargando } = useReglamento()
  if (cargando) return <Cargando />

  return (
    <>
      <PageHeader
        eyebrow="Laboratorio"
        titulo="Reglas de uso"
        sub={datos ? `Versión ${datos.version} · publicada el ${fecha(datos.publicado_en)}` : 'Reglas de uso del laboratorio'}
        acciones={
          esAdmin(perfil) && (
            <Link className="btn gray sm" to="/admin?tab=reglamento">
              <Icon nombre="lapiz" /> Editar
            </Link>
          )
        }
      />
      <section className="card">
        <ListaReglas reglas={datos?.reglas ?? REGLAMENTO_POR_DEFECTO} />
        {datos?.aceptada_en && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Usted aceptó la versión {datos.aceptada_version} el {fecha(datos.aceptada_en)}.
          </p>
        )}
      </section>
    </>
  )
}
