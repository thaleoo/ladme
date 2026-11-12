import type { ReactNode, SVGProps } from 'react'

/**
 * Iconos en línea (trazo, 24×24). Se dibujan con `currentColor` para heredar
 * el color del texto y no dependen de una librería externa: la PWA debe
 * funcionar sin conexión y sin descargas adicionales.
 */
const trazos: Record<string, ReactNode> = {
  inicio: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M16 2.5v3M8 2.5v3M3 10h18" />
    </>
  ),
  reservar: (
    <>
      <path d="M21 12.5V6.5A2.5 2.5 0 0 0 18.5 4h-13A2.5 2.5 0 0 0 3 6.5v13A2.5 2.5 0 0 0 5.5 22H12" />
      <path d="M16 2.5v3M8 2.5v3M3 10h18M17.5 19h5M20 16.5v5" />
    </>
  ),
  ticket: (
    <>
      <path d="M2.5 9.2a2.8 2.8 0 0 1 0 5.6v2.7a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-2.7a2.8 2.8 0 0 1 0-5.6V6.5a2 2 0 0 0-2-2h-15a2 2 0 0 0-2 2Z" />
      <path d="M13 6.5v1.6M13 11v2M13 15.4v2.1" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="6.5" height="6.5" rx="1.4" />
      <rect x="14.5" y="3" width="6.5" height="6.5" rx="1.4" />
      <rect x="3" y="14.5" width="6.5" height="6.5" rx="1.4" />
      <path d="M14.5 14.5h2.6v2.6h-2.6zM21 14.5v.01M21 21h-3M14.5 21v.01" />
    </>
  ),
  llave: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  usuarios: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  usuario: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  mas: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  salir: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  mas2: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  'check-circulo': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.4 12.3 2.4 2.4 4.8-5" />
    </>
  ),
  alerta: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  'x-circulo': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3.2 1.9" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2.5" />
      <path d="M8 20.5h8M12 16.5v4" />
    </>
  ),
  'flecha-izq': <path d="m15 18-6-6 6-6" />,
  'flecha-der': <path d="m9 18 6-6-6-6" />,
  flecha: <path d="M5 12h14M13 6l6 6-6 6" />,
  descargar: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  imprimir: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="6" y="13" width="12" height="8" rx="1.5" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
    </>
  ),
  copiar: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  campana: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  'sin-conexion': (
    <>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.8a15 15 0 0 1 4.2-2.5" />
      <path d="M10.7 5.1A15 15 0 0 1 22 8.8" />
      <path d="M5 12.9a10 10 0 0 1 3.4-1.9" />
      <path d="M15.6 11a10 10 0 0 1 3.4 1.9" />
      <path d="M12 20h.01" />
    </>
  ),
  chispa: (
    <>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </>
  ),
  buscar: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  reproducir: <path d="M6.5 4.5 19 12 6.5 19.5V4.5Z" />,
  escudo: (
    <>
      <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  ajustes: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  clave: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 9.5-9.5M17.5 5.5 20 8M14.5 8.5 17 11" />
    </>
  ),
  actualizar: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  'enlace-externo': (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </>
  ),
  prohibido: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  ubicacion: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  etiqueta: (
    <>
      <path d="M12.6 2.6H5a2.4 2.4 0 0 0-2.4 2.4v7.6a2.4 2.4 0 0 0 .7 1.7l7.3 7.3a2.4 2.4 0 0 0 3.4 0l7.3-7.3a2.4 2.4 0 0 0 0-3.4l-7.3-7.3a2.4 2.4 0 0 0-1.4-.7Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  )
}

export type NombreIcono = keyof typeof trazos

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  nombre: NombreIcono
}

export default function Icon({ nombre, width = 18, height = 18, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {trazos[nombre]}
    </svg>
  )
}
