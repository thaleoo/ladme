import { useState } from 'react'
import { createPortal } from 'react-dom'
import { aceptarReglamento } from '../lib/api'
import { REGLAMENTO } from '../lib/reglamento'
import { useAuth } from '../context/AuthContext'
import Icon from './Icon'

/** Pantalla que se muestra una sola vez: sin aceptar el reglamento no se puede reservar. */
export default function Reglamento() {
  const { recargarPerfil, salir } = useAuth()
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function aceptar() {
    setGuardando(true)
    setError(null)
    try {
      await aceptarReglamento()
      await recargarPerfil()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la aceptación.')
      setGuardando(false)
    }
  }

  // Se monta en <body> para quedar por encima de la barra de navegación.
  return createPortal(
    <div className="reglamento" role="dialog" aria-modal="true" aria-labelledby="reglamento-titulo">
      <div className="reglamento__caja">
        <h2 id="reglamento-titulo">Antes de empezar</h2>
        <p className="small muted">Estas son las reglas de uso del laboratorio. Solo se aceptan una vez.</p>
        <ol className="reglamento__lista">
          {REGLAMENTO.map((r) => (
            <li key={r.titulo}>
              <strong>{r.titulo}</strong>
              <span>{r.texto}</span>
            </li>
          ))}
        </ol>
        {error && (
          <div className="alert danger">
            <Icon nombre="alerta" />
            <div className="alert__body">{error}</div>
          </div>
        )}
        <div className="reglamento__pie">
          <button className="btn gray" type="button" onClick={() => void salir()} disabled={guardando}>
            Salir
          </button>
          <button className="btn lg" type="button" onClick={aceptar} disabled={guardando}>
            <Icon nombre="check" /> {guardando ? 'Guardando…' : 'Acepto el reglamento'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
