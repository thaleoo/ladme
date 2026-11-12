import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import Shell from './components/Shell'
import { esAdmin, esStaff, useAuth } from './context/AuthContext'
import AuthCallback from './pages/AuthCallback'
import Credencial from './pages/Credencial'
import Cuenta from './pages/Cuenta'
import Disponibilidad from './pages/Disponibilidad'
import FichaEquipo from './pages/FichaEquipo'
import Login from './pages/Login'
import Mantenimiento from './pages/Mantenimiento'
import MisReservas from './pages/MisReservas'
import NoEncontrada from './pages/NoEncontrada'
import Reservar from './pages/Reservar'
import Usuarios from './pages/Usuarios'
import Validar from './pages/Validar'

function Cargando() {
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
  const { session, cargando, perfil } = useAuth()
  if (cargando) return <Cargando />
  if (!session) return <Navigate to="/login" replace />
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
  return <>{children}</>
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
        <Route path="cuenta" element={<Cuenta />} />
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
