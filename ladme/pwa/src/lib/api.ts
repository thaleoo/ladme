import { supabase } from './supabase'
import type {
  Aviso, Clase, Equipo, ReglamentoVersion, ReglamentoVigente, EstadoClase, EstadoSoftware, Inasistencia, SolicitudSoftware, Estadisticas, EstadisticasSoporte, Mantenimiento, Reporte, Ocupacion, Perfil, Politica, Reserva, ResultadoValidacion, Rol, Solicitud
} from './types'

function fail(contexto: string, error: { message: string } | null): never {
  throw new Error(error?.message ? `${contexto}: ${error.message}` : contexto)
}

const SELECT_RESERVA = '*, equipos(codigo, nombre, ubicacion, foto_url), perfiles(nombre, correo, programa)'

/** Perfil del usuario autenticado (lo crea un trigger al registrarse). */
/**
 * Usuario de la sesión guardada en el dispositivo, sin ir al servidor de
 * autenticación (getUser hace una consulta de red en cada llamada). La base de
 * datos valida el token en cada petición, así que no se pierde seguridad.
 */
async function usuarioActual(): Promise<{ user: { id: string } | null }> {
  const { data } = await supabase.auth.getSession()
  return { user: data.session?.user ?? null }
}

export async function obtenerPerfil(): Promise<Perfil | null> {
  const auth = await usuarioActual()
  if (!auth.user) return null
  const { data, error } = await supabase.from('perfiles').select('*').eq('id', auth.user.id).single()
  if (error) fail('No se pudo leer el perfil', error)
  return data as Perfil
}

export async function listarEquipos(incluirArchivados = false): Promise<Equipo[]> {
  let consulta = supabase.from('equipos').select('*').order('codigo')
  if (!incluirArchivados) consulta = consulta.eq('archivado', false)
  const { data, error } = await consulta
  if (error) fail('No se pudieron cargar los equipos', error)
  return (data ?? []) as Equipo[]
}

export async function equiposDisponibles(inicio: string, fin: string): Promise<Array<{ codigo: string; nombre: string }>> {
  const { data, error } = await supabase.rpc('equipos_disponibles', { p_inicio: inicio, p_fin: fin })
  if (error) fail('No se pudo consultar la disponibilidad', error)
  return (data ?? []) as Array<{ codigo: string; nombre: string }>
}

export async function crearReserva(input: {
  equipo: string
  inicio: string
  fin: string
  actividad?: string
  detalle?: string
  desatendido?: boolean
  mensaje?: string
  idSolicitud?: string
  docente?: string
}): Promise<Reserva> {
  const { data, error } = await supabase.rpc('crear_reserva', {
    p_equipo: input.equipo,
    p_inicio: input.inicio,
    p_fin: input.fin,
    p_actividad: input.actividad ?? null,
    p_detalle: input.detalle ?? null,
    p_desatendido: input.desatendido ?? false,
    p_mensaje: input.mensaje ?? null,
    p_id_solicitud: input.idSolicitud ?? null,
    p_docente: input.docente ?? null
  })
  if (error) fail('No se pudo crear la reserva', error)
  return data as Reserva
}

export async function misReservas(): Promise<Reserva[]> {
  const auth = await usuarioActual()
  if (!auth.user) return []
  const { data, error } = await supabase
    .from('reservas')
    .select(SELECT_RESERVA)
    .eq('usuario_id', auth.user.id)
    .eq('tipo', 'reserva')
    .order('inicio', { ascending: false })
  if (error) fail('No se pudieron cargar sus reservas', error)
  return (data ?? []) as Reserva[]
}

export async function cancelarReserva(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('cancelar_reserva', { p_reserva: id, p_motivo: motivo })
  if (error) fail('No se pudo cancelar la reserva', error)
}

export async function extenderReserva(id: string, nuevoFin: string): Promise<void> {
  const { error } = await supabase.rpc('extender_reserva', { p_reserva: id, p_nuevo_fin: nuevoFin })
  if (error) fail('No se pudo extender la reserva', error)
}

export async function liberarReserva(id: string): Promise<void> {
  const { error } = await supabase.rpc('liberar_reserva', { p_reserva: id })
  if (error) fail('No se pudo liberar la reserva', error)
}

export async function registrarLlegada(id: string): Promise<void> {
  const { error } = await supabase.rpc('registrar_llegada', { p_reserva: id })
  if (error) fail('No se pudo registrar la llegada', error)
}

export async function validarCredencial(token: string): Promise<ResultadoValidacion> {
  const { data, error } = await supabase.rpc('validar_credencial', { p_token: token })
  if (error) fail('No se pudo validar la credencial', error)
  return data as ResultadoValidacion
}

export async function ocupacionPublica(codigo: string): Promise<Ocupacion[]> {
  const { data, error } = await supabase
    .from('ocupacion_publica')
    .select('*')
    .eq('codigo', codigo)
    .order('inicio')
  if (error) fail('No se pudo cargar la ocupación del equipo', error)
  return (data ?? []) as Ocupacion[]
}

export async function listarOcupacion(): Promise<Ocupacion[]> {
  const { data, error } = await supabase
    .from('ocupacion_publica')
    .select('*')
    .order('inicio')
  if (error) fail('No se pudo cargar la ocupación', error)
  return (data ?? []) as Ocupacion[]
}

export async function obtenerEquipo(codigo: string): Promise<Equipo | null> {
  const { data, error } = await supabase
    .from('equipos')
    .select('*')
    .eq('codigo', codigo.toUpperCase())
    .maybeSingle()
  if (error) fail('No se pudo cargar el equipo', error)
  if (data) return data as Equipo
  // Una etiqueta NFC/QR vieja (de antes de cambiar el código del equipo) lleva al equipo actual.
  const actual = await resolverCodigoEquipo(codigo).catch(() => null)
  return actual && actual !== codigo.toUpperCase() ? obtenerEquipo(actual) : null
}

/** Código vigente del equipo que hoy se llama así o que antes se llamaba así (null si no existe). */
export async function resolverCodigoEquipo(codigo: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolver_codigo_equipo', { p_codigo: codigo })
  if (error) fail('No se pudo resolver el código del equipo', error)
  return (data as string | null) ?? null
}

/** Cambia el código de un equipo; las etiquetas con el código anterior siguen funcionando. Solo el personal. */
export async function renombrarEquipo(id: string, codigo: string): Promise<{ anterior: string; codigo: string }> {
  const { data, error } = await supabase.rpc('renombrar_equipo', { p_equipo: id, p_codigo: codigo })
  if (error) fail('No se pudo cambiar el código', error)
  return data as { anterior: string; codigo: string }
}

/** Códigos que el equipo tuvo antes y que siguen llevando a él (etiquetas viejas). Solo el personal. */
export async function codigosAnterioresEquipo(id: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('equipo_codigos_anteriores')
    .select('codigo')
    .eq('equipo_id', id)
    .order('reemplazado_en', { ascending: false })
  if (error) return [] // la migración 0021 aún no se ha ejecutado
  return (data ?? []).map((f) => (f as { codigo: string }).codigo)
}

export async function obtenerReserva(id: string): Promise<Reserva | null> {
  const { data, error } = await supabase
    .from('reservas')
    .select(SELECT_RESERVA)
    .eq('id', id)
    .maybeSingle()
  if (error) fail('No se pudo cargar la reserva', error)
  return (data as Reserva | null) ?? null
}

export async function listarPoliticas(): Promise<Politica[]> {
  const { data, error } = await supabase.from('politicas').select('clave, valor, descripcion').order('clave')
  if (error) fail('No se pudieron cargar las políticas', error)
  return ((data ?? []) as Array<{ clave: string; valor: unknown; descripcion: string | null }>)
    .map((f) => ({ clave: f.clave, valor: Number(f.valor), descripcion: f.descripcion }))
    .filter((f) => Number.isFinite(f.valor))
}

export async function guardarPolitica(clave: string, valor: number): Promise<void> {
  const { error } = await supabase.from('politicas').update({ valor }).eq('clave', clave)
  if (error) fail('No se pudo guardar la política', error)
}

export interface EstadoMantenimientoEquipo {
  equipo_id: string
  codigo: string
  ultimo: string | null
  proximo: string | null
  vencido: boolean | null
}

export async function mantenimientoDelEquipo(equipoId: string): Promise<EstadoMantenimientoEquipo | null> {
  const { data, error } = await supabase
    .from('equipos_mantenimiento')
    .select('*')
    .eq('equipo_id', equipoId)
    .maybeSingle()
  if (error) fail('No se pudo consultar el mantenimiento del equipo', error)
  return (data as EstadoMantenimientoEquipo | null) ?? null
}

export async function listarMantenimientos(): Promise<Mantenimiento[]> {
  const { data, error } = await supabase
    .from('mantenimientos')
    .select('*, equipos(codigo, nombre)')
    .order('inicio', { ascending: false })
  if (error) fail('No se pudieron cargar los mantenimientos', error)
  return (data ?? []) as Mantenimiento[]
}

export async function crearMantenimiento(input: {
  equipo: string
  tipo: 'preventivo' | 'correctivo' | 'mejora'
  descripcion: string
  inicio: string
  fin: string
  responsable: string
  periodicidadDias: number
  cancelarConflictos?: boolean
}): Promise<{ mantenimiento: string; bloqueo: string | null; canceladas: number }> {
  const { data, error } = await supabase.rpc('crear_mantenimiento', {
    p_equipo: input.equipo,
    p_tipo: input.tipo,
    p_descripcion: input.descripcion,
    p_inicio: input.inicio,
    p_fin: input.fin,
    p_responsable: input.responsable,
    p_periodicidad_dias: input.periodicidadDias,
    p_cancelar_conflictos: input.cancelarConflictos ?? false
  })
  if (error) fail('No se pudo registrar el mantenimiento', error)
  return data as { mantenimiento: string; bloqueo: string | null; canceladas: number }
}

export async function accionMantenimiento(
  accion: 'iniciar' | 'completar' | 'validar' | 'cancelar',
  id: string,
  texto = ''
): Promise<void> {
  let error: { message: string } | null = null
  if (accion === 'iniciar') {
    ;({ error } = await supabase.rpc('iniciar_mantenimiento', { p_id: id }))
  } else if (accion === 'completar') {
    ;({ error } = await supabase.rpc('completar_mantenimiento', { p_id: id, p_hallazgos: texto }))
  } else if (accion === 'validar') {
    ;({ error } = await supabase.rpc('validar_mantenimiento', { p_id: id, p_hallazgos: texto || null }))
  } else {
    ;({ error } = await supabase.rpc('cancelar_mantenimiento', { p_id: id, p_motivo: texto }))
  }
  if (error) fail('No se pudo actualizar el mantenimiento', error)
}

export async function listarPerfiles(): Promise<Perfil[]> {
  const { data, error } = await supabase
    .from('perfiles')
    .select('*')
    .order('nombre')
  if (error) fail('No se pudieron cargar los usuarios', error)
  return (data ?? []) as Perfil[]
}

export async function asignarRol(usuario: string, rol: Rol): Promise<void> {
  const { error } = await supabase.rpc('asignar_rol', { p_usuario: usuario, p_rol: rol })
  if (error) fail('No se pudo asignar el rol', error)
}

export async function activarUsuario(usuario: string, activo: boolean): Promise<void> {
  const { error } = await supabase.rpc('activar_usuario', { p_usuario: usuario, p_activo: activo })
  if (error) fail('No se pudo cambiar el estado del usuario', error)
}

export async function otorgarPermiso(usuario: string, permiso: string, activo: boolean): Promise<void> {
  const { error } = await supabase.rpc('otorgar_permiso', {
    p_usuario: usuario,
    p_permiso: permiso,
    p_activo: activo
  })
  if (error) fail('No se pudo actualizar el permiso', error)
}

// ------------------------------------------------------------------ Perfil
export async function guardarPerfil(datos: {
  nombre: string
  tipo_usuario: string
  programa: string
  matricula: string | null
}): Promise<void> {
  const auth = await usuarioActual()
  if (!auth.user) throw new Error('Debe iniciar sesión.')
  const { error } = await supabase.from('perfiles').update(datos).eq('id', auth.user.id)
  if (error) fail('No se pudo guardar el perfil', error)
}

// ------------------------------------------------------------------ Avisos
export async function listarAvisos(): Promise<Aviso[]> {
  const { data, error } = await supabase
    .from('cola_notificaciones')
    .select('id, tipo, titulo, cuerpo, url, creado_en, leido_en')
    .order('creado_en', { ascending: false })
    .limit(60)
  if (error) fail('No se pudieron cargar los avisos', error)
  return (data ?? []) as Aviso[]
}

export async function contarAvisosSinLeer(): Promise<number> {
  const { count, error } = await supabase
    .from('cola_notificaciones')
    .select('id', { count: 'exact', head: true })
    .is('leido_en', null)
  if (error) return 0
  return count ?? 0
}

export async function marcarAvisosLeidos(): Promise<void> {
  const { error } = await supabase.rpc('marcar_avisos_leidos')
  if (error) fail('No se pudieron marcar los avisos', error)
}

// ---------------------------------------------------------------- Contacto
export async function contactarTitular(equipo: string, mensaje: string): Promise<void> {
  const { error } = await supabase.rpc('contactar_titular', { p_equipo: equipo, p_mensaje: mensaje })
  if (error) fail('No se pudo enviar el mensaje', error)
}

// ------------------------------------------------- Solicitudes de reserva larga
const SELECT_SOLICITUD =
  '*, equipos(codigo, nombre), solicitante:perfiles!solicitudes_excepcion_usuario_id_fkey(nombre, correo, programa)'

export async function solicitarExcepcion(input: {
  equipo: string
  inicio: string
  fin: string
  actividad: string
  detalle?: string
  justificacion: string
  docente?: string
}): Promise<void> {
  const { error } = await supabase.rpc('solicitar_excepcion', {
    p_equipo: input.equipo,
    p_inicio: input.inicio,
    p_fin: input.fin,
    p_actividad: input.actividad,
    p_detalle: input.detalle ?? null,
    p_justificacion: input.justificacion,
    p_docente: input.docente ?? null
  })
  if (error) fail('No se pudo enviar la solicitud', error)
}

export async function misSolicitudes(): Promise<Solicitud[]> {
  const auth = await usuarioActual()
  if (!auth.user) return []
  const { data, error } = await supabase
    .from('solicitudes_excepcion')
    .select(SELECT_SOLICITUD)
    .eq('usuario_id', auth.user.id)
    .order('creado_en', { ascending: false })
    .limit(20)
  if (error) fail('No se pudieron cargar sus solicitudes', error)
  return (data ?? []) as Solicitud[]
}

export async function listarSolicitudes(): Promise<Solicitud[]> {
  const { data, error } = await supabase
    .from('solicitudes_excepcion')
    .select(SELECT_SOLICITUD)
    .order('creado_en', { ascending: false })
    .limit(100)
  if (error) fail('No se pudieron cargar las solicitudes', error)
  return (data ?? []) as Solicitud[]
}

export async function retirarSolicitud(id: string): Promise<void> {
  const { error } = await supabase.rpc('retirar_solicitud', { p_id: id })
  if (error) fail('No se pudo retirar la solicitud', error)
}

export async function resolverSolicitud(id: string, aprobar: boolean, respuesta: string): Promise<void> {
  const { error } = await supabase.rpc('resolver_excepcion', {
    p_id: id,
    p_aprobar: aprobar,
    p_respuesta: respuesta || null
  })
  if (error) fail('No se pudo resolver la solicitud', error)
}

// ------------------------------------------------------------ Administración
/** Reservas y bloqueos (solo el personal ve los de otras personas, por RLS). */
export async function listarReservasAdmin(desde: string, hasta: string): Promise<Reserva[]> {
  const { data, error } = await supabase
    .from('reservas')
    .select(`${SELECT_RESERVA}, reservas_importadas(nombre_titular, correo_titular, reclamada_en)`)
    .lt('inicio', hasta)
    .gt('fin', desde)
    .order('inicio', { ascending: false })
    .limit(1000)
  if (error) fail('No se pudieron cargar las reservas', error)
  return (data ?? []) as Reserva[]
}

/** Nombres para autocompletar el docente responsable: los ya usados y los docentes verificados. */
export async function docentesSugeridos(): Promise<string[]> {
  const { data, error } = await supabase.rpc('docentes_sugeridos')
  if (error) return []
  return (data ?? []) as string[]
}

export interface CambioHistorial {
  campo: string
  antes: unknown
  despues: unknown
}

/** Todo lo que se sabe de una reserva (solo el personal). */
export interface DetalleReserva {
  reserva: Reserva
  estado_vigente: string | null
  equipo: {
    codigo: string
    nombre: string
    ubicacion: string | null
    marca: string | null
    modelo: string | null
    sistema_operativo: string | null
    so_version: string | null
    foto_url: string | null
    estado: string
  } | null
  titular: {
    id: string
    nombre: string
    correo: string
    rol: string
    activo: boolean
    tipo_usuario: string | null
    programa: string | null
    matricula: string | null
    docente_verificado_en: string | null
    creado_en: string
    reservas: number
    inasistencias: number
  } | null
  importada: { nombre: string | null; correo: string | null; codigo_origen: string | null; reclamada_en: string | null; importado_en: string } | null
  solicitud_larga: { justificacion: string; creado_en: string; respuesta: string | null; resuelto_en: string | null; resuelto_por: string | null } | null
  clase: { id: number; nombre: string; grupo: number; docente: string } | null
  historial: Array<{ en: string; accion: string; actor: string | null; actor_es_titular: boolean | null; cambios: CambioHistorial[] }>
  faro: Array<{ en: string; tipo: string; detalle: Record<string, unknown>; actor: string | null }>
  inasistencia: {
    numero: number
    estado: string
    sancion_hasta: string | null
    apelacion: string | null
    apelada_en: string | null
    respuesta: string | null
    resuelto_en: string | null
    creado_en: string
  } | null
  software: Array<{ id: number; software: string; version: string | null; estado: string; creado_en: string; respuesta: string | null }>
  fallas: Array<{ id: string; categoria: string; descripcion: string; estado: string; respuesta: string | null; creado_en: string }>
}

export async function reservaDetalle(id: string): Promise<DetalleReserva | null> {
  const { data, error } = await supabase.rpc('reserva_detalle', { p_id: id })
  if (error) fail('No se pudo cargar la reserva', error)
  return (data ?? null) as DetalleReserva | null
}

export async function crearBloqueo(input: {
  equipo: string
  inicio: string
  fin: string
  motivo: string
  cancelarConflictos: boolean
}): Promise<{ bloqueo: string; canceladas: number }> {
  const { data, error } = await supabase.rpc('crear_bloqueo', {
    p_equipo: input.equipo,
    p_inicio: input.inicio,
    p_fin: input.fin,
    p_motivo: input.motivo,
    p_cancelar_conflictos: input.cancelarConflictos
  })
  if (error) fail('No se pudo crear el bloqueo', error)
  return data as { bloqueo: string; canceladas: number }
}

export async function cancelarBloqueo(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancelar_bloqueo', { p_bloqueo: id })
  if (error) fail('No se pudo quitar el bloqueo', error)
}

export async function guardarEquipo(equipo: Partial<Equipo> & { codigo: string; nombre: string }): Promise<void> {
  const { id, ...campos } = equipo
  const consulta = id
    ? supabase.from('equipos').update(campos).eq('id', id)
    : supabase.from('equipos').insert(campos)
  const { error } = await consulta
  if (error) fail('No se pudo guardar el equipo', error)
}

export async function estadisticas(desde: string, hasta: string): Promise<Estadisticas> {
  const { data, error } = await supabase.rpc('estadisticas', { p_desde: desde, p_hasta: hasta })
  if (error) fail('No se pudieron calcular las estadísticas', error)
  return data as Estadisticas
}

// ------------------------------------------------------------ Reportes de fallas
const SELECT_REPORTE = '*, equipos(codigo, nombre, estado), autor:perfiles!reportes_usuario_id_fkey(nombre, correo)'

export async function reportarFalla(equipo: string, categoria: string, descripcion: string): Promise<void> {
  const { error } = await supabase.rpc('reportar_falla', {
    p_equipo: equipo,
    p_categoria: categoria,
    p_descripcion: descripcion
  })
  if (error) fail('No se pudo enviar el reporte', error)
}

/** Reportes visibles para quien consulta: los propios, o todos si es del personal (RLS). */
export async function listarReportes(equipoId?: string): Promise<Reporte[]> {
  let consulta = supabase.from('reportes').select(SELECT_REPORTE).order('creado_en', { ascending: false }).limit(200)
  if (equipoId) consulta = consulta.eq('equipo_id', equipoId)
  const { data, error } = await consulta
  if (error) fail('No se pudieron cargar los reportes', error)
  return (data ?? []) as Reporte[]
}

export async function atenderReporte(
  id: string,
  estado: 'en_revision' | 'resuelto' | 'descartado',
  respuesta: string,
  fueraDeServicio: boolean
): Promise<void> {
  const { error } = await supabase.rpc('atender_reporte', {
    p_id: id,
    p_estado: estado,
    p_respuesta: respuesta || null,
    p_fuera_de_servicio: fueraDeServicio
  })
  if (error) fail('No se pudo actualizar el reporte', error)
}

// ----------------------------------------------------- Alerta «ya está libre»
export async function tengoAlerta(equipoId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('alertas_liberacion')
    .select('equipo_id', { count: 'exact', head: true })
    .eq('equipo_id', equipoId)
  if (error) return false
  return (count ?? 0) > 0
}

export async function alternarAlerta(equipo: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('alternar_alerta_liberacion', { p_equipo: equipo })
  if (error) fail('No se pudo cambiar la alerta', error)
  return data === true
}

// ------------------------------------------------- Reglamento y valoración
export async function aceptarReglamento(): Promise<void> {
  const { error } = await supabase.rpc('aceptar_reglamento')
  if (error) fail('No se pudo registrar la aceptación', error)
}

/** Última versión del reglamento y si esta persona debe aceptarla. Null si la migración 0022 aún no se ejecutó. */
export async function reglamentoVigente(): Promise<ReglamentoVigente | null> {
  const { data, error } = await supabase.rpc('reglamento_vigente')
  if (error) return null
  return (data as ReglamentoVigente | null) ?? null
}

export async function historialReglamento(): Promise<ReglamentoVersion[]> {
  const { data, error } = await supabase
    .from('reglamento_versiones')
    .select('version, reglas, obligatoria, nota, publicado_en')
    .order('version', { ascending: false })
  if (error) fail('No se pudo cargar el reglamento', error)
  return (data ?? []) as ReglamentoVersion[]
}

/** Publica una versión nueva del reglamento (solo administración). Devuelve el número de versión. */
export async function publicarReglamento(reglas: Array<{ titulo: string; texto: string }>, obligatoria: boolean, nota: string): Promise<number> {
  const { data, error } = await supabase.rpc('publicar_reglamento', { p_reglas: reglas, p_obligatoria: obligatoria, p_nota: nota })
  if (error) fail('No se pudo publicar el reglamento', error)
  return data as number
}

export async function valorarReserva(id: string, funciono: boolean): Promise<void> {
  const { error } = await supabase.rpc('valorar_reserva', { p_reserva: id, p_funciono: funciono })
  if (error) fail('No se pudo guardar su respuesta', error)
}

export async function estadisticasSoporte(desde: string, hasta: string): Promise<EstadisticasSoporte> {
  const { data, error } = await supabase.rpc('estadisticas_soporte', { p_desde: desde, p_hasta: hasta })
  if (error) fail('No se pudieron calcular las estadísticas de soporte', error)
  return data as EstadisticasSoporte
}

/** Reservas propias desde una fecha (para «Mi uso»). */
export async function misReservasDesde(desde: string | null): Promise<Reserva[]> {
  const auth = await usuarioActual()
  if (!auth.user) return []
  let consulta = supabase
    .from('reservas')
    .select('id, codigo_legible, inicio, fin, liberada_en, estado, actividad, tipo, equipos(codigo, nombre, ubicacion)')
    .eq('usuario_id', auth.user.id)
    .eq('tipo', 'reserva')
    .neq('estado', 'cancelada')
    .order('inicio', { ascending: false })
    .limit(2000)
  if (desde) consulta = consulta.gte('inicio', desde)
  const { data, error } = await consulta
  if (error) fail('No se pudo cargar su historial', error)
  return (data ?? []) as unknown as Reserva[]
}

// ------------------------------------------------------------------ Usuarios
export type FiltroUsuarios = 'todos' | 'usuario' | 'laboratorista' | 'administrador' | 'inhabilitados' | 'tecnicos'

export interface ResumenUsuarios {
  total: number
  usuario: number
  laboratorista: number
  administrador: number
  inhabilitados: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConsultaFiltrable = any

function aplicarFiltro(q: ConsultaFiltrable, filtro: FiltroUsuarios): ConsultaFiltrable {
  if (filtro === 'inhabilitados') return q.eq('activo', false)
  if (filtro === 'tecnicos') return q.contains('permisos', ['validar_mantenimiento'])
  if (filtro !== 'todos') return q.eq('rol', filtro)
  return q
}

/** Búsqueda paginada en el servidor: la lista nunca trae a todos los usuarios de una vez. */
export async function buscarUsuarios(texto: string, filtro: FiltroUsuarios, pagina: number, tamano = 30) {
  let q = aplicarFiltro(supabase.from('perfiles').select('*', { count: 'exact' }), filtro)
  const limpio = texto.trim().replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').slice(0, 60)
  if (limpio) q = q.or(`nombre.ilike.*${limpio}*,correo.ilike.*${limpio}*,programa.ilike.*${limpio}*`)
  const { data, error, count } = await q
    .order('nombre')
    .range(pagina * tamano, pagina * tamano + tamano - 1)
  if (error) fail('No se pudieron cargar los usuarios', error)
  return { lista: (data ?? []) as Perfil[], total: count ?? 0 }
}

export async function resumenUsuarios(): Promise<ResumenUsuarios> {
  const contar = async (filtro: FiltroUsuarios) => {
    const { count } = await aplicarFiltro(supabase.from('perfiles').select('id', { count: 'exact', head: true }), filtro)
    return count ?? 0
  }
  const [total, usuario, laboratorista, administrador, inhabilitados] = await Promise.all([
    contar('todos'), contar('usuario'), contar('laboratorista'), contar('administrador'), contar('inhabilitados')
  ])
  return { total, usuario, laboratorista, administrador, inhabilitados }
}

/** Actividad de una persona para la ficha del panel de usuarios. */
export async function actividadUsuario(id: string) {
  const [{ count }, { data }] = await Promise.all([
    supabase.from('reservas').select('id', { count: 'exact', head: true }).eq('usuario_id', id).eq('tipo', 'reserva'),
    supabase
      .from('reservas')
      .select('inicio, equipos(codigo)')
      .eq('usuario_id', id)
      .eq('tipo', 'reserva')
      .order('inicio', { ascending: false })
      .limit(1)
  ])
  const ultima = (data?.[0] ?? null) as { inicio: string; equipos: { codigo: string } | null } | null
  return { reservas: count ?? 0, ultima }
}

// ---------------------------------------------------------- Errores de la app
export interface ErrorApp {
  id: number
  tipo: string
  mensaje: string
  pila: string | null
  ruta: string | null
  agente: string | null
  version: string | null
  creado_en: string
  perfiles: { nombre: string; correo: string } | null
}

export async function listarErroresApp(): Promise<ErrorApp[]> {
  const { data, error } = await supabase
    .from('errores_app')
    .select('*, perfiles(nombre, correo)')
    .order('creado_en', { ascending: false })
    .limit(300)
  if (error) fail('No se pudieron cargar los errores', error)
  return (data ?? []) as ErrorApp[]
}

// ------------------------------------------------- Faro (agente de los PC de la sala)
export type ModoFaro = 'observar' | 'avisar' | 'bloquear'

export interface EquipoFaro {
  codigo: string
  nombre: string
  categoria: string
  estado: string
  sistema_operativo: string | null
  vinculado: boolean
  vinculado_en: string | null
  codigo_vinculo: string | null
  codigo_vence: string | null
  modo: ModoFaro
  ultimo_latido: string | null
  version: string | null
  host: string | null
  so: string | null
  inactivo_seg: number | null
  bloqueado: boolean
  desbloqueo_hasta: string | null
  /** Pantalla suspendida por el personal hasta este momento (Faro 0.7). */
  suspendido_hasta?: string | null
  usos_sin_reserva_7d: number
  canal: 'estable' | 'pruebas'
  cpu_pct: number | null
  software: string[]
  comandos_pendientes: number
  inventario: InventarioFaro | null
  inventario_en: string | null
}

export interface InventarioFaro {
  cpu?: string
  nucleos?: number
  ram_gb?: number
  disco_gb?: number
  disco_libre_gb?: number
  mac?: string
  so_tipo?: string
  so_version?: string
  arranque_h?: number
  software?: string[]
  /** Estado de salud del disco que da el sistema (Faro 0.5 o superior). */
  disco_salud?: 'ok' | 'advertencia' | 'falla' | null
  /** Faro 0.5.6 o superior. */
  hilos?: number
  gpus?: Array<{ nombre: string; vram_gb: number | null; dedicada: boolean }>
  camaras?: string[]
  so_nombre?: string | null
  /** Cuenta del sistema en la que corre Faro (qué perfil está en uso). */
  cuenta?: string | null
}

export interface EventoFaro {
  id: number
  equipo: string
  tipo: string
  detalle: Record<string, unknown>
  actor: string | null
  creado_en: string
}

export interface PanelFaro {
  ahora: string
  clave_creada_en: string | null
  anuncios: Array<{ id: number; texto: string; equipos: string[] | null; hasta: string; obligatorio?: boolean; confirmados?: number }>
  equipos: EquipoFaro[]
  eventos: EventoFaro[]
}

export async function panelFaro(): Promise<PanelFaro> {
  const { data, error } = await supabase.rpc('faro_panel')
  if (error) fail('No se pudo cargar Faro', error)
  return data as PanelFaro
}

export async function codigoVinculoFaro(equipo: string): Promise<{ codigo: string; vence: string; equipo: string }> {
  const { data, error } = await supabase.rpc('faro_codigo_vinculo', { p_equipo: equipo })
  if (error) fail('No se pudo generar el código', error)
  return data as { codigo: string; vence: string; equipo: string }
}

export async function modoFaro(equipos: string[] | null, modo: ModoFaro): Promise<number> {
  const { data, error } = await supabase.rpc('faro_modo', { p_equipos: equipos, p_modo: modo })
  if (error) fail('No se pudo cambiar el modo', error)
  return Number(data ?? 0)
}

export async function desbloquearFaro(equipo: string, minutos: number): Promise<void> {
  const { error } = await supabase.rpc('faro_desbloquear', { p_equipo: equipo, p_minutos: minutos })
  if (error) fail('No se pudo desbloquear', error)
}

export async function desvincularFaro(equipo: string): Promise<void> {
  const { error } = await supabase.rpc('faro_desvincular', { p_equipo: equipo })
  if (error) fail('No se pudo desvincular', error)
}

export async function generarClaveFaro(): Promise<string> {
  const { data, error } = await supabase.rpc('faro_generar_clave')
  if (error) fail('No se pudo generar la clave', error)
  return String(data)
}

export interface UsoEquipoFaro {
  codigo: string
  encendido_h: number
  uso_h: number
  sin_reserva_h: number
  reservado_h: number
  reservas_sin_uso: number
}

export interface EstadisticasFaro {
  por_equipo: UsoEquipoFaro[]
  /** dia: 1 = lunes … 7 = domingo; hora 0–23 en hora de Bogotá. */
  por_hora: Array<{ dia: number; hora: number; uso_h: number; sin_reserva_h: number }>
}

export async function estadisticasFaro(desde: string, hasta: string): Promise<EstadisticasFaro> {
  const { data, error } = await supabase.rpc('faro_estadisticas', { p_desde: desde, p_hasta: hasta })
  if (error) fail('No se pudo calcular el uso real', error)
  return data as EstadisticasFaro
}

export async function empezarClaseFaro(equipos: string[] | null, minutos: number, motivo: string): Promise<{ equipos: string[]; omitidos: string[]; fin: string }> {
  const { data, error } = await supabase.rpc('faro_clase', { p_equipos: equipos, p_minutos: minutos, p_motivo: motivo })
  if (error) fail('No se pudo empezar la clase', error)
  return data as { equipos: string[]; omitidos: string[]; fin: string }
}

export async function terminarClaseFaro(equipos: string[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('faro_clase_terminar', { p_equipos: equipos })
  if (error) fail('No se pudo terminar la clase', error)
  return Number(data ?? 0)
}

// ------------------------------------------------- 0008: llegada por QR, órdenes, espera, sala
export async function registrarLlegadaPc(equipo: string, codigo: string): Promise<void> {
  const { error } = await supabase.rpc('registrar_llegada_pc', { p_equipo: equipo, p_codigo: codigo })
  if (error) fail('No se pudo registrar la llegada', error)
}

export type OrdenFaro = 'reiniciar' | 'actualizar' | 'apagar' | 'encender' | 'desinstalar' | 'inventario'

export type MotivoOmision = 'sin_faro' | 'ya_encendido' | 'sin_mac' | 'apagado' | 'compartido' | 'clase' | 'bloqueo' | 'reserva' | 'en_espera'
export interface ResultadoOrden {
  tipo: OrdenFaro
  sala: boolean
  enviados: string[]
  omitidos: { codigo: string; motivo: MotivoOmision }[]
  ayudante: string | null
}

/** Envía una orden y devuelve a quién llegó y por qué se omitió cada equipo. */
export async function ordenFaro(equipos: string[] | null, orden: OrdenFaro): Promise<ResultadoOrden> {
  const { data, error } = await supabase.rpc('faro_orden', { p_equipos: equipos, p_tipo: orden })
  if (error) fail('No se pudo enviar la orden', error)
  return data as ResultadoOrden
}

const MOTIVOS: Record<MotivoOmision, [string, string]> = {
  sin_faro: ['no tiene Faro vinculado', 'sin Faro'],
  ya_encendido: ['ya está encendido', 'ya encendidos'],
  sin_mac: ['Faro aún no envió su dirección de red (MAC); espere unos minutos con el equipo encendido', 'sin dirección de red registrada'],
  apagado: ['ya está apagado o sin señal', 'ya apagados o sin señal'],
  compartido: ['tiene un uso compartido en curso', 'con uso compartido'],
  clase: ['tiene una clase en curso', 'con clase en curso'],
  bloqueo: ['tiene un bloqueo en curso', 'con bloqueo en curso'],
  reserva: ['tiene una reserva en curso', 'con reserva en curso'],
  en_espera: ['está sin señal: la recibirá cuando vuelva a conectarse', 'sin señal (la recibirán al conectarse)']
}
const VERBO: Record<OrdenFaro, string> = {
  encender: 'Señal de encendido enviada',
  apagar: 'Apagado ordenado',
  reiniciar: 'Reinicio de Faro ordenado',
  actualizar: 'Actualización de Faro ordenada',
  desinstalar: 'Desinstalación de Faro ordenada',
  inventario: 'Lectura de datos pedida'
}

/**
 * Mensaje según a quién iba la orden: para un equipo se explica su caso; para la sala, cuántos la
 * recibieron y los motivos agrupados de los que no.
 */
export function textoOrden(r: ResultadoOrden): { texto: string; ok: boolean } {
  const omitidos = r.omitidos.filter((o) => o.motivo !== 'en_espera')
  const enEspera = r.omitidos.filter((o) => o.motivo === 'en_espera')
  const desde = r.tipo === 'encender' && r.ayudante ? ` (desde ${r.ayudante})` : ''
  if (!r.sala && r.enviados.length + omitidos.length === 1) {
    const codigo = r.enviados[0] ?? omitidos[0].codigo
    if (r.enviados.length === 1) {
      const extra = r.tipo === 'encender' ? ' Si no enciende en 2 minutos, revise que el encendido por red esté activo en la BIOS.'
        : enEspera.length ? ` ${codigo} ${MOTIVOS.en_espera[0]}.` : ''
      return { texto: `${VERBO[r.tipo]} a ${codigo}${desde}.${extra}`, ok: true }
    }
    return { texto: `${codigo} ${MOTIVOS[omitidos[0].motivo][0]}: no se envió la orden.`, ok: false }
  }
  const partes: string[] = []
  if (r.enviados.length) partes.push(`${VERBO[r.tipo]} a ${r.enviados.length} ${r.enviados.length === 1 ? 'equipo' : 'equipos'}${desde}.`)
  else partes.push('Ningún equipo recibió la orden.')
  const grupos = new Map<MotivoOmision, string[]>()
  for (const o of omitidos) grupos.set(o.motivo, [...(grupos.get(o.motivo) ?? []), o.codigo])
  if (grupos.size)
    partes.push(
      'Sin enviar: ' +
        [...grupos.entries()].map(([m, l]) => `${l.length} ${MOTIVOS[m][1]}${l.length <= 3 ? ` (${l.join(', ')})` : ''}`).join(' · ') +
        '.'
    )
  if (enEspera.length) partes.push(`${enEspera.length} ${MOTIVOS.en_espera[1]}.`)
  return { texto: partes.join(' '), ok: r.enviados.length > 0 }
}

// ------------------------------------------------------------ Telegram
export async function telegramCodigo(): Promise<string> {
  const { data, error } = await supabase.rpc('telegram_codigo')
  if (error) fail('No se pudo generar el código', error)
  return data as string
}
export async function telegramMiVinculo(): Promise<{ nombre: string | null; creado_en: string } | null> {
  const { data, error } = await supabase.rpc('telegram_mi_vinculo')
  if (error) fail('No se pudo consultar Telegram', error)
  return (data as { nombre: string | null; creado_en: string } | null) ?? null
}
export async function telegramDesvincular(): Promise<void> {
  const { error } = await supabase.rpc('telegram_desvincular')
  if (error) fail('No se pudo desvincular', error)
}

export async function anunciarFaro(texto: string, minutos: number, equipos: string[] | null = null, obligatorio = false): Promise<void> {
  const { error } = await supabase.rpc('faro_anunciar', { p_texto: texto, p_minutos: minutos, p_equipos: equipos, p_obligatorio: obligatorio })
  if (error) fail('No se pudo publicar el anuncio', error)
}

/** «Bloquear ya»: tapa la pantalla sin cerrar programas. Devuelve cuántos equipos se suspendieron. */
export async function suspenderFaro(equipos: string[] | null, minutos: number): Promise<number> {
  const { data, error } = await supabase.rpc('faro_suspender', { p_equipos: equipos, p_minutos: minutos })
  if (error) fail('No se pudo suspender la pantalla', error)
  return Number(data ?? 0)
}

export async function reanudarFaro(equipos: string[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('faro_reanudar', { p_equipos: equipos })
  if (error) fail('No se pudo quitar la suspensión', error)
  return Number(data ?? 0)
}

/** Clave temporal del personal: desbloquea un equipo (o toda la sala) por unos minutos, también sin internet. */
export async function claveTemporalFaro(equipo: string | null, minutos: number): Promise<{ clave: string; hasta: string }> {
  const { data, error } = await supabase.rpc('faro_clave_temporal', { p_equipo: equipo, p_minutos: minutos })
  if (error) fail('No se pudo crear la clave temporal', error)
  return data as { clave: string; hasta: string }
}

/** Quita la suspensión de un equipo con el QR de un solo uso de su pantalla. */
export async function desbloquearConQr(equipo: string, codigo: string): Promise<string> {
  const { data, error } = await supabase.rpc('desbloquear_con_qr', { p_equipo: equipo, p_codigo: codigo })
  if (error) fail('No se pudo desbloquear', error)
  return (data as { texto: string }).texto
}

export async function quitarAnuncioFaro(id: number): Promise<void> {
  const { error } = await supabase.rpc('faro_quitar_anuncio', { p_id: id })
  if (error) fail('No se pudo quitar el anuncio', error)
}

export async function canalFaro(equipos: string[] | null, canal: 'estable' | 'pruebas'): Promise<void> {
  const { error } = await supabase.rpc('faro_canal', { p_equipos: equipos, p_canal: canal })
  if (error) fail('No se pudo cambiar el canal', error)
}

export interface Espera {
  id: number
  software: string | null
  creado_en: string
  vence: string
  avisado_en: string | null
}

export async function miEspera(): Promise<Espera | null> {
  const { data, error } = await supabase
    .from('lista_espera')
    .select('id, software, creado_en, vence, avisado_en')
    .is('avisado_en', null)
    .gt('vence', new Date().toISOString())
    .maybeSingle()
  if (error) return null
  return (data as Espera | null) ?? null
}

export async function unirseEspera(software: string | null): Promise<void> {
  const { error } = await supabase.rpc('unirse_espera', { p_software: software })
  if (error) fail('No se pudo entrar a la lista de espera', error)
}

export async function salirEspera(): Promise<void> {
  const { error } = await supabase.rpc('salir_espera')
  if (error) fail('No se pudo salir de la lista de espera', error)
}

export interface EquipoSala {
  codigo: string
  categoria: string
  x: number | null
  y: number | null
  sistema: string
  estado: 'libre' | 'ocupado' | 'bloqueado' | 'mantenimiento'
  hasta: string | null
  proxima: string | null
  faro: boolean | null
}

/** Estado de la sala sin datos personales; funciona sin iniciar sesión (pantalla del laboratorio). */
export async function salaPublica(): Promise<EquipoSala[]> {
  const { data, error } = await supabase.rpc('sala_publica')
  if (error) fail('No se pudo cargar la sala', error)
  return (data ?? []) as EquipoSala[]
}

// ------------------------------------------------------------ Registro y consola
export type FuenteRegistro = 'reservas' | 'faro' | 'fallas' | 'mantenimiento' | 'solicitudes' | 'errores' | 'consola'

export interface FilaRegistro {
  en: string
  fuente: FuenteRegistro
  tipo: string
  equipo: string | null
  texto: string
  persona: string | null
  actor: string | null
}

export interface FiltrosRegistro {
  fuentes?: FuenteRegistro[] | null
  equipo?: string | null
  desde?: string | null
  hasta?: string | null
  buscar?: string | null
}

/** Historial unificado del laboratorio (solo personal), de a páginas. */
export async function registro(f: FiltrosRegistro, limite = 25, offset = 0): Promise<{ total: number; filas: FilaRegistro[] }> {
  const { data, error } = await supabase.rpc('registro', {
    p_fuentes: f.fuentes?.length ? f.fuentes : null,
    p_equipo: f.equipo || null,
    p_desde: f.desde || null,
    p_hasta: f.hasta || null,
    p_buscar: f.buscar || null,
    p_limite: limite,
    p_offset: offset
  })
  if (error) fail('No se pudo cargar el registro', error)
  return data as { total: number; filas: FilaRegistro[] }
}

/** Deja constancia de un comando de la consola (quién, qué y cómo terminó). */
export async function anotarComando(comando: string, ok: boolean, resultado: string | null): Promise<void> {
  const { error } = await supabase.rpc('consola_anotar', { p_comando: comando, p_ok: ok, p_resultado: resultado })
  if (error) console.warn('No se pudo anotar el comando', error.message)
}

// ------------------------------------------------------------ Uso compartido
/** El titular comparte (o deja de compartir) su reserva mientras no está. */
export async function marcarCompartida(reserva: string, compartida: boolean, protegidos: string[] = [], nota?: string): Promise<void> {
  const { error } = await supabase.rpc('marcar_compartida', {
    p_reserva: reserva,
    p_compartida: compartida,
    p_protegidos: protegidos,
    p_nota: nota ?? null
  })
  if (error) fail('No se pudo cambiar el uso compartido', error)
}

// ------------------------------------------------------------ Clases
export interface DatosClase {
  nombre: string
  docente: string
  grupo: number
  dias: number[]
  horaInicio: string
  horaFin: string
  desde: string
  hasta: string
  equipos?: number | null
  notas?: string | null
}

export async function solicitarClase(d: DatosClase): Promise<Clase> {
  const { data, error } = await supabase.rpc('solicitar_clase', {
    p_nombre: d.nombre,
    p_docente: d.docente,
    p_grupo: d.grupo,
    p_dias: d.dias,
    p_hora_inicio: d.horaInicio,
    p_hora_fin: d.horaFin,
    p_desde: d.desde,
    p_hasta: d.hasta,
    p_equipos: d.equipos ?? null,
    p_notas: d.notas ?? null
  })
  if (error) fail('No se pudo enviar la solicitud', error)
  return data as Clase
}

/** Las propias (docente) o todas (personal), las más recientes primero. */
export async function listarClases(soloPendientes = false): Promise<Clase[]> {
  let q = supabase.from('clases').select('*').order('creado_en', { ascending: false }).limit(200)
  if (soloPendientes) q = q.eq('estado', 'pendiente')
  const { data, error } = await q
  if (error) fail('No se pudieron cargar las clases', error)
  return (data ?? []) as Clase[]
}

export async function obtenerClase(id: number): Promise<Clase | null> {
  const { data, error } = await supabase.from('clases').select('*').eq('id', id).maybeSingle()
  if (error) fail('No se pudo cargar la clase', error)
  return (data as Clase) ?? null
}

export interface PreviaClase {
  /** Sesiones que aún no empiezan (las únicas que se bloquean). */
  total_sesiones: number
  pasadas: number
  total_equipos: number
  sesiones: { inicio: string; fin: string; libres: number }[]
  equipos: { codigo: string; nombre: string; libres: number }[]
}

export async function clasePrevia(id: number): Promise<PreviaClase> {
  const { data, error } = await supabase.rpc('clase_previa', { p_id: id })
  if (error) fail('No se pudo calcular la disponibilidad', error)
  return data as PreviaClase
}

export async function aprobarClase(id: number, equipos: string[], respuesta?: string): Promise<{ creadas: number; omitidas: { codigo: string; inicio: string }[] }> {
  const { data, error } = await supabase.rpc('aprobar_clase', { p_id: id, p_equipos: equipos, p_respuesta: respuesta ?? null })
  if (error) fail('No se pudo aprobar', error)
  return data as { creadas: number; omitidas: { codigo: string; inicio: string }[] }
}

/** Todo lo de la autorización de una clase: datos, sesiones con equipos bloqueados y quién la aprobó. */
export interface HojaClase {
  id: number
  consecutivo: string
  nombre: string
  grupo: number
  docente: string
  docente_correo: string | null
  estado: EstadoClase
  dias: number[]
  dias_texto: string
  hora_inicio: string
  hora_fin: string
  desde: string
  hasta: string
  notas: string | null
  equipos_pedidos: number | null
  equipos: string[]
  respuesta: string | null
  aprobado_por: string | null
  aprobado_correo: string | null
  resuelto_en: string | null
  sesiones: { inicio: string; fin: string; equipos: number; pasada: boolean }[]
  omitidos: { codigo: string; inicio: string }[]
}

export async function claseHoja(id: number): Promise<HojaClase> {
  const { data, error } = await supabase.rpc('clase_hoja', { p_id: id })
  if (error) fail('No se pudo cargar la autorización', error)
  return data as HojaClase
}

export async function claseReenviar(id: number): Promise<void> {
  const { error } = await supabase.rpc('clase_reenviar', { p_id: id })
  if (error) fail('No se pudo reenviar', error)
}

/** Equipos activos de la sala (el máximo que se puede pedir para una clase). */
export async function totalEquiposSala(): Promise<number> {
  const { count, error } = await supabase
    .from('equipos')
    .select('id', { count: 'exact', head: true })
    .eq('archivado', false)
    .eq('estado', 'activo')
  if (error) fail('No se pudieron contar los equipos', error)
  return count ?? 0
}

// ------------------------------------------------------------ Verificación docente
export interface VerificacionDocente {
  id: number
  perfil_id: string
  nombre: string
  correo: string
  programa: string | null
  mensaje: string | null
  creado_en: string
}

export async function pedirVerificacionDocente(mensaje: string): Promise<void> {
  const { error } = await supabase.rpc('pedir_verificacion_docente', { p_mensaje: mensaje })
  if (error) fail('No se pudo enviar la verificación', error)
}

export async function verificacionesPendientes(): Promise<VerificacionDocente[]> {
  const { data, error } = await supabase.rpc('verificaciones_pendientes')
  if (error) fail('No se pudieron cargar las verificaciones', error)
  return (data ?? []) as VerificacionDocente[]
}

export async function resolverVerificacion(id: number, aprobar: boolean, respuesta?: string): Promise<void> {
  const { error } = await supabase.rpc('resolver_verificacion', { p_id: id, p_aprobar: aprobar, p_respuesta: respuesta ?? null })
  if (error) fail('No se pudo resolver la verificación', error)
}

export async function marcarDocente(perfil: string, verificado: boolean): Promise<void> {
  const { error } = await supabase.rpc('marcar_docente', { p_perfil: perfil, p_verificado: verificado })
  if (error) fail('No se pudo cambiar la verificación', error)
}

/** La propia verificación pendiente (para mostrar «en revisión» con lo que escribió). */
export async function miVerificacion(): Promise<{ estado: string; mensaje: string | null; respuesta: string | null } | null> {
  const { data, error } = await supabase
    .from('verificaciones_docente')
    .select('estado, mensaje, respuesta')
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data as { estado: string; mensaje: string | null; respuesta: string | null } | null
}

export async function rechazarClase(id: number, respuesta: string): Promise<void> {
  const { error } = await supabase.rpc('rechazar_clase', { p_id: id, p_respuesta: respuesta })
  if (error) fail('No se pudo rechazar', error)
}

export async function cancelarClase(id: number, motivo?: string): Promise<number> {
  const { data, error } = await supabase.rpc('cancelar_clase', { p_id: id, p_motivo: motivo ?? null })
  if (error) fail('No se pudo cancelar la clase', error)
  return data as number
}

// ------------------------------------------------------------ Programas usados (Faro)
export async function programasUsados(desde: string, hasta: string): Promise<{ programa: string; horas: number; equipos: number }[]> {
  const { data, error } = await supabase.rpc('faro_programas_resumen', { p_desde: desde, p_hasta: hasta })
  if (error) fail('No se pudo cargar el uso por programa', error)
  return (data ?? []) as { programa: string; horas: number; equipos: number }[]
}

// ------------------------------------------------------------ Inasistencias (strikes)
/** Las inasistencias de una persona (la propia, o cualquiera si es personal), más recientes primero. */
export async function listarInasistencias(usuario?: string): Promise<Inasistencia[]> {
  let q = supabase.from('inasistencias').select('*').order('inicio', { ascending: false }).limit(30)
  if (usuario) q = q.eq('usuario_id', usuario)
  const { data, error } = await q
  if (error) fail('No se pudieron cargar las inasistencias', error)
  return (data ?? []) as Inasistencia[]
}

export async function apelarInasistencia(id: number, motivo: string): Promise<void> {
  const { error } = await supabase.rpc('apelar_inasistencia', { p_id: id, p_motivo: motivo })
  if (error) fail('No se pudo enviar la apelación', error)
}

export interface Apelacion {
  id: number
  usuario_id: string
  nombre: string
  correo: string
  equipo_codigo: string
  inicio: string
  numero: number
  sancion_hasta: string | null
  apelacion: string
  apelada_en: string
}

export async function inasistenciasApeladas(): Promise<Apelacion[]> {
  const { data, error } = await supabase.rpc('inasistencias_apeladas')
  if (error) fail('No se pudieron cargar las apelaciones', error)
  return (data ?? []) as Apelacion[]
}

export async function resolverApelacion(id: number, anular: boolean, respuesta?: string): Promise<void> {
  const { error } = await supabase.rpc('resolver_apelacion', { p_id: id, p_anular: anular, p_respuesta: respuesta ?? null })
  if (error) fail('No se pudo resolver la apelación', error)
}

export async function anularInasistencia(id: number, motivo?: string): Promise<void> {
  const { error } = await supabase.rpc('anular_inasistencia', { p_id: id, p_motivo: motivo ?? null })
  if (error) fail('No se pudo anular', error)
}

// ------------------------------------------------------------ Confirmar asistencia (código de Faro)
export interface LlegadaPendiente {
  id: string
  codigo_legible: string
  equipo: string
  inicio: string
  fin: string
  /** Hasta cuándo se puede confirmar sin que cuente como inasistencia. */
  limite: string
}

/** La reserva propia que espera confirmar asistencia (o null). */
export async function miLlegadaPendiente(): Promise<LlegadaPendiente | null> {
  const { data, error } = await supabase.rpc('mi_llegada_pendiente')
  if (error) return null
  return (data ?? null) as LlegadaPendiente | null
}

/** Confirma la asistencia con el código de 6 dígitos que muestra Faro en el equipo. */
export async function confirmarLlegada(codigo: string): Promise<{ ok: boolean; error?: string; equipo?: string; ya?: boolean }> {
  const { data, error } = await supabase.rpc('confirmar_llegada', { p_codigo: codigo })
  if (error) fail('No se pudo confirmar la asistencia', error)
  return data as { ok: boolean; error?: string; equipo?: string; ya?: boolean }
}

// ------------------------------------------------------------ Solicitudes de software
export async function solicitarSoftware(s: {
  software: string
  uso: string
  version?: string
  enlace?: string
  reserva?: string
  equipo?: string
  fecha?: string
}): Promise<SolicitudSoftware> {
  const { data, error } = await supabase.rpc('solicitar_software', {
    p_software: s.software,
    p_uso: s.uso,
    p_version: s.version ?? null,
    p_enlace: s.enlace ?? null,
    p_reserva: s.reserva ?? null,
    p_equipo: s.equipo ?? null,
    p_fecha: s.fecha ?? null
  })
  if (error) fail('No se pudo enviar la solicitud de software', error)
  return data as SolicitudSoftware
}

/** Las propias (o todas, para el personal). Con `abiertas`, solo las que esperan algo. */
export async function listarSoftware(opciones: { mias?: string; abiertas?: boolean } = {}): Promise<SolicitudSoftware[]> {
  let q = supabase
    .from('solicitudes_software')
    .select('*, perfiles!solicitudes_software_solicitante_fkey(nombre, correo), equipos(codigo)')
    .order('creado_en', { ascending: false })
    .limit(50)
  if (opciones.mias) q = q.eq('solicitante', opciones.mias)
  if (opciones.abiertas) q = q.in('estado', ['pendiente', 'en_tramite'])
  const { data, error } = await q
  if (error) fail('No se pudieron cargar las solicitudes de software', error)
  return (data ?? []) as SolicitudSoftware[]
}

export async function cancelarSoftware(id: number): Promise<void> {
  const { error } = await supabase.rpc('cancelar_software', { p_id: id })
  if (error) fail('No se pudo cancelar', error)
}

export async function actualizarSoftware(id: number, estado: Exclude<EstadoSoftware, 'pendiente' | 'cancelada'>, equipos?: string[], respuesta?: string): Promise<void> {
  const { error } = await supabase.rpc('actualizar_software', { p_id: id, p_estado: estado, p_equipos: equipos ?? null, p_respuesta: respuesta ?? null })
  if (error) fail('No se pudo actualizar la solicitud', error)
}

// ------------------------------------------------------------ Foto del equipo
/** Reduce la imagen (máx. 1600 px, WebP) antes de subirla: las fotos del celular pesan varios MB. */
async function reducirImagen(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo)
  const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(bitmap.width * escala)
  lienzo.height = Math.round(bitmap.height * escala)
  lienzo.getContext('2d')?.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height)
  return await new Promise((resolver, rechazar) =>
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la imagen.'))), 'image/webp', 0.82)
  )
}

export async function subirFotoEquipo(equipoId: string, codigo: string, archivo: File): Promise<string> {
  const blob = await reducirImagen(archivo)
  const ruta = `${codigo}-${Date.now()}.webp`
  const { error } = await supabase.storage.from('equipos').upload(ruta, blob, { contentType: 'image/webp', upsert: false })
  if (error) fail('No se pudo subir la foto', error)
  const url = supabase.storage.from('equipos').getPublicUrl(ruta).data.publicUrl
  const { error: e2 } = await supabase.from('equipos').update({ foto_url: url }).eq('id', equipoId)
  if (e2) fail('No se pudo guardar la foto', e2)
  return url
}

export async function quitarFotoEquipo(equipoId: string): Promise<void> {
  const { error } = await supabase.from('equipos').update({ foto_url: null }).eq('id', equipoId)
  if (error) fail('No se pudo quitar la foto', error)
}

// ------------------------------------------------- 0024: moderación
export interface MarcaModeracion {
  id: number
  tabla: string
  fila: string
  campo: string
  palabra: string
  revisada: boolean
  creado_en: string
  perfiles: { nombre: string; correo: string } | null
}

/** Palabras que no se pueden publicar (en su forma comparable: minúsculas y sin tildes). Solo el personal. */
export async function listarPalabrasBloqueadas(): Promise<string[]> {
  const { data, error } = await supabase.from('palabras_bloqueadas').select('palabra').order('palabra')
  if (error) fail('No se pudo cargar la lista de palabras', error)
  return (data ?? []).map((f) => (f as { palabra: string }).palabra)
}

/** Agrega o quita una palabra de la lista (solo administración). Devuelve cómo quedó guardada. */
export async function cambiarPalabraBloqueada(palabra: string, agregar: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('moderacion_palabra', { p_palabra: palabra, p_agregar: agregar })
  if (error) fail(agregar ? 'No se pudo agregar la palabra' : 'No se pudo quitar la palabra', error)
  return data as string
}

/** La palabra de la lista que bloquearía este texto, o null si se puede publicar. */
export async function probarModeracion(texto: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('moderacion_probar', { p_texto: texto })
  if (error) fail('No se pudo probar el texto', error)
  return (data as string | null) ?? null
}

/** Textos privados con una palabra de la lista (reportes, apelaciones, solicitudes) pendientes de revisar. */
export async function listarMarcasModeracion(): Promise<MarcaModeracion[]> {
  const { data, error } = await supabase
    .from('moderacion_marcas')
    .select('id, tabla, fila, campo, palabra, revisada, creado_en, perfiles(nombre, correo)')
    .eq('revisada', false)
    .order('creado_en', { ascending: false })
    .limit(100)
  if (error) fail('No se pudieron cargar los textos marcados', error)
  return (data ?? []) as unknown as MarcaModeracion[]
}

export async function revisarMarcaModeracion(id: number): Promise<void> {
  const { error } = await supabase.rpc('moderacion_revisar', { p_id: id })
  if (error) fail('No se pudo marcar como revisado', error)
}
