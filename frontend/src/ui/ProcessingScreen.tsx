import { useEffect } from 'react'
import type { Study } from '../lib/studies'
import { useViewer, viewerStore } from '../state/store'
import { FlowStepper } from './FlowStepper'

type StepKey = keyof Study['steps']
type StepState = Study['steps'][StepKey]['state']
export interface Row {
  key: StepKey
  label: string
  state: StepState
  detail: string
}

const LABELS: Record<StepKey, string> = {
  read: 'Read file',
  volume: 'Build 3D volume',
  segment: 'Segment tumor',
  measure: 'Measure volume & location',
}
const POLL_MS = 1000

function detailFor(key: StepKey, study: Study): string {
  const s = study.steps
  if (s[key].state === 'failed') return study.error ?? ''
  if (key === 'read' && s.read.seconds !== undefined) return `${s.read.seconds} s`
  if (key === 'volume' && s.volume.dims && s.volume.spacing_mm)
    return `${s.volume.dims.join(' × ')} · ${s.volume.spacing_mm.map((v) => v.toFixed(2)).join(' × ')} mm`
  if (key === 'segment') return 'SegResNet'
  return ''
}

export function rowsFor(study: Study | null): Row[] {
  return (Object.keys(LABELS) as StepKey[]).map((key) => ({
    key,
    label: LABELS[key],
    state: study ? study.steps[key].state : 'pending',
    detail: study ? detailFor(key, study) : '',
  }))
}

export function ProcessingScreen() {
  const study = useViewer((s) => s.study)
  const studyId = useViewer((s) => s.studyId)
  const error = useViewer((s) => s.studyError)
  const finished = study?.status === 'done' || study?.status === 'failed'

  useEffect(() => {
    if (!studyId || finished) return
    const s = viewerStore.getState()
    void s.pollStudy()
    const timer = setInterval(() => void s.pollStudy(), POLL_MS)
    return () => clearInterval(timer)
  }, [studyId, finished])

  const s = viewerStore.getState()
  return (
    <main className="processing-screen">
      <FlowStepper active={1} />
      <h1>Preparing your study</h1>
      <p className="lede">Hang tight. The MRI Workspace opens as soon as segmentation finishes.</p>
      <section className="progress-card">
        <p className="muted mono small">Study {studyId}</p>
        <ol className="steps">
          {rowsFor(study).map((r) => (
            <li key={r.key} className={`step ${r.state}`}>
              <span className="state-dot" aria-hidden="true">{r.state === 'done' ? '✓' : r.state === 'failed' ? '!' : ''}</span>
              <span className="step-label">{r.label}</span>
              <span className="muted small">{r.detail}</span>
              {r.key === 'segment' && r.state === 'running' && (
                <span className="bar indeterminate" role="progressbar" aria-label="Segmenting" />
              )}
            </li>
          ))}
        </ol>
        {error && <p className="error-line" role="alert">{error}</p>}
        <div className="upload-actions">
          <button className="btn" onClick={() => s.cancelStudy()}>Cancel</button>
          <button
            className="btn primary"
            disabled={study?.status !== 'done' || !study.case_id}
            onClick={() => study?.case_id && void s.openCase(study.case_id, 'monai-segresnet')}
          >
            Open MRI Workspace →
          </button>
        </div>
      </section>
    </main>
  )
}
