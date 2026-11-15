import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

/**
 * Lector de QR con la cámara. La librería se carga solo al abrirlo y todo el
 * procesamiento ocurre en el teléfono: la imagen no sale del dispositivo.
 */
export default function Escaner({ alLeer, alCerrar }: { alLeer: (texto: string) => void; alCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const leer = useRef(alLeer)
  leer.current = alLeer

  useEffect(() => {
    let vivo = true
    let flujo: MediaStream | null = null
    let cuadro = 0
    const lienzo = document.createElement('canvas')
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no permite usar la cámara. Pegue el enlace de la credencial.')
        return
      }
      try {
        const [{ default: jsQR }, medios] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        ])
        if (!vivo) {
          medios.getTracks().forEach((t) => t.stop())
          return
        }
        flujo = medios
        const v = video.current
        if (!v || !ctx) return
        v.srcObject = medios
        await v.play().catch(() => undefined)

        let ultimo = 0
        const paso = (ahora: number) => {
          if (!vivo) return
          cuadro = requestAnimationFrame(paso)
          if (ahora - ultimo < 150 || v.readyState < 2 || !v.videoWidth) return
          ultimo = ahora
          const escala = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight))
          lienzo.width = Math.round(v.videoWidth * escala)
          lienzo.height = Math.round(v.videoHeight * escala)
          ctx.drawImage(v, 0, 0, lienzo.width, lienzo.height)
          const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height)
          const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (qr?.data) {
            vivo = false
            navigator.vibrate?.(60)
            leer.current(qr.data)
          }
        }
        cuadro = requestAnimationFrame(paso)
      } catch (e) {
        const nombre = (e as { name?: string }).name
        setError(
          nombre === 'NotAllowedError'
            ? 'No hay permiso para usar la cámara. Habilítelo en la configuración del sitio o pegue el enlace.'
            : nombre === 'NotFoundError'
              ? 'No se encontró una cámara en este dispositivo.'
              : 'No se pudo abrir la cámara. Pegue el enlace de la credencial.'
        )
      }
    }
    void iniciar()

    return () => {
      vivo = false
      cancelAnimationFrame(cuadro)
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="escaner">
      {error ? (
        <div className="alert warn">
          <Icon nombre="alerta" />
          <div className="alert__body">{error}</div>
        </div>
      ) : (
        <div className="escaner__visor">
          <video ref={video} playsInline muted />
          <span className="escaner__marco" aria-hidden="true" />
        </div>
      )}
      <div className="row between">
        <span className="tiny muted">Apunte al QR de la credencial.</span>
        <button className="btn gray sm" type="button" onClick={alCerrar}>
          Cerrar cámara
        </button>
      </div>
    </div>
  )
}
