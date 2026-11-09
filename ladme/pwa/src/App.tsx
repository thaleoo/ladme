import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import Shell from './components/Shell'
import { esAdmin, esStaff, useAuth } from './context/AuthContext'
import AuthCallback from './pages/AuthCallback'
import Credencial from './pages/Credencial'
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
    <div className="container">
      <div className="card center">
        <p className="muted">Cargando LADME…</p>
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
      <div className="container">
        <div className="card warn">
          <h3>Cuenta sin perfil</h3>
          <p>Su sesión existe pero no tiene perfil en LADME. Pida a la administración que habilite su cuenta.</p>
        </div>
      </div>
    )
  }
  if (!perfil.activo) {
    return (
      <div className="container">
        <div className="card warn">
          <h3>Cuenta pendiente de habilitación</h3>
          <p>Su correo institucional está registrado, pero la administración aún no habilitó su cuenta.</p>
        </div>
      </div>
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
