import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { atenderReporte, listarReportes } from '../../lib/api'
import type { DiagnosticoFaro, Reporte } from '../../lib/types'
import { hace } from '../../lib/format'
import { descargarCSV } from '../../lib/csv'
import { Cargando, Empty } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

const ESTADO: Record<Reporte['estado'], { texto: string; tono: string }> = {
  abierto: { texto: 'Nuevo', tono: 'danger' },
  en_revision: { texto: 'En revisión', tono: 'warn' },
  resuelto: { texto: 'Resuelto', tono: 'ok' },
  descartado: { texto: 'Descartado', tono: 'gray' }
}

/** Reportes de fallas enviados por los usuarios. */
export default function Reportes() {
  const toast = useToast()
  const [lista, setLista] = useState<Reporte[]>([])
  const [soloAbiertos, setSoloAbiertos] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<{ r: Reporte; estado: 'resuelto' | 'descartado' } | null>(null)
  const [respuesta, setRespuesta] = useState('')
  const [fuera, setFuera] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setLista(await listarReportes())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los reportes.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function revisar(r: Reporte) {
    setOcupado(true)
    try {
      await atenderReporte(r.id, 'en_revision', '', false)
      toast.mostrar('Marcado en revisión. Se avisó a quien reportó.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el reporte.')
    } finally {
      setOcupado(false)
    }
  }

  async function cerrar() {
    if (!dialogo) return
    if (respuesta.trim().length < 3) return setError('Escriba una respuesta para quien reportó.')
    setOcupado(true)
    try {
      await atenderReporte(dialogo.r.id, dialogo.estado, respuesta.trim(), fuera)
      toast.mostrar('Reporte cerrado. Se envió la respuesta.')
      setDialogo(null)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el reporte.')
    } finally {
      setOcupado(false)
    }
  }

  const abiertos = lista.filter((r) => r.estado === 'abierto' || r.estado === 'en_revision')
  const visibles = soloAbiertos ? abiertos : lista

  if (cargando) return <Cargando texto="Cargando reportes…" />

  return (
    <>
      <div className="row between">
        <div className="segmented" role="group" aria-label="Filtro">
          <button type="button" className={soloAbiertos ? 'activo' : ''} onClick={() => setSoloAbiertos(true)}>
            Pendientes {abiertos.length}
          </button>
          <button type="button" className={!soloAbiertos ? 'activo' : ''} onClick={() => setSoloAbiertos(false)}>
            Todos {lista.length}
          </button>
        </div>
        <button
          className="btn ghost sm"
          type="button"
          disabled={!lista.length}
          onClick={() =>
            descargarCSV(
              'reportes-ladme.csv',
              ['Fecha', 'Equipo', 'Tipo', 'Descripción', 'Reportó', 'Correo', 'Estado', 'Respuesta'],
              lista.map((r) => [r.creado_en, r.equipos?.codigo, r.categoria, r.descripcion, r.autor?.nombre ?? 'Desde el equipo', r.autor?.correo ?? '', ESTADO[r.estado].texto, r.respuesta])
            )
          }
        >
          <Icon nombre="descargar" /> CSV
        </button>
      </div>

      {error && !dialogo && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {visibles.length === 0 && (
        <div className="card">
          <Empty icono="check-circulo" titulo={soloAbiertos ? 'Sin reportes pendientes' : 'Aún no hay reportes'}>
            Los usuarios reportan desde la ficha de cada equipo.
          </Empty>
        </div>
      )}

      <div className="grid" style={{ gap: 'var(--s3)' }}>
        {visibles.map((r) => {
          const abierto = r.estado === 'abierto' || r.estado === 'en_revision'
          return (
            <article key={r.id} className="card">
              <div className="row tight">
                <strong style={{ fontSize: 'var(--text-lg)' }}>{r.equipos?.codigo}</strong>
                <span className={`badge ${ESTADO[r.estado].tono}`}>{ESTADO[r.estado].texto}</span>
                <span className="badge outline">{r.categoria}</span>
                {r.equipos?.estado !== 'activo' && <span className="badge gray">equipo {r.equipos?.estado.replace(/_/g, ' ')}</span>}
              </div>
              <p className="small" style={{ margin: 'var(--s2) 0 0' }}>
                {r.descripcion}
              </p>
              <p className="tiny muted" style={{ margin: '4px 0 0', wordBreak: 'break-all' }}>
                {r.autor ? `${r.autor.nombre} · ${r.autor.correo}` : 'Desde el equipo (Faro)'} · {hace(r.creado_en)}
              </p>
              {r.diagnostico && <Diagnostico d={r.diagnostico} />}
              {r.respuesta && (
                <p className="small" style={{ margin: '4px 0 0' }}>
                  <span className="muted">Respuesta:</span> {r.respuesta}
                </p>
              )}
              {abierto && (
                <div className="row mt" style={{ gap: 'var(--s2)' }}>
                  {r.estado === 'abierto' && (
                    <button className="btn ghost sm" type="button" disabled={ocupado} onClick={() => revisar(r)}>
                      En revisión
                    </button>
                  )}
                  <button
                    className="btn ok sm"
                    type="button"
                    onClick={() => {
                      setError(null)
                      setRespuesta('')
                      setFuera(false)
                      setDialogo({ r, estado: 'resuelto' })
                    }}
                  >
                    <Icon nombre="check" /> Resolver
                  </button>
                  <Link
                    className="btn ghost sm"
                    to={`/mantenimiento?equipo=${r.equipos?.codigo}&descripcion=${encodeURIComponent(`${r.categoria}: ${r.descripcion}`.slice(0, 300))}`}
                  >
                    <Icon nombre="llave" /> Programar mantenimiento
                  </Link>
                  <button
                    className="btn gray sm"
                    type="button"
                    onClick={() => {
                      setError(null)
                      setRespuesta('')
                      setFuera(false)
                      setDialogo({ r, estado: 'descartado' })
                    }}
                  >
                    Descartar
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <Modal
        abierto={!!dialogo}
        titulo={dialogo?.estado === 'resuelto' ? 'Resolver el reporte' : 'Descartar el reporte'}
        descripcion={dialogo ? `${dialogo.r.equipos?.codigo} · ${dialogo.r.categoria}` : undefined}
        onCerrar={() => setDialogo(null)}
        pie={
          <>
            <button className="btn gray" type="button" onClick={() => setDialogo(null)} disabled={ocupado}>
              Volver
            </button>
            <button className="btn" type="button" onClick={cerrar} disabled={ocupado}>
              {ocupado ? 'Guardando…' : 'Cerrar y responder'}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="rep-respuesta">
              Respuesta para quien reportó
            </label>
            <textarea
              id="rep-respuesta"
              rows={3}
              maxLength={500}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              placeholder={dialogo?.estado === 'resuelto' ? 'Ej. Se reemplazó el cable de video.' : 'Ej. No se pudo reproducir el problema.'}
            />
          </div>
          {dialogo?.estado === 'resuelto' && dialogo.r.equipos?.estado === 'activo' && (
            <label className="check-row">
              <input type="checkbox" checked={fuera} onChange={(e) => setFuera(e.target.checked)} />
              <span>
                <strong>Dejar el equipo fuera de servicio</strong>
                No se podrá reservar hasta que lo reactive en «Equipos». Las reservas ya hechas no se cancelan solas.
              </span>
            </label>
          )}
          {error && (
            <div className="alert danger">
              <Icon nombre="alerta" />
              <div className="alert__body">{error}</div>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

/** Lo que Faro sabía del equipo cuando se reportó la falla. */
function Diagnostico({ d }: { d: DiagnosticoFaro }) {
  const datos = [
    d.en_linea ? 'Faro en línea' : `Faro sin señal${d.ultimo_latido ? ` desde ${hace(d.ultimo_latido)}` : ''}`,
    d.cpu_pct != null && d.en_linea ? `CPU ${d.cpu_pct} %` : null,
    d.ram_gb ? `RAM ${d.ram_gb} GB` : null,
    d.disco_libre_gb != null && d.disco_gb ? `disco ${d.disco_libre_gb} de ${d.disco_gb} GB libres` : null,
    d.disco_salud && d.disco_salud !== 'ok' ? `salud del disco: ${d.disco_salud}` : null,
    d.arranque_h != null ? `encendido hace ${d.arranque_h} h` : null,
    d.bloqueado ? 'pantalla bloqueada' : null,
    d.version ? `Faro ${d.version}` : null
  ].filter(Boolean)
  return (
    <p className="tiny diagnostico" style={{ margin: '6px 0 0' }}>
      <strong>Diagnóstico automático:</strong> {datos.join(' · ')}
    </p>
  )
}
