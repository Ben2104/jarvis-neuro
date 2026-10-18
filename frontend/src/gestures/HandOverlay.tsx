import { useEffect, useRef } from 'react'
import { type GestureEvent, gestureBus } from './bus'
import { viewNdc } from './cover'
import { handSegments } from './handDraw'

const FINGERTIPS = new Set([4, 8, 12, 16, 20])

interface OverlayContext {
  clearRect(x: number, y: number, w: number, h: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  fill(): void
  strokeStyle: unknown
  fillStyle: unknown
  lineWidth: number
}

export interface OverlayCanvas {
  width: number
  height: number
  readonly clientWidth: number
  readonly clientHeight: number
  getContext(id: '2d'): OverlayContext | null
}

interface OverlayDeps {
  bus: { on(fn: (e: GestureEvent) => void): () => void }
  ratio(): number
  accent: string
}

/** Draws landmark events onto `canvas` and returns the unsubscribe. Split out so it runs without a DOM. */
export function attachHandOverlay(canvas: OverlayCanvas, { bus, ratio, accent }: OverlayDeps): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height)
  return bus.on((e) => {
    if (e.type === 'lost' || (e.type === 'landmarks' && e.hands.length === 0)) {
      clear()
      return
    }
    if (e.type !== 'landmarks') return
    const dpr = ratio()
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { points, lines } = handSegments(e.hands, (p) => viewNdc(p, w, h), w, h)
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const [a, b] of lines) {
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
    }
    ctx.stroke()
    points.forEach(([x, y], i) => {
      ctx.beginPath()
      ctx.arc(x, y, FINGERTIPS.has(i % 21) ? 5 : 3, 0, Math.PI * 2)
      ctx.fill()
    })
  })
}

/** The tracked hand landmarks over the webcam backdrop. Drawn straight on a canvas by bus events, never through React state. */
export function HandOverlay() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#4cc2ff'
    return attachHandOverlay(canvas, { bus: gestureBus, ratio: () => window.devicePixelRatio || 1, accent })
  }, [])

  return <canvas ref={ref} className="hand-overlay" aria-hidden="true" />
}
