import { useViewer, viewerStore } from '../state/store'

/** Spec §7: a failed load shows here and the previous case stays on screen. */
export function ErrorBanner() {
  const error = useViewer((s) => s.error)
  const current = useViewer((s) => s.current)
  if (!error) return null
  return (
    <div className="error-banner" role="alert">
      <span>{error}</span>
      {current && <span className="muted">Still showing {current.manifest.case_id}.</span>}
      <button className="btn" onClick={() => viewerStore.getState().dismissError()}>
        Dismiss
      </button>
    </div>
  )
}
