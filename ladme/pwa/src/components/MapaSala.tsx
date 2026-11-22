import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { salaPublica, type EquipoSala } from '../lib/api'

const TONO: Record<EquipoSala['estado'], string> = { libre: 'libre', ocupado: 'ocupado', bloqueado: 'bloqueado', mantenimiento: 'mant' }

/**
 * Plano de la sala con el equipo resaltado. Usa la columna y la fila de cada equipo (Inventario →
 * «Lugar en el plano»); los demás muestran su estado y llevan a su ficha.
 */
export default function MapaSala({ codigo }: { codigo: string }) {
  const navigate = useNavigate()
  const [sala, setSala] = useState<EquipoSala[] | null>(null)
  useEffect(() => {
    salaPublica().then(setSala).catch(() => setSala([]))
  }, [])
  const conPlano = (sala ?? []).filter((e) => e.x && e.y)
  const yo = conPlano.find((e) => e.codigo === codigo)
  if (!sala || !yo) return null
  const columnas = Math.max(...conPlano.map((e) => e.x ?? 1))
  const filas = Math.max(...conPlano.map((e) => e.y ?? 1))
  return (
    <section className="card tight mapa-sala">
      <div className="mapa-sala__cab">
        <h3>Ubicación en la sala</h3>
        <span className="small muted">Fila {yo.y} · Columna {yo.x}</span>
      </div>
      <div className="mapa-sala__plano" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${filas}, auto)` }}>
        {conPlano.map((e) => {
          const es = e.codigo === codigo
          return (
            <button
              key={e.codigo}
              type="button"
              className={`mapa-sala__pc ${TONO[e.estado]} ${es ? 'yo' : ''}`}
              style={{ gridColumn: e.x ?? 1, gridRow: e.y ?? 1 }}
              onClick={() => !es && navigate(`/equipo/${encodeURIComponent(e.codigo)}`)}
              aria-current={es ? 'true' : undefined}
              aria-label={`${e.codigo}: ${e.estado}`}
              title={es ? 'Este equipo' : `${e.codigo} · ${e.estado}`}
            >
              {e.codigo.replace(/^[A-Z]+-/, '')}
            </button>
          )
        })}
      </div>
      <div className="mapa-sala__frente tiny muted">Entrada / frente de la sala</div>
    </section>
  )
}
