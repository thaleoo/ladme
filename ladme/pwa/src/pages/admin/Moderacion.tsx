import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  cambiarPalabraBloqueada, listarMarcasModeracion, listarPalabrasBloqueadas, probarModeracion, revisarMarcaModeracion,
  type MarcaModeracion
} from '../../lib/api'
import { hace } from '../../lib/format'
import { Cargando } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import { useToast } from '../../components/Toast'

/** Dónde se escribió cada texto marcado y en qué pestaña se revisa. */
const ORIGEN: Record<string, { texto: string; tab: string }> = {
  reportes: { texto: 'Reporte de falla', tab: 'reportes' },
  solicitudes_software: { texto: 'Solicitud de software', tab: 'software' },
  solicitudes_excepcion: { texto: 'Solicitud de excepción', tab: 'solicitudes' },
  verificaciones_docente: { texto: 'Verificación de docente', tab: 'solicitudes' },
  inasistencias: { texto: 'Apelación de inasistencia', tab: 'reservas' },
  reservas: { texto: 'Detalle de una reserva', tab: 'reservas' }
}

/**
 * Lista de palabras que no se pueden publicar y textos privados marcados.
 * Lo público (mensaje en la pantalla de Faro, nombre, mensajes al titular, clases) se rechaza al guardar;
 * lo privado se guarda y aparece aquí para revisarlo.
 */
export default function Moderacion({ admin }: { admin: boolean }) {
  const toast = useToast()
  const [palabras, setPalabras] = useState<string[] | null>(null)
  const [marcas, setMarcas] = useState<MarcaModeracion[]>([])
  const [nueva, setNueva] = useState('')
  const [prueba, setPrueba] = useState('')
  const [resultado, setResultado] = useState<{ texto: string; palabra: string | null } | null>(null)
  const [filtro, setFiltro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    try {
      const [p, m] = await Promise.all([listarPalabrasBloqueadas(), listarMarcasModeracion()])
      setPalabras(p)
      setMarcas(m)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la moderación.')
      setPalabras([])
    }
  }
  useEffect(() => {
    void cargar()
  }, [])

  async function cambiar(palabra: string, agregar: boolean) {
    setOcupado(true)
    setError(null)
    try {
      const guardada = await cambiarPalabraBloqueada(palabra, agregar)
      toast.mostrar(agregar ? `«${guardada}» ya no se puede publicar.` : `«${guardada}» se quitó de la lista.`)
      if (agregar) setNueva('')
      setResultado(null)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la lista.')
    } finally {
      setOcupado(false)
    }
  }

  async function probar() {
    const texto = prueba.trim()
    if (!texto) return
    setOcupado(true)
    try {
      setResultado({ texto, palabra: await probarModeracion(texto) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo probar el texto.')
    } finally {
      setOcupado(false)
    }
  }

  async function revisada(id: number) {
    try {
      await revisarMarcaModeracion(id)
      setMarcas((l) => l.filter((m) => m.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar como revisado.')
    }
  }

  if (!palabras) return <Cargando />
  const visibles = palabras.filter((p) => p.includes(filtro.trim().toLowerCase()))

  return (
    <div className="stack">
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Textos marcados</h2>
        <p className="small muted">
          Reportes, apelaciones y solicitudes que traen una palabra de la lista. Se guardaron igual, porque solo los ve el personal.
        </p>
        {marcas.length === 0 ? (
          <p className="small" style={{ margin: 0 }}>No hay nada pendiente de revisar.</p>
        ) : (
          <ul className="moderacion__lista">
            {marcas.map((m) => {
              const o = ORIGEN[m.tabla] ?? { texto: m.tabla, tab: 'registro' }
              return (
                <li key={m.id} className="moderacion__fila">
                  <span>
                    <strong>{o.texto}</strong> · «{m.palabra}» · {hace(m.creado_en)}
                    {m.perfiles && <span className="small muted" style={{ display: 'block' }}>{m.perfiles.nombre} ({m.perfiles.correo})</span>}
                  </span>
                  <span className="moderacion__acciones">
                    <Link className="btn ghost sm" to={`/admin?tab=${o.tab}`}>Ver</Link>
                    <button type="button" className="btn gray sm" onClick={() => void revisada(m.id)}>
                      <Icon nombre="check" /> Revisado
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Probar un texto</h2>
        <p className="small muted">Escriba algo como lo pondría una persona y vea si se podría publicar.</p>
        <div className="row tight">
          <input aria-label="Texto de prueba" value={prueba} maxLength={500} placeholder="Ej. No apagar: entrenando un modelo"
                 onChange={(e) => { setPrueba(e.target.value); setResultado(null) }}
                 onKeyDown={(e) => e.key === 'Enter' && void probar()} />
          <button type="button" className="btn sm" onClick={() => void probar()} disabled={ocupado || !prueba.trim()}>Probar</button>
        </div>
        {resultado && (
          <div className={`alert ${resultado.palabra ? 'warn' : 'ok'}`} style={{ marginTop: 'var(--s3)' }}>
            <Icon nombre={resultado.palabra ? 'prohibido' : 'check-circulo'} />
            <div className="alert__body">
              {resultado.palabra ? <>No se podría publicar: coincide con «{resultado.palabra}».</> : 'Se puede publicar.'}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>
          Palabras que no se pueden publicar <span className="muted" style={{ fontWeight: 400 }}>({palabras.length})</span>
        </h2>
        <p className="small muted">
          Se comparan palabras completas, sin distinguir mayúsculas ni tildes, y se reconocen variantes como «p.u.t.a», «pu7a», letras
          estiradas y plurales. Evite palabras que también sean normales en el laboratorio: no se mira el contexto.
        </p>
        {admin && (
          <div className="row tight" style={{ marginBottom: 'var(--s3)' }}>
            <input aria-label="Palabra o frase para agregar" value={nueva} maxLength={60} placeholder="Palabra o frase corta"
                   onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nueva.trim() && void cambiar(nueva, true)} />
            <button type="button" className="btn sm" onClick={() => void cambiar(nueva, true)} disabled={ocupado || nueva.trim().length < 2}>
              <Icon nombre="mas2" /> Agregar
            </button>
          </div>
        )}
        {palabras.length > 12 && (
          <input aria-label="Buscar en la lista" value={filtro} placeholder="Buscar en la lista" onChange={(e) => setFiltro(e.target.value)}
                 style={{ marginBottom: 'var(--s3)' }} />
        )}
        <div className="chips chips--envolver">
          {visibles.map((p) =>
            admin ? (
              <button key={p} type="button" className="chip" onClick={() => void cambiar(p, false)} disabled={ocupado} aria-label={`Quitar ${p}`}>
                {p} <Icon nombre="x" width={14} height={14} />
              </button>
            ) : (
              <span key={p} className="chip">{p}</span>
            )
          )}
        </div>
        {!admin && <p className="help">Solo la administración puede cambiar la lista.</p>}
      </section>
    </div>
  )
}
