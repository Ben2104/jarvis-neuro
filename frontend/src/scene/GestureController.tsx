import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Raycaster, Vector2 } from 'three'
import { type NdcPoint, gestureBus } from '../gestures/bus'
import { viewNdc } from '../gestures/cover'
import { useViewer, viewerStore } from '../state/store'
import { type GrabState, dragToRotate, onPinchEnd, onPinchStart } from './grab'
import { pickPart, rayHitsBrain } from './picking'
import { prepareCase } from './prepare'

/** The slice of drei's CameraControls the controller drives. */
interface Rotatable {
  rotate(azimuth: number, polar: number, enableTransition: boolean): Promise<void>
}

/**
 * Turns gesture events into hover, select, rotate and explode. Hover and select go through the same picking rules as
 * the mouse; a pinch on the brain plus a drag rotates the camera; an open hand sets the explode amount.
 */
export function GestureController() {
  const camera = useThree((s) => s.camera)
  const get = useThree((s) => s.get)
  const current = useViewer((s) => s.current)

  useEffect(() => {
    if (!current) return
    const prepared = prepareCase(current)
    const raycaster = new Raycaster()
    const point = new Vector2()
    let grab: GrabState = onPinchEnd()
    const aim = (ndc: NdcPoint) => {
      const { width, height } = get().size
      const [x, y] = viewNdc(ndc, width, height)
      raycaster.setFromCamera(point.set(x, y), camera)
    }
    return gestureBus.on((e) => {
      const s = viewerStore.getState()
      switch (e.type) {
        case 'hover':
          aim(e.ndc)
          s.hover(pickPart(raycaster, prepared)?.assetId ?? null)
          break
        case 'pinchStart':
          aim(e.ndc)
          grab = onPinchStart(rayHitsBrain(raycaster, prepared))
          break
        case 'drag': {
          const r = dragToRotate(grab, e.dx, e.dy)
          if (r) void (get().controls as unknown as Rotatable | null)?.rotate(r[0], r[1], false)
          break
        }
        case 'pinchEnd': {
          if (e.tap) {
            aim(e.ndc)
            const hit = pickPart(raycaster, prepared)
            if (hit) s.select(hit.assetId)
          }
          grab = onPinchEnd()
          break
        }
        case 'explode':
          s.setExplode(e.amount)
          break
        case 'lost':
          s.hover(null)
          grab = onPinchEnd()
          break
      }
    })
  }, [current, camera, get])

  return null
}
