import type { Raycaster } from 'three'
import type { GestureEvent, NdcPoint } from '../gestures/bus'
import type { ViewerStore } from '../state/store'
import { type GrabState, dragToRotate, onPinchEnd, onPinchStart } from './grab'
import { pickPart, rayHitsBrain } from './picking'
import type { PreparedCase } from './prepare'

/** The slice of drei's CameraControls the gesture handlers drive. */
export interface Rotatable {
  rotate(azimuth: number, polar: number, enableTransition: boolean): Promise<void>
}

export interface Zoomable {
  distance: number
  dollyTo(distance: number, enableTransition: boolean): Promise<void>
}

export interface GestureDeps {
  prepared: PreparedCase
  raycaster: Raycaster
  /** Points `raycaster` through the (mirrored, cover-cropped) NDC position. */
  aim(ndc: NdcPoint, raycaster: Raycaster): void
  store: ViewerStore
  controls(): Rotatable | null
}

/**
 * Turns gesture events into hover, select, rotate and explode. Hover and select go through the same picking rules as
 * the mouse; a pinch on the brain plus a drag rotates the camera; an open hand sets the explode amount.
 */
export function createGestureHandler(deps: GestureDeps): (e: GestureEvent) => void {
  const { prepared, raycaster, aim, store } = deps
  let grab: GrabState = onPinchEnd()
  return (e) => {
    const s = store.getState()
    switch (e.type) {
      case 'hover':
        aim(e.ndc, raycaster)
        s.hover(pickPart(raycaster, prepared)?.assetId ?? null)
        break
      case 'pinchStart':
        aim(e.ndc, raycaster)
        grab = onPinchStart(rayHitsBrain(raycaster, prepared))
        break
      case 'drag': {
        const r = dragToRotate(grab, e.dx, e.dy)
        if (r) void deps.controls()?.rotate(r[0], r[1], false)
        break
      }
      case 'pinchEnd': {
        if (e.tap) {
          aim(e.ndc, raycaster)
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
  }
}

/** Two-hand zoom: dolly by the inverse of the spread ratio. */
export function applyZoom(e: GestureEvent, controls: Zoomable): void {
  if (e.type === 'zoom') void controls.dollyTo(controls.distance / e.scale, false)
}
