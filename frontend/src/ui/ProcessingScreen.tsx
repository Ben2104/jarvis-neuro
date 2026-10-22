import { useEffect } from 'react'
import type { Study } from '../lib/studies'
import { useViewer, viewerStore } from '../state/store'
import type { UploadedFile } from '../state/store'
import { FlowStepper } from './FlowStepper'
import { fmtBytes } from './format'
import { SLOT_LABEL } from './UploadScreen'

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

export function FileCard({ files }: { files: UploadedFile[] }) {
  if (!files.length) return null
  return (
    <ul className="file-card" aria-label="Uploaded files">
      {files.map((f) => (
        <li key={f.slot} className="file-row">
          <span className="file-icon" aria-hidden="true">▤</span>
          <span className="file-meta">
            <span className="mono">{f.name}</span>
            <span className="muted small">NIfTI volume · {SLOT_LABEL[f.slot]} · {fmtBytes(f.size)}</span>
          </span>
          <span className="badge ok">✓ Uploaded</span>
        </li>
      ))}
    </ul>
  )
}

export function ProcessingScreen() {
  const files = useViewer((s) => s.uploadedFiles)
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
        <FileCard files={files} />
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
          <p className="hint muted small">Next, say “Place the tumor in 3D” to the Neuro agent, or use the button.</p>
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
