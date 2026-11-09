// Edge Function: envía por Web Push las notificaciones pendientes de la cola.
// Se invoca desde un cron con la clave de servicio; nunca desde el navegador.
//
// Variables de entorno requeridas (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:labdatos_paz@unal.edu.co)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase automáticamente.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

interface Notificacion {
  id: number
  tipo: string
  usuario_id: string
  reserva_id: string | null
  mantenimiento_id: string | null
}

interface Suscripcion {
  endpoint: string
  p256dh: string
  auth: string
}

function contenido(n: Notificacion): { title: string; body: string; url: string; tag: string } {
  switch (n.tipo) {
    case 'confirmacion':
      return {
        title: 'Reserva confirmada',
        body: 'Su reserva quedó registrada. Abra LADME para ver la credencial y el horario.',
        url: '/mis-reservas',
        tag: `reserva-${n.reserva_id}`
      }
    case 'extension':
      return {
        title: 'Reserva extendida',
        body: 'La extensión quedó registrada. Revise el nuevo horario en LADME.',
        url: '/mis-reservas',
        tag: `reserva-${n.reserva_id}`
      }
    case 'liberacion':
      return {
        title: 'Equipo liberado',
        body: 'Gracias por liberar el equipo. Ya está disponible para otra persona.',
        url: '/mis-reservas',
        tag: `reserva-${n.reserva_id}`
      }
    case 'cancelacion':
      return {
        title: 'Reserva cancelada',
        body: 'La reserva fue cancelada. El historial se conserva en LADME.',
        url: '/mis-reservas',
        tag: `reserva-${n.reserva_id}`
      }
    case 'fin_proximo':
      return {
        title: 'Su reserva termina pronto',
        body: 'Si ya terminó, libere el equipo. Si necesita más tiempo, solicite su extensión de hasta 24 h.',
        url: '/mis-reservas',
        tag: `fin-${n.reserva_id}`
      }
    case 'mantenimiento_programado':
      return {
        title: 'Mantenimiento registrado',
        body: 'Se programó una intervención y el equipo quedó bloqueado en ese intervalo.',
        url: '/mantenimiento',
        tag: `mnt-${n.mantenimiento_id}`
      }
    case 'mantenimiento_por_validar':
      return {
        title: 'Mantenimiento por validar',
        body: 'Una intervención fue completada y espera la validación del responsable técnico.',
        url: '/mantenimiento',
        tag: `mnt-${n.mantenimiento_id}`
      }
    case 'mantenimiento_proximo':
      return {
        title: 'Mantenimiento próximo o vencido',
        body: 'Revise las intervenciones programadas y los equipos con mantenimiento pendiente.',
        url: '/mantenimiento',
        tag: `mnt-${n.mantenimiento_id}`
      }
    default:
      return { title: 'LADME', body: 'Tiene una novedad en LADME.', url: '/', tag: 'ladme' }
  }
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const autorizacion = req.headers.get('Authorization') ?? ''
  if (!serviceKey || autorizacion !== `Bearer ${serviceKey}`) {
    return json({ error: 'No autorizado.' }, 401)
  }

  const publica = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const privada = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const asunto = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:labdatos_paz@unal.edu.co'
  if (!publica || !privada) return json({ error: 'Faltan las claves VAPID.' }, 500)

  webpush.setVapidDetails(asunto, publica, privada)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
    { auth: { persistSession: false } }
  )

  const { data: pendientes, error } = await supabase
    .from('cola_notificaciones')
    .select('id, tipo, usuario_id, reserva_id, mantenimiento_id')
    .is('push_enviado_en', null)
    .lt('push_intentos', 5)
    .order('creado_en', { ascending: true })
    .limit(100)

  if (error) return json({ error: error.message }, 500)
  if (!pendientes?.length) return json({ procesadas: 0, enviadas: 0, sin_suscripcion: 0 })

  let enviadas = 0
  let sinSuscripcion = 0

  for (const n of pendientes as Notificacion[]) {
    const { data: suscripciones, error: errSubs } = await supabase
      .from('push_suscripciones')
      .select('endpoint, p256dh, auth')
      .eq('usuario_id', n.usuario_id)

    if (errSubs) {
      console.error('No se pudieron leer las suscripciones:', errSubs.message)
      continue
    }

    if (!suscripciones?.length) {
      sinSuscripcion++
      await supabase
        .from('cola_notificaciones')
        .update({ push_intentos: 5 })
        .eq('id', n.id)
      continue
    }

    const carga = JSON.stringify(contenido(n))
    let alguna = false

    for (const s of suscripciones as Suscripcion[]) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga,
          { TTL: 3600, urgency: 'normal' }
        )
        alguna = true
      } catch (e) {
        const estado = (e as { statusCode?: number }).statusCode
        if (estado === 404 || estado === 410) {
          // El navegador invalidó la suscripción: se elimina.
          await supabase.from('push_suscripciones').delete().eq('endpoint', s.endpoint)
        } else {
          console.error('Error de Web Push:', estado, (e as Error).message)
        }
      }
    }

    if (alguna) {
      enviadas++
      await supabase
        .from('cola_notificaciones')
        .update({ push_enviado_en: new Date().toISOString() })
        .eq('id', n.id)
    } else {
      await supabase.rpc('incrementar_push_intentos', { p_id: n.id })
    }
  }

  return json({ procesadas: pendientes.length, enviadas, sin_suscripcion: sinSuscripcion })
})
