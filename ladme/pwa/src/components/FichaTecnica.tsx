import { gpuCorta, ramNominal, textoSO, type Equipo } from '../lib/types'
import { hace } from '../lib/format'

/** Procesador, memoria, gráfica, cámara, disco y sistema de un equipo. Faro la mantiene al día. */
export default function FichaTecnica({ equipo, conFecha = false }: { equipo: Equipo; conFecha?: boolean }) {
  const ram = ramNominal(equipo.ram_gb)
  const nucleos = [equipo.cpu_nucleos && `${equipo.cpu_nucleos} núcleos`, equipo.cpu_hilos && `${equipo.cpu_hilos} hilos`].filter(Boolean).join(', ')
  const filas: Array<[string, string | null]> = [
    ['Procesador', equipo.cpu_modelo ? [limpiarCpu(equipo.cpu_modelo), nucleos].filter(Boolean).join(' · ') : nucleos || null],
    ['Memoria RAM', ram ? `${ram} GB` : null],
    [
      'Tarjeta gráfica',
      equipo.gpu_modelo
        ? `${gpuCorta(equipo.gpu_modelo)}${equipo.gpu_dedicada ? (equipo.gpu_vram_gb ? ` · ${Math.round(equipo.gpu_vram_gb)} GB propios` : ' · dedicada') : ' · integrada'}`
        : null
    ],
    ['Cámara', equipo.camara == null ? null : equipo.camara ? 'Sí' : 'No tiene'],
    ['Disco', equipo.disco_gb ? `${equipo.disco_gb >= 1000 ? `${(equipo.disco_gb / 1024).toFixed(1).replace('.0', '')} TB` : `${Math.round(equipo.disco_gb)} GB`}` : null],
    ['Sistema', textoSO(equipo)]
  ]
  const visibles = filas.filter(([, v]) => v)
  if (visibles.length === 0) return null
  return (
    <>
      <div className="datos">
        {visibles.map(([k, v]) => (
          <div key={k} className="datos__fila">
            <span className="datos__clave">{k}</span>
            <span className="datos__valor">{v}</span>
          </div>
        ))}
      </div>
      {conFecha && equipo.ficha_en && <p className="tiny muted" style={{ margin: 'var(--s2) 0 0' }}>Faro la actualizó {hace(equipo.ficha_en)}.</p>}
    </>
  )
}

/** «13th Gen Intel(R) Core(TM) i7-13700» → «Intel Core i7-13700». */
function limpiarCpu(m: string): string {
  return m
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\b\d+(st|nd|rd|th) Gen\b/i, '')
    .replace(/\bCPU\b/i, '')
    .replace(/@.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}
