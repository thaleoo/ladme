import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import Icon from './Icon'

type Tono = 'ok' | 'danger' | 'warn' | 'info'

interface Aviso {
  id: number
  texto: string
  tono: Tono
}

interface Api {
  mostrar: (texto: string, tono?: Tono) => void
}

const Contexto = createContext<Api>({ mostrar: () => {} })

const ICONO: Record<Tono, 'check-circulo' | 'x-circulo' | 'alerta' | 'info'> = {
  ok: 'check-circulo',
  danger: 'x-circulo',
  warn: 'alerta',
  info: 'info'
}

/** Avisos flotantes breves para confirmar acciones sin recargar la vista. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const contador = useRef(0)

  const quitar = useCallback((id: number) => {
    setAvisos((actuales) => actuales.filter((a) => a.id !== id))
  }, [])

  const mostrar = useCallback(
    (texto: string, tono: Tono = 'ok') => {
      const id = ++contador.current
      setAvisos((actuales) => [...actuales.slice(-2), { id, texto, tono }])
      window.setTimeout(() => quitar(id), 4800)
    },
    [quitar]
  )

  const api = useMemo<Api>(() => ({ mostrar }), [mostrar])

  return (
    <Contexto.Provider value={api}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`toast ${a.tono}`}>
            <Icon nombre={ICONO[a.tono]} />
            <span style={{ flex: 1 }}>{a.texto}</span>
            <button
              type="button"
              className="toast__cerrar"
              onClick={() => quitar(a.id)}
              aria-label="Cerrar aviso"
            >
              <Icon nombre="x" width={15} height={15} />
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  )
}

export function useToast(): Api {
  return useContext(Contexto)
}
