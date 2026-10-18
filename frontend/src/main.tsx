import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { defaultAgentUrl, startAgent } from './agent'
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

// Connects to the agent server and keeps retrying; the viewer works without it (spec §7).
startAgent(viewerStore, import.meta.env.VITE_AGENT_URL || defaultAgentUrl())

if (import.meta.env.DEV) {
  // Console hook for smoke tests.
  Object.assign(window, { __jarvis: { store: viewerStore, executeTool } })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
