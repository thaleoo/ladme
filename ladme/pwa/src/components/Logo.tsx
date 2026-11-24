/**
 * Marca de LADME («Matriz»): nueve puntos en cuadrícula con la diagonal ascendente encendida;
 * el de arriba a la derecha va en violeta. Es a la vez una matriz de datos con una tendencia
 * y la sala llena de equipos. Mismo dibujo que favicon.svg y los íconos de instalación.
 */
const PUNTOS: Array<[number, number, 'tenue' | 'blanco' | 'acento']> = [
  [13, 13, 'tenue'], [20, 13, 'tenue'], [27, 13, 'acento'],
  [13, 20, 'tenue'], [20, 20, 'blanco'], [27, 20, 'tenue'],
  [13, 27, 'blanco'], [20, 27, 'tenue'], [27, 27, 'tenue']
]

export default function Logo({ size = 38, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className ?? 'marca__logo'} role="img" aria-label="LADME">
      <rect width="40" height="40" rx="11" fill="#000" />
      {PUNTOS.map(([cx, cy, tono]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="2.7"
          fill={tono === 'acento' ? '#7c6cf0' : '#fff'}
          opacity={tono === 'tenue' ? 0.22 : 1}
        />
      ))}
    </svg>
  )
}
