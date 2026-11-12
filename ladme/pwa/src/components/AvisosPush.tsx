import { useState } from 'react'
import { activarAvisos, estadoAvisos } from '../lib/push'
import Icon from './Icon'

const CLAVE_DESCARTE = 'ladme-avisos-descartados'

export default function AvisosPush() {
  const inicial = estadoAvisos()
  const [permiso, setPermiso] = useState(inicial.permiso)
  const [descartado, setDescartado] = useState(() => localStorage.getItem(CLAVE_DESCARTE) === '1')
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  if (!inicial.soportado || !inicial.configurado) return null
  if (permiso === 'granted') {
    return mensaje ? (
      <div className="alert ok">
        <Icon nombre="check-circulo" />
        <div className="alert__body">{mensaje}</div>
      </div>
    ) : null
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
      <Icon nombre="campana" />
      <div className="alert__body">
        <strong>Active los avisos de LADME</strong>
        <p className="small" style={{ margin: '4px 0 0' }}>
          Reciba el recordatorio antes de que termine su reserva y las novedades de mantenimiento,
          incluso con la aplicación cerrada.
        </p>
        {mensaje && (
          <p className="tiny" style={{ margin: '6px 0 0' }}>
            {mensaje}
          </p>
        )}
        <div className="alert__actions">
          <button className="btn sm" disabled={ocupado} onClick={activar} type="button">
            {ocupado ? (
              <>
                <span className="spinner" aria-hidden="true" /> Activando…
              </>
            ) : (
              <>
                <Icon nombre="campana" /> Activar avisos
              </>
            )}
          </button>
          <button className="btn gray sm" disabled={ocupado} onClick={ahoraNo} type="button">
            Ahora no
          </button>
        </div>
      </div>
    </div>
  )
}
