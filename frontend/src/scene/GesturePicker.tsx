import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Raycaster, Vector2 } from 'three'
import { gestureBus } from '../gestures/bus'
import { viewNdc } from '../gestures/cover'
import { useViewer, viewerStore } from '../state/store'
import { pickTumor } from './picking'
import { prepareCase } from './prepare'

/** Turns gesture pointer events into hover/select through the same picking rules as the mouse. */
export function GesturePicker() {
  const camera = useThree((s) => s.camera)
  const get = useThree((s) => s.get)
  const current = useViewer((s) => s.current)

  useEffect(() => {
    if (!current) return
    const prepared = prepareCase(current)
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    return gestureBus.on((e) => {
      const s = viewerStore.getState()
      if (e.type === 'lost') {
        s.hover(null)
        return
      }
      if (e.type !== 'hover' && e.type !== 'select') return
      const { width, height } = get().size
      const [x, y] = viewNdc(e.ndc, width, height)
      raycaster.setFromCamera(ndc.set(x, y), camera)
      const hit = pickTumor(raycaster, prepared)
      if (e.type === 'hover') s.hover(hit?.assetId ?? null)
      else if (hit) s.select(hit.assetId)
    })
  }, [current, camera, get])

  return null
}
