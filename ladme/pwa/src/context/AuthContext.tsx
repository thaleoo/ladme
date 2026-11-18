import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { obtenerPerfil } from '../lib/api'
import { mensajeError } from '../lib/errores'
import { borrarCache } from '../lib/cacheLocal'
import type { Perfil } from '../lib/types'

interface AuthState {
  session: Session | null
  perfil: Perfil | null
  cargando: boolean
  error: string | null
  /** Envía al correo un código de 6 dígitos (y un enlace, por si la plantilla lo conserva). */
  enviarEnlace: (correo: string) => Promise<{ ok: boolean; mensaje: string }>
  verificarCodigo: (correo: string, codigo: string) => Promise<{ ok: boolean; mensaje: string }>
  entrarConGoogle: () => Promise<{ ok: boolean; mensaje: string }>
  salir: () => Promise<void>
  recargarPerfil: () => Promise<void>
  /** Vuelve a intentar el arranque después de un error de conexión. */
  reintentar: () => void
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

  // Arranque. Reglas para no quedar «cargando» para siempre:
  //  * El aviso onAuthStateChange NO puede esperar consultas a Supabase: la
  //    librería mantiene un candado mientras corre y una consulta adentro puede
  //    trabarla (documentado por Supabase). El perfil se pide después, aparte.
  //  * Cada paso tiene un límite de tiempo; si se vence, se muestra un error con
  //    opción de reintentar en lugar de esperar indefinidamente.
  const [intento, setIntento] = useState(0)
  const reintentar = useCallback(() => {
    setError(null)
    setCargando(true)
    setIntento((n) => n + 1)
  }, [])

  useEffect(() => {
    let vivo = true
    const conLimite = <T,>(promesa: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promesa,
        new Promise<T>((_, rechazar) => window.setTimeout(() => rechazar(new Error('tiempo')), ms))
      ])

    const aplicar = async (nueva: Session | null) => {
      if (!vivo) return
      setSession(nueva)
      if (!nueva) {
        setPerfil(null)
        setCargando(false)
        return
      }
      try {
        await conLimite(cargarPerfil(), 10000)
      } catch {
        if (vivo) setError('No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.')
      } finally {
        if (vivo) setCargando(false)
      }
    }

    conLimite(supabase.auth.getSession(), 10000)
      .then(({ data }) => aplicar(data.session ?? null))
      .catch(() => {
        if (!vivo) return
        setError('No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.')
        setCargando(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((evento, nueva) => {
      // La renovación del token no cambia el perfil: no hace falta pedirlo de nuevo.
      if (evento === 'TOKEN_REFRESHED') {
        setSession(nueva)
        return
      }
      if (evento === 'INITIAL_SESSION') return // ya lo atiende getSession()
      window.setTimeout(() => void aplicar(nueva), 0)
    })

    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [cargarPerfil, intento])

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
      return { ok: true, mensaje: 'Le enviamos un código de acceso a su correo institucional.' }
    } catch (e) {
      console.error('Supabase Auth (signInWithOtp):', e)
      return { ok: false, mensaje: mensajeError(e, 'No se pudo enviar el enlace de acceso.') }
    }
  }, [])

  const verificarCodigo = useCallback(async (correo: string, codigo: string) => {
    const limpio = codigo.replace(/\D/g, '')
    if (limpio.length < 6) return { ok: false, mensaje: 'Escriba el código completo que llegó a su correo.' }
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email: correo.trim().toLowerCase(),
        token: limpio,
        type: 'email'
      })
      if (err) {
        console.error('Supabase Auth (verifyOtp):', err)
        const vencido = err.code === 'otp_expired' || /expired|invalid/i.test(err.message ?? '')
        return {
          ok: false,
          mensaje: vencido
            ? 'El código no es válido o ya venció. Pida uno nuevo.'
            : mensajeError(err, 'No se pudo verificar el código.')
        }
      }
      return { ok: true, mensaje: 'Código verificado.' }
    } catch (e) {
      return { ok: false, mensaje: mensajeError(e, 'No se pudo verificar el código.') }
    }
  }, [])

  // Google solo confirma la identidad. La base de datos rechaza cualquier cuenta
  // que no sea @unal.edu.co; `hd` únicamente preselecciona el dominio.
  const entrarConGoogle = useCallback(async () => {
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { hd: 'unal.edu.co', prompt: 'select_account' }
        }
      })
      if (err) {
        console.error('Supabase Auth (signInWithOAuth):', err)
        return { ok: false, mensaje: mensajeError(err, 'No se pudo abrir el ingreso con Google.') }
      }
      return { ok: true, mensaje: 'Abriendo Google…' }
    } catch (e) {
      return { ok: false, mensaje: mensajeError(e, 'No se pudo abrir el ingreso con Google.') }
    }
  }, [])

  const salir = useCallback(async () => {
    borrarCache()
    try {
      await Promise.race([supabase.auth.signOut(), new Promise((r) => window.setTimeout(r, 5000))])
    } catch {
      // Aunque el servidor no responda, la sesión local se cierra.
    }
    setSession(null)
    setPerfil(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session, perfil, cargando, error, enviarEnlace, verificarCodigo, entrarConGoogle, salir,
      recargarPerfil: cargarPerfil, reintentar
    }),
    [session, perfil, cargando, error, enviarEnlace, verificarCodigo, entrarConGoogle, salir, cargarPerfil, reintentar]
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
