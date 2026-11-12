import { useId } from 'react'

/** Marca de LADME: barras de datos sobre un cuadrado con degradado violeta. */
export default function Logo({ size = 38, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className ?? 'marca__logo'}
      role="img"
      aria-label="LADME"
    >
      <defs>
        <linearGradient id={`ladme-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="52%" stopColor="#6d28d9" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#ladme-${id})`} />
      <g fill="#fff">
        <rect x="9.5" y="21.5" width="4.6" height="9.5" rx="1.7" opacity=".82" />
        <rect x="17.7" y="14.5" width="4.6" height="16.5" rx="1.7" />
        <rect x="25.9" y="18.5" width="4.6" height="12.5" rx="1.7" opacity=".9" />
      </g>
      <circle cx="11.8" cy="17" r="1.9" fill="#ddd6fe" />
    </svg>
  )
}
