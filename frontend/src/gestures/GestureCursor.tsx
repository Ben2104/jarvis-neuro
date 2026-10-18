import { useEffect, useRef } from 'react'
import { gestureBus } from './bus'
import { viewNdc } from './cover'

/** Reticle at the hand pointer, over the webcam backdrop's crop. Moved by bus events straight on the DOM node, never through React state. */
export function GestureCursor() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = gestureBus.on((e) => {
      const el = ref.current
      if (!el) return
      if (e.type === 'lost') {
        el.style.opacity = '0'
        el.classList.remove('pinch')
        return
      }
      if (e.type === 'pinchStart') el.classList.add('pinch')
      else if (e.type === 'pinchEnd') el.classList.remove('pinch')
      if (e.type !== 'hover') return
      const view = el.parentElement
      const [x, y] = viewNdc(e.ndc, view?.clientWidth ?? 0, view?.clientHeight ?? 0)
      el.style.opacity = '1'
      el.style.left = `${((x + 1) / 2) * 100}%`
      el.style.top = `${((1 - y) / 2) * 100}%`
      el.dataset.pose = e.pose
    })
    return off
  }, [])

  return <div ref={ref} className="gesture-cursor" aria-hidden="true" />
}
