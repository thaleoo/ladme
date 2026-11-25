import { useEffect, useState } from 'react'
import { historialReglamento, publicarReglamento } from '../../lib/api'
import type { ReglamentoVersion } from '../../lib/types'
import type { Regla } from '../../lib/reglamento'
import ListaReglas from '../../components/ListaReglas'
import { Cargando } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import { useToast } from '../../components/Toast'

const MAX_TITULO = 120
const MAX_TEXTO = 1200
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

/** Solo administradores. Cada publicación crea una versión nueva; si es obligatoria, todas las personas la leen de nuevo. */
export default function ReglamentoAdmin() {
  const toast = useToast()
  const [historial, setHistorial] = useState<ReglamentoVersion[] | null>(null)
  const [reglas, setReglas] = useState<Regla[]>([])
  const [obligatoria, setObligatoria] = useState(true)
  const [nota, setNota] = useState('')
  const [publicando, setPublicando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    try {
      const h = await historialReglamento()
      setHistorial(h)
      setReglas(h[0]?.reglas ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el reglamento.')
      setHistorial([])
    }
  }
  useEffect(() => {
    void cargar()
  }, [])

  if (!historial) return <Cargando />
  const vigente = historial[0]
  const cambiado = JSON.stringify(reglas) !== JSON.stringify(vigente?.reglas ?? [])
  const valido = reglas.length > 0 && reglas.every((r) => r.titulo.trim() && r.texto.trim())

  const poner = (i: number, parte: Partial<Regla>) => setReglas((l) => l.map((r, j) => (j === i ? { ...r, ...parte } : r)))
  const mover = (i: number, d: -1 | 1) =>
    setReglas((l) => {
      const j = i + d
      if (j < 0 || j >= l.length) return l
      const c = [...l]
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })

  async function publicar() {
    if (obligatoria && !window.confirm('Todas las personas tendrán que leer y aceptar las reglas de nuevo antes de reservar. ¿Publicar?')) return
    setPublicando(true)
    setError(null)
    try {
      const v = await publicarReglamento(reglas.map((r) => ({ titulo: r.titulo.trim(), texto: r.texto.trim() })), obligatoria, nota)
      toast.mostrar(`Reglas publicadas (versión ${v}).`)
      setNota('')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo publicar.')
    } finally {
      setPublicando(false)
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Reglas de uso</h2>
        <p className="small muted">
          {vigente ? `Versión vigente: ${vigente.version}, publicada el ${fecha(vigente.publicado_en)}.` : 'Aún no hay una versión publicada.'} Se muestran en la página «Reglas de uso» y
          en la ventana de lectura obligatoria. Marcas: <code>**negrita**</code>, <code>{'{tolerancia}'}</code> (minutos para registrar la llegada) y{' '}
          <code>{'{software_dias}'}</code> (días hábiles para pedir software), que siguen a las políticas.
        </p>
        {error && (
          <div className="alert danger">
            <Icon nombre="alerta" />
            <div className="alert__body">{error}</div>
          </div>
        )}
        <div className="stack">
          {reglas.map((r, i) => (
            <div className="regla-editor" key={i}>
              <div className="field">
                <label className="field__label" htmlFor={`rg-t-${i}`}>
                  Regla {i + 1}
                </label>
                <input id={`rg-t-${i}`} value={r.titulo} maxLength={MAX_TITULO} placeholder="Título corto" onChange={(e) => poner(i, { titulo: e.target.value })} />
              </div>
              <div className="field">
                <textarea value={r.texto} rows={4} maxLength={MAX_TEXTO} aria-label={`Texto de la regla ${i + 1}`} onChange={(e) => poner(i, { texto: e.target.value })} />
                <p className="help">{r.texto.length} / {MAX_TEXTO}</p>
              </div>
              <div className="regla-editor__acciones">
                <button type="button" className="btn ghost sm" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir la regla ${i + 1}`}>
                  ↑
                </button>
                <button type="button" className="btn ghost sm" onClick={() => mover(i, 1)} disabled={i === reglas.length - 1} aria-label={`Bajar la regla ${i + 1}`}>
                  ↓
                </button>
                <button type="button" className="btn gray sm" onClick={() => setReglas((l) => l.filter((_, j) => j !== i))}>
                  <Icon nombre="x" /> Quitar
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'var(--s3)' }}>
          <button type="button" className="btn gray sm" onClick={() => setReglas((l) => [...l, { titulo: '', texto: '' }])} disabled={reglas.length >= 40}>
            <Icon nombre="mas" /> Añadir regla
          </button>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Publicar</h3>
        <label className="row tight" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={obligatoria} onChange={(e) => setObligatoria(e.target.checked)} />
          <span>
            <strong>Pedir que todas las personas las lean de nuevo.</strong>
            <span className="small muted" style={{ display: 'block' }}>
              Úselo para cambios de fondo. Quien no las acepte no podrá reservar. Desmárquelo para corregir errores de redacción.
            </span>
          </span>
        </label>
        <div className="field">
          <label className="field__label" htmlFor="rg-nota">
            Qué cambió (opcional)
          </label>
          <input id="rg-nota" value={nota} maxLength={300} placeholder="Se muestra a quien las vuelva a leer" onChange={(e) => setNota(e.target.value)} />
        </div>
        <div className="row tight">
          <button type="button" className="btn" onClick={publicar} disabled={publicando || !cambiado || !valido}>
            {publicando ? 'Publicando…' : 'Publicar nueva versión'}
          </button>
          <button type="button" className="btn gray" onClick={() => setReglas(vigente?.reglas ?? [])} disabled={publicando || !cambiado}>
            Descartar cambios
          </button>
        </div>
        {!valido && <p className="help">Cada regla necesita título y texto.</p>}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Así se verá</h3>
        <ListaReglas reglas={reglas.filter((r) => r.titulo.trim() || r.texto.trim())} />
      </section>

      {historial.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Versiones anteriores</h3>
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {historial.map((v) => (
              <li key={v.version} className="row" style={{ justifyContent: 'space-between', gap: 'var(--s3)' }}>
                <span>
                  <strong>Versión {v.version}</strong> · {fecha(v.publicado_en)} · {v.obligatoria ? 'obligatoria' : 'cambio menor'}
                  {v.nota && <span className="small muted" style={{ display: 'block' }}>{v.nota}</span>}
                </span>
                <button type="button" className="btn ghost sm" onClick={() => setReglas(v.reglas)}>
                  Usar como base
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
