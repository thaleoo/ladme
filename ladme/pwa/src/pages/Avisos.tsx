import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarAvisos, marcarAvisosLeidos } from '../lib/api'
import type { Aviso } from '../lib/types'
import { diaCorto, fecha, hace, hora } from '../lib/format'
import PageHeader, { Cargando, Empty } from '../components/PageHeader'
import Icon, { type NombreIcono } from '../components/Icon'
import { esStaff, useAuth } from '../context/AuthContext'
import Deslizar from '../components/Deslizar'

function tono(tipo: string): string {
  if (tipo === 'cancelacion' || tipo === 'solicitud_rechazada' || tipo.startsWith('inasistencia')) return 'rojo'
  if (tipo === 'fin_proximo' || tipo.startsWith('sin_llegada') || tipo.startsWith('llegada')) return 'ambar'
  if (tipo.startsWith('reporte')) return 'naranja'
  if (tipo.startsWith('mantenimiento')) return 'gris'
  if (tipo === 'equipo_libre' || tipo.startsWith('software')) return 'violeta'
  if (tipo === 'contacto' || tipo.startsWith('solicitud') || tipo.startsWith('verificacion') || tipo.startsWith('clase')) return 'azul'
  return 'verde'
}

/** «Hoy», «Ayer» o el día, para agrupar como un historial. */
function grupoDia(iso: string): string {
  const d = new Date(iso)
  const hoy = new Date()
  const ayer = new Date()
  ayer.setDate(hoy.getDate() - 1)
  if (d.toDateString() === hoy.toDateString()) return 'Hoy'
  if (d.toDateString() === ayer.toDateString()) return 'Ayer'
  const t = diaCorto(d)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function icono(tipo: string): NombreIcono {
  if (tipo.startsWith('mantenimiento')) return 'llave'
  if (tipo === 'cancelacion' || tipo === 'solicitud_rechazada') return 'x-circulo'
  if (tipo === 'fin_proximo' || tipo.startsWith('sin_llegada')) return 'reloj'
  if (tipo === 'contacto') return 'campana'
  if (tipo === 'solicitud_excepcion') return 'info'
  if (tipo.startsWith('reporte')) return 'alerta'
  if (tipo === 'equipo_libre') return 'chispa'
  return 'check-circulo'
}

/** Centro de avisos: funciona aunque la persona no active las notificaciones push. */
export default function Avisos() {
  const { perfil } = useAuth()
  const staff = esStaff(perfil)
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
      <PageHeader titulo="Avisos" />

      <Deslizar alActualizar={cargar} />

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
            {staff
              ? 'Aquí aparecerán los reportes, las solicitudes y las alertas del laboratorio.'
              : 'Aquí aparecerán las confirmaciones, recordatorios y mensajes sobre sus reservas.'}
          </Empty>
        </div>
      )}

      {avisos.length > 0 &&
        Object.entries(
          avisos.reduce<Record<string, Aviso[]>>((g, a) => {
            const k = grupoDia(a.creado_en)
            ;(g[k] ??= []).push(a)
            return g
          }, {})
        ).map(([dia, lista]) => (
          <section key={dia} className="notis">
            <h2 className="notis__dia">{dia}</h2>
            {lista.map((a) => {
              const reciente = Date.now() - new Date(a.creado_en).getTime() < 86400000
              const contenido = (
                <>
                  <span className={`notis__icono notis__icono--${tono(a.tipo)}`} aria-hidden="true">
                    <Icon nombre={icono(a.tipo)} width={22} height={22} />
                  </span>
                  <span className="notis__texto">
                    <span className="notis__linea">
                      <strong>{a.titulo ?? 'Novedad en LADME'}</strong>{' '}
                      <time dateTime={a.creado_en} title={fecha(a.creado_en)}>
                        {reciente ? hace(a.creado_en) : hora(a.creado_en)}
                      </time>
                    </span>
                    {a.cuerpo && <span className="notis__cuerpo">{a.cuerpo}</span>}
                  </span>
                  {!a.leido_en && <span className="notis__nuevo" aria-label="Sin leer" />}
                </>
              )
              return a.url ? (
                <Link key={a.id} to={a.url} className="notis__item">
                  {contenido}
                </Link>
              ) : (
                <div key={a.id} className="notis__item">
                  {contenido}
                </div>
              )
            })}
          </section>
        ))}
    </>
  )
}
