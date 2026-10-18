import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { useEffect, useRef } from 'react'
import { useViewer, viewerStore } from '../state/store'
import { gestureBus } from './bus'
import { type GestureState, initialGestureState, stepGesture } from './pinch'

export const MEDIAPIPE_WASM = '/mediapipe/wasm'
export const HAND_MODEL = '/mediapipe/hand_landmarker.task'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Webcam + MediaPipe loop, active only while gesture mode is on. */
export function useHandTracking(): void {
  const gesturesOn = useViewer((s) => s.gesturesOn)
  // Spec §6 fix 1: per-frame gesture state lives in a ref, never in React state.
  const gesture = useRef<GestureState>(initialGestureState())

  useEffect(() => {
    const { setWebcam } = viewerStore.getState()
    if (!gesturesOn) {
      setWebcam({ status: 'off', hands: 0, error: null })
      return
    }

    let cancelled = false
    let stream: MediaStream | null = null
    let landmarker: HandLandmarker | null = null
    let raf = 0
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true

    const stop = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      landmarker?.close()
      video.srcObject = null
      gesture.current = initialGestureState()
      gestureBus.emit({ type: 'lost' })
    }

    async function start() {
      setWebcam({ status: 'starting', hands: 0, error: null })
      if (!navigator.mediaDevices?.getUserMedia) {
        setWebcam({ status: 'unavailable', error: 'this browser has no camera API' })
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        })
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        if (!cancelled) setWebcam({ status: denied ? 'denied' : 'unavailable', error: denied ? null : messageOf(e) })
        return
      }
      if (cancelled) return stop()
      try {
        video.srcObject = stream
        await video.play()
        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM)
        try {
          landmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          })
        } catch {
          landmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numHands: 2,
          })
        }
      } catch (e) {
        if (!cancelled) setWebcam({ status: 'unavailable', error: `hand tracking failed to start: ${messageOf(e)}` })
        return stop()
      }
      if (cancelled) return stop()
      setWebcam({ status: 'on', hands: 0, error: null })

      let lastVideoTime = -1
      const tick = () => {
        if (cancelled || !landmarker) return
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime
          const result = landmarker.detectForVideo(video, performance.now())
          const { state, events } = stepGesture(gesture.current, result.landmarks)
          const handsChanged = state.hands !== gesture.current.hands
          gesture.current = state
          for (const e of events) gestureBus.emit(e)
          if (handsChanged) setWebcam({ hands: state.hands })
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    void start()
    return () => {
      cancelled = true
      stop()
    }
  }, [gesturesOn])
}
