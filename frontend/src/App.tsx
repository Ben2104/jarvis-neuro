import { Viewer } from './scene/Viewer'
import { MriPanel } from './ui/MriPanel'

export function App() {
  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 372px', height: '100%' }}>
      <Viewer />
      <MriPanel />
    </main>
  )
}
