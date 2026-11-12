import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, cargando, enviarEnlace } = useAuth()
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const location = useLocation()

  if (cargando) return <div className="container"><div className="card center muted">Cargando…</div></div>
  if (session) {
    const destino = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={destino} replace />
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)
    setEnviando(true)
    const r = await enviarEnlace(correo)
    setEnviando(false)
    if (r.ok) setOk(r.mensaje)
    else setError(r.mensaje)
  }

  return (
    <div className="container">
      <div className="login-card">
        <div className="hero">
          <h2>LADME</h2>
          <p>Laboratorio de Aprendizaje de Datos y Modelado Estadístico · UNAL Sede La Paz</p>
        </div>

        <div className="card accent">
          <h3>Ingresar</h3>
          <p className="small muted">
            Use su correo institucional <strong>@unal.edu.co</strong>. Le enviaremos un enlace de acceso;
            no necesita contraseña.
          </p>

          <form onSubmit={enviar} className="stack mt">
            <div>
              <label htmlFor="correo">Correo institucional</label>
              <input
                id="correo"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="nombre.apellido@unal.edu.co"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={enviando} style={{ width: '100%', justifyContent: 'center' }}>
              {enviando ? 'Enviando…' : 'Enviarme el enlace de acceso'}
            </button>
          </form>

          {ok && <div className="alert ok mt">{ok}<br /><span className="small">Revise también la carpeta de spam. El enlace caduca en pocos minutos.</span></div>}
          {error && <div className="alert danger mt">{error}</div>}
        </div>

        <div className="card">
          <h4>¿Primera vez?</h4>
          <p className="small muted">
            Al ingresar se crea su perfil automáticamente y la cuenta queda habilitada, porque solo
            se admiten correos <strong>@unal.edu.co</strong>. Si su cuenta aparece bloqueada o
            necesita permisos especiales, escriba a
            <strong> labdatos_paz@unal.edu.co</strong>.
          </p>
        </div>

        <p className="tiny muted center">
          Instale LADME desde el menú del navegador («Añadir a pantalla de inicio») para recibir avisos
          y consultar sus reservas como una aplicación.
        </p>
      </div>
    </div>
  )
}
