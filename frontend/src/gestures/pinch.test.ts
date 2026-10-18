import { describe, expect, it } from 'vitest'
import { makeHand } from '../test/hands'
import type { GestureEvent } from './bus'
import {
  GESTURE_CONFIG,
  type GestureState,
  type Landmark,
  classifyPose,
  initialGestureState,
  openness,
  stepGesture,
} from './pinch'

const FRAME_MS = 33

/** Runs frames through the reducer, `dt` ms apart. */
function run(frames: Landmark[][][], start: GestureState = initialGestureState(), cfg = GESTURE_CONFIG, dt = FRAME_MS) {
  let state = start
  const events: GestureEvent[][] = []
  const pinched: boolean[] = []
  frames.forEach((hands, i) => {
    const r = stepGesture(state, hands, i * dt, cfg)
    state = r.state
    events.push(r.events)
    pinched.push(state.pinched)
  })
  const all = events.flat()
  const of = <T extends GestureEvent['type']>(t: T) => all.filter((e): e is Extract<GestureEvent, { type: T }> => e.type === t)
  return { state, events, pinched, of }
}

const oneHand = (spec: Parameters<typeof makeHand>[0]) => [makeHand(spec)]
const flips = (xs: boolean[]) => xs.slice(1).filter((v, i) => v !== xs[i]).length
const sharp = { ...GESTURE_CONFIG, alpha: 1 }
const times = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v)

describe('classifyPose and openness', () => {
  it('reads open, point, fist and pinch from the finger layout', () => {
    expect(classifyPose(makeHand({ pose: 'open' }), false)).toBe('open')
    expect(classifyPose(makeHand({ pose: 'point' }), false)).toBe('point')
    expect(classifyPose(makeHand({ pose: 'fist' }), false)).toBe('fist')
    expect(classifyPose(makeHand({ pose: 'open', pinch: 0.1 }), true)).toBe('pinch')
  })

  it("calls a partly curled hand 'other'", () => {
    const h = makeHand({ pose: 'open' })
    h[12] = { ...h[10] } // middle finger folded onto its PIP
    expect(classifyPose(h, false)).toBe('other')
  })

  it('grows with how far the fingers are spread', () => {
    const o = (spread: number) => openness(makeHand({ spread }))
    expect(o(1.1)).toBeLessThan(o(1.5))
    expect(o(1.5)).toBeLessThan(o(1.9))
    expect(o(1.5)).toBeCloseTo(1.5, 1)
  })
})

describe('pinch hysteresis', () => {
  it('does not flicker on a jittery distance sequence and starts a pinch once', () => {
    const jitter = [0.22, 0.38, 0.22, 0.38, 0.22, 0.38, 0.24, 0.36, 0.22, 0.4, 0.25, 0.37]
    const ratios = [0.8, 0.8, 0.8, ...jitter, 0.8, 0.8, 0.8, 0.8]
    const r = run(ratios.map((pinch) => oneHand({ pinch })))

    expect(flips(r.pinched)).toBe(2)
    expect(r.pinched.at(-1)).toBe(false)
    expect(r.of('pinchStart')).toHaveLength(1)
    expect(r.of('pinchEnd')).toHaveLength(1)
  })

  it('pinches again on a second pinch', () => {
    const ratios = [0.8, 0.8, 0.1, 0.1, 0.1, 0.8, 0.8, 0.8, 0.1, 0.1, 0.1]
    expect(run(ratios.map((pinch) => oneHand({ pinch }))).of('pinchStart')).toHaveLength(2)
  })

  it('starts at the mirrored index fingertip in NDC', () => {
    const r = run([oneHand({ x: 0.3, y: 0.5, pinch: 1 }), oneHand({ x: 0.3, y: 0.5, pinch: 0.1 })], initialGestureState(), sharp)
    const [start] = r.of('pinchStart')
    const tip = makeHand({ x: 0.3, y: 0.5, pinch: 0.1 })[8]
    expect(start.ndc[0]).toBeCloseTo(1 - 2 * tip.x, 6)
    expect(start.ndc[1]).toBeCloseTo(1 - 2 * tip.y, 6)
  })
})

describe('hover', () => {
  it('is emitted on every one-hand frame with the pose, also while pinched', () => {
    const r = run([
      oneHand({ pose: 'point' }),
      oneHand({ pose: 'fist' }),
      oneHand({ pose: 'open', pinch: 1 }),
      oneHand({ pose: 'open', pinch: 0.1 }),
      oneHand({ pose: 'open', pinch: 0.1 }),
    ], initialGestureState(), sharp)
    expect(r.of('hover').map((e) => e.pose)).toEqual(['point', 'fist', 'open', 'pinch', 'pinch'])
  })

  it('follows the mirrored index fingertip', () => {
    const r = run([oneHand({ x: 0.6, pose: 'point' })], initialGestureState(), sharp)
    const tip = makeHand({ x: 0.6, pose: 'point' })[8]
    const [hover] = r.of('hover')
    expect(hover.ndc[0]).toBeCloseTo(1 - 2 * tip.x, 6)
    expect(hover.ndc[1]).toBeCloseTo(1 - 2 * tip.y, 6)
  })
})

describe('pinch tap and drag', () => {
  const still = (n: number) => times(n, oneHand({ pinch: 0.1 }))
  const open = oneHand({ pinch: 1 })

  it('a pinch held still and released fast is one tap and never drags', () => {
    const r = run([open, ...still(2), open], initialGestureState(), sharp)
    expect(r.of('pinchEnd')).toHaveLength(1)
    expect(r.of('pinchEnd')[0].tap).toBe(true)
    expect(r.of('drag')).toHaveLength(0)
  })

  it('a pinch moved 0.1 NDC drags by about that much and is not a tap', () => {
    // 0.05 of image width is 0.1 NDC; x grows to the right in the image, so NDC x falls.
    const moved = [0.5, 0.52, 0.54, 0.56, 0.58, 0.6].map((x) => oneHand({ x, pinch: 0.1 }))
    const r = run([oneHand({ x: 0.5, pinch: 1 }), ...moved, oneHand({ x: 0.6, pinch: 1 })], initialGestureState(), sharp)
    const drags = r.of('drag')
    expect(drags.length).toBeGreaterThan(0)
    expect(drags.reduce((sum, e) => sum + e.dx, 0)).toBeCloseTo(-0.2, 6)
    expect(drags.reduce((sum, e) => sum + e.dy, 0)).toBeCloseTo(0, 6)
    expect(r.of('pinchEnd')[0].tap).toBe(false)
  })

  it('a pinch held longer than 300 ms is not a tap', () => {
    const r = run([open, ...still(12), open], initialGestureState(), sharp)
    expect(r.of('pinchEnd')[0].tap).toBe(false)
  })

  it('ignores motion below the drag deadzone', () => {
    const tiny = GESTURE_CONFIG.dragDeadzone / 8 // in image width; NDC is twice that
    const r = run([open, ...[0, 1, 2, 3].map((i) => oneHand({ x: 0.5 + i * tiny, pinch: 0.1 }))], initialGestureState(), sharp)
    expect(r.of('drag')).toHaveLength(0)
  })

  it('counts the movement on the release frame: a jump while letting go is not a tap', () => {
    const r = run([oneHand({ x: 0.5, pinch: 1 }), ...times(2, oneHand({ x: 0.5, pinch: 0.1 })), oneHand({ x: 0.7, pinch: 1 })], initialGestureState(), sharp)
    expect(r.of('pinchEnd')[0].tap).toBe(false)
  })

  it('adds up sub-deadzone motion: slow creep past the tap travel is not a tap', () => {
    const step = (GESTURE_CONFIG.dragDeadzone * 0.95) / 2 // image width; NDC is twice that
    const creep = Array.from({ length: 20 }, (_, i) => oneHand({ x: 0.5 + i * step, pinch: 0.1 }))
    const r = run([oneHand({ x: 0.5, pinch: 1 }), ...creep, oneHand({ x: 0.5 + 20 * step, pinch: 1 })], initialGestureState(), sharp, 5)
    expect(r.of('drag')).toHaveLength(0)
    expect(r.of('pinchEnd')[0].tap).toBe(false)
  })

  it('does not drag on the frame the pinch starts', () => {
    const r = run([oneHand({ x: 0.3, pinch: 1 }), oneHand({ x: 0.7, pinch: 0.1 })], initialGestureState(), sharp)
    expect(r.of('pinchStart')).toHaveLength(1)
    expect(r.of('drag')).toHaveLength(0)
  })
})

describe('open hand explode', () => {
  const open = (spread: number, n = 3) => times(n, oneHand({ pose: 'open', spread }))

  it('maps how far the hand is open to an absolute amount', () => {
    expect(run(open(1.9)).of('explode').at(-1)?.amount).toBeCloseTo(1, 1)
    expect(run(open(1.1)).of('explode').at(-1)?.amount).toBeCloseTo(0, 1)
    expect(run(open(1.5)).of('explode').at(-1)?.amount).toBeCloseTo(0.5, 1)
  })

  it('waits for three open frames', () => {
    expect(run(open(1.9, 2)).of('explode')).toHaveLength(0)
    expect(run(open(1.9, 3)).of('explode')).toHaveLength(1)
  })

  it('follows the hand as it opens further, and stays quiet within the deadzone', () => {
    const r = run([...open(1.3), ...open(1.7, 2), ...open(1.7, 3)], initialGestureState(), sharp)
    const amounts = r.of('explode').map((e) => e.amount)
    expect(amounts.at(-1)).toBeCloseTo(0.75, 1)
    expect(new Set(amounts.map((a) => a.toFixed(3))).size).toBe(amounts.length)
  })

  it('re-asserts the amount each time an open pose is newly confirmed, even at the same openness', () => {
    const r = run([...open(1.5), ...times(3, oneHand({ pose: 'point' })), ...open(1.5)])
    expect(r.of('explode')).toHaveLength(2)
  })

  it('holds the amount when the hand switches to a point', () => {
    const r = run([...open(1.9), ...times(6, oneHand({ pose: 'point' }))])
    expect(r.of('explode')).toHaveLength(1)
  })

  it('a fist for three frames closes once, and staying in the fist adds nothing', () => {
    const fist = times(8, oneHand({ pose: 'fist' }))
    const r = run([...open(1.9), ...fist])
    expect(r.of('explode').map((e) => e.amount.toFixed(1))).toEqual(['1.0', '0.0'])
    expect(run(fist.slice(0, 2)).of('explode')).toHaveLength(0)
  })

  it('a pinch emits no explode', () => {
    const r = run([oneHand({ pinch: 1 }), ...times(6, oneHand({ pinch: 0.1 }))], initialGestureState(), sharp)
    expect(r.of('explode')).toHaveLength(0)
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
  })

  it('emits no hover, drag or explode', () => {
    const pair = [makeHand({ x: 0.3 }), makeHand({ x: 0.7 })]
    const r = run(times(6, pair))
    expect(r.of('hover')).toHaveLength(0)
    expect(r.of('drag')).toHaveLength(0)
    expect(r.of('explode')).toHaveLength(0)
  })
})

describe('tracking changes', () => {
  const open = oneHand({ pinch: 1 })
  const pinch = oneHand({ pinch: 0.1 })

  it('does not start a pinch again after a dropout while still pinched', () => {
    const r = run([open, pinch, pinch, [], pinch, pinch], initialGestureState(), sharp)
    expect(r.of('pinchStart')).toHaveLength(1)
    expect(r.of('pinchEnd')).toHaveLength(0)
  })

  it('does not start a pinch again after two hands while still pinched', () => {
    const pair = [makeHand({ x: 0.3 }), makeHand({ x: 0.7 })]
    const r = run([open, pinch, pair, pinch], initialGestureState(), sharp)
    expect(r.of('pinchStart')).toHaveLength(1)
  })

  it('does not pinch with a hand that appears already pinched', () => {
    expect(run(times(3, pinch)).of('pinchStart')).toHaveLength(0)
  })

  it('emits lost once when the hand disappears and resets the state', () => {
    const r = run([oneHand({}), oneHand({}), [], []])
    expect(r.of('lost')).toHaveLength(1)
    expect(r.state).toEqual(initialGestureState())
  })

  it('does not drag when coming back to one hand', () => {
    const r = run([oneHand({ x: 0.7 }), [makeHand({ x: 0.3 }), makeHand({ x: 0.7 })], oneHand({ x: 0.3 })])
    expect(r.of('lost')).toHaveLength(1)
    expect(r.events[2].some((e) => e.type === 'drag')).toBe(false)
  })
})
