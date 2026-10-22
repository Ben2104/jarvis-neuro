import { viewerStore } from '../state/store'
import { AgentConsole } from './AgentConsole'
import { DatasetCard } from './DatasetCard'
import { FindingsPanel } from './FindingsPanel'
import { MriPanel } from './MriPanel'

export function Workspace() {
  return (
    <main className="workspace-grid">
      <div className="left-col">
        <DatasetCard />
        <AgentConsole />
      </div>
      <div className="mpr-grid">
        <MriPanel axis="axial" large />
        <MriPanel axis="sagittal" />
        <MriPanel axis="coronal" />
      </div>
      <div className="right-col">
        <FindingsPanel />
        <button className="btn primary" onClick={() => viewerStore.getState().setStage('explore3d')}>
          Place tumor in 3D
        </button>
      </div>
    </main>
  )
}
