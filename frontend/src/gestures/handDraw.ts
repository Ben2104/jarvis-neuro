import type { NdcPoint } from './bus'

export { toMirroredNdc } from './pinch'

/** The 21 bones of the MediaPipe hand topology, as landmark index pairs. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

/** Landmarks and bones of every hand as canvas pixels. `map` runs first (it crops NDC to the visible view). */
export function handSegments(
  hands: NdcPoint[][],
  map: (p: NdcPoint) => NdcPoint,
  w: number,
  h: number,
): { points: [number, number][]; lines: [[number, number], [number, number]][] } {
  const points: [number, number][] = []
  const lines: [[number, number], [number, number]][] = []
  for (const hand of hands) {
    const px = hand.map((p): [number, number] => {
      const [x, y] = map(p)
      return [((x + 1) / 2) * w, ((1 - y) / 2) * h]
    })
    points.push(...px)
    for (const [a, b] of HAND_CONNECTIONS) lines.push([px[a], px[b]])
  }
  return { points, lines }
}
