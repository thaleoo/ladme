import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { Suspense, type ReactNode } from 'react'
import Shell from './components/Shell'
import { esAdmin, esStaff, useAuth } from './context/AuthContext'
import AuthCallback from './pages/AuthCallback'
import Disponibilidad from './pages/Disponibilidad'
import Login from './pages/Login'
import NoEncontrada from './pages/NoEncontrada'
import { PoliticasProvider } from './lib/politicas'
import { Paginas, recordarDestino } from './lib/rutas'
import CargaInicial from './components/CargaInicial'

const {
  AccionRapida, Admin, Sala, Avisos, Credencial, Cuenta, FichaEquipo, Mantenimiento, MiUso, MisReservas, Reservar, Usuarios, Validar
} = Paginas

function Cargando() {
  return <CargaInicial />
}

function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="acceso">
      <div className="acceso__panel">
        <div className="acceso__caja">
          <div className="card warn">
            <h2 style={{ fontSize: 'var(--text-xl)' }}>{titulo}</h2>
            <p className="small muted" style={{ marginBottom: 0 }}>
              {children}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function SoloAutenticado({ children }: { children: ReactNode }) {
  const { session, cargando, perfil, error, reintentar } = useAuth()
  const ubicacion = useLocation()
  if (cargando) return <CargaInicial alReintentar={reintentar} />
  if (!session) {
    // Al volver de Google (o del código) se retoma el enlace que se abrió, p. ej. un QR de Faro.
    const desde = ubicacion.pathname + ubicacion.search
    recordarDestino(desde)
    return <Navigate to="/login" replace state={{ from: desde }} />
  }
  if (!perfil && error) {
    return (
      <Aviso titulo="Sin conexión con LADME">
        {error}{' '}
        <button className="btn sm" type="button" onClick={reintentar} style={{ marginTop: 'var(--s3)' }}>
          Reintentar
        </button>
      </Aviso>
    )
  }
  if (!perfil) {
    return (
      <Aviso titulo="Cuenta sin perfil">
        Su sesión existe, pero no tiene perfil en LADME. Escriba a labdatos_paz@unal.edu.co para que la
        administración revise su cuenta.
      </Aviso>
    )
  }
  if (!perfil.activo) {
    return (
      <Aviso titulo="Cuenta inhabilitada">
        Su correo institucional está registrado, pero la administración inhabilitó su cuenta. Escriba a
        labdatos_paz@unal.edu.co si cree que es un error.
      </Aviso>
    )
  }
  return (
    <PoliticasProvider>
      <Suspense fallback={<Cargando />}>{children}</Suspense>
    </PoliticasProvider>
  )
}

function SoloStaff({ children }: { children: ReactNode }) {
  const { perfil } = useAuth()
  if (!esStaff(perfil)) return <Navigate to="/" replace />
  return <>{children}</>
}

function SoloAdmin({ children }: { children: ReactNode }) {
  const { perfil } = useAuth()
  if (!esAdmin(perfil)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const [params] = useSearchParams()
  const asset = params.get('asset')

  // Los QR/NFC físicos usan ?asset=UNAL-XX. Se conserva el enlace estable y se
  // redirige a la ficha del equipo, sin importar desde qué dominio se abra.
  if (asset) return <Navigate to={`/equipo/${encodeURIComponent(asset)}`} replace />

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/sala" element={<Suspense fallback={null}><Sala /></Suspense>} />

      <Route
        element={
          <SoloAutenticado>
            <Shell />
          </SoloAutenticado>
        }
      >
        <Route index element={<Disponibilidad />} />
        <Route path="reservar" element={<Reservar />} />
        <Route path="mis-reservas" element={<MisReservas />} />
        <Route path="credencial/:id" element={<Credencial />} />
        <Route path="equipo/:codigo" element={<FichaEquipo />} />
        <Route path="pc/:codigo/:accion" element={<AccionRapida />} />
        <Route path="e/:codigo" element={<AccionRapida />} />
        <Route path="cuenta" element={<Cuenta />} />
        <Route path="avisos" element={<Avisos />} />
        <Route path="mi-uso" element={<MiUso />} />
        <Route
          path="admin"
          element={
            <SoloStaff>
              <Admin />
            </SoloStaff>
          }
        />
        <Route path="validar" element={<Validar />} />
        <Route path="validar/:token" element={<Validar />} />
        <Route
          path="mantenimiento"
          element={
            <SoloStaff>
              <Mantenimiento />
            </SoloStaff>
          }
        />
        <Route
          path="usuarios"
          element={
            <SoloAdmin>
              <Usuarios />
            </SoloAdmin>
          }
        />
      </Route>

      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  )
}
