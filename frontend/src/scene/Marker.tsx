import { useMemo } from 'react'
import { rasToScene } from '../lib/affine'
import { explodeOffsets, offsetOf } from '../lib/explode'
import type { Vec3 } from '../lib/manifest'
import { useViewer } from '../state/store'

const noRaycast = () => {}

/** The shared 3D/2D marker. Drawn on top of everything, never pickable. */
export function Marker() {
  const marker = useViewer((s) => s.marker)
  const current = useViewer((s) => s.current)
  const explode = useViewer((s) => s.explode)
  const selected = useViewer((s) => s.selected)
  const position = useMemo(() => {
    if (!marker || !current) return null
    // The marker is in unexploded RAS; it rides with the part it was picked on.
    const o = selected ? offsetOf(explodeOffsets(current.manifest, current.brainBoxRas, explode), selected) : [0, 0, 0]
    return rasToScene(current.frame, [marker[0] + o[0], marker[1] + o[1], marker[2] + o[2]] as Vec3)
  }, [marker, current, explode, selected])
  if (!position) return null
  return (
    <mesh position={position} renderOrder={10} raycast={noRaycast}>
      <sphereGeometry args={[0.0025, 16, 12]} />
      <meshBasicMaterial color="#5BC0CE" depthTest={false} depthWrite={false} transparent />
    </mesh>
  )
}
