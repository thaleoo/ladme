import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// El frontend vive en su propio dominio (no dentro de Apps Script):
// HtmlService corre en un iframe de googleusercontent.com y ahí no hay service worker.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'LADME — Reservas y equipos',
        short_name: 'LADME',
        description: 'Reservas, disponibilidad, credencial y mantenimiento del Laboratorio de Datos UNAL.',
        lang: 'es-CO',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#fcfaff',
        theme_color: '#6d28d9',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Nueva reserva', url: '/reservar', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Mis reservas', url: '/mis-reservas', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }
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
