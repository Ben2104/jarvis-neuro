import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { releaseCase } from './scene/prepare'
import { viewerStore } from './state/store'
import { executeTool } from './tools/execute'
import './ui/theme.css'

// Free GPU resources of a case once it is replaced (a failed load never replaces it).
viewerStore.subscribe((s, prev) => {
  if (prev.current && prev.current !== s.current) releaseCase(prev.current)
})

async function boot() {
  await viewerStore.getState().loadIndex()
  const first = viewerStore.getState().index?.cases[0]
  if (first) await viewerStore.getState().loadCase(first.case_id, first.provenance)
}
void boot()

if (import.meta.env.DEV) {
  // Console hook for the Task 13 smoke test and for Plan C before the WebSocket exists.
  Object.assign(window, { __jarvis: { store: viewerStore, executeTool } })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
