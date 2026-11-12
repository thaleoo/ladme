import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { validarCredencial } from '../lib/api'
import type { ResultadoValidacion } from '../lib/types'
import { esStaff, useAuth } from '../context/AuthContext'
import { fecha } from '../lib/format'
import PageHeader from '../components/PageHeader'
import Icon, { type NombreIcono } from '../components/Icon'

const ETIQUETAS: Record<
  ResultadoValidacion['resultado'],
  { titulo: string; clase: 'ok' | 'warn' | 'danger'; icono: NombreIcono; texto: string }
> = {
  valida: {
    titulo: 'Credencial válida',
    clase: 'ok',
    icono: 'check-circulo',
    texto: 'La reserva está vigente en este momento. Puede entregar el equipo.'
  },
  aun_no_vigente: {
    titulo: 'Aún no comienza',
    clase: 'warn',
    icono: 'reloj',
    texto: 'La reserva existe, pero su horario todavía no inicia.'
  },
  vencida: {
    titulo: 'Credencial vencida',
    clase: 'danger',
    icono: 'x-circulo',
    texto: 'La reserva ya terminó o el equipo fue liberado.'
  },
  cancelada: {
    titulo: 'Reserva cancelada',
    clase: 'danger',
    icono: 'prohibido',
    texto: 'Esta reserva fue cancelada y no autoriza el uso del equipo.'
  },
  no_encontrada: {
    titulo: 'No encontrada',
    clase: 'danger',
    icono: 'alerta',
    texto: 'El código no corresponde a ninguna reserva.'
  }
}

/** Acepta el token suelto o un enlace completo tipo …/validar/<token>. */
function normalizarToken(valor: string): string {
  const limpio = valor.trim()
  const marca = limpio.lastIndexOf('/validar/')
  if (marca >= 0) return limpio.slice(marca + '/validar/'.length).split(/[?#]/)[0]
  return limpio
}

export default function Validar() {
  const { token = '' } = useParams<{ token: string }>()
  const { perfil } = useAuth()
  const [entrada, setEntrada] = useState(token)
  const [resultado, setResultado] = useState<ResultadoValidacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const validar = useCallback(async (valor: string) => {
    const limpio = normalizarToken(valor)
    if (!limpio) {
      setError('Escriba o pegue el token de la credencial.')
      return
    }
    setCargando(true)
    setError(null)
    setResultado(null)
    try {
      setResultado(await validarCredencial(limpio))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo validar la credencial.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (token) void validar(token)
  }, [token, validar])

  function enviar(e: FormEvent) {
    e.preventDefault()
    void validar(entrada)
  }

  function limpiar() {
    setEntrada('')
    setResultado(null)
    setError(null)
  }

  const etiqueta = resultado ? ETIQUETAS[resultado.resultado] : null

  return (
    <>
      <PageHeader
        eyebrow="Laboratorio"
        titulo="Validar credencial"
        sub="Escanee el QR o pegue el enlace. El veredicto lo calcula la base de datos, no el teléfono."
      />

      <section className="card">
        <form onSubmit={enviar} className="stack">
          <div className="field">
            <label className="field__label" htmlFor="token">
              Token o enlace de la credencial
            </label>
            <input
              id="token"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder="Pegue aquí el token o el enlace completo"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
            />
            <p className="help">
              También puede abrir el enlace del QR directamente: la aplicación lo procesa sola.
            </p>
          </div>
          <div className="row">
            <button type="submit" disabled={cargando || !entrada.trim()}>
              {cargando ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Validando…
                </>
              ) : (
                <>
                  <Icon nombre="escudo" /> Validar
                </>
              )}
            </button>
            {(resultado || entrada) && (
              <button type="button" className="btn gray" onClick={limpiar} disabled={cargando}>
                Limpiar
              </button>
            )}
          </div>
        </form>
      </section>

      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      {resultado && etiqueta && (
        <section className="stack">
          <div className={`veredicto veredicto--${etiqueta.clase}`}>
            <span className="veredicto__icono">
              <Icon nombre={etiqueta.icono} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 2 }}>{etiqueta.titulo}</h2>
              <p className="small" style={{ margin: 0 }}>
                {etiqueta.texto}
              </p>
            </div>
          </div>

          {resultado.equipo && (
            <div className="card">
              <div className="datos">
                <div className="datos__fila">
                  <span className="datos__clave">Equipo</span>
                  <span className="datos__valor">{resultado.equipo}</span>
                </div>
                <div className="datos__fila">
                  <span className="datos__clave">Inicio</span>
                  <span className="datos__valor">{resultado.inicio ? fecha(resultado.inicio) : '—'}</span>
                </div>
                <div className="datos__fila">
                  <span className="datos__clave">Fin</span>
                  <span className="datos__valor">{resultado.fin ? fecha(resultado.fin) : '—'}</span>
                </div>
                {resultado.titular && (
                  <div className="datos__fila">
                    <span className="datos__clave">Titular</span>
                    <span className="datos__valor">{resultado.titular}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!esStaff(perfil) && (
            <p className="tiny muted">
              Como usuario, solo ve el veredicto. Los datos de la reserva quedan visibles para el personal
              del laboratorio.
            </p>
          )}
        </section>
      )}
    </>
  )
}
