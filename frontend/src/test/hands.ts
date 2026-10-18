import type { Landmark } from '../gestures/pinch'

/**
 * 21 synthetic MediaPipe hand landmarks in image coordinates (x right, y down, 0..1).
 * Only the landmarks the reducer reads are placed; the rest sit at the palm centre.
 */
export function makeHand({ x = 0.5, y = 0.5, palm = 0.2, pinch = 1 }: { x?: number; y?: number; palm?: number; pinch?: number } = {}): Landmark[] {
  const at = (px: number, py: number): Landmark => ({ x: px, y: py, z: 0 })
  const hand = Array.from({ length: 21 }, () => at(x, y))
  const gap = pinch * palm
  const tipY = y - 0.9 * palm
  hand[0] = at(x, y + palm / 2) // wrist
  hand[9] = at(x, y - palm / 2) // middle-finger MCP
  hand[4] = at(x - gap / 2, tipY) // thumb tip
  hand[8] = at(x + gap / 2, tipY) // index tip
  return hand
}
