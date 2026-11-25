import { useCallback, useEffect, useState } from 'react'
import { reglamentoVigente } from './api'
import type { ReglamentoVigente } from './types'

/** La versión vigente del reglamento. `datos` es null si la base de datos aún no tiene la migración 0022. */
export function useReglamento() {
  const [datos, setDatos] = useState<ReglamentoVigente | null>(null)
  const [cargando, setCargando] = useState(true)

  const recargar = useCallback(async () => {
    setDatos(await reglamentoVigente().catch(() => null))
    setCargando(false)
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  return { datos, cargando, recargar }
}
