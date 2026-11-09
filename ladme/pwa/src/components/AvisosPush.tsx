import { useState } from 'react'
import { activarAvisos, estadoAvisos } from '../lib/push'

const CLAVE_DESCARTE = 'ladme-avisos-descartados'

export default function AvisosPush() {
  const inicial = estadoAvisos()
  const [permiso, setPermiso] = useState(inicial.permiso)
  const [descartado, setDescartado] = useState(() => localStorage.getItem(CLAVE_DESCARTE) === '1')
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  if (!inicial.soportado || !inicial.configurado) return null
  if (permiso === 'granted') {
    return mensaje ? <div className="alert ok">{mensaje}</div> : null
  }
  if (permiso === 'denied' || (descartado && !mensaje)) return null

  async function activar() {
    setOcupado(true)
    const r = await activarAvisos()
    setOcupado(false)
    setMensaje(r.mensaje)
    if (r.ok) setPermiso('granted')
  }

  function ahoraNo() {
    localStorage.setItem(CLAVE_DESCARTE, '1')
    setDescartado(true)
  }

  return (
    <div className="alert info">
      <div className="row between">
        <span>
          <strong>Active los avisos de LADME</strong> para recibir recordatorios del fin de sus reservas
          y novedades de mantenimiento, incluso con la aplicación cerrada.
        </span>
        <span className="row">
          <button className="btn sm" disabled={ocupado} onClick={activar}>
            {ocupado ? 'Activando…' : 'Activar avisos'}
          </button>
          <button className="btn gray sm" disabled={ocupado} onClick={ahoraNo}>Ahora no</button>
        </span>
      </div>
      {mensaje && <div className="tiny mt">{mensaje}</div>}
    </div>
  )
}
