import { voxelSpacing } from '../lib/affine'
import type { Provenance } from '../lib/manifest'
import { useViewer } from '../state/store'
import { Row } from './FindingsPanel'
import { PROVENANCE_LABEL } from './format'

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return <span className={`badge-tag prov-${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>
}

export function DatasetCard() {
  const current = useViewer((s) => s.current)
  if (!current) return null
  const m = current.manifest
  return (
    <section className="panel" aria-label="Dataset">
      <div className="ph">
        <span>Dataset</span>
        <ProvenanceBadge provenance={m.provenance} />
      </div>
      <div className="pad stack">
        <Row k="Case ID" v={m.case_id} />
        <Row k="Dimensions" v={m.dims.join(' × ')} />
        <Row k="Spacing" v={`${voxelSpacing(current.frame).map((v) => v.toFixed(2)).join(' × ')} mm`} />
      </div>
    </section>
  )
}
