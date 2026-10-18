import { describe, expect, it } from 'vitest'
import type { NdcPoint } from './bus'
import { HAND_CONNECTIONS, handSegments, toMirroredNdc } from './handDraw'

const hand = (): NdcPoint[] => Array.from({ length: 21 }, (_, i) => [i / 20 - 0.5, 0.5 - i / 40] as NdcPoint)

describe('toMirroredNdc', () => {
  it('flips x and y into mirrored NDC', () => {
    expect(toMirroredNdc({ x: 0, y: 0, z: 0 })).toEqual([1, 1])
    expect(toMirroredNdc({ x: 1, y: 1, z: 0 })).toEqual([-1, -1])
    expect(toMirroredNdc({ x: 0.5, y: 0.5, z: 0 })).toEqual([0, 0])
  })
})

describe('HAND_CONNECTIONS', () => {
  it('lists the 21 MediaPipe bones over landmarks 0..20', () => {
    expect(HAND_CONNECTIONS).toHaveLength(21)
    expect(HAND_CONNECTIONS.flat().every((i) => i >= 0 && i <= 20)).toBe(true)
  })
})

describe('handSegments', () => {
  const identity = (p: NdcPoint) => p

  it('gives 21 points and 21 lines per hand', () => {
    const s = handSegments([hand()], identity, 200, 100)
    expect(s.points).toHaveLength(21)
    expect(s.lines).toHaveLength(21)
    expect(handSegments([hand(), hand()], identity, 200, 100).points).toHaveLength(42)
    expect(handSegments([], identity, 200, 100)).toEqual({ points: [], lines: [] })
  })

  it('maps NDC corners to pixel corners', () => {
    const h = hand()
    h[0] = [-1, 1]
    h[1] = [1, -1]
    const s = handSegments([h], identity, 200, 100)
    expect(s.points[0]).toEqual([0, 0])
    expect(s.points[1]).toEqual([200, 100])
    // Landmarks 0 and 1 are joined by a bone, so that line runs corner to corner.
    expect(s.lines).toContainEqual([[0, 0], [200, 100]])
  })

  it('applies map before the pixel transform', () => {
    const h = hand()
    h[0] = [0, 0]
    const s = handSegments([h], ([x, y]) => [x + 1, y - 1], 200, 100)
    expect(s.points[0]).toEqual([200, 100])
  })
})
