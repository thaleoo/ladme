// Edge Function: bot de Telegram del laboratorio, por webhook (responde al instante).
//
// Telegram llama a esta función con cada mensaje del grupo y con cada botón que alguien toque.
// Solo atiende el chat del personal (TELEGRAM_CHAT_ID) y solo si la petición trae la clave
// secreta del webhook. Las acciones las ejecuta la base de datos COMO la persona que escribió
// (telegram_ejecutar → mismas reglas y permisos que la app) y quedan en el Registro.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET (una cadena aleatoria larga,
//   la misma que la propiedad del mismo nombre en el Apps Script).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las pone Supabase.
// Se despliega SIN verificación de JWT (Telegram no manda uno): la protege la clave secreta.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Se limpian espacios y comillas por si el secreto se pegó con ellos.
const limpio = (v: string | undefined) => String(v ?? '').trim().replace(/^["']|["']$/g, '').trim()
const TOKEN = limpio(Deno.env.get('TELEGRAM_BOT_TOKEN'))
const CHAT = limpio(Deno.env.get('TELEGRAM_CHAT_ID'))
const SECRETO = limpio(Deno.env.get('TELEGRAM_WEBHOOK_SECRET'))
const PWA = 'https://ladme.pages.dev'
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false }
})

// ------------------------------------------------------------------ Telegram
type Boton = { text: string; callback_data?: string; url?: string }
type Teclado = Boton[][]
interface Usuario { id: number; first_name?: string; username?: string }
interface Mensaje {
  message_id: number
  chat: { id: number; type?: string }
  from?: Usuario
  text?: string
  reply_to_message?: { message_id: number }
  reply_markup?: { inline_keyboard?: Teclado }
}
interface Callback { id: string; from: Usuario; data?: string; message?: Mensaje }

async function tg<T = unknown>(metodo: string, cuerpo: Record<string, unknown>): Promise<T | null> {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo)
  })
  const j = await r.json().catch(() => null)
  if (!j?.ok) console.error(metodo, r.status, JSON.stringify(j).slice(0, 300))
  return (j?.result ?? null) as T | null
}

// Todo lo que el bot escribe va en HTML de Telegram: los textos que vienen de personas o de la
// base de datos pasan por esc() antes de llegar aquí.
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const enviar = (html: string, teclado?: Teclado, extra: Record<string, unknown> = {}) =>
  tg<Mensaje>('sendMessage', {
    chat_id: CHAT,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(teclado ? { reply_markup: { inline_keyboard: teclado } } : {}),
    ...extra
  })

const editar = (m: { chat: { id: number }; message_id: number }, html: string, teclado: Teclado = []) =>
  tg('editMessageText', {
    chat_id: m.chat.id,
    message_id: m.message_id,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: teclado }
  })

/**
 * Telegram devuelve el texto de un aviso sin formato. Para anotarle quién actuó se rearma:
 * la primera línea (punto de color y título) vuelve a ir en negrita y se agrega el resultado.
 */
function avisoCon(textoPlano: string, anotacion: string): string {
  const [titulo, ...resto] = String(textoPlano ?? '').split('\n')
  return `<b>${esc(titulo)}</b>${resto.length ? '\n' + esc(resto.join('\n')) : ''}\n\n${anotacion}`
}

/** Botones que siguen sirviendo después de actuar: los enlaces y los que se indiquen. */
const botonesQueQuedan = (m: Mensaje, seguir: (b: Boton) => boolean = () => false): Teclado =>
  (m.reply_markup?.inline_keyboard ?? []).map((fila) => fila.filter((b) => b.url || seguir(b))).filter((fila) => fila.length)

const contestar = (cq: Callback, texto = '', alerta = false) =>
  tg('answerCallbackQuery', { callback_query_id: cq.id, text: texto.slice(0, 190), show_alert: alerta })

const nombreDe = (u: Usuario) => (u.username ? `@${u.username}` : u.first_name ?? 'usted')

// ------------------------------------------------------------------ Utilidades
const fmt = (iso: string, opciones: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', ...opciones }).format(new Date(iso))
const horaCorta = (iso: string) => fmt(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
const soloHora = (iso: string) => fmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true })

/** «5», «unal-5» o «UNAL-05» → «UNAL-05». */
function codigoEquipo(txt: string): string {
  const t = String(txt || '').toUpperCase().trim()
  const m = /^(?:([A-Z]+)-?)?(\d+)$/.exec(t)
  if (!m) return t
  return `${m[1] || 'UNAL'}-${m[2].padStart(2, '0')}`
}

function minutosTexto(t?: string): number | null {
  const s = String(t ?? '').toLowerCase()
  if (/^\d+$/.test(s)) return Number(s)
  let total = 0
  let visto = false
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(d|h|m)/g)) {
    visto = true
    const n = Number(m[1].replace(',', '.'))
    total += m[2] === 'd' ? n * 1440 : m[2] === 'h' ? n * 60 : n
  }
  return visto && total > 0 ? Math.round(total) : null
}

function equiposTexto(args: string[]): string[] | null | undefined {
  if (!args.length) return undefined
  if (args.some((a) => /^(sala|todos|todo)$/i.test(a))) return null
  return args.join(',').split(',').filter(Boolean).map(codigoEquipo)
}

// ------------------------------------------------------------------ Consultas
const AYUDA =
  '<b>Comandos de LADME</b>\n\n' +
  '<b>Consultar</b>\n/estado · /equipos · /agenda 5 [mañana] · /reservas [5] · /clases\n\n' +
  '<b>Actuar</b> (personal con cuenta vinculada)\n/aprobar 12 · /rechazar 12 motivo · /liberar 7 · /bloquear 5 2h motivo · ' +
  '/desbloquear 5 [1h] · /anuncio 3h texto · /encender 3 4 · /apagar sala · /reiniciar 5 · /actualizar sala\n\n' +
  'En los avisos también hay botones para aprobar, rechazar o verificar sin escribir comandos.\n\n' +
  '<b>Vincular su cuenta</b>\nEn la app: Administración → Herramientas → Consola → Vincular. Luego /vincular CÓDIGO.'

/** Respuesta a un comando: texto plano (se escapa al enviar) o html ya armado. */
type Respuesta = { texto: string; html?: string; teclado?: Teclado }

async function consulta(cmd: string, args: string[]): Promise<Respuesta | null> {
  if (cmd === '/ayuda' || cmd === '/start' || cmd === '/help') return { texto: '', html: AYUDA }
  if (cmd === '/estado' || cmd === '/equipos') {
    const { data: sala } = await db.rpc('sala_publica')
    const lista = (sala ?? []) as { codigo: string; estado: string; hasta?: string | null }[]
    if (cmd === '/equipos') {
      if (!lista.length) return { texto: 'Sin equipos.' }
      const PUNTO: Record<string, string> = { libre: '🟢', ocupado: '🟠', bloqueado: '⚫', mantenimiento: '🔧' }
      const NOMBRE: Record<string, string> = { libre: 'libre', ocupado: 'en uso', bloqueado: 'bloqueado', mantenimiento: 'en mantenimiento' }
      return {
        texto: '',
        html: '<b>Equipos</b>\n' + lista
          .map((x) => `${PUNTO[x.estado] ?? '⚪'} <b>${esc(x.codigo)}</b> ${esc(NOMBRE[x.estado] ?? x.estado)}${x.hasta ? ' hasta ' + esc(horaCorta(x.hasta)) : ''}`)
          .join('\n'),
        teclado: [[{ text: 'Ver la sala ↗', url: `${PWA}/sala` }]]
      }
    }
    const cuenta = (e: string) => lista.filter((x) => x.estado === e).length
    const { data: ag } = await db.from('agentes').select('ultimo_latido').not('token_hash', 'is', null)
    const vivos = (ag ?? []).filter((a) => a.ultimo_latido && Date.now() - new Date(a.ultimo_latido).getTime() < 120000).length
    const { count: fallas } = await db.from('reportes').select('id', { count: 'exact', head: true }).in('estado', ['abierto', 'en_revision'])
    const n = (e: string, uno: string, varios: string) => `<b>${cuenta(e)}</b> ${cuenta(e) === 1 ? uno : varios}`
    return {
      texto: '',
      html:
        `<b>La sala ahora</b>\n${n('libre', 'libre', 'libres')} · ${n('ocupado', 'en uso', 'en uso')}\n` +
        `${n('bloqueado', 'bloqueado', 'bloqueados')} · ${n('mantenimiento', 'en mantenimiento', 'en mantenimiento')}\n\n` +
        `Faro en línea: ${vivos} de ${(ag ?? []).length}\nFallas abiertas: ${fallas ?? 0}`,
      teclado: [[{ text: 'Ver la sala ↗', url: `${PWA}/sala` }]]
    }
  }
  if (cmd === '/agenda') {
    if (!args[0]) return { texto: 'Uso: /agenda 5 [mañana]' }
    const codigo = codigoEquipo(args[0])
    const hoy = fmt(new Date().toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-')
    let dia = new Date(`${hoy}T00:00:00-05:00`)
    if ((args[1] ?? '').toLowerCase().startsWith('ma')) dia = new Date(dia.getTime() + 86400000)
    const fin = new Date(dia.getTime() + 86400000)
    const { data } = await db
      .from('ocupacion_publica')
      .select('tipo,inicio,fin,motivo,compartida')
      .eq('codigo', codigo)
      .lt('inicio', fin.toISOString())
      .gt('fin', dia.toISOString())
      .order('inicio')
    const titulo = `<b>${esc(codigo)} · ${esc(fmt(dia.toISOString(), { weekday: 'long', day: 'numeric', month: 'short' }))}</b>`
    if (!data?.length) return { texto: '', html: `${titulo}\n🟢 Libre todo el día.` }
    return {
      texto: '',
      html:
        `${titulo}\n` +
        data
          .map((o) => {
            const tipo = o.compartida ? 'compartido' : o.tipo === 'bloqueo' ? 'bloqueado' : 'reservado'
            return `${o.tipo === 'bloqueo' ? '⚫' : '🟠'} ${esc(soloHora(o.inicio))}–${esc(soloHora(o.fin))} ${tipo}${o.tipo === 'bloqueo' && o.motivo ? ' · ' + esc(o.motivo) : ''}`
          })
          .join('\n')
    }
  }
  if (cmd === '/reservas') {
    const ahora = new Date()
    let q = db
      .from('reservas')
      .select('codigo_legible,tipo,inicio,fin,llegada_en,equipos!inner(codigo)')
      .eq('estado', 'activa')
      .is('liberada_en', null)
      .gt('fin', ahora.toISOString())
      .lt('inicio', new Date(ahora.getTime() + 86400000).toISOString())
      .order('inicio')
      .limit(40)
    if (args[0]) q = q.eq('equipos.codigo', codigoEquipo(args[0]))
    const { data } = await q
    if (!data?.length) return { texto: 'No hay reservas en las próximas 24 horas.' }
    return {
      texto: '',
      html:
        '<b>Próximas 24 horas</b>\n' +
        data
          .map((x) => {
            const eq = (x.equipos as unknown as { codigo: string }).codigo
            const sinLlegada = x.tipo !== 'bloqueo' && new Date(x.inicio) < ahora && !x.llegada_en
            const extra = x.tipo === 'bloqueo' ? ' · bloqueo' : sinLlegada ? ' · <b>sin llegada</b>' : ''
            return `${x.tipo === 'bloqueo' ? '⚫' : sinLlegada ? '🟠' : '⚪'} <b>${esc(eq)}</b> ${esc(horaCorta(x.inicio))}–${esc(soloHora(x.fin))} · ${esc(x.codigo_legible)}${extra}`
          })
          .join('\n')
    }
  }
  if (cmd === '/clases') {
    const { data } = await db
      .from('clases')
      .select('id,nombre,grupo,hora_inicio,hora_fin,desde,hasta,equipos_pedidos')
      .eq('estado', 'pendiente')
      .order('creado_en')
      .limit(8)
    if (!data?.length) return { texto: 'No hay solicitudes de sala pendientes.' }
    return {
      texto: '',
      html:
        '<b>Salas para clase por aprobar</b>\n' +
        data
          .map((c) => `🟣 <b>#${c.id} ${esc(c.nombre)}</b> · grupo ${esc(c.grupo)}\n${c.hora_inicio.slice(0, 5)}–${c.hora_fin.slice(0, 5)}, ${esc(c.desde)} a ${esc(c.hasta)}` +
            ` · ${c.equipos_pedidos ? c.equipos_pedidos + ' equipos' : 'los disponibles'}`)
          .join('\n\n'),
      teclado: data.map((c) => [
        { text: `✓ Aprobar #${c.id}`, callback_data: `ap:${c.id}` },
        { text: `✕ Rechazar #${c.id}`, callback_data: `re:${c.id}` }
      ])
    }
  }
  return null
}

// ------------------------------------------------------------------ Acciones
const MOTIVOS: Record<string, [string, string]> = {
  sin_faro: ['no tiene Faro vinculado', 'sin Faro'],
  ya_encendido: ['ya está encendido', 'ya encendidos'],
  sin_mac: ['Faro aún no envió su dirección de red (MAC)', 'sin dirección de red'],
  apagado: ['ya está apagado o sin señal', 'ya apagados o sin señal'],
  compartido: ['tiene un uso compartido en curso', 'con uso compartido'],
  clase: ['tiene una clase en curso', 'con clase en curso'],
  bloqueo: ['tiene un bloqueo en curso', 'con bloqueo'],
  reserva: ['tiene una reserva en curso', 'con reserva en curso'],
  en_espera: ['está sin señal: la recibirá al conectarse', 'sin señal (la recibirán al conectarse)']
}
const VERBO: Record<string, string> = {
  encender: 'Señal de encendido enviada',
  apagar: 'Apagado ordenado',
  reiniciar: 'Reinicio de Faro ordenado',
  actualizar: 'Actualización de Faro ordenada'
}
interface ResultadoOrden { tipo: string; sala: boolean; enviados: string[]; omitidos: { codigo: string; motivo: string }[]; ayudante?: string | null }

/** Mismo criterio que la app: un equipo explica su caso; la sala agrupa los motivos. */
function textoOrden(r: ResultadoOrden): string {
  const omit = r.omitidos.filter((o) => o.motivo !== 'en_espera')
  const espera = r.omitidos.filter((o) => o.motivo === 'en_espera')
  const desde = r.tipo === 'encender' && r.ayudante ? ` (desde ${r.ayudante})` : ''
  if (!r.sala && r.enviados.length + omit.length === 1) {
    if (r.enviados.length) return `${VERBO[r.tipo]} a ${r.enviados[0]}${desde}.${espera.length ? ' ' + MOTIVOS.en_espera[0] + '.' : ''}`
    return `${omit[0].codigo} ${MOTIVOS[omit[0].motivo]?.[0] ?? omit[0].motivo}: no se envió la orden.`
  }
  const partes = [r.enviados.length ? `${VERBO[r.tipo]} a ${r.enviados.length} equipo(s)${desde}.` : 'Ningún equipo recibió la orden.']
  const grupos: Record<string, string[]> = {}
  for (const o of omit) (grupos[o.motivo] ??= []).push(o.codigo)
  const g = Object.entries(grupos).map(([k, l]) => `${l.length} ${MOTIVOS[k]?.[1] ?? k}${l.length <= 3 ? ` (${l.join(', ')})` : ''}`)
  if (g.length) partes.push(`Sin enviar: ${g.join(' · ')}.`)
  if (espera.length) partes.push(`${espera.length} ${MOTIVOS.en_espera[1]}.`)
  return partes.join(' ')
}

interface Ejecucion { ok: boolean; texto: string; actor?: string }

async function ejecutar(de: Usuario, accion: string, args: Record<string, unknown>): Promise<Ejecucion> {
  const { data, error } = await db.rpc('telegram_ejecutar', { p_telegram_id: de.id, p_accion: accion, p_args: args })
  if (error) return { ok: false, texto: `No se pudo: ${error.message}` }
  const r = data as { ok: boolean; error?: string; datos?: Record<string, any>; actor?: string }
  if (!r?.ok) return { ok: false, texto: `No se pudo: ${r?.error ?? 'error desconocido'}`, actor: r?.actor }
  const d = r.datos ?? {}
  const textos: Record<string, () => string> = {
    aprobar: () =>
      `Clase ${d.clase} (grupo ${d.grupo}) aprobada con ${(d.equipos ?? []).length} equipos: ${(d.equipos ?? []).join(', ')}. ` +
      `${d.creadas} bloqueos creados${(d.omitidas ?? []).length ? `, ${d.omitidas.length} omitidos por choque` : ''}. El docente recibe la autorización.`,
    rechazar: () => `Solicitud #${d.id} rechazada; el docente recibe el motivo.`,
    liberar: () => `Reserva ${d.codigo} en ${d.equipo} liberada.`,
    bloquear: () => `${args.equipo} bloqueado ${args.minutos} min${d.canceladas ? ` (${d.canceladas} reservas canceladas)` : ''}.`,
    desbloquear: () => (d.hasta ? `${args.equipo} libre hasta ${soloHora(d.hasta)}.` : `Desbloqueo retirado en ${args.equipo}.`),
    anuncio: () => `Anuncio publicado por ${args.minutos} min.`,
    orden: () => textoOrden(d as ResultadoOrden),
    verificar: () => 'Docente verificado: ya puede pedir la sala para clases.',
    no_verificar: () => 'Verificación rechazada; la persona recibe el motivo.',
    anular: () => 'Inasistencia anulada; la persona recibe el aviso.',
    mantener: () => 'Inasistencia mantenida; la persona recibe el motivo.',
    software_tramite: () => `Solicitud de ${d.software} marcada como enviada a TI.`,
    software_instalado: () => `${d.software} instalado en ${(d.equipos ?? []).join(', ')}; la persona recibe el aviso.`,
    software_rechazar: () => `Solicitud de ${d.software} rechazada; la persona recibe el motivo.`
  }
  return { ok: true, texto: textos[accion]?.() ?? 'Hecho.', actor: r.actor }
}

/** Guarda algo pendiente (una confirmación o la espera de un motivo) y devuelve su id. */
async function pendiente(de: Usuario, accion: string, args: Record<string, unknown>, origen?: Mensaje): Promise<number | null> {
  const { data } = await db
    .from('telegram_pendientes')
    .insert({
      telegram_id: de.id,
      accion,
      args,
      origen: origen ? { chat: origen.chat.id, id: origen.message_id, texto: origen.text ?? '', enlaces: botonesQueQuedan(origen) } : null
    })
    .select('id')
    .single()
  return data?.id ?? null
}

async function tomarPendiente(filtro: Record<string, unknown>) {
  let q = db.from('telegram_pendientes').select('*').gt('vence', new Date().toISOString()).order('creado_en', { ascending: false }).limit(1)
  for (const [k, v] of Object.entries(filtro)) q = v === null ? q.is(k, null) : q.eq(k, v as never)
  const { data } = await q.maybeSingle()
  if (data) await db.from('telegram_pendientes').delete().eq('id', data.id)
  return data as null | { id: number; telegram_id: number; accion: string; args: Record<string, unknown>; mensaje_id: number | null; origen: { chat: number; id: number; texto: string; enlaces?: Teclado } | null }
}

/** Interpreta un comando de acción. Devuelve null si no es una acción. */
async function accion(cmd: string, args: string[], de: Usuario): Promise<Respuesta | null> {
  if (cmd === '/vincular') {
    if (!args[0]) return { texto: 'Uso: /vincular CÓDIGO (el código se genera en la app: Administración → Herramientas → Consola).' }
    const { data, error } = await db.rpc('telegram_vincular', {
      p_telegram_id: de.id,
      p_nombre: de.username ? `@${de.username}` : de.first_name ?? '',
      p_codigo: args[0]
    })
    if (error) return { texto: `No se pudo vincular: ${error.message}` }
    return { texto: `Listo${data ? ', ' + data : ''}: su cuenta quedó vinculada. Ya puede usar las acciones y los botones del bot.` }
  }
  if (cmd === '/si' || cmd === '/sí') {
    const p = await tomarPendiente({ telegram_id: de.id, mensaje_id: null })
    if (!p || p.accion.startsWith('motivo:')) return { texto: 'No hay nada pendiente de confirmar.' }
    return { texto: (await ejecutar(de, p.accion, p.args)).texto }
  }
  if (cmd === '/no') {
    await db.from('telegram_pendientes').delete().eq('telegram_id', de.id)
    return { texto: 'Cancelado.' }
  }

  let acc: string
  let a: Record<string, unknown>
  let confirmar: string | null = null
  if (cmd === '/aprobar') {
    if (!/^\d+$/.test(args[0] ?? '')) return { texto: 'Uso: /aprobar 12 [nota para el docente]' }
    acc = 'aprobar'
    a = { id: Number(args[0]), nota: args.slice(1).join(' ') }
  } else if (cmd === '/rechazar') {
    if (!/^\d+$/.test(args[0] ?? '') || args.length < 2) return { texto: 'Uso: /rechazar 12 motivo' }
    acc = 'rechazar'
    a = { id: Number(args[0]), motivo: args.slice(1).join(' ') }
  } else if (cmd === '/liberar') {
    if (!args[0]) return { texto: 'Uso: /liberar 7 (o el código de la reserva)' }
    acc = 'liberar'
    a = { equipo: /^R/i.test(args[0]) ? args[0].toUpperCase() : codigoEquipo(args[0]) }
    confirmar = `Liberar la reserva en curso de ${a.equipo}: la persona pierde el equipo.`
  } else if (cmd === '/bloquear') {
    const min = minutosTexto(args[1])
    if (!args[0] || !min || args.length < 3) return { texto: 'Uso: /bloquear 5 2h motivo' }
    acc = 'bloquear'
    a = { equipo: codigoEquipo(args[0]), minutos: min, motivo: args.slice(2).join(' ') }
  } else if (cmd === '/desbloquear') {
    if (!args[0]) return { texto: 'Uso: /desbloquear 5 [1h] (0 para quitar el desbloqueo)' }
    acc = 'desbloquear'
    a = { equipo: codigoEquipo(args[0]), minutos: args[1] === '0' ? 0 : minutosTexto(args[1]) ?? 120 }
  } else if (cmd === '/anuncio') {
    const min = minutosTexto(args[0])
    if (!min || args.length < 2) return { texto: 'Uso: /anuncio 3h texto del anuncio' }
    acc = 'anuncio'
    a = { minutos: min, texto: args.slice(1).join(' ') }
  } else if (['/encender', '/apagar', '/reiniciar', '/actualizar'].includes(cmd)) {
    const eqs = equiposTexto(args)
    if (eqs === undefined) return { texto: `Uso: ${cmd} 3 4  o  ${cmd} sala` }
    acc = 'orden'
    a = { tipo: cmd.slice(1), equipos: eqs }
    if (eqs === null || cmd === '/apagar') {
      const verbo = { '/apagar': 'Apagar ', '/encender': 'Encender ', '/reiniciar': 'Reiniciar Faro en ', '/actualizar': 'Actualizar Faro en ' }[cmd]
      confirmar = `${verbo}${eqs === null ? 'toda la sala' : eqs.join(', ')}${cmd === '/apagar' ? ' (se omiten los que tengan reserva, clase o uso compartido)' : ''}.`
    }
  } else {
    return null
  }
  if (confirmar) {
    const id = await pendiente(de, acc, a)
    return {
      texto: `⚠ ${confirmar}\n¿Confirma, ${nombreDe(de)}?`,
      teclado: [[{ text: '✓ Confirmar', callback_data: `si:${id}` }, { text: 'Cancelar', callback_data: `no:${id}` }]]
    }
  }
  return { texto: (await ejecutar(de, acc, a)).texto }
}

// ------------------------------------------------------------------ Botones
const BOTONES: Record<string, { accion: string; motivo?: string; pedido?: string; minimo?: number; icono: string; hecho: string }> = {
  ap: { accion: 'aprobar', icono: '✓', hecho: 'Aprobada' },
  re: { accion: 'rechazar', motivo: 'rechazar la solicitud', icono: '✕', hecho: 'Rechazada' },
  ve: { accion: 'verificar', icono: '✓', hecho: 'Verificado' },
  nv: { accion: 'no_verificar', motivo: 'no verificar a esta persona como docente', icono: '✕', hecho: 'No verificado' },
  an: { accion: 'anular', icono: '↩', hecho: 'Inasistencia anulada' },
  ma: { accion: 'mantener', motivo: 'mantener la inasistencia', icono: '•', hecho: 'Inasistencia mantenida' },
  sT: { accion: 'software_tramite', icono: '→', hecho: 'Enviada a TI' },
  sI: { accion: 'software_instalado', motivo: 'x', pedido: 'responda a este mensaje con los equipos donde quedó instalado (por ejemplo: 3 5 7, o «sala»).', minimo: 1, icono: '✓', hecho: 'Instalado' },
  sR: { accion: 'software_rechazar', motivo: 'no instalar este software', icono: '✕', hecho: 'No se instalará' }
}

/** «✓ <b>Aprobada</b> por Ana. Detalle» */
const anotacion = (b: { icono: string; hecho: string }, actor: string, detalle?: string) =>
  `${b.icono} <b>${esc(b.hecho)}</b> por ${esc(actor)}${detalle ? `. ${esc(detalle)}` : '.'}`

async function boton(cq: Callback) {
  const m = cq.message
  if (!m || String(m.chat.id) !== CHAT || !cq.data) return contestar(cq)
  const [tipo, idTexto] = cq.data.split(':')
  const id = Number(idTexto)

  if (tipo === 'si' || tipo === 'no') {
    const p = await tomarPendiente({ id, telegram_id: cq.from.id })
    if (!p) return contestar(cq, 'Solo quien dio la orden puede confirmarla, y vence en 10 minutos.', true)
    if (tipo === 'no') {
      await editar(m, `${esc(m.text)}\n\nCancelado por ${esc(nombreDe(cq.from))}.`)
      return contestar(cq, 'Cancelado.')
    }
    const r = await ejecutar(cq.from, p.accion, p.args)
    await editar(m, `${esc(m.text)}\n\n${r.ok ? '✓' : '⚠'} ${esc(r.texto)}${r.actor ? ` (${esc(r.actor)})` : ''}`)
    return contestar(cq, r.ok ? 'Hecho.' : 'No se pudo.')
  }

  const b = BOTONES[tipo]
  if (!b || !id) return contestar(cq)
  if (b.motivo) {
    // Pide el motivo como respuesta a un mensaje del bot; al llegar, ejecuta y actualiza el aviso.
    const pid = await pendiente(cq.from, `motivo:${b.accion}`, { id }, m)
    const pedido = await enviar(esc(`${nombreDe(cq.from)}, ${b.pedido ?? `responda a este mensaje con el motivo para ${b.motivo}.`}`), undefined, {
      reply_markup: { force_reply: true, input_field_placeholder: b.pedido ? 'Equipos…' : 'Motivo…' }
    })
    if (pedido && pid) await db.from('telegram_pendientes').update({ mensaje_id: pedido.message_id }).eq('id', pid)
    return contestar(cq, b.pedido ? 'Escriba los equipos respondiendo al mensaje del bot.' : 'Escriba el motivo respondiendo al mensaje del bot.')
  }
  const r = await ejecutar(cq.from, b.accion, { id })
  if (!r.ok) return contestar(cq, r.texto, true)
  // «Enviada a TI» no cierra la solicitud: quedan los botones de instalado y no instalar.
  const quedan = botonesQueQuedan(m, (x) => tipo === 'sT' && /^s[IR]:/.test(x.callback_data ?? ''))
  await editar(m, avisoCon(m.text ?? '', anotacion(b, r.actor ?? nombreDe(cq.from), r.texto)), quedan)
  return contestar(cq, b.hecho)
}

/** Respuesta con el motivo a un mensaje del bot que lo pidió. */
async function motivo(m: Mensaje): Promise<boolean> {
  if (!m.reply_to_message || !m.from) return false
  const p = await tomarPendiente({ telegram_id: m.from.id, mensaje_id: m.reply_to_message.message_id })
  if (!p || !p.accion.startsWith('motivo:')) return false
  const acc = p.accion.slice(7)
  const texto = (m.text ?? '').trim()
  const boton = Object.values(BOTONES).find((b) => b.accion === acc)
  if (texto.length < (boton?.minimo ?? 5)) {
    await enviar('La respuesta es muy corta. Toque el botón otra vez y escriba al menos 5 caracteres.')
    return true
  }
  const r = await ejecutar(m.from, acc, { ...p.args, motivo: texto })
  if (r.ok && p.origen) {
    const b = boton ?? { icono: '✓', hecho: 'Hecho' }
    const motivoTxt = acc === 'software_instalado' ? '' : ` «${esc(texto)}»`
    await editar(
      { chat: { id: p.origen.chat }, message_id: p.origen.id },
      avisoCon(p.origen.texto, `${anotacion(b, r.actor ?? nombreDe(m.from))}${motivoTxt}`),
      p.origen.enlaces ?? []
    )
  }
  await enviar(esc(r.texto), undefined, { reply_to_message_id: m.message_id })
  return true
}

// ------------------------------------------------------------------ Entrada
async function mensaje(m: Mensaje) {
  if (String(m.chat.id) !== CHAT) {
    if (m.chat.type === 'private' && m.text) {
      // Chat privado con el bot: respuesta cortés, sin datos del laboratorio.
      await tg('sendMessage', {
        chat_id: m.chat.id,
        text: 'Hola, soy el asistente del personal de LADME y solo respondo en el grupo del personal.\n\nPara ver qué equipos están libres y reservar, use la app.',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: 'Abrir LADME ↗', url: PWA }]] }
      })
    } else {
      // Otro grupo: no responde. Queda en los registros de la función para comparar con TELEGRAM_CHAT_ID.
      console.warn(`Mensaje ignorado del chat ${m.chat.id} (${m.chat.type ?? '?'}); TELEGRAM_CHAT_ID es ${CHAT ? CHAT.replace(/\d(?=\d{3})/g, '•') : '(vacío)'}`)
    }
    return
  }
  if (!m.text || !m.from) return
  if (await motivo(m)) return
  if (!m.text.startsWith('/')) return
  const partes = m.text.trim().split(/\s+/)
  const cmd = partes[0].toLowerCase().replace(/@.*$/, '')
  const args = partes.slice(1)
  let r: Respuesta | null
  try {
    r = (await accion(cmd, args, m.from)) ?? (await consulta(cmd, args))
  } catch (e) {
    r = { texto: `No pude responder: ${String((e as Error).message ?? e).slice(0, 200)}` }
  }
  r ??= { texto: `No conozco ${cmd}. Escriba /ayuda para ver los comandos.` }
  await enviar(r.html ?? esc(r.texto), r.teclado, { reply_to_message_id: m.message_id })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('LADME', { status: 405 })
  if (!SECRETO || req.headers.get('x-telegram-bot-api-secret-token') !== SECRETO) return new Response('no autorizado', { status: 401 })
  if (!TOKEN || !CHAT) console.error('Faltan los secretos TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en la función.')
  const u = await req.json().catch(() => null)
  try {
    if (u?.callback_query) await boton(u.callback_query as Callback)
    else if (u?.message) await mensaje(u.message as Mensaje)
  } catch (e) {
    console.error(e)
  }
  // Siempre 200: si no, Telegram reintenta el mismo mensaje.
  return new Response('ok')
})
