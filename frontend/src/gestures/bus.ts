/** Normalised device coordinates: x right, y up, both in -1..1. */
export type NdcPoint = [number, number]

export type GestureEvent =
  | { type: 'hover'; ndc: NdcPoint }
  | { type: 'select'; ndc: NdcPoint }
  | { type: 'rotate'; dx: number; dy: number }
  | { type: 'zoom'; scale: number }
  | { type: 'explode'; delta: number }
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
