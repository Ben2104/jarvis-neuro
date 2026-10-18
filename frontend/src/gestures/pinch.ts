import type { GestureEvent, NdcPoint } from './bus'

export interface Landmark {
  x: number
  y: number
  z: number
}

const WRIST = 0
const THUMB_TIP = 4
const INDEX_TIP = 8
const MIDDLE_MCP = 9

export const GESTURE_CONFIG = {
  /** Pinch turns on below this thumb–index / palm-size ratio... */
  pinchOn: 0.3,
  /** ...and off only above this one, so jitter between the two cannot flicker. */
  pinchOff: 0.45,
  /** EMA weight of the newest sample. */
  alpha: 0.5,
  /** Palm-centre motion per frame, in NDC, below which an open hand does not rotate. */
  rotateDeadzone: 0.002,
  /** |scale - 1| per frame below which two hands do not zoom. */
  zoomDeadzone: 0.003,
}
export type GestureConfig = typeof GESTURE_CONFIG

export interface GestureState {
  hands: number
  pinched: boolean
  ratio: number | null
  pointer: NdcPoint | null
  palm: NdcPoint | null
  spread: number | null
}

export const initialGestureState = (): GestureState => ({
  hands: 0,
  pinched: false,
  ratio: null,
  pointer: null,
  palm: null,
  spread: null,
})

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
const ema = (prev: number | null, next: number, alpha: number) => (prev === null ? next : prev + alpha * (next - prev))
const emaPoint = (prev: NdcPoint | null, next: NdcPoint, alpha: number): NdcPoint =>
  prev === null ? next : [ema(prev[0], next[0], alpha), ema(prev[1], next[1], alpha)]
/** Mirrored: the user sees themselves as in a mirror. */
const toNdc = (a: Landmark, b: Landmark): NdcPoint => [1 - (a.x + b.x), 1 - (a.y + b.y)]

export function stepGesture(
  prev: GestureState,
  hands: Landmark[][],
  cfg: GestureConfig = GESTURE_CONFIG,
): { state: GestureState; events: GestureEvent[] } {
  const events: GestureEvent[] = []
  const n = hands.length
  if (n !== 1 && prev.hands === 1) events.push({ type: 'lost' })
  if (n === 0) return { state: initialGestureState(), events }

  if (n >= 2) {
    const [a, b] = hands.map((h) => toNdc(h[WRIST], h[MIDDLE_MCP]))
    const spread = ema(prev.spread, Math.hypot(a[0] - b[0], a[1] - b[1]), cfg.alpha)
    if (prev.spread !== null && prev.spread > 0) {
      const scale = spread / prev.spread
      if (Math.abs(scale - 1) > cfg.zoomDeadzone) events.push({ type: 'zoom', scale })
    }
    return { state: { ...initialGestureState(), hands: n, spread }, events }
  }

  const h = hands[0]
  const size = dist(h[WRIST], h[MIDDLE_MCP])
  const ratio = ema(prev.ratio, size > 0 ? dist(h[THUMB_TIP], h[INDEX_TIP]) / size : Infinity, cfg.alpha)
  const pointer = emaPoint(prev.pointer, toNdc(h[THUMB_TIP], h[INDEX_TIP]), cfg.alpha)
  const palm = emaPoint(prev.palm, toNdc(h[WRIST], h[MIDDLE_MCP]), cfg.alpha)

  let pinched = prev.pinched
  if (!pinched && ratio < cfg.pinchOn) {
    pinched = true
    events.push({ type: 'select', ndc: pointer })
  } else if (pinched && ratio > cfg.pinchOff) {
    pinched = false
  }

  if (!pinched) {
    events.push({ type: 'hover', ndc: pointer })
    if (prev.hands === 1 && prev.palm) {
      const dx = palm[0] - prev.palm[0]
      const dy = palm[1] - prev.palm[1]
      if (Math.hypot(dx, dy) > cfg.rotateDeadzone) events.push({ type: 'rotate', dx, dy })
    }
  }

  return { state: { hands: 1, pinched, ratio, pointer, palm, spread: null }, events }
}
