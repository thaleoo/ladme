import { useEffect, useState, type FormEvent } from 'react'
import { salaPublica, type EquipoSala } from '../lib/api'
import { Navigate, useLocation } from 'react-router-dom'
import { tomarDestino } from '../lib/rutas'
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
  // La sala en vivo, sin datos personales: lo primero que se ve es cuántos equipos hay libres.
  const [sala, setSala] = useState<EquipoSala[] | null>(null)
  const libres = sala?.filter((e) => e.estado === 'libre').length ?? 0

  useEffect(() => {
    let vivo = true
    salaPublica().then((l) => vivo && setSala(l)).catch(() => vivo && setSala(null))
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    if (espera <= 0) return
    const t = window.setTimeout(() => setEspera((n) => n - 1), 1000)
    return () => window.clearTimeout(t)
  }, [espera])

  if (cargando) {
    return (
      <div className="ingreso ingreso--cargando">
        <div className="cargando" style={{ justifyContent: 'center' }}>
          <span className="spinner" aria-hidden="true" />
          <span>Cargando LADME…</span>
        </div>
      </div>
    )
  }

  if (session) {
    const desde = (location.state as { from?: string } | null)?.from
    const destino = desde && desde.startsWith('/') && !desde.startsWith('//') ? (tomarDestino(), desde) : tomarDestino()
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
    <div className="ingreso">
      <section className="ingreso__sala" aria-label="La sala en este momento">
        <div className="ingreso__marca">
          <Logo size={40} />
          <span>LADME</span>
        </div>
        <SalaEnPuntos equipos={sala} />
        <div className="ingreso__ahora" aria-live="polite">
          {sala && sala.length > 0 ? (
            <>
              <strong>{libres}</strong>
              <span>
                de {sala.length} equipos libres ahora
              </span>
            </>
          ) : (
            <span>Laboratorio de Datos y Modelamiento Estadístico</span>
          )}
        </div>
        <p className="ingreso__lab">
          {sala && sala.length > 0 ? 'Laboratorio de Datos y Modelamiento Estadístico · ' : ''}UNAL sede La Paz
        </p>
      </section>

      <main className="ingreso__panel">
        <div className="ingreso__caja">
          {paso === 'inicio' && (
            <>
              <h1 className="ingreso__titulo">Ingresar</h1>
              <p className="ingreso__sub">Con su correo <strong>@unal.edu.co</strong>. No necesita contraseña.</p>
              <div className="ingreso__botones">
                <button className="btn lg block ingreso__google" type="button" onClick={google} disabled={enviando}>
                  <span className="ingreso__g" aria-hidden="true">
                    <svg viewBox="0 0 48 48" width="18" height="18">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                  </span>
                  {enviando ? 'Abriendo Google…' : 'Continuar con Google'}
                </button>
                <button className="btn gray lg block" type="button" onClick={() => { setError(null); setPaso('correo') }}>
                  Recibir un código por correo
                </button>
              </div>
            </>
          )}

          {paso === 'correo' && (
            <form onSubmit={pedirCodigo} className="ingreso__form">
              <h1 className="ingreso__titulo">Su correo</h1>
              <p className="ingreso__sub">Le enviaremos un código de 6 dígitos que sirve una sola vez.</p>
              <div className="field">
                <label className="field__label solo-lector" htmlFor="correo">
                  Correo institucional
                </label>
                <input
                  id="correo"
                  className="ingreso__campo"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="nombre.apellido@unal.edu.co"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button className="btn lg block" type="submit" disabled={enviando || espera > 0}>
                {enviando ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Enviando…
                  </>
                ) : espera > 0 ? (
                  `Podrá pedir otro en ${espera} s`
                ) : (
                  'Enviarme el código'
                )}
              </button>
              <button className="link-btn ingreso__volver" type="button" onClick={() => { setError(null); setPaso('inicio') }}>
                Volver
              </button>
            </form>
          )}

          {paso === 'codigo' && (
            <form onSubmit={verificar} className="ingreso__form">
              <h1 className="ingreso__titulo">Revise su correo</h1>
              <p className="ingreso__sub">
                Enviamos un código a <strong>{correo.trim().toLowerCase()}</strong>. Vence en pocos minutos; si no llega, mire en spam.
              </p>
              <div className="field">
                <label className="field__label solo-lector" htmlFor="codigo">
                  Código de acceso
                </label>
                <input
                  id="codigo"
                  className="codigo-otp ingreso__otp"
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
                  'Ingresar'
                )}
              </button>
              <div className="ingreso__enlaces">
                <button className="link-btn" type="button" disabled={enviando || espera > 0} onClick={() => void pedirCodigo()}>
                  {espera > 0 ? `Pedir otro código en ${espera} s` : 'Pedir otro código'}
                </button>
                <button className="link-btn" type="button" onClick={() => { setError(null); setPaso('correo') }}>
                  Cambiar de correo
                </button>
              </div>
            </form>
          )}

          {error && (
            <div className="alert danger" style={{ marginTop: 'var(--s4)' }}>
              <Icon nombre="alerta" />
              <div className="alert__body">{error}</div>
            </div>
          )}

          <p className="ingreso__nota">
            ¿Primera vez? Su perfil se crea al ingresar. Si no puede entrar o necesita permisos, escriba a{' '}
            <a href="mailto:labdatos_paz@unal.edu.co">labdatos_paz@unal.edu.co</a>.
          </p>
        </div>
      </main>
    </div>
  )
}

/**
 * La sala como una cuadrícula de puntos, igual que el logo: cada punto es un equipo en su lugar
 * del plano; los libres se encienden. Si no hay datos (sin conexión), queda el logo en grande.
 */
function SalaEnPuntos({ equipos }: { equipos: EquipoSala[] | null }) {
  if (!equipos || equipos.length === 0) {
    const logo = ['t', 't', 'a', 't', 'l', 't', 'l', 't', 't']
    return (
      <div className="sala-puntos sala-puntos--logo" aria-hidden="true" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {logo.map((t, i) => (
          <span key={i} className={`sala-puntos__p ${t === 'l' ? 'libre' : t === 'a' ? 'acento' : ''}`} />
        ))}
      </div>
    )
  }
  const conPos = equipos.every((e) => e.x && e.y)
  const cols = conPos ? Math.max(...equipos.map((e) => e.x ?? 1)) : Math.min(6, Math.ceil(Math.sqrt(equipos.length)))
  const ordenados = [...equipos].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
  return (
    <div className="sala-puntos" role="img" aria-label={`Plano de la sala: ${equipos.filter((e) => e.estado === 'libre').length} equipos libres`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {ordenados.map((e, i) => (
        <span
          key={e.codigo}
          className={`sala-puntos__p ${e.estado}`}
          style={{ ...(conPos ? { gridColumn: e.x ?? undefined, gridRow: e.y ?? undefined } : {}), animationDelay: `${i * 35}ms` }}
          title={`${e.codigo}: ${e.estado === 'libre' ? 'libre' : e.estado === 'ocupado' ? 'en uso' : e.estado === 'mantenimiento' ? 'en mantenimiento' : 'bloqueado'}`}
        />
      ))}
    </div>
  )
}
