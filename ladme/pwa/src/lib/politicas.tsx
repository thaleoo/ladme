import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listarPoliticas } from './api'
import { EXTENSIONES_MAX, MAX_HORAS_EXTENSION, MAX_HORAS_RESERVA, MAX_HORAS_TOTAL } from './format'

/** Límites vigentes. Los valores por defecto solo se usan mientras llega la base de datos. */
export interface Limites {
  maxHoras: number
  maxExtension: number
  maxTotal: number
  extensionesMax: number
  anticipacionDias: number
  toleranciaMin: number
  excepcionMaxHoras: number
  recargar: () => Promise<void>
}

const POR_DEFECTO: Limites = {
  maxHoras: MAX_HORAS_RESERVA,
  maxExtension: MAX_HORAS_EXTENSION,
  maxTotal: MAX_HORAS_TOTAL,
  extensionesMax: EXTENSIONES_MAX,
  anticipacionDias: 30,
  toleranciaMin: 30,
  excepcionMaxHoras: 720,
  recargar: async () => {}
}

const Contexto = createContext<Limites>(POR_DEFECTO)

export function PoliticasProvider({ children }: { children: ReactNode }) {
  const [valores, setValores] = useState<Record<string, number>>({})

  const recargar = useCallback(async () => {
    try {
      const lista = await listarPoliticas()
      setValores(Object.fromEntries(lista.map((p) => [p.clave, p.valor])))
    } catch {
      // Sin conexión: se conservan los valores por defecto; el servidor valida de todos modos.
    }
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  const limites = useMemo<Limites>(
    () => ({
      maxHoras: valores.duracion_max_horas ?? POR_DEFECTO.maxHoras,
      maxExtension: valores.extension_max_horas ?? POR_DEFECTO.maxExtension,
      maxTotal: valores.duracion_max_total_horas ?? POR_DEFECTO.maxTotal,
      extensionesMax: valores.extensiones_max ?? POR_DEFECTO.extensionesMax,
      anticipacionDias: valores.anticipacion_max_dias ?? POR_DEFECTO.anticipacionDias,
      toleranciaMin: valores.tolerancia_llegada_min ?? POR_DEFECTO.toleranciaMin,
      excepcionMaxHoras: valores.excepcion_max_horas ?? POR_DEFECTO.excepcionMaxHoras,
      recargar
    }),
    [valores, recargar]
  )

  return <Contexto.Provider value={limites}>{children}</Contexto.Provider>
}

export function useLimites(): Limites {
  return useContext(Contexto)
}
