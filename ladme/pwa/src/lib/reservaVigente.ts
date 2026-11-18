import { useEffect, useState } from 'react'
import { esStaff, useAuth } from '../context/AuthContext'
import { misReservas } from './api'
import { useLimites } from './politicas'
import type { Reserva } from './types'

/**
 * Si la persona ya llegó al máximo de reservas a la vez (por defecto, una), devuelve esas reservas
 * para explicarlo ANTES de que llene el formulario. El personal está exento. El servidor valida de
 * todos modos (crear_reserva), así que esto es solo para que la persona entienda qué pasa.
 */
export function useTopeReservas(): { vigentes: Reserva[]; alcanzado: boolean; cargando: boolean } {
  const { perfil } = useAuth()
  const { reservasALaVez } = useLimites()
  const [vigentes, setVigentes] = useState<Reserva[]>([])
  const [cargando, setCargando] = useState(true)
  const aplica = !!perfil && !esStaff(perfil) && reservasALaVez > 0

  useEffect(() => {
    if (!aplica) {
      setVigentes([])
      setCargando(false)
      return
    }
    let vivo = true
    misReservas()
      .then((lista) => {
        if (!vivo) return
        const ahora = Date.now()
        setVigentes(
          lista
            .filter((r) => r.tipo === 'reserva' && r.estado === 'activa' && !r.liberada_en && new Date(r.fin).getTime() > ahora)
            .sort((a, b) => a.inicio.localeCompare(b.inicio))
        )
      })
      .catch(() => vivo && setVigentes([]))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [aplica, perfil?.id])

  return { vigentes, alcanzado: aplica && vigentes.length >= reservasALaVez, cargando }
}
