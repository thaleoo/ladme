export type Tema = 'auto' | 'claro' | 'oscuro'

const CLAVE = 'ladme-tema'

export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem(CLAVE)
    return t === 'claro' || t === 'oscuro' ? t : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Aplica el tema en <html data-tema>. La hoja de estilos se compila para que
 * «oscuro» y «claro» manden sobre la preferencia del sistema (ver vite.config.ts).
 */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement
  if (tema === 'auto') raiz.removeAttribute('data-tema')
  else raiz.setAttribute('data-tema', tema)
  const oscuro = tema === 'oscuro' || (tema === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', oscuro ? '#000000' : '#ffffff'))
  try {
    if (tema === 'auto') localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, tema)
  } catch {
    // Sin almacenamiento: el tema vale solo por esta sesión.
  }
}
