import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { esAdmin, useAuth } from '../../context/AuthContext'
import { anotarComando, listarEquipos, registro, type FiltrosRegistro } from '../../lib/api'
import { analizar, completar, lineaRegistro, normalizar, type Contexto, type Linea, type TonoLinea } from '../../lib/consola'

const CLAVE_HISTORIAL = 'ladme:consola:historial'
const RAPIDOS = ['estado', 'equipos', 'reservas', 'registro', 'seguir', 'ayuda']

function leerHistorial(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_HISTORIAL) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-100) : []
  } catch {
    return []
  }
}

/** Consola del personal: comandos de texto, al estilo de un panel de servidor. */
export default function Consola() {
  const { perfil } = useAuth()
  const admin = esAdmin(perfil)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [entrada, setEntrada] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [siguiendo, setSiguiendo] = useState(false)
  const [pregunta, setPregunta] = useState<{ esperado: string; accion: () => Promise<string | void>; comando: string } | null>(null)
  const equipos = useRef<string[]>([])
  const historial = useRef<string[]>(leerHistorial())
  const posHist = useRef<number>(-1)
  const id = useRef(0)
  const pantalla = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLInputElement>(null)
  const vivo = useRef<{ timer: number; desde: string; filtros: FiltrosRegistro } | null>(null)

  const imprimir = useCallback((texto: string, tono: TonoLinea = 'info') => {
    setLineas((l) => [...l.slice(-800), { id: ++id.current, tono, texto }])
  }, [])

  useEffect(() => {
    listarEquipos()
      .then((l) => (equipos.current = l.map((e) => e.codigo).sort()))
      .catch(() => {})
    imprimir(`LADME · consola del personal. Escriba «ayuda» para ver los comandos.`, 'tenue')
    return () => {
      if (vivo.current) clearInterval(vivo.current.timer)
    }
  }, [imprimir])

  // Siempre abajo, como una terminal.
  useEffect(() => {
    const p = pantalla.current
    if (p) p.scrollTop = p.scrollHeight
  }, [lineas])

  const parar = useCallback(() => {
    if (!vivo.current) return false
    clearInterval(vivo.current.timer)
    vivo.current = null
    setSiguiendo(false)
    return true
  }, [])

  const seguir = useCallback(
    (filtros: FiltrosRegistro) => {
      parar()
      const desde = new Date().toISOString()
      imprimir('Siguiendo en vivo (cada 5 s). Esc o «parar» para detener.', 'tenue')
      const revisar = async () => {
        const v = vivo.current
        if (!v) return
        try {
          const r = await registro({ ...v.filtros, desde: v.desde }, 200, 0)
          const nuevas = r.filas.filter((f) => f.en > v.desde)
          if (nuevas.length) {
            v.desde = nuevas[0].en
            imprimir([...nuevas].reverse().map(lineaRegistro).join('\n'))
          }
        } catch (e) {
          imprimir(e instanceof Error ? e.message : String(e), 'error')
        }
      }
      vivo.current = { timer: window.setInterval(() => void revisar(), 5000), desde, filtros }
      setSiguiendo(true)
    },
    [imprimir, parar]
  )

  const ejecutar = useCallback(
    async (linea: string) => {
      const texto = linea.trim()
      if (!texto) return
      imprimir(`ladme> ${texto}`, 'cmd')
      historial.current = [...historial.current.filter((h) => h !== texto), texto].slice(-100)
      posHist.current = -1
      try {
        localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(historial.current))
      } catch {
        /* sin almacenamiento: el historial vive solo en esta pestaña */
      }

      // Respuesta a una confirmación pendiente.
      if (pregunta) {
        const p = pregunta
        setPregunta(null)
        if (texto !== p.esperado) {
          imprimir('Cancelado.', 'tenue')
          void anotarComando(p.comando, false, 'cancelado por la persona')
          return
        }
        setOcupado(true)
        try {
          const r = await p.accion()
          imprimir(r || 'Hecho.', 'ok')
          void anotarComando(p.comando, true, r || 'hecho')
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e)
          imprimir(m, 'error')
          void anotarComando(p.comando, false, m)
        } finally {
          setOcupado(false)
        }
        return
      }

      const { nombre, args } = analizar(texto)
      const { comando, args: a } = normalizar(nombre, args)
      if (!comando) {
        imprimir(`No conozco «${nombre}». Escriba «ayuda».`, 'error')
        return
      }
      if (comando.soloAdmin && !admin) {
        imprimir('Ese comando es solo para administradores.', 'error')
        return
      }
      let confirmo = false
      const ctx: Contexto = {
        admin,
        equipos: equipos.current,
        imprimir,
        confirmar: (preguntaTxt, esperado, accion) => {
          confirmo = true
          imprimir(`⚠ ${preguntaTxt}`, 'aviso')
          setPregunta({ esperado, accion, comando: texto })
        },
        seguir,
        parar,
        limpiar: () => setLineas([])
      }
      setOcupado(true)
      try {
        const r = await comando.correr(a, ctx)
        if (!comando.sinRegistro && !confirmo) void anotarComando(texto, true, r || null)
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        imprimir(m, 'error')
        if (!comando.sinRegistro) void anotarComando(texto, false, m)
      } finally {
        setOcupado(false)
        requestAnimationFrame(() => campo.current?.focus())
      }
    },
    [admin, imprimir, parar, pregunta, seguir]
  )

  function teclas(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const t = entrada
      setEntrada('')
      void ejecutar(t)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      setEntrada((x) => completar(x, equipos.current))
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = historial.current
      if (!h.length) return
      e.preventDefault()
      let p = posHist.current === -1 ? h.length : posHist.current
      p = e.key === 'ArrowUp' ? Math.max(0, p - 1) : p + 1
      if (p >= h.length) {
        posHist.current = -1
        setEntrada('')
      } else {
        posHist.current = p
        setEntrada(h[p])
      }
    } else if (e.key === 'Escape' || (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString())) {
      if (parar()) imprimir('Detenido.', 'tenue')
      else if (pregunta) {
        setPregunta(null)
        imprimir('Cancelado.', 'tenue')
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLineas([])
    }
  }

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Controle el laboratorio con comandos. Usa los mismos permisos que los botones de la app, las órdenes peligrosas piden
        confirmación y cada comando queda en el Registro.
      </p>
      <div className="consola" onClick={() => window.getSelection()?.toString() || campo.current?.focus()}>
        <div className="consola__pantalla" ref={pantalla} role="log" aria-live="polite">
          {lineas.map((l) => (
            <pre key={l.id} className={`consola__linea ${l.tono}`}>
              {l.texto}
            </pre>
          ))}
        </div>
        <div className="consola__entrada">
          <span className="consola__prompt" aria-hidden="true">
            {pregunta ? '?' : siguiendo ? '◉' : 'ladme>'}
          </span>
          <input
            ref={campo}
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={teclas}
            disabled={ocupado}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="send"
            aria-label="Comando"
            placeholder={pregunta ? `Escriba ${pregunta.esperado} para confirmar` : ocupado ? 'Trabajando…' : 'Escriba un comando'}
          />
        </div>
      </div>
      <div className="chips" role="group" aria-label="Comandos rápidos">
        {RAPIDOS.map((c) => (
          <button key={c} className="chip num" type="button" onClick={() => void ejecutar(c)} disabled={ocupado}>
            {c}
          </button>
        ))}
        {siguiendo && (
          <button className="chip activo" type="button" onClick={() => parar() && imprimir('Detenido.', 'tenue')}>
            parar
          </button>
        )}
      </div>
    </div>
  )
}
