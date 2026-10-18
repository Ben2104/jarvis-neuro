import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { type GestureEvent, type NdcPoint, createBus } from './bus'
import { HandOverlay, attachHandOverlay } from './HandOverlay'

const hand = (): NdcPoint[] => Array.from({ length: 21 }, (_, i) => [i / 20 - 0.5, 0.5 - i / 40] as NdcPoint)

function setup(ratio = 2) {
  const calls: string[] = []
  const ctx = {
    clearRect: vi.fn(() => calls.push('clear')),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
  }
  const canvas = { width: 0, height: 0, clientWidth: 200, clientHeight: 100, getContext: () => ctx }
  const bus = createBus<GestureEvent>()
  const off = attachHandOverlay(canvas, { bus, ratio: () => ratio, accent: '#123456' })
  return { ctx, canvas, bus, off }
}

describe('attachHandOverlay', () => {
  it('draws 21 bones and 21 points per hand when landmarks arrive', () => {
    const { ctx, bus } = setup()
    bus.emit({ type: 'landmarks', hands: [hand()] })
    expect(ctx.moveTo).toHaveBeenCalledTimes(21)
    expect(ctx.lineTo).toHaveBeenCalledTimes(21)
    expect(ctx.arc).toHaveBeenCalledTimes(21)
    expect(ctx.stroke).toHaveBeenCalledOnce()
    expect(ctx.strokeStyle).toBe('#123456')
  })

  it('sizes the canvas by devicePixelRatio and scales the context to match', () => {
    const { ctx, canvas, bus } = setup(2)
    bus.emit({ type: 'landmarks', hands: [hand()] })
    expect([canvas.width, canvas.height]).toEqual([400, 200])
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
  })

  it('clears on lost and on an empty landmarks event, and draws nothing then', () => {
    const { ctx, bus } = setup()
    bus.emit({ type: 'lost' })
    bus.emit({ type: 'landmarks', hands: [] })
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
    expect(ctx.arc).not.toHaveBeenCalled()
  })

  it('ignores unrelated events', () => {
    const { ctx, bus } = setup()
    bus.emit({ type: 'explode', amount: 1 })
    expect(ctx.clearRect).not.toHaveBeenCalled()
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('stops drawing once unsubscribed', () => {
    const { ctx, bus, off } = setup()
    off()
    bus.emit({ type: 'landmarks', hands: [hand()] })
    bus.emit({ type: 'lost' })
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.clearRect).not.toHaveBeenCalled()
  })

  it('does nothing without a 2d context', () => {
    const bus = createBus<GestureEvent>()
    const canvas = { width: 0, height: 0, clientWidth: 1, clientHeight: 1, getContext: () => null }
    expect(() => attachHandOverlay(canvas, { bus, ratio: () => 1, accent: '#000' })()).not.toThrow()
  })
})

describe('HandOverlay', () => {
  it('renders the decorative overlay canvas', () => {
    expect(renderToStaticMarkup(<HandOverlay />)).toBe('<canvas class="hand-overlay" aria-hidden="true"></canvas>')
  })
})
