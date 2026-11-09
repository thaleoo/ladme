import { supabase } from './supabase'
import type { Equipo, Mantenimiento, Ocupacion, Perfil, Reserva, ResultadoValidacion, Rol } from './types'

function fail(contexto: string, error: { message: string } | null): never {
  throw new Error(error?.message ? `${contexto}: ${error.message}` : contexto)
}

/** Perfil del usuario autenticado (lo crea un trigger al registrarse). */
export async function obtenerPerfil(): Promise<Perfil | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await supabase.from('perfiles').select('*').eq('id', auth.user.id).single()
  if (error) fail('No se pudo leer el perfil', error)
  return data as Perfil
}

export async function listarEquipos(): Promise<Equipo[]> {
  const { data, error } = await supabase
    .from('equipos')
    .select('*')
    .eq('archivado', false)
    .order('codigo')
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
}): Promise<Reserva> {
  const { data, error } = await supabase.rpc('crear_reserva', {
    p_equipo: input.equipo,
    p_inicio: input.inicio,
    p_fin: input.fin,
    p_actividad: input.actividad ?? null,
    p_detalle: input.detalle ?? null,
    p_desatendido: input.desatendido ?? false,
    p_mensaje: input.mensaje ?? null,
    p_id_solicitud: input.idSolicitud ?? null
  })
  if (error) fail('No se pudo crear la reserva', error)
  return data as Reserva
}

export async function misReservas(): Promise<Reserva[]> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return []
  const { data, error } = await supabase
    .from('reservas_estado')
    .select('*')
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
  return (data as Equipo | null) ?? null
}

export async function obtenerReserva(id: string): Promise<Reserva | null> {
  const { data, error } = await supabase
    .from('reservas_estado')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) fail('No se pudo cargar la reserva', error)
  return (data as Reserva | null) ?? null
}

export async function listarPoliticas(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('politicas').select('clave, valor')
  if (error) fail('No se pudieron cargar las políticas', error)
  const salida: Record<string, number> = {}
  for (const fila of (data ?? []) as Array<{ clave: string; valor: unknown }>) {
    const n = Number(fila.valor)
    if (Number.isFinite(n)) salida[fila.clave] = n
  }
  return salida
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
