import { GestureCursor } from './gestures/GestureCursor'
import { useHandTracking } from './gestures/useHandTracking'
import { useShortcuts } from './tools/useShortcuts'
import { AgentConsole } from './ui/AgentConsole'
import { ErrorBanner } from './ui/ErrorBanner'
import { FindingsPanel } from './ui/FindingsPanel'
import { Footer } from './ui/Footer'
import { Header } from './ui/Header'
import { MriPanel } from './ui/MriPanel'
import { SceneControls } from './ui/SceneControls'
import { ShortcutLegend } from './ui/ShortcutLegend'
import { ViewportPanel } from './ui/ViewportPanel'
import './ui/layout.css'

export function App() {
  useShortcuts()
  useHandTracking()
  return (
    <div className="app">
      <Header />
      <ErrorBanner />
      <main className="app-grid">
        <div className="left-col">
          <AgentConsole />
          <ShortcutLegend />
        </div>
        <div className="center-col">
          <ViewportPanel>
            <GestureCursor />
          </ViewportPanel>
          <SceneControls />
        </div>
        <div className="right-col">
          <MriPanel axis="axial" />
          <FindingsPanel />
        </div>
      </main>
      <Footer />
    </div>
  )
}
