import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import type { NombreIcono } from './Icon'

interface Props {
  titulo: string
  sub?: ReactNode
  eyebrow?: string
  acciones?: ReactNode
  volver?: { a: string; texto: string }
}

/** Encabezado común de cada vista: título, contexto y acciones principales. */
export default function PageHeader({ titulo, sub, eyebrow, acciones, volver }: Props) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {volver ? (
          <Link className="eyebrow" to={volver.a}>
            <Icon nombre="flecha-izq" width={14} height={14} />
            {volver.texto}
          </Link>
        ) : (
          eyebrow && <div className="eyebrow">{eyebrow}</div>
        )}
        <h1>{titulo}</h1>
        {sub && <p className="page-header__sub">{sub}</p>}
      </div>
      {acciones && <div className="page-header__actions">{acciones}</div>}
    </header>
  )
}

export function Empty({
  icono = 'monitor',
  titulo,
  children,
  accion
}: {
  icono?: NombreIcono
  titulo: string
  children?: ReactNode
  accion?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon nombre={icono} />
      </div>
      <strong>{titulo}</strong>
      {children && <p className="small muted" style={{ margin: 0, maxWidth: '42ch' }}>{children}</p>}
      {accion && <div className="mt">{accion}</div>}
    </div>
  )
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="card">
      <div className="cargando">
        <span className="spinner" aria-hidden="true" />
        <span>{texto}</span>
      </div>
    </div>
  )
}

export function Esqueleto({ lineas = 3 }: { lineas?: number }) {
  return (
    <div className="card" aria-hidden="true">
      <span className="skeleton skeleton--titulo" />
      {Array.from({ length: lineas }).map((_, i) => (
        <span
          key={i}
          className="skeleton skeleton--texto"
          style={{ width: `${92 - i * 9}%` }}
        />
      ))}
    </div>
  )
}
