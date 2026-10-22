import { voxelSpacing } from '../lib/affine'
import { useViewer } from '../state/store'
import { Row } from './FindingsPanel'
import { PROVENANCE_LABEL } from './format'

export function DatasetCard() {
  const current = useViewer((s) => s.current)
  if (!current) return null
  const m = current.manifest
  return (
    <section className="panel" aria-label="Dataset">
      <div className="ph">
        <span>Dataset</span>
      </div>
      <div className="pad stack">
        <Row k="Case ID" v={m.case_id} />
        <Row k="Dimensions" v={m.dims.join(' × ')} />
        <Row k="Spacing" v={`${voxelSpacing(current.frame).map((v) => v.toFixed(2)).join(' × ')} mm`} />
        <Row k="Segmentation" v={PROVENANCE_LABEL[m.provenance]} />
      </div>
    </section>
  )
}
