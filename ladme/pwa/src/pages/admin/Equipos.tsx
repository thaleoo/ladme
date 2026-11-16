import { useCallback, useEffect, useState } from 'react'
import { guardarEquipo, listarEquipos } from '../../lib/api'
import type { Equipo } from '../../lib/types'
import { Cargando } from '../../components/PageHeader'
import Icon from '../../components/Icon'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

const ESTADOS: Array<{ valor: Equipo['estado']; texto: string; tono: string }> = [
  { valor: 'activo', texto: 'Activo', tono: 'ok' },
  { valor: 'mantenimiento', texto: 'En mantenimiento', tono: 'warn' },
  { valor: 'fuera_de_servicio', texto: 'Fuera de servicio', tono: 'danger' }
]

interface Borrador {
  id?: string
  codigo: string
  nombre: string
  marca: string
  modelo: string
  ubicacion: string
  estado: Equipo['estado']
  placa_oficial: string
  serial: string
  nfc_uid: string
  fecha_adquisicion: string
  especificaciones: string
  archivado: boolean
}

function aBorrador(e?: Equipo): Borrador {
  return {
    id: e?.id,
    codigo: e?.codigo ?? '',
    nombre: e?.nombre ?? '',
    marca: e?.marca ?? '',
    modelo: e?.modelo ?? '',
    ubicacion: e?.ubicacion ?? 'Sala LADME',
    estado: e?.estado ?? 'activo',
    placa_oficial: e?.placa_oficial ?? '',
    serial: e?.serial ?? '',
    nfc_uid: e?.nfc_uid ?? '',
    fecha_adquisicion: e?.fecha_adquisicion ?? '',
    especificaciones: Object.entries(e?.especificaciones ?? {})
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n'),
    archivado: e?.archivado ?? false
  }
}

/** Catálogo de equipos: alta, edición, estado y archivo. Los códigos de las etiquetas no se cambian. */
export default function Equipos() {
  const toast = useToast()
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [b, setB] = useState<Borrador | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setEquipos(await listarEquipos(true))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los equipos.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function guardar() {
    if (!b) return
    setError(null)
    const codigo = b.codigo.trim().toUpperCase()
    if (!/^[A-Z0-9-]{3,20}$/.test(codigo)) return setError('El código usa solo letras, números y guiones (3 a 20), p. ej. UNAL-17.')
    if (!b.nombre.trim()) return setError('Escriba el nombre o modelo del equipo.')
    if (!b.id && equipos.some((e) => e.codigo === codigo)) return setError('Ya existe un equipo con ese código.')
    const especificaciones: Record<string, string> = {}
    for (const linea of b.especificaciones.split('\n')) {
      const i = linea.indexOf(':')
      if (i > 0 && linea.slice(i + 1).trim()) especificaciones[linea.slice(0, i).trim()] = linea.slice(i + 1).trim()
    }
    setOcupado(true)
    try {
      await guardarEquipo({
        id: b.id,
        codigo,
        nombre: b.nombre.trim(),
        marca: b.marca.trim() || null,
        modelo: b.modelo.trim() || null,
        ubicacion: b.ubicacion.trim() || null,
        estado: b.estado,
        placa_oficial: b.placa_oficial.trim() || null,
        serial: b.serial.trim() || null,
        nfc_uid: b.nfc_uid.trim() || null,
        fecha_adquisicion: b.fecha_adquisicion || null,
        especificaciones,
        archivado: b.archivado
      })
      toast.mostrar('Equipo guardado.')
      setB(null)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el equipo.')
    } finally {
      setOcupado(false)
    }
  }

  const campo = (clave: keyof Borrador, etiqueta: string, extra: { tipo?: string; ayuda?: string; bloqueado?: boolean } = {}) => (
    <div className="field">
      <label className="field__label" htmlFor={`eq-${clave}`}>
        {etiqueta}
      </label>
      <input
        id={`eq-${clave}`}
        type={extra.tipo ?? 'text'}
        value={String(b?.[clave] ?? '')}
        disabled={extra.bloqueado}
        onChange={(e) => b && setB({ ...b, [clave]: e.target.value })}
      />
      {extra.ayuda && <p className="help">{extra.ayuda}</p>}
    </div>
  )

  if (cargando) return <Cargando texto="Cargando equipos…" />

  return (
    <>
      <div className="row between">
        <p className="small muted" style={{ margin: 0 }}>
          {equipos.filter((e) => !e.archivado).length} equipos en el catálogo.
        </p>
        <button className="btn" type="button" onClick={() => { setError(null); setB(aBorrador()) }}>
          <Icon nombre="mas2" /> Nuevo equipo
        </button>
      </div>
      {error && !b && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      <div className="grid cols-2">
        {equipos.map((e) => {
          const est = ESTADOS.find((x) => x.valor === e.estado)
          return (
            <article key={e.id} className="card tight" style={{ opacity: e.archivado ? 0.6 : 1 }}>
              <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row tight">
                    <strong style={{ fontSize: 'var(--text-lg)' }}>{e.codigo}</strong>
                    <span className={`badge ${est?.tono ?? 'gray'}`}>{est?.texto ?? e.estado}</span>
                    {e.archivado && <span className="badge gray">Archivado</span>}
                  </div>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    {[e.nombre, e.marca, e.ubicacion].filter(Boolean).join(' · ')}
                  </p>
                  {(e.serial || e.placa_oficial) && (
                    <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                      {e.placa_oficial ? `Placa ${e.placa_oficial}` : ''} {e.serial ? `Serial ${e.serial}` : ''}
                    </p>
                  )}
                </div>
                <button className="btn ghost sm" type="button" onClick={() => { setError(null); setB(aBorrador(e)) }}>
                  Editar
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <Modal
        abierto={!!b}
        titulo={b?.id ? `Editar ${b.codigo}` : 'Nuevo equipo'}
        onCerrar={() => setB(null)}
        pie={
          <>
            <button className="btn gray" type="button" onClick={() => setB(null)} disabled={ocupado}>
              Volver
            </button>
            <button className="btn" type="button" onClick={guardar} disabled={ocupado}>
              {ocupado ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        }
      >
        {b && (
          <div className="stack">
            <div className="grid cols-2 gap-sm">
              {campo('codigo', 'Código', {
                bloqueado: !!b.id,
                ayuda: b.id ? 'Es el de la etiqueta NFC/QR: no se cambia.' : 'Será el de la etiqueta NFC/QR.'
              })}
              <div className="field">
                <label className="field__label" htmlFor="eq-estado">
                  Estado
                </label>
                <select id="eq-estado" value={b.estado} onChange={(e) => setB({ ...b, estado: e.target.value as Equipo['estado'] })}>
                  {ESTADOS.map((x) => (
                    <option key={x.valor} value={x.valor}>
                      {x.texto}
                    </option>
                  ))}
                </select>
                {b.estado !== 'activo' && <p className="help">No se podrá reservar. Las reservas ya hechas no se cancelan solas.</p>}
              </div>
              {campo('nombre', 'Nombre o modelo')}
              {campo('marca', 'Marca')}
              {campo('modelo', 'Modelo')}
              {campo('ubicacion', 'Ubicación')}
              {campo('placa_oficial', 'Placa de inventario')}
              {campo('serial', 'Serial')}
              {campo('nfc_uid', 'UID de la etiqueta NFC')}
              {campo('fecha_adquisicion', 'Fecha de adquisición', { tipo: 'date' })}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="eq-esp">
                Especificaciones (una por línea, «nombre: valor»)
              </label>
              <textarea
                id="eq-esp"
                rows={4}
                value={b.especificaciones}
                onChange={(e) => setB({ ...b, especificaciones: e.target.value })}
                placeholder={'procesador: Xeon W-2245\nmemoria: 64 GB\ngpu: RTX A4000'}
              />
            </div>
            {b.id && (
              <label className="check-row">
                <input type="checkbox" checked={b.archivado} onChange={(e) => setB({ ...b, archivado: e.target.checked })} />
                <span>
                  <strong>Archivar</strong>
                  Deja de aparecer para los usuarios; su historial se conserva.
                </span>
              </label>
            )}
            {error && (
              <div className="alert danger">
                <Icon nombre="alerta" />
                <div className="alert__body">{error}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
