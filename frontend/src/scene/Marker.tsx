import { rasToScene } from '../lib/affine'
import { useViewer } from '../state/store'

const noRaycast = () => {}

/** The shared 3D/2D marker. Drawn on top of everything, never pickable. */
export function Marker() {
  const marker = useViewer((s) => s.marker)
  const current = useViewer((s) => s.current)
  if (!marker || !current) return null
  return (
    <mesh position={rasToScene(current.frame, marker)} renderOrder={10} raycast={noRaycast}>
      <sphereGeometry args={[0.0025, 16, 12]} />
      <meshBasicMaterial color="#5BC0CE" depthTest={false} depthWrite={false} transparent />
    </mesh>
  )
}
