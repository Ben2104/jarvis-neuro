import { Canvas } from '@react-three/fiber'
import { useViewer, viewerStore } from '../state/store'
import { CameraRig } from './CameraRig'
import { CaseModel } from './CaseModel'
import { GesturePicker } from './GesturePicker'
import { Marker } from './Marker'

export const STAGE_COLOR = '#07090A'

export function Viewer() {
  const current = useViewer((s) => s.current)
  const gesturesOn = useViewer((s) => s.gesturesOn)
  return (
    <Canvas
      camera={{ position: [0, 0.04, 0.4], fov: 35, near: 0.005, far: 5 }}
      dpr={[1, 2]}
      gl={{ alpha: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true
      }}
      onPointerMissed={() => viewerStore.getState().select(null)}
    >
      {/* Transparent in gesture mode so the webcam backdrop shows through; the stage colour is the section's. */}
      {!gesturesOn && <color attach="background" args={[STAGE_COLOR]} />}
      <ambientLight intensity={0.55} />
      <directionalLight position={[0.3, 0.5, 0.4]} intensity={1.4} />
      <directionalLight position={[-0.4, -0.2, -0.3]} intensity={0.5} />
      {current && <CaseModel key={`${current.manifest.case_id}:${current.manifest.provenance}`} loaded={current} />}
      <Marker />
      <CameraRig />
      <GesturePicker />
    </Canvas>
  )
}
