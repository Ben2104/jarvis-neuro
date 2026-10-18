import { useEffect, useRef } from 'react'
import { useWebcamFeed } from '../gestures/webcamStream'

/** Mirrored, dimmed selfie view behind the 3D canvas while the camera runs. */
export function WebcamBackdrop() {
  const { stream } = useWebcamFeed()
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    return () => {
      el.srcObject = null
    }
  }, [stream])

  if (!stream) return null
  return <video ref={ref} className="webcam-backdrop" autoPlay muted playsInline aria-hidden="true" />
}
