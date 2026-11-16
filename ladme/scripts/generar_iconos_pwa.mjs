// Genera los iconos de instalación de la PWA a partir de la marca actual
// (la misma de src/components/Logo.tsx: barras de datos sobre degradado violeta).
//
// Uso, desde ladme/pwa:   npx -y -p sharp node ../scripts/generar_iconos_pwa.mjs
// Salida en ladme/pwa/public: favicon.svg, icon-192.png, icon-512.png,
// icon-maskable-512.png (a sangre, para Android) y apple-touch-icon.png.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const salida = join(dirname(fileURLToPath(import.meta.url)), '..', 'pwa', 'public')

/** `radio` en unidades de un lienzo de 40; `escala` reduce la marca para la zona segura. */
function svg({ radio, escala = 1 }) {
  const t = (40 - 40 * escala) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" role="img" aria-label="LADME">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="52%" stop-color="#6d28d9"/>
      <stop offset="100%" stop-color="#4c1d95"/>
    </linearGradient>
  </defs>
  <rect width="40" height="40" rx="${radio}" fill="url(#g)"/>
  <g transform="translate(${t} ${t}) scale(${escala})">
    <g fill="#fff">
      <rect x="9.5" y="21.5" width="4.6" height="9.5" rx="1.7" opacity=".82"/>
      <rect x="17.7" y="14.5" width="4.6" height="16.5" rx="1.7"/>
      <rect x="25.9" y="18.5" width="4.6" height="12.5" rx="1.7" opacity=".9"/>
    </g>
    <circle cx="11.8" cy="17" r="1.9" fill="#ddd6fe"/>
  </g>
</svg>
`
}

const png = (fuente, lado, archivo) =>
  sharp(Buffer.from(fuente), { density: 1200 }).resize(lado, lado).png().toFile(join(salida, archivo))

writeFileSync(join(salida, 'favicon.svg'), svg({ radio: 12 }))
await png(svg({ radio: 12 }), 192, 'icon-192.png')
await png(svg({ radio: 12 }), 512, 'icon-512.png')
await png(svg({ radio: 0, escala: 0.78 }), 512, 'icon-maskable-512.png')   // el sistema recorta la forma
await png(svg({ radio: 0, escala: 0.9 }), 180, 'apple-touch-icon.png')     // iOS redondea las esquinas
console.log('Iconos generados en', salida)
