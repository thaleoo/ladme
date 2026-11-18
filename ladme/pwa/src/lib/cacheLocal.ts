/**
 * Copia local de lo último que se vio (mis reservas, un pase, la disponibilidad)
 * para mostrarlo sin conexión. Vive solo en este dispositivo y se borra al salir.
 */
const PREFIJO = 'ladme-cache:'

interface Envoltorio<T> {
  guardado: string
  datos: T
}

export function guardarCache<T>(clave: string, datos: T): void {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify({ guardado: new Date().toISOString(), datos }))
  } catch {
    // Almacenamiento lleno o bloqueado: no es crítico.
  }
}

export function leerCache<T>(clave: string): Envoltorio<T> | null {
  try {
    const texto = localStorage.getItem(PREFIJO + clave)
    return texto ? (JSON.parse(texto) as Envoltorio<T>) : null
  } catch {
    return null
  }
}

export function borrarCache(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIJO))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    // Nada que hacer.
  }
}
