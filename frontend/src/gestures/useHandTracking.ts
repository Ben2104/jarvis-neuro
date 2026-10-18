import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { useEffect } from 'react'
import { useViewer, viewerStore } from '../state/store'
import { type HandSessionEnv, type Landmarker, startHandSession } from './handSession'

export const MEDIAPIPE_WASM = '/mediapipe/wasm'
export const HAND_MODEL = '/mediapipe/hand_landmarker.task'

async function createLandmarker(): Promise<Landmarker> {
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM)
  const options = (delegate: 'GPU' | 'CPU') =>
    ({ baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2 }) as const
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    return await HandLandmarker.createFromOptions(fileset, options('CPU'))
  }
}

function browserEnv(): HandSessionEnv {
  return {
    getUserMedia: navigator.mediaDevices?.getUserMedia
      ? (c) => navigator.mediaDevices.getUserMedia(c)
      : null,
    createVideo() {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      return video
    },
    createLandmarker,
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
  }
}

/** Webcam + MediaPipe loop, active only while gesture mode is on. */
export function useHandTracking(): void {
  const gesturesOn = useViewer((s) => s.gesturesOn)

  useEffect(() => {
    if (!gesturesOn) {
      viewerStore.getState().setWebcam({ status: 'off', hands: 0, error: null })
      return
    }
    return startHandSession(viewerStore, browserEnv())
  }, [gesturesOn])
}
