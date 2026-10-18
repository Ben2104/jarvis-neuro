import type { ViewerStore } from '../state/store'
import { gestureBus } from './bus'
import { type GestureState, type Landmark, initialGestureState, stepGesture } from './pinch'
import { clearWebcamFeed, setWebcamFeed } from './webcamStream'

/** The slice of MediaPipe's HandLandmarker the session uses. */
export interface Landmarker {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks: Landmark[][] }
  close(): void
}

/** Everything a session touches outside the viewer store, so tests can supply fakes. */
export interface HandSessionEnv {
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null
  createVideo(): HTMLVideoElement
  createLandmarker(): Promise<Landmarker>
  requestFrame(cb: () => void): number
  cancelFrame(id: number): void
  now(): number
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One webcam + hand-tracking run. Returns its cancel function. Every exit (cancel, camera ended, detector
 * failure, startup failure) goes through one idempotent release that stops this session's own resources
 * only; the failure paths set the webcam status first and release leaves it alone.
 */
export function startHandSession(store: ViewerStore, env: HandSessionEnv): () => void {
  const { setWebcam } = store.getState()
  let released = false
  let live = false
  let stream: MediaStream | null = null
  let track: MediaStreamTrack | undefined
  let landmarker: Landmarker | null = null
  let raf = 0
  // Spec §6 fix 1: per-frame gesture state is plain session state, never React state.
  let gesture: GestureState = initialGestureState()
  const video = env.createVideo()

  const onEnded = () => fail('unavailable', 'camera stopped')

  function release() {
    if (released) return
    released = true
    env.cancelFrame(raf)
    track?.removeEventListener('ended', onEnded)
    stream?.getTracks().forEach((t) => t.stop())
    try {
      landmarker?.close()
    } catch {
      // The detector is already broken; the camera is what must be released.
    }
    video.srcObject = null
    if (stream) clearWebcamFeed(stream)
    if (live) gestureBus.emit({ type: 'lost' })
  }

  function fail(status: 'unavailable', error: string) {
    if (released) return
    setWebcam({ status, hands: 0, error })
    release()
  }

  async function start() {
    setWebcam({ status: 'starting', hands: 0, error: null })
    if (!env.getUserMedia) {
      fail('unavailable', 'this browser has no camera API')
      return
    }
    let media: MediaStream
    try {
      media = await env.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
    } catch (e) {
      if (released) return
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setWebcam({ status: denied ? 'denied' : 'unavailable', hands: 0, error: denied ? null : messageOf(e) })
      released = true
      return
    }
    if (released) {
      // Cancelled while the prompt was open: this stream belongs to no one.
      media.getTracks().forEach((t) => t.stop())
      return
    }
    stream = media
    track = media.getVideoTracks()[0]
    track?.addEventListener('ended', onEnded)

    let lm: Landmarker | null = null
    try {
      video.srcObject = media
      await video.play()
      if (released) return
      setWebcamFeed({ stream: media, width: video.videoWidth, height: video.videoHeight })
      lm = await env.createLandmarker()
    } catch (e) {
      fail('unavailable', `hand tracking failed to start: ${messageOf(e)}`)
      return
    }
    if (released) {
      lm.close()
      return
    }
    landmarker = lm
    live = true
    setWebcam({ status: 'on', hands: 0, error: null })

    let lastVideoTime = -1
    const tick = () => {
      if (released || !landmarker) return
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime
        let result: ReturnType<Landmarker['detectForVideo']>
        try {
          result = landmarker.detectForVideo(video, env.now())
        } catch (e) {
          fail('unavailable', `hand tracking stopped: ${messageOf(e)}`)
          return
        }
        const { state, events } = stepGesture(gesture, result.landmarks)
        const handsChanged = state.hands !== gesture.hands
        gesture = state
        for (const e of events) gestureBus.emit(e)
        if (handsChanged) setWebcam({ hands: state.hands })
      }
      raf = env.requestFrame(tick)
    }
    raf = env.requestFrame(tick)
  }

  void start()
  return release
}
