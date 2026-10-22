import { type DragEvent, useState } from 'react'
import { SEQUENCES, type Sequence, assignFiles } from '../lib/studies'
import { useViewer, viewerStore } from '../state/store'
import { FlowStepper } from './FlowStepper'

export const SLOT_LABEL: Record<Sequence, string> = { t1c: 'T1 contrast (T1c)', t1: 'T1', t2: 'T2', flair: 'FLAIR' }
const DISABLED_FORMATS = ['DICOM', 'ZIP', '2D slices']
const SAMPLE_CASE = 'brats_001'

type Slots = Partial<Record<Sequence, File>>

export const isComplete = (slots: Slots): slots is Record<Sequence, File> => SEQUENCES.every((s) => slots[s])

export interface UploadViewProps {
  slots: Slots
  error: string | null
  busy: boolean
  onFiles(files: File[]): void
  onSlot(slot: Sequence, file: File | undefined): void
  onSubmit(): void
  onSample(): void
}

export function UploadView({ slots, error, busy, onFiles, onSlot, onSubmit, onSample }: UploadViewProps) {
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    onFiles([...e.dataTransfer.files])
  }
  return (
    <main className="upload-screen">
      <FlowStepper active={0} />
      <h1>Load an MRI study</h1>
      <p className="lede">Drop the four NIfTI sequences (.nii / .nii.gz) or browse. Everything is analysed on this machine.</p>

      <section className="drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <h2>Drag &amp; drop MRI files here</h2>
        <div className="drop-actions">
          <label className="btn primary">
            Browse files
            <input type="file" multiple accept=".nii,.gz" hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
          </label>
          <button className="btn" disabled title="Not in this build">Choose DICOM folder</button>
        </div>
        <p className="muted small">Max 250 MB per study · T1-weighted contrast-enhanced recommended</p>
      </section>

      <section className="slots" aria-label="Sequences">
        {SEQUENCES.map((s) => (
          <label key={s} className={`slot${slots[s] ? ' set' : ''}`}>
            <span className="lbl">{SLOT_LABEL[s]}</span>
            <span className="mono">{slots[s]?.name ?? 'Choose file…'}</span>
            <input type="file" accept=".nii,.gz" hidden onChange={(e) => onSlot(s, e.target.files?.[0])} />
          </label>
        ))}
      </section>

      {error && <p className="error-line" role="alert">{error}</p>}

      <div className="upload-actions">
        <button className="btn primary" disabled={!isComplete(slots) || busy} onClick={onSubmit}>Analyze scan</button>
      </div>

      <h3 className="eyebrow">Accepted file types</h3>
      <section className="formats" aria-label="Formats">
        <div className="format-card on">
          <b>NIfTI volume</b>
          <span className="badge ok">3D</span>
          <span className="ext mono">.nii .nii.gz</span>
        </div>
        {DISABLED_FORMATS.map((f) => (
          <div key={f} className="format-card" aria-disabled="true">
            <b>{f}</b>
            <span className="muted small">not in this build</span>
          </div>
        ))}
      </section>

      <div className="upload-secondary">
        <section className="panel sample">
          <div>
            <b>No scan? Try the demo case</b>
            <p className="muted small">A public BraTS case, already segmented.</p>
          </div>
          <button className="btn" onClick={onSample}>Use sample</button>
        </section>
        <section className="panel privacy">
          <b>Stays on this device</b>
          <p className="muted small">Volumes never leave this machine. The language model sees only the computed facts in manifest.json.</p>
        </section>
      </div>
    </main>
  )
}

export function UploadScreen() {
  const error = useViewer((s) => s.studyError)
  const [slots, setSlots] = useState<Slots>({})
  const [busy, setBusy] = useState(false)
  const s = viewerStore.getState()
  return (
    <UploadView
      slots={slots}
      error={error}
      busy={busy}
      onFiles={(files) => setSlots((prev) => ({ ...prev, ...assignFiles(files) }))}
      onSlot={(slot, file) => setSlots((prev) => ({ ...prev, [slot]: file }))}
      onSubmit={async () => {
        if (!isComplete(slots)) return
        setBusy(true)
        await s.uploadStudy(slots)
        setBusy(false)
      }}
      onSample={() => void s.openCase(SAMPLE_CASE)}
    />
  )
}
