import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const descripcion = hash.get('error_description') ?? query.get('error_description')
    if (descripcion) {
      setError(descripcion.replace(/\+/g, ' '))
      return
    }

    let vivo = true
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      if (sesion && vivo) navigate('/', { replace: true })
    })

    supabase.auth.getSession().then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError(err.message)
      else if (data.session) navigate('/', { replace: true })
    })

    const timer = window.setTimeout(() => {
      if (!vivo) return
      setError((prev) => prev ?? 'No pudimos completar el ingreso. Abra de nuevo el enlace del correo o solicite otro.')
    }, 6000)

    return () => {
      vivo = false
      window.clearTimeout(timer)
      sub.subscription.unsubscribe()
    }
  }, [navigate])

  return (
    <div className="container">
      <div className="login-card">
        <div className="card center">
          {error ? (
            <>
              <h3>No se pudo ingresar</h3>
              <p className="error">{error}</p>
              <Link className="btn" to="/login">Volver al ingreso</Link>
            </>
          ) : (
            <>
              <h3>Verificando su enlace…</h3>
              <p className="muted">Esto toma solo un momento.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
