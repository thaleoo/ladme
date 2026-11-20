import { useState, type FormEvent } from 'react'
import { guardarPerfil, pedirVerificacionDocente } from '../lib/api'
import { esStaff, useAuth } from '../context/AuthContext'
import { MATRICULAS, PROGRAMAS, TIPOS_USUARIO } from '../lib/types'
import Icon from './Icon'
import { useToast } from './Toast'

/**
 * Datos académicos del perfil. Se piden una sola vez (y se pueden actualizar
 * cada semestre); cada reserva guarda una copia para las estadísticas.
 */
export default function PerfilForm({ alGuardar }: { alGuardar?: () => void }) {
  const { perfil, recargarPerfil } = useAuth()
  const toast = useToast()
  const [nombre, setNombre] = useState(perfil?.nombre ?? '')
  const [tipo, setTipo] = useState<string>(perfil?.tipo_usuario ?? '')
  const [programa, setPrograma] = useState(perfil?.programa ?? '')
  const [matricula, setMatricula] = useState(perfil?.matricula ?? '')
  const [verificacion, setVerificacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const estudiante = tipo === 'Estudiante'
  const staff = esStaff(perfil)
  const verificado = !!perfil?.docente_verificado_en
  const eraDocente = perfil?.tipo_usuario === 'Docente/Investigador'
  const pideDocente = tipo === 'Docente/Investigador' && !staff && !verificado

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (nombre.trim().length < 3) return setError('Escriba su nombre completo.')
    if (!tipo) return setError('Indique si es estudiante o docente/investigador.')
    if (!programa.trim()) return setError('Seleccione su programa.')
    if (estudiante && !matricula) return setError('Seleccione su matrícula (semestre).')
    setGuardando(true)
    try {
      await guardarPerfil({
        nombre: nombre.trim(),
        tipo_usuario: tipo,
        programa: programa.trim(),
        matricula: estudiante ? matricula : null
      })
      if (pideDocente && verificacion.trim().length >= 5) await pedirVerificacionDocente(verificacion.trim())
      await recargarPerfil()
      toast.mostrar('Perfil actualizado.')
      alGuardar?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el perfil.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="stack" noValidate>
      <div className="grid cols-2 gap-sm">
        <div className="field">
          <label className="field__label" htmlFor="pf-nombre">
            Nombre completo
          </label>
          <input id="pf-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} autoComplete="name" />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="pf-tipo">
            Tipo de usuario
          </label>
          <select id="pf-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="" disabled>
              Seleccione
            </option>
            {TIPOS_USUARIO.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="pf-programa">
            Programa académico
          </label>
          <select id="pf-programa" value={programa} onChange={(e) => setPrograma(e.target.value)}>
            <option value="" disabled>
              Seleccione
            </option>
            {programa && !PROGRAMAS.includes(programa) && <option>{programa}</option>}
            {PROGRAMAS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        {estudiante && (
          <div className="field">
            <label className="field__label" htmlFor="pf-matricula">
              Matrícula (semestre)
            </label>
            <select id="pf-matricula" value={matricula} onChange={(e) => setMatricula(e.target.value)}>
              <option value="" disabled>
                Seleccione
              </option>
              {matricula && !MATRICULAS.includes(matricula) && <option>{matricula}</option>}
              {MATRICULAS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <p className="help">Actualícela al comenzar cada semestre.</p>
          </div>
        )}
      </div>
      {tipo === 'Docente/Investigador' && !staff && (
        verificado ? (
          <p className="small verif-docente ok" style={{ margin: 0 }}>
            <Icon nombre="check" width={15} height={15} /> Docente verificado: puede pedir la sala para sus clases.
          </p>
        ) : (
          <div className="field verif-docente">
            <label className="field__label" htmlFor="pf-verif">
              {eraDocente ? 'Verificación docente en revisión' : 'Verificación docente'}
            </label>
            <textarea
              id="pf-verif"
              rows={2}
              maxLength={300}
              value={verificacion}
              onChange={(e) => setVerificacion(e.target.value)}
              placeholder="Asignaturas que dicta o dependencia donde trabaja"
            />
            <p className="help">
              Para pedir la sala para clases, el laboratorio confirma que es docente. Mientras tanto puede reservar equipos con
              normalidad.
            </p>
          </div>
        )
      )}
      {eraDocente && verificado && tipo !== 'Docente/Investigador' && !staff && (
        <p className="small texto-aviso" style={{ margin: 0 }}>Si cambia de tipo de usuario, pierde la verificación docente.</p>
      )}
      {error && (
        <div className="alert danger">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      )}
      <div className="row">
        <button type="submit" disabled={guardando}>
          {guardando ? (
            <>
              <span className="spinner" aria-hidden="true" /> Guardando…
            </>
          ) : (
            <>
              <Icon nombre="check" /> Guardar perfil
            </>
          )}
        </button>
      </div>
    </form>
  )
}
