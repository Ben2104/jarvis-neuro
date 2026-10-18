import { describe, expect, it } from 'vitest'
import { ROTATE_GAIN, dragToRotate, onPinchEnd, onPinchStart } from './grab'

describe('grab', () => {
  it('an off-brain pinch never rotates', () => {
    expect(dragToRotate(onPinchStart(false), 0.1, 0.05)).toBeNull()
  })

  it('an on-brain pinch turns a drag into a camera rotation', () => {
    const r = dragToRotate(onPinchStart(true), 0.1, 0.05)!
    expect(r[0]).toBeCloseTo(-0.1 * Math.PI, 12)
    expect(r[1]).toBeCloseTo(0.05 * Math.PI, 12)
    expect(ROTATE_GAIN).toBe(Math.PI)
  })

  it('stops rotating after the pinch ends', () => {
    expect(dragToRotate(onPinchEnd(), 0.1, 0.05)).toBeNull()
  })
})
