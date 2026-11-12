import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import './index.css'

const actualizarSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (window.confirm('Hay una nueva versión de LADME disponible. ¿Actualizar ahora?')) {
      void actualizarSW(true)
    }
  },
  onOfflineReady() {
    console.info('LADME quedó lista para usarse sin conexión.')
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
)
