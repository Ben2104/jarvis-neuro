import { describe, expect, it } from 'vitest'
import { makeHand } from '../test/hands'
import type { GestureEvent } from './bus'
import { GESTURE_CONFIG, type GestureState, type Landmark, initialGestureState, stepGesture } from './pinch'

function run(frames: Landmark[][][], start: GestureState = initialGestureState(), cfg = GESTURE_CONFIG) {
  let state = start
  const events: GestureEvent[][] = []
  const pinched: boolean[] = []
  for (const hands of frames) {
    const r = stepGesture(state, hands, cfg)
    state = r.state
    events.push(r.events)
    pinched.push(state.pinched)
  }
  const all = events.flat()
  const of = <T extends GestureEvent['type']>(t: T) => all.filter((e): e is Extract<GestureEvent, { type: T }> => e.type === t)
  return { state, events, pinched, of }
}

const oneHand = (spec: Parameters<typeof makeHand>[0]) => [makeHand(spec)]
const flips = (xs: boolean[]) => xs.slice(1).filter((v, i) => v !== xs[i]).length

describe('pinch hysteresis', () => {
  it('does not flicker on a jittery distance sequence and selects once', () => {
    const jitter = [0.22, 0.38, 0.22, 0.38, 0.22, 0.38, 0.24, 0.36, 0.22, 0.4, 0.25, 0.37]
    const ratios = [0.8, 0.8, 0.8, ...jitter, 0.8, 0.8, 0.8, 0.8]
    const r = run(ratios.map((pinch) => oneHand({ pinch })))

    expect(flips(r.pinched)).toBe(2)
    expect(r.pinched.at(-1)).toBe(false)
    expect(r.of('select')).toHaveLength(1)
  })

  it('selects again on a second pinch', () => {
    const ratios = [0.8, 0.8, 0.1, 0.1, 0.1, 0.8, 0.8, 0.8, 0.1, 0.1, 0.1]
    expect(run(ratios.map((pinch) => oneHand({ pinch }))).of('select')).toHaveLength(2)
  })

  it('a held pinch fires one select and no hover or rotate', () => {
    const r = run([
      oneHand({ pinch: 1, x: 0.5 }),
      ...[0.1, 0.1, 0.1, 0.1, 0.1].map((pinch, i) => oneHand({ pinch, x: 0.5 - i * 0.02 })),
    ], initialGestureState(), { ...GESTURE_CONFIG, alpha: 1 })
    expect(r.of('select')).toHaveLength(1)
    expect(r.events.slice(1).flat().filter((e) => e.type === 'hover')).toHaveLength(0)
    expect(r.of('rotate')).toHaveLength(0)
  })

  it('selects at the mirrored pinch point in NDC', () => {
    const r = run([
      oneHand({ x: 0.3, y: 0.5, pinch: 1 }),
      oneHand({ x: 0.3, y: 0.5, pinch: 0.1 }),
    ], initialGestureState(), { ...GESTURE_CONFIG, alpha: 1 })
    const [sel] = r.of('select')
    expect(sel.ndc[0]).toBeCloseTo(0.4, 6)
    expect(sel.ndc[1]).toBeCloseTo(0.36, 6)
  })
})

describe('open hand', () => {
  it('hovers at the pointer and rotates with palm motion', () => {
    // Raw image x decreasing = the hand moving to the user's right in a mirrored view.
    const r = run([0.6, 0.58, 0.56, 0.54].map((x) => oneHand({ x })))
    expect(r.of('hover')).toHaveLength(4)
    const rotates = r.of('rotate')
    expect(rotates).toHaveLength(3)
    expect(rotates.every((e) => e.dx > 0 && Math.abs(e.dy) < 1e-9)).toBe(true)
  })

  it('does not rotate while the hand is still', () => {
    expect(run([0, 0, 0, 0].map(() => oneHand({}))).of('rotate')).toHaveLength(0)
  })
})

describe('two hands', () => {
  it('zooms in as the hands move apart and out as they close', () => {
    const pair = (gap: number) => [makeHand({ x: 0.5 - gap / 2 }), makeHand({ x: 0.5 + gap / 2 })]
    const apart = run([0.2, 0.3, 0.4].map(pair))
    expect(apart.of('zoom').length).toBeGreaterThan(0)
    expect(apart.of('zoom').every((e) => e.scale > 1)).toBe(true)
    const closer = run([0.4, 0.3, 0.2].map(pair))
    expect(closer.of('zoom').every((e) => e.scale < 1)).toBe(true)
    expect(apart.of('rotate')).toHaveLength(0)
  })
})

describe('tracking changes', () => {
  it('does not select again after a dropout while still pinched', () => {
    const open = oneHand({ pinch: 1 })
    const pinch = oneHand({ pinch: 0.1 })
    const r = run([open, pinch, pinch, [], pinch, pinch], initialGestureState(), { ...GESTURE_CONFIG, alpha: 1 })
    expect(r.of('select')).toHaveLength(1)
  })

  it('does not select again after two hands while still pinched', () => {
    const open = oneHand({ pinch: 1 })
    const pinch = oneHand({ pinch: 0.1 })
    const pair = [makeHand({ x: 0.3 }), makeHand({ x: 0.7 })]
    const r = run([open, pinch, pair, pinch], initialGestureState(), { ...GESTURE_CONFIG, alpha: 1 })
    expect(r.of('select')).toHaveLength(1)
  })

  it('does not select a hand that appears already pinched', () => {
    const r = run([0.1, 0.1, 0.1].map((pinch) => oneHand({ pinch })))
    expect(r.of('select')).toHaveLength(0)
  })

  it('emits lost once when the hand disappears and resets the state', () => {
    const r = run([oneHand({}), oneHand({}), [], []])
    expect(r.of('lost')).toHaveLength(1)
    expect(r.state).toEqual(initialGestureState())
  })

  it('does not jump-rotate when coming back to one hand', () => {
    const r = run([oneHand({ x: 0.7 }), [makeHand({ x: 0.3 }), makeHand({ x: 0.7 })], oneHand({ x: 0.3 })])
    expect(r.of('lost')).toHaveLength(1)
    expect(r.events[2].some((e) => e.type === 'rotate')).toBe(false)
  })
})
