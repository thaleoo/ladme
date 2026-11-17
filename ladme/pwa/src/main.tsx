import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import { iniciarServiceWorker } from './lib/sw'
import { instalarCapturaDeErrores } from './lib/telemetria'
import { aplicarTema, temaGuardado } from './lib/tema'
import './components/InstalarApp' // registra el aviso de instalación lo antes posible
import './index.css'

instalarCapturaDeErrores()
aplicarTema(temaGuardado())
iniciarServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
