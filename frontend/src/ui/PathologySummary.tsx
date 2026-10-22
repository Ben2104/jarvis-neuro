import { useEffect, useState } from 'react'
import { type Manifest, hemisphereOf, tumorAssets } from '../lib/manifest'
import { useViewer, viewerStore } from '../state/store'
import { ATLAS_ONLY, fmtMl, fmtMm, totalVolumeMl } from './format'

const BANNER_MS = 8000

export interface PathologyFacts {
  volume: string
  side: 'left' | 'right' | 'midline'
  /** Smallest distance from any tumour sub-region to the brain surface. */
  margin: string
}

/** Everything is read from the manifest; null when the case has no tumour. */
export function pathologyFacts(m: Manifest): PathologyFacts | null {
  const tumors = tumorAssets(m)
  const total = totalVolumeMl(tumors)
  if (total === null) return null
  // Volume-weighted centroid x; a zero-volume case falls back to a plain mean.
  const w = (t: (typeof tumors)[number]) => (total > 0 ? t.volume_ml / total : 1 / tumors.length)
  const x = tumors.reduce((acc, t) => acc + t.centroid_ras[0] * w(t), 0)
  return {
    volume: fmtMl(total),
    side: hemisphereOf(x, m.midline_x_ras),
    margin: fmtMm(Math.min(...tumors.map((t) => t.min_dist_surface_mm))),
  }
}

const sideLabel = (side: PathologyFacts['side']) => (side === 'midline' ? 'midline' : `${side} hemisphere`)

export function PathologySummaryView({ manifest }: { manifest: Manifest }) {
  const f = pathologyFacts(manifest)
  return (
    <section className="panel pathology" aria-label="Pathology summary">
      <div className="pad stack">
        <span className="badge-tag">Detected from MRI series {manifest.case_id}</span>
        {f ? (
          <>
            <h2>Selected pathology: tumor, {sideLabel(f.side)}</h2>
            <div className="readouts">
              <div>
                <span className="lbl">Tumor volume</span>
                <b>{f.volume}</b>
              </div>
              <div>
                <span className="lbl">Margins</span>
                <b>{f.margin}</b>
                <span className="muted small">to brain surface</span>
              </div>
            </div>
            <div className="row">
              <span className="k">Tumor type</span>
              <span className="v">{ATLAS_ONLY}</span>
            </div>
            <div className="row">
              <span className="k">Eloquent cortex &amp; pathways</span>
              <span className="v">{ATLAS_ONLY}</span>
            </div>
          </>
        ) : (
          <h2>No tumor detected</h2>
        )}
      </div>
    </section>
  )
}

export function TumorPlacedBanner({ manifest, onUndo }: { manifest: Manifest; onUndo(): void }) {
  const f = pathologyFacts(manifest)
  if (!f) return null
  return (
    <div className="toast" role="status">
      <span className="check-dot" aria-hidden="true">✓</span>
      <b>Tumor placed on the 3D brain</b>
      <span>{sideLabel(f.side)} · {f.volume} · approximate placement</span>
      <button className="btn" onClick={onUndo}>Undo</button>
    </div>
  )
}

export function PathologySummary() {
  const current = useViewer((s) => s.current)
  return current ? <PathologySummaryView manifest={current.manifest} /> : null
}

/** Shows once when the 3D screen opens; Undo returns to the MRI workspace. */
export function PlacedBanner() {
  const current = useViewer((s) => s.current)
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setShown(false), BANNER_MS)
    return () => clearTimeout(t)
  }, [])
  if (!current || !shown) return null
  return <TumorPlacedBanner manifest={current.manifest} onUndo={() => viewerStore.getState().setStage('workspace')} />
}
