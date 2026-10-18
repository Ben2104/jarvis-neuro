import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Raycaster, Vector2 } from 'three'
import { gestureBus } from '../gestures/bus'
import { useViewer, viewerStore } from '../state/store'
import { pickTumor } from './picking'
import { prepareCase } from './prepare'

/** Turns gesture pointer events into hover/select through the same picking rules as the mouse. */
export function GesturePicker() {
  const camera = useThree((s) => s.camera)
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
      raycaster.setFromCamera(ndc.set(e.ndc[0], e.ndc[1]), camera)
      const hit = pickTumor(raycaster, prepared)
      if (e.type === 'hover') s.hover(hit?.assetId ?? null)
      else if (hit) s.select(hit.assetId)
    })
  }, [current, camera])

  return null
}
