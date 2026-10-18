import type { GestureEvent, HandPose, NdcPoint } from './bus'

export interface Landmark {
  x: number
  y: number
  z: number
}

const WRIST = 0
const INDEX_MCP = 5
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const PINKY_MCP = 17
const THUMB_TIP = 4
const FINGER_TIPS = [8, 12, 16, 20] as const
const FINGER_PIPS = [6, 10, 14, 18] as const
const ALL_TIPS = [4, 8, 12, 16, 20] as const

export const GESTURE_CONFIG = {
  /** Pinch turns on below this thumb–index / palm-size ratio... */
  pinchOn: 0.3,
  /** ...and off only above this one, so jitter between the two cannot flicker. */
  pinchOff: 0.45,
  /** EMA weight of the newest sample. */
  alpha: 0.5,
  /** |scale - 1| per frame below which two hands do not zoom. */
  zoomDeadzone: 0.003,
  /** A finger is extended when its tip is this many times further from the wrist than its PIP joint. */
  extendRatio: 1.15,
  /** Pointer motion per frame, in NDC, below which a held pinch does not drag. */
  dragDeadzone: 0.002,
  /** A pinch released within this many ms... */
  tapMaxMs: 300,
  /** ...having travelled no more than this many NDC units is a tap. */
  tapMaxTravel: 0.03,
  /** Consecutive frames an open hand or fist must be held before it explodes or closes. */
  poseFrames: 3,
  /** Openness (fingertip reach in palm sizes) mapped to explode 0... */
  openMin: 1.1,
  /** ...and to explode 1. */
  openMax: 1.9,
  /** Change in the explode amount below which an open hand sends no new value. */
  explodeDeadzone: 0.01,
}
export type GestureConfig = typeof GESTURE_CONFIG

export interface GestureState {
  hands: number
  pinched: boolean
  armed: boolean
  ratio: number | null
  pointer: NdcPoint | null
  spread: number | null
  /** Pose of the previous one-hand frame and how many frames in a row it has held. */
  pose: HandPose | null
  poseFrames: number
  /** Smoothed openness while the pose is 'open'. */
  openness: number | null
  pinchAt: number
  travel: number
  /** Last explode amount sent, null before the first. */
  lastExplode: number | null
}

export const initialGestureState = (): GestureState => ({
  hands: 0,
  pinched: false,
  armed: false,
  ratio: null,
  pointer: null,
  spread: null,
  pose: null,
  poseFrames: 0,
  openness: null,
  pinchAt: 0,
  travel: 0,
  lastExplode: null,
})

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
const ema = (prev: number | null, next: number, alpha: number) => (prev === null ? next : prev + alpha * (next - prev))
const emaPoint = (prev: NdcPoint | null, next: NdcPoint, alpha: number): NdcPoint =>
  prev === null ? next : [ema(prev[0], next[0], alpha), ema(prev[1], next[1], alpha)]
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Mirrored: the user sees themselves as in a mirror. */
export const toMirroredNdc = (l: Landmark): NdcPoint => [1 - 2 * l.x, 1 - 2 * l.y]
const midNdc = (a: Landmark, b: Landmark): NdcPoint => [1 - (a.x + b.x), 1 - (a.y + b.y)]

const palmSize = (h: Landmark[]) => dist(h[WRIST], h[MIDDLE_MCP])
const palmCentre = (h: Landmark[]): Landmark => ({
  x: (h[WRIST].x + h[INDEX_MCP].x + h[PINKY_MCP].x) / 3,
  y: (h[WRIST].y + h[INDEX_MCP].y + h[PINKY_MCP].y) / 3,
  z: 0,
})

/** Mean distance of the five fingertips from the palm centre, in palm sizes. */
export function openness(h: Landmark[]): number {
  const size = palmSize(h)
  if (size <= 0) return 0
  const c = palmCentre(h)
  return ALL_TIPS.reduce((sum, i) => sum + dist(h[i], c), 0) / ALL_TIPS.length / size
}

export function classifyPose(h: Landmark[], pinched: boolean, cfg: GestureConfig = GESTURE_CONFIG): HandPose {
  if (pinched) return 'pinch'
  const extended = FINGER_TIPS.map((tip, i) => dist(h[WRIST], h[tip]) > cfg.extendRatio * dist(h[WRIST], h[FINGER_PIPS[i]]))
  const count = extended.filter(Boolean).length
  if (count === 4) return 'open'
  if (count === 0) return 'fist'
  if (extended[0] && count === 1) return 'point'
  return 'other'
}

export function stepGesture(
  prev: GestureState,
  hands: Landmark[][],
  now: number,
  cfg: GestureConfig = GESTURE_CONFIG,
): { state: GestureState; events: GestureEvent[] } {
  const events: GestureEvent[] = []
  const n = hands.length
  if (n !== 1 && prev.hands === 1) events.push({ type: 'lost' })
  if (n === 0) return { state: initialGestureState(), events }

  if (n >= 2) {
    const [a, b] = hands.map((h) => midNdc(h[WRIST], h[MIDDLE_MCP]))
    const spread = ema(prev.spread, Math.hypot(a[0] - b[0], a[1] - b[1]), cfg.alpha)
    if (prev.spread !== null && prev.spread > 0) {
      const scale = spread / prev.spread
      if (Math.abs(scale - 1) > cfg.zoomDeadzone) events.push({ type: 'zoom', scale })
    }
    return { state: { ...initialGestureState(), hands: n, spread }, events }
  }

  const h = hands[0]
  const size = palmSize(h)
  const ratio = ema(prev.ratio, size > 0 ? dist(h[THUMB_TIP], h[INDEX_TIP]) / size : Infinity, cfg.alpha)
  const pointer = emaPoint(prev.pointer, toMirroredNdc(h[INDEX_TIP]), cfg.alpha)

  let pinched = prev.pinched
  let armed = prev.armed || ratio > cfg.pinchOff
  let pinchAt = prev.pinchAt
  let travel = prev.travel
  const pinchEvents: GestureEvent[] = []
  if (!pinched && armed && ratio < cfg.pinchOn) {
    pinched = true
    armed = false
    pinchAt = now
    travel = 0
    pinchEvents.push({ type: 'pinchStart', ndc: pointer })
  } else if (pinched && ratio > cfg.pinchOff) {
    pinched = false
    pinchEvents.push({ type: 'pinchEnd', ndc: pointer, tap: now - pinchAt <= cfg.tapMaxMs && travel <= cfg.tapMaxTravel })
  } else if (pinched && prev.pinched && prev.pointer) {
    const dx = pointer[0] - prev.pointer[0]
    const dy = pointer[1] - prev.pointer[1]
    const moved = Math.hypot(dx, dy)
    if (moved > cfg.dragDeadzone) {
      pinchEvents.push({ type: 'drag', dx, dy })
      travel += moved
    }
  }
  const pose = classifyPose(h, pinched, cfg)
  events.push({ type: 'hover', ndc: pointer, pose }, ...pinchEvents)

  // Open hand: the amount follows how far it is open. Fist: close. Anything else holds the amount.
  const frames = pose === prev.pose ? prev.poseFrames + 1 : 1
  let smoothed: number | null = null
  let lastExplode = prev.lastExplode
  if (pose === 'open') {
    smoothed = ema(prev.pose === 'open' ? prev.openness : null, openness(h), cfg.alpha)
    if (frames >= cfg.poseFrames) {
      const amount = clamp01((smoothed - cfg.openMin) / (cfg.openMax - cfg.openMin))
      if (lastExplode === null || Math.abs(amount - lastExplode) > cfg.explodeDeadzone) {
        events.push({ type: 'explode', amount })
        lastExplode = amount
      }
    }
  } else if (pose === 'fist' && frames === cfg.poseFrames) {
    events.push({ type: 'explode', amount: 0 })
    lastExplode = 0
  }

  return {
    state: { hands: 1, pinched, armed, ratio, pointer, spread: null, pose, poseFrames: frames, openness: smoothed, pinchAt, travel, lastExplode },
    events,
  }
}
