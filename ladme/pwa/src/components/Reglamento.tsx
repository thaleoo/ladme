import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { aceptarReglamento } from '../lib/api'
import { REGLAMENTO_POR_DEFECTO } from '../lib/reglamento'
import { useReglamento } from '../lib/useReglamento'
import { useAuth } from '../context/AuthContext'
import ListaReglas from './ListaReglas'
import Icon from './Icon'

/**
 * Pantalla de lectura obligatoria: aparece la primera vez y cada vez que la administración publica un cambio de fondo.
 * El botón se activa al llegar al final del texto. El servidor también exige haberlo aceptado para reservar.
 */
export default function Reglamento() {
  const { perfil, recargarPerfil, salir } = useAuth()
  const { datos, cargando } = useReglamento()
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leido, setLeido] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  // Si la base de datos no responde con la versión vigente se usa el comportamiento de siempre.
  const debe = datos ? datos.debe_aceptar : !perfil?.reglamento_aceptado_en
  const reglas = datos?.reglas ?? REGLAMENTO_POR_DEFECTO
  const visible = !cargando && debe && !hecho

  const revisar = useCallback(() => {
    const c = caja.current
    if (c && c.scrollTop + c.clientHeight >= c.scrollHeight - 12) setLeido(true)
  }, [])

  // Si el texto cabe sin desplazarse (pantalla grande) no hay nada que leer hasta el final.
  useLayoutEffect(() => {
    if (!visible) return
    revisar()
    const c = caja.current
    if (!c || typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(revisar)
    o.observe(c)
    return () => o.disconnect()
  }, [visible, revisar])

  async function aceptar() {
    setGuardando(true)
    setError(null)
    try {
      await aceptarReglamento()
      setHecho(true)
      await recargarPerfil()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la aceptación.')
      setGuardando(false)
    }
  }

  if (!visible) return null
  const cambio = !!datos?.aceptada_version

  // Se monta en <body> para quedar por encima de la barra de navegación.
  return createPortal(
    <div className="reglamento" role="dialog" aria-modal="true" aria-labelledby="reglamento-titulo">
      <div className="reglamento__caja" ref={caja} onScroll={revisar}>
        <h2 id="reglamento-titulo">{cambio ? 'Las reglas de uso cambiaron' : 'Antes de empezar'}</h2>
        <p className="small muted">
          {cambio ? 'Léalas de nuevo hasta el final para seguir reservando.' : 'Estas son las reglas de uso del laboratorio. Léalas hasta el final: solo se aceptan una vez.'}
        </p>
        {cambio && datos?.nota && (
          <div className="alert info">
            <Icon nombre="info" />
            <div className="alert__body">
              <strong>Qué cambió.</strong> {datos.nota}
            </div>
          </div>
        )}
        <ListaReglas reglas={reglas} />
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
          <button className="btn lg" type="button" onClick={aceptar} disabled={guardando || !leido}>
            <Icon nombre="check" /> {guardando ? 'Guardando…' : leido ? 'Acepto las reglas' : 'Lea hasta el final'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
