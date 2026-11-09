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
    flowType: 'pkce'
  }
})

export const publicUrl = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '')
export const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
