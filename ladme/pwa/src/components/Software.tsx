import { useCallback, useEffect, useMemo, useState } from 'react'
import { cancelarSoftware, listarSoftware, solicitarSoftware } from '../lib/api'
import type { Equipo, EstadoSoftware, SolicitudSoftware } from '../lib/types'
import { useLimites } from '../lib/politicas'
import { useAuth } from '../context/AuthContext'
import Icon from './Icon'
import Modal from './Modal'
import { useToast } from './Toast'

export const ESTADO_SOFTWARE: Record<EstadoSoftware, { texto: string; tono: string }> = {
  pendiente: { texto: 'Pendiente', tono: 'warn' },
  en_tramite: { texto: 'En trámite con TI', tono: 'info' },
  instalado: { texto: 'Instalado', tono: 'ok' },
  rechazada: { texto: 'No se instalará', tono: 'danger' },
  cancelada: { texto: 'Cancelada', tono: 'gray' }
}

/** Fecha (aaaa-mm-dd) más próxima que cumple los días hábiles de anticipación. */
export function primeraFechaSoftware(diasHabiles: number): string {
  const d = new Date()
  let n = 0
  while (n < diasHabiles) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) n++
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

/** ¿La fecha de una reserva deja tiempo para instalar software? */
export function alcanzaParaSoftware(inicioIso: string, diasHabiles: number): boolean {
  const fecha = new Date(inicioIso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  return fecha >= primeraFechaSoftware(diasHabiles)
}

export interface DatosSoftware {
  software: string
  version: string
  uso: string
  enlace: string
}
export const SOFTWARE_VACIO: DatosSoftware = { software: '', version: '', uso: '', enlace: '' }

/** Campos del pedido, con aviso si algún equipo ya tiene ese programa. */
export function CamposSoftware({ valor, cambiar, equipos }: { valor: DatosSoftware; cambiar: (v: DatosSoftware) => void; equipos: Equipo[] }) {
  const yaLoTienen = useMemo(() => {
    const q = valor.software.trim().toLowerCase()
    if (q.length < 3) return []
    return equipos.filter((e) => !e.archivado && (e.software ?? []).some((p) => p.toLowerCase().includes(q))).map((e) => e.codigo)
  }, [valor.software, equipos])
  return (
    <div className="stack software-campos">
      <div className="field">
        <label className="field__label" htmlFor="sw-nombre">Programa que necesita</label>
        <input id="sw-nombre" maxLength={200} value={valor.software} onChange={(e) => cambiar({ ...valor, software: e.target.value })}
               placeholder="Ej.: QGIS, Stata, MATLAB" />
      </div>
      {yaLoTienen.length > 0 && (
        <p className="small software-ya">
          <Icon nombre="info" width={15} height={15} />
          <span>
            Ya lo tienen: <strong>{yaLoTienen.slice(0, 6).join(', ')}</strong>
            {yaLoTienen.length > 6 ? ` y ${yaLoTienen.length - 6} más` : ''}. Puede reservar uno de esos.
          </span>
        </p>
      )}
      <div className="field">
        <label className="field__label" htmlFor="sw-uso">Para qué lo va a usar</label>
        <textarea id="sw-uso" rows={2} maxLength={600} value={valor.uso} onChange={(e) => cambiar({ ...valor, uso: e.target.value })}
                  placeholder="Ej.: análisis de mapas para mi trabajo de grado" />
      </div>
      <div className="software-fila">
        <div className="field">
          <label className="field__label" htmlFor="sw-version">Versión (opcional)</label>
          <input id="sw-version" maxLength={60} value={valor.version} onChange={(e) => cambiar({ ...valor, version: e.target.value })} placeholder="3.34" />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="sw-enlace">Enlace de descarga (opcional)</label>
          <input id="sw-enlace" type="url" maxLength={300} value={valor.enlace} onChange={(e) => cambiar({ ...valor, enlace: e.target.value })} placeholder="https://…" />
        </div>
      </div>
    </div>
  )
}

/** Pedido sin reserva (desde Disponibilidad). */
export function PedirSoftware({ abierto, cerrar, equipos, inicial = '' }: { abierto: boolean; cerrar: () => void; equipos: Equipo[]; inicial?: string }) {
  const lim = useLimites()
  const toast = useToast()
  const minimo = primeraFechaSoftware(lim.softwareAnticipacion)
  const [datos, setDatos] = useState<DatosSoftware>(SOFTWARE_VACIO)
  const [fecha, setFecha] = useState(minimo)
  const [equipo, setEquipo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Al abrir con un nombre (lo que se buscó o se eligió), ya viene escrito.
  useEffect(() => {
    if (abierto && inicial) setDatos((d) => (d.software ? d : { ...d, software: inicial }))
  }, [abierto, inicial])

  async function enviar() {
    setOcupado(true)
    setError(null)
    try {
      await solicitarSoftware({ ...datos, version: datos.version || undefined, enlace: datos.enlace || undefined, fecha: fecha || undefined, equipo: equipo || undefined })
      toast.mostrar('Solicitud enviada: el laboratorio le avisará cómo avanza.', 'ok')
      setDatos(SOFTWARE_VACIO)
      cerrar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Modal abierto={abierto} titulo="Pedir un programa" descripcion="El laboratorio lo pide a TI para instalarlo en la sala o en el equipo que indique." onCerrar={cerrar}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          La instalación pasa por TI, así que pídalo con al menos {lim.softwareAnticipacion} días hábiles de anticipación.
        </p>
        <CamposSoftware valor={datos} cambiar={setDatos} equipos={equipos} />
        <div className="software-fila">
          <div className="field">
            <label className="field__label" htmlFor="sw-fecha">Lo necesita desde</label>
            <input id="sw-fecha" type="date" min={minimo} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="sw-equipo">¿Dónde lo necesita?</label>
            <select id="sw-equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
              <option value="">En cualquier equipo de la sala</option>
              {equipos.filter((e) => !e.archivado).map((e) => <option key={e.id} value={e.codigo}>{e.codigo}</option>)}
            </select>
          </div>
        </div>
        {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}
        <button type="button" disabled={ocupado || datos.software.trim().length < 2 || datos.uso.trim().length < 10} onClick={() => void enviar()}>
          {ocupado ? 'Enviando…' : 'Enviar solicitud'}
        </button>
      </div>
    </Modal>
  )
}

/** Mis solicitudes de software (en Mis reservas). */
export default function MisSoftware() {
  const { perfil } = useAuth()
  const toast = useToast()
  const [lista, setLista] = useState<SolicitudSoftware[]>([])
  const cargar = useCallback(() => {
    if (perfil) void listarSoftware({ mias: perfil.id }).then(setLista).catch(() => setLista([]))
  }, [perfil])
  useEffect(() => cargar(), [cargar])
  const recientes = lista.filter((s) => s.estado === 'pendiente' || s.estado === 'en_tramite' || Date.now() - new Date(s.actualizado_en).getTime() < 30 * 86400000)
  if (recientes.length === 0) return null
  return (
    <section className="card tight software-mias" id="software">
      <h3 style={{ margin: 0, fontSize: 'var(--text-base)' }}>Solicitudes de software</h3>
      <ul className="inasistencias__lista">
        {recientes.map((s) => (
          <li key={s.id}>
            <span className="inasistencias__d">
              <strong>{s.software}{s.version ? ` ${s.version}` : ''}</strong>
              <span className="tiny muted">
                {s.estado === 'instalado' && s.equipos_instalados.length
                  ? `En ${s.equipos_instalados.join(', ')}`
                  : s.para_fecha ? `Para el ${new Date(s.para_fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : 'Sin fecha'}
                {s.equipos?.codigo && s.estado !== 'instalado' ? ` · ${s.equipos.codigo}` : ''}
              </span>
              {s.respuesta && <span className="tiny">Laboratorio: {s.respuesta}</span>}
            </span>
            <span className={`badge ${ESTADO_SOFTWARE[s.estado].tono}`}>{ESTADO_SOFTWARE[s.estado].texto}</span>
            {(s.estado === 'pendiente' || s.estado === 'en_tramite') ? (
              <button type="button" className="btn ghost sm" onClick={() => void cancelarSoftware(s.id).then(() => { toast.mostrar('Solicitud cancelada.'); cargar() })}>
                Cancelar
              </button>
            ) : <span />}
          </li>
        ))}
      </ul>
    </section>
  )
}
