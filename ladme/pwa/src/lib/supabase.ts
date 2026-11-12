import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Falla temprano y con un mensaje claro en lugar de errores crípticos de red.
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copie .env.example a .env.local.')
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // `implicit` en lugar de `pkce`: con PKCE el enlace mágico solo funciona en
    // el mismo navegador donde se solicitó (el verificador queda en
    // localStorage). Los usuarios piden el enlace en el computador y lo abren
    // en el celular, o abren el correo en el navegador y no dentro de la PWA
    // instalada. Con implicit el enlace sirve en cualquier dispositivo.
    flowType: 'implicit'
  }
})

export const publicUrl = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '')
export const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
