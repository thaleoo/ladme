import { supabase, vapidPublicKey } from './supabase'

export interface EstadoAvisos {
  soportado: boolean
  motivo?: string
  permiso: NotificationPermission | 'desconocido'
  configurado: boolean
}

export function estadoAvisos(): EstadoAvisos {
  const soportado =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  const permiso: NotificationPermission | 'desconocido' =
    typeof Notification !== 'undefined' ? Notification.permission : 'desconocido'
  return {
    soportado,
    permiso,
    configurado: !!vapidPublicKey,
    motivo: !soportado
      ? 'Este navegador no admite notificaciones push.'
      : !vapidPublicKey
        ? 'Falta configurar VITE_VAPID_PUBLIC_KEY en el despliegue.'
        : undefined
  }
}

function base64UrlABytes(base64: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(normal)
  const bytes = new Uint8Array(crudo.length)
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
  return bytes
}

async function guardarSuscripcion(suscripcion: PushSubscription): Promise<void> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Debe iniciar sesión para activar los avisos.')
  const json = suscripcion.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('El navegador devolvió una suscripción incompleta.')
  }
  const { error: err } = await supabase.from('push_suscripciones').upsert(
    {
      usuario_id: data.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300)
    },
    { onConflict: 'endpoint' }
  )
  if (err) throw new Error(`No se pudo guardar la suscripción: ${err.message}`)
}

/** Pide permiso y registra este dispositivo para Web Push. */
export async function activarAvisos(): Promise<{ ok: boolean; mensaje: string }> {
  const estado = estadoAvisos()
  if (!estado.soportado) return { ok: false, mensaje: estado.motivo ?? 'Avisos no disponibles.' }
  if (!estado.configurado) return { ok: false, mensaje: estado.motivo ?? 'Avisos no configurados.' }

  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    return {
      ok: false,
      mensaje:
        permiso === 'denied'
          ? 'El navegador bloqueó los avisos. Habilítelos en la configuración del sitio.'
          : 'No se concedió permiso para mostrar avisos.'
    }
  }

  try {
    const registro = await navigator.serviceWorker.getRegistration()
    if (!registro) throw new Error('La aplicación aún no está lista para avisos. Recargue la página e intente de nuevo.')
    const existente = await registro.pushManager.getSubscription()
    const suscripcion =
      existente ??
      (await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlABytes(vapidPublicKey) as BufferSource
      }))
    await guardarSuscripcion(suscripcion)
    return { ok: true, mensaje: 'Avisos activados en este dispositivo.' }
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No se pudieron activar los avisos.' }
  }
}

/** Quita este dispositivo de la lista de avisos. */
export async function desactivarAvisos(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registro = await navigator.serviceWorker.getRegistration()
    if (!registro) return
    const suscripcion = await registro.pushManager.getSubscription()
    if (!suscripcion) return
    const endpoint = suscripcion.endpoint
    await suscripcion.unsubscribe()
    await supabase.from('push_suscripciones').delete().eq('endpoint', endpoint)
  } catch {
    // Silencioso: el usuario puede volver a activarlos.
  }
}
