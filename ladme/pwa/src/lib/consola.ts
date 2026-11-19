/**
 * Consola del personal: comandos de texto sobre las mismas funciones (y los mismos permisos) que los
 * botones de la PWA. No es una terminal del sistema: no ejecuta nada en el servidor ni en los PCs que
 * la PWA no pueda hacer ya. Cada comando queda en el Registro.
 */
import {
  anunciarFaro,
  buscarUsuarios,
  canalFaro,
  cancelarReserva,
  crearBloqueo,
  desbloquearFaro,
  empezarClaseFaro,
  guardarPolitica,
  liberarReserva,
  listarPoliticas,
  listarReportes,
  listarReservasAdmin,
  listarSolicitudes,
  modoFaro,
  ocupacionPublica,
  ordenFaro,
  panelFaro,
  quitarAnuncioFaro,
  registro,
  salaPublica,
  terminarClaseFaro,
  type FiltrosRegistro,
  type FilaRegistro,
  type FuenteRegistro,
  type ModoFaro,
  type OrdenFaro
} from './api'
import { descargarCSV } from './csv'
import { fecha, hora, inicioDia, sumarDias } from './format'

export type TonoLinea = 'cmd' | 'ok' | 'error' | 'info' | 'tenue' | 'aviso'
export interface Linea {
  id: number
  tono: TonoLinea
  texto: string
}

export interface Contexto {
  admin: boolean
  equipos: string[]
  imprimir: (texto: string, tono?: TonoLinea) => void
  /** Pide confirmación escrita; la acción corre solo si la persona escribe exactamente `esperado`. */
  confirmar: (pregunta: string, esperado: string, accion: () => Promise<string | void>) => void
  /** Empieza a seguir el registro en vivo con estos filtros. */
  seguir: (filtros: FiltrosRegistro) => void
  parar: () => boolean
  limpiar: () => void
}

export interface Comando {
  nombre: string
  alias?: string[]
  uso: string
  ayuda: string
  ejemplos?: string[]
  soloAdmin?: boolean
  /** No se anota en el Registro (ayuda, limpiar…). */
  sinRegistro?: boolean
  correr: (args: Args, ctx: Contexto) => Promise<string | void>
}

export interface Args {
  pos: string[]
  flags: Record<string, string | true>
  crudo: string
}

// ------------------------------------------------------------------ Análisis
/** Separa respetando comillas: bloquear UNAL-05 2h "cambio de RAM" --cancelar */
export function tokenizar(linea: string): string[] {
  const salida: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(linea))) salida.push(m[1] ?? m[2] ?? m[3])
  return salida
}

export function analizar(linea: string): { nombre: string; args: Args } {
  const t = tokenizar(linea.trim())
  const nombre = (t.shift() ?? '').toLowerCase()
  const pos: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < t.length; i++) {
    const x = t[i]
    if (x.startsWith('--')) {
      const [k, v] = x.slice(2).split('=', 2)
      if (v !== undefined) flags[k] = v
      else if (t[i + 1] && !t[i + 1].startsWith('--')) flags[k] = t[++i]
      else flags[k] = true
    } else pos.push(x)
  }
  return { nombre, args: { pos, flags, crudo: linea.trim() } }
}

/** «2h», «30m», «1d», «1h30m», «90» (minutos) → minutos. */
export function minutos(txt: string | undefined): number | null {
  if (!txt) return null
  if (/^\d+$/.test(txt)) return Number(txt)
  const re = /(\d+(?:[.,]\d+)?)\s*(d|h|m)/gi
  let total = 0
  let visto = false
  let m: RegExpExecArray | null
  while ((m = re.exec(txt))) {
    visto = true
    const n = Number(m[1].replace(',', '.'))
    total += m[2].toLowerCase() === 'd' ? n * 1440 : m[2].toLowerCase() === 'h' ? n * 60 : n
  }
  return visto && total > 0 ? Math.round(total) : null
}

function textoMinutos(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} d`
  if (min >= 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
  return `${min} min`
}

/** «UNAL-05», «unal-5», «5» → «UNAL-05»; «sala» o «todos» → null (toda la sala). */
export function resolverEquipos(tokens: string[], equipos: string[]): string[] | null {
  if (tokens.length === 0) throw new Error('Indique uno o más equipos, o «sala».')
  if (tokens.some((t) => ['sala', 'todos', 'todo'].includes(t.toLowerCase()))) return null
  const salida: string[] = []
  for (const bruto of tokens.flatMap((t) => t.split(','))) {
    const t = bruto.trim().toUpperCase()
    if (!t) continue
    let c = t
    if (/^\d+$/.test(t)) c = equipos.find((e) => /\d+$/.exec(e)?.[0] && Number(/\d+$/.exec(e)![0]) === Number(t)) ?? t
    else if (/^[A-Z]+-?\d+$/.test(t)) {
      const [, pre, num] = /^([A-Z]+)-?(\d+)$/.exec(t)!
      c = equipos.find((e) => e.startsWith(pre + '-') && Number(e.split('-').pop()) === Number(num)) ?? t
    }
    if (!equipos.includes(c)) throw new Error(`No existe el equipo «${bruto}».`)
    salida.push(c)
  }
  return [...new Set(salida)]
}

const unEquipo = (tokens: string[], equipos: string[]) => {
  const l = resolverEquipos(tokens.slice(0, 1), equipos)
  if (!l) throw new Error('Este comando es para un equipo, no para toda la sala.')
  return l[0]
}
const quien = (l: string[] | null) => (l ? l.join(', ') : 'toda la sala')

/** Tabla de texto con columnas alineadas. */
export function tabla(encabezados: string[], filas: (string | number | null | undefined)[][]): string {
  const txt = filas.map((f) => f.map((c) => (c == null ? '' : String(c))))
  const anchos = encabezados.map((h, i) => Math.max(h.length, ...txt.map((f) => (f[i] ?? '').length)))
  const linea = (f: string[]) => f.map((c, i) => (i === f.length - 1 ? c : c.padEnd(anchos[i]))).join('  ')
  return [linea(encabezados), anchos.map((a) => '─'.repeat(a)).join('  '), ...txt.map(linea)].join('\n')
}

const FUENTES: FuenteRegistro[] = ['reservas', 'faro', 'fallas', 'mantenimiento', 'solicitudes', 'errores', 'consola']

function filtrosDe(a: Args, equipos: string[]): FiltrosRegistro {
  const f: FiltrosRegistro = {}
  const fuente = a.flags.fuente
  if (typeof fuente === 'string') {
    const lista = fuente.split(',').map((x) => x.trim().toLowerCase()) as FuenteRegistro[]
    const malas = lista.filter((x) => !FUENTES.includes(x))
    if (malas.length) throw new Error(`Fuente desconocida: ${malas.join(', ')}. Use: ${FUENTES.join(', ')}.`)
    f.fuentes = lista
  }
  if (typeof a.flags.equipo === 'string') f.equipo = unEquipo([a.flags.equipo], equipos)
  if (typeof a.flags.buscar === 'string') f.buscar = a.flags.buscar
  const dia = (s: string, fin = false) => {
    const hoy = inicioDia(new Date())
    const d = s === 'hoy' ? hoy : s === 'ayer' ? sumarDias(hoy, -1) : new Date(`${s}T00:00`)
    if (Number.isNaN(d.getTime())) throw new Error(`Fecha no válida: «${s}» (use AAAA-MM-DD, «hoy» o «ayer»).`)
    return (fin ? sumarDias(d, 1) : d).toISOString()
  }
  if (typeof a.flags.desde === 'string') f.desde = dia(a.flags.desde)
  if (typeof a.flags.hasta === 'string') f.hasta = dia(a.flags.hasta, true)
  return f
}

/** «19/11 14:05», alineado para la consola. */
function fechaCorta(iso: string): string {
  const d = new Date(iso)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`
}

export function lineaRegistro(f: FilaRegistro): string {
  const quienes = [f.persona && `persona: ${f.persona}`, f.actor && f.actor !== f.persona && `por: ${f.actor}`].filter(Boolean).join(' · ')
  return `${fechaCorta(f.en)}  ${f.fuente.padEnd(13)} ${(f.equipo ?? '').padEnd(8)} ${f.texto}${quienes ? `  (${quienes})` : ''}`
}

// ------------------------------------------------------------------ Comandos
export const COMANDOS: Comando[] = [
  {
    nombre: 'ayuda',
    alias: ['help', '?'],
    uso: 'ayuda [comando]',
    ayuda: 'Lista los comandos o explica uno.',
    sinRegistro: true,
    async correr(a, ctx) {
      const c = a.pos[0] && buscarComando(a.pos[0])
      if (c) {
        ctx.imprimir(`${c.uso}\n  ${c.ayuda}${c.soloAdmin ? '\n  Solo administradores.' : ''}`, 'info')
        if (c.ejemplos?.length) ctx.imprimir('Ejemplos:\n' + c.ejemplos.map((e) => `  ${e}`).join('\n'), 'tenue')
        return
      }
      if (a.pos[0]) throw new Error(`No conozco «${a.pos[0]}».`)
      ctx.imprimir(
        COMANDOS.filter((c) => !c.soloAdmin || ctx.admin)
          .map((c) => `  ${c.uso.padEnd(44)} ${c.ayuda}`)
          .join('\n'),
        'info'
      )
      ctx.imprimir('Equipos: «UNAL-05», «5» o «sala». Duraciones: 30m, 2h, 1d, 1h30m. ↑/↓ historial · Tab completa · Esc detiene «seguir».', 'tenue')
    }
  },
  {
    nombre: 'limpiar',
    alias: ['clear', 'cls'],
    uso: 'limpiar',
    ayuda: 'Borra la pantalla (no el Registro).',
    sinRegistro: true,
    async correr(_a, ctx) {
      ctx.limpiar()
    }
  },
  {
    nombre: 'estado',
    uso: 'estado',
    ayuda: 'Resumen de la sala: libres, ocupados, Faro en línea, fallas y solicitudes pendientes.',
    async correr(_a, ctx) {
      const [sala, panel, reportes, solicitudes] = await Promise.all([
        salaPublica(),
        panelFaro().catch(() => null),
        listarReportes().catch(() => []),
        listarSolicitudes().catch(() => [])
      ])
      const cuenta = (e: string) => sala.filter((s) => s.estado === e).length
      const enLinea = panel?.equipos.filter((e) => e.vinculado && e.ultimo_latido && Date.now() - new Date(e.ultimo_latido).getTime() < 120_000).length ?? 0
      const vinculados = panel?.equipos.filter((e) => e.vinculado).length ?? 0
      const abiertos = reportes.filter((r) => r.estado === 'abierto' || r.estado === 'en_revision').length
      const pendientes = solicitudes.filter((s) => s.estado === 'pendiente').length
      ctx.imprimir(
        [
          `Equipos     ${sala.length}  ·  libres ${cuenta('libre')}  ·  ocupados ${cuenta('ocupado')}  ·  bloqueados ${cuenta('bloqueado')}  ·  mantenimiento ${cuenta('mantenimiento')}`,
          `Faro        ${enLinea} de ${vinculados} en línea`,
          `Fallas      ${abiertos} abiertas`,
          `Solicitudes ${pendientes} pendientes`,
          ...(panel?.anuncios.length ? [`Anuncios    ${panel.anuncios.map((x) => `#${x.id} «${x.texto}» hasta ${hora(x.hasta)}`).join(' · ')}`] : [])
        ].join('\n'),
        'info'
      )
      return `${cuenta('libre')} libres de ${sala.length}`
    }
  },
  {
    nombre: 'equipos',
    uso: 'equipos [libres|ocupados|bloqueados|mantenimiento]',
    ayuda: 'Tabla de equipos con su estado ahora y Faro.',
    async correr(a, ctx) {
      const [sala, panel] = await Promise.all([salaPublica(), panelFaro().catch(() => null)])
      const filtro = (a.pos[0] ?? '').toLowerCase().replace(/s$/, '').replace(/e$/, '')
      const mapa = new Map(panel?.equipos.map((e) => [e.codigo, e]) ?? [])
      const lista = sala.filter((s) => !filtro || s.estado.startsWith(filtro.slice(0, 4)))
      ctx.imprimir(
        tabla(
          ['Equipo', 'Estado', 'Hasta', 'Faro', 'CPU', 'Sistema'],
          lista.map((s) => {
            const f = mapa.get(s.codigo)
            const vivo = f?.ultimo_latido && Date.now() - new Date(f.ultimo_latido).getTime() < 120_000
            return [
              s.codigo,
              s.estado,
              s.hasta ? fecha(s.hasta) : '',
              f?.vinculado ? (vivo ? `en línea · ${f.modo}` : 'sin señal') : '—',
              f?.cpu_pct != null && vivo ? `${f.cpu_pct}%` : '',
              s.sistema
            ]
          })
        )
      )
      return `${lista.length} equipos`
    }
  },
  {
    nombre: 'agenda',
    uso: 'agenda <equipo> [hoy|mañana|AAAA-MM-DD]',
    ayuda: 'Rangos libres y ocupados de un equipo en un día.',
    ejemplos: ['agenda 5', 'agenda UNAL-13 mañana'],
    async correr(a, ctx) {
      const codigo = unEquipo(a.pos, ctx.equipos)
      const hoy = inicioDia(new Date())
      const cual = (a.pos[1] ?? 'hoy').toLowerCase()
      const d0 = cual === 'hoy' ? hoy : cual === 'mañana' || cual === 'manana' ? sumarDias(hoy, 1) : new Date(`${cual}T00:00`)
      if (Number.isNaN(d0.getTime())) throw new Error('Fecha no válida (use hoy, mañana o AAAA-MM-DD).')
      const d1 = sumarDias(d0, 1)
      const ocs = (await ocupacionPublica(codigo))
        .filter((o) => new Date(o.fin) > d0 && new Date(o.inicio) < d1)
        .sort((x, y) => x.inicio.localeCompare(y.inicio))
      let cursor = new Date(Math.max(d0.getTime(), Date.now()))
      const lineas: string[] = []
      for (const o of ocs) {
        const i = new Date(o.inicio)
        const f = new Date(o.fin)
        if (f <= cursor) continue
        if (i.getTime() - cursor.getTime() >= 15 * 60_000) lineas.push(`  libre     ${hora(cursor.toISOString())} – ${hora(i.toISOString())}`)
        lineas.push(`  ${o.tipo === 'bloqueo' ? 'bloqueado' : 'reservado'} ${hora((i < cursor ? cursor : i).toISOString())} – ${f >= d1 ? 'fin del día' : hora(o.fin)}${o.motivo ? ` · ${o.motivo}` : ''}`)
        if (f > cursor) cursor = f
      }
      if (d1.getTime() - cursor.getTime() >= 15 * 60_000) lineas.push(`  libre     ${hora(cursor.toISOString())} – fin del día`)
      ctx.imprimir(`${codigo} · ${d0.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}\n${lineas.join('\n') || '  (el día ya terminó)'}`)
    }
  },
  {
    nombre: 'reservas',
    uso: 'reservas [equipo] [--dias N]',
    ayuda: 'Reservas y bloqueos vigentes (de ahora a N días, 1 por defecto).',
    async correr(a, ctx) {
      const dias = Math.min(31, Math.max(1, Number(a.flags.dias) || 1))
      const codigo = a.pos[0] ? unEquipo(a.pos, ctx.equipos) : null
      const ahora = new Date()
      const lista = (await listarReservasAdmin(ahora.toISOString(), sumarDias(ahora, dias).toISOString()))
        .filter((r) => r.estado === 'activa' && !r.liberada_en && (!codigo || r.equipos?.codigo === codigo))
        .sort((x, y) => x.inicio.localeCompare(y.inicio))
      if (!lista.length) return void ctx.imprimir('Ninguna.', 'tenue')
      ctx.imprimir(
        tabla(
          ['Código', 'Equipo', 'Inicio', 'Fin', 'Tipo', 'Persona', 'Llegada'],
          lista.map((r) => [
            r.codigo_legible,
            r.equipos?.codigo,
            fecha(r.inicio),
            fecha(r.fin),
            r.tipo,
            r.tipo === 'bloqueo' ? r.motivo : r.perfiles?.nombre,
            r.tipo === 'bloqueo' ? '' : r.llegada_en ? 'sí' : new Date(r.inicio) < ahora ? 'NO' : ''
          ])
        )
      )
      return `${lista.length} vigentes`
    }
  },
  {
    nombre: 'liberar',
    uso: 'liberar <equipo|código de reserva>',
    ayuda: 'Libera la reserva en curso de un equipo (o una reserva por su código).',
    ejemplos: ['liberar 7', 'liberar R-4F2K'],
    async correr(a, ctx) {
      if (!a.pos[0]) throw new Error('Indique el equipo o el código de la reserva.')
      const ahora = new Date()
      const lista = await listarReservasAdmin(sumarDias(ahora, -1).toISOString(), sumarDias(ahora, 32).toISOString())
      const porCodigo = lista.find((r) => r.codigo_legible.toUpperCase() === a.pos[0].toUpperCase())
      const r =
        porCodigo ??
        (() => {
          const eq = unEquipo(a.pos, ctx.equipos)
          return lista.find(
            (x) => x.equipos?.codigo === eq && x.tipo === 'reserva' && x.estado === 'activa' && !x.liberada_en && new Date(x.inicio) <= ahora && new Date(x.fin) > ahora
          )
        })()
      if (!r) throw new Error('No hay una reserva en curso que coincida.')
      ctx.confirmar(
        `Liberar ${r.codigo_legible} de ${r.perfiles?.nombre ?? 'la persona'} en ${r.equipos?.codigo} (hasta ${fecha(r.fin)}). Escriba «si» para confirmar.`,
        'si',
        async () => {
          await liberarReserva(r.id)
          return `${r.codigo_legible} liberada.`
        }
      )
    }
  },
  {
    nombre: 'cancelar',
    uso: 'cancelar <código de reserva> "motivo"',
    ayuda: 'Cancela una reserva futura; la persona recibe el motivo.',
    async correr(a, ctx) {
      const [codigo, ...resto] = a.pos
      const motivo = resto.join(' ').trim()
      if (!codigo || motivo.length < 5) throw new Error('Uso: cancelar R-XXXX "motivo de al menos 5 letras"')
      const ahora = new Date()
      const r = (await listarReservasAdmin(sumarDias(ahora, -1).toISOString(), sumarDias(ahora, 62).toISOString())).find(
        (x) => x.codigo_legible.toUpperCase() === codigo.toUpperCase()
      )
      if (!r) throw new Error(`No encontré la reserva ${codigo}.`)
      ctx.confirmar(`Cancelar ${r.codigo_legible} (${r.equipos?.codigo}, ${fecha(r.inicio)}) de ${r.perfiles?.nombre ?? '—'}. Escriba «si».`, 'si', async () => {
        await cancelarReserva(r.id, motivo)
        return `${r.codigo_legible} cancelada.`
      })
    }
  },
  {
    nombre: 'bloquear',
    uso: 'bloquear <equipo> <duración> "motivo" [--cancelar]',
    ayuda: 'Bloquea un equipo desde ahora. Con --cancelar, cancela las reservas que choquen.',
    ejemplos: ['bloquear 5 3h "cambio de disco"'],
    async correr(a, ctx) {
      const codigo = unEquipo(a.pos, ctx.equipos)
      const min = minutos(a.pos[1])
      const motivo = a.pos.slice(2).join(' ').trim()
      if (!min) throw new Error('Falta la duración (p. ej. 2h).')
      if (motivo.length < 3) throw new Error('Falta el motivo entre comillas.')
      const inicio = new Date()
      const r = await crearBloqueo({
        equipo: codigo,
        inicio: inicio.toISOString(),
        fin: new Date(inicio.getTime() + min * 60_000).toISOString(),
        motivo,
        cancelarConflictos: a.flags.cancelar === true
      })
      const txt = `${codigo} bloqueado ${textoMinutos(min)}${r.canceladas ? ` · ${r.canceladas} reserva(s) cancelada(s)` : ''}.`
      ctx.imprimir(txt, 'ok')
      return txt
    }
  },
  {
    nombre: 'desbloquear',
    uso: 'desbloquear <equipo> [duración]',
    ayuda: 'Quita la pantalla de bloqueo de Faro un tiempo (2 h por defecto).',
    async correr(a, ctx) {
      const codigo = unEquipo(a.pos, ctx.equipos)
      const min = minutos(a.pos[1]) ?? 120
      await desbloquearFaro(codigo, min)
      const txt = `${codigo} desbloqueado ${textoMinutos(min)}.`
      ctx.imprimir(txt, 'ok')
      return txt
    }
  },
  {
    nombre: 'modo',
    uso: 'modo <equipos|sala> <observar|avisar|bloquear>',
    ayuda: 'Cambia el modo de Faro.',
    async correr(a, ctx) {
      const modo = a.pos[a.pos.length - 1]?.toLowerCase() as ModoFaro
      if (!['observar', 'avisar', 'bloquear'].includes(modo)) throw new Error('El modo es observar, avisar o bloquear.')
      const eqs = resolverEquipos(a.pos.slice(0, -1), ctx.equipos)
      const hacer = async () => {
        await modoFaro(eqs, modo)
        return `Modo ${modo} en ${quien(eqs)}.`
      }
      if (!eqs && modo === 'bloquear') return void ctx.confirmar('Poner TODA la sala en modo bloquear. Escriba «si».', 'si', hacer)
      const txt = await hacer()
      ctx.imprimir(txt, 'ok')
      return txt
    }
  },
  {
    nombre: 'clase',
    uso: 'clase <equipos|sala> <duración> "motivo"  ·  clase fin [equipos|sala]',
    ayuda: 'Modo clase: bloquea los equipos para una clase (y lo termina con «clase fin»).',
    async correr(a, ctx) {
      if (a.pos[0]?.toLowerCase() === 'fin') {
        const eqs = a.pos.length > 1 ? resolverEquipos(a.pos.slice(1), ctx.equipos) : null
        await terminarClaseFaro(eqs)
        const txt = `Clase terminada en ${quien(eqs)}.`
        ctx.imprimir(txt, 'ok')
        return txt
      }
      const iDur = a.pos.findIndex((p) => minutos(p) !== null && !/^\d+$/.test(p))
      if (iDur < 1) throw new Error('Uso: clase <equipos|sala> <duración> "motivo"')
      const eqs = resolverEquipos(a.pos.slice(0, iDur), ctx.equipos)
      const min = minutos(a.pos[iDur])!
      const motivo = a.pos.slice(iDur + 1).join(' ').trim() || 'Clase'
      ctx.confirmar(`Clase de ${textoMinutos(min)} en ${quien(eqs)} («${motivo}»). Escriba «si».`, 'si', async () => {
        await empezarClaseFaro(eqs, min, motivo)
        return `Clase iniciada en ${quien(eqs)} por ${textoMinutos(min)}.`
      })
    }
  },
  {
    nombre: 'anuncio',
    uso: 'anuncio "texto" <duración> [equipos]  ·  anuncio quitar <id>  ·  anuncio',
    ayuda: 'Muestra un mensaje en las islas y pantallas de bloqueo.',
    ejemplos: ['anuncio "Hoy cerramos a las 5" 4h', 'anuncio quitar 3'],
    async correr(a, ctx) {
      if (a.pos.length === 0) {
        const p = await panelFaro()
        ctx.imprimir(p.anuncios.length ? p.anuncios.map((x) => `#${x.id}  «${x.texto}»  hasta ${fecha(x.hasta)}  ${x.equipos?.join(', ') ?? 'toda la sala'}`).join('\n') : 'Sin anuncios activos.', 'info')
        return
      }
      if (a.pos[0].toLowerCase() === 'quitar') {
        const id = Number(a.pos[1]?.replace('#', ''))
        if (!id) throw new Error('Uso: anuncio quitar <id>')
        await quitarAnuncioFaro(id)
        const txt = `Anuncio #${id} quitado.`
        ctx.imprimir(txt, 'ok')
        return txt
      }
      const [texto, dur, ...eqs] = a.pos
      const min = minutos(dur)
      if (!texto || !min) throw new Error('Uso: anuncio "texto" <duración> [equipos]')
      const lista = eqs.length ? resolverEquipos(eqs, ctx.equipos) : null
      await anunciarFaro(texto, min, lista)
      const txt = `Anuncio publicado en ${quien(lista)} por ${textoMinutos(min)}.`
      ctx.imprimir(txt, 'ok')
      return txt
    }
  },
  {
    nombre: 'orden',
    alias: ['apagar', 'encender', 'reiniciar', 'actualizar', 'desinstalar'],
    uso: 'orden <reiniciar|actualizar|apagar|encender|desinstalar> <equipos|sala>',
    ayuda: 'Órdenes remotas a Faro. También: «apagar sala», «encender 3 4 5».',
    ejemplos: ['apagar sala', 'encender 3 4 5', 'orden actualizar sala'],
    async correr(a, ctx) {
      const tipo = (a.pos[0] ?? '').toLowerCase() as OrdenFaro
      if (!['reiniciar', 'actualizar', 'apagar', 'encender', 'desinstalar'].includes(tipo))
        throw new Error('Orden: reiniciar, actualizar, apagar, encender o desinstalar.')
      if (tipo === 'desinstalar' && !ctx.admin) throw new Error('Solo un administrador puede desinstalar Faro.')
      const eqs = resolverEquipos(a.pos.slice(1), ctx.equipos)
      if (tipo === 'desinstalar' && !eqs) throw new Error('Desinstalar es por equipo, no para toda la sala.')
      const hacer = async () => {
        const n = await ordenFaro(eqs, tipo)
        return `Orden «${tipo}» enviada a ${n} equipo(s).`
      }
      if (tipo === 'desinstalar')
        return void ctx.confirmar(`Quitar Faro de ${quien(eqs)}. Escriba ${eqs![0]} para confirmar.`, eqs![0], hacer)
      if (tipo === 'apagar' || (!eqs && tipo !== 'actualizar'))
        return void ctx.confirmar(`${tipo[0].toUpperCase() + tipo.slice(1)} ${quien(eqs)}${tipo === 'apagar' ? ' (los que tengan reserva en curso se omiten)' : ''}. Escriba «si».`, 'si', hacer)
      const txt = await hacer()
      ctx.imprimir(txt, 'ok')
      return txt
    }
  },
  {
    nombre: 'canal',
    uso: 'canal <equipos|sala> <estable|pruebas>',
    ayuda: 'Canal de actualizaciones de Faro.',
    async correr(a, ctx) {
      const canal = a.pos[a.pos.length - 1]?.toLowerCase()
      if (canal !== 'estable' && canal !== 'pruebas') throw new Error('El canal es estable o pruebas.')
      const eqs = resolverEquipos(a.pos.slice(0, -1), ctx.equipos)
      await canalFaro(eqs, canal)
      const txt = `${quien(eqs)} en el canal ${canal}.`
      ctx.imprimir(txt, 'ok')
      return txt
    }
  },
  {
    nombre: 'politica',
    alias: ['politicas', 'política'],
    uso: 'politica [clave] [valor]',
    ayuda: 'Lista las políticas o cambia una.',
    ejemplos: ['politica', 'politica llegada_modo 2'],
    async correr(a, ctx) {
      const lista = await listarPoliticas()
      if (!a.pos[0]) {
        ctx.imprimir(tabla(['Clave', 'Valor', 'Qué es'], lista.map((p) => [p.clave, p.valor, p.descripcion ?? ''])))
        return
      }
      const p = lista.find((x) => x.clave === a.pos[0])
      if (!p) throw new Error(`No existe la política «${a.pos[0]}».`)
      if (a.pos[1] === undefined) return void ctx.imprimir(`${p.clave} = ${p.valor}\n  ${p.descripcion ?? ''}`, 'info')
      if (!ctx.admin) throw new Error('Solo un administrador cambia políticas.')
      const valor = Number(a.pos[1])
      if (!Number.isFinite(valor)) throw new Error('El valor debe ser un número.')
      ctx.confirmar(`Cambiar ${p.clave} de ${p.valor} a ${valor}. Escriba «si».`, 'si', async () => {
        await guardarPolitica(p.clave, valor)
        return `${p.clave} = ${valor}`
      })
    }
  },
  {
    nombre: 'usuario',
    alias: ['usuarios'],
    uso: 'usuario <nombre o correo>',
    ayuda: 'Busca personas (máx. 15).',
    async correr(a, ctx) {
      const texto = a.pos.join(' ')
      if (texto.length < 2) throw new Error('Escriba al menos 2 letras.')
      const { lista, total } = await buscarUsuarios(texto, 'todos', 0, 15)
      if (!lista.length) return void ctx.imprimir('Nadie coincide.', 'tenue')
      ctx.imprimir(tabla(['Nombre', 'Correo', 'Rol', 'Activo', 'Programa'], lista.map((p) => [p.nombre, p.correo, p.rol, p.activo ? 'sí' : 'NO', p.programa])))
      if (total > lista.length) ctx.imprimir(`… y ${total - lista.length} más. Afine la búsqueda.`, 'tenue')
      return `${total} coincidencias`
    }
  },
  {
    nombre: 'registro',
    alias: ['logs', 'log'],
    uso: 'registro [N] [--fuente f] [--equipo X] [--buscar t] [--desde fecha] [--hasta fecha]',
    ayuda: 'Últimas N entradas del Registro (20 por defecto, máx. 200).',
    ejemplos: ['registro 50 --fuente faro', 'registro --equipo 5 --desde ayer'],
    sinRegistro: true,
    async correr(a, ctx) {
      const n = Math.min(200, Math.max(1, Number(a.pos[0]) || 20))
      const r = await registro(filtrosDe(a, ctx.equipos), n, 0)
      if (!r.filas.length) return void ctx.imprimir('Nada con esos filtros.', 'tenue')
      ctx.imprimir([...r.filas].reverse().map(lineaRegistro).join('\n'))
      ctx.imprimir(`${r.filas.length} de ${r.total}. Para todo: «exportar» con los mismos filtros.`, 'tenue')
    }
  },
  {
    nombre: 'seguir',
    alias: ['tail'],
    uso: 'seguir [--fuente f] [--equipo X]',
    ayuda: 'Muestra en vivo lo que va pasando. Esc o «parar» lo detiene.',
    sinRegistro: true,
    async correr(a, ctx) {
      ctx.seguir(filtrosDe(a, ctx.equipos))
    }
  },
  {
    nombre: 'parar',
    alias: ['stop'],
    uso: 'parar',
    ayuda: 'Detiene «seguir».',
    sinRegistro: true,
    async correr(_a, ctx) {
      ctx.imprimir(ctx.parar() ? 'Detenido.' : 'No había nada en vivo.', 'tenue')
    }
  },
  {
    nombre: 'exportar',
    uso: 'exportar [--fuente f] [--equipo X] [--desde fecha] [--hasta fecha]',
    ayuda: 'Descarga en CSV el Registro con esos filtros.',
    async correr(a, ctx) {
      const f = filtrosDe(a, ctx.equipos)
      const filas: FilaRegistro[] = []
      for (let offset = 0; ; offset += 5000) {
        const parte = await registro(f, 5000, offset)
        filas.push(...parte.filas)
        ctx.imprimir(`… ${filas.length} de ${parte.total}`, 'tenue')
        if (parte.filas.length < 5000 || filas.length >= parte.total) break
      }
      descargarCSV(
        `registro-ladme-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Fecha', 'Fuente', 'Tipo', 'Equipo', 'Detalle', 'Persona', 'Hecho por'],
        filas.map((x) => [new Date(x.en).toLocaleString('es-CO', { timeZone: 'America/Bogota' }), x.fuente, x.tipo, x.equipo, x.texto, x.persona, x.actor])
      )
      const txt = `${filas.length} filas exportadas.`
      ctx.imprimir(txt, 'ok')
      return txt
    }
  }
]

export function buscarComando(nombre: string): Comando | undefined {
  const n = nombre.toLowerCase()
  return COMANDOS.find((c) => c.nombre === n || c.alias?.includes(n))
}

/** Los alias de órdenes («apagar sala») se reescriben como «orden apagar sala». */
export function normalizar(nombre: string, args: Args): { comando?: Comando; args: Args } {
  const c = buscarComando(nombre)
  if (c?.nombre === 'orden' && nombre !== 'orden') return { comando: c, args: { ...args, pos: [nombre, ...args.pos] } }
  return { comando: c, args }
}

/** Completar con Tab: nombre del comando, palabra clave o código de equipo. */
export function completar(linea: string, equipos: string[]): string {
  const partes = linea.split(' ')
  const ultima = partes[partes.length - 1]
  const candidatos =
    partes.length === 1
      ? COMANDOS.flatMap((c) => [c.nombre, ...(c.alias ?? [])]).filter((x) => /^[a-zñ]+$/.test(x))
      : [
          ...equipos,
          'sala',
          'observar',
          'avisar',
          'bloquear',
          'estable',
          'pruebas',
          'reiniciar',
          'actualizar',
          'apagar',
          'encender',
          'desinstalar',
          'quitar',
          'fin',
          'hoy',
          'mañana',
          '--fuente',
          '--equipo',
          '--buscar',
          '--desde',
          '--hasta',
          '--cancelar',
          '--dias',
          ...FUENTES
        ]
  const opciones = candidatos.filter((x) => x.toLowerCase().startsWith(ultima.toLowerCase()))
  if (!ultima || opciones.length === 0) return linea
  // Prefijo común de todas las opciones.
  let comun = opciones[0]
  for (const o of opciones.slice(1)) while (!o.toLowerCase().startsWith(comun.toLowerCase())) comun = comun.slice(0, -1)
  partes[partes.length - 1] = opciones.length === 1 ? opciones[0] + ' ' : comun.length > ultima.length ? comun : ultima
  return partes.join(' ')
}
