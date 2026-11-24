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
  /** Fecha en que el personal verificó que es docente (habilita «Sala para clases»). */
  docente_verificado_en?: string | null
  matricula: string | null
  reglamento_aceptado_en: string | null
  creado_en: string
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
  sistema_operativo: 'Windows' | 'Linux' | 'macOS' | 'Otro' | null
  so_version: string | null
  /** Programas detectados por Faro (para filtrar al reservar). */
  software?: string[]
  /** Posición en el plano de la sala (columna y fila, desde 1). */
  plano_x?: number | null
  plano_y?: number | null
  /** Foto del equipo (almacenamiento público «equipos»). */
  foto_url?: string | null
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
  /** Docente responsable (obligatorio en Trabajo de grado, PAE y Semilleros). */
  docente?: string | null
  detalle: string | null
  desatendido: boolean
  mensaje_llegada: string | null
  compartida?: boolean
  protegidos?: string[] | null
  token_credencial: string
  extensiones: number
  liberada_en: string | null
  llegada_en: string | null
  cancelada_en: string | null
  motivo: string | null
  programa: string | null
  matricula: string | null
  excepcion: boolean
  funciono: boolean | null
  creado_en: string
  equipos?: { codigo: string; nombre: string; ubicacion: string | null; foto_url?: string | null } | null
  perfiles?: { nombre: string; correo: string; programa: string | null } | null
  clase_id?: number | null
  tipo_usuario?: string | null
  /** Solo en el panel: la reserva vino del sistema anterior (titular original). */
  reservas_importadas?: Array<{ nombre_titular: string | null; correo_titular: string | null; reclamada_en: string | null }>
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
  /** Uso compartido: otras personas pueden usar el equipo sin cerrar los programas protegidos. */
  compartida?: boolean
  protegidos?: string[] | null
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
  docente?: string | null
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

/** Actividades que exigen el docente responsable (igual que _actividad_pide_docente en la base). */
export const ACTIVIDADES_CON_DOCENTE: readonly string[] = ['Trabajo de grado', 'PAE', 'Semilleros']
export const pideDocente = (actividad: string | null | undefined) => !!actividad && ACTIVIDADES_CON_DOCENTE.includes(actividad)
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

export const CATEGORIAS_FALLA = [
  'No enciende', 'Lento o se congela', 'Software', 'Pantalla o periféricos', 'Red o internet', 'Otro'
] as const

export interface Reporte {
  id: string
  equipo_id: string
  usuario_id: string
  categoria: string
  descripcion: string
  estado: 'abierto' | 'en_revision' | 'resuelto' | 'descartado'
  respuesta: string | null
  resuelto_en: string | null
  creado_en: string
  equipos?: { codigo: string; nombre: string; estado: string } | null
  autor?: { nombre: string; correo: string } | null
  /** Lo último que Faro sabía del equipo al reportar la falla. */
  diagnostico?: DiagnosticoFaro | null
}

export interface DiagnosticoFaro {
  en_linea: boolean
  ultimo_latido: string | null
  version: string | null
  cpu_pct: number | null
  inactivo_seg: number | null
  bloqueado: boolean | null
  so: string | null
  ram_gb: number | null
  disco_gb: number | null
  disco_libre_gb: number | null
  disco_salud: string | null
  arranque_h: number | null
}

export interface EstadisticasSoporte {
  reportes: number
  reportes_abiertos: number
  valoradas: number
  con_problemas: number
  reportes_por_equipo: Conteo[]
}

export const SISTEMAS = ['Windows', 'Linux', 'macOS', 'Otro'] as const

/** «Windows 11 Pro», «Linux · Ubuntu 24.04 LTS» o null si no está registrado. */
export function textoSO(e: Pick<Equipo, 'sistema_operativo' | 'so_version'>): string | null {
  if (!e.sistema_operativo && !e.so_version) return null
  const v = e.so_version?.trim()
  if (!v) return e.sistema_operativo
  if (e.sistema_operativo && v.toLowerCase().startsWith(e.sistema_operativo.toLowerCase())) return v
  return e.sistema_operativo === 'Linux' ? `Linux · ${v}` : [e.sistema_operativo, v].filter(Boolean).join(' ')
}

/** Etiqueta corta para la cuadrícula: «Win 11», «Ubuntu 24.04», «Linux». */
export function etiquetaSO(e: Pick<Equipo, 'sistema_operativo' | 'so_version'>): string | null {
  const v = e.so_version?.trim() ?? ''
  if (e.sistema_operativo === 'Windows') {
    const n = v.match(/\b(7|8\.1|8|10|11|12)\b/)
    return n ? `Win ${n[1]}` : 'Windows'
  }
  if (e.sistema_operativo === 'Linux') return v ? v.split(/\s+/).slice(0, 2).join(' ').replace(/LTS$/i, '').trim() : 'Linux'
  return e.sistema_operativo ?? null
}

export type EstadoClase = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada' | 'vencida'
export interface Clase {
  id: number
  solicitante: string
  nombre: string
  docente: string
  docente_correo?: string | null
  grupo: number
  dias: number[]
  hora_inicio: string
  hora_fin: string
  desde: string
  hasta: string
  equipos_pedidos: number | null
  notas: string | null
  estado: EstadoClase
  equipos: string[] | null
  respuesta: string | null
  resuelto_en: string | null
  creado_en: string
}

/** Reserva sin llegada registrada dentro de la tolerancia (strike). */
export interface Inasistencia {
  id: number
  reserva_id: string
  usuario_id: string
  equipo_codigo: string
  inicio: string
  numero: number
  sancion_hasta: string | null
  estado: 'vigente' | 'anulada'
  apelacion: string | null
  apelada_en: string | null
  respuesta: string | null
  resuelto_en: string | null
  creado_en: string
}

export type EstadoSoftware = 'pendiente' | 'en_tramite' | 'instalado' | 'rechazada' | 'cancelada'

/** Pedido de instalación de un programa (con o sin reserva). */
export interface SolicitudSoftware {
  id: number
  solicitante: string
  reserva_id: string | null
  equipo_id: string | null
  software: string
  version: string | null
  uso: string
  enlace: string | null
  para_fecha: string | null
  estado: EstadoSoftware
  equipos_instalados: string[]
  respuesta: string | null
  creado_en: string
  actualizado_en: string
  perfiles?: { nombre: string; correo: string } | null
  equipos?: { codigo: string } | null
}

/** Foto del equipo, o la ilustración genérica de LADME si aún no tiene una. */
export const FOTO_GENERICA = '/equipo.webp'
export const fotoEquipo = (url?: string | null) => url || FOTO_GENERICA
