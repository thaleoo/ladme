import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { validarCredencial } from '../lib/api'
import type { ResultadoValidacion } from '../lib/types'
import { esStaff, useAuth } from '../context/AuthContext'
import { fecha } from '../lib/format'

const ETIQUETAS: Record<ResultadoValidacion['resultado'], { titulo: string; clase: string; texto: string }> = {
  valida: { titulo: 'Credencial válida', clase: 'ok', texto: 'La reserva está vigente en este momento.' },
  aun_no_vigente: { titulo: 'Aún no comienza', clase: 'warn', texto: 'La reserva existe, pero su horario aún no inicia.' },
  vencida: { titulo: 'Credencial vencida', clase: 'danger', texto: 'La reserva ya terminó o el equipo fue liberado.' },
  cancelada: { titulo: 'Reserva cancelada', clase: 'danger', texto: 'Esta reserva fue cancelada y no autoriza el uso del equipo.' },
  no_encontrada: { titulo: 'No encontrada', clase: 'danger', texto: 'El código no corresponde a ninguna reserva.' }
}

export default function Validar() {
  const { token = '' } = useParams<{ token: string }>()
  const { perfil } = useAuth()
  const [entrada, setEntrada] = useState(token)
  const [resultado, setResultado] = useState<ResultadoValidacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const validar = useCallback(async (valor: string) => {
    const limpio = valor.trim()
    if (!limpio) {
      setError('Escriba o pegue el token de la credencial.')
      return
    }
    setCargando(true)
    setError(null)
    setResultado(null)
    try {
      const r = await validarCredencial(limpio)
      setResultado(r)
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

  const etiqueta = resultado ? ETIQUETAS[resultado.resultado] : null

  return (
    <>
      <div className="card accent">
        <h2>Validar credencial</h2>
        <p className="muted small mb-0">
          Escanee el QR de la credencial o pegue su enlace. La validación la hace la base de datos,
          no el teléfono.
        </p>
      </div>

      <div className="card">
        <form onSubmit={enviar} className="row">
          <div style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="token">Token de la credencial</label>
            <input
              id="token"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder="Pegue aquí el token o el enlace completo"
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={cargando}>{cargando ? 'Validando…' : 'Validar'}</button>
        </form>
        <p className="help">
          El enlace completo tiene la forma <code>/validar/&lt;token&gt;</code>. Si viene del QR, esta
          página ya lo procesó automáticamente.
        </p>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {resultado && etiqueta && (
        <div className={`card ${etiqueta.clase === 'ok' ? 'ok' : etiqueta.clase === 'warn' ? 'warn' : ''}`}>
          <div className="row between">
            <h3>{etiqueta.titulo}</h3>
            <span className={`badge ${etiqueta.clase}`}>{resultado.resultado.replace(/_/g, ' ')}</span>
          </div>
          <p>{etiqueta.texto}</p>

          {resultado.equipo && (
            <div className="grid cols-3">
              <div>
                <div className="tiny muted">Equipo</div>
                <strong>{resultado.equipo}</strong>
              </div>
              <div>
                <div className="tiny muted">Inicio</div>
                <strong>{resultado.inicio ? fecha(resultado.inicio) : '—'}</strong>
              </div>
              <div>
                <div className="tiny muted">Fin</div>
                <strong>{resultado.fin ? fecha(resultado.fin) : '—'}</strong>
              </div>
            </div>
          )}

          {resultado.titular && (
            <p className="small mt mb-0">Titular: <strong>{resultado.titular}</strong></p>
          )}

          {!esStaff(perfil) && (
            <p className="tiny muted mt mb-0">
              Como usuario, solo ve el veredicto. Los datos de la reserva quedan visibles para el personal
              del laboratorio.
            </p>
          )}
        </div>
      )}
    </>
  )
}
