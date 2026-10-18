import type { Landmark } from '../gestures/pinch'

export interface HandSpec {
  x?: number
  y?: number
  /** Wrist to middle-finger MCP distance, in image units. */
  palm?: number
  /** Thumb–index gap in palm sizes. Left out, the thumb sits where the pose puts it. */
  pinch?: number
  pose?: 'open' | 'point' | 'fist'
  /** Fingertip distance from the palm centre in palm sizes (mean over the five tips), for the open pose. */
  spread?: number
}

/** Finger fan: unit-ish directions of the five tips from the palm centre, image coordinates (y down). */
const FAN: [number, number][] = [
  [-0.71, -0.71], // thumb
  [-0.29, -0.96], // index
  [0, -1], // middle
  [0.2, -0.98], // ring
  [0.35, -0.94], // pinky
]
/** [MCP, PIP, tip] landmark indices for thumb (tip only), index, middle, ring, pinky. */
const FINGERS = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
] as const
const FINGER_DX = [-0.3, 0, 0.15, 0.3]
const FINGER_DY = [-0.4, -0.5, -0.45, -0.4]

/**
 * 21 synthetic MediaPipe hand landmarks in image coordinates (x right, y down, 0..1), fingers pointing up.
 * Only the landmarks the reducer reads are placed; the rest sit at (x, y).
 * `pose` curls the fingers it does not extend; `spread` sets how far the open fingertips reach.
 */
export function makeHand({ x = 0.5, y = 0.5, palm = 0.2, pinch, pose = 'open', spread = 1.5 }: HandSpec = {}): Landmark[] {
  const at = (px: number, py: number): Landmark => ({ x: px, y: py, z: 0 })
  const hand = Array.from({ length: 21 }, () => at(x, y))
  hand[0] = at(x, y + palm / 2)
  for (const [i, [mcp, pip]] of FINGERS.entries()) {
    hand[mcp] = at(x + FINGER_DX[i] * palm, y + FINGER_DY[i] * palm)
    hand[pip] = at(x + FINGER_DX[i] * palm, y + (FINGER_DY[i] - 0.3) * palm)
  }
  const cx = (hand[0].x + hand[5].x + hand[17].x) / 3
  const cy = (hand[0].y + hand[5].y + hand[17].y) / 3
  const extended = pose === 'open' ? [true, true, true, true, true] : pose === 'point' ? [false, true, false, false, false] : [false, false, false, false, false]
  const tips = [4, 8, 12, 16, 20]
  tips.forEach((tip, i) => {
    if (extended[i]) {
      hand[tip] = at(cx + FAN[i][0] * spread * palm, cy + FAN[i][1] * spread * palm)
    } else if (i === 0) {
      hand[tip] = at(x, y + 0.2 * palm) // thumb tucked across the palm
    } else {
      const mcp = hand[FINGERS[i - 1][0]]
      hand[tip] = at(mcp.x, mcp.y + 0.1 * palm) // finger curled back onto its knuckle
    }
  })
  if (pinch !== undefined) hand[4] = at(hand[8].x - pinch * palm, hand[8].y)
  return hand
}
