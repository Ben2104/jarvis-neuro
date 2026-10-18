import { CameraControls } from '@react-three/drei'
import { type ComponentRef, useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { gestureBus } from '../gestures/bus'
import { useViewer } from '../state/store'
import { applyZoom } from './gestureEvents'
import { assetBox } from './focus'
import { prepareCase } from './prepare'

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
        applyZoom(e, controls)
      }),
    [],
  )

  return <CameraControls ref={ref} makeDefault minDistance={0.02} maxDistance={1.2} smoothTime={0.25} />
}
