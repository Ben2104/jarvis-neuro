import { useViewer, viewerStore } from '../state/store'
import { webcamLabel, runUi } from './controls'
import { PROVENANCE_LABEL } from './format'

export function Header() {
  const index = useViewer((s) => s.index)
  const current = useViewer((s) => s.current)
  const loading = useViewer((s) => s.loading)
  const webcam = useViewer((s) => s.webcam)
  const gesturesOn = useViewer((s) => s.gesturesOn)
  const stage = useViewer((s) => s.stage)
  const setStage = viewerStore.getState().setStage
  const cam = webcamLabel(webcam, gesturesOn)
  const value = current ? `${current.manifest.case_id}|${current.manifest.provenance}` : ''

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 26 26" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
            <circle cx="13" cy="13" r="10" />
            <circle cx="13" cy="13" r="4" />
          </svg>
        </span>
        <span className="brand-name">NeuroVision</span>
        <span className="chip">v2.4 Core</span>
      </div>
      <nav className="nav" aria-label="Sections">
        <button
          className="nav-tab"
          aria-current={stage === 'upload' || stage === 'processing' ? 'page' : undefined}
          onClick={() => stage !== 'processing' && setStage('upload')}
        >
          Upload
        </button>
        <button
          className="nav-tab"
          aria-current={stage === 'workspace' || stage === 'explore3d' ? 'page' : undefined}
          disabled={!current}
          onClick={() => setStage('workspace')}
        >
          MRI Workspace
        </button>
        {['Explore', 'Learning Mode', 'Help'].map((t) => (
          <button key={t} className="nav-tab" disabled title="Not in this build">
            {t}
          </button>
        ))}
      </nav>
      <div className="header-right">
        {loading && <span className="chip">Loading case…</span>}
        <span className="chip">
          <i className={`dot ${cam.tone}`} />
          {cam.text}
        </span>
        <label>
          <span className="sr-only">Case</span>
          <select
            value={value}
            disabled={!index?.cases.length}
            onChange={(e) => {
              const [case_id, provenance] = e.target.value.split('|')
              void runUi('load_case', { case_id, provenance })
            }}
          >
            {!current && <option value="">No case</option>}
            {index?.cases.map((c) => (
              <option key={`${c.case_id}|${c.provenance}`} value={`${c.case_id}|${c.provenance}`}>
                {c.case_id} · {PROVENANCE_LABEL[c.provenance]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  )
}
