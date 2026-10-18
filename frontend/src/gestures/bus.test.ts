import { describe, expect, it } from 'vitest'
import { createBus } from './bus'

describe('createBus', () => {
  it('delivers events to subscribers until they unsubscribe', () => {
    const bus = createBus<number>()
    const seen: number[] = []
    const off = bus.on((n) => seen.push(n))
    bus.emit(1)
    off()
    bus.emit(2)
    expect(seen).toEqual([1])
  })
})
