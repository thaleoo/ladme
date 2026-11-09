export type Rol = 'usuario' | 'laboratorista' | 'administrador'

export interface Perfil {
  id: string
  correo: string
  nombre: string
  programa: string | null
  rol: Rol
  activo: boolean
  permisos: string[]
}

export interface Equipo {
  id: string
  codigo: string
  nombre: string
  categoria: string
  marca: string | null
  modelo: string | null
  ubicacion: string | null
  especificaciones: Record<string, unknown>
  estado: 'activo' | 'mantenimiento' | 'fuera_de_servicio'
  archivado: boolean
}

export interface Reserva {
  id: string
  codigo_legible: string
  tipo: 'reserva' | 'bloqueo'
  equipo_id: string
  usuario_id: string
  inicio: string
  fin: string
  estado: 'activa' | 'cancelada'
  estado_vigente?: string
  actividad: string | null
  detalle: string | null
  desatendido: boolean
  mensaje_llegada: string | null
  token_credencial: string
  extensiones: number
  liberada_en: string | null
  motivo: string | null
}

export interface Ocupacion {
  equipo_id: string
  codigo: string
  tipo: 'reserva' | 'bloqueo'
  inicio: string
  fin: string
  desatendido: boolean
  mensaje_llegada: string | null
  motivo: string | null
}

export type EstadoMantenimiento = 'programado' | 'en_curso' | 'completado' | 'validado' | 'cancelado'

export interface Mantenimiento {
  id: string
  equipo_id: string
  tipo: 'preventivo' | 'correctivo' | 'mejora'
  descripcion: string
  inicio: string
  fin: string
  responsable: string
  estado: EstadoMantenimiento
  periodicidad_dias: number
  proximo: string | null
  hallazgos: string | null
  validado_en: string | null
  creado_en: string
  equipos?: { codigo: string; nombre: string } | null
}

export interface ResultadoValidacion {
  resultado: 'no_encontrada' | 'cancelada' | 'vencida' | 'aun_no_vigente' | 'valida'
  equipo?: string
  inicio?: string
  fin?: string
  titular?: string
}
