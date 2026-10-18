import { AgentConsole } from './ui/AgentConsole'
import { ErrorBanner } from './ui/ErrorBanner'
import { FindingsPanel } from './ui/FindingsPanel'
import { Footer } from './ui/Footer'
import { Header } from './ui/Header'
import { MriPanel } from './ui/MriPanel'
import { SceneControls } from './ui/SceneControls'
import { ViewportPanel } from './ui/ViewportPanel'
import './ui/layout.css'

export function App() {
  return (
    <div className="app">
      <Header />
      <ErrorBanner />
      <main className="app-grid">
        <div className="left-col">
          <AgentConsole />
        </div>
        <div className="center-col">
          <ViewportPanel />
          <SceneControls />
        </div>
        <div className="right-col">
          <MriPanel />
          <FindingsPanel />
        </div>
      </main>
      <Footer />
    </div>
  )
}
