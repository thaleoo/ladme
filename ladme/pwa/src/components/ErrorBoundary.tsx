import { Component, type ErrorInfo, type ReactNode } from 'react'
import { esErrorDeCarga, registrarError } from '../lib/telemetria'
import { limpiarYRecargar } from '../lib/sw'

interface Estado {
  error: Error | null
}

/** Si una pantalla falla, muestra una salida en vez de dejarla en blanco. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { error: null }

  static getDerivedStateFromError(error: Error): Estado {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    registrarError(esErrorDeCarga(error) ? 'chunk' : 'render', error.message, `${error.stack ?? ''}\n${info.componentStack ?? ''}`)
  }

  render() {
    if (!this.state.error) return this.props.children
    const carga = esErrorDeCarga(this.state.error)
    return (
      <div className="fallo">
        <div className="fallo__caja">
          <h2>{carga ? 'Hay una versión nueva de LADME' : 'Algo salió mal'}</h2>
          <p className="small muted">
            {carga
              ? 'Esta pantalla pertenece a una versión anterior. Recargue para continuar.'
              : 'El error ya quedó registrado para el laboratorio. Recargar suele resolverlo.'}
          </p>
          <div className="row" style={{ gap: 'var(--s2)', justifyContent: 'center' }}>
            <button className="btn" type="button" onClick={() => window.location.reload()}>
              Recargar
            </button>
            <button className="btn gray" type="button" onClick={() => void limpiarYRecargar()}>
              Limpiar y recargar
            </button>
          </div>
        </div>
      </div>
    )
  }
}
