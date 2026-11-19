import { useEffect, useState } from 'react'
import { telegramCodigo, telegramDesvincular, telegramMiVinculo } from '../lib/api'
import { hace } from '../lib/format'
import Icon from './Icon'

/**
 * Vincula la cuenta de Telegram de esta persona del personal: con eso, el bot del grupo acepta sus
 * órdenes (/aprobar, /liberar, /apagar…) y las ejecuta a su nombre, con sus mismos permisos.
 */
export default function VinculoTelegram() {
  const [vinculo, setVinculo] = useState<{ nombre: string | null; creado_en: string } | null | undefined>(undefined)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = () => telegramMiVinculo().then(setVinculo).catch(() => setVinculo(null))
  useEffect(() => {
    void cargar()
  }, [])
  // Mientras hay un código a la vista, se revisa cada pocos segundos si ya se usó.
  useEffect(() => {
    if (!codigo) return
    const t = window.setInterval(() => {
      void telegramMiVinculo().then((v) => {
        if (v) {
          setVinculo(v)
          setCodigo(null)
        }
      })
    }, 5000)
    return () => window.clearInterval(t)
  }, [codigo])

  async function hacer(f: () => Promise<void>) {
    setOcupado(true)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="card tight telegram-card">
      <div className="telegram-card__cab">
        <span className="telegram-card__icono" aria-hidden="true">
          <Icon nombre="compartir" width={18} height={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>Telegram</strong>
          <p className="tiny muted" style={{ margin: '2px 0 0' }}>
            {vinculo === undefined
              ? 'Consultando…'
              : vinculo
                ? `Vinculado${vinculo.nombre ? ` como ${vinculo.nombre}` : ''} ${hace(vinculo.creado_en)}. El bot acepta sus órdenes en el grupo.`
                : 'Vincule su cuenta para dar órdenes desde el grupo del personal.'}
          </p>
        </div>
        {vinculo ? (
          <button className="btn ghost sm" type="button" disabled={ocupado}
                  onClick={() => void hacer(async () => { await telegramDesvincular(); setVinculo(null) })}>
            Desvincular
          </button>
        ) : (
          vinculo === null && !codigo && (
            <button className="btn sm" type="button" disabled={ocupado} onClick={() => void hacer(async () => setCodigo(await telegramCodigo()))}>
              Vincular
            </button>
          )
        )}
      </div>
      {codigo && (
        <div className="telegram-card__codigo">
          <span className="small">Escriba esto en el grupo del personal (vence en 10 minutos):</span>
          <code className="num">/vincular {codigo}</code>
        </div>
      )}
      {error && <p className="small" style={{ color: 'var(--danger-fg)', margin: 0 }}>{error}</p>}
      <details className="plegable telegram-card__ayuda">
        <summary className="small">Comandos del bot</summary>
        <ul className="tiny muted">
          <li><code>/estado</code>, <code>/equipos</code>, <code>/agenda 5</code>, <code>/reservas</code>, <code>/clases</code>: consultas (cualquiera del grupo).</li>
          <li><code>/aprobar 12</code> · <code>/rechazar 12 motivo</code>: solicitudes de sala para clases.</li>
          <li><code>/liberar 7</code> · <code>/bloquear 5 2h motivo</code> · <code>/desbloquear 5 1h</code></li>
          <li><code>/anuncio 3h texto</code> · <code>/encender 3 4</code> · <code>/apagar sala</code> · <code>/reiniciar 5</code> · <code>/actualizar sala</code></li>
          <li>Las órdenes para toda la sala y los apagados piden confirmar con <code>/si</code>. Todo queda en el Registro a su nombre.</li>
        </ul>
      </details>
    </section>
  )
}
