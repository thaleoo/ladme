import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { obtenerPerfil } from '../lib/api'
import { mensajeError } from '../lib/errores'
import type { Perfil } from '../lib/types'

interface AuthState {
  session: Session | null
  perfil: Perfil | null
  cargando: boolean
  error: string | null
  enviarEnlace: (correo: string) => Promise<{ ok: boolean; mensaje: string }>
  salir: () => Promise<void>
  recargarPerfil: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarPerfil = useCallback(async () => {
    try {
      const p = await obtenerPerfil()
      setPerfil(p)
      setError(p && !p.activo ? 'Su cuenta institucional aún no está habilitada por la administración.' : null)
    } catch (e) {
      setPerfil(null)
      setError(mensajeError(e, 'No se pudo cargar el perfil.'))
    }
  }, [])

  useEffect(() => {
    let vivo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      setSession(data.session ?? null)
      if (data.session) await cargarPerfil()
      setCargando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nueva) => {
      setSession(nueva)
      if (nueva) {
        await cargarPerfil()
      } else {
        setPerfil(null)
      }
      setCargando(false)
    })

    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [cargarPerfil])

  const enviarEnlace = useCallback(async (correo: string) => {
    const limpio = correo.trim().toLowerCase()
    if (!/^[^\s@]+@unal\.edu\.co$/.test(limpio)) {
      return { ok: false, mensaje: 'Use su correo institucional @unal.edu.co.' }
    }
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: limpio,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      })
      if (err) {
        // Se conserva el objeto completo en la consola: el texto que ve el
        // usuario es amable, pero el diagnóstico técnico no debe perderse.
        console.error('Supabase Auth (signInWithOtp):', err)
        return { ok: false, mensaje: mensajeError(err, 'No se pudo enviar el enlace de acceso.') }
      }
      return { ok: true, mensaje: 'Le enviamos un enlace de acceso a su correo institucional.' }
    } catch (e) {
      console.error('Supabase Auth (signInWithOtp):', e)
      return { ok: false, mensaje: mensajeError(e, 'No se pudo enviar el enlace de acceso.') }
    }
  }, [])

  const salir = useCallback(async () => {
    await supabase.auth.signOut()
    setPerfil(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, perfil, cargando, error, enviarEnlace, salir, recargarPerfil: cargarPerfil }),
    [session, perfil, cargando, error, enviarEnlace, salir, cargarPerfil]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

export function esStaff(p: Perfil | null): boolean {
  return !!p && (p.rol === 'laboratorista' || p.rol === 'administrador')
}

export function esAdmin(p: Perfil | null): boolean {
  return !!p && p.rol === 'administrador'
}

export function puedeValidarMantenimiento(p: Perfil | null): boolean {
  return esAdmin(p) || !!p?.permisos?.includes('validar_mantenimiento')
}
