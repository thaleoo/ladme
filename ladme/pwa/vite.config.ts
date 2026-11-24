import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import type { AtRule, Rule } from 'postcss'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Versión publicada: fecha y commit corto. Aparece en el registro de errores. */
function version(): string {
  const fecha = new Date().toISOString().slice(0, 10)
  try {
    return `${fecha}-${execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()}`
  } catch {
    return fecha
  }
}

/**
 * Tema elegible. La hoja de estilos se escribe con `@media (prefers-color-scheme: dark)`;
 * al compilar, cada bloque se duplica para que <html data-tema="oscuro"> lo fuerce y
 * data-tema="claro" lo anule, sin tocar el CSS fuente.
 */
function temaElegible(): { postcssPlugin: string; Once: (raiz: import('postcss').Root) => void } {
  // La condición va dentro de :where(), que no suma especificidad: cada regla
  // oscura conserva exactamente el peso que tenía en el CSS fuente. Si el prefijo
  // sumara peso, una regla general como «button { --btn-bg }» le ganaría a
  // variantes como «.btn.ghost» o «.chip[aria-pressed]» y a los enlaces con
  // aspecto de botón.
  const prefijar = (selector: string, condicion: string) =>
    selector
      .split(',')
      .map((s) => {
        const t = s.trim()
        // :root / html: se conserva su peso propio y se añade la condición sin peso.
        const raiz = t.match(/^(:root|html)(.*)$/)
        if (raiz) return `:root:where(${condicion})${raiz[2]}`
        return `:where(:root${condicion}) ${t}`
      })
      .join(', ')
  const fuera = (r: Rule) => r.parent?.type === 'atrule' && /keyframes/.test((r.parent as AtRule).name)
  return {
    postcssPlugin: 'ladme-tema-elegible',
    Once(raiz) {
      raiz.walkAtRules('media', (at: AtRule) => {
        if (!/prefers-color-scheme:\s*dark/.test(at.params)) return
        const forzado = at.clone({ params: at.params.replace(/\(prefers-color-scheme:\s*dark\)\s*(and)?/, '').trim() })
        at.walkRules((r: Rule) => {
          if (!fuera(r)) r.selector = prefijar(r.selector, ':not([data-tema="claro"])')
        })
        forzado.walkRules((r: Rule) => {
          if (!fuera(r)) r.selector = prefijar(r.selector, '[data-tema="oscuro"]')
        })
        if (forzado.params) at.after(forzado)
        else at.after(forzado.nodes ?? [])
      })
    }
  }
}

/** Separa librerías que cambian poco, para que cada publicación descargue solo lo nuevo. */
const trozos: Plugin = {
  name: 'ladme-trozos',
  config: () => ({
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(id)) return 'react'
            if (id.includes('@supabase')) return 'supabase'
            return undefined
          }
        }
      }
    }
  })
}

// El frontend vive en su propio dominio (no dentro de Apps Script):
// HtmlService corre en un iframe de googleusercontent.com y ahí no hay service worker.
export default defineConfig({
  define: { __LADME_VERSION__: JSON.stringify(version()) },
  css: { postcss: { plugins: [temaElegible()] } },
  plugins: [
    react(),
    trozos,
    VitePWA({
      // «prompt»: la versión nueva espera a que la persona toque «Actualizar» (ver src/lib/sw.ts).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'LADME — Reservas y equipos',
        short_name: 'LADME',
        description: 'Reservas, disponibilidad, credencial y mantenimiento del Laboratorio de Datos UNAL.',
        lang: 'es-CO',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Nueva reserva', url: '/reservar', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Mis reservas', url: '/mis-reservas', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Escanear QR', url: '/validar', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Avisos', url: '/avisos', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }
        ]
      },
      workbox: {
        // Nunca cachear respuestas de Supabase: disponibilidad y datos personales deben ser frescos.
        navigateFallbackDenylist: [/^\/validar\//],
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  server: { port: 5173 }
})
