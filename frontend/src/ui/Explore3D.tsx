import { GestureCursor } from '../gestures/GestureCursor'
import { AgentConsole } from './AgentConsole'
import { FindingsPanel } from './FindingsPanel'
import { SceneControls } from './SceneControls'
import { ShortcutLegend } from './ShortcutLegend'
import { ViewportPanel } from './ViewportPanel'

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
      </div>
      <div className="right-col">
        <AgentConsole />
        <ShortcutLegend />
      </div>
    </main>
  )
}
