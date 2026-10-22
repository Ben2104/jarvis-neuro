import { useHandTracking } from './gestures/useHandTracking'
import { type Stage, useViewer } from './state/store'
import { useShortcuts } from './tools/useShortcuts'
import { ErrorBanner } from './ui/ErrorBanner'
import { Explore3D } from './ui/Explore3D'
import { Footer } from './ui/Footer'
import { Header } from './ui/Header'
import { ProcessingScreen } from './ui/ProcessingScreen'
import { UploadScreen } from './ui/UploadScreen'
import { Workspace } from './ui/Workspace'
import './ui/layout.css'

const SCREENS: Record<Stage, () => React.JSX.Element> = {
  upload: UploadScreen,
  processing: ProcessingScreen,
  workspace: Workspace,
  explore3d: Explore3D,
}

export function App() {
  useShortcuts()
  useHandTracking()
  const Screen = SCREENS[useViewer((s) => s.stage)]
  return (
    <div className="app">
      <Header />
      <ErrorBanner />
      <Screen />
      <Footer />
    </div>
  )
}
