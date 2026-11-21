import { useCallback, useEffect, useState } from 'react'
import { apelarInasistencia, listarInasistencias } from '../lib/api'
import type { Inasistencia } from '../lib/types'
import { esStaff, useAuth } from '../context/AuthContext'
import Icon from './Icon'
import Modal from './Modal'
import { useToast } from './Toast'

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })
const dia = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' })

/** Sanción vigente por inasistencias (o null). El personal no tiene sanciones. */
export function useSancion(): { hasta: string | null; lista: Inasistencia[]; recargar: () => void } {
  const { perfil } = useAuth()
  const [lista, setLista] = useState<Inasistencia[]>([])
  const recargar = useCallback(() => {
    if (!perfil || esStaff(perfil)) return
    listarInasistencias(perfil.id).then(setLista).catch(() => setLista([]))
  }, [perfil])
  useEffect(() => recargar(), [recargar])
  const hasta = lista
    .filter((i) => i.estado === 'vigente' && i.sancion_hasta && new Date(i.sancion_hasta).getTime() > Date.now())
    .map((i) => i.sancion_hasta as string)
    .sort()
    .pop() ?? null
  return { hasta, lista, recargar }
}

/** Aviso de sanción para Reservar: no puede crear reservas hasta cierta fecha. */
export function AvisoSancion({ hasta }: { hasta: string }) {
  return (
    <div className="alert danger">
      <Icon nombre="alerta" />
      <div className="alert__body">
        <strong>No puede reservar hasta el {dia(hasta)}.</strong> Acumuló inasistencias: reservas sin llegada registrada a tiempo.
        Si alguna fue un error, apélela desde <a href="/mis-reservas#inasistencias">Mis reservas</a>.
      </div>
    </div>
  )
}

/**
 * Inasistencias de la persona (strikes de los últimos 60 días): cuáles cuentan, la sanción vigente
 * y la apelación de cada una.
 */
export default function Inasistencias() {
  const toast = useToast()
  const { hasta, lista, recargar } = useSancion()
  const [apelar, setApelar] = useState<Inasistencia | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lista.length && window.location.hash === '#inasistencias') {
      document.getElementById('inasistencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [lista.length])

  const recientes = lista.filter((i) => Date.now() - new Date(i.inicio).getTime() < 60 * 86400000)
  if (recientes.length === 0) return null
  const vigentes = recientes.filter((i) => i.estado === 'vigente').length

  async function enviar() {
    if (!apelar) return
    setOcupado(true)
    setError(null)
    try {
      await apelarInasistencia(apelar.id, motivo.trim())
      toast.mostrar('Apelación enviada: el laboratorio la revisará y le avisará.', 'ok')
      setApelar(null)
      setMotivo('')
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="card tight inasistencias" id="inasistencias">
      <div className="inasistencias__cab">
        <h3>Inasistencias</h3>
        <span className={`badge ${vigentes >= 2 ? 'danger' : vigentes === 1 ? 'warn' : 'gray'}`}>
          {vigentes} en 60 días
        </span>
      </div>
      {hasta ? (
        <p className="small inasistencias__sancion">
          <Icon nombre="alerta" width={15} height={15} /> No puede hacer reservas hasta el {dia(hasta)}.
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Registre su llegada en los primeros minutos de cada reserva. A la segunda inasistencia en 60 días no podrá reservar por
          unos días.
        </p>
      )}
      <ul className="inasistencias__lista">
        {recientes.map((i) => {
          const estado =
            i.estado === 'anulada' ? { t: 'Anulada', c: 'gray' }
              : i.apelacion && !i.resuelto_en ? { t: 'Apelada', c: 'info' }
                : i.apelacion ? { t: 'Mantenida', c: 'danger' } : { t: 'Cuenta', c: 'warn' }
          return (
            <li key={i.id} className={i.estado === 'anulada' ? 'anulada' : ''}>
              <span className="inasistencias__d">
                <strong>{i.equipo_codigo}</strong>
                <span className="tiny muted">{fecha(i.inicio)}</span>
                {i.respuesta && <span className="tiny">Laboratorio: {i.respuesta}</span>}
              </span>
              <span className={`badge ${estado.c}`}>{estado.t}</span>
              {i.estado === 'vigente' && !i.apelacion && (
                <button type="button" className="btn ghost sm" onClick={() => { setError(null); setApelar(i) }}>
                  Apelar
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <Modal abierto={!!apelar} titulo="Apelar inasistencia" onCerrar={() => setApelar(null)}>
        {apelar && (
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              {apelar.equipo_codigo} · {fecha(apelar.inicio)}. Cuéntele al laboratorio qué pasó (por ejemplo, llegó pero el QR no
              funcionó). Si la anulan, también se levanta la sanción que haya causado.
            </p>
            <div className="field">
              <label className="field__label" htmlFor="ap-in">Qué pasó</label>
              <textarea id="ap-in" rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            {error && <div className="alert danger"><Icon nombre="alerta" /><div className="alert__body">{error}</div></div>}
            <button type="button" disabled={ocupado || motivo.trim().length < 10} onClick={() => void enviar()}>
              Enviar apelación
            </button>
          </div>
        )}
      </Modal>
    </section>
  )
}
