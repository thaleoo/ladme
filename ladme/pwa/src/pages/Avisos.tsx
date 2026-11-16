import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarAvisos, marcarAvisosLeidos } from '../lib/api'
import type { Aviso } from '../lib/types'
import { fecha, hace } from '../lib/format'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon, { type NombreIcono } from '../components/Icon'

function icono(tipo: string): NombreIcono {
  if (tipo.startsWith('mantenimiento')) return 'llave'
  if (tipo === 'cancelacion' || tipo === 'solicitud_rechazada') return 'x-circulo'
  if (tipo === 'fin_proximo' || tipo.startsWith('sin_llegada')) return 'reloj'
  if (tipo === 'contacto') return 'campana'
  if (tipo === 'solicitud_excepcion') return 'info'
  return 'check-circulo'
}

/** Centro de avisos: funciona aunque la persona no active las notificaciones push. */
export default function Avisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const lista = await listarAvisos()
      setAvisos(lista)
      if (lista.some((a) => !a.leido_en)) {
        await marcarAvisosLeidos()
        window.dispatchEvent(new Event('ladme-avisos'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los avisos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <>
      <PageHeader eyebrow="Novedades" titulo="Avisos" sub="Lo que ha pasado con sus reservas y, si es del personal, con el laboratorio." />

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      {cargando && <Cargando texto="Cargando avisos…" />}

      {!cargando && avisos.length === 0 && !error && (
        <div className="card">
          <Empty icono="campana" titulo="Sin avisos">
            Aquí aparecerán las confirmaciones, recordatorios y mensajes sobre sus reservas.
          </Empty>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="avisos">
          {avisos.map((a) => {
            const contenido = (
              <>
                <span className="avisos__icono">
                  <Icon nombre={icono(a.tipo)} />
                </span>
                <span className="avisos__texto">
                  <strong>{a.titulo ?? 'Novedad en LADME'}</strong>
                  {a.cuerpo && <span>{a.cuerpo}</span>}
                  <small title={fecha(a.creado_en)}>{hace(a.creado_en)}</small>
                </span>
                {!a.leido_en && <span className="avisos__nuevo" aria-label="Nuevo" />}
              </>
            )
            return a.url ? (
              <Link key={a.id} to={a.url} className="avisos__item">
                {contenido}
              </Link>
            ) : (
              <div key={a.id} className="avisos__item">
                {contenido}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
