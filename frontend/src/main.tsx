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

// Start on Upload (flow spec §3); the index feeds the header's case list and "Use sample".
void viewerStore.getState().loadIndex()

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
