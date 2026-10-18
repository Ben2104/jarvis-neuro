import { useViewer } from '../state/store'
import { webcamLabel, runUi } from './controls'
import { PROVENANCE_LABEL } from './format'

export function Header() {
  const index = useViewer((s) => s.index)
  const current = useViewer((s) => s.current)
  const loading = useViewer((s) => s.loading)
  const webcam = useViewer((s) => s.webcam)
  const gesturesOn = useViewer((s) => s.gesturesOn)
  const cam = webcamLabel(webcam, gesturesOn)
  const value = current ? `${current.manifest.case_id}|${current.manifest.provenance}` : ''

  return (
    <header className="app-header">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="var(--accent)" strokeWidth="1.6" aria-hidden="true">
          <circle cx="13" cy="13" r="10" />
          <circle cx="13" cy="13" r="4" />
          <path d="M13 1v5M13 20v5M1 13h5M20 13h5" />
        </svg>
        <span>Jarvis-Neuro</span>
        <span className="chip">Anatomy viewer</span>
      </div>
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
