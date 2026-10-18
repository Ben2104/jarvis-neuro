import { useEffect, useRef } from 'react'
import { gestureBus } from './bus'
import { viewNdc } from './cover'
import { handSegments } from './handDraw'

const FINGERTIPS = new Set([4, 8, 12, 16, 20])

/** The tracked hand landmarks over the webcam backdrop. Drawn straight on a canvas by bus events, never through React state. */
export function HandOverlay() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#4cc2ff'
    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height)
    return gestureBus.on((e) => {
      if (e.type === 'lost' || (e.type === 'landmarks' && e.hands.length === 0)) {
        clear()
        return
      }
      if (e.type !== 'landmarks') return
      const ratio = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.round(w * ratio)
      canvas.height = Math.round(h * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
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
  }, [])

  return <canvas ref={ref} className="hand-overlay" aria-hidden="true" />
}
