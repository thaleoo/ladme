/**
 * Traduce errores de Supabase Auth a un texto legible para la interfaz.
 *
 * Detalle importante: `@supabase/auth-js` construye el mensaje de un HTTP 5xx
 * con `JSON.stringify(response)`. Como `Response` no expone propiedades
 * enumerables, el resultado es literalmente la cadena "{}". Por eso la pantalla
 * de ingreso mostraba `{}` en lugar de la causa real (fallo de SMTP).
 */

interface ErrorSupabase {
  message?: unknown
  code?: unknown
  status?: unknown
  error_description?: unknown
}

const RESPALDO = 'No se pudo completar la operación. Intente de nuevo.'

function textoUtil(valor: unknown): string {
  if (typeof valor !== 'string') return ''
  const limpio = valor.trim()
  return limpio === '{}' || limpio === '[object Object]' ? '' : limpio
}

export function mensajeError(error: unknown, respaldo: string = RESPALDO): string {
  if (!error) return respaldo

  const e = error as ErrorSupabase
  const codigo = typeof e.code === 'string' ? e.code : ''
  const estado = typeof e.status === 'number' ? e.status : 0

  if (codigo === 'over_email_send_rate_limit' || codigo === 'over_request_rate_limit') {
    return 'Se pidieron demasiados enlaces en poco tiempo. Espere unos minutos y vuelva a intentarlo.'
  }

  // 5xx: el servidor de Auth respondió, pero no pudo completar el envío.
  if (codigo === 'unexpected_failure' || estado >= 500) {
    return 'No se pudo enviar el enlace de acceso: el servidor de correo rechazó el envío. ' +
      'Intente de nuevo en unos minutos; si persiste, avise a labdatos_paz@unal.edu.co.'
  }

  if (estado === 0) {
    return 'No se pudo conectar con el servidor. Revise su conexión a internet e intente de nuevo.'
  }

  const texto = textoUtil(e.error_description) || textoUtil(e.message)
  return texto || respaldo
}
