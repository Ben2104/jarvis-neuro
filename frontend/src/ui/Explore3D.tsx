import { GestureCursor } from '../gestures/GestureCursor'
import { tumorAssets } from '../lib/manifest'
import { useViewer } from '../state/store'
import { AgentConsole } from './AgentConsole'
import { FindingsPanel } from './FindingsPanel'
import { SceneControls } from './SceneControls'
import { ShortcutLegend } from './ShortcutLegend'
import { ViewportPanel } from './ViewportPanel'
import { webcamLabel, runUi } from './controls'
import { TUMOR_LABEL } from './format'

function Telemetry() {
  const webcam = useViewer((s) => s.webcam)
  const gesturesOn = useViewer((s) => s.gesturesOn)
  const cam = webcamLabel(webcam, gesturesOn)
  return (
    <section className="panel" aria-label="Gesture telemetry">
      <div className="ph">
        <span>User Gesture Telemetry</span>
      </div>
      <div className="pad">
        <span className="chip">
          <i className={`dot ${cam.tone}`} />
          {cam.text}
        </span>
      </div>
    </section>
  )
}

/** One toggle per tumour asset in the manifest; no anatomy chips (flow spec "Not built"). */
function StructuresBar() {
  const current = useViewer((s) => s.current)
  const visible = useViewer((s) => s.visible)
  if (!current) return null
  return (
    <section className="panel structures" aria-label="Structures">
      <span className="lbl">Structures</span>
      {tumorAssets(current.manifest).map((t) => (
        <label key={t.id} className="check">
          <input
            type="checkbox"
            checked={visible[t.id] !== false}
            onChange={(e) => void runUi('toggle_visibility', { asset_ids: [t.id], visible: e.target.checked })}
          />
          <i className="swatch" style={{ background: t.color }} />
          {TUMOR_LABEL[t.id]}
        </label>
      ))}
    </section>
  )
}

export function Explore3D() {
  return (
    <main className="app-grid">
      <div className="left-col">
        <FindingsPanel />
        <SceneControls />
      </div>
      <div className="center-col">
        <ViewportPanel>
          <GestureCursor />
        </ViewportPanel>
        <StructuresBar />
      </div>
      <div className="right-col">
        <Telemetry />
        <AgentConsole />
        <ShortcutLegend />
      </div>
    </main>
  )
}
