import { CameraControls } from '@react-three/drei'
import { type ComponentRef, useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { gestureBus } from '../gestures/bus'
import { useViewer } from '../state/store'
import { assetBox } from './focus'
import { prepareCase } from './prepare'

/**
 * Radians per NDC unit of hand travel. Mouse dragging in camera-controls is
 * rotate(-2π·Δx/height, -2π·Δy/height) with Δy pointing down; NDC spans 2 units and points up,
 * so the hand equivalent is rotate(-dx·π, +dy·π).
 */
export const ROTATE_GAIN = Math.PI

export function CameraRig() {
  const ref = useRef<ComponentRef<typeof CameraControls>>(null)
  const current = useViewer((s) => s.current)
  const focus = useViewer((s) => s.focus)

  useEffect(() => {
    const controls = ref.current
    if (!controls || !current) return
    const box = assetBox(prepareCase(current), focus.assetId)
    if (!box || box.isEmpty()) return
    const pad = box.getSize(new Vector3()).length() * 0.12
    void controls.fitToBox(box, true, { paddingTop: pad, paddingBottom: pad, paddingLeft: pad, paddingRight: pad })
  }, [current, focus])

  useEffect(
    () =>
      gestureBus.on((e) => {
        const controls = ref.current
        if (!controls) return
        if (e.type === 'rotate') void controls.rotate(-e.dx * ROTATE_GAIN, e.dy * ROTATE_GAIN, false)
        if (e.type === 'zoom') void controls.dollyTo(controls.distance / e.scale, false)
      }),
    [],
  )

  return <CameraControls ref={ref} makeDefault minDistance={0.02} maxDistance={1.2} smoothTime={0.25} />
}
