import { vi } from 'vitest'
import type { HandSessionEnv, Landmarker } from '../gestures/handSession'

export function fakeTrack() {
  const listeners = new Set<() => void>()
  return {
    stop: vi.fn(),
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    end: () => [...listeners].forEach((fn) => fn()),
    listeners,
  }
}
export type FakeTrack = ReturnType<typeof fakeTrack>

export function fakeStream() {
  const track = fakeTrack()
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { stream, track }
}

export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export const fakeLandmarker = (detect: Landmarker['detectForVideo'] = () => ({ landmarks: [] })) => ({
  detectForVideo: vi.fn(detect),
  close: vi.fn(),
})

/** A manual frame scheduler so tests drive the tracking loop one tick at a time. */
export function fakeEnv(over: Partial<HandSessionEnv> = {}) {
  let next: (() => void) | null = null
  const video = { muted: true, playsInline: true, srcObject: null, currentTime: 0, videoWidth: 640, videoHeight: 480, play: vi.fn(async () => {}) }
  const env: HandSessionEnv = {
    getUserMedia: async () => fakeStream().stream,
    createVideo: () => video as unknown as HTMLVideoElement,
    createLandmarker: async () => fakeLandmarker(),
    requestFrame: (cb) => {
      next = cb
      return 1
    },
    cancelFrame: () => {
      next = null
    },
    now: () => 0,
    ...over,
  }
  return {
    env,
    video,
    /** Advance the video clock and run the pending frame callback, if any. */
    frame: () => {
      video.currentTime += 1
      const cb = next
      next = null
      cb?.()
    },
    hasFrame: () => next !== null,
  }
}

/** Let pending promise continuations run. */
export const settle = () => new Promise<void>((r) => setTimeout(r, 0))
