export type Rol = 'usuario' | 'laboratorista' | 'administrador'

export interface Perfil {
  id: string
  correo: string
  nombre: string
  programa: string | null
  rol: Rol
  activo: boolean
  permisos: string[]
  tipo_usuario: 'Estudiante' | 'Docente/Investigador' | null
  matricula: string | null
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
  placa_oficial: string | null
  serial: string | null
  nfc_uid: string | null
  fecha_adquisicion: string | null
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
  llegada_en: string | null
  cancelada_en: string | null
  motivo: string | null
  programa: string | null
  matricula: string | null
  excepcion: boolean
  creado_en: string
  equipos?: { codigo: string; nombre: string; ubicacion: string | null } | null
  perfiles?: { nombre: string; correo: string; programa: string | null } | null
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
  reserva?: string
  codigo?: string
  llegada?: string | null
  equipo?: string
  inicio?: string
  fin?: string
  titular?: string
}

export interface Aviso {
  id: number
  tipo: string
  titulo: string | null
  cuerpo: string | null
  url: string | null
  creado_en: string
  leido_en: string | null
}

export interface Solicitud {
  id: string
  usuario_id: string
  equipo_id: string
  inicio: string
  fin: string
  actividad: string | null
  detalle: string | null
  justificacion: string
  estado: 'pendiente' | 'aprobada' | 'rechazada' | 'retirada'
  respuesta: string | null
  resuelto_en: string | null
  reserva_id: string | null
  creado_en: string
  equipos?: { codigo: string; nombre: string } | null
  solicitante?: { nombre: string; correo: string; programa: string | null } | null
}

export interface Conteo {
  clave: string | number
  n: number
  horas?: number
}

export interface Estadisticas {
  total: number
  canceladas: number
  sin_llegada: number
  horas: number
  por_equipo: Conteo[]
  por_actividad: Conteo[]
  por_programa: Conteo[]
  por_matricula: Conteo[]
  por_hora: Conteo[]
  por_dia: Conteo[]
}

export interface Politica {
  clave: string
  valor: number
  descripcion: string | null
}

export const ACTIVIDADES = ['Docencia', 'Investigación', 'PAE', 'Semilleros', 'Trabajo de grado', 'Otro'] as const
export const TIPOS_USUARIO = ['Estudiante', 'Docente/Investigador'] as const
export const PROGRAMAS = [
  'Estadística',
  'Ingeniería Mecatrónica',
  'Ingeniería Biológica',
  'Biología',
  'Geografía',
  'Gestión cultural y comunicativa',
  'Posgrado',
  'Profesor/Investigador'
]
export const MATRICULAS = [
  'Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta', 'Séptima', 'Octava', 'Novena', 'Décima'
].map((m) => `${m} matrícula`).concat(['Más de diez matrículas', 'Posgrado'])

export function perfilCompleto(p: Perfil | null): boolean {
  if (!p) return false
  if (!p.tipo_usuario || !p.programa?.trim()) return false
  return p.tipo_usuario !== 'Estudiante' || !!p.matricula?.trim()
}
