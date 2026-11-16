import { useEffect, useState } from 'react'
import { reportarFalla } from '../lib/api'
import { CATEGORIAS_FALLA } from '../lib/types'
import Icon from './Icon'
import Modal from './Modal'
import { useToast } from './Toast'

/** Formulario para que cualquier usuario reporte un problema con un equipo. */
export default function ReporteFalla({
  equipo,
  abierto,
  alCerrar,
  alEnviar
}: {
  equipo: string
  abierto: boolean
  alCerrar: () => void
  alEnviar?: () => void
}) {
  const toast = useToast()
  const [categoria, setCategoria] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (abierto) {
      setCategoria('')
      setDescripcion('')
      setError(null)
    }
  }, [abierto])

  async function enviar() {
    setError(null)
    if (!categoria) return setError('Seleccione el tipo de problema.')
    if (descripcion.trim().length < 5) return setError('Cuente brevemente qué pasa.')
    setEnviando(true)
    try {
      await reportarFalla(equipo, categoria, descripcion.trim())
      toast.mostrar('Reporte enviado. El laboratorio ya fue avisado.')
      alCerrar()
      alEnviar?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el reporte.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo={`Reportar un problema en ${equipo}`}
      descripcion="Le llega de inmediato al personal del laboratorio. Recibirá la respuesta en sus avisos."
      onCerrar={alCerrar}
      pie={
        <>
          <button className="btn gray" type="button" onClick={alCerrar} disabled={enviando}>
            Volver
          </button>
          <button className="btn" type="button" onClick={enviar} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar reporte'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>
          <span className="field__label">¿Qué pasa?</span>
          <div className="chips">
            {CATEGORIAS_FALLA.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={c === categoria} onClick={() => setCategoria(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="falla-desc">
            Descripción
          </label>
          <textarea
            id="falla-desc"
            rows={3}
            maxLength={800}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej. Se apaga solo a los pocos minutos de abrir RStudio."
          />
        </div>
        {error && (
          <div className="alert danger">
            <Icon nombre="alerta" />
            <div className="alert__body">{error}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}
