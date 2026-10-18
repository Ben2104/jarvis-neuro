/** Normalised device coordinates: x right, y up, both in -1..1. */
export type NdcPoint = [number, number]

export type HandPose = 'open' | 'point' | 'fist' | 'pinch' | 'other'

export type GestureEvent =
  | { type: 'hover'; ndc: NdcPoint; pose: HandPose }
  | { type: 'pinchStart'; ndc: NdcPoint }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'pinchEnd'; ndc: NdcPoint; tap: boolean }
  | { type: 'explode'; amount: number } // absolute, 0..1
  | { type: 'zoom'; scale: number }
  | { type: 'landmarks'; hands: NdcPoint[][] } // mirrored NDC over the camera frame, 21 per hand
  | { type: 'lost' }

export function createBus<E>() {
  const listeners = new Set<(e: E) => void>()
  return {
    on(fn: (e: E) => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    emit(e: E): void {
      for (const fn of listeners) fn(e)
    },
  }
}

/** Per-frame gesture events. Never mirrored into React state. */
export const gestureBus = createBus<GestureEvent>()
