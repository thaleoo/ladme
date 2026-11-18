import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { tomarDestino } from '../lib/rutas'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/errores'
import Icon from '../components/Icon'
import Logo from '../components/Logo'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const descripcion = hash.get('error_description') ?? query.get('error_description')
    if (descripcion) {
      const texto = descripcion.replace(/\+/g, ' ')
      // La base de datos rechaza las cuentas que no son institucionales; Supabase
      // lo reporta como un error genérico al guardar el usuario.
      setError(
        /database error|unal\.edu\.co|saving new user/i.test(texto)
          ? 'Esa cuenta no es institucional. Ingrese con su cuenta @unal.edu.co (en Google, elija «Usar otra cuenta»).'
          : texto
      )
      return
    }

    let vivo = true
    const destino = tomarDestino()
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      if (sesion && vivo) navigate(destino, { replace: true })
    })

    supabase.auth.getSession().then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError(mensajeError(err, 'No pudimos validar su enlace de acceso.'))
      else if (data.session) navigate(destino, { replace: true })
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
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--s4)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s4)' }}>
          <Logo size={48} />
        </div>

        {error ? (
          <>
            <span className="veredicto__icono" style={{ margin: '0 auto var(--s3)', background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
              <Icon nombre="alerta" />
            </span>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>No se pudo ingresar</h2>
            <p className="small muted">{error}</p>
            <Link className="btn block" to="/login" style={{ marginTop: 'var(--s4)' }}>
              <Icon nombre="flecha-izq" /> Volver al ingreso
            </Link>
          </>
        ) : (
          <>
            <div className="cargando" style={{ justifyContent: 'center' }}>
              <span className="spinner" aria-hidden="true" />
              <span>Verificando su enlace…</span>
            </div>
            <p className="tiny muted" style={{ marginTop: 'var(--s4)', marginBottom: 0 }}>
              Esto toma solo un momento.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
