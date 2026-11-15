import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'
import Logo from '../components/Logo'

const ESPERA_SEGUNDOS = 60

export default function Login() {
  const { session, cargando, enviarEnlace, verificarCodigo, entrarConGoogle } = useAuth()
  const [correo, setCorreo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [paso, setPaso] = useState<'inicio' | 'correo' | 'codigo'>('inicio')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [espera, setEspera] = useState(0)
  const location = useLocation()

  useEffect(() => {
    if (espera <= 0) return
    const t = window.setTimeout(() => setEspera((n) => n - 1), 1000)
    return () => window.clearTimeout(t)
  }, [espera])

  if (cargando) {
    return (
      <div className="acceso">
        <div className="acceso__panel">
          <div className="acceso__caja center">
            <div className="cargando" style={{ justifyContent: 'center' }}>
              <span className="spinner" aria-hidden="true" />
              <span>Cargando LADME…</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (session) {
    const destino = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={destino} replace />
  }

  async function google() {
    setError(null)
    setEnviando(true)
    const r = await entrarConGoogle()
    if (!r.ok) {
      setEnviando(false)
      setError(r.mensaje)
    }
  }

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault()
    if (enviando || espera > 0) return
    setError(null)
    setEnviando(true)
    const r = await enviarEnlace(correo)
    setEnviando(false)
    if (r.ok) {
      setPaso('codigo')
      setCodigo('')
      setEspera(ESPERA_SEGUNDOS)
    } else {
      setError(r.mensaje)
    }
  }

  async function verificar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setError(null)
    setEnviando(true)
    const r = await verificarCodigo(correo, codigo)
    setEnviando(false)
    if (!r.ok) setError(r.mensaje)
  }

  return (
    <div className="acceso">
      <aside className="acceso__marca">
        <div className="marca">
          <Logo size={44} />
          <div className="marca__texto">
            <strong>LADME</strong>
            <span>Laboratorio de Aprendizaje de Datos y Modelado Estadístico</span>
          </div>
        </div>

        <div>
          <h1 className="acceso__titular">El laboratorio, siempre a mano.</h1>
          <ul className="acceso__lista">
            <li>
              <Icon nombre="check-circulo" />
              Consulte en segundos qué equipos están libres.
            </li>
            <li>
              <Icon nombre="check-circulo" />
              Reserve hasta 7 días y lleve su credencial con QR.
            </li>
            <li>
              <Icon nombre="check-circulo" />
              Reciba avisos antes de que termine su reserva.
            </li>
            <li>
              <Icon nombre="check-circulo" />
              Registre llegadas y mantenimiento sin planillas aparte.
            </li>
          </ul>
        </div>

        <p className="acceso__pie">Universidad Nacional de Colombia · Sede La Paz</p>
      </aside>

      <div className="acceso__panel">
        <div className="acceso__caja">
          <div className="acceso__movil-marca">
            <Logo size={56} />
          </div>

          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Ingresar</h1>
          <p className="small muted" style={{ marginBottom: 'var(--s5)' }}>
            Use su cuenta institucional <strong>@unal.edu.co</strong>. No necesita crear una contraseña.
          </p>

          {paso === 'inicio' && (
            <div className="stack">
              <button className="btn lg block" type="button" onClick={google} disabled={enviando}>
                <Icon nombre="usuario" />
                {enviando ? 'Abriendo Google…' : 'Continuar con Google'}
              </button>
              <div className="separador">
                <span>o</span>
              </div>
              <button className="btn ghost block" type="button" onClick={() => { setError(null); setPaso('correo') }}>
                <Icon nombre="clave" /> Recibir un código en mi correo
              </button>
            </div>
          )}

          {paso === 'correo' && (
            <form onSubmit={pedirCodigo} className="stack">
              <div className="field">
                <label className="field__label" htmlFor="correo">
                  Correo institucional
                </label>
                <input
                  id="correo"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="nombre.apellido@unal.edu.co"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  required
                  autoFocus
                />
                <p className="help">Le enviaremos un código de 6 dígitos. Sirve una sola vez.</p>
              </div>
              <button className="btn lg block" type="submit" disabled={enviando || espera > 0}>
                {enviando ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Enviando…
                  </>
                ) : espera > 0 ? (
                  `Podrá reintentar en ${espera} s`
                ) : (
                  <>
                    <Icon nombre="flecha" /> Enviarme el código
                  </>
                )}
              </button>
              <button className="btn gray block" type="button" onClick={() => { setError(null); setPaso('inicio') }}>
                Volver
              </button>
            </form>
          )}

          {paso === 'codigo' && (
            <form onSubmit={verificar} className="stack">
              <div className="alert ok">
                <Icon nombre="check-circulo" />
                <div className="alert__body">
                  <strong>Código enviado a {correo.trim().toLowerCase()}</strong>
                  <p className="small" style={{ margin: '4px 0 0' }}>
                    Revise también la carpeta de spam. El código vence en pocos minutos.
                  </p>
                </div>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="codigo">
                  Código de acceso
                </label>
                <input
                  id="codigo"
                  className="codigo-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  placeholder="000000"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              </div>
              <button className="btn lg block" type="submit" disabled={enviando || codigo.length < 6}>
                {enviando ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Verificando…
                  </>
                ) : (
                  <>
                    <Icon nombre="check" /> Ingresar
                  </>
                )}
              </button>
              <button
                className="btn gray block"
                type="button"
                disabled={enviando || espera > 0}
                onClick={() => void pedirCodigo()}
              >
                {espera > 0 ? `Pedir otro código en ${espera} s` : 'Pedir otro código'}
              </button>
              <button className="btn ghost block" type="button" onClick={() => { setError(null); setPaso('correo') }}>
                Cambiar de correo
              </button>
            </form>
          )}

          {error && (
            <div className="alert danger" style={{ marginTop: 'var(--s4)' }}>
              <Icon nombre="alerta" />
              <div className="alert__body">{error}</div>
            </div>
          )}

          <div className="card tight" style={{ marginTop: 'var(--s5)', background: 'var(--surface-2)' }}>
            <h2 style={{ fontSize: 'var(--text-base)', marginBottom: 4 }}>¿Es su primera vez?</h2>
            <p className="tiny muted" style={{ margin: 0 }}>
              Al ingresar se crea su perfil automáticamente y queda habilitado, porque solo se admiten
              correos <strong>@unal.edu.co</strong>. Si su cuenta aparece bloqueada o necesita permisos
              especiales, escriba a <strong>labdatos_paz@unal.edu.co</strong>.
            </p>
          </div>

          <p className="tiny muted" style={{ marginTop: 'var(--s5)', textAlign: 'center' }}>
            Instale LADME desde el menú del navegador para usarla como aplicación y recibir avisos.
          </p>
        </div>
      </div>
    </div>
  )
}
