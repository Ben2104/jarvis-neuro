import { useEffect, useRef } from 'react'
import { gestureBus } from './bus'
import { viewNdc } from './cover'

/** Reticle at the hand pointer, over the webcam backdrop's crop. Moved by bus events straight on the DOM node, never through React state. */
export function GestureCursor() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let pulse = 0
    const off = gestureBus.on((e) => {
      const el = ref.current
      if (!el) return
      if (e.type === 'lost') {
        el.style.opacity = '0'
        return
      }
      if (e.type !== 'hover' && e.type !== 'select') return
      const view = el.parentElement
      const [x, y] = viewNdc(e.ndc, view?.clientWidth ?? 0, view?.clientHeight ?? 0)
      el.style.opacity = '1'
      el.style.left = `${((x + 1) / 2) * 100}%`
      el.style.top = `${((1 - y) / 2) * 100}%`
      if (e.type === 'select') {
        el.classList.add('pinch')
        window.clearTimeout(pulse)
        pulse = window.setTimeout(() => el.classList.remove('pinch'), 250)
      }
    })
    return () => {
      off()
      window.clearTimeout(pulse)
    }
  }, [])

  return <div ref={ref} className="gesture-cursor" aria-hidden="true" />
}
