import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Raycaster, Vector2 } from 'three'
import { gestureBus } from '../gestures/bus'
import { viewNdc } from '../gestures/cover'
import { useViewer, viewerStore } from '../state/store'
import { type Rotatable, createGestureHandler } from './gestureEvents'
import { prepareCase } from './prepare'

/** Mounts the gesture handler on the bus for the current case. The logic lives in gestureEvents.ts. */
export function GestureController() {
  const camera = useThree((s) => s.camera)
  const get = useThree((s) => s.get)
  const current = useViewer((s) => s.current)

  useEffect(() => {
    if (!current) return
    const point = new Vector2()
    return gestureBus.on(
      createGestureHandler({
        prepared: prepareCase(current),
        raycaster: new Raycaster(),
        aim(ndc, raycaster) {
          const { width, height } = get().size
          const [x, y] = viewNdc(ndc, width, height)
          raycaster.setFromCamera(point.set(x, y), camera)
        },
        store: viewerStore,
        controls: () => get().controls as unknown as Rotatable | null,
      }),
    )
  }, [current, camera, get])

  return null
}
