/** Descarga una tabla como CSV (con BOM, para que Excel respete las tildes). */
export function descargarCSV(nombre: string, encabezados: string[], filas: Array<Array<string | number | null | undefined>>): void {
  const celda = (v: string | number | null | undefined) => {
    let t = v === null || v === undefined ? '' : String(v)
    // Evita que una hoja de cálculo interprete texto de usuarios como fórmula.
    if (/^[=+\-@]/.test(t)) t = `'${t}`
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const texto = [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
