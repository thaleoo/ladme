import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as QRCode from 'qrcode'
import { salaPublica, type EquipoSala } from '../lib/api'
import { hora } from '../lib/format'
import Logo from '../components/Logo'

const ESTADOS: Record<EquipoSala['estado'], string> = {
  libre: 'Libre',
  ocupado: 'Ocupado',
  bloqueado: 'Actividad del laboratorio',
  mantenimiento: 'Fuera de servicio'
}

/**
 * Plano de la sala en vivo, sin iniciar sesión y sin datos personales.
 * /sala?kiosco=1 es la versión para una pantalla del laboratorio (grande, con reloj y QR).
 */
export default function Sala() {
  const [params] = useSearchParams()
  const kiosco = params.has('kiosco')
  const [equipos, setEquipos] = useState<EquipoSala[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [, setTic] = useState(0)

  useEffect(() => {
    const cargar = () => salaPublica().then((l) => { setEquipos(l); setError(null) }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sin conexión.'))
    void cargar()
    const t = window.setInterval(cargar, 30_000)
    const r = window.setInterval(() => setTic((n) => n + 1), 15_000)
    return () => { window.clearInterval(t); window.clearInterval(r) }
  }, [])

  useEffect(() => {
    if (!kiosco) return
    void QRCode.toString(`${window.location.origin}/`, { type: 'svg', margin: 0, color: { dark: '#0b0b10', light: '#ffffff' } }).then(setQr)
  }, [kiosco])

  const lista = equipos ?? []
  const conPlano = lista.some((e) => e.x && e.y)
  const cuentas = useMemo(() => ({
    libre: lista.filter((e) => e.estado === 'libre').length,
    ocupado: lista.filter((e) => e.estado === 'ocupado').length,
    otros: lista.filter((e) => e.estado === 'bloqueado' || e.estado === 'mantenimiento').length
  }), [lista])
  const columnas = Math.max(4, ...lista.map((e) => e.x ?? 0))
  const filas = Math.max(1, ...lista.map((e) => e.y ?? 0))

  const ficha = (e: EquipoSala) => {
    const detalle = e.estado === 'libre'
      ? (e.proxima ? `Libre hasta ${hora(e.proxima)}` : 'Libre')
      : e.hasta ? `${ESTADOS[e.estado]} · hasta ${hora(e.hasta)}` : ESTADOS[e.estado]
    const contenido = (
      <>
        <span className="sala__codigo">{e.codigo}</span>
        <span className="sala__detalle">{detalle}</span>
        {e.sistema && <span className="sala__so">{e.sistema}</span>}
      </>
    )
    const estilo = conPlano && e.x && e.y ? { gridColumn: e.x, gridRow: e.y } : undefined
    return kiosco ? (
      <div key={e.codigo} className={`sala__equipo es-${e.estado}`} style={estilo} title={detalle}>{contenido}</div>
    ) : (
      <Link key={e.codigo} to={`/equipo/${e.codigo}`} className={`sala__equipo es-${e.estado}`} style={estilo} title={detalle}>{contenido}</Link>
    )
  }

  return (
    <div className={`sala ${kiosco ? 'sala--kiosco' : ''}`}>
      <header className="sala__cabeza">
        <div className="row tight">
          <Logo size={kiosco ? 44 : 34} />
          <div>
            <strong className="sala__titulo">Sala LADME</strong>
            <span className="sala__sub">Laboratorio de Datos y Modelamiento Estadístico</span>
          </div>
        </div>
        {kiosco && <span className="sala__reloj num">{new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span>}
      </header>

      <div className="sala__resumen">
        <span><i className="punto-sala es-libre" /> {cuentas.libre} libres</span>
        <span><i className="punto-sala es-ocupado" /> {cuentas.ocupado} ocupados</span>
        {cuentas.otros > 0 && <span><i className="punto-sala es-bloqueado" /> {cuentas.otros} no disponibles</span>}
      </div>

      {error && <p className="small" style={{ color: 'var(--danger-600, #dc2626)' }}>{error}</p>}
      {!equipos && !error && <p className="small muted">Cargando la sala…</p>}

      <div className="sala__cuerpo">
        <div
          className={`sala__plano ${conPlano ? 'con-plano' : ''}`}
          style={conPlano ? { gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${filas}, auto)` } : undefined}
        >
          {lista.filter((e) => !conPlano || (e.x && e.y)).map(ficha)}
        </div>
        {kiosco && qr && (
          <aside className="sala__qr">
            <div className="sala__qr-img" dangerouslySetInnerHTML={{ __html: qr }} />
            <strong>Reserva desde tu celular</strong>
            <span>{window.location.host}</span>
          </aside>
        )}
      </div>
      {!kiosco && conPlano && lista.some((e) => !e.x || !e.y) && (
        <p className="tiny muted">Algunos equipos aún no tienen lugar en el plano (Administración → Equipos).</p>
      )}
    </div>
  )
}
